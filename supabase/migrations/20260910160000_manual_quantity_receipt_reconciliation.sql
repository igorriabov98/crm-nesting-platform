-- Ordinary (non whole-bar) receipts are confirmed explicitly and reconcile
-- future supply schedules in the same transaction. Existing whole-bar RPCs
-- remain unchanged and keep their mandatory machine-allocation rule.

DO $migration$
DECLARE
  v_definition text;
  v_empty_anchor text := $anchor$
  IF jsonb_array_length(p_allocations) = 0
    AND current_setting('app.receiving_batch_mode', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Распределите материал хотя бы на одну машину';
  END IF;
$anchor$;
  v_empty_replacement text := $replacement$
  IF jsonb_array_length(p_allocations) = 0
    AND current_setting('app.receiving_batch_mode', true) IS DISTINCT FROM 'on'
    AND current_setting('app.manual_quantity_receipt_v3', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Распределите материал хотя бы на одну машину';
  END IF;
$replacement$;
  v_status_anchor text := $anchor$
  IF COALESCE(v_source_item->>'order_status', '') <> 'ordered'
    AND NOT (
      current_setting('app.receiving_batch_mode', true) IS NOT DISTINCT FROM 'on'
      AND COALESCE(v_source_item->>'order_status', '') = 'delivered'
    ) THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;
$anchor$;
  v_status_replacement text := $replacement$
  IF COALESCE(v_source_item->>'order_status', '') <> 'ordered'
    AND NOT (
      (
        current_setting('app.receiving_batch_mode', true) IS NOT DISTINCT FROM 'on'
        OR current_setting('app.manual_quantity_receipt_v3', true) IS NOT DISTINCT FROM 'on'
      )
      AND COALESCE(v_source_item->>'order_status', '') = 'delivered'
    ) THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;
$replacement$;
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure
  ) INTO v_definition;

  IF position(v_empty_anchor IN v_definition) = 0
    OR position(v_status_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;

  v_definition := replace(v_definition, v_empty_anchor, v_empty_replacement);
  v_definition := replace(v_definition, v_status_anchor, v_status_replacement);
  EXECUTE v_definition;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_quantity_receipt_schedules_v1(
  p_source_schedule_ids uuid[],
  p_allocations jsonb,
  p_reconciliation_reason text,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allocation jsonb;
  v_other_allocation jsonb;
  v_table text;
  v_other_table text;
  v_item jsonb;
  v_other_item jsonb;
  v_identity jsonb;
  v_other_identity jsonb;
  v_factory_id uuid;
  v_other_factory_id uuid;
  v_material_date date;
  v_other_material_date date;
  v_machine_id uuid;
  v_machine_name text;
  v_request_status text;
  v_group_key text;
  v_processed_keys text[] := ARRAY[]::text[];
  v_group_item_ids uuid[];
  v_group_machine_names text[];
  v_group_item record;
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_schedule_row record;
  v_link record;
  v_trip_id uuid;
  v_new_allocation numeric;
  v_required numeric;
  v_delivered numeric;
  v_post_remaining numeric;
  v_pre_remaining numeric;
  v_planned_total numeric;
  v_protected_total numeric;
  v_changeable_total numeric;
  v_pre_surplus numeric;
  v_post_surplus numeric;
  v_caused_surplus numeric;
  v_changeable_reduction numeric;
  v_protected_excess numeric;
  v_remaining_reduction numeric;
  v_cut numeric;
  v_new_quantity numeric;
  v_assignee uuid;
  v_task_id uuid;
  v_task_machine_id uuid;
  v_task_factory_id uuid;
  v_anchor_schedule_id uuid;
  v_unit text;
  v_details text := '';
  v_protected_details text;
  v_total_reduced numeric := 0;
  v_total_protected numeric := 0;
  v_reason text := NULLIF(btrim(p_reconciliation_reason), '');
  -- Europe/Kyiv has the same civil date as Uzhgorod and is available in the
  -- PostgreSQL tzdata versions used by both CI and production.
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  IF p_performed_by IS NULL THEN RAISE EXCEPTION 'Не указан исполнитель приёмки'; END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Некорректное подтверждённое распределение поставки';
  END IF;

  SELECT schedule.id, schedule.unit
  INTO v_anchor_schedule_id, v_unit
  FROM public.supply_order_delivery_schedules AS schedule
  WHERE schedule.id = ANY(COALESCE(p_source_schedule_ids, ARRAY[]::uuid[]))
  ORDER BY schedule.created_at, schedule.id
  LIMIT 1;

  FOR v_allocation IN
    SELECT allocation.value
    FROM jsonb_array_elements(p_allocations) AS allocation(value)
    WHERE COALESCE(NULLIF(allocation.value->>'quantity', '')::numeric, 0) > 0
    ORDER BY allocation.value->>'table', allocation.value->>'id'
  LOOP
    v_table := v_allocation->>'table';
    IF v_table NOT IN (
      'request_sheet_metal', 'request_round_tube', 'request_components',
      'request_paint', 'request_mesh', 'request_chain_cord', 'request_pipe'
    ) THEN
      RAISE EXCEPTION 'Некорректная таблица обычного материала';
    END IF;

    EXECUTE format(
      'SELECT to_jsonb(item) FROM public.%I AS item WHERE item.id = $1 FOR UPDATE',
      v_table
    ) INTO v_item USING (v_allocation->>'id')::uuid;
    IF v_item IS NULL THEN RAISE EXCEPTION 'Потребность для распределения больше не найдена'; END IF;

    SELECT machine.factory_id, machine.planned_material_date, machine.id, machine.name,
           request.status::text
    INTO v_factory_id, v_material_date, v_machine_id, v_machine_name, v_request_status
    FROM public.technologist_requests AS request
    JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid
      AND COALESCE(machine.is_archived, false) = false;
    IF v_factory_id IS NULL OR v_request_status NOT IN ('submitted_to_supply', 'completed') THEN
      RAISE EXCEPTION 'Потребность больше недоступна для распределения поставки';
    END IF;

    v_identity := public.fn_receiving_material_identity_v1(v_table, v_item);
    v_group_key := concat_ws('|', v_factory_id::text, v_table, COALESCE(v_material_date::text, 'no-date'), v_identity::text);
    IF v_group_key = ANY(v_processed_keys) THEN CONTINUE; END IF;
    v_processed_keys := array_append(v_processed_keys, v_group_key);

    v_new_allocation := 0;
    FOR v_other_allocation IN
      SELECT allocation.value
      FROM jsonb_array_elements(p_allocations) AS allocation(value)
      WHERE COALESCE(NULLIF(allocation.value->>'quantity', '')::numeric, 0) > 0
    LOOP
      v_other_table := v_other_allocation->>'table';
      IF v_other_table NOT IN (
        'request_sheet_metal', 'request_round_tube', 'request_components',
        'request_paint', 'request_mesh', 'request_chain_cord', 'request_pipe'
      ) THEN
        RAISE EXCEPTION 'Некорректная таблица обычного материала';
      END IF;
      EXECUTE format('SELECT to_jsonb(item) FROM public.%I AS item WHERE item.id = $1 FOR UPDATE', v_other_table)
        INTO v_other_item USING (v_other_allocation->>'id')::uuid;
      IF v_other_item IS NULL THEN RAISE EXCEPTION 'Потребность для распределения больше не найдена'; END IF;
      SELECT machine.factory_id, machine.planned_material_date
      INTO v_other_factory_id, v_other_material_date
      FROM public.technologist_requests AS request
      JOIN public.machines AS machine ON machine.id = request.machine_id
      WHERE request.id = NULLIF(v_other_item->>'request_id', '')::uuid;
      v_other_identity := public.fn_receiving_material_identity_v1(v_other_table, v_other_item);
      IF v_other_table = v_table
        AND v_other_factory_id IS NOT DISTINCT FROM v_factory_id
        AND v_other_material_date IS NOT DISTINCT FROM v_material_date
        AND v_other_identity = v_identity THEN
        v_new_allocation := v_new_allocation + (v_other_allocation->>'quantity')::numeric;
      END IF;
    END LOOP;

    v_group_item_ids := ARRAY[]::uuid[];
    v_group_machine_names := ARRAY[]::text[];
    v_required := 0;
    FOR v_group_item IN EXECUTE format($query$
      SELECT item.id AS item_id, to_jsonb(item) AS item_json,
             machine.id AS machine_id, machine.name AS machine_name
      FROM public.%I AS item
      JOIN public.technologist_requests AS request ON request.id = item.request_id
      JOIN public.machines AS machine ON machine.id = request.machine_id
      WHERE machine.factory_id = $1
        AND machine.planned_material_date IS NOT DISTINCT FROM $2
        AND COALESCE(machine.is_archived, false) = false
        AND request.status::text IN ('submitted_to_supply', 'completed')
        AND COALESCE(item.order_status::text, '') <> 'cancelled'
        AND public.fn_receiving_material_identity_v1(%L, to_jsonb(item)) = $3
      ORDER BY item.id
      FOR UPDATE OF item
    $query$, v_table, v_table)
      USING v_factory_id, v_material_date, v_identity
    LOOP
      v_group_item_ids := array_append(v_group_item_ids, v_group_item.item_id);
      IF NOT (v_group_item.machine_name = ANY(v_group_machine_names)) THEN
        v_group_machine_names := array_append(v_group_machine_names, v_group_item.machine_name);
      END IF;
      v_required := v_required + public.fn_supply_item_required_quantity(v_table, v_group_item.item_json);
      IF v_task_machine_id IS NULL THEN v_task_machine_id := v_group_item.machine_id; END IF;
    END LOOP;
    IF cardinality(v_group_item_ids) = 0 THEN
      RAISE EXCEPTION 'Не найден агрегат потребности для пересчёта будущего графика';
    END IF;

    -- Lock every schedule and its active transport relationship before the
    -- final calculation. This makes stale and parallel confirmations fail as
    -- one transaction instead of partially changing the graph.
    FOR v_schedule IN
      SELECT schedule.*
      FROM public.supply_order_delivery_schedules AS schedule
      WHERE schedule.request_item_table = v_table
        AND schedule.request_item_id = ANY(v_group_item_ids)
      ORDER BY schedule.id
      FOR UPDATE
    LOOP NULL; END LOOP;

    FOR v_trip_id IN
      SELECT DISTINCT link.transport_order_id
      FROM public.transport_trip_need_links AS link
      JOIN public.supply_order_delivery_schedules AS schedule ON schedule.id = link.need_id
      WHERE link.need_source = 'supply_schedule'
        AND link.released_at IS NULL
        AND schedule.request_item_table = v_table
        AND schedule.request_item_id = ANY(v_group_item_ids)
      ORDER BY link.transport_order_id
    LOOP
      PERFORM 1 FROM public.machine_outsourcing_transport_orders AS trip
      WHERE trip.id = v_trip_id FOR UPDATE;
    END LOOP;
    FOR v_link IN
      SELECT link.*
      FROM public.transport_trip_need_links AS link
      JOIN public.supply_order_delivery_schedules AS schedule ON schedule.id = link.need_id
      WHERE link.need_source = 'supply_schedule'
        AND link.released_at IS NULL
        AND schedule.request_item_table = v_table
        AND schedule.request_item_id = ANY(v_group_item_ids)
      ORDER BY link.id
      FOR UPDATE OF link
    LOOP NULL; END LOOP;

    SELECT COALESCE(sum(COALESCE(schedule.allocated_quantity, schedule.received_quantity, schedule.quantity)), 0)
    INTO v_delivered
    FROM public.supply_order_delivery_schedules AS schedule
    WHERE schedule.request_item_table = v_table
      AND schedule.request_item_id = ANY(v_group_item_ids)
      AND schedule.status = 'delivered';

    SELECT
      COALESCE(sum(schedule.quantity), 0),
      COALESCE(sum(schedule.quantity) FILTER (WHERE trip.status IN ('in_transit', 'completed')), 0),
      COALESCE(sum(schedule.quantity) FILTER (WHERE trip.status IS NULL OR trip.status NOT IN ('in_transit', 'completed')), 0)
    INTO v_planned_total, v_protected_total, v_changeable_total
    FROM public.supply_order_delivery_schedules AS schedule
    LEFT JOIN LATERAL (
      SELECT transport.status::text AS status
      FROM public.transport_trip_need_links AS link
      JOIN public.machine_outsourcing_transport_orders AS transport ON transport.id = link.transport_order_id
      WHERE link.need_source = 'supply_schedule'
        AND link.need_id = schedule.id
        AND link.released_at IS NULL
        AND transport.status <> 'cancelled'
      LIMIT 1
    ) AS trip ON true
    WHERE schedule.request_item_table = v_table
      AND schedule.request_item_id = ANY(v_group_item_ids)
      AND schedule.status = 'planned'
      AND NOT (schedule.id = ANY(COALESCE(p_source_schedule_ids, ARRAY[]::uuid[])));

    v_post_remaining := GREATEST(v_required - v_delivered, 0);
    v_pre_remaining := GREATEST(v_required - GREATEST(v_delivered - v_new_allocation, 0), 0);
    v_pre_surplus := GREATEST(v_planned_total - v_pre_remaining, 0);
    v_post_surplus := GREATEST(v_planned_total - v_post_remaining, 0);
    v_caused_surplus := LEAST(v_new_allocation, GREATEST(v_post_surplus - v_pre_surplus, 0));
    IF v_caused_surplus <= 0.000001 THEN CONTINUE; END IF;

    IF v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 2000 THEN
      RAISE EXCEPTION 'Укажите причину изменения будущего графика (от 3 до 2000 символов)';
    END IF;
    IF v_task_factory_id IS NULL THEN v_task_factory_id := v_factory_id; END IF;
    IF v_task_factory_id IS DISTINCT FROM v_factory_id THEN
      RAISE EXCEPTION 'Одна приёмка не может менять графики разных заводов';
    END IF;
    IF v_assignee IS NULL THEN
      v_assignee := public.resolve_machine_supply_task_assignee(v_factory_id);
      IF v_assignee IS NULL THEN
        RAISE EXCEPTION 'Не назначен активный руководитель отдела снабжения для этого завода';
      END IF;
    END IF;

    v_changeable_reduction := LEAST(
      v_caused_surplus,
      GREATEST(v_changeable_total - GREATEST(v_post_remaining - v_protected_total, 0), 0)
    );
    v_protected_excess := GREATEST(v_caused_surplus - v_changeable_reduction, 0);
    v_remaining_reduction := v_changeable_reduction;

    FOR v_schedule_row IN
      SELECT schedule.*, supplier.name AS supplier_name
      FROM public.supply_order_delivery_schedules AS schedule
      LEFT JOIN public.suppliers AS supplier ON supplier.id = schedule.supplier_id
      WHERE schedule.request_item_table = v_table
        AND schedule.request_item_id = ANY(v_group_item_ids)
        AND schedule.status = 'planned'
        AND NOT (schedule.id = ANY(COALESCE(p_source_schedule_ids, ARRAY[]::uuid[])))
        AND NOT EXISTS (
          SELECT 1
          FROM public.transport_trip_need_links AS link
          JOIN public.machine_outsourcing_transport_orders AS trip ON trip.id = link.transport_order_id
          WHERE link.need_source = 'supply_schedule'
            AND link.need_id = schedule.id
            AND link.released_at IS NULL
            AND trip.status IN ('in_transit', 'completed')
        )
      ORDER BY schedule.delivery_date DESC, schedule.created_at DESC, schedule.id DESC
    LOOP
      EXIT WHEN v_remaining_reduction <= 0.000001;
      v_cut := LEAST(v_schedule_row.quantity, v_remaining_reduction);
      v_new_quantity := v_schedule_row.quantity - v_cut;

      INSERT INTO public.supply_order_delivery_schedule_changes (
        schedule_id, old_delivery_date, new_delivery_date,
        old_quantity, new_quantity, old_supplier_id, new_supplier_id,
        reason, changed_by
      ) VALUES (
        v_schedule_row.id, v_schedule_row.delivery_date, v_schedule_row.delivery_date,
        v_schedule_row.quantity, GREATEST(v_new_quantity, 0),
        v_schedule_row.supplier_id, v_schedule_row.supplier_id,
        v_reason, p_performed_by
      );

      IF v_new_quantity <= 0.000001 THEN
        UPDATE public.supply_order_delivery_schedules
        SET status = 'cancelled',
            change_reason = concat_ws('. ', NULLIF(change_reason, ''), v_reason),
            updated_by = p_performed_by,
            updated_at = now()
        WHERE id = v_schedule_row.id;

        FOR v_link IN
          SELECT link.id, trip.id AS trip_id
          FROM public.transport_trip_need_links AS link
          JOIN public.machine_outsourcing_transport_orders AS trip ON trip.id = link.transport_order_id
          WHERE link.need_source = 'supply_schedule'
            AND link.need_id = v_schedule_row.id
            AND link.released_at IS NULL
            AND trip.status NOT IN ('in_transit', 'completed')
          FOR UPDATE OF link, trip
        LOOP
          UPDATE public.transport_trip_need_links
          SET released_at = now(), released_reason = v_reason, released_by = p_performed_by
          WHERE id = v_link.id;
          IF NOT EXISTS (
            SELECT 1 FROM public.transport_trip_need_links AS active_link
            WHERE active_link.transport_order_id = v_link.trip_id
              AND active_link.released_at IS NULL
          ) THEN
            UPDATE public.machine_outsourcing_transport_orders
            SET status = 'cancelled', cancellation_reason = v_reason,
                cancelled_at = now(), cancelled_by = p_performed_by, updated_at = now()
            WHERE id = v_link.trip_id AND status IN ('needed', 'found');
          END IF;
        END LOOP;
      ELSE
        UPDATE public.supply_order_delivery_schedules
        SET quantity = v_new_quantity,
            change_reason = concat_ws('. ', NULLIF(change_reason, ''), v_reason),
            updated_by = p_performed_by,
            updated_at = now()
        WHERE id = v_schedule_row.id;
      END IF;

      v_details := v_details || E'\n' || format(
        '• %s, %s: %s → %s %s%s',
        COALESCE(v_schedule_row.supplier_name, 'Без поставщика'),
        to_char(v_schedule_row.delivery_date, 'DD.MM.YYYY'),
        trim(to_char(v_schedule_row.quantity, 'FM9999999990.###')),
        trim(to_char(GREATEST(v_new_quantity, 0), 'FM9999999990.###')),
        COALESCE(v_schedule_row.unit, v_unit, ''),
        CASE WHEN v_new_quantity <= 0.000001 THEN ' (отменена)' ELSE '' END
      );
      v_total_reduced := v_total_reduced + v_cut;
      v_remaining_reduction := v_remaining_reduction - v_cut;
    END LOOP;

    IF v_protected_excess > 0.000001 THEN
      SELECT string_agg(
        format('• %s, %s: %s %s, рейс %s — без изменения',
          COALESCE(supplier.name, 'Без поставщика'),
          to_char(schedule.delivery_date, 'DD.MM.YYYY'),
          trim(to_char(schedule.quantity, 'FM9999999990.###')),
          schedule.unit,
          CASE trip.status WHEN 'in_transit' THEN 'в пути' ELSE 'завершён' END
        ), E'\n' ORDER BY schedule.delivery_date DESC, schedule.created_at DESC, schedule.id DESC
      ) INTO v_protected_details
      FROM public.supply_order_delivery_schedules AS schedule
      LEFT JOIN public.suppliers AS supplier ON supplier.id = schedule.supplier_id
      JOIN public.transport_trip_need_links AS link
        ON link.need_source = 'supply_schedule' AND link.need_id = schedule.id AND link.released_at IS NULL
      JOIN public.machine_outsourcing_transport_orders AS trip
        ON trip.id = link.transport_order_id AND trip.status IN ('in_transit', 'completed')
      WHERE schedule.request_item_table = v_table
        AND schedule.request_item_id = ANY(v_group_item_ids)
        AND schedule.status = 'planned';
      v_details := v_details || E'\nЗащищённый объём в рейсах ('
        || trim(to_char(v_protected_excess, 'FM9999999990.###')) || ' ' || COALESCE(v_unit, '') || '):'
        || CASE WHEN v_protected_details IS NULL THEN '' ELSE E'\n' || v_protected_details END;
      v_total_protected := v_total_protected + v_protected_excess;
    END IF;

    v_details := v_details || E'\nМашины: ' || array_to_string(v_group_machine_names, ', ') || E'.\n';
  END LOOP;

  IF v_total_reduced > 0.000001 OR v_total_protected > 0.000001 THEN
    IF v_anchor_schedule_id IS NULL OR v_task_machine_id IS NULL OR v_assignee IS NULL THEN
      RAISE EXCEPTION 'Не удалось подготовить задачу по сверке графика снабжения';
    END IF;
    INSERT INTO public.tasks (
      machine_id, supply_order_schedule_id, assigned_to, task_type,
      title, description, status, start_date, deadline
    ) VALUES (
      v_task_machine_id, v_anchor_schedule_id, v_assignee,
      'supply_schedule_reconciliation_review',
      'Проверить изменение будущего графика после приёмки',
      concat(
        'Причина оператора: ', v_reason, E'\n',
        'Автоматически уменьшено: ', trim(to_char(v_total_reduced, 'FM9999999990.###')), ' ', COALESCE(v_unit, ''), E'.\n',
        'Неизменённый потенциальный излишек в начатых рейсах: ',
        trim(to_char(v_total_protected, 'FM9999999990.###')), ' ', COALESCE(v_unit, ''), '.',
        v_details,
        E'\nФинансовые документы и договорённости с поставщиками автоматически не изменялись.'
      ),
      'pending', v_today, v_today
    )
    RETURNING id INTO v_task_id;

    PERFORM public.notify_user(
      v_assignee,
      'supply_schedule_reconciliation_review',
      'Изменён будущий график после приёмки',
      concat(
        'Уменьшено ', trim(to_char(v_total_reduced, 'FM9999999990.###')), ' ', COALESCE(v_unit, ''),
        '; защищено в рейсах ', trim(to_char(v_total_protected, 'FM9999999990.###')), ' ', COALESCE(v_unit, ''), '.'
      ),
      v_task_machine_id
    );
  END IF;

  RETURN jsonb_build_object(
    'reduced_quantity', v_total_reduced,
    'protected_quantity', v_total_protected,
    'task_id', v_task_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_v3(
  p_schedule_id uuid,
  p_performed_by uuid,
  p_received_quantity numeric,
  p_allocations jsonb,
  p_received_piece_length_mm numeric DEFAULT NULL,
  p_received_piece_count numeric DEFAULT NULL,
  p_reconciliation_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_reconciliation jsonb;
BEGIN
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Приёмка не подтверждена оператором: передайте confirmed_allocations';
  END IF;
  IF p_received_piece_length_mm IS NOT NULL OR p_received_piece_count IS NOT NULL THEN
    RAISE EXCEPTION 'Для приёмки хлыстов используйте существующий сценарий';
  END IF;

  PERFORM set_config('app.manual_quantity_receipt_v3', 'on', true);
  SELECT public.fn_receive_supply_order_schedule_v2(
    p_schedule_id, p_performed_by, p_received_quantity, p_allocations, NULL, NULL
  ) INTO v_result;
  PERFORM set_config('app.manual_quantity_receipt_v3', 'off', true);

  SELECT public.fn_reconcile_quantity_receipt_schedules_v1(
    ARRAY[p_schedule_id], p_allocations, p_reconciliation_reason, p_performed_by
  ) INTO v_reconciliation;
  RETURN v_result || jsonb_build_object('reconciliation', v_reconciliation);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_batch_v2(
  p_receipts jsonb,
  p_performed_by uuid,
  p_reconciliation_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_reconciliation jsonb;
  v_allocations jsonb;
  v_source_schedule_ids uuid[];
BEGIN
  IF p_receipts IS NULL OR jsonb_typeof(p_receipts) <> 'array' OR jsonb_array_length(p_receipts) = 0 THEN
    RAISE EXCEPTION 'Пакет приёмки пуст';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_receipts) AS receipt(value)
    WHERE jsonb_typeof(receipt.value->'allocations') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'Приёмка не подтверждена оператором: передайте confirmed_allocations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_receipts) AS receipt(value)
    WHERE NULLIF(receipt.value->>'received_piece_length_mm', '') IS NOT NULL
       OR NULLIF(receipt.value->>'received_piece_count', '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Для приёмки хлыстов используйте существующий сценарий';
  END IF;

  SELECT array_agg((receipt.value->>'schedule_id')::uuid ORDER BY receipt.value->>'schedule_id')
  INTO v_source_schedule_ids
  FROM jsonb_array_elements(p_receipts) AS receipt(value);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'table', grouped.table_name,
    'id', grouped.item_id,
    'quantity', grouped.quantity,
    'physical_quantity', grouped.quantity,
    'piece_count', NULL
  )), '[]'::jsonb)
  INTO v_allocations
  FROM (
    SELECT allocation.value->>'table' AS table_name,
           allocation.value->>'id' AS item_id,
           sum(COALESCE(NULLIF(allocation.value->>'quantity', '')::numeric, 0)) AS quantity
    FROM jsonb_array_elements(p_receipts) AS receipt(value)
    CROSS JOIN LATERAL jsonb_array_elements(receipt.value->'allocations') AS allocation(value)
    GROUP BY allocation.value->>'table', allocation.value->>'id'
    HAVING sum(COALESCE(NULLIF(allocation.value->>'quantity', '')::numeric, 0)) > 0
  ) AS grouped;

  PERFORM set_config('app.manual_quantity_receipt_v3', 'on', true);
  SELECT public.fn_receive_supply_order_schedule_batch_v1(p_receipts, p_performed_by)
  INTO v_result;
  PERFORM set_config('app.manual_quantity_receipt_v3', 'off', true);
  SELECT public.fn_reconcile_quantity_receipt_schedules_v1(
    v_source_schedule_ids, v_allocations, p_reconciliation_reason, p_performed_by
  ) INTO v_reconciliation;
  RETURN v_result || jsonb_build_object('reconciliation', v_reconciliation);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reconcile_quantity_receipt_schedules_v1(uuid[], jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reconcile_quantity_receipt_schedules_v1(uuid[], jsonb, text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_quantity_receipt_schedules_v1(uuid[], jsonb, text, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v3(uuid, uuid, numeric, jsonb, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v3(uuid, uuid, numeric, jsonb, numeric, numeric, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_v3(uuid, uuid, numeric, jsonb, numeric, numeric, text) TO service_role;

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_batch_v2(jsonb, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_batch_v2(jsonb, uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_batch_v2(jsonb, uuid, text) TO service_role;

COMMENT ON FUNCTION public.fn_receive_supply_order_schedule_v3(uuid, uuid, numeric, jsonb, numeric, numeric, text)
  IS 'Explicitly confirmed ordinary-material receipt with atomic future-schedule reconciliation.';
COMMENT ON FUNCTION public.fn_receive_supply_order_schedule_batch_v2(jsonb, uuid, text)
  IS 'Batch ordinary-material receipt with one atomic future-schedule reconciliation task.';
