CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category material_category NOT NULL,
  comment text,
  default_supplier_id uuid REFERENCES suppliers(id),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_name ON materials(name);
CREATE INDEX IF NOT EXISTS idx_materials_supplier ON materials(default_supplier_id);
CREATE INDEX IF NOT EXISTS idx_materials_name_trgm ON materials USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS material_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  category material_category NOT NULL,
  thickness_mm numeric,
  sheet_size text,
  weight_per_unit_kg numeric,
  length_m numeric,
  weight_per_m_kg numeric,
  piece_description text,
  knife_dimensions text,
  knife_material text,
  standard_length_mm numeric,
  specification text,
  default_unit text DEFAULT 'шт',
  ral_code text,
  finish text,
  default_waste_percent numeric DEFAULT 20,
  times_used int NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_variants_material ON material_variants(material_id);
CREATE INDEX IF NOT EXISTS idx_material_variants_category ON material_variants(category);
CREATE INDEX IF NOT EXISTS idx_material_variants_usage ON material_variants(times_used DESC);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS delivery_lead_days int NOT NULL DEFAULT 0;

ALTER TABLE request_sheet_metal ADD COLUMN IF NOT EXISTS custom_delivery_date date;
ALTER TABLE request_round_tube ADD COLUMN IF NOT EXISTS custom_delivery_date date;
ALTER TABLE request_knives ADD COLUMN IF NOT EXISTS custom_delivery_date date;
ALTER TABLE request_components ADD COLUMN IF NOT EXISTS custom_delivery_date date;
ALTER TABLE request_paint ADD COLUMN IF NOT EXISTS custom_delivery_date date;

ALTER TABLE request_sheet_metal ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES materials(id);
ALTER TABLE request_sheet_metal ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);
ALTER TABLE request_round_tube ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES materials(id);
ALTER TABLE request_round_tube ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);
ALTER TABLE request_knives ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES materials(id);
ALTER TABLE request_knives ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);
ALTER TABLE request_components ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES materials(id);
ALTER TABLE request_components ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);
ALTER TABLE request_paint ADD COLUMN IF NOT EXISTS material_id uuid REFERENCES materials(id);
ALTER TABLE request_paint ADD COLUMN IF NOT EXISTS material_variant_id uuid REFERENCES material_variants(id);

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read materials" ON materials;
DROP POLICY IF EXISTS "Authenticated insert materials" ON materials;
DROP POLICY IF EXISTS "Authenticated update materials" ON materials;
DROP POLICY IF EXISTS "Authenticated read variants" ON material_variants;
DROP POLICY IF EXISTS "Authenticated insert variants" ON material_variants;
DROP POLICY IF EXISTS "Authenticated update variants" ON material_variants;

CREATE POLICY "Authenticated read materials" ON materials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert materials" ON materials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update materials" ON materials FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated read variants" ON material_variants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert variants" ON material_variants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update variants" ON material_variants FOR UPDATE TO authenticated USING (true);
