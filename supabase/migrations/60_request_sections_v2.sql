-- Request sections v2: split round tube into circle/pipe and extract mesh/chain-cord.
-- Existing tables/columns are preserved for data safety; old fields become legacy-only in application code.

ALTER TYPE material_category ADD VALUE IF NOT EXISTS 'circle';
ALTER TYPE material_category ADD VALUE IF NOT EXISTS 'pipe';
ALTER TYPE material_category ADD VALUE IF NOT EXISTS 'mesh';
ALTER TYPE material_category ADD VALUE IF NOT EXISTS 'chain_cord';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipe_subtype') THEN
    CREATE TYPE pipe_subtype AS ENUM ('square', 'rectangular', 'round', 'wire');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'chain_cord_subtype') THEN
    CREATE TYPE chain_cord_subtype AS ENUM ('chain', 'cord');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS request_circle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,

  diameter_mm numeric,
  steel_grade text,
  is_calibrated boolean NOT NULL DEFAULT false,

  remainder_mm numeric NOT NULL DEFAULT 0,

  material_id uuid REFERENCES materials(id),
  material_variant_id uuid REFERENCES material_variants(id),

  custom_delivery_date date,
  order_status order_item_status NOT NULL DEFAULT 'pending',
  ordered_at timestamptz,
  delivered_at timestamptz,

  reserved_from_stock_mm numeric NOT NULL DEFAULT 0,

  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_circle_request ON request_circle(request_id);
CREATE INDEX IF NOT EXISTS idx_request_circle_material ON request_circle(material_id);

ALTER TABLE request_circle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read request_circle" ON request_circle;
DROP POLICY IF EXISTS "Authenticated insert request_circle" ON request_circle;
DROP POLICY IF EXISTS "Authenticated update request_circle" ON request_circle;
DROP POLICY IF EXISTS "Authenticated delete request_circle" ON request_circle;
CREATE POLICY "Authenticated read request_circle" ON request_circle FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert request_circle" ON request_circle FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update request_circle" ON request_circle FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete request_circle" ON request_circle FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS request_pipe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,

  pipe_type pipe_subtype NOT NULL,

  size text,
  wall_thickness_mm numeric,
  diameter_mm numeric,

  remainder_length_mm numeric NOT NULL DEFAULT 0,
  remainder_qty int NOT NULL DEFAULT 0,
  remainder_kg numeric NOT NULL DEFAULT 0,

  material_id uuid REFERENCES materials(id),
  material_variant_id uuid REFERENCES material_variants(id),

  custom_delivery_date date,
  order_status order_item_status NOT NULL DEFAULT 'pending',
  ordered_at timestamptz,
  delivered_at timestamptz,

  reserved_from_stock_length_mm numeric NOT NULL DEFAULT 0,
  reserved_from_stock_qty int NOT NULL DEFAULT 0,
  reserved_from_stock_kg numeric NOT NULL DEFAULT 0,

  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_pipe_request ON request_pipe(request_id);
CREATE INDEX IF NOT EXISTS idx_request_pipe_material ON request_pipe(material_id);
CREATE INDEX IF NOT EXISTS idx_request_pipe_type ON request_pipe(pipe_type);

ALTER TABLE request_pipe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read request_pipe" ON request_pipe;
DROP POLICY IF EXISTS "Authenticated insert request_pipe" ON request_pipe;
DROP POLICY IF EXISTS "Authenticated update request_pipe" ON request_pipe;
DROP POLICY IF EXISTS "Authenticated delete request_pipe" ON request_pipe;
CREATE POLICY "Authenticated read request_pipe" ON request_pipe FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert request_pipe" ON request_pipe FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update request_pipe" ON request_pipe FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete request_pipe" ON request_pipe FOR DELETE TO authenticated USING (true);

ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS remainder_qty int NOT NULL DEFAULT 0;

ALTER TABLE request_knives
  ADD COLUMN IF NOT EXISTS steel_grade text,
  ADD COLUMN IF NOT EXISTS length_mm numeric,
  ADD COLUMN IF NOT EXISTS width_mm numeric,
  ADD COLUMN IF NOT EXISTS height_mm numeric,
  ADD COLUMN IF NOT EXISTS remainder_meters numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remainder_qty int NOT NULL DEFAULT 0;

ALTER TABLE request_paint
  ADD COLUMN IF NOT EXISTS remainder_kg numeric NOT NULL DEFAULT 0;

ALTER TABLE request_components
  ADD COLUMN IF NOT EXISTS diameter_mm numeric;

CREATE TABLE IF NOT EXISTS request_mesh (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,

  description text,
  length_mm numeric,
  width_mm numeric,

  remainder_qty int NOT NULL DEFAULT 0,

  material_id uuid REFERENCES materials(id),
  material_variant_id uuid REFERENCES material_variants(id),

  custom_delivery_date date,
  order_status order_item_status NOT NULL DEFAULT 'pending',
  ordered_at timestamptz,
  delivered_at timestamptz,

  reserved_from_stock_qty int NOT NULL DEFAULT 0,

  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_mesh_request ON request_mesh(request_id);
CREATE INDEX IF NOT EXISTS idx_request_mesh_material ON request_mesh(material_id);

ALTER TABLE request_mesh ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read request_mesh" ON request_mesh;
DROP POLICY IF EXISTS "Authenticated insert request_mesh" ON request_mesh;
DROP POLICY IF EXISTS "Authenticated update request_mesh" ON request_mesh;
DROP POLICY IF EXISTS "Authenticated delete request_mesh" ON request_mesh;
CREATE POLICY "Authenticated read request_mesh" ON request_mesh FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert request_mesh" ON request_mesh FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update request_mesh" ON request_mesh FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete request_mesh" ON request_mesh FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS request_chain_cord (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES technologist_requests(id) ON DELETE CASCADE,

  item_type chain_cord_subtype NOT NULL,

  parameters text,

  remainder_meters numeric NOT NULL DEFAULT 0,

  material_id uuid REFERENCES materials(id),
  material_variant_id uuid REFERENCES material_variants(id),

  custom_delivery_date date,
  order_status order_item_status NOT NULL DEFAULT 'pending',
  ordered_at timestamptz,
  delivered_at timestamptz,

  reserved_from_stock_meters numeric NOT NULL DEFAULT 0,

  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_request_chain_cord_request ON request_chain_cord(request_id);
CREATE INDEX IF NOT EXISTS idx_request_chain_cord_material ON request_chain_cord(material_id);
CREATE INDEX IF NOT EXISTS idx_request_chain_cord_type ON request_chain_cord(item_type);

ALTER TABLE request_chain_cord ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read request_chain_cord" ON request_chain_cord;
DROP POLICY IF EXISTS "Authenticated insert request_chain_cord" ON request_chain_cord;
DROP POLICY IF EXISTS "Authenticated update request_chain_cord" ON request_chain_cord;
DROP POLICY IF EXISTS "Authenticated delete request_chain_cord" ON request_chain_cord;
CREATE POLICY "Authenticated read request_chain_cord" ON request_chain_cord FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert request_chain_cord" ON request_chain_cord FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update request_chain_cord" ON request_chain_cord FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete request_chain_cord" ON request_chain_cord FOR DELETE TO authenticated USING (true);

ALTER TABLE material_variants
  ADD COLUMN IF NOT EXISTS diameter_mm numeric,
  ADD COLUMN IF NOT EXISTS is_calibrated boolean,
  ADD COLUMN IF NOT EXISTS pipe_type pipe_subtype,
  ADD COLUMN IF NOT EXISTS wall_thickness_mm numeric,
  ADD COLUMN IF NOT EXISTS width_mm numeric,
  ADD COLUMN IF NOT EXISTS height_mm numeric,
  ADD COLUMN IF NOT EXISTS mesh_description text,
  ADD COLUMN IF NOT EXISTS mesh_length_mm numeric,
  ADD COLUMN IF NOT EXISTS mesh_width_mm numeric,
  ADD COLUMN IF NOT EXISTS chain_cord_type chain_cord_subtype,
  ADD COLUMN IF NOT EXISTS chain_cord_parameters text;
