CREATE OR REPLACE FUNCTION parse_size_dimensions(size_str text)
RETURNS numeric[] AS $$
DECLARE
  parts text[];
BEGIN
  IF size_str IS NULL THEN
    RETURN NULL;
  END IF;

  parts := regexp_split_to_array(trim(size_str), '\s*[xX×хХ]\s*');

  IF array_length(parts, 1) < 2 THEN
    RETURN NULL;
  END IF;

  RETURN ARRAY[replace(trim(parts[1]), ',', '.')::numeric, replace(trim(parts[2]), ',', '.')::numeric];
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION trg_calc_weight_sheet_metal()
RETURNS trigger AS $$
DECLARE
  v_density numeric;
  v_dims numeric[];
  v_length numeric;
  v_width numeric;
  v_quantity numeric;
BEGIN
  IF NEW.steel_type_id IS NOT NULL THEN
    SELECT density_kg_mm3 INTO v_density
    FROM steel_types
    WHERE id = NEW.steel_type_id;
  END IF;

  IF v_density IS NULL AND NEW.material_grade IS NOT NULL THEN
    SELECT density_kg_mm3 INTO v_density
    FROM steel_types
    WHERE lower(name) = lower(trim(NEW.material_grade))
    LIMIT 1;
  END IF;

  v_quantity := NEW.remainder_qty;

  IF v_density IS NULL OR NEW.thickness_mm IS NULL
     OR NEW.sheet_size IS NULL OR v_quantity IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  v_dims := parse_size_dimensions(NEW.sheet_size);
  IF v_dims IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  v_length := v_dims[1];
  v_width := v_dims[2];

  NEW.calculated_weight_kg :=
    round((v_length * v_width * NEW.thickness_mm * v_density * v_quantity)::numeric, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE request_sheet_metal
SET sheet_size = sheet_size
WHERE sheet_size IS NOT NULL
  AND thickness_mm IS NOT NULL
  AND remainder_qty IS NOT NULL;
