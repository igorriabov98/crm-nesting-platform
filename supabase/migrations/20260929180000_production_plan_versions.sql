-- Published production fields remain the read model for the rest of CRM.
-- Editors work in a shared draft; only the service-role publish RPC changes that read model.
ALTER TABLE public.production_month_plans
  ADD COLUMN IF NOT EXISTS published_version_number integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.production_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_month_plan_id uuid NOT NULL REFERENCES public.production_month_plans(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  status public.production_month_plan_status NOT NULL,
  snapshot jsonb NOT NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('baseline', 'publish', 'status', 'restore')),
  restored_from_version_id uuid REFERENCES public.production_plan_versions(id),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_month_plan_id, version_number),
  CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE TABLE IF NOT EXISTS public.production_plan_drafts (
  production_month_plan_id uuid PRIMARY KEY REFERENCES public.production_month_plans(id) ON DELETE CASCADE,
  base_version_number integer NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object'),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS production_plan_versions_history_idx
  ON public.production_plan_versions(production_month_plan_id, version_number DESC);

ALTER TABLE public.production_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_plan_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.production_plan_drafts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.production_plan_versions TO service_role;
GRANT ALL ON public.production_plan_drafts TO service_role;

CREATE OR REPLACE FUNCTION public.fn_capture_production_plan(p_factory_id uuid, p_month date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'machines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'factory_id', m.factory_id,
        'production_month', m.production_month,
        'production_workshop', m.production_workshop,
        'production_queue_number', m.production_queue_number,
        'planned_material_date', m.planned_material_date,
        'stages', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', s.id,
            'stage_type', s.stage_type,
            'workshop', s.workshop,
            'date_start', CASE WHEN s.stage_type::text = 'cutting' AND EXISTS (
              SELECT 1 FROM public.production_fact_cutting_events e
              WHERE e.stage_id = s.id AND e.status = 'applied'
                AND e.previous_stage_date_start IS NULL
                AND e.applied_stage_date_start = s.date_start
            ) THEN NULL ELSE s.date_start END,
            'date_end', s.date_end,
            'is_skipped', s.is_skipped,
            'is_night_shift', s.is_night_shift,
            'night_shift_date', s.night_shift_date,
            'night_shift_dates', s.night_shift_dates,
            'intervals', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'position', i.position, 'date_start', i.date_start,
                'date_end', i.date_end, 'workshop', i.workshop
              ) ORDER BY i.position, i.id)
              FROM public.production_stage_intervals i WHERE i.production_stage_id = s.id
            ), '[]'::jsonb)
          ) ORDER BY s.id)
          FROM public.production_stages s
          WHERE s.machine_id = m.id AND s.stage_type::text <> 'actual_shipping'
        ), '[]'::jsonb),
        'outsourcing', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', o.id, 'planned_send_date', o.planned_send_date,
            'planned_return_date', o.planned_return_date
          ) ORDER BY o.id)
          FROM public.machine_outsourcing_operations o
          WHERE o.machine_id = m.id AND o.archived_at IS NULL
        ), '[]'::jsonb)
      ) ORDER BY m.id)
      FROM public.machines m
      WHERE m.factory_id = p_factory_id AND m.production_month = p_month AND m.is_archived = false
    ), '[]'::jsonb),
    'incoming', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', o.id,
        'incoming_production_month', o.incoming_production_month,
        'incoming_date_start', o.incoming_date_start,
        'incoming_date_end', o.incoming_date_end,
        'incoming_workshop', o.incoming_workshop,
        'incoming_queue_number', o.incoming_queue_number
      ) ORDER BY o.id)
      FROM public.machine_outsourcing_operations o
      WHERE o.executor_factory_id = p_factory_id
        AND o.incoming_production_month = p_month AND o.archived_at IS NULL
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.fn_capture_production_plan(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_capture_production_plan(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_record_production_plan_version(
  p_plan_id uuid, p_kind text, p_actor uuid, p_restored_from uuid DEFAULT NULL
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan public.production_month_plans%ROWTYPE; v_next integer;
BEGIN
  SELECT * INTO v_plan FROM public.production_month_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'План месяца не найден'; END IF;
  v_next := v_plan.published_version_number + 1;
  INSERT INTO public.production_plan_versions (
    production_month_plan_id, version_number, status, snapshot, change_kind,
    restored_from_version_id, created_by
  ) VALUES (
    p_plan_id, v_next, v_plan.status,
    public.fn_capture_production_plan(v_plan.factory_id, v_plan.production_month),
    p_kind, p_restored_from, p_actor
  );
  UPDATE public.production_month_plans
    SET published_version_number = v_next WHERE id = p_plan_id;
  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_record_production_plan_version(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_production_plan_version(uuid, text, uuid, uuid)
  TO service_role;

-- The initial immutable version records exactly what all readers currently see.
INSERT INTO public.production_month_plans(factory_id, production_month, status)
SELECT DISTINCT m.factory_id, m.production_month, 'draft'::public.production_month_plan_status
FROM public.machines m
WHERE m.factory_id IS NOT NULL AND m.production_month IS NOT NULL AND m.is_archived = false
ON CONFLICT (factory_id, production_month) DO NOTHING;

INSERT INTO public.production_month_plans(factory_id, production_month, status)
SELECT DISTINCT o.executor_factory_id, o.incoming_production_month,
  'draft'::public.production_month_plan_status
FROM public.machine_outsourcing_operations o
WHERE o.executor_factory_id IS NOT NULL AND o.incoming_production_month IS NOT NULL
  AND o.archived_at IS NULL
ON CONFLICT (factory_id, production_month) DO NOTHING;

INSERT INTO public.production_plan_versions (
  production_month_plan_id, version_number, status, snapshot, change_kind
)
SELECT p.id, 1, p.status,
  public.fn_capture_production_plan(p.factory_id, p.production_month), 'baseline'
FROM public.production_month_plans p
WHERE p.published_version_number = 0
ON CONFLICT (production_month_plan_id, version_number) DO NOTHING;

UPDATE public.production_month_plans SET published_version_number = 1
WHERE published_version_number = 0;

CREATE OR REPLACE FUNCTION public.fn_reject_production_plan_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Опубликованную версию плана нельзя изменить или удалить';
END;
$$;

CREATE TRIGGER production_plan_versions_immutable
  BEFORE UPDATE OR DELETE ON public.production_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.fn_reject_production_plan_version_mutation();

CREATE OR REPLACE FUNCTION public.fn_patch_production_plan_draft(
  p_plan_id uuid, p_key text, p_patch jsonb, p_expected_revision bigint, p_actor uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan public.production_month_plans%ROWTYPE; v_draft public.production_plan_drafts%ROWTYPE;
BEGIN
  IF p_key IS NULL OR length(p_key) > 180 OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Некорректное изменение плана';
  END IF;
  SELECT * INTO v_plan FROM public.production_month_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'План месяца не найден'; END IF;
  INSERT INTO public.production_plan_drafts(production_month_plan_id, base_version_number)
    VALUES (p_plan_id, v_plan.published_version_number)
    ON CONFLICT (production_month_plan_id) DO NOTHING;
  SELECT * INTO v_draft FROM public.production_plan_drafts
    WHERE production_month_plan_id = p_plan_id FOR UPDATE;
  IF v_draft.base_version_number <> v_plan.published_version_number THEN
    RAISE EXCEPTION 'План опубликован другим редактором. Обновите страницу.';
  END IF;
  IF v_draft.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Черновик изменён другим редактором. Обновите страницу.';
  END IF;
  UPDATE public.production_plan_drafts
    SET changes = jsonb_set(changes, ARRAY[p_key], p_patch, true),
        revision = revision + 1, updated_by = p_actor, updated_at = now()
    WHERE production_month_plan_id = p_plan_id
    RETURNING revision INTO v_draft.revision;
  RETURN v_draft.revision;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_patch_production_plan_draft(uuid, text, jsonb, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_patch_production_plan_draft(uuid, text, jsonb, bigint, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_validate_production_plan_month(p_factory_id uuid, p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage record;
BEGIN
  FOR v_stage IN
    SELECT m.name AS machine_name, s.stage_type, s.date_start, s.date_end,
      max(s.date_start) OVER (
        PARTITION BY m.id ORDER BY CASE s.stage_type::text
          WHEN 'cutting' THEN 1 WHEN 'assembly' THEN 2 WHEN 'cleaning' THEN 3
          WHEN 'galvanizing' THEN 4 WHEN 'post_galvanizing_cleaning' THEN 5
          WHEN 'painting' THEN 6 WHEN 'packaging' THEN 7 WHEN 'shipping' THEN 8
          ELSE 9 END
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS previous_start
    FROM public.machines m
    JOIN public.production_stages s ON s.machine_id = m.id
    WHERE m.factory_id = p_factory_id AND m.production_month = p_month
      AND m.is_archived = false AND s.is_skipped = false
  LOOP
    IF v_stage.date_start IS NOT NULL AND v_stage.date_end IS NOT NULL
      AND v_stage.date_end < v_stage.date_start THEN
      RAISE EXCEPTION 'Машина %, этап %: окончание раньше начала',
        v_stage.machine_name, v_stage.stage_type;
    END IF;
    IF v_stage.date_start IS NOT NULL AND v_stage.previous_start IS NOT NULL
      AND v_stage.date_start < v_stage.previous_start THEN
      RAISE EXCEPTION 'Машина %, этап %: начало раньше предыдущего этапа',
        v_stage.machine_name, v_stage.stage_type;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_production_plan_month(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_validate_production_plan_month(uuid, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_publish_production_plan_draft(
  p_plan_id uuid, p_expected_revision bigint, p_actor uuid, p_allowed_factory_id uuid
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.production_month_plans%ROWTYPE;
  v_draft public.production_plan_drafts%ROWTYPE;
  v_entry record;
  v_patch jsonb;
  v_fields jsonb;
  v_target text;
  v_id uuid;
  v_field text;
  v_machine public.machines%ROWTYPE;
  v_stage public.production_stages%ROWTYPE;
  v_operation public.machine_outsourcing_operations%ROWTYPE;
  v_factory uuid;
  v_month date;
  v_affected text[] := ARRAY[]::text[];
  v_key text;
  v_other public.production_month_plans%ROWTYPE;
  v_result integer;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не определён редактор плана'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  SELECT * INTO v_plan FROM public.production_month_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'План месяца не найден'; END IF;
  SELECT * INTO v_draft FROM public.production_plan_drafts
    WHERE production_month_plan_id = p_plan_id FOR UPDATE;
  IF NOT FOUND OR v_draft.changes = '{}'::jsonb THEN RAISE EXCEPTION 'В черновике нет изменений'; END IF;
  IF v_draft.revision <> p_expected_revision OR
     v_draft.base_version_number <> v_plan.published_version_number THEN
    RAISE EXCEPTION 'Черновик изменён или уже опубликован. Обновите страницу.';
  END IF;

  v_affected := ARRAY[v_plan.factory_id::text || '|' || v_plan.production_month::text];
  SET CONSTRAINTS production_stage_intervals_sync_parent DEFERRED;

  FOR v_entry IN
    SELECT key, value FROM jsonb_each(v_draft.changes)
    ORDER BY CASE value ->> 'target'
      WHEN 'interval' THEN 1 WHEN 'stage' THEN 2
      WHEN 'outsourcing' THEN 3 WHEN 'machine' THEN 4 ELSE 5 END, key
  LOOP
    v_patch := v_entry.value;
    v_target := v_patch ->> 'target';
    v_id := (v_patch ->> 'id')::uuid;
    v_fields := v_patch -> 'fields';
    IF v_id IS NULL OR jsonb_typeof(v_fields) <> 'object' THEN
      RAISE EXCEPTION 'Некорректный элемент черновика: %', v_entry.key;
    END IF;

    IF v_target = 'machine' THEN
      SELECT * INTO v_machine FROM public.machines WHERE id = v_id FOR UPDATE;
      IF NOT FOUND OR v_machine.is_archived THEN RAISE EXCEPTION 'Машина удалена или архивирована: %', v_id; END IF;
      IF v_machine.factory_id IS NOT NULL AND v_machine.production_month IS NOT NULL THEN
        v_key := v_machine.factory_id::text || '|' || v_machine.production_month::text;
        IF NOT v_key = ANY(v_affected) THEN v_affected := array_append(v_affected, v_key); END IF;
      END IF;
      IF NOT (v_machine.factory_id = v_plan.factory_id AND v_machine.production_month = v_plan.production_month)
         AND NOT (v_fields ->> 'factory_id' = v_plan.factory_id::text
           AND v_fields ->> 'production_month' = v_plan.production_month::text) THEN
        RAISE EXCEPTION 'Машина не принадлежит изменяемому плану';
      END IF;
      FOR v_field IN SELECT jsonb_object_keys(v_fields) LOOP
        IF v_field NOT IN ('factory_id', 'production_month', 'production_workshop',
                           'production_queue_number', 'planned_material_date') THEN
          RAISE EXCEPTION 'Недопустимое поле машины: %', v_field;
        END IF;
      END LOOP;
      IF v_fields ? 'production_queue_number'
         AND v_machine.factory_id IS NOT NULL AND v_machine.production_month IS NOT NULL
         AND v_machine.production_workshop IS NOT NULL AND v_machine.production_queue_number IS NOT NULL
         AND COALESCE((v_fields ->> 'production_month')::date, v_machine.production_month) = v_machine.production_month
         AND COALESCE((v_fields ->> 'factory_id')::uuid, v_machine.factory_id) IS NOT NULL
         AND COALESCE((v_fields ->> 'production_workshop')::smallint, v_machine.production_workshop) IS NOT NULL
         AND (v_fields ->> 'production_queue_number') IS NOT NULL THEN
        PERFORM public.reorder_machine_production_queue(
          v_id,
          COALESCE((v_fields ->> 'factory_id')::uuid, v_machine.factory_id),
          COALESCE((v_fields ->> 'production_workshop')::smallint, v_machine.production_workshop),
          (v_fields ->> 'production_queue_number')::integer,
          p_actor
        );
        v_fields := v_fields - 'factory_id' - 'production_workshop' - 'production_queue_number';
      END IF;
      UPDATE public.machines SET
        factory_id = CASE WHEN v_fields ? 'factory_id' THEN (v_fields ->> 'factory_id')::uuid ELSE factory_id END,
        production_month = CASE WHEN v_fields ? 'production_month' THEN (v_fields ->> 'production_month')::date ELSE production_month END,
        production_workshop = CASE WHEN v_fields ? 'production_workshop' THEN (v_fields ->> 'production_workshop')::smallint ELSE production_workshop END,
        production_queue_number = CASE WHEN v_fields ? 'production_queue_number' THEN (v_fields ->> 'production_queue_number')::integer ELSE production_queue_number END,
        planned_material_date = CASE WHEN v_fields ? 'planned_material_date' THEN (v_fields ->> 'planned_material_date')::date ELSE planned_material_date END
      WHERE id = v_id;
      UPDATE public.machines SET status = CASE
        WHEN actual_shipping_date IS NOT NULL THEN 'shipped'::public.machine_status
        WHEN actual_material_date IS NOT NULL THEN 'material_received'::public.machine_status
        WHEN factory_id IS NOT NULL AND material_type::text <> 'undefined'
          AND planned_material_date IS NOT NULL THEN 'planned'::public.machine_status
        WHEN is_confirmed THEN 'confirmed'::public.machine_status
        ELSE 'created'::public.machine_status END
      WHERE id = v_id AND status::text IN ('in_production', 'planned');
      SELECT factory_id, production_month INTO v_factory, v_month FROM public.machines WHERE id = v_id;
      IF v_factory IS NOT NULL AND v_month IS NOT NULL THEN
        v_key := v_factory::text || '|' || v_month::text;
        IF NOT v_key = ANY(v_affected) THEN v_affected := array_append(v_affected, v_key); END IF;
      END IF;
    ELSIF v_target = 'stage' OR v_target = 'interval' THEN
      SELECT s.* INTO v_stage FROM public.production_stages s
        JOIN public.machines m ON m.id = s.machine_id
        WHERE s.id = (v_patch ->> 'stage_id')::uuid
          AND (
            (m.factory_id = v_plan.factory_id AND m.production_month = v_plan.production_month)
            OR (
              (v_draft.changes -> ('machine:' || m.id::text) -> 'fields' ->> 'factory_id')::uuid = v_plan.factory_id
              AND (v_draft.changes -> ('machine:' || m.id::text) -> 'fields' ->> 'production_month')::date = v_plan.production_month
            )
          )
          AND m.is_archived = false FOR UPDATE OF s;
      IF NOT FOUND THEN RAISE EXCEPTION 'Этап не принадлежит изменяемому плану'; END IF;
      IF v_stage.stage_type::text = 'actual_shipping' THEN
        RAISE EXCEPTION 'Факт отгрузки не входит в версии плана';
      END IF;
      IF v_stage.stage_type::text = 'cutting' AND v_fields ? 'date_start' AND EXISTS (
        SELECT 1 FROM public.production_fact_cutting_events e
        WHERE e.stage_id = v_stage.id AND e.status = 'applied'
          AND e.previous_stage_date_start IS NULL
          AND e.applied_stage_date_start = v_stage.date_start
      ) THEN
        RAISE EXCEPTION 'Начало заготовки уже задано фактом производства; план не может его перезаписать';
      END IF;
      IF v_target = 'stage' THEN
        IF v_id <> v_stage.id THEN RAISE EXCEPTION 'Некорректный идентификатор этапа'; END IF;
        FOR v_field IN SELECT jsonb_object_keys(v_fields) LOOP
          IF v_field NOT IN ('date_start', 'date_end', 'workshop', 'is_skipped',
                             'is_night_shift', 'night_shift_date', 'night_shift_dates') THEN
            RAISE EXCEPTION 'Недопустимое поле этапа: %', v_field;
          END IF;
        END LOOP;
        UPDATE public.production_stages SET
          date_start = CASE WHEN v_fields ? 'date_start' THEN (v_fields ->> 'date_start')::date ELSE date_start END,
          date_end = CASE WHEN v_fields ? 'date_end' THEN (v_fields ->> 'date_end')::date ELSE date_end END,
          workshop = CASE WHEN v_fields ? 'workshop' THEN (v_fields ->> 'workshop')::smallint ELSE workshop END,
          is_skipped = CASE WHEN v_fields ? 'is_skipped' THEN (v_fields ->> 'is_skipped')::boolean ELSE is_skipped END,
          is_night_shift = CASE WHEN v_fields ? 'is_night_shift' THEN (v_fields ->> 'is_night_shift')::boolean ELSE is_night_shift END,
          night_shift_date = CASE WHEN v_fields ? 'night_shift_date' THEN (v_fields ->> 'night_shift_date')::date ELSE night_shift_date END,
          night_shift_dates = CASE WHEN v_fields ? 'night_shift_dates' THEN
            ARRAY(SELECT value::date FROM jsonb_array_elements_text(v_fields -> 'night_shift_dates') value)
            ELSE night_shift_dates END
        WHERE id = v_id;
        IF v_stage.stage_type::text = 'galvanizing'
          AND (v_fields ? 'date_start' OR v_fields ? 'date_end') THEN
          UPDATE public.machine_outsourcing_operations o SET
            planned_send_date = s.date_start,
            planned_return_date = s.date_end,
            updated_by = p_actor, updated_at = now()
          FROM public.production_stages s
          WHERE s.id = v_id AND o.machine_id = s.machine_id
            AND o.is_zinc_operation = true AND o.archived_at IS NULL;
        END IF;
      ELSE
        FOR v_field IN SELECT jsonb_object_keys(v_fields) LOOP
          IF v_field NOT IN ('operation', 'date_start', 'date_end', 'workshop') THEN
            RAISE EXCEPTION 'Недопустимое поле подхода: %', v_field;
          END IF;
        END LOOP;
        PERFORM public.fn_mutate_production_stage_interval(
          v_fields ->> 'operation', v_stage.id, v_id,
          (v_fields ->> 'date_start')::date, (v_fields ->> 'date_end')::date,
          (v_fields ->> 'workshop')::smallint, p_actor
        );
      END IF;
    ELSIF v_target = 'outsourcing' THEN
      SELECT o.* INTO v_operation FROM public.machine_outsourcing_operations o
        LEFT JOIN public.machines m ON m.id = o.machine_id
        WHERE o.id = v_id AND o.archived_at IS NULL
          AND ((m.factory_id = v_plan.factory_id AND m.production_month = v_plan.production_month)
            OR ((v_draft.changes -> ('machine:' || m.id::text) -> 'fields' ->> 'factory_id')::uuid = v_plan.factory_id
              AND (v_draft.changes -> ('machine:' || m.id::text) -> 'fields' ->> 'production_month')::date = v_plan.production_month)
            OR (o.executor_factory_id = v_plan.factory_id AND o.incoming_production_month = v_plan.production_month)
            OR (o.executor_factory_id = v_plan.factory_id
              AND v_fields ->> 'incoming_production_month' = v_plan.production_month::text))
        FOR UPDATE OF o;
      IF NOT FOUND THEN RAISE EXCEPTION 'Аутсорсинг не принадлежит изменяемому плану'; END IF;
      IF v_operation.executor_factory_id IS NOT NULL AND v_operation.incoming_production_month IS NOT NULL THEN
        v_key := v_operation.executor_factory_id::text || '|' || v_operation.incoming_production_month::text;
        IF NOT v_key = ANY(v_affected) THEN v_affected := array_append(v_affected, v_key); END IF;
      END IF;
      FOR v_field IN SELECT jsonb_object_keys(v_fields) LOOP
        IF v_field NOT IN ('planned_send_date', 'planned_return_date', 'incoming_date_start',
                           'incoming_date_end', 'incoming_production_month',
                           'incoming_workshop', 'incoming_queue_number') THEN
          RAISE EXCEPTION 'Недопустимое поле аутсорсинга: %', v_field;
        END IF;
      END LOOP;
      UPDATE public.machine_outsourcing_operations SET
        planned_send_date = CASE WHEN v_fields ? 'planned_send_date' THEN (v_fields ->> 'planned_send_date')::date ELSE planned_send_date END,
        planned_return_date = CASE WHEN v_fields ? 'planned_return_date' THEN (v_fields ->> 'planned_return_date')::date ELSE planned_return_date END,
        incoming_production_month = CASE WHEN v_fields ? 'incoming_production_month' THEN (v_fields ->> 'incoming_production_month')::date ELSE incoming_production_month END,
        incoming_date_start = CASE WHEN v_fields ? 'incoming_date_start' THEN (v_fields ->> 'incoming_date_start')::date ELSE incoming_date_start END,
        incoming_date_end = CASE WHEN v_fields ? 'incoming_date_end' THEN (v_fields ->> 'incoming_date_end')::date ELSE incoming_date_end END,
        incoming_workshop = CASE WHEN v_fields ? 'incoming_workshop' THEN (v_fields ->> 'incoming_workshop')::integer ELSE incoming_workshop END,
        incoming_queue_number = CASE WHEN v_fields ? 'incoming_queue_number' THEN (v_fields ->> 'incoming_queue_number')::integer ELSE incoming_queue_number END
      WHERE id = v_id;
      SELECT executor_factory_id, incoming_production_month INTO v_factory, v_month
        FROM public.machine_outsourcing_operations WHERE id = v_id;
      IF v_factory IS NOT NULL AND v_month IS NOT NULL THEN
        v_key := v_factory::text || '|' || v_month::text;
        IF NOT v_key = ANY(v_affected) THEN v_affected := array_append(v_affected, v_key); END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'Неизвестный тип изменения плана: %', v_target;
    END IF;
  END LOOP;

  FOR v_key IN SELECT unnest(v_affected) ORDER BY 1 LOOP
    v_factory := split_part(v_key, '|', 1)::uuid;
    v_month := split_part(v_key, '|', 2)::date;
    IF p_allowed_factory_id IS NOT NULL AND v_factory <> p_allowed_factory_id THEN
      RAISE EXCEPTION 'Недостаточно прав для затронутого завода';
    END IF;
    INSERT INTO public.production_month_plans(factory_id, production_month, status)
      VALUES (v_factory, v_month, 'draft')
      ON CONFLICT (factory_id, production_month) DO NOTHING;
    SELECT * INTO v_other FROM public.production_month_plans
      WHERE factory_id = v_factory AND production_month = v_month FOR UPDATE;
    IF v_other.id <> p_plan_id AND EXISTS (
      SELECT 1 FROM public.production_plan_drafts d
      WHERE d.production_month_plan_id = v_other.id AND d.changes <> '{}'::jsonb
    ) THEN
      RAISE EXCEPTION 'В затронутом месяце есть другой черновик. Сначала опубликуйте его.';
    END IF;
    WITH ranked AS (
      SELECT id, row_number() OVER (
        PARTITION BY production_workshop
        ORDER BY production_queue_number NULLS LAST, created_at, id
      )::integer AS next_queue
      FROM public.machines
      WHERE factory_id = v_factory AND production_month = v_month
        AND production_workshop IS NOT NULL AND is_archived = false
    )
    UPDATE public.machines m SET production_queue_number = ranked.next_queue
    FROM ranked WHERE m.id = ranked.id
      AND m.production_queue_number IS DISTINCT FROM ranked.next_queue;
    PERFORM public.fn_validate_production_plan_month(v_factory, v_month);
    v_result := public.fn_record_production_plan_version(v_other.id, 'publish', p_actor);
  END LOOP;
  DELETE FROM public.production_plan_drafts WHERE production_month_plan_id = p_plan_id;
  SELECT published_version_number INTO v_result
    FROM public.production_month_plans WHERE id = p_plan_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_publish_production_plan_draft(uuid, bigint, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_publish_production_plan_draft(uuid, bigint, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_restore_production_plan_version(
  p_plan_id uuid, p_version_id uuid, p_expected_version integer, p_actor uuid,
  p_allowed_factory_id uuid
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan public.production_month_plans%ROWTYPE;
  v_version public.production_plan_versions%ROWTYPE;
  v_machine jsonb;
  v_stage jsonb;
  v_interval jsonb;
  v_operation jsonb;
  v_machine_id uuid;
  v_stage_id uuid;
  v_affected text[] := ARRAY[]::text[];
  v_key text;
  v_factory uuid;
  v_month date;
  v_other public.production_month_plans%ROWTYPE;
  v_result integer;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не определён редактор плана'; END IF;
  PERFORM set_config('request.jwt.claim.sub', p_actor::text, true);
  SELECT * INTO v_plan FROM public.production_month_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'План месяца не найден'; END IF;
  IF v_plan.published_version_number <> p_expected_version THEN
    RAISE EXCEPTION 'План изменён. Обновите страницу перед восстановлением.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_plan_drafts d
      WHERE d.production_month_plan_id = p_plan_id AND d.changes <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Сначала опубликуйте или очистите общий черновик';
  END IF;
  SELECT * INTO v_version FROM public.production_plan_versions
    WHERE id = p_version_id AND production_month_plan_id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Выбранная версия не найдена'; END IF;

  v_affected := ARRAY[v_plan.factory_id::text || '|' || v_plan.production_month::text];
  FOR v_machine IN SELECT value FROM jsonb_array_elements(v_version.snapshot -> 'machines') LOOP
    v_machine_id := (v_machine ->> 'id')::uuid;
    PERFORM 1 FROM public.machines WHERE id = v_machine_id AND is_archived = false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Машина % удалена или архивирована; восстановление остановлено', v_machine_id; END IF;
    SELECT factory_id, production_month INTO v_factory, v_month
      FROM public.machines WHERE id = v_machine_id;
    IF v_factory IS NOT NULL AND v_month IS NOT NULL THEN
      v_key := v_factory::text || '|' || v_month::text;
      IF NOT v_key = ANY(v_affected) THEN v_affected := array_append(v_affected, v_key); END IF;
    END IF;
    FOR v_stage IN SELECT value FROM jsonb_array_elements(v_machine -> 'stages') LOOP
      v_stage_id := (v_stage ->> 'id')::uuid;
      PERFORM 1 FROM public.production_stages
        WHERE id = v_stage_id AND machine_id = v_machine_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Этап машины % удалён; восстановление остановлено', v_machine_id; END IF;
    END LOOP;
    FOR v_operation IN SELECT value FROM jsonb_array_elements(v_machine -> 'outsourcing') LOOP
      PERFORM 1 FROM public.machine_outsourcing_operations
        WHERE id = (v_operation ->> 'id')::uuid AND machine_id = v_machine_id
          AND archived_at IS NULL FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Операция аутсорсинга машины % удалена', v_machine_id; END IF;
    END LOOP;
  END LOOP;
  FOR v_operation IN SELECT value FROM jsonb_array_elements(v_version.snapshot -> 'incoming') LOOP
    SELECT executor_factory_id, incoming_production_month INTO v_factory, v_month
      FROM public.machine_outsourcing_operations
      WHERE id = (v_operation ->> 'id')::uuid AND archived_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Входящий аутсорсинг удалён; восстановление остановлено'; END IF;
    IF v_factory IS NOT NULL AND v_month IS NOT NULL THEN
      v_key := v_factory::text || '|' || v_month::text;
      IF NOT v_key = ANY(v_affected) THEN v_affected := array_append(v_affected, v_key); END IF;
    END IF;
  END LOOP;

  -- Lock every affected month and reject pending work before the first write.
  FOR v_key IN SELECT unnest(v_affected) ORDER BY 1 LOOP
    IF p_allowed_factory_id IS NOT NULL
      AND split_part(v_key, '|', 1)::uuid <> p_allowed_factory_id THEN
      RAISE EXCEPTION 'Недостаточно прав для затронутого завода';
    END IF;
    SELECT * INTO v_other FROM public.production_month_plans
      WHERE factory_id = split_part(v_key, '|', 1)::uuid
        AND production_month = split_part(v_key, '|', 2)::date FOR UPDATE;
    IF v_other.id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.production_plan_drafts d
      WHERE d.production_month_plan_id = v_other.id AND d.changes <> '{}'::jsonb
    ) THEN RAISE EXCEPTION 'В затронутом месяце есть неопубликованный черновик'; END IF;
  END LOOP;

  SET CONSTRAINTS production_stage_intervals_sync_parent DEFERRED;
  UPDATE public.machines m
    SET production_month = NULL, production_workshop = NULL, production_queue_number = NULL
    WHERE m.factory_id = v_plan.factory_id AND m.production_month = v_plan.production_month
      AND m.is_archived = false
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_version.snapshot -> 'machines') item
        WHERE (item ->> 'id')::uuid = m.id
      );

  UPDATE public.machine_outsourcing_operations o SET
    incoming_production_month = NULL,
    incoming_date_start = NULL,
    incoming_date_end = NULL,
    incoming_workshop = NULL,
    incoming_queue_number = NULL,
    updated_by = p_actor, updated_at = now()
  WHERE o.executor_factory_id = v_plan.factory_id
    AND o.incoming_production_month = v_plan.production_month
    AND o.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_version.snapshot -> 'incoming') item
      WHERE (item ->> 'id')::uuid = o.id
    );

  FOR v_machine IN SELECT value FROM jsonb_array_elements(v_version.snapshot -> 'machines') LOOP
    v_machine_id := (v_machine ->> 'id')::uuid;
    UPDATE public.machines SET
      factory_id = (v_machine ->> 'factory_id')::uuid,
      production_month = (v_machine ->> 'production_month')::date,
      production_workshop = (v_machine ->> 'production_workshop')::smallint,
      production_queue_number = (v_machine ->> 'production_queue_number')::integer,
      planned_material_date = (v_machine ->> 'planned_material_date')::date
    WHERE id = v_machine_id;
    UPDATE public.machines SET status = CASE
      WHEN actual_shipping_date IS NOT NULL THEN 'shipped'::public.machine_status
      WHEN actual_material_date IS NOT NULL THEN 'material_received'::public.machine_status
      WHEN factory_id IS NOT NULL AND material_type::text <> 'undefined'
        AND planned_material_date IS NOT NULL THEN 'planned'::public.machine_status
      WHEN is_confirmed THEN 'confirmed'::public.machine_status
      ELSE 'created'::public.machine_status END
    WHERE id = v_machine_id AND status::text IN ('in_production', 'planned');

    PERFORM 1 FROM public.production_stages s
      WHERE s.machine_id = v_machine_id
        AND s.stage_type::text IN ('cutting', 'shipping')
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_machine -> 'stages') item
          WHERE (item ->> 'id')::uuid = s.id
        );
    IF FOUND THEN
      RAISE EXCEPTION 'Обязательный этап машины % появился после выбранной версии; восстановление остановлено',
        v_machine ->> 'name';
    END IF;
    DELETE FROM public.production_stage_intervals i
      USING public.production_stages s
      WHERE i.production_stage_id = s.id AND s.machine_id = v_machine_id
        AND s.stage_type::text <> 'actual_shipping'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_machine -> 'stages') item
          WHERE (item ->> 'id')::uuid = s.id
        );
    UPDATE public.production_stages s SET
      date_start = NULL, date_end = NULL, is_skipped = true,
      is_night_shift = false, night_shift_date = NULL, night_shift_dates = ARRAY[]::date[]
    WHERE s.machine_id = v_machine_id AND s.stage_type::text <> 'actual_shipping'
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_machine -> 'stages') item
        WHERE (item ->> 'id')::uuid = s.id
      );
    UPDATE public.machine_outsourcing_operations o SET
      planned_send_date = NULL, planned_return_date = NULL,
      updated_by = p_actor, updated_at = now()
    WHERE o.machine_id = v_machine_id AND o.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_machine -> 'outsourcing') item
        WHERE (item ->> 'id')::uuid = o.id
      );

    FOR v_stage IN SELECT value FROM jsonb_array_elements(v_machine -> 'stages') LOOP
      v_stage_id := (v_stage ->> 'id')::uuid;
      UPDATE public.production_stages SET
        workshop = (v_stage ->> 'workshop')::smallint,
        date_start = CASE WHEN stage_type::text = 'cutting' AND EXISTS (
          SELECT 1 FROM public.production_fact_cutting_events e
          WHERE e.stage_id = v_stage_id AND e.status = 'applied'
            AND e.previous_stage_date_start IS NULL
            AND e.applied_stage_date_start = date_start
        ) THEN date_start ELSE (v_stage ->> 'date_start')::date END,
        date_end = (v_stage ->> 'date_end')::date,
        is_skipped = (v_stage ->> 'is_skipped')::boolean,
        is_night_shift = (v_stage ->> 'is_night_shift')::boolean,
        night_shift_date = (v_stage ->> 'night_shift_date')::date,
        night_shift_dates = ARRAY(SELECT value::date
          FROM jsonb_array_elements_text(COALESCE(v_stage -> 'night_shift_dates', '[]'::jsonb)) value)
      WHERE id = v_stage_id;

      UPDATE public.production_stage_intervals SET position = position + 100000
        WHERE production_stage_id = v_stage_id;
      DELETE FROM public.production_stage_intervals i
        WHERE i.production_stage_id = v_stage_id
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(v_stage -> 'intervals') item
            WHERE (item ->> 'id')::uuid = i.id
          );
      FOR v_interval IN SELECT value FROM jsonb_array_elements(v_stage -> 'intervals') LOOP
        INSERT INTO public.production_stage_intervals(
          id, production_stage_id, position, date_start, date_end, workshop, updated_by
        ) VALUES (
          (v_interval ->> 'id')::uuid, v_stage_id, (v_interval ->> 'position')::integer,
          (v_interval ->> 'date_start')::date, (v_interval ->> 'date_end')::date,
          (v_interval ->> 'workshop')::smallint, p_actor
        ) ON CONFLICT (id) DO UPDATE SET
          position = EXCLUDED.position, date_start = EXCLUDED.date_start,
          date_end = EXCLUDED.date_end, workshop = EXCLUDED.workshop,
          updated_at = now(), updated_by = p_actor;
      END LOOP;
    END LOOP;

    FOR v_operation IN SELECT value FROM jsonb_array_elements(v_machine -> 'outsourcing') LOOP
      UPDATE public.machine_outsourcing_operations SET
        planned_send_date = (v_operation ->> 'planned_send_date')::date,
        planned_return_date = (v_operation ->> 'planned_return_date')::date,
        updated_by = p_actor, updated_at = now()
      WHERE id = (v_operation ->> 'id')::uuid;
    END LOOP;
  END LOOP;

  FOR v_operation IN SELECT value FROM jsonb_array_elements(v_version.snapshot -> 'incoming') LOOP
    UPDATE public.machine_outsourcing_operations SET
      incoming_production_month = (v_operation ->> 'incoming_production_month')::date,
      incoming_date_start = (v_operation ->> 'incoming_date_start')::date,
      incoming_date_end = (v_operation ->> 'incoming_date_end')::date,
      incoming_workshop = (v_operation ->> 'incoming_workshop')::integer,
      incoming_queue_number = (v_operation ->> 'incoming_queue_number')::integer,
      updated_by = p_actor, updated_at = now()
    WHERE id = (v_operation ->> 'id')::uuid;
  END LOOP;

  FOR v_key IN SELECT unnest(v_affected) ORDER BY 1 LOOP
    v_factory := split_part(v_key, '|', 1)::uuid;
    v_month := split_part(v_key, '|', 2)::date;
    INSERT INTO public.production_month_plans(factory_id, production_month, status)
      VALUES (v_factory, v_month, 'draft')
      ON CONFLICT (factory_id, production_month) DO NOTHING;
    SELECT * INTO v_other FROM public.production_month_plans
      WHERE factory_id = v_factory AND production_month = v_month FOR UPDATE;
    PERFORM public.fn_validate_production_plan_month(v_factory, v_month);
    v_result := public.fn_record_production_plan_version(v_other.id, 'restore', p_actor,
      CASE WHEN v_other.id = p_plan_id THEN p_version_id ELSE NULL END);
  END LOOP;
  SELECT published_version_number INTO v_result
    FROM public.production_month_plans WHERE id = p_plan_id;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_restore_production_plan_version(uuid, uuid, integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_restore_production_plan_version(uuid, uuid, integer, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_set_production_plan_version_status(
  p_plan_id uuid, p_status public.production_month_plan_status, p_actor uuid
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan public.production_month_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_plan FROM public.production_month_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'План месяца не найден'; END IF;
  IF EXISTS (SELECT 1 FROM public.production_plan_drafts d
      WHERE d.production_month_plan_id = p_plan_id AND d.changes <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'Сначала опубликуйте общий черновик кнопкой «Обновить»';
  END IF;
  IF v_plan.status = p_status THEN RETURN v_plan.published_version_number; END IF;
  IF v_plan.status = 'confirmed' OR p_status = 'draft' THEN
    RAISE EXCEPTION 'Недопустимый переход статуса плана';
  END IF;
  UPDATE public.production_month_plans SET
    status = p_status,
    preliminary_ready_at = COALESCE(preliminary_ready_at, now()),
    preliminary_ready_by = COALESCE(preliminary_ready_by, p_actor),
    confirmed_at = CASE WHEN p_status = 'confirmed' THEN now() ELSE confirmed_at END,
    confirmed_by = CASE WHEN p_status = 'confirmed' THEN p_actor ELSE confirmed_by END
  WHERE id = p_plan_id;
  RETURN public.fn_record_production_plan_version(p_plan_id, 'status', p_actor);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_production_plan_version_status(uuid, public.production_month_plan_status, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_set_production_plan_version_status(uuid, public.production_month_plan_status, uuid)
  TO service_role;

-- Pending approvals created before this release still use their existing conflict checks.
-- Wrap the former apply function so approval and its published version commit together.
ALTER FUNCTION public.fn_apply_production_plan_date_change_items(uuid, uuid, text)
  RENAME TO fn_apply_production_plan_date_change_items_legacy;

CREATE OR REPLACE FUNCTION public.fn_apply_production_plan_date_change_items(
  p_request_id uuid, p_updated_by uuid DEFAULT NULL, p_decision_comment text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan_id uuid; v_machine_id uuid;
BEGIN
  SELECT production_month_plan_id, machine_id INTO v_plan_id, v_machine_id
  FROM public.production_plan_date_change_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Запрос не найден или уже обработан'; END IF;
  PERFORM 1 FROM public.production_month_plans WHERE id = v_plan_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.production_plan_drafts d
      WHERE d.production_month_plan_id = v_plan_id AND d.changes <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'В месяце есть общий черновик. Сначала опубликуйте его.';
  END IF;
  PERFORM public.fn_apply_production_plan_date_change_items_legacy(
    p_request_id, p_updated_by, p_decision_comment);
  UPDATE public.machine_outsourcing_operations o SET
    planned_send_date = s.date_start,
    planned_return_date = s.date_end,
    updated_by = p_updated_by, updated_at = now()
  FROM public.production_stages s
  WHERE s.machine_id = v_machine_id AND s.stage_type::text = 'galvanizing'
    AND o.machine_id = v_machine_id AND o.is_zinc_operation = true
    AND o.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.production_plan_date_change_request_items i
      WHERE i.request_id = p_request_id AND i.stage_type::text = 'galvanizing'
    );
  PERFORM public.fn_record_production_plan_version(v_plan_id, 'publish', p_updated_by);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_apply_production_plan_date_change_items(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_production_plan_date_change_items(uuid, uuid, text)
  TO service_role;
