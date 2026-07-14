-- A physical receipt may close several matching demand rows. Keep the physical
-- amount received on the source schedule and the logical demand allocation on
-- every affected schedule. This is especially important for knives: one
-- 12 000 mm bar can close a 6 000 mm demand while the whole bar is reserved.

ALTER TABLE public.supply_order_delivery_schedules
  ADD COLUMN IF NOT EXISTS allocated_quantity numeric,
  ADD COLUMN IF NOT EXISTS allocated_physical_quantity numeric,
  ADD COLUMN IF NOT EXISTS received_piece_length_mm numeric,
  ADD COLUMN IF NOT EXISTS received_piece_count numeric,
  ADD COLUMN IF NOT EXISTS allocated_piece_count numeric,
  ADD COLUMN IF NOT EXISTS excess_quantity numeric,
  ADD COLUMN IF NOT EXISTS receipt_inventory_id uuid REFERENCES public.inventory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receipt_parent_schedule_id uuid
    REFERENCES public.supply_order_delivery_schedules(id) ON DELETE SET NULL;

ALTER TABLE public.supply_order_delivery_schedules
  DROP CONSTRAINT IF EXISTS supply_order_delivery_schedules_allocated_quantity_check;
ALTER TABLE public.supply_order_delivery_schedules
  ADD CONSTRAINT supply_order_delivery_schedules_allocated_quantity_check
  CHECK (allocated_quantity IS NULL OR allocated_quantity >= 0);

ALTER TABLE public.supply_order_delivery_schedules
  DROP CONSTRAINT IF EXISTS supply_order_delivery_schedules_allocated_physical_check;
ALTER TABLE public.supply_order_delivery_schedules
  ADD CONSTRAINT supply_order_delivery_schedules_allocated_physical_check
  CHECK (allocated_physical_quantity IS NULL OR allocated_physical_quantity >= 0);

ALTER TABLE public.supply_order_delivery_schedules
  DROP CONSTRAINT IF EXISTS supply_order_delivery_schedules_piece_values_check;
ALTER TABLE public.supply_order_delivery_schedules
  ADD CONSTRAINT supply_order_delivery_schedules_piece_values_check
  CHECK (
    (received_piece_length_mm IS NULL OR received_piece_length_mm > 0)
    AND (received_piece_count IS NULL OR received_piece_count > 0)
    AND (allocated_piece_count IS NULL OR allocated_piece_count >= 0)
    AND (excess_quantity IS NULL OR excess_quantity >= 0)
  );

CREATE INDEX IF NOT EXISTS idx_supply_order_schedules_receipt_parent
  ON public.supply_order_delivery_schedules(receipt_parent_schedule_id)
  WHERE receipt_parent_schedule_id IS NOT NULL;

UPDATE public.supply_order_delivery_schedules
SET allocated_quantity = COALESCE(received_quantity, quantity),
    allocated_physical_quantity = COALESCE(received_quantity, quantity),
    excess_quantity = 0
WHERE status = 'delivered'
  AND allocated_quantity IS NULL;

CREATE OR REPLACE FUNCTION public.fn_supply_item_required_quantity(
  p_table text,
  p_item jsonb
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT GREATEST(COALESCE(CASE p_table
    WHEN 'request_sheet_metal' THEN
      COALESCE(
        NULLIF(p_item->>'remainder_qty', '')::numeric,
        NULLIF(p_item->>'to_order_kg', '')::numeric,
        0
      )
    WHEN 'request_round_tube' THEN
      COALESCE(
        NULLIF(p_item->>'order_kg', '')::numeric,
        NULLIF(p_item->>'remainder_kg', '')::numeric,
        NULLIF(p_item->>'calculated_weight_kg', '')::numeric,
        0
      ) - COALESCE(NULLIF(p_item->>'reserved_from_stock_kg', '')::numeric, 0)
    WHEN 'request_circle' THEN
      COALESCE(NULLIF(p_item->>'remainder_mm', '')::numeric, 0)
        - COALESCE(NULLIF(p_item->>'reserved_from_stock_mm', '')::numeric, 0)
    WHEN 'request_pipe' THEN CASE
      WHEN p_item->>'pipe_type' = 'wire' THEN
        COALESCE(NULLIF(p_item->>'remainder_kg', '')::numeric, 0)
          - COALESCE(NULLIF(p_item->>'reserved_from_stock_kg', '')::numeric, 0)
      ELSE
        COALESCE(NULLIF(p_item->>'remainder_length_mm', '')::numeric, 0)
          - COALESCE(NULLIF(p_item->>'reserved_from_stock_length_mm', '')::numeric, 0)
    END
    WHEN 'request_knives' THEN CASE
      WHEN COALESCE(NULLIF(p_item->>'remainder_meters', '')::numeric, 0) > 0 THEN
        COALESCE(NULLIF(p_item->>'remainder_meters', '')::numeric, 0) * 1000
      ELSE COALESCE(NULLIF(p_item->>'to_order_mm', '')::numeric, 0)
    END - COALESCE(NULLIF(p_item->>'reserved_from_stock_mm', '')::numeric, 0)
    WHEN 'request_components' THEN
      COALESCE(NULLIF(p_item->>'quantity_needed', '')::numeric, 0)
        - COALESCE(NULLIF(p_item->>'stock_remainder', '')::numeric, 0)
        - COALESCE(NULLIF(p_item->>'reserved_from_stock', '')::numeric, 0)
    WHEN 'request_paint' THEN
      COALESCE(
        NULLIF(p_item->>'remainder_kg', '')::numeric,
        NULLIF(p_item->>'to_order_kg', '')::numeric,
        0
      ) - COALESCE(NULLIF(p_item->>'reserved_from_stock_kg', '')::numeric, 0)
    WHEN 'request_mesh' THEN
      COALESCE(NULLIF(p_item->>'remainder_qty', '')::numeric, 0)
        - COALESCE(NULLIF(p_item->>'reserved_from_stock_qty', '')::numeric, 0)
    WHEN 'request_chain_cord' THEN
      (COALESCE(NULLIF(p_item->>'remainder_meters', '')::numeric, 0)
        - COALESCE(NULLIF(p_item->>'reserved_from_stock_meters', '')::numeric, 0)) * 1000
    ELSE 0
  END, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.fn_supply_item_required_quantity(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_supply_item_required_quantity(text, jsonb) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_receive_supply_order_schedule_v2(
  p_schedule_id uuid,
  p_performed_by uuid,
  p_received_quantity numeric,
  p_allocations jsonb,
  p_received_piece_length_mm numeric DEFAULT NULL,
  p_received_piece_count numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_source_item jsonb;
  v_target_item jsonb;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_target_material_id uuid;
  v_target_material_variant_id uuid;
  v_supplier_id uuid;
  v_factory_id uuid;
  v_machine_id uuid;
  v_machine_name text;
  v_target_machine_id uuid;
  v_target_factory_id uuid;
  v_inventory_id uuid;
  v_secondary_quantity numeric;
  v_secondary_unit text;
  v_allocation jsonb;
  v_allocation_table text;
  v_allocation_id uuid;
  v_allocation_quantity numeric;
  v_allocation_physical numeric;
  v_allocation_pieces numeric;
  v_allocation_schedule_id uuid;
  v_source_allocated numeric := 0;
  v_source_physical numeric := 0;
  v_source_pieces numeric := 0;
  v_total_physical numeric := 0;
  v_delivered_total numeric;
  v_required numeric;
  v_item_name text;
  v_title text;
  v_description text;
  v_source_key text;
  v_today date;
  v_has_procurement_head boolean;
BEGIN
  IF COALESCE(p_received_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'Фактическое количество прихода должно быть больше 0';
  END IF;
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Некорректное распределение поставки';
  END IF;

  SELECT * INTO v_schedule
  FROM public.supply_order_delivery_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Дата поставки не найдена'; END IF;
  IF v_schedule.status = 'delivered' THEN RAISE EXCEPTION 'Поставка уже принята'; END IF;
  IF v_schedule.status = 'cancelled' THEN RAISE EXCEPTION 'Поставка отменена'; END IF;

  IF v_schedule.request_item_table NOT IN (
    'request_sheet_metal', 'request_round_tube', 'request_circle',
    'request_pipe', 'request_knives', 'request_components',
    'request_paint', 'request_mesh', 'request_chain_cord'
  ) THEN
    RAISE EXCEPTION 'Некорректная таблица позиции закупки';
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', v_schedule.request_item_table)
    INTO v_source_item USING v_schedule.request_item_id;
  IF v_source_item IS NULL THEN RAISE EXCEPTION 'Позиция закупки не найдена'; END IF;
  IF COALESCE(v_source_item->>'order_status', '') <> 'ordered' THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;

  v_material_id := NULLIF(v_source_item->>'material_id', '')::uuid;
  v_material_variant_id := NULLIF(v_source_item->>'material_variant_id', '')::uuid;
  v_supplier_id := COALESCE(v_schedule.supplier_id, NULLIF(v_source_item->>'supplier_id', '')::uuid);
  IF v_material_id IS NULL THEN RAISE EXCEPTION 'Позиция не привязана к материалу'; END IF;
  IF v_supplier_id IS NULL THEN RAISE EXCEPTION 'Назначьте поставщика для поставки'; END IF;

  SELECT request.machine_id, machine.name, machine.factory_id
  INTO v_machine_id, v_machine_name, v_factory_id
  FROM public.technologist_requests request
  JOIN public.machines machine ON machine.id = request.machine_id
  WHERE request.id = NULLIF(v_source_item->>'request_id', '')::uuid;
  IF v_factory_id IS NULL THEN RAISE EXCEPTION 'Для приемки не определен завод машины'; END IF;

  IF v_schedule.request_item_table = 'request_knives' THEN
    IF COALESCE(p_received_piece_length_mm, 0) <= 0
      OR COALESCE(p_received_piece_count, 0) <= 0
      OR trunc(p_received_piece_count) <> p_received_piece_count THEN
      RAISE EXCEPTION 'Для ножей укажите длину бруска и целое количество брусков';
    END IF;
    IF abs(p_received_quantity - p_received_piece_length_mm * p_received_piece_count) > 0.000001 THEN
      RAISE EXCEPTION 'Общая длина ножей должна равняться длине бруска, умноженной на количество';
    END IF;
    v_secondary_quantity := p_received_piece_count;
    v_secondary_unit := 'шт';
  ELSE
    IF p_received_piece_length_mm IS NOT NULL OR p_received_piece_count IS NOT NULL THEN
      RAISE EXCEPTION 'Параметры бруска допустимы только для ножей';
    END IF;
    v_secondary_quantity := NULL;
    v_secondary_unit := NULL;
  END IF;

  v_inventory_id := public.fn_add_inventory_receipt(
    p_material_id := v_material_id,
    p_quantity := p_received_quantity,
    p_unit := v_schedule.unit,
    p_performed_by := p_performed_by,
    p_comment := 'Приход по графику поставки: ' || v_schedule.delivery_date::text
      || '. План: ' || v_schedule.quantity::text || ', факт: ' || p_received_quantity::text,
    p_secondary_quantity := v_secondary_quantity,
    p_secondary_unit := v_secondary_unit,
    p_supplier_id := v_supplier_id,
    p_material_variant_id := v_material_variant_id,
    p_piece_length_mm := p_received_piece_length_mm,
    p_factory_id := v_factory_id
  );

  FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_allocations)
  LOOP
    v_allocation_table := NULLIF(v_allocation->>'table', '');
    v_allocation_id := NULLIF(v_allocation->>'id', '')::uuid;
    v_allocation_quantity := COALESCE(NULLIF(v_allocation->>'quantity', '')::numeric, 0);
    v_allocation_physical := COALESCE(NULLIF(v_allocation->>'physical_quantity', '')::numeric, v_allocation_quantity);
    v_allocation_pieces := NULLIF(v_allocation->>'piece_count', '')::numeric;

    IF v_allocation_table IS DISTINCT FROM v_schedule.request_item_table
      OR v_allocation_id IS NULL
      OR v_allocation_quantity <= 0
      OR v_allocation_physical <= 0
      OR v_allocation_quantity > v_allocation_physical + 0.000001 THEN
      RAISE EXCEPTION 'Некорректная строка распределения поставки';
    END IF;
    IF v_schedule.request_item_table = 'request_knives' AND (
      COALESCE(v_allocation_pieces, 0) <= 0
      OR trunc(v_allocation_pieces) <> v_allocation_pieces
      OR abs(v_allocation_physical - v_allocation_pieces * p_received_piece_length_mm) > 0.000001
    ) THEN
      RAISE EXCEPTION 'Некорректное распределение брусков ножа';
    END IF;

    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 FOR UPDATE', v_allocation_table)
      INTO v_target_item USING v_allocation_id;
    IF v_target_item IS NULL THEN RAISE EXCEPTION 'Позиция распределения не найдена'; END IF;
    IF COALESCE(v_target_item->>'order_status', '') NOT IN ('pending', 'ordered') THEN
      RAISE EXCEPTION 'Потребность уже закрыта или недоступна для распределения';
    END IF;

    v_target_material_id := NULLIF(v_target_item->>'material_id', '')::uuid;
    v_target_material_variant_id := NULLIF(v_target_item->>'material_variant_id', '')::uuid;
    IF v_target_material_id IS DISTINCT FROM v_material_id
      OR v_target_material_variant_id IS DISTINCT FROM v_material_variant_id THEN
      RAISE EXCEPTION 'Нельзя распределить приход на другой материал или вариант';
    END IF;

    SELECT request.machine_id, machine.factory_id
    INTO v_target_machine_id, v_target_factory_id
    FROM public.technologist_requests request
    JOIN public.machines machine ON machine.id = request.machine_id
    WHERE request.id = NULLIF(v_target_item->>'request_id', '')::uuid;
    IF v_target_factory_id IS DISTINCT FROM v_factory_id THEN
      RAISE EXCEPTION 'Нельзя распределить приход между разными заводами';
    END IF;

    IF v_allocation_id = v_schedule.request_item_id THEN
      v_allocation_schedule_id := p_schedule_id;
      v_source_allocated := v_source_allocated + v_allocation_quantity;
      v_source_physical := v_source_physical + v_allocation_physical;
      v_source_pieces := v_source_pieces + COALESCE(v_allocation_pieces, 0);
      UPDATE public.supply_order_delivery_schedules
      SET status = 'delivered',
          allocated_quantity = v_source_allocated,
          allocated_physical_quantity = v_source_physical,
          allocated_piece_count = CASE
            WHEN p_received_piece_count IS NULL THEN NULL ELSE v_source_pieces
          END,
          updated_by = p_performed_by,
          updated_at = now()
      WHERE id = p_schedule_id;
    ELSE
      INSERT INTO public.supply_order_delivery_schedules (
        request_item_table, request_item_id, delivery_date, quantity, unit,
        supplier_id, status, received_quantity, allocated_quantity,
        allocated_physical_quantity, received_piece_length_mm,
        allocated_piece_count, delivered_at, received_by, created_by,
        updated_by, receipt_inventory_id, receipt_parent_schedule_id
      ) VALUES (
        v_allocation_table, v_allocation_id, v_schedule.delivery_date,
        v_allocation_quantity, v_schedule.unit, v_supplier_id, 'delivered', 0,
        v_allocation_quantity, v_allocation_physical,
        p_received_piece_length_mm, v_allocation_pieces, now(), p_performed_by,
        p_performed_by, p_performed_by, v_inventory_id, p_schedule_id
      ) RETURNING id INTO v_allocation_schedule_id;
    END IF;

    INSERT INTO public.inventory_reservations (
      inventory_id, material_id, material_variant_id, machine_id,
      request_item_table, request_item_id, reserved_quantity,
      reserved_secondary_quantity, reserved_by, original_piece_length_mm,
      is_cut_reservation, reservation_source, supply_order_schedule_id
    ) VALUES (
      v_inventory_id, v_material_id, v_material_variant_id, v_target_machine_id,
      v_allocation_table, v_allocation_id, v_allocation_physical,
      v_allocation_pieces, p_performed_by, p_received_piece_length_mm,
      false, 'supply_receipt', v_allocation_schedule_id
    );

    UPDATE public.inventory
    SET reserved_quantity = reserved_quantity + v_allocation_physical,
        reserved_secondary_quantity = CASE
          WHEN v_allocation_pieces IS NULL THEN reserved_secondary_quantity
          ELSE COALESCE(reserved_secondary_quantity, 0) + v_allocation_pieces
        END,
        last_updated_by = p_performed_by,
        updated_at = now()
    WHERE id = v_inventory_id;

    INSERT INTO public.inventory_transactions (
      factory_id, inventory_id, material_id, material_variant_id,
      transaction_type, quantity, secondary_quantity, machine_id,
      request_item_table, request_item_id, performed_by, comment
    ) VALUES (
      v_factory_id, v_inventory_id, v_material_id, v_material_variant_id,
      'reserve'::public.inventory_transaction_type, v_allocation_physical,
      v_allocation_pieces, v_target_machine_id, v_allocation_table,
      v_allocation_id, p_performed_by,
      'Распределено из принятой поставки по ближайшей дате заготовки'
    );

    v_total_physical := v_total_physical + v_allocation_physical;

    SELECT COALESCE(sum(COALESCE(allocated_quantity, received_quantity, quantity)), 0)
    INTO v_delivered_total
    FROM public.supply_order_delivery_schedules
    WHERE request_item_table = v_allocation_table
      AND request_item_id = v_allocation_id
      AND status = 'delivered';

    v_required := public.fn_supply_item_required_quantity(v_allocation_table, v_target_item);
    IF v_delivered_total >= v_required - 0.000001 THEN
      EXECUTE format(
        'UPDATE public.%I SET order_status = $1, delivered_at = now(), supplier_id = COALESCE(supplier_id, $2) WHERE id = $3',
        v_allocation_table
      ) USING 'delivered'::public.order_item_status, v_supplier_id, v_allocation_id;
    ELSIF COALESCE(v_target_item->>'order_status', '') = 'pending' THEN
      EXECUTE format(
        'UPDATE public.%I SET order_status = $1, ordered_at = COALESCE(ordered_at, now()), supplier_id = COALESCE(supplier_id, $2) WHERE id = $3',
        v_allocation_table
      ) USING 'ordered'::public.order_item_status, v_supplier_id, v_allocation_id;
    END IF;
  END LOOP;

  IF v_total_physical > p_received_quantity + 0.000001 THEN
    RAISE EXCEPTION 'Распределение превышает фактически принятый объем';
  END IF;

  UPDATE public.supply_order_delivery_schedules
  SET status = CASE WHEN v_source_allocated > 0 THEN 'delivered' ELSE 'cancelled' END,
      received_quantity = p_received_quantity,
      allocated_quantity = v_source_allocated,
      allocated_physical_quantity = v_source_physical,
      received_piece_length_mm = p_received_piece_length_mm,
      received_piece_count = p_received_piece_count,
      allocated_piece_count = CASE WHEN p_received_piece_count IS NULL THEN NULL ELSE v_source_pieces END,
      excess_quantity = GREATEST(p_received_quantity - v_total_physical, 0),
      receipt_inventory_id = v_inventory_id,
      delivered_at = now(),
      received_by = p_performed_by,
      updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_schedule_id;

  v_item_name := CASE v_schedule.request_item_table
    WHEN 'request_sheet_metal' THEN COALESCE(NULLIF(v_source_item->>'material_name', ''), 'Листовой металл')
    WHEN 'request_round_tube' THEN COALESCE(NULLIF(v_source_item->>'material_name', ''), 'Круг / Труба')
    WHEN 'request_circle' THEN COALESCE(NULLIF(v_source_item->>'steel_grade', ''), 'Круг')
    WHEN 'request_pipe' THEN COALESCE(NULLIF(v_source_item->>'size', ''), 'Труба')
    WHEN 'request_knives' THEN COALESCE(NULLIF(v_source_item->>'knife_type', ''), 'Ножи')
    WHEN 'request_components' THEN COALESCE(NULLIF(v_source_item->>'component_name', ''), 'Комплектация')
    WHEN 'request_paint' THEN COALESCE(NULLIF(v_source_item->>'paint_type', ''), NULLIF(v_source_item->>'ral_code', ''), 'Краска')
    WHEN 'request_mesh' THEN COALESCE(NULLIF(v_source_item->>'description', ''), 'Сетка')
    WHEN 'request_chain_cord' THEN COALESCE(NULLIF(v_source_item->>'parameters', ''), 'Цепь / Шнур')
    ELSE 'Материал'
  END;

  IF p_received_quantity < v_schedule.quantity OR p_received_quantity >= v_schedule.quantity * 1.3 THEN
    v_source_key := 'material_receipt_variance:' || p_schedule_id::text;
    v_title := CASE
      WHEN p_received_quantity < v_schedule.quantity THEN 'Недовес при приемке материала'
      ELSE 'Перепоставка материала +30%'
    END;
    v_description := concat(
      v_item_name,
      CASE WHEN v_machine_name IS NOT NULL THEN ' для машины ' || v_machine_name ELSE '' END,
      '. Дата снабжения: ', to_char(v_schedule.delivery_date, 'DD.MM.YYYY'),
      '. План: ', v_schedule.quantity::text, ' ', v_schedule.unit,
      '. Факт: ', p_received_quantity::text, ' ', v_schedule.unit,
      '. На потребности распределено: ', v_total_physical::text, ' ', v_schedule.unit,
      '. Свободный излишек на складе: ', GREATEST(p_received_quantity - v_total_physical, 0)::text, ' ', v_schedule.unit, '.'
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

  IF p_received_quantity < v_schedule.quantity THEN
    v_today := (now() AT TIME ZONE 'Europe/Chisinau')::date;
    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE role = 'procurement_head' AND is_active = true
    ) INTO v_has_procurement_head;

    INSERT INTO public.tasks (
      machine_id, supply_order_schedule_id, assigned_to, task_type,
      title, description, status, start_date, deadline
    )
    SELECT v_machine_id, p_schedule_id, user_row.id,
      'supply_material_receipt_shortage'::public.task_type,
      'Разобрать недовес по поставке', v_description, 'pending', v_today, v_today
    FROM public.users user_row
    WHERE user_row.is_active = true
      AND ((v_has_procurement_head AND user_row.role = 'procurement_head')
        OR (NOT v_has_procurement_head AND user_row.role = 'supply_manager'))
    ON CONFLICT (supply_order_schedule_id, assigned_to, task_type)
      WHERE supply_order_schedule_id IS NOT NULL
        AND status IN ('pending', 'in_progress')
    DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'inventory_id', v_inventory_id,
    'received_quantity', p_received_quantity,
    'allocated_physical_quantity', v_total_physical,
    'excess_quantity', GREATEST(p_received_quantity - v_total_physical, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) TO service_role;
