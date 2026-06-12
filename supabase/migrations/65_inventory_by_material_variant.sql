-- Track inventory balances by material variant, while preserving legacy rows
-- that were aggregated only by material_id.

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);

ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);

ALTER TABLE inventory_reservations
  ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);

DROP INDEX IF EXISTS idx_inventory_material;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_material_legacy
  ON inventory(material_id)
  WHERE material_variant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_material_variant
  ON inventory(material_id, material_variant_id)
  WHERE material_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_variant
  ON inventory(material_variant_id)
  WHERE material_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_transactions_variant
  ON inventory_transactions(material_variant_id)
  WHERE material_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_variant
  ON inventory_reservations(material_variant_id)
  WHERE material_variant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_add_inventory_receipt(
  p_material_id uuid,
  p_quantity numeric,
  p_unit text,
  p_performed_by uuid,
  p_comment text DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL,
  p_secondary_unit text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество должно быть больше 0';
  END IF;

  IF p_material_variant_id IS NULL THEN
    INSERT INTO inventory (
      material_id,
      material_variant_id,
      total_quantity,
      reserved_quantity,
      unit,
      total_secondary_quantity,
      reserved_secondary_quantity,
      secondary_unit,
      last_updated_by
    )
    VALUES (
      p_material_id,
      NULL,
      p_quantity,
      0,
      p_unit,
      p_secondary_quantity,
      CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END,
      p_secondary_unit,
      p_performed_by
    )
    ON CONFLICT (material_id) WHERE material_variant_id IS NULL DO UPDATE SET
      total_quantity = inventory.total_quantity + EXCLUDED.total_quantity,
      total_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
        ELSE COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
      END,
      reserved_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
        ELSE COALESCE(inventory.reserved_secondary_quantity, 0)
      END,
      secondary_unit = COALESCE(inventory.secondary_unit, EXCLUDED.secondary_unit),
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  ELSE
    INSERT INTO inventory (
      material_id,
      material_variant_id,
      total_quantity,
      reserved_quantity,
      unit,
      total_secondary_quantity,
      reserved_secondary_quantity,
      secondary_unit,
      last_updated_by
    )
    VALUES (
      p_material_id,
      p_material_variant_id,
      p_quantity,
      0,
      p_unit,
      p_secondary_quantity,
      CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END,
      p_secondary_unit,
      p_performed_by
    )
    ON CONFLICT (material_id, material_variant_id) WHERE material_variant_id IS NOT NULL DO UPDATE SET
      total_quantity = inventory.total_quantity + EXCLUDED.total_quantity,
      total_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
        ELSE COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
      END,
      reserved_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
        ELSE COALESCE(inventory.reserved_secondary_quantity, 0)
      END,
      secondary_unit = COALESCE(inventory.secondary_unit, EXCLUDED.secondary_unit),
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  END IF;

  INSERT INTO inventory_transactions (
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    performed_by,
    comment,
    supplier_id
  )
  VALUES (
    v_inventory_id,
    p_material_id,
    p_material_variant_id,
    'receipt',
    p_quantity,
    p_secondary_quantity,
    p_performed_by,
    p_comment,
    p_supplier_id
  );

  RETURN v_inventory_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_adjust_inventory_record(
  p_inventory_id uuid,
  p_new_total numeric,
  p_performed_by uuid,
  p_comment text,
  p_new_secondary_total numeric DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_inventory inventory%ROWTYPE;
  v_diff numeric;
  v_secondary_diff numeric;
BEGIN
  IF p_comment IS NULL OR btrim(p_comment) = '' THEN
    RAISE EXCEPTION 'Укажите причину корректировки';
  END IF;

  SELECT * INTO v_inventory FROM inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Остаток материала не найден';
  END IF;

  IF p_new_total < v_inventory.reserved_quantity THEN
    RAISE EXCEPTION 'Новый остаток меньше забронированного количества';
  END IF;

  IF p_new_secondary_total IS NOT NULL AND p_new_secondary_total < COALESCE(v_inventory.reserved_secondary_quantity, 0) THEN
    RAISE EXCEPTION 'Новый вторичный остаток меньше забронированного количества';
  END IF;

  v_diff := p_new_total - v_inventory.total_quantity;
  v_secondary_diff := CASE
    WHEN p_new_secondary_total IS NULL THEN NULL
    ELSE p_new_secondary_total - COALESCE(v_inventory.total_secondary_quantity, 0)
  END;

  UPDATE inventory
  SET total_quantity = p_new_total,
      total_secondary_quantity = COALESCE(p_new_secondary_total, total_secondary_quantity),
      reserved_secondary_quantity = CASE
        WHEN p_new_secondary_total IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0)
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  WHERE id = p_inventory_id;

  INSERT INTO inventory_transactions (
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    performed_by,
    comment
  )
  VALUES (
    v_inventory.id,
    v_inventory.material_id,
    v_inventory.material_variant_id,
    'adjustment',
    v_diff,
    v_secondary_diff,
    p_performed_by,
    p_comment
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_reserve_inventory_for_machine(
  p_material_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric DEFAULT NULL,
  p_material_variant_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory inventory%ROWTYPE;
  v_reservation_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  IF p_material_variant_id IS NOT NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id = p_material_variant_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id IS NULL
    FOR UPDATE;
  END IF;

  IF NOT FOUND AND p_material_variant_id IS NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND available_quantity > 0
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

CREATE OR REPLACE FUNCTION fn_unreserve_inventory_reservation(
  p_reservation_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_reservation inventory_reservations%ROWTYPE;
BEGIN
  SELECT * INTO v_reservation FROM inventory_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE inventory
  SET reserved_quantity = GREATEST(reserved_quantity - v_reservation.reserved_quantity, 0),
      reserved_secondary_quantity = CASE
        WHEN v_reservation.reserved_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE GREATEST(COALESCE(reserved_secondary_quantity, 0) - v_reservation.reserved_secondary_quantity, 0)
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  WHERE id = v_reservation.inventory_id;

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
    performed_by,
    comment
  )
  VALUES (
    v_reservation.inventory_id,
    v_reservation.material_id,
    v_reservation.material_variant_id,
    'unreserve',
    v_reservation.reserved_quantity,
    v_reservation.reserved_secondary_quantity,
    v_reservation.machine_id,
    v_reservation.request_item_table,
    v_reservation.request_item_id,
    p_performed_by,
    p_comment
  );

  PERFORM fn_set_request_reserved_quantity(v_reservation.request_item_table, v_reservation.request_item_id, 0, 0);
  DELETE FROM inventory_reservations WHERE id = p_reservation_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
