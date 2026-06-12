CREATE TABLE steel_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  density_kg_mm3 numeric NOT NULL,
  created_at timestamptz DEFAULT now()
);

INSERT INTO steel_types (name, density_kg_mm3) VALUES
  ('S235', 0.00000785),
  ('S355', 0.00000785),
  ('Hardox', 0.00000780);

ALTER TABLE steel_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "steel_types_select" ON steel_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "steel_types_all" ON steel_types
  FOR ALL TO authenticated USING (true);

ALTER TABLE request_sheet_metal
  ADD COLUMN steel_type_id uuid REFERENCES steel_types(id) ON DELETE SET NULL;

ALTER TABLE request_circle
  ADD COLUMN steel_type_id uuid REFERENCES steel_types(id) ON DELETE SET NULL;

ALTER TABLE request_pipe
  ADD COLUMN steel_type_id uuid REFERENCES steel_types(id) ON DELETE SET NULL;

ALTER TABLE request_knives
  ADD COLUMN steel_type_id uuid REFERENCES steel_types(id) ON DELETE SET NULL;

ALTER TABLE request_sheet_metal ADD COLUMN calculated_weight_kg numeric;
ALTER TABLE request_circle ADD COLUMN calculated_weight_kg numeric;
ALTER TABLE request_pipe ADD COLUMN calculated_weight_kg numeric;
ALTER TABLE request_knives ADD COLUMN calculated_weight_kg numeric;

ALTER TABLE material_variants ADD COLUMN unit_weight_kg numeric;

ALTER TABLE inventory ADD COLUMN calculated_weight_kg numeric;
ALTER TABLE inventory ADD COLUMN piece_length_mm numeric;

-- piece_length_mm используется только для категорий pipe и knives.
-- Для остальных категорий остаётся NULL.
-- Уникальность позиции на складе для трубы/ножей:
-- material_variant_id + piece_length_mm
