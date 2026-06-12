-- Cut-aware reservations for pipe and knives stock.
-- Piece stock is stored as total length in the primary unit and piece count in the secondary unit.

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS is_business_scrap boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_inventory_id uuid REFERENCES inventory(id),
  ADD COLUMN IF NOT EXISTS source_reservation_id uuid REFERENCES inventory_reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_machine_id uuid REFERENCES machines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_piece_length_mm numeric;

ALTER TABLE inventory_reservations
  ADD COLUMN IF NOT EXISTS source_inventory_id uuid REFERENCES inventory(id),
  ADD COLUMN IF NOT EXISTS original_piece_length_mm numeric,
  ADD COLUMN IF NOT EXISTS consumed_piece_count numeric,
  ADD COLUMN IF NOT EXISTS business_scrap_inventory_id uuid REFERENCES inventory(id),
  ADD COLUMN IF NOT EXISTS business_scrap_quantity numeric,
  ADD COLUMN IF NOT EXISTS is_cut_reservation boolean NOT NULL DEFAULT false;

DROP INDEX IF EXISTS idx_reservation_unique;
CREATE INDEX IF NOT EXISTS idx_reservations_request_item
  ON inventory_reservations(request_item_table, request_item_id);

DROP INDEX IF EXISTS idx_inventory_material_legacy;
DROP INDEX IF EXISTS idx_inventory_material_variant;
DROP INDEX IF EXISTS idx_inventory_material_variant_no_piece;
DROP INDEX IF EXISTS idx_inventory_material_variant_piece;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_material_legacy
  ON inventory(material_id)
  WHERE material_variant_id IS NULL AND is_business_scrap = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_material_variant_no_piece
  ON inventory(material_id, material_variant_id)
  WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NULL AND is_business_scrap = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_material_variant_piece
  ON inventory(material_id, material_variant_id, piece_length_mm)
  WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NOT NULL AND is_business_scrap = false;

CREATE INDEX IF NOT EXISTS idx_inventory_business_scrap
  ON inventory(is_business_scrap)
  WHERE is_business_scrap = true;

CREATE OR REPLACE FUNCTION fn_upsert_inventory_stock(
  p_material_id uuid,
  p_material_variant_id uuid,
  p_piece_length_mm numeric,
  p_quantity numeric,
  p_unit text,
  p_secondary_quantity numeric,
  p_secondary_unit text,
  p_performed_by uuid,
  p_is_business_scrap boolean DEFAULT false,
  p_source_inventory_id uuid DEFAULT NULL,
  p_source_reservation_id uuid DEFAULT NULL,
  p_source_machine_id uuid DEFAULT NULL,
  p_source_piece_length_mm numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество должно быть больше 0';
  END IF;

  IF p_is_business_scrap THEN
    INSERT INTO inventory (
      material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      p_material_id, p_material_variant_id, p_piece_length_mm, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      true, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    RETURNING id INTO v_inventory_id;

    RETURN v_inventory_id;
  END IF;

  IF p_material_variant_id IS NULL THEN
    INSERT INTO inventory (
      material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      p_material_id, NULL, NULL, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      p_is_business_scrap, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    ON CONFLICT (material_id) WHERE material_variant_id IS NULL AND is_business_scrap = false DO UPDATE SET
      total_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity ELSE EXCLUDED.total_quantity END,
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
      source_inventory_id = COALESCE(inventory.source_inventory_id, EXCLUDED.source_inventory_id),
      source_reservation_id = COALESCE(inventory.source_reservation_id, EXCLUDED.source_reservation_id),
      source_machine_id = COALESCE(inventory.source_machine_id, EXCLUDED.source_machine_id),
      source_piece_length_mm = COALESCE(inventory.source_piece_length_mm, EXCLUDED.source_piece_length_mm),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  ELSIF p_piece_length_mm IS NULL THEN
    INSERT INTO inventory (
      material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      p_material_id, p_material_variant_id, NULL, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      p_is_business_scrap, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    ON CONFLICT (material_id, material_variant_id) WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NULL AND is_business_scrap = false DO UPDATE SET
      total_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity ELSE EXCLUDED.total_quantity END,
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
      source_inventory_id = COALESCE(inventory.source_inventory_id, EXCLUDED.source_inventory_id),
      source_reservation_id = COALESCE(inventory.source_reservation_id, EXCLUDED.source_reservation_id),
      source_machine_id = COALESCE(inventory.source_machine_id, EXCLUDED.source_machine_id),
      source_piece_length_mm = COALESCE(inventory.source_piece_length_mm, EXCLUDED.source_piece_length_mm),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  ELSE
    INSERT INTO inventory (
      material_id, material_variant_id, piece_length_mm, total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit, last_updated_by,
      is_business_scrap, source_inventory_id, source_reservation_id, source_machine_id, source_piece_length_mm
    )
    VALUES (
      p_material_id, p_material_variant_id, p_piece_length_mm, p_quantity, 0, p_unit,
      p_secondary_quantity, CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE 0 END, p_secondary_unit, p_performed_by,
      p_is_business_scrap, p_source_inventory_id, p_source_reservation_id, p_source_machine_id, p_source_piece_length_mm
    )
    ON CONFLICT (material_id, material_variant_id, piece_length_mm) WHERE material_variant_id IS NOT NULL AND piece_length_mm IS NOT NULL AND is_business_scrap = false DO UPDATE SET
      total_quantity = CASE WHEN inventory.deleted_at IS NULL THEN inventory.total_quantity + EXCLUDED.total_quantity ELSE EXCLUDED.total_quantity END,
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
      source_inventory_id = COALESCE(inventory.source_inventory_id, EXCLUDED.source_inventory_id),
      source_reservation_id = COALESCE(inventory.source_reservation_id, EXCLUDED.source_reservation_id),
      source_machine_id = COALESCE(inventory.source_machine_id, EXCLUDED.source_machine_id),
      source_piece_length_mm = COALESCE(inventory.source_piece_length_mm, EXCLUDED.source_piece_length_mm),
      deleted_at = NULL,
      deleted_by = NULL,
      delete_comment = NULL,
      last_updated_by = p_performed_by,
      updated_at = now()
    RETURNING id INTO v_inventory_id;
  END IF;

  RETURN v_inventory_id;
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
  p_material_variant_id uuid DEFAULT NULL,
  p_piece_length_mm numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory_id uuid;
BEGIN
  v_inventory_id := fn_upsert_inventory_stock(
    p_material_id,
    p_material_variant_id,
    p_piece_length_mm,
    p_quantity,
    p_unit,
    p_secondary_quantity,
    p_secondary_unit,
    p_performed_by,
    false,
    NULL,
    NULL,
    NULL,
    NULL
  );

  INSERT INTO inventory_transactions (
    inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, performed_by, comment, supplier_id
  )
  VALUES (
    v_inventory_id, p_material_id, p_material_variant_id, 'receipt', p_quantity,
    p_secondary_quantity, p_performed_by, p_comment, p_supplier_id
  );

  RETURN v_inventory_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_set_request_reserved_quantity(
  p_table text,
  p_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_quantity numeric;
  v_secondary_quantity numeric;
BEGIN
  SELECT
    COALESCE(SUM(reserved_quantity), 0),
    COALESCE(SUM(COALESCE(reserved_secondary_quantity, 0)), 0)
  INTO v_quantity, v_secondary_quantity
  FROM inventory_reservations
  WHERE request_item_table = p_table
    AND request_item_id = p_id;

  IF p_table = 'request_sheet_metal' THEN
    UPDATE request_sheet_metal SET reserved_from_stock_kg = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_round_tube' THEN
    UPDATE request_round_tube
    SET reserved_from_stock_kg = v_quantity,
        reserved_from_stock_m = v_secondary_quantity
    WHERE id = p_id;
  ELSIF p_table = 'request_circle' THEN
    UPDATE request_circle SET reserved_from_stock_mm = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_pipe' THEN
    UPDATE request_pipe
    SET reserved_from_stock_length_mm = CASE WHEN pipe_type = 'wire' THEN reserved_from_stock_length_mm ELSE v_quantity END,
        reserved_from_stock_qty = CASE WHEN pipe_type = 'wire' THEN reserved_from_stock_qty ELSE v_secondary_quantity END,
        reserved_from_stock_kg = CASE WHEN pipe_type = 'wire' THEN v_quantity ELSE reserved_from_stock_kg END
    WHERE id = p_id;
  ELSIF p_table = 'request_knives' THEN
    UPDATE request_knives
    SET reserved_from_stock_mm = v_quantity,
        reserved_from_stock_qty = v_secondary_quantity
    WHERE id = p_id;
  ELSIF p_table = 'request_components' THEN
    UPDATE request_components SET reserved_from_stock = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_paint' THEN
    UPDATE request_paint SET reserved_from_stock_kg = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_mesh' THEN
    UPDATE request_mesh SET reserved_from_stock_qty = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_chain_cord' THEN
    UPDATE request_chain_cord SET reserved_from_stock_meters = v_quantity WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Некорректная таблица позиции: %', p_table;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_insert_cut_reservation(
  p_inventory_id uuid,
  p_material_id uuid,
  p_material_variant_id uuid,
  p_machine_id uuid,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_quantity numeric,
  p_piece_count numeric,
  p_reserved_by uuid,
  p_original_piece_length_mm numeric,
  p_scrap_inventory_id uuid DEFAULT NULL,
  p_scrap_quantity numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_reservation_id uuid;
BEGIN
  INSERT INTO inventory_reservations (
    inventory_id,
    material_id,
    material_variant_id,
    machine_id,
    request_item_table,
    request_item_id,
    reserved_quantity,
    reserved_secondary_quantity,
    reserved_by,
    source_inventory_id,
    original_piece_length_mm,
    consumed_piece_count,
    business_scrap_inventory_id,
    business_scrap_quantity,
    is_cut_reservation
  )
  VALUES (
    p_inventory_id,
    p_material_id,
    p_material_variant_id,
    p_machine_id,
    p_request_item_table,
    p_request_item_id,
    p_reserved_quantity,
    p_piece_count,
    p_reserved_by,
    p_inventory_id,
    p_original_piece_length_mm,
    p_piece_count,
    p_scrap_inventory_id,
    p_scrap_quantity,
    true
  )
  RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
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
  p_material_variant_id uuid DEFAULT NULL,
  p_piece_length_mm numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory inventory%ROWTYPE;
  v_reservation_id uuid;
  v_last_reservation_id uuid;
  v_remaining numeric := p_quantity;
  v_available_pieces numeric;
  v_full_pieces numeric;
  v_full_quantity numeric;
  v_cut_quantity numeric;
  v_scrap_quantity numeric;
  v_scrap_inventory_id uuid;
  v_possible numeric;
  v_is_cut_table boolean := p_request_item_table IN ('request_pipe', 'request_knives') AND p_piece_length_mm IS NOT NULL;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  IF v_is_cut_table THEN
    SELECT COALESCE(SUM(FLOOR(COALESCE(available_secondary_quantity, 0)) * piece_length_mm), 0)
    INTO v_possible
    FROM inventory
    WHERE material_id = p_material_id
      AND (p_material_variant_id IS NULL OR material_variant_id = p_material_variant_id)
      AND piece_length_mm IS NOT NULL
      AND piece_length_mm > 0
      AND COALESCE(available_secondary_quantity, 0) > 0
      AND deleted_at IS NULL;

    IF v_possible < p_quantity THEN
      RAISE EXCEPTION 'Недостаточно на складе. Доступно: % мм', v_possible;
    END IF;

    FOR v_inventory IN
      SELECT *
      FROM inventory
      WHERE material_id = p_material_id
        AND (p_material_variant_id IS NULL OR material_variant_id = p_material_variant_id)
        AND piece_length_mm IS NOT NULL
        AND piece_length_mm > 0
        AND COALESCE(available_secondary_quantity, 0) > 0
        AND deleted_at IS NULL
      ORDER BY
        CASE WHEN is_business_scrap THEN 0 ELSE 1 END,
        CASE WHEN NOT is_business_scrap AND p_piece_length_mm IS NOT NULL AND piece_length_mm = p_piece_length_mm THEN 0 ELSE 1 END,
        piece_length_mm ASC,
        updated_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_available_pieces := FLOOR(COALESCE(v_inventory.available_secondary_quantity, 0));
      IF v_available_pieces <= 0 THEN
        CONTINUE;
      END IF;

      v_full_pieces := LEAST(FLOOR(v_remaining / v_inventory.piece_length_mm), v_available_pieces);
      IF v_full_pieces > 0 THEN
        v_full_quantity := v_full_pieces * v_inventory.piece_length_mm;

        UPDATE inventory
        SET total_quantity = total_quantity - v_full_quantity,
            total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - v_full_pieces,
            last_updated_by = p_reserved_by,
            updated_at = now()
        WHERE id = v_inventory.id;

        v_reservation_id := fn_insert_cut_reservation(
          v_inventory.id,
          p_material_id,
          v_inventory.material_variant_id,
          p_machine_id,
          p_request_item_table,
          p_request_item_id,
          v_full_quantity,
          v_full_pieces,
          p_reserved_by,
          v_inventory.piece_length_mm,
          NULL,
          NULL
        );
        v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);

        INSERT INTO inventory_transactions (
          inventory_id, material_id, material_variant_id, transaction_type, quantity,
          secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
        )
        VALUES (
          v_inventory.id, p_material_id, v_inventory.material_variant_id, 'reserve', -v_full_quantity,
          -v_full_pieces, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Бронирование целых кусков'
        );

        v_remaining := v_remaining - v_full_quantity;
        v_available_pieces := v_available_pieces - v_full_pieces;
      END IF;

      IF v_remaining > 0 AND v_available_pieces > 0 THEN
        v_cut_quantity := v_remaining;
        v_scrap_quantity := v_inventory.piece_length_mm - v_cut_quantity;
        IF v_scrap_quantity < 0 THEN
          RAISE EXCEPTION 'Некорректный раскрой: остаток меньше 0';
        END IF;

        UPDATE inventory
        SET total_quantity = total_quantity - v_inventory.piece_length_mm,
            total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - 1,
            last_updated_by = p_reserved_by,
            updated_at = now()
        WHERE id = v_inventory.id;

        IF v_scrap_quantity > 0 THEN
          v_scrap_inventory_id := fn_upsert_inventory_stock(
            p_material_id,
            v_inventory.material_variant_id,
            v_scrap_quantity,
            v_scrap_quantity,
            v_inventory.unit,
            1,
            COALESCE(v_inventory.secondary_unit, 'шт'),
            p_reserved_by,
            true,
            v_inventory.id,
            NULL,
            p_machine_id,
            v_inventory.piece_length_mm
          );
        ELSE
          v_scrap_inventory_id := NULL;
        END IF;

        v_reservation_id := fn_insert_cut_reservation(
          v_inventory.id,
          p_material_id,
          v_inventory.material_variant_id,
          p_machine_id,
          p_request_item_table,
          p_request_item_id,
          v_cut_quantity,
          1,
          p_reserved_by,
          v_inventory.piece_length_mm,
          v_scrap_inventory_id,
          NULLIF(v_scrap_quantity, 0)
        );
        v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);

        IF v_scrap_inventory_id IS NOT NULL THEN
          UPDATE inventory
          SET source_reservation_id = v_reservation_id
          WHERE id = v_scrap_inventory_id
            AND source_reservation_id IS NULL;
        END IF;

        INSERT INTO inventory_transactions (
          inventory_id, material_id, material_variant_id, transaction_type, quantity,
          secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
        )
        VALUES (
          v_inventory.id, p_material_id, v_inventory.material_variant_id, 'reserve', -v_cut_quantity,
          -1, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Раскрой и бронирование куска'
        );

        IF v_scrap_inventory_id IS NOT NULL THEN
          INSERT INTO inventory_transactions (
            inventory_id, material_id, material_variant_id, transaction_type, quantity,
            secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
          )
          VALUES (
            v_scrap_inventory_id, p_material_id, v_inventory.material_variant_id, 'receipt', v_scrap_quantity,
            1, p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by, 'Деловой отход после раскроя'
          );
        END IF;

        v_remaining := 0;
      END IF;
    END LOOP;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Недостаточно на складе. Не хватает: % мм', v_remaining;
    END IF;

    PERFORM fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
    RETURN v_last_reservation_id;
  END IF;

  IF p_material_variant_id IS NOT NULL AND p_piece_length_mm IS NOT NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id = p_material_variant_id
      AND piece_length_mm = p_piece_length_mm
      AND is_business_scrap = false
      AND deleted_at IS NULL
    FOR UPDATE;
  ELSIF p_material_variant_id IS NOT NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id = p_material_variant_id
      AND piece_length_mm IS NULL
      AND is_business_scrap = false
      AND deleted_at IS NULL
    FOR UPDATE;
  ELSE
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND material_variant_id IS NULL
      AND is_business_scrap = false
      AND deleted_at IS NULL
    FOR UPDATE;
  END IF;

  IF NOT FOUND AND p_material_variant_id IS NULL AND p_piece_length_mm IS NULL THEN
    SELECT * INTO v_inventory
    FROM inventory
    WHERE material_id = p_material_id
      AND available_quantity > 0
      AND is_business_scrap = false
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
    inventory_id, material_id, material_variant_id, machine_id, request_item_table, request_item_id,
    reserved_quantity, reserved_secondary_quantity, reserved_by
  )
  VALUES (
    v_inventory.id, p_material_id, v_inventory.material_variant_id, p_machine_id, p_request_item_table, p_request_item_id,
    p_quantity, p_secondary_quantity, p_reserved_by
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
    inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by
  )
  VALUES (
    v_inventory.id, p_material_id, v_inventory.material_variant_id, 'reserve', -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by
  );

  PERFORM fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
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
  v_scrap inventory%ROWTYPE;
  v_can_rejoin boolean := false;
  v_return_inventory_id uuid;
  v_return_quantity numeric;
BEGIN
  SELECT * INTO v_reservation
  FROM inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_reservation.is_cut_reservation THEN
    IF v_reservation.business_scrap_inventory_id IS NOT NULL AND COALESCE(v_reservation.business_scrap_quantity, 0) > 0 THEN
      SELECT * INTO v_scrap
      FROM inventory
      WHERE id = v_reservation.business_scrap_inventory_id
      FOR UPDATE;

      v_can_rejoin := FOUND
        AND COALESCE(v_scrap.available_quantity, 0) >= COALESCE(v_reservation.business_scrap_quantity, 0)
        AND COALESCE(v_scrap.available_secondary_quantity, 0) >= 1
        AND v_scrap.deleted_at IS NULL;
    ELSE
      v_can_rejoin := true;
    END IF;

    IF v_can_rejoin THEN
      IF v_reservation.business_scrap_inventory_id IS NOT NULL AND COALESCE(v_reservation.business_scrap_quantity, 0) > 0 THEN
        UPDATE inventory
        SET total_quantity = total_quantity - v_reservation.business_scrap_quantity,
            total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - 1,
            last_updated_by = p_performed_by,
            updated_at = now()
        WHERE id = v_reservation.business_scrap_inventory_id;
      END IF;

      UPDATE inventory
      SET total_quantity = total_quantity + COALESCE(v_reservation.original_piece_length_mm, 0) * COALESCE(v_reservation.consumed_piece_count, 1),
          total_secondary_quantity = COALESCE(total_secondary_quantity, 0) + COALESCE(v_reservation.consumed_piece_count, 1),
          last_updated_by = p_performed_by,
          updated_at = now()
      WHERE id = COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id);

      INSERT INTO inventory_transactions (
        inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id),
        v_reservation.material_id,
        v_reservation.material_variant_id,
        'unreserve',
        v_reservation.reserved_quantity,
        v_reservation.reserved_secondary_quantity,
        v_reservation.machine_id,
        v_reservation.request_item_table,
        v_reservation.request_item_id,
        p_performed_by,
        COALESCE(p_comment, 'Снятие брони с восстановлением куска')
      );
    ELSE
      v_return_quantity := v_reservation.reserved_quantity;
      v_return_inventory_id := fn_upsert_inventory_stock(
        v_reservation.material_id,
        v_reservation.material_variant_id,
        v_return_quantity,
        v_return_quantity,
        'мм',
        1,
        'шт',
        p_performed_by,
        true,
        COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id),
        NULL,
        v_reservation.machine_id,
        v_reservation.original_piece_length_mm
      );

      INSERT INTO inventory_transactions (
        inventory_id, material_id, material_variant_id, transaction_type, quantity,
        secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
      )
      VALUES (
        v_return_inventory_id,
        v_reservation.material_id,
        v_reservation.material_variant_id,
        'unreserve',
        v_return_quantity,
        1,
        v_reservation.machine_id,
        v_reservation.request_item_table,
        v_reservation.request_item_id,
        p_performed_by,
        COALESCE(p_comment, 'Снятие брони, возврат забронированного куска')
      );
    END IF;

    UPDATE inventory
    SET source_reservation_id = NULL
    WHERE source_reservation_id = p_reservation_id;

    DELETE FROM inventory_reservations WHERE id = p_reservation_id;
    PERFORM fn_set_request_reserved_quantity(v_reservation.request_item_table, v_reservation.request_item_id);
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
    inventory_id, material_id, material_variant_id, transaction_type, quantity,
    secondary_quantity, machine_id, request_item_table, request_item_id, performed_by, comment
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

  UPDATE inventory
  SET source_reservation_id = NULL
  WHERE source_reservation_id = p_reservation_id;

  DELETE FROM inventory_reservations WHERE id = p_reservation_id;
  PERFORM fn_set_request_reserved_quantity(v_reservation.request_item_table, v_reservation.request_item_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
