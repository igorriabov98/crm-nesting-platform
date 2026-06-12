ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'procurement_head';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'painting_head';

ALTER TYPE machine_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE machine_status ADD VALUE IF NOT EXISTS 'planned';
ALTER TYPE machine_status ADD VALUE IF NOT EXISTS 'request_ready';
ALTER TYPE machine_status ADD VALUE IF NOT EXISTS 'purchasing';
ALTER TYPE machine_status ADD VALUE IF NOT EXISTS 'material_received';

CREATE TYPE material_category AS ENUM (
  'sheet_metal',
  'round_tube',
  'knives',
  'components',
  'paint',
  'other'
);

CREATE TYPE task_type AS ENUM (
  'supply_start',
  'technologist_request',
  'engineer_confirm'
);

CREATE TYPE task_status AS ENUM (
  'pending',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TYPE request_status AS ENUM (
  'draft',
  'pending_stock_check',
  'stock_checked',
  'submitted_to_supply',
  'completed'
);

CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_active ON suppliers(is_active);

CREATE TABLE supplier_delivery_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_supplier_delivery_days_unique ON supplier_delivery_days(supplier_id, day_of_week);

CREATE TABLE supplier_material_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  category material_category NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_supplier_mat_cat_unique ON supplier_material_categories(supplier_id, category);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES users(id),
  task_type task_type NOT NULL,
  title text NOT NULL,
  description text,
  status task_status NOT NULL DEFAULT 'pending',
  start_date date,
  deadline date NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_machine ON tasks(machine_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_deadline ON tasks(deadline);

CREATE TABLE technologist_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  status request_status NOT NULL DEFAULT 'draft',
  notes text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_tech_request_machine ON technologist_requests(machine_id);

CREATE TABLE request_sheet_metal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,
  material_name text NOT NULL,
  material_grade text,
  thickness_mm numeric,
  sheet_size text,
  quantity_sheets int NOT NULL DEFAULT 1,
  weight_order_kg numeric NOT NULL DEFAULT 0,
  weight_scrap_kg numeric DEFAULT 0,
  scrap_percent numeric DEFAULT 0,
  stock_on_hand_kg numeric,
  stock_sheet_size text,
  additional_parts_kg numeric DEFAULT 0,
  business_scrap_kg numeric DEFAULT 0,
  stock_parts_kg numeric DEFAULT 0,
  to_order_kg numeric GENERATED ALWAYS AS (
    GREATEST(weight_order_kg - COALESCE(stock_on_hand_kg, 0) - COALESCE(stock_parts_kg, 0), 0)
  ) STORED,
  supplier_id uuid REFERENCES suppliers(id),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_req_sheet_metal_request ON request_sheet_metal(request_id);

CREATE TABLE request_round_tube (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,
  material_name text NOT NULL,
  order_meters numeric NOT NULL DEFAULT 0,
  order_kg numeric NOT NULL DEFAULT 0,
  actual_meters numeric DEFAULT 0,
  actual_kg numeric DEFAULT 0,
  piece_count text,
  scrap_meters numeric DEFAULT 0,
  scrap_kg numeric DEFAULT 0,
  scrap_percent numeric DEFAULT 0,
  supplier_id uuid REFERENCES suppliers(id),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_req_round_tube_request ON request_round_tube(request_id);

CREATE TABLE request_knives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,
  knife_type text NOT NULL,
  order_mm numeric NOT NULL DEFAULT 0,
  will_be_used_mm numeric DEFAULT 0,
  stock_remainder_mm numeric,
  to_order_mm numeric GENERATED ALWAYS AS (
    GREATEST(COALESCE(will_be_used_mm, order_mm) - COALESCE(stock_remainder_mm, 0), 0)
  ) STORED,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_req_knives_request ON request_knives(request_id);

CREATE TABLE request_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,
  component_name text NOT NULL,
  specification text,
  quantity_needed numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'шт',
  availability text DEFAULT 'unknown',
  stock_remainder numeric,
  to_order numeric GENERATED ALWAYS AS (
    GREATEST(quantity_needed - COALESCE(stock_remainder, 0), 0)
  ) STORED,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_req_components_request ON request_components(request_id);

CREATE TABLE request_paint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,
  paint_type text NOT NULL DEFAULT 'Краска',
  ral_code text NOT NULL,
  finish text,
  area_m2 numeric NOT NULL DEFAULT 0,
  weight_kg numeric NOT NULL DEFAULT 0,
  waste_percent numeric DEFAULT 20,
  weight_with_waste_kg numeric GENERATED ALWAYS AS (
    weight_kg * (1 + COALESCE(waste_percent, 20) / 100.0)
  ) STORED,
  stock_remainder_kg numeric,
  to_order_kg numeric GENERATED ALWAYS AS (
    GREATEST(weight_kg * (1 + COALESCE(waste_percent, 20) / 100.0) - COALESCE(stock_remainder_kg, 0), 0)
  ) STORED,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_req_paint_request ON request_paint(request_id);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_delivery_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_material_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE technologist_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_sheet_metal ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_round_tube ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_knives ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_paint ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read all" ON suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON suppliers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON supplier_delivery_days FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON supplier_delivery_days FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON supplier_delivery_days FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON supplier_material_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON supplier_material_categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON supplier_material_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON tasks FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON technologist_requests FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON technologist_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON technologist_requests FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON request_sheet_metal FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON request_sheet_metal FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON request_sheet_metal FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON request_round_tube FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON request_round_tube FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON request_round_tube FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON request_knives FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON request_knives FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON request_knives FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON request_components FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON request_components FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON request_components FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read all" ON request_paint FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert" ON request_paint FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update" ON request_paint FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
