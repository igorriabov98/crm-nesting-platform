-- Tighten the supply/order flow around exact inventory rows and real remaining purchase need.

DROP FUNCTION IF EXISTS fn_reserve_inventory_for_machine(uuid, uuid, numeric, text, uuid, uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION fn_reserve_inventory_for_machine(
  p_material_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric DEFAULT NULL,
  p_material_variant_id uuid DEFAULT NULL,
  p_piece_length_mm numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory inventory%ROWTYPE;
  v_reservation_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  IF p_material_variant_id IS NOT NULL AND p_piece_length_mm IS NOT NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id = p_material_variant_id
      AND piece_length_mm = p_piece_length_mm
      AND deleted_at IS NULL
    FOR UPDATE;
  ELSIF p_material_variant_id IS NOT NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id = p_material_variant_id
      AND piece_length_mm IS NULL
      AND deleted_at IS NULL
    FOR UPDATE;
  ELSE
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id IS NULL
      AND deleted_at IS NULL
    FOR UPDATE;
  END IF;

  IF NOT FOUND AND p_material_variant_id IS NULL AND p_piece_length_mm IS NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND available_quantity > 0
      AND deleted_at IS NULL
    ORDER BY updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Материала нет на складе';
  END IF;

  IF v_inventory.available_quantity < p_quantity THEN
    RAISE EXCEPTION 'Недостаточно на складе. Доступно: % %', v_inventory.available_quantity, v_inventory.unit;
  END IF;

  IF p_secondary_quantity IS NOT NULL AND COALESCE(v_inventory.available_secondary_quantity, 0) < p_secondary_quantity THEN
    RAISE EXCEPTION 'Недостаточно на складе. Доступно: % %', COALESCE(v_inventory.available_secondary_quantity, 0), COALESCE(v_inventory.secondary_unit, '');
  END IF;

  INSERT INTO inventory_reservations (
    inventory_id,
    material_id,
    material_variant_id,
    machine_id,
    request_item_table,
    request_item_id,
    reserved_quantity,
    reserved_secondary_quantity,
    reserved_by
  )
  VALUES (
    v_inventory.id,
    p_material_id,
    v_inventory.material_variant_id,
    p_machine_id,
    p_request_item_table,
    p_request_item_id,
    p_quantity,
    p_secondary_quantity,
    p_reserved_by
  )
  RETURNING id INTO v_reservation_id;

  UPDATE inventory
  SET reserved_quantity = reserved_quantity + p_quantity,
      reserved_secondary_quantity = CASE
        WHEN p_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0) + p_secondary_quantity
      END,
      last_updated_by = p_reserved_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  INSERT INTO inventory_transactions (
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by
  )
  VALUES (
    v_inventory.id,
    p_material_id,
    v_inventory.material_variant_id,
    'reserve',
    -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by
  );

  PERFORM fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id, p_quantity, p_secondary_quantity);

  RETURN v_reservation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_check_order_status_and_update_machine()
RETURNS TRIGGER AS $$
DECLARE
  v_request_id uuid;
  v_machine_id uuid;
  v_machine_status machine_status;
  v_total int;
  v_all_ordered int;
  v_all_delivered int;
BEGIN
  v_request_id := COALESCE(NEW.request_id, OLD.request_id);

  SELECT tr.machine_id, m.status
  INTO v_machine_id, v_machine_status
  FROM technologist_requests tr
  JOIN machines m ON m.id = tr.machine_id
  WHERE tr.id = v_request_id;

  IF v_machine_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_machine_status IN ('in_production', 'shipped') THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE os IN ('ordered', 'delivered')),
    COUNT(*) FILTER (WHERE os = 'delivered')
  INTO v_total, v_all_ordered, v_all_delivered
  FROM (
    SELECT order_status AS os
    FROM request_sheet_metal
    WHERE request_id = v_request_id
      AND GREATEST(GREATEST(COALESCE(remainder_qty, 0), COALESCE(to_order_kg, 0)) - COALESCE(reserved_from_stock_kg, 0), 0) > 0

    UNION ALL
    SELECT order_status
    FROM request_circle
    WHERE request_id = v_request_id
      AND GREATEST(COALESCE(remainder_mm, 0) - COALESCE(reserved_from_stock_mm, 0), 0) > 0

    UNION ALL
    SELECT order_status
    FROM request_pipe
    WHERE request_id = v_request_id
      AND (
        (pipe_type = 'wire' AND GREATEST(COALESCE(remainder_kg, 0) - COALESCE(reserved_from_stock_kg, 0), 0) > 0)
        OR (pipe_type <> 'wire' AND GREATEST(COALESCE(remainder_length_mm, 0) - COALESCE(reserved_from_stock_length_mm, 0), 0) > 0)
      )

    UNION ALL
    SELECT order_status
    FROM request_knives
    WHERE request_id = v_request_id
      AND GREATEST(GREATEST(COALESCE(remainder_meters, 0), COALESCE(to_order_mm, 0)) - COALESCE(reserved_from_stock_mm, 0), 0) > 0

    UNION ALL
    SELECT order_status
    FROM request_paint
    WHERE request_id = v_request_id
      AND GREATEST(GREATEST(COALESCE(remainder_kg, 0), COALESCE(to_order_kg, 0)) - COALESCE(reserved_from_stock_kg, 0), 0) > 0

    UNION ALL
    SELECT order_status
    FROM request_components
    WHERE request_id = v_request_id
      AND GREATEST(
        GREATEST(COALESCE(quantity_needed, 0) - COALESCE(stock_remainder, 0), COALESCE(to_order, 0))
        - COALESCE(reserved_from_stock, 0),
        0
      ) > 0

    UNION ALL
    SELECT order_status
    FROM request_mesh
    WHERE request_id = v_request_id
      AND GREATEST(COALESCE(remainder_qty, 0) - COALESCE(reserved_from_stock_qty, 0), 0) > 0

    UNION ALL
    SELECT order_status
    FROM request_chain_cord
    WHERE request_id = v_request_id
      AND GREATEST(COALESCE(remainder_meters, 0) - COALESCE(reserved_from_stock_meters, 0), 0) > 0
  ) all_items;

  IF v_total = 0 THEN
    IF v_machine_status = 'request_ready' THEN
      UPDATE machines
      SET status = 'material_received', updated_at = now()
      WHERE id = v_machine_id;
    END IF;
    RETURN NEW;
  END IF;

  IF v_all_delivered = v_total AND v_machine_status IN ('request_ready', 'purchasing') THEN
    UPDATE machines
    SET status = 'material_received', updated_at = now()
    WHERE id = v_machine_id;
    RETURN NEW;
  END IF;

  IF v_all_ordered = v_total AND v_machine_status = 'request_ready' THEN
    UPDATE machines
    SET status = 'purchasing', updated_at = now()
    WHERE id = v_machine_id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
