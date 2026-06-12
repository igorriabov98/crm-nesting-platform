ALTER TABLE request_sheet_metal
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;

ALTER TABLE request_circle
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;

ALTER TABLE request_pipe
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;

ALTER TABLE request_knives
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;

ALTER TABLE request_components
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;

ALTER TABLE request_paint
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;

ALTER TABLE request_mesh
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;

ALTER TABLE request_chain_cord
  ADD COLUMN IF NOT EXISTS is_custom_material_variant boolean NOT NULL DEFAULT false;
