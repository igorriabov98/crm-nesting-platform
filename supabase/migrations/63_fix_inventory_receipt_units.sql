-- Keep existing inventory units as the source of truth on repeated receipts.

CREATE OR REPLACE FUNCTION fn_add_inventory_receipt(
  p_material_id uuid,
  p_quantity numeric,
  p_unit text,
  p_performed_by uuid,
  p_comment text DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL,
  p_secondary_unit text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество должно быть больше 0';
  END IF;

  INSERT INTO inventory (
    material_id,
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
    p_quantity,
    0,
    p_unit,
    p_secondary_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END,
    p_secondary_unit,
    p_performed_by
  )
  ON CONFLICT (material_id) DO UPDATE SET
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

  INSERT INTO inventory_transactions (
    inventory_id,
    material_id,
    transaction_type,
    quantity,
    secondary_quantity,
    performed_by,
    comment
  )
  VALUES (v_inventory_id, p_material_id, 'receipt', p_quantity, p_secondary_quantity, p_performed_by, p_comment);

  RETURN v_inventory_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
