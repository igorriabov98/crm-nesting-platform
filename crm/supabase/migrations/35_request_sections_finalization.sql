-- Finalize technologist request sections.
-- Keep legacy columns for compatibility where possible; make round/tube scrap derived.

ALTER TABLE material_variants
  ADD COLUMN IF NOT EXISTS material_grade text;

ALTER TABLE request_round_tube
  DROP COLUMN IF EXISTS scrap_meters,
  DROP COLUMN IF EXISTS scrap_kg,
  DROP COLUMN IF EXISTS scrap_percent;

ALTER TABLE request_round_tube
  ADD COLUMN scrap_meters numeric GENERATED ALWAYS AS (
    GREATEST(COALESCE(order_meters, 0) - COALESCE(actual_meters, 0), 0)
  ) STORED,
  ADD COLUMN scrap_kg numeric GENERATED ALWAYS AS (
    GREATEST(COALESCE(order_kg, 0) - COALESCE(actual_kg, 0), 0)
  ) STORED,
  ADD COLUMN scrap_percent numeric GENERATED ALWAYS AS (
    CASE
      WHEN COALESCE(order_kg, 0) > 0
        THEN GREATEST(COALESCE(order_kg, 0) - COALESCE(actual_kg, 0), 0) / order_kg * 100
      ELSE NULL
    END
  ) STORED;
