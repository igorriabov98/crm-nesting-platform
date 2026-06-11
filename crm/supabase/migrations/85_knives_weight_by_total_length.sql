CREATE OR REPLACE FUNCTION trg_calc_weight_knives()
RETURNS trigger AS $$
DECLARE
  v_density numeric;
  v_total_length_mm numeric;
BEGIN
  IF NEW.steel_type_id IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  SELECT density_kg_mm3 INTO v_density
  FROM steel_types WHERE id = NEW.steel_type_id;

  v_total_length_mm := COALESCE(NEW.remainder_meters, 0) * 1000;

  IF v_density IS NULL OR NEW.width_mm IS NULL OR NEW.height_mm IS NULL
     OR v_total_length_mm <= 0 THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  NEW.calculated_weight_kg :=
    round((v_total_length_mm * NEW.width_mm * NEW.height_mm * v_density)::numeric, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE request_knives
SET remainder_meters = remainder_meters,
    remainder_qty = 0;
