-- Turn planned split deliveries into real receivable schedule rows.

ALTER TABLE supply_order_delivery_schedules
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'delivered')),
  ADD COLUMN IF NOT EXISTS received_quantity numeric,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES users(id);

CREATE OR REPLACE FUNCTION fn_update_supply_order_schedule(
  p_schedule_id uuid,
  p_delivery_date date,
  p_quantity numeric,
  p_supplier_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_schedule supply_order_delivery_schedules%ROWTYPE;
  v_item record;
  v_required numeric;
  v_existing_total numeric;
  v_next_supplier_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество поставки должно быть больше 0';
  END IF;

  SELECT * INTO v_schedule
  FROM supply_order_delivery_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Дата поставки не найдена';
  END IF;

  IF v_schedule.status = 'delivered' THEN
    RAISE EXCEPTION 'Нельзя менять уже принятую поставку';
  END IF;

  EXECUTE format('SELECT * FROM %I WHERE id = $1 FOR UPDATE', v_schedule.request_item_table)
    INTO v_item
    USING v_schedule.request_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Позиция закупки не найдена';
  END IF;

  IF v_item.order_status = 'delivered' THEN
    RAISE EXCEPTION 'Нельзя менять график уже доставленной позиции';
  END IF;

  IF v_schedule.delivery_date IS DISTINCT FROM p_delivery_date
     AND NULLIF(trim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину изменения даты поставки';
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

  SELECT COALESCE(sum(quantity), 0)
  INTO v_existing_total
  FROM supply_order_delivery_schedules
  WHERE request_item_table = v_schedule.request_item_table
    AND request_item_id = v_schedule.request_item_id
    AND id <> p_schedule_id;

  IF v_existing_total + p_quantity > v_required THEN
    RAISE EXCEPTION 'Сумма поставок не должна превышать % %', v_required, v_schedule.unit;
  END IF;

  v_next_supplier_id := COALESCE(p_supplier_id, v_item.supplier_id);

  UPDATE supply_order_delivery_schedules
  SET delivery_date = p_delivery_date,
      quantity = p_quantity,
      supplier_id = v_next_supplier_id,
      change_reason = NULLIF(trim(COALESCE(p_reason, '')), ''),
      updated_by = p_changed_by,
      updated_at = now()
  WHERE id = p_schedule_id;

  IF v_schedule.delivery_date IS DISTINCT FROM p_delivery_date
     OR COALESCE(v_schedule.quantity, 0) IS DISTINCT FROM p_quantity
     OR v_schedule.supplier_id IS DISTINCT FROM v_next_supplier_id THEN
    INSERT INTO supply_order_delivery_schedule_changes (
      schedule_id,
      old_delivery_date,
      new_delivery_date,
      old_quantity,
      new_quantity,
      old_supplier_id,
      new_supplier_id,
      reason,
      changed_by
    )
    VALUES (
      p_schedule_id,
      v_schedule.delivery_date,
      p_delivery_date,
      v_schedule.quantity,
      p_quantity,
      v_schedule.supplier_id,
      v_next_supplier_id,
      NULLIF(trim(COALESCE(p_reason, '')), ''),
      p_changed_by
    );
  END IF;
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

  IF v_schedule.request_item_table = 'request_pipe' AND v_item.pipe_type <> 'wire' THEN
    IF COALESCE(v_item.remainder_qty, 0) <= 0 THEN
      RAISE EXCEPTION 'Для трубы укажите количество штук';
    END IF;
    v_piece_length_mm := COALESCE(v_item.remainder_length_mm, 0) / v_item.remainder_qty;
    IF v_piece_length_mm <= 0 THEN
      RAISE EXCEPTION 'Для трубы не удалось определить длину складской позиции';
    END IF;
    v_secondary_quantity := v_schedule.quantity / v_piece_length_mm;
    v_secondary_unit := 'шт';
  ELSIF v_schedule.request_item_table = 'request_knives' THEN
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

CREATE OR REPLACE FUNCTION fn_delete_supply_order_schedule(
  p_schedule_id uuid
)
RETURNS void AS $$
DECLARE
  v_schedule supply_order_delivery_schedules%ROWTYPE;
BEGIN
  SELECT * INTO v_schedule
  FROM supply_order_delivery_schedules
  WHERE id = p_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Дата поставки не найдена';
  END IF;

  IF v_schedule.status = 'delivered' THEN
    RAISE EXCEPTION 'Нельзя удалить уже принятую поставку';
  END IF;

  DELETE FROM supply_order_delivery_schedules WHERE id = p_schedule_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
