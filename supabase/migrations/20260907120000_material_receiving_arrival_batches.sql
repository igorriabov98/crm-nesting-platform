-- Receive the technical schedule rows of one physical arrival as one atomic batch.
-- The established single-schedule RPC remains the lifecycle authority; batch mode
-- only suppresses per-fragment variance effects and permits technical excess rows.

CREATE OR REPLACE FUNCTION public.fn_receiving_material_identity_v1(
  p_request_item_table text,
  p_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_variant_id text := NULLIF(p_item->>'material_variant_id', '');
  v_fields jsonb;
BEGIN
  IF p_request_item_table NOT IN (
    'request_sheet_metal', 'request_round_tube', 'request_circle',
    'request_pipe', 'request_knives', 'request_components',
    'request_paint', 'request_mesh', 'request_chain_cord'
  ) THEN
    RAISE EXCEPTION 'Некорректная таблица позиции закупки';
  END IF;

  IF v_variant_id IS NOT NULL THEN
    v_fields := jsonb_build_array('variant', v_variant_id);
  ELSE
    v_fields := CASE p_request_item_table
      WHEN 'request_sheet_metal' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'material_name'), ''),
        NULLIF(btrim(p_item->>'material_grade'), ''),
        NULLIF(btrim(p_item->>'steel_type_id'), ''),
        NULLIF(btrim(p_item->>'thickness_mm'), ''),
        NULLIF(btrim(p_item->>'sheet_size'), '')
      )
      WHEN 'request_round_tube' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'material_name'), ''),
        NULLIF(btrim(p_item->>'piece_count'), '')
      )
      WHEN 'request_circle' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'steel_grade'), ''),
        NULLIF(btrim(p_item->>'steel_type_id'), ''),
        NULLIF(btrim(p_item->>'diameter_mm'), ''),
        NULLIF(btrim(p_item->>'is_calibrated'), '')
      )
      WHEN 'request_pipe' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'pipe_type'), ''),
        NULLIF(btrim(p_item->>'steel_type_id'), ''),
        NULLIF(btrim(p_item->>'size'), ''),
        NULLIF(btrim(p_item->>'wall_thickness_mm'), ''),
        NULLIF(btrim(p_item->>'diameter_mm'), '')
      )
      WHEN 'request_knives' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'knife_type'), ''),
        NULLIF(btrim(p_item->>'steel_grade'), ''),
        NULLIF(btrim(p_item->>'steel_type_id'), ''),
        NULLIF(btrim(p_item->>'knife_bevel_count'), ''),
        NULLIF(btrim(p_item->>'width_mm'), ''),
        NULLIF(btrim(p_item->>'height_mm'), '')
      )
      WHEN 'request_components' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'component_name'), ''),
        NULLIF(btrim(p_item->>'specification'), ''),
        NULLIF(btrim(p_item->>'diameter_mm'), ''),
        NULLIF(btrim(p_item->>'unit'), '')
      )
      WHEN 'request_paint' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'paint_type'), ''),
        NULLIF(btrim(p_item->>'ral_code'), ''),
        NULLIF(btrim(p_item->>'finish'), '')
      )
      WHEN 'request_mesh' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'description'), ''),
        NULLIF(btrim(p_item->>'length_mm'), ''),
        NULLIF(btrim(p_item->>'width_mm'), '')
      )
      WHEN 'request_chain_cord' THEN jsonb_build_array(
        NULLIF(btrim(p_item->>'item_type'), ''),
        NULLIF(btrim(p_item->>'parameters'), '')
      )
    END;
  END IF;

  RETURN jsonb_build_object(
    'table', p_request_item_table,
    'material_id', NULLIF(p_item->>'material_id', ''),
    'fields', v_fields
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_receiving_material_identity_v1(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receiving_material_identity_v1(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receiving_material_identity_v1(text, jsonb) TO service_role;

DO $migration$
DECLARE
  v_definition text;
  v_empty_anchor text := $anchor$
  IF jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Распределите материал хотя бы на одну машину';
  END IF;
$anchor$;
  v_empty_replacement text := $replacement$
  IF jsonb_array_length(p_allocations) = 0
    AND current_setting('app.receiving_batch_mode', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Распределите материал хотя бы на одну машину';
  END IF;
$replacement$;
  v_status_anchor text := $anchor$
  IF COALESCE(v_source_item->>'order_status', '') <> 'ordered' THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;
$anchor$;
  v_status_replacement text := $replacement$
  IF COALESCE(v_source_item->>'order_status', '') <> 'ordered'
    AND NOT (
      current_setting('app.receiving_batch_mode', true) IS NOT DISTINCT FROM 'on'
      AND COALESCE(v_source_item->>'order_status', '') = 'delivered'
    ) THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;
$replacement$;
  v_variance_anchor text :=
    'IF p_received_quantity < v_schedule.quantity OR p_received_quantity >= v_schedule.quantity * 1.3 THEN';
  v_variance_replacement text :=
    'IF current_setting(''app.receiving_batch_mode'', true) IS DISTINCT FROM ''on'' AND (p_received_quantity < v_schedule.quantity OR p_received_quantity >= v_schedule.quantity * 1.3) THEN';
  v_shortage_anchor text := 'IF p_received_quantity < v_schedule.quantity THEN';
  v_shortage_replacement text :=
    'IF current_setting(''app.receiving_batch_mode'', true) IS DISTINCT FROM ''on'' AND p_received_quantity < v_schedule.quantity THEN';
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure
  ) INTO v_definition;

  IF position(v_empty_anchor IN v_definition) = 0
    OR position(v_status_anchor IN v_definition) = 0
    OR position(v_variance_anchor IN v_definition) = 0
    OR position(v_shortage_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;

  v_definition := replace(v_definition, v_empty_anchor, v_empty_replacement);
  v_definition := replace(v_definition, v_status_anchor, v_status_replacement);
  v_definition := replace(v_definition, v_variance_anchor, v_variance_replacement);
  v_definition := replace(v_definition, v_shortage_anchor, v_shortage_replacement);
  EXECUTE v_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_batch_v1(
  p_receipts jsonb,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_receipt jsonb;
  v_result jsonb;
  v_item jsonb;
  v_first_item jsonb;
  v_identity jsonb;
  v_expected_identity jsonb;
  v_expected_table text;
  v_expected_unit text;
  v_expected_date date;
  v_expected_piece_length numeric;
  v_expected_factory_id uuid;
  v_factory_id uuid;
  v_machine_id uuid;
  v_machine_name text;
  v_anchor_schedule_id uuid;
  v_schedule_id uuid;
  v_received_quantity numeric;
  v_received_piece_length numeric;
  v_received_piece_count numeric;
  v_total_plan numeric := 0;
  v_total_received numeric := 0;
  v_total_allocated numeric := 0;
  v_total_excess numeric := 0;
  v_active_batch_count integer := 0;
  v_unlinked_supplier_mismatch boolean := false;
  v_source_key text;
  v_item_name text;
  v_title text;
  v_description text;
  v_today date;
  v_has_procurement_head boolean;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_receipts IS NULL OR jsonb_typeof(p_receipts) <> 'array'
    OR jsonb_array_length(p_receipts) = 0 THEN
    RAISE EXCEPTION 'Пакет приёмки пуст';
  END IF;
  IF p_performed_by IS NULL THEN RAISE EXCEPTION 'Не указан исполнитель приёмки'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_receipts) AS receipt(value)
    WHERE NULLIF(receipt.value->>'schedule_id', '') IS NULL
      OR COALESCE(NULLIF(receipt.value->>'received_quantity', '')::numeric, -1) < 0
  ) THEN
    RAISE EXCEPTION 'Некорректная строка пакетной приёмки';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_receipts) AS receipt(value)
    GROUP BY receipt.value->>'schedule_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Строка графика указана в пакете несколько раз';
  END IF;

  -- Lock every source schedule in deterministic order before any mutation.
  FOR v_schedule IN
    SELECT schedule.*
    FROM public.supply_order_delivery_schedules AS schedule
    JOIN (
      SELECT (receipt.value->>'schedule_id')::uuid AS id
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    ) AS input ON input.id = schedule.id
    ORDER BY schedule.id
    FOR UPDATE OF schedule
  LOOP
    IF v_schedule.status = 'delivered' THEN RAISE EXCEPTION 'Поставка уже принята'; END IF;
    IF v_schedule.status = 'cancelled' THEN RAISE EXCEPTION 'Поставка отменена'; END IF;
    IF v_schedule.status <> 'planned' THEN RAISE EXCEPTION 'Поставка недоступна для приёмки'; END IF;

    EXECUTE format(
      'SELECT to_jsonb(item) FROM public.%I item WHERE item.id = $1 FOR UPDATE',
      v_schedule.request_item_table
    ) INTO v_item USING v_schedule.request_item_id;
    IF v_item IS NULL THEN RAISE EXCEPTION 'Позиция закупки не найдена'; END IF;
    IF COALESCE(v_item->>'order_status', '') NOT IN ('ordered', 'delivered') THEN
      RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
    END IF;

    SELECT request.machine_id, machine.name, machine.factory_id
    INTO v_machine_id, v_machine_name, v_factory_id
    FROM public.technologist_requests AS request
    JOIN public.machines AS machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_item->>'request_id', '')::uuid;
    IF v_factory_id IS NULL THEN RAISE EXCEPTION 'Для приёмки не определён завод машины'; END IF;

    v_identity := public.fn_receiving_material_identity_v1(v_schedule.request_item_table, v_item);
    IF v_expected_identity IS NULL THEN
      v_anchor_schedule_id := v_schedule.id;
      v_expected_identity := v_identity;
      v_expected_table := v_schedule.request_item_table;
      v_expected_unit := v_schedule.unit;
      v_expected_date := v_schedule.delivery_date;
      v_expected_piece_length := v_schedule.planned_piece_length_mm;
      v_expected_factory_id := v_factory_id;
      v_first_item := v_item;
    ELSIF v_identity IS DISTINCT FROM v_expected_identity
      OR v_schedule.request_item_table IS DISTINCT FROM v_expected_table
      OR v_schedule.unit IS DISTINCT FROM v_expected_unit
      OR v_schedule.delivery_date IS DISTINCT FROM v_expected_date
      OR v_schedule.planned_piece_length_mm IS DISTINCT FROM v_expected_piece_length
      OR v_factory_id IS DISTINCT FROM v_expected_factory_id THEN
      RAISE EXCEPTION 'В одну приёмку попали разные материалы, даты, длины или заводы';
    END IF;
    v_total_plan := v_total_plan + v_schedule.quantity;
  END LOOP;

  IF (SELECT count(*) FROM jsonb_array_elements(p_receipts)) <> (
    SELECT count(*)
    FROM public.supply_order_delivery_schedules AS schedule
    JOIN (
      SELECT (receipt.value->>'schedule_id')::uuid AS id
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    ) AS input ON input.id = schedule.id
  ) THEN
    RAISE EXCEPTION 'Одна из строк поставки не найдена';
  END IF;

  SELECT schedule.* INTO STRICT v_schedule
  FROM public.supply_order_delivery_schedules AS schedule
  WHERE schedule.id IN (
    SELECT (receipt.value->>'schedule_id')::uuid
    FROM jsonb_array_elements(p_receipts) AS receipt(value)
  )
  ORDER BY schedule.created_at, schedule.id
  LIMIT 1;
  v_anchor_schedule_id := v_schedule.id;
  EXECUTE format(
    'SELECT to_jsonb(item) FROM public.%I item WHERE item.id = $1',
    v_schedule.request_item_table
  ) INTO v_first_item USING v_schedule.request_item_id;
  SELECT request.machine_id, machine.name
  INTO v_machine_id, v_machine_name
  FROM public.technologist_requests AS request
  JOIN public.machines AS machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_first_item->>'request_id', '')::uuid;

  SELECT count(DISTINCT (link.transport_order_id::text || ':' || COALESCE(link.delivery_stop_id::text, 'no-stop')))
  INTO v_active_batch_count
  FROM public.transport_trip_need_links AS link
  JOIN public.machine_outsourcing_transport_orders AS trip ON trip.id = link.transport_order_id
  WHERE link.need_source = 'supply_schedule'
    AND link.released_at IS NULL
    AND trip.status <> 'cancelled'
    AND link.need_id IN (
      SELECT (receipt.value->>'schedule_id')::uuid
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    );
  IF v_active_batch_count > 1 THEN
    RAISE EXCEPTION 'В одну приёмку попали поставки из разных рейсов или точек разгрузки';
  END IF;

  IF v_active_batch_count = 0 AND (
    SELECT count(DISTINCT COALESCE(schedule.supplier_id::text, 'no-supplier'))
    FROM public.supply_order_delivery_schedules AS schedule
    WHERE schedule.id IN (
      SELECT (receipt.value->>'schedule_id')::uuid
      FROM jsonb_array_elements(p_receipts) AS receipt(value)
    )
  ) > 1 THEN
    RAISE EXCEPTION 'Поставки без рейса должны относиться к одному поставщику';
  END IF;

  IF v_active_batch_count = 1 THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.supply_order_delivery_schedules AS schedule
      WHERE schedule.id IN (
        SELECT (receipt.value->>'schedule_id')::uuid
        FROM jsonb_array_elements(p_receipts) AS receipt(value)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.transport_trip_need_links AS own_link
        JOIN public.machine_outsourcing_transport_orders AS own_trip
          ON own_trip.id = own_link.transport_order_id AND own_trip.status <> 'cancelled'
        WHERE own_link.need_source = 'supply_schedule'
          AND own_link.need_id = schedule.id
          AND own_link.released_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.supply_order_delivery_schedules AS linked_schedule
        JOIN public.transport_trip_need_links AS linked
          ON linked.need_source = 'supply_schedule'
          AND linked.need_id = linked_schedule.id
          AND linked.released_at IS NULL
        JOIN public.machine_outsourcing_transport_orders AS linked_trip
          ON linked_trip.id = linked.transport_order_id AND linked_trip.status <> 'cancelled'
        WHERE linked_schedule.id IN (
          SELECT (receipt.value->>'schedule_id')::uuid
          FROM jsonb_array_elements(p_receipts) AS receipt(value)
        )
          AND linked_schedule.supplier_id IS NOT DISTINCT FROM schedule.supplier_id
      )
    ) INTO v_unlinked_supplier_mismatch;
    IF v_unlinked_supplier_mismatch THEN
      RAISE EXCEPTION 'Техническая строка без рейса не соответствует поставщику физической партии';
    END IF;
  END IF;

  SELECT COALESCE(sum((receipt.value->>'received_quantity')::numeric), 0)
  INTO v_total_received
  FROM jsonb_array_elements(p_receipts) AS receipt(value);
  IF v_total_received <= 0 THEN RAISE EXCEPTION 'Фактическое количество прихода должно быть больше 0'; END IF;

  PERFORM set_config('app.receiving_batch_mode', 'on', true);
  FOR v_receipt IN
    SELECT receipt.value
    FROM jsonb_array_elements(p_receipts) WITH ORDINALITY AS receipt(value, ordinal)
    ORDER BY receipt.ordinal
  LOOP
    v_schedule_id := (v_receipt->>'schedule_id')::uuid;
    v_received_quantity := COALESCE(NULLIF(v_receipt->>'received_quantity', '')::numeric, 0);
    v_received_piece_length := NULLIF(v_receipt->>'received_piece_length_mm', '')::numeric;
    v_received_piece_count := NULLIF(v_receipt->>'received_piece_count', '')::numeric;

    IF v_received_quantity <= 0 THEN
      UPDATE public.supply_order_delivery_schedules
      SET status = 'cancelled',
          received_quantity = 0,
          allocated_quantity = 0,
          allocated_physical_quantity = 0,
          excess_quantity = 0,
          change_reason = concat_ws('. ', NULLIF(change_reason, ''), 'Не получено при пакетной приёмке'),
          updated_by = p_performed_by,
          updated_at = now()
      WHERE id = v_schedule_id;
      CONTINUE;
    END IF;

    SELECT public.fn_receive_supply_order_schedule_v2(
      v_schedule_id,
      p_performed_by,
      v_received_quantity,
      COALESCE(v_receipt->'allocations', '[]'::jsonb),
      v_received_piece_length,
      v_received_piece_count
    ) INTO v_result;
    v_total_allocated := v_total_allocated + COALESCE((v_result->>'allocated_physical_quantity')::numeric, 0);
    v_total_excess := v_total_excess + COALESCE((v_result->>'excess_quantity')::numeric, 0);
    v_results := v_results || jsonb_build_array(v_result || jsonb_build_object('schedule_id', v_schedule_id));
  END LOOP;
  PERFORM set_config('app.receiving_batch_mode', 'off', true);

  v_item_name := CASE v_expected_table
    WHEN 'request_sheet_metal' THEN COALESCE(NULLIF(v_first_item->>'material_name', ''), 'Листовой металл')
    WHEN 'request_round_tube' THEN COALESCE(NULLIF(v_first_item->>'material_name', ''), 'Круг / Труба')
    WHEN 'request_circle' THEN COALESCE(NULLIF(v_first_item->>'steel_grade', ''), 'Круг')
    WHEN 'request_pipe' THEN COALESCE(NULLIF(v_first_item->>'size', ''), 'Труба')
    WHEN 'request_knives' THEN COALESCE(NULLIF(v_first_item->>'knife_type', ''), 'Ножи')
    WHEN 'request_components' THEN COALESCE(NULLIF(v_first_item->>'component_name', ''), 'Комплектация')
    WHEN 'request_paint' THEN COALESCE(NULLIF(v_first_item->>'paint_type', ''), NULLIF(v_first_item->>'ral_code', ''), 'Краска')
    WHEN 'request_mesh' THEN COALESCE(NULLIF(v_first_item->>'description', ''), 'Сетка')
    WHEN 'request_chain_cord' THEN COALESCE(NULLIF(v_first_item->>'parameters', ''), 'Цепь / Шнур')
    ELSE 'Материал'
  END;

  IF v_total_received < v_total_plan OR v_total_received >= v_total_plan * 1.3 THEN
    v_source_key := 'material_receipt_batch_variance:' || md5(
      (SELECT string_agg(receipt.value->>'schedule_id', ',' ORDER BY receipt.value->>'schedule_id')
       FROM jsonb_array_elements(p_receipts) AS receipt(value))
    );
    v_title := CASE
      WHEN v_total_received < v_total_plan THEN 'Недовес при приёмке материала'
      ELSE 'Перепоставка материала +30%'
    END;
    v_description := concat(
      v_item_name,
      CASE WHEN v_machine_name IS NOT NULL THEN ' для машины ' || v_machine_name ELSE '' END,
      '. Дата снабжения: ', to_char(v_expected_date, 'DD.MM.YYYY'),
      '. План партии: ', v_total_plan::text, ' ', v_expected_unit,
      '. Факт партии: ', v_total_received::text, ' ', v_expected_unit,
      '. На потребности распределено: ', v_total_allocated::text, ' ', v_expected_unit,
      '. Свободный излишек на складе: ', v_total_excess::text, ' ', v_expected_unit, '.'
    );

    INSERT INTO public.meeting_agenda_pool_items (
      source_key, source_type, machine_id, title, description, status, updated_at
    ) VALUES (
      v_source_key, 'material_receipt_variance', v_machine_id,
      v_title, v_description, 'new', now()
    )
    ON CONFLICT (source_key) DO UPDATE
    SET title = EXCLUDED.title,
        description = EXCLUDED.description,
        machine_id = EXCLUDED.machine_id,
        updated_at = now()
    WHERE meeting_agenda_pool_items.status = 'new';

    INSERT INTO public.notifications (user_id, type, title, message, related_machine_id)
    SELECT id, 'material_receipt_variance', v_title, v_description, v_machine_id
    FROM public.users
    WHERE role = 'planning_director' AND is_active = true;
  END IF;

  IF v_total_received < v_total_plan THEN
    v_today := (now() AT TIME ZONE 'Europe/Chisinau')::date;
    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE role = 'procurement_head' AND is_active = true
    ) INTO v_has_procurement_head;

    INSERT INTO public.tasks (
      machine_id, supply_order_schedule_id, assigned_to, task_type,
      title, description, status, start_date, deadline
    )
    SELECT v_machine_id, v_anchor_schedule_id, user_row.id,
      'supply_material_receipt_shortage'::public.task_type,
      'Разобрать недовес по поставке', v_description, 'pending', v_today, v_today
    FROM public.users AS user_row
    WHERE user_row.is_active = true
      AND ((v_has_procurement_head AND user_row.role = 'procurement_head')
        OR (NOT v_has_procurement_head AND user_row.role = 'supply_manager'))
    ON CONFLICT (supply_order_schedule_id, assigned_to, task_type)
      WHERE supply_order_schedule_id IS NOT NULL
        AND status IN ('pending', 'in_progress')
    DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'schedule_ids', (SELECT jsonb_agg(receipt.value->>'schedule_id') FROM jsonb_array_elements(p_receipts) AS receipt(value)),
    'planned_quantity', v_total_plan,
    'received_quantity', v_total_received,
    'allocated_physical_quantity', v_total_allocated,
    'excess_quantity', v_total_excess,
    'receipts', v_results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_batch_v1(jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_batch_v1(jsonb, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_batch_v1(jsonb, uuid) TO service_role;
