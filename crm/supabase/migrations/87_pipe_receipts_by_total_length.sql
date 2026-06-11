CREATE OR REPLACE FUNCTION fn_mark_supply_order_delivered(
  p_items jsonb,
  p_performed_by uuid
)
RETURNS void AS $$
DECLARE
  v_item jsonb;
  v_table text;
  v_id uuid;
  v_row record;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_supplier_id uuid;
  v_quantity numeric;
  v_unit text;
  v_secondary_quantity numeric;
  v_secondary_unit text;
  v_piece_length_mm numeric;
  v_comment text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Выберите позиции';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_table := v_item->>'table';
    v_id := NULLIF(v_item->>'id', '')::uuid;

    IF v_table NOT IN (
      'request_sheet_metal',
      'request_round_tube',
      'request_circle',
      'request_pipe',
      'request_knives',
      'request_components',
      'request_paint',
      'request_mesh',
      'request_chain_cord'
    ) THEN
      RAISE EXCEPTION 'Некорректная таблица позиции';
    END IF;

    EXECUTE format('SELECT * FROM %I WHERE id = $1 FOR UPDATE', v_table)
      INTO v_row
      USING v_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Позиция закупки не найдена';
    END IF;

    IF v_row.order_status <> 'ordered' THEN
      RAISE EXCEPTION 'Позицию можно принять только после отметки "Заказано"';
    END IF;

    v_material_id := COALESCE(NULLIF(v_item->>'material_id', '')::uuid, v_row.material_id);
    v_material_variant_id := COALESCE(NULLIF(v_item->>'material_variant_id', '')::uuid, v_row.material_variant_id);
    v_supplier_id := COALESCE(NULLIF(v_item->>'supplier_id', '')::uuid, v_row.supplier_id);
    v_quantity := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit := COALESCE(NULLIF(v_item->>'unit', ''), 'кг');
    v_secondary_quantity := NULLIF(v_item->>'secondary_quantity', '')::numeric;
    v_secondary_unit := NULLIF(v_item->>'secondary_unit', '');
    v_piece_length_mm := NULLIF(v_item->>'piece_length_mm', '')::numeric;
    v_comment := NULLIF(v_item->>'comment', '');

    IF v_material_id IS NULL THEN
      RAISE EXCEPTION 'Позиция не привязана к материалу';
    END IF;

    IF v_quantity <= 0 THEN
      RAISE EXCEPTION 'Позиция полностью закрыта складом и не требует закупки';
    END IF;

    IF v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'Назначьте поставщика для позиции';
    END IF;

    IF v_table = 'request_knives' AND (v_piece_length_mm IS NULL OR v_piece_length_mm <= 0) THEN
      RAISE EXCEPTION 'Для ножа не указана длина складской позиции';
    END IF;

    PERFORM fn_add_inventory_receipt(
      v_material_id,
      v_quantity,
      v_unit,
      p_performed_by,
      COALESCE(v_comment, 'Приход по листу закупки'),
      v_secondary_quantity,
      v_secondary_unit,
      v_supplier_id,
      v_material_variant_id,
      v_piece_length_mm
    );

    EXECUTE format('UPDATE %I SET order_status = $1, delivered_at = now(), supplier_id = $2 WHERE id = $3', v_table)
      USING 'delivered'::order_item_status, v_supplier_id, v_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_receive_supply_order_schedule(
  p_schedule_id uuid,
  p_performed_by uuid
)
RETURNS void AS $$
DECLARE
  v_schedule supply_order_delivery_schedules%ROWTYPE;
  v_item record;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_supplier_id uuid;
  v_piece_length_mm numeric;
  v_secondary_quantity numeric;
  v_secondary_unit text;
  v_required numeric;
  v_delivered_total numeric;
BEGIN
  SELECT * INTO v_schedule
  FROM supply_order_delivery_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Дата поставки не найдена';
  END IF;

  IF v_schedule.status = 'delivered' THEN
    RAISE EXCEPTION 'Поставка уже принята';
  END IF;

  IF v_schedule.quantity <= 0 THEN
    RAISE EXCEPTION 'Количество поставки должно быть больше 0';
  END IF;

  EXECUTE format('SELECT * FROM %I WHERE id = $1 FOR UPDATE', v_schedule.request_item_table)
    INTO v_item
    USING v_schedule.request_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Позиция закупки не найдена';
  END IF;

  IF v_item.order_status <> 'ordered' THEN
    RAISE EXCEPTION 'Поставку можно принять только после отметки позиции "Заказано"';
  END IF;

  v_material_id := v_item.material_id;
  v_material_variant_id := v_item.material_variant_id;
  v_supplier_id := COALESCE(v_schedule.supplier_id, v_item.supplier_id);

  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'Позиция не привязана к материалу';
  END IF;

  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Назначьте поставщика для поставки';
  END IF;

  v_required := CASE v_schedule.request_item_table
    WHEN 'request_sheet_metal' THEN COALESCE(v_item.remainder_qty, v_item.to_order_kg, 0)
    WHEN 'request_round_tube' THEN COALESCE(v_item.order_kg, 0)
    WHEN 'request_circle' THEN COALESCE(v_item.remainder_mm, 0) - COALESCE(v_item.reserved_from_stock_mm, 0)
    WHEN 'request_pipe' THEN CASE
      WHEN v_item.pipe_type = 'wire' THEN COALESCE(v_item.remainder_kg, 0) - COALESCE(v_item.reserved_from_stock_kg, 0)
      ELSE COALESCE(v_item.remainder_length_mm, 0) - COALESCE(v_item.reserved_from_stock_length_mm, 0)
    END
    WHEN 'request_knives' THEN CASE
      WHEN COALESCE(v_item.remainder_meters, 0) > 0 THEN COALESCE(v_item.remainder_meters, 0) * 1000
      ELSE COALESCE(v_item.to_order_mm, 0)
    END - COALESCE(v_item.reserved_from_stock_mm, 0)
    WHEN 'request_components' THEN COALESCE(v_item.quantity_needed, 0) - COALESCE(v_item.stock_remainder, 0) - COALESCE(v_item.reserved_from_stock, 0)
    WHEN 'request_mesh' THEN COALESCE(v_item.remainder_qty, 0) - COALESCE(v_item.reserved_from_stock_qty, 0)
    WHEN 'request_chain_cord' THEN COALESCE(v_item.remainder_meters, 0) - COALESCE(v_item.reserved_from_stock_meters, 0)
    ELSE 0
  END;
  v_required := GREATEST(COALESCE(v_required, 0), 0);

  IF v_schedule.request_item_table = 'request_knives' THEN
    v_piece_length_mm := v_item.length_mm;
    IF v_piece_length_mm IS NULL OR v_piece_length_mm <= 0 THEN
      RAISE EXCEPTION 'Для ножа не указана длина складской позиции';
    END IF;
    v_secondary_quantity := v_schedule.quantity / v_piece_length_mm;
    v_secondary_unit := 'шт';
  ELSE
    v_piece_length_mm := NULL;
    v_secondary_quantity := NULL;
    v_secondary_unit := NULL;
  END IF;

  PERFORM fn_add_inventory_receipt(
    v_material_id,
    v_schedule.quantity,
    v_schedule.unit,
    p_performed_by,
    'Приход по графику поставки: ' || v_schedule.delivery_date::text,
    v_secondary_quantity,
    v_secondary_unit,
    v_supplier_id,
    v_material_variant_id,
    v_piece_length_mm
  );

  UPDATE supply_order_delivery_schedules
  SET status = 'delivered',
      received_quantity = v_schedule.quantity,
      delivered_at = now(),
      received_by = p_performed_by,
      updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_schedule_id;

  SELECT COALESCE(sum(received_quantity), 0)
  INTO v_delivered_total
  FROM supply_order_delivery_schedules
  WHERE request_item_table = v_schedule.request_item_table
    AND request_item_id = v_schedule.request_item_id
    AND status = 'delivered';

  IF v_delivered_total >= v_required THEN
    EXECUTE format('UPDATE %I SET order_status = $1, delivered_at = now(), supplier_id = COALESCE(supplier_id, $2) WHERE id = $3', v_schedule.request_item_table)
      USING 'delivered'::order_item_status, v_supplier_id, v_schedule.request_item_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
