CREATE TYPE inventory_transaction_type AS ENUM (
  'receipt',
  'reserve',
  'unreserve',
  'write_off',
  'adjustment'
);

CREATE TABLE inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES materials(id),
  total_quantity numeric NOT NULL DEFAULT 0,
  reserved_quantity numeric NOT NULL DEFAULT 0,
  available_quantity numeric GENERATED ALWAYS AS (GREATEST(total_quantity - reserved_quantity, 0)) STORED,
  unit text NOT NULL DEFAULT 'кг',
  total_secondary_quantity numeric,
  reserved_secondary_quantity numeric,
  available_secondary_quantity numeric GENERATED ALWAYS AS (
    CASE
      WHEN total_secondary_quantity IS NULL THEN NULL
      ELSE GREATEST(total_secondary_quantity - COALESCE(reserved_secondary_quantity, 0), 0)
    END
  ) STORED,
  secondary_unit text,
  last_updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT positive_total CHECK (total_quantity >= 0),
  CONSTRAINT positive_reserved CHECK (reserved_quantity >= 0),
  CONSTRAINT reserved_not_exceeds_total CHECK (reserved_quantity <= total_quantity),
  CONSTRAINT positive_secondary_total CHECK (total_secondary_quantity IS NULL OR total_secondary_quantity >= 0),
  CONSTRAINT positive_secondary_reserved CHECK (reserved_secondary_quantity IS NULL OR reserved_secondary_quantity >= 0),
  CONSTRAINT secondary_reserved_not_exceeds_total CHECK (
    total_secondary_quantity IS NULL
    OR COALESCE(reserved_secondary_quantity, 0) <= total_secondary_quantity
  )
);

CREATE UNIQUE INDEX idx_inventory_material ON inventory(material_id);
CREATE INDEX idx_inventory_available ON inventory(available_quantity) WHERE available_quantity > 0;

CREATE TABLE inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL REFERENCES inventory(id),
  material_id uuid NOT NULL REFERENCES materials(id),
  transaction_type inventory_transaction_type NOT NULL,
  quantity numeric NOT NULL,
  secondary_quantity numeric,
  machine_id uuid REFERENCES machines(id),
  request_item_table text,
  request_item_id uuid,
  performed_by uuid NOT NULL REFERENCES users(id),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inv_transactions_inventory ON inventory_transactions(inventory_id);
CREATE INDEX idx_inv_transactions_material ON inventory_transactions(material_id);
CREATE INDEX idx_inv_transactions_machine ON inventory_transactions(machine_id);
CREATE INDEX idx_inv_transactions_type ON inventory_transactions(transaction_type);
CREATE INDEX idx_inv_transactions_date ON inventory_transactions(created_at);

CREATE TABLE inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id uuid NOT NULL REFERENCES inventory(id),
  material_id uuid NOT NULL REFERENCES materials(id),
  machine_id uuid NOT NULL REFERENCES machines(id),
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  reserved_quantity numeric NOT NULL CHECK (reserved_quantity > 0),
  reserved_secondary_quantity numeric,
  reserved_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_reservation_unique ON inventory_reservations(request_item_table, request_item_id);
CREATE INDEX idx_reservations_machine ON inventory_reservations(machine_id);
CREATE INDEX idx_reservations_material ON inventory_reservations(material_id);
CREATE INDEX idx_reservations_inventory ON inventory_reservations(inventory_id);

ALTER TABLE request_sheet_metal ADD COLUMN IF NOT EXISTS reserved_from_stock_kg numeric DEFAULT 0;
ALTER TABLE request_round_tube ADD COLUMN IF NOT EXISTS reserved_from_stock_kg numeric DEFAULT 0;
ALTER TABLE request_round_tube ADD COLUMN IF NOT EXISTS reserved_from_stock_m numeric DEFAULT 0;
ALTER TABLE request_knives ADD COLUMN IF NOT EXISTS reserved_from_stock_mm numeric DEFAULT 0;
ALTER TABLE request_components ADD COLUMN IF NOT EXISTS reserved_from_stock numeric DEFAULT 0;
ALTER TABLE request_paint ADD COLUMN IF NOT EXISTS reserved_from_stock_kg numeric DEFAULT 0;

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read" ON inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON inventory FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON inventory FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated read" ON inventory_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON inventory_transactions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated read" ON inventory_reservations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON inventory_reservations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON inventory_reservations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete" ON inventory_reservations FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION fn_set_request_reserved_quantity(
  p_table text,
  p_id uuid,
  p_quantity numeric,
  p_secondary_quantity numeric DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  IF p_table = 'request_sheet_metal' THEN
    UPDATE request_sheet_metal SET reserved_from_stock_kg = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_round_tube' THEN
    UPDATE request_round_tube
    SET reserved_from_stock_kg = p_quantity,
        reserved_from_stock_m = COALESCE(p_secondary_quantity, 0)
    WHERE id = p_id;
  ELSIF p_table = 'request_knives' THEN
    UPDATE request_knives SET reserved_from_stock_mm = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_components' THEN
    UPDATE request_components SET reserved_from_stock = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_paint' THEN
    UPDATE request_paint SET reserved_from_stock_kg = p_quantity WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Некорректная таблица позиции: %', p_table;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
    unit = EXCLUDED.unit,
    total_secondary_quantity = CASE
      WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.total_secondary_quantity
      ELSE COALESCE(inventory.total_secondary_quantity, 0) + EXCLUDED.total_secondary_quantity
    END,
    reserved_secondary_quantity = CASE
      WHEN EXCLUDED.total_secondary_quantity IS NULL THEN inventory.reserved_secondary_quantity
      ELSE COALESCE(inventory.reserved_secondary_quantity, 0)
    END,
    secondary_unit = COALESCE(EXCLUDED.secondary_unit, inventory.secondary_unit),
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

CREATE OR REPLACE FUNCTION fn_adjust_inventory(
  p_material_id uuid,
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

  SELECT * INTO v_inventory FROM inventory WHERE material_id = p_material_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Остаток материала не найден';
  END IF;

  IF p_new_total < v_inventory.reserved_quantity THEN
    RAISE EXCEPTION 'Новый остаток меньше забронированного количества';
  END IF;

  IF p_new_secondary_total IS NOT NULL AND p_new_secondary_total < COALESCE(v_inventory.reserved_secondary_quantity, 0) THEN
    RAISE EXCEPTION 'Новый остаток в метрах меньше забронированного количества';
  END IF;

  v_diff := p_new_total - v_inventory.total_quantity;
  v_secondary_diff := CASE
    WHEN p_new_secondary_total IS NULL THEN NULL
    ELSE p_new_secondary_total - COALESCE(v_inventory.total_secondary_quantity, 0)
  END;

  UPDATE inventory
  SET total_quantity = p_new_total,
      total_secondary_quantity = COALESCE(p_new_secondary_total, total_secondary_quantity),
      last_updated_by = p_performed_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  INSERT INTO inventory_transactions (
    inventory_id,
    material_id,
    transaction_type,
    quantity,
    secondary_quantity,
    performed_by,
    comment
  )
  VALUES (v_inventory.id, p_material_id, 'adjustment', v_diff, v_secondary_diff, p_performed_by, p_comment);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_reserve_inventory_for_machine(
  p_material_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  v_inventory inventory%ROWTYPE;
  v_reservation_id uuid;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  SELECT * INTO v_inventory FROM inventory WHERE material_id = p_material_id FOR UPDATE;
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
