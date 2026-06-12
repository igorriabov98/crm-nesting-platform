-- Planned split deliveries for supply order lines.

CREATE TABLE IF NOT EXISTS supply_order_delivery_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_item_table text NOT NULL CHECK (
    request_item_table IN (
      'request_sheet_metal',
      'request_round_tube',
      'request_circle',
      'request_pipe',
      'request_knives',
      'request_components',
      'request_paint',
      'request_mesh',
      'request_chain_cord'
    )
  ),
  request_item_id uuid NOT NULL,
  delivery_date date NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  supplier_id uuid REFERENCES suppliers(id),
  change_reason text,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supply_delivery_schedules_item
  ON supply_order_delivery_schedules(request_item_table, request_item_id);
CREATE INDEX IF NOT EXISTS idx_supply_delivery_schedules_date
  ON supply_order_delivery_schedules(delivery_date);
CREATE INDEX IF NOT EXISTS idx_supply_delivery_schedules_supplier
  ON supply_order_delivery_schedules(supplier_id);

CREATE TABLE IF NOT EXISTS supply_order_delivery_schedule_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES supply_order_delivery_schedules(id) ON DELETE CASCADE,
  old_delivery_date date,
  new_delivery_date date,
  old_quantity numeric,
  new_quantity numeric,
  old_supplier_id uuid REFERENCES suppliers(id),
  new_supplier_id uuid REFERENCES suppliers(id),
  reason text,
  changed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supply_delivery_schedule_changes_schedule
  ON supply_order_delivery_schedule_changes(schedule_id);

ALTER TABLE supply_order_delivery_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE supply_order_delivery_schedule_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read supply_order_delivery_schedules" ON supply_order_delivery_schedules;
DROP POLICY IF EXISTS "Authenticated insert supply_order_delivery_schedules" ON supply_order_delivery_schedules;
DROP POLICY IF EXISTS "Authenticated update supply_order_delivery_schedules" ON supply_order_delivery_schedules;
DROP POLICY IF EXISTS "Authenticated read supply_order_delivery_schedule_changes" ON supply_order_delivery_schedule_changes;
DROP POLICY IF EXISTS "Authenticated insert supply_order_delivery_schedule_changes" ON supply_order_delivery_schedule_changes;

CREATE POLICY "Authenticated read supply_order_delivery_schedules"
  ON supply_order_delivery_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert supply_order_delivery_schedules"
  ON supply_order_delivery_schedules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update supply_order_delivery_schedules"
  ON supply_order_delivery_schedules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read supply_order_delivery_schedule_changes"
  ON supply_order_delivery_schedule_changes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert supply_order_delivery_schedule_changes"
  ON supply_order_delivery_schedule_changes FOR INSERT TO authenticated WITH CHECK (true);
