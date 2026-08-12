-- Additive calendar intervals for production stages that may be planned in several approaches.

CREATE TABLE IF NOT EXISTS public.production_stage_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_stage_id uuid NOT NULL REFERENCES public.production_stages(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position > 0),
  date_start date,
  date_end date,
  workshop smallint CHECK (workshop IN (1, 2)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT production_stage_intervals_dates_check
    CHECK (date_start IS NULL OR date_end IS NULL OR date_end >= date_start),
  CONSTRAINT production_stage_intervals_stage_position_key
    UNIQUE (production_stage_id, position)
);

CREATE INDEX IF NOT EXISTS idx_production_stage_intervals_stage
  ON public.production_stage_intervals(production_stage_id, position);

ALTER TABLE public.production_stage_intervals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_stage_intervals_select ON public.production_stage_intervals;
CREATE POLICY production_stage_intervals_select
  ON public.production_stage_intervals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.production_stages ps
      JOIN public.machines m ON m.id = ps.machine_id
      WHERE ps.id = production_stage_intervals.production_stage_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE true
          END
        )
    )
  );

DROP POLICY IF EXISTS production_stage_intervals_service_role_all ON public.production_stage_intervals;
CREATE POLICY production_stage_intervals_service_role_all
  ON public.production_stage_intervals
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.production_stage_intervals TO authenticated;
GRANT ALL ON public.production_stage_intervals TO service_role;

COMMENT ON TABLE public.production_stage_intervals IS
  'Calendar approaches of a single production business stage. Facts and progress remain on production_stages.';

-- Existing single ranges become approach 1. ON CONFLICT keeps the migration idempotent.
INSERT INTO public.production_stage_intervals (
  production_stage_id,
  position,
  date_start,
  date_end,
  workshop,
  updated_at
)
SELECT
  ps.id,
  1,
  ps.date_start,
  ps.date_end,
  CASE WHEN ps.stage_type::text = 'assembly' THEN ps.workshop ELSE NULL END,
  COALESCE(ps.updated_at, now())
FROM public.production_stages ps
WHERE ps.stage_type::text IN ('cutting', 'assembly', 'cleaning', 'painting')
  AND (ps.date_start IS NOT NULL OR ps.date_end IS NOT NULL)
ON CONFLICT (production_stage_id, position) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_validate_and_sync_production_stage_intervals(p_stage_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage public.production_stages%ROWTYPE;
  v_bad record;
  v_start date;
  v_end date;
  v_workshop smallint;
  v_neighbour record;
  v_stage_order text[] := ARRAY[
    'cutting', 'assembly', 'cleaning', 'galvanizing', 'post_galvanizing_cleaning',
    'painting', 'packaging', 'shipping', 'actual_shipping'
  ];
BEGIN
  SELECT * INTO v_stage
  FROM public.production_stages
  WHERE id = p_stage_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_stage.stage_type::text NOT IN ('cutting', 'assembly', 'cleaning', 'painting') THEN
    RAISE EXCEPTION 'Этап «%» нельзя делить на подходы', v_stage.stage_type;
  END IF;

  SELECT current_interval.* INTO v_bad
  FROM public.production_stage_intervals current_interval
  JOIN public.production_stage_intervals previous_interval
    ON previous_interval.production_stage_id = current_interval.production_stage_id
   AND previous_interval.position < current_interval.position
  WHERE current_interval.production_stage_id = p_stage_id
    AND current_interval.date_start IS NOT NULL
    AND previous_interval.date_end IS NOT NULL
    AND current_interval.date_start <= previous_interval.date_end
  ORDER BY current_interval.position, previous_interval.position DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Подходы этапа пересекаются или идут в неверном порядке (подход %)', v_bad.position;
  END IF;

  IF v_stage.stage_type::text = 'assembly' AND EXISTS (
    SELECT 1
    FROM public.production_stage_intervals i
    WHERE i.production_stage_id = p_stage_id
      AND i.workshop IS NULL
      AND (i.date_start IS NOT NULL OR i.date_end IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Для запланированного подхода сборки/сварки нужно выбрать цех';
  END IF;

  IF v_stage.stage_type::text = 'painting' AND EXISTS (
    SELECT 1
    FROM unnest(COALESCE(v_stage.night_shift_dates, '{}'::date[])) night_date
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.production_stage_intervals i
      WHERE i.production_stage_id = p_stage_id
        AND i.date_start IS NOT NULL
        AND i.date_end IS NOT NULL
        AND night_date BETWEEN i.date_start AND i.date_end
    )
  ) THEN
    RAISE EXCEPTION 'Дата ночной малярки должна попадать внутрь одного из подходов';
  END IF;

  SELECT min(date_start), max(date_end)
  INTO v_start, v_end
  FROM public.production_stage_intervals
  WHERE production_stage_id = p_stage_id;

  IF v_stage.stage_type::text = 'assembly' THEN
    SELECT CASE
      WHEN count(DISTINCT workshop) FILTER (WHERE workshop IS NOT NULL) = 1
       AND count(*) FILTER (WHERE workshop IS NULL AND (date_start IS NOT NULL OR date_end IS NOT NULL)) = 0
      THEN min(workshop)
      ELSE NULL
    END
    INTO v_workshop
    FROM public.production_stage_intervals
    WHERE production_stage_id = p_stage_id;
  ELSE
    v_workshop := v_stage.workshop;
  END IF;

  IF v_start IS NOT NULL AND NOT v_stage.is_skipped THEN
    SELECT ps.stage_type, COALESCE(ps.date_start, ps.date_end) AS date_start INTO v_neighbour
    FROM public.production_stages ps
    WHERE ps.machine_id = v_stage.machine_id
      AND NOT ps.is_skipped
      AND COALESCE(ps.date_start, ps.date_end) IS NOT NULL
      AND array_position(v_stage_order, ps.stage_type::text) < array_position(v_stage_order, v_stage.stage_type::text)
    ORDER BY array_position(v_stage_order, ps.stage_type::text) DESC
    LIMIT 1;
    IF FOUND AND v_start < v_neighbour.date_start THEN
      RAISE EXCEPTION 'Начало этапа не может быть раньше начала предыдущего этапа %', v_neighbour.stage_type;
    END IF;

    SELECT ps.stage_type, COALESCE(ps.date_start, ps.date_end) AS date_start INTO v_neighbour
    FROM public.production_stages ps
    WHERE ps.machine_id = v_stage.machine_id
      AND NOT ps.is_skipped
      AND COALESCE(ps.date_start, ps.date_end) IS NOT NULL
      AND array_position(v_stage_order, ps.stage_type::text) > array_position(v_stage_order, v_stage.stage_type::text)
    ORDER BY array_position(v_stage_order, ps.stage_type::text)
    LIMIT 1;
    IF FOUND AND v_start > v_neighbour.date_start THEN
      RAISE EXCEPTION 'Начало этапа не может быть позже начала следующего этапа %', v_neighbour.stage_type;
    END IF;
  END IF;

  PERFORM set_config('app.syncing_production_stage_intervals', '1', true);
  UPDATE public.production_stages
  SET date_start = v_start,
      date_end = v_end,
      workshop = v_workshop
  WHERE id = p_stage_id
    AND (date_start, date_end, workshop) IS DISTINCT FROM (v_start, v_end, v_workshop);
  PERFORM set_config('app.syncing_production_stage_intervals', '0', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_production_stage_intervals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_validate_and_sync_production_stage_intervals(COALESCE(NEW.production_stage_id, OLD.production_stage_id));
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_stage_intervals_sync_parent ON public.production_stage_intervals;
CREATE CONSTRAINT TRIGGER production_stage_intervals_sync_parent
  AFTER INSERT OR UPDATE OR DELETE ON public.production_stage_intervals
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_production_stage_intervals();

CREATE OR REPLACE FUNCTION public.trg_sync_single_interval_from_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF current_setting('app.syncing_production_stage_intervals', true) = '1'
     OR NEW.stage_type::text NOT IN ('cutting', 'assembly', 'cleaning', 'painting') THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.production_stage_intervals
  WHERE production_stage_id = NEW.id;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'У этапа несколько подходов. Измените даты в редакторе подходов.';
  ELSIF v_count = 1 THEN
    UPDATE public.production_stage_intervals
    SET date_start = NEW.date_start,
        date_end = NEW.date_end,
        workshop = CASE WHEN NEW.stage_type::text = 'assembly' THEN NEW.workshop ELSE NULL END,
        updated_at = now(),
        updated_by = NEW.updated_by
    WHERE production_stage_id = NEW.id;
  ELSIF NEW.date_start IS NOT NULL OR NEW.date_end IS NOT NULL THEN
    INSERT INTO public.production_stage_intervals (
      production_stage_id, position, date_start, date_end, workshop, updated_by
    ) VALUES (
      NEW.id, 1, NEW.date_start, NEW.date_end,
      CASE WHEN NEW.stage_type::text = 'assembly' THEN NEW.workshop ELSE NULL END,
      NEW.updated_by
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_stages_sync_single_interval ON public.production_stages;
CREATE TRIGGER production_stages_sync_single_interval
  AFTER UPDATE OF date_start, date_end, workshop ON public.production_stages
  FOR EACH ROW
  WHEN ((OLD.date_start, OLD.date_end, OLD.workshop) IS DISTINCT FROM (NEW.date_start, NEW.date_end, NEW.workshop))
  EXECUTE FUNCTION public.trg_sync_single_interval_from_parent();

CREATE OR REPLACE FUNCTION public.trg_validate_painting_night_dates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_type::text = 'painting' THEN
    PERFORM public.fn_validate_and_sync_production_stage_intervals(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_stages_validate_painting_night_dates ON public.production_stages;
CREATE TRIGGER production_stages_validate_painting_night_dates
  AFTER UPDATE OF night_shift_dates ON public.production_stages
  FOR EACH ROW
  WHEN (OLD.night_shift_dates IS DISTINCT FROM NEW.night_shift_dates)
  EXECUTE FUNCTION public.trg_validate_painting_night_dates();

CREATE OR REPLACE FUNCTION public.fn_mutate_production_stage_interval(
  p_operation text,
  p_stage_id uuid,
  p_interval_id uuid DEFAULT NULL,
  p_date_start date DEFAULT NULL,
  p_date_end date DEFAULT NULL,
  p_workshop smallint DEFAULT NULL,
  p_updated_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage_type text;
  v_interval_id uuid;
BEGIN
  SELECT stage_type::text INTO v_stage_type
  FROM public.production_stages
  WHERE id = p_stage_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Производственный этап не найден';
  END IF;
  IF v_stage_type NOT IN ('cutting', 'assembly', 'cleaning', 'painting') THEN
    RAISE EXCEPTION 'Этот этап нельзя делить на подходы';
  END IF;
  IF p_date_start IS NOT NULL AND p_date_end IS NOT NULL AND p_date_end < p_date_start THEN
    RAISE EXCEPTION 'Дата окончания подхода не может быть раньше даты начала';
  END IF;
  IF v_stage_type = 'assembly' AND (p_date_start IS NOT NULL OR p_date_end IS NOT NULL)
     AND p_workshop NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Для сборки/сварки выберите цех';
  END IF;

  IF p_operation = 'create' THEN
    v_interval_id := COALESCE(p_interval_id, gen_random_uuid());
    INSERT INTO public.production_stage_intervals (
      id, production_stage_id, position, date_start, date_end, workshop, updated_by
    )
    SELECT v_interval_id, p_stage_id, COALESCE(max(position), 0) + 1,
      p_date_start, p_date_end,
      CASE WHEN v_stage_type = 'assembly' THEN p_workshop ELSE NULL END,
      p_updated_by
    FROM public.production_stage_intervals
    WHERE production_stage_id = p_stage_id;
  ELSIF p_operation = 'update' THEN
    UPDATE public.production_stage_intervals
    SET date_start = p_date_start,
        date_end = p_date_end,
        workshop = CASE WHEN v_stage_type = 'assembly' THEN p_workshop ELSE NULL END,
        updated_at = now(),
        updated_by = p_updated_by
    WHERE id = p_interval_id AND production_stage_id = p_stage_id
    RETURNING id INTO v_interval_id;
    IF v_interval_id IS NULL THEN
      RAISE EXCEPTION 'Подход не найден';
    END IF;
  ELSIF p_operation = 'delete' THEN
    DELETE FROM public.production_stage_intervals
    WHERE id = p_interval_id AND production_stage_id = p_stage_id
    RETURNING id INTO v_interval_id;
    IF v_interval_id IS NULL THEN
      RAISE EXCEPTION 'Подход не найден';
    END IF;
    UPDATE public.production_stage_intervals
    SET position = position + 100000
    WHERE production_stage_id = p_stage_id;
    WITH ordered AS (
      SELECT id, row_number() OVER (ORDER BY position, created_at, id)::integer AS new_position
      FROM public.production_stage_intervals
      WHERE production_stage_id = p_stage_id
    )
    UPDATE public.production_stage_intervals i
    SET position = ordered.new_position,
        updated_at = now(),
        updated_by = p_updated_by
    FROM ordered
    WHERE i.id = ordered.id;
  ELSE
    RAISE EXCEPTION 'Неизвестная операция с подходом: %', p_operation;
  END IF;

  RETURN v_interval_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_mutate_production_stage_interval(text, uuid, uuid, date, date, smallint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_mutate_production_stage_interval(text, uuid, uuid, date, date, smallint, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.fn_apply_production_stage_interval_changes(
  p_changes jsonb,
  p_updated_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_change jsonb;
  v_payload jsonb;
BEGIN
  IF jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'Набор изменений подходов должен быть массивом';
  END IF;

  SET CONSTRAINTS production_stage_intervals_sync_parent DEFERRED;

  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes)
  LOOP
    v_payload := v_change -> 'new_payload';
    PERFORM public.fn_mutate_production_stage_interval(
      v_change ->> 'operation',
      (v_change ->> 'stage_id')::uuid,
      (v_change ->> 'interval_id')::uuid,
      NULLIF(v_payload ->> 'date_start', '')::date,
      NULLIF(v_payload ->> 'date_end', '')::date,
      NULLIF(v_payload ->> 'workshop', '')::smallint,
      p_updated_by
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_apply_production_stage_interval_changes(jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_production_stage_interval_changes(jsonb, uuid)
  TO service_role;

-- A request item can describe creation, update or deletion of a whole interval.
ALTER TABLE public.production_plan_date_change_request_items
  ADD COLUMN IF NOT EXISTS production_stage_interval_id uuid;
ALTER TABLE public.production_plan_date_change_request_items
  ADD COLUMN IF NOT EXISTS interval_operation text;
ALTER TABLE public.production_plan_date_change_request_items
  ADD COLUMN IF NOT EXISTS old_payload jsonb;
ALTER TABLE public.production_plan_date_change_request_items
  ADD COLUMN IF NOT EXISTS new_payload jsonb;

ALTER TABLE public.production_plan_date_change_request_items
  DROP CONSTRAINT IF EXISTS production_plan_date_change_request_items_target_type_check;
ALTER TABLE public.production_plan_date_change_request_items
  DROP CONSTRAINT IF EXISTS production_plan_items_target_type_check;
ALTER TABLE public.production_plan_date_change_request_items
  ADD CONSTRAINT production_plan_items_target_type_check
  CHECK (target_type IN ('machine', 'stage', 'outsourcing', 'stage_interval'));

ALTER TABLE public.production_plan_date_change_request_items
  DROP CONSTRAINT IF EXISTS production_plan_items_interval_operation_check;
ALTER TABLE public.production_plan_date_change_request_items
  ADD CONSTRAINT production_plan_items_interval_operation_check
  CHECK (interval_operation IS NULL OR interval_operation IN ('create', 'update', 'delete'));

ALTER TABLE public.production_plan_date_change_request_items
  DROP CONSTRAINT IF EXISTS production_plan_date_change_request_items_target_check;
ALTER TABLE public.production_plan_date_change_request_items
  ADD CONSTRAINT production_plan_date_change_request_items_target_check
  CHECK (
    (
      target_type = 'machine' AND production_stage_id IS NULL AND outsourcing_operation_id IS NULL
      AND production_stage_interval_id IS NULL AND stage_type IS NULL
      AND field_name = 'planned_material_date' AND interval_operation IS NULL
    ) OR (
      target_type = 'stage' AND production_stage_id IS NOT NULL AND outsourcing_operation_id IS NULL
      AND production_stage_interval_id IS NULL AND stage_type IS NOT NULL
      AND field_name IN ('date_start', 'date_end', 'night_shift_date') AND interval_operation IS NULL
    ) OR (
      target_type = 'outsourcing' AND production_stage_id IS NULL AND outsourcing_operation_id IS NOT NULL
      AND production_stage_interval_id IS NULL AND stage_type IS NULL
      AND field_name IN ('planned_send_date', 'planned_return_date') AND interval_operation IS NULL
    ) OR (
      target_type = 'stage_interval' AND production_stage_id IS NOT NULL AND outsourcing_operation_id IS NULL
      AND production_stage_interval_id IS NOT NULL AND stage_type IS NOT NULL
      AND field_name = 'interval' AND interval_operation IN ('create', 'update', 'delete')
      AND old_value IS NULL AND new_value IS NULL
    )
  );

-- Apply every item of one approved request in the same database transaction.
CREATE OR REPLACE FUNCTION public.fn_apply_production_plan_date_change_items(
  p_request_id uuid,
  p_updated_by uuid DEFAULT NULL,
  p_decision_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.production_plan_date_change_request_items%ROWTYPE;
  v_payload jsonb;
  v_request_machine_id uuid;
  v_machine_archived boolean;
  v_task_id uuid;
BEGIN
  SET CONSTRAINTS production_stage_intervals_sync_parent DEFERRED;

  SELECT r.machine_id, m.is_archived, r.task_id
  INTO v_request_machine_id, v_machine_archived, v_task_id
  FROM public.production_plan_date_change_requests r
  JOIN public.machines m ON m.id = r.machine_id
  WHERE r.id = p_request_id
    AND r.status = 'pending'
  FOR UPDATE OF r, m;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Запрос на изменение плана не найден или уже обработан';
  END IF;
  IF v_machine_archived THEN
    RAISE EXCEPTION 'Машина архивирована. Изменения плана остановлены.';
  END IF;

  FOR v_item IN
    SELECT *
    FROM public.production_plan_date_change_request_items
    WHERE request_id = p_request_id
    ORDER BY sort_order, id
    FOR UPDATE
  LOOP
    IF v_item.target_type = 'machine' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.machines
        WHERE id = v_request_machine_id
          AND planned_material_date IS NOT DISTINCT FROM v_item.old_value
      ) THEN
        RAISE EXCEPTION 'Конфликт: плановая дата материала уже изменилась';
      END IF;
    ELSIF v_item.target_type = 'stage' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.production_stages
        WHERE id = v_item.production_stage_id AND machine_id = v_request_machine_id
      ) THEN
        RAISE EXCEPTION 'Этап запроса не принадлежит машине';
      END IF;
      PERFORM 1 FROM public.production_stages
      WHERE id = v_item.production_stage_id
      FOR UPDATE;
      IF v_item.field_name = 'date_start' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.production_stages
          WHERE id = v_item.production_stage_id AND date_start IS NOT DISTINCT FROM v_item.old_value
        ) THEN RAISE EXCEPTION 'Конфликт: начало этапа уже изменилось'; END IF;
      ELSIF v_item.field_name = 'date_end' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.production_stages
          WHERE id = v_item.production_stage_id AND date_end IS NOT DISTINCT FROM v_item.old_value
        ) THEN RAISE EXCEPTION 'Конфликт: окончание этапа уже изменилось'; END IF;
      ELSIF v_item.field_name = 'night_shift_date' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.production_stages
          WHERE id = v_item.production_stage_id AND night_shift_date IS NOT DISTINCT FROM v_item.old_value
        ) THEN RAISE EXCEPTION 'Конфликт: дата ночной смены уже изменилась'; END IF;
      END IF;
    ELSIF v_item.target_type = 'outsourcing' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.machine_outsourcing_operations
        WHERE id = v_item.outsourcing_operation_id AND machine_id = v_request_machine_id
      ) THEN
        RAISE EXCEPTION 'Операция аутсорсинга запроса не принадлежит машине';
      END IF;
      PERFORM 1 FROM public.machine_outsourcing_operations
      WHERE id = v_item.outsourcing_operation_id
      FOR UPDATE;
      IF v_item.field_name = 'planned_send_date' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.machine_outsourcing_operations
          WHERE id = v_item.outsourcing_operation_id AND planned_send_date IS NOT DISTINCT FROM v_item.old_value
        ) THEN RAISE EXCEPTION 'Конфликт: дата отправки на аутсорсинг уже изменилась'; END IF;
      ELSIF v_item.field_name = 'planned_return_date' THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.machine_outsourcing_operations
          WHERE id = v_item.outsourcing_operation_id AND planned_return_date IS NOT DISTINCT FROM v_item.old_value
        ) THEN RAISE EXCEPTION 'Конфликт: дата возврата с аутсорсинга уже изменилась'; END IF;
      END IF;
    ELSIF v_item.target_type = 'stage_interval' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.production_stages
        WHERE id = v_item.production_stage_id AND machine_id = v_request_machine_id
      ) THEN
        RAISE EXCEPTION 'Подход запроса не принадлежит машине';
      END IF;
      PERFORM 1 FROM public.production_stages
      WHERE id = v_item.production_stage_id
      FOR UPDATE;
      IF v_item.interval_operation = 'create' THEN
        IF EXISTS (
          SELECT 1 FROM public.production_stage_intervals
          WHERE id = v_item.production_stage_interval_id
        ) THEN RAISE EXCEPTION 'Конфликт: создаваемый подход уже существует'; END IF;
      ELSIF NOT EXISTS (
        SELECT 1
        FROM public.production_stage_intervals i
        WHERE i.id = v_item.production_stage_interval_id
          AND i.production_stage_id = v_item.production_stage_id
          AND i.position = (v_item.old_payload ->> 'position')::integer
          AND i.date_start IS NOT DISTINCT FROM NULLIF(v_item.old_payload ->> 'date_start', '')::date
          AND i.date_end IS NOT DISTINCT FROM NULLIF(v_item.old_payload ->> 'date_end', '')::date
          AND i.workshop IS NOT DISTINCT FROM NULLIF(v_item.old_payload ->> 'workshop', '')::smallint
      ) THEN
        RAISE EXCEPTION 'Конфликт: подход уже изменён или удалён';
      END IF;
    END IF;
  END LOOP;

  -- All snapshots are checked and their rows are locked before the first mutation.
  FOR v_item IN
    SELECT *
    FROM public.production_plan_date_change_request_items
    WHERE request_id = p_request_id
    ORDER BY sort_order, id
  LOOP
    IF v_item.target_type = 'machine' THEN
      UPDATE public.machines
      SET planned_material_date = v_item.new_value,
          updated_at = now()
      WHERE id = v_request_machine_id;
    ELSIF v_item.target_type = 'stage' THEN
      IF v_item.field_name = 'date_start' THEN
        UPDATE public.production_stages SET date_start = v_item.new_value, updated_by = p_updated_by
        WHERE id = v_item.production_stage_id;
      ELSIF v_item.field_name = 'date_end' THEN
        UPDATE public.production_stages SET date_end = v_item.new_value, updated_by = p_updated_by
        WHERE id = v_item.production_stage_id;
      ELSIF v_item.field_name = 'night_shift_date' THEN
        UPDATE public.production_stages
        SET night_shift_date = v_item.new_value,
            night_shift_dates = CASE WHEN v_item.new_value IS NULL THEN '{}'::date[] ELSE ARRAY[v_item.new_value] END,
            is_night_shift = v_item.new_value IS NOT NULL,
            updated_by = p_updated_by
        WHERE id = v_item.production_stage_id;
      END IF;
    ELSIF v_item.target_type = 'outsourcing' THEN
      IF v_item.field_name = 'planned_send_date' THEN
        UPDATE public.machine_outsourcing_operations
        SET planned_send_date = v_item.new_value, updated_at = now(), updated_by = p_updated_by
        WHERE id = v_item.outsourcing_operation_id;
      ELSIF v_item.field_name = 'planned_return_date' THEN
        UPDATE public.machine_outsourcing_operations
        SET planned_return_date = v_item.new_value,
            supply_terms_confirmed_at = NULL,
            supply_terms_confirmed_by = NULL,
            updated_at = now(),
            updated_by = p_updated_by
        WHERE id = v_item.outsourcing_operation_id;
      END IF;
    ELSIF v_item.target_type = 'stage_interval' THEN
      v_payload := v_item.new_payload;
      PERFORM public.fn_mutate_production_stage_interval(
        v_item.interval_operation,
        v_item.production_stage_id,
        v_item.production_stage_interval_id,
        NULLIF(v_payload ->> 'date_start', '')::date,
        NULLIF(v_payload ->> 'date_end', '')::date,
        NULLIF(v_payload ->> 'workshop', '')::smallint,
        p_updated_by
      );
    END IF;
  END LOOP;

  UPDATE public.production_plan_date_change_requests
  SET status = 'approved',
      decided_by = p_updated_by,
      decided_at = now(),
      decision_comment = p_decision_comment,
      updated_at = now()
  WHERE id = p_request_id AND status = 'pending';

  UPDATE public.production_plan_date_change_request_items
  SET status = 'approved', decided_at = now()
  WHERE request_id = p_request_id;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE id = v_task_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_apply_production_plan_date_change_items(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_production_plan_date_change_items(uuid, uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.fn_validate_and_sync_production_stage_intervals(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_production_stage_intervals()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_single_interval_from_parent()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_validate_painting_night_dates()
  FROM PUBLIC, anon, authenticated;
