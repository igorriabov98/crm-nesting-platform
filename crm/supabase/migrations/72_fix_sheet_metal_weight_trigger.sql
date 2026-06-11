CREATE OR REPLACE FUNCTION parse_size_dimensions(size_str text)
RETURNS numeric[] AS $$
DECLARE
  parts text[];
BEGIN
  IF size_str IS NULL THEN
    RETURN NULL;
  END IF;

  IF position('×' IN size_str) > 0 THEN
    parts := string_to_array(size_str, '×');
  ELSIF position('x' IN size_str) > 0 THEN
    parts := string_to_array(size_str, 'x');
  ELSIF position('X' IN size_str) > 0 THEN
    parts := string_to_array(size_str, 'X');
  ELSIF position('х' IN size_str) > 0 THEN
    parts := string_to_array(size_str, 'х');
  ELSIF position('Х' IN size_str) > 0 THEN
    parts := string_to_array(size_str, 'Х');
  ELSE
    RETURN NULL;
  END IF;

  IF array_length(parts, 1) < 2 THEN
    RETURN NULL;
  END IF;

  RETURN ARRAY[trim(parts[1])::numeric, trim(parts[2])::numeric];
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
  IF NEW.steel_type_id IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  SELECT density_kg_mm3 INTO v_density
  FROM steel_types WHERE id = NEW.steel_type_id;

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
SET calculated_weight_kg = NULL
WHERE steel_type_id IS NOT NULL
  AND sheet_size IS NOT NULL
  AND thickness_mm IS NOT NULL
  AND remainder_qty IS NOT NULL;
