ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_comment text;

CREATE OR REPLACE FUNCTION fn_archive_inventory_item(
  p_inventory_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_inventory inventory%ROWTYPE;
BEGIN
  SELECT * INTO v_inventory FROM inventory WHERE id = p_inventory_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Остаток материала не найден';
  END IF;

  IF v_inventory.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  IF COALESCE(v_inventory.reserved_quantity, 0) > 0
     OR COALESCE(v_inventory.reserved_secondary_quantity, 0) > 0 THEN
    RAISE EXCEPTION 'Нельзя удалить материал со склада: есть активная бронь';
  END IF;

  UPDATE inventory
  SET total_quantity = 0,
      total_secondary_quantity = CASE WHEN secondary_unit IS NULL THEN NULL ELSE 0 END,
      reserved_quantity = 0,
      reserved_secondary_quantity = CASE WHEN secondary_unit IS NULL THEN NULL ELSE 0 END,
      deleted_at = now(),
      deleted_by = p_performed_by,
      delete_comment = NULLIF(btrim(COALESCE(p_comment, '')), ''),
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
    'write_off',
    -COALESCE(v_inventory.available_quantity, 0),
    CASE
      WHEN v_inventory.secondary_unit IS NULL THEN NULL
      ELSE -COALESCE(v_inventory.available_secondary_quantity, 0)
    END,
    p_performed_by,
    COALESCE(NULLIF(btrim(COALESCE(p_comment, '')), ''), 'Удаление со склада')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
      total_quantity = CASE
        WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity
        ELSE EXCLUDED.total_quantity
      END,
      total_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
        ELSE EXCLUDED.total_secondary_quantity
      END,
      reserved_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.reserved_quantity ELSE 0 END,
      reserved_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.reserved_secondary_quantity, 0)
        ELSE 0
      END,
      secondary_unit = COALESCE(inventory.secondary_unit, EXCLUDED.secondary_unit),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
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
      total_quantity = CASE
        WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity
        ELSE EXCLUDED.total_quantity
      END,
      total_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
        ELSE EXCLUDED.total_secondary_quantity
      END,
      reserved_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.reserved_quantity ELSE 0 END,
      reserved_secondary_quantity = CASE
        WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
        WHEN inventory.deleted_at IS NULL THEN COALESCE(inventory.reserved_secondary_quantity, 0)
        ELSE 0
      END,
      secondary_unit = COALESCE(inventory.secondary_unit, EXCLUDED.secondary_unit),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
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
