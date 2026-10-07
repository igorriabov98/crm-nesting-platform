-- Receiving records physical fact only. A newly uncovered excess in the
-- future schedule becomes a supply review case; the schedule is never edited
-- by the receiving transaction.
CREATE TABLE public.supply_schedule_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_schedule_id uuid NOT NULL REFERENCES public.supply_order_delivery_schedules(id) ON DELETE RESTRICT,
  group_key text NOT NULL,
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  request_id uuid REFERENCES public.technologist_requests(id),
  machine_id uuid REFERENCES public.machines(id),
  request_item_table text NOT NULL,
  material_identity jsonb NOT NULL,
  required_quantity numeric NOT NULL CHECK (required_quantity >= 0),
  delivered_quantity numeric NOT NULL CHECK (delivered_quantity >= 0),
  future_planned_quantity numeric NOT NULL CHECK (future_planned_quantity >= 0),
  excess_quantity numeric NOT NULL CHECK (excess_quantity > 0),
  unit text NOT NULL,
  assigned_to uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_schedule_id, group_key)
);

CREATE INDEX supply_schedule_review_cases_factory_pending
  ON public.supply_schedule_review_cases(factory_id, created_at DESC)
  WHERE status = 'pending';

ALTER TABLE public.supply_schedule_review_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supply_schedule_review_cases FROM PUBLIC, anon;
GRANT SELECT ON public.supply_schedule_review_cases TO authenticated;
CREATE POLICY supply_schedule_review_cases_view
  ON public.supply_schedule_review_cases FOR SELECT TO authenticated
  USING (
    private.crm_has_permission('supply_orders', 'view')
    AND private.crm_has_factory_permission('supply_orders', 'view', factory_id)
  );

ALTER TABLE public.tasks ADD COLUMN supply_schedule_review_case_id uuid
  REFERENCES public.supply_schedule_review_cases(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX tasks_active_supply_schedule_review_case
  ON public.tasks(supply_schedule_review_case_id)
  WHERE supply_schedule_review_case_id IS NOT NULL
    AND status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.fn_reconcile_quantity_receipt_schedules_v1(
  p_source_schedule_ids uuid[],
  p_allocations jsonb,
  p_reconciliation_reason text,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_allocation jsonb;
  v_table text;
  v_item jsonb;
  v_identity jsonb;
  v_factory_id uuid;
  v_material_date date;
  v_request_id uuid;
  v_request_kind text;
  v_machine_id uuid;
  v_request_status text;
  v_group_key text;
  v_processed_keys text[] := ARRAY[]::text[];
  v_group_item record;
  v_group_item_ids uuid[];
  v_required numeric;
  v_delivered numeric;
  v_new_allocation numeric;
  v_future_planned numeric;
  v_pre_remaining numeric;
  v_post_remaining numeric;
  v_pre_surplus numeric;
  v_post_surplus numeric;
  v_new_surplus numeric;
  v_anchor_schedule_id uuid;
  v_unit text;
  v_assignee uuid;
  v_case_id uuid;
  v_task_id uuid;
  v_case_count integer := 0;
  v_total_review numeric := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  IF p_performed_by IS NULL THEN RAISE EXCEPTION 'Не указан исполнитель приёмки'; END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Некорректное подтверждённое распределение поставки';
  END IF;

  SELECT schedule.id, schedule.unit INTO v_anchor_schedule_id, v_unit
  FROM public.supply_order_delivery_schedules AS schedule
  WHERE schedule.id = ANY(COALESCE(p_source_schedule_ids, ARRAY[]::uuid[]))
  ORDER BY schedule.created_at, schedule.id LIMIT 1;
  IF v_anchor_schedule_id IS NULL THEN RAISE EXCEPTION 'Исходная поставка не найдена'; END IF;

  FOR v_allocation IN
    SELECT entry.value FROM jsonb_array_elements(p_allocations) AS entry(value)
    WHERE COALESCE(NULLIF(entry.value->>'quantity', '')::numeric, 0) > 0
    ORDER BY entry.value->>'table', entry.value->>'id'
  LOOP
    v_table := v_allocation->>'table';
    IF v_table NOT IN (
      'request_sheet_metal', 'request_round_tube', 'request_components',
      'request_paint', 'request_mesh', 'request_chain_cord', 'request_pipe'
    ) THEN RAISE EXCEPTION 'Некорректная таблица обычного материала'; END IF;

    EXECUTE format('SELECT to_jsonb(item) FROM public.%I AS item WHERE item.id = $1 FOR UPDATE', v_table)
      INTO v_item USING (v_allocation->>'id')::uuid;
    IF v_item IS NULL THEN RAISE EXCEPTION 'Потребность для распределения больше не найдена'; END IF;

    SELECT CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END,
           CASE WHEN request.request_kind = 'stock' THEN request.needed_by ELSE machine.planned_material_date END,
           request.id, request.request_kind, machine.id, request.status::text
      INTO v_factory_id, v_material_date, v_request_id, v_request_kind, v_machine_id, v_request_status
    FROM public.technologist_requests AS request
    LEFT JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid
      AND COALESCE(machine.is_archived, false) = false;
    IF v_factory_id IS NULL OR v_request_status NOT IN ('submitted_to_supply', 'completed') THEN
      RAISE EXCEPTION 'Потребность больше недоступна для сверки поставки';
    END IF;

    v_identity := public.fn_receiving_material_identity_v1(v_table, v_item);
    -- Stock requests are independent even when material and date match a machine.
    v_group_key := concat_ws('|', v_factory_id, v_table, v_request_kind,
      CASE WHEN v_request_kind = 'stock' THEN v_request_id::text ELSE COALESCE(v_material_date::text, 'no-date') END,
      v_identity::text);
    IF v_group_key = ANY(v_processed_keys) THEN CONTINUE; END IF;
    v_processed_keys := array_append(v_processed_keys, v_group_key);

    v_group_item_ids := ARRAY[]::uuid[];
    v_required := 0;
    FOR v_group_item IN EXECUTE format($query$
      SELECT item.id AS item_id, to_jsonb(item) AS item_json
      FROM public.%I AS item
      JOIN public.technologist_requests AS request ON request.id = item.request_id
      LEFT JOIN public.machines AS machine ON machine.id = request.machine_id
      WHERE (CASE WHEN request.request_kind = 'stock' THEN request.factory_id ELSE machine.factory_id END) = $1
        AND request.request_kind = $2
        AND (CASE WHEN $2 = 'stock' THEN request.id = $3
          ELSE machine.planned_material_date IS NOT DISTINCT FROM $4 END)
        AND COALESCE(machine.is_archived, false) = false
        AND request.status::text IN ('submitted_to_supply', 'completed')
        AND COALESCE(item.order_status::text, '') <> 'cancelled'
        AND public.fn_receiving_material_identity_v1(%L, to_jsonb(item)) = $5
      ORDER BY item.id FOR UPDATE OF item
    $query$, v_table, v_table)
      USING v_factory_id, v_request_kind, v_request_id, v_material_date, v_identity
    LOOP
      v_group_item_ids := array_append(v_group_item_ids, v_group_item.item_id);
      v_required := v_required + public.fn_supply_item_required_quantity(v_table, v_group_item.item_json);
    END LOOP;
    IF cardinality(v_group_item_ids) = 0 THEN
      RAISE EXCEPTION 'Не найдена потребность для сверки будущего графика';
    END IF;

    SELECT COALESCE(sum((entry.value->>'quantity')::numeric), 0) INTO v_new_allocation
    FROM jsonb_array_elements(p_allocations) AS entry(value)
    WHERE entry.value->>'table' = v_table
      AND (entry.value->>'id')::uuid = ANY(v_group_item_ids)
      AND COALESCE(NULLIF(entry.value->>'quantity', '')::numeric, 0) > 0;

    -- Serialise with concurrent schedule edits. No future row is changed here.
    PERFORM 1 FROM public.supply_order_delivery_schedules AS schedule
    WHERE schedule.request_item_table = v_table AND schedule.request_item_id = ANY(v_group_item_ids)
    ORDER BY schedule.id FOR UPDATE;

    SELECT COALESCE(sum(COALESCE(schedule.allocated_quantity, schedule.received_quantity, schedule.quantity))
             FILTER (WHERE schedule.status = 'delivered'), 0),
           COALESCE(sum(schedule.quantity) FILTER (WHERE schedule.status = 'planned'
             AND NOT (schedule.id = ANY(p_source_schedule_ids))), 0)
      INTO v_delivered, v_future_planned
    FROM public.supply_order_delivery_schedules AS schedule
    WHERE schedule.request_item_table = v_table AND schedule.request_item_id = ANY(v_group_item_ids)
      AND schedule.status IN ('delivered', 'planned');

    v_post_remaining := GREATEST(v_required - v_delivered, 0);
    v_pre_remaining := GREATEST(v_required - GREATEST(v_delivered - v_new_allocation, 0), 0);
    v_pre_surplus := GREATEST(v_future_planned - v_pre_remaining, 0);
    v_post_surplus := GREATEST(v_future_planned - v_post_remaining, 0);
    v_new_surplus := LEAST(v_new_allocation, GREATEST(v_post_surplus - v_pre_surplus, 0));
    IF v_new_surplus <= 0.000001 THEN CONTINUE; END IF;

    INSERT INTO public.supply_schedule_review_cases (
      source_schedule_id, group_key, factory_id, request_id, machine_id,
      request_item_table, material_identity, required_quantity, delivered_quantity,
      future_planned_quantity, excess_quantity, unit
    ) VALUES (
      v_anchor_schedule_id, v_group_key, v_factory_id,
      CASE WHEN v_request_kind = 'stock' THEN v_request_id ELSE NULL END,
      v_machine_id, v_table, v_identity, v_required, v_delivered,
      v_future_planned, v_new_surplus, v_unit
    )
    ON CONFLICT (source_schedule_id, group_key) DO UPDATE SET
      required_quantity = EXCLUDED.required_quantity,
      delivered_quantity = EXCLUDED.delivered_quantity,
      future_planned_quantity = EXCLUDED.future_planned_quantity,
      excess_quantity = EXCLUDED.excess_quantity,
      updated_at = now()
    RETURNING id INTO v_case_id;

    v_assignee := public.resolve_machine_supply_task_assignee(v_factory_id);
    IF v_assignee IS NOT NULL THEN
      INSERT INTO public.tasks (
        machine_id, supply_order_schedule_id, supply_schedule_review_case_id,
        assigned_to, task_type, title, description, status, start_date, deadline
      ) VALUES (
        NULL, NULL, v_case_id, v_assignee,
        'supply_schedule_reconciliation_review', 'Проверить будущий график после приёмки',
        format('По заявке принято %s из %s %s. Будущий график: %s %s. Проверить потенциальный избыток %s %s. График и договорённости с поставщиком не изменялись.',
          v_delivered, v_required, v_unit, v_future_planned, v_unit, v_new_surplus, v_unit),
        'pending', v_today, v_today
      )
      ON CONFLICT (supply_schedule_review_case_id)
        WHERE supply_schedule_review_case_id IS NOT NULL AND status IN ('pending', 'in_progress')
      DO UPDATE SET
        description = CASE
          WHEN strpos(COALESCE(tasks.description, ''), EXCLUDED.description) > 0 THEN tasks.description
          ELSE concat_ws(E'\n', tasks.description, EXCLUDED.description)
        END,
        updated_at = now()
      RETURNING id INTO v_task_id;
      UPDATE public.supply_schedule_review_cases
      SET assigned_to = v_assignee, updated_at = now()
      WHERE id = v_case_id;
      PERFORM public.notify_user(v_assignee, 'supply_schedule_reconciliation_review',
        'Проверьте будущий график после приёмки',
        format('Потенциальный избыток: %s %s. График не менялся.', v_new_surplus, v_unit),
        v_machine_id);
    END IF;
    v_case_count := v_case_count + 1;
    v_total_review := v_total_review + v_new_surplus;
  END LOOP;

  RETURN jsonb_build_object(
    'reduced_quantity', 0, 'protected_quantity', 0,
    'review_quantity', v_total_review, 'review_case_count', v_case_count
  );
END;
$$;

COMMENT ON FUNCTION public.fn_reconcile_quantity_receipt_schedules_v1(uuid[],jsonb,text,uuid)
  IS 'Detects newly excess future supply after ordinary receiving; retains future schedules and stores review cases. The legacy reason argument is ignored.';

CREATE OR REPLACE FUNCTION public.fn_assign_supply_schedule_review_case_v1(
  p_case_id uuid, p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_case public.supply_schedule_review_cases%ROWTYPE;
  v_assignee uuid;
  v_task_id uuid;
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  IF p_actor IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Исполнитель не совпадает с текущим пользователем' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_case FROM public.supply_schedule_review_cases WHERE id = p_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Случай для проверки не найден'; END IF;
  IF NOT private.crm_has_permission('supply_orders', 'manage')
    OR NOT private.crm_has_factory_permission('supply_orders', 'manage', v_case.factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для назначения задачи снабжению' USING ERRCODE = '42501';
  END IF;
  IF v_case.status <> 'pending' THEN RAISE EXCEPTION 'Случай уже закрыт'; END IF;
  IF v_case.assigned_to IS NOT NULL THEN
    SELECT id INTO v_task_id FROM public.tasks
    WHERE supply_schedule_review_case_id = p_case_id
      AND status IN ('pending', 'in_progress') LIMIT 1;
    IF v_task_id IS NOT NULL THEN RETURN v_task_id; END IF;
  END IF;

  v_assignee := public.resolve_machine_supply_task_assignee(v_case.factory_id);
  IF v_assignee IS NULL THEN RAISE EXCEPTION 'Назначьте активного руководителя отдела снабжения для этого завода'; END IF;
  INSERT INTO public.tasks (
    machine_id, supply_order_schedule_id, supply_schedule_review_case_id,
    assigned_to, task_type, title, description, status, start_date, deadline
  ) VALUES (
    NULL, NULL, v_case.id, v_assignee,
    'supply_schedule_reconciliation_review', 'Проверить будущий график после приёмки',
    format('По заявке принято %s из %s %s. Будущий график: %s %s. Проверить потенциальный избыток %s %s. График не менялся.',
      v_case.delivered_quantity, v_case.required_quantity, v_case.unit,
      v_case.future_planned_quantity, v_case.unit, v_case.excess_quantity, v_case.unit),
    'pending', v_today, v_today
  )
  ON CONFLICT (supply_schedule_review_case_id)
    WHERE supply_schedule_review_case_id IS NOT NULL AND status IN ('pending', 'in_progress')
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_task_id;
  UPDATE public.supply_schedule_review_cases
  SET assigned_to = v_assignee, updated_at = now() WHERE id = p_case_id;
  PERFORM public.notify_user(v_assignee, 'supply_schedule_reconciliation_review',
    'Проверьте будущий график после приёмки',
    format('Потенциальный избыток: %s %s. График не менялся.', v_case.excess_quantity, v_case.unit),
    v_case.machine_id);
  RETURN v_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_assign_supply_schedule_review_case_v1(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_assign_supply_schedule_review_case_v1(uuid,uuid) TO authenticated;
