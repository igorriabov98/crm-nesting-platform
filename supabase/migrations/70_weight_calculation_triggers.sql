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
BEGIN
  IF NEW.steel_type_id IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  SELECT density_kg_mm3 INTO v_density
  FROM steel_types WHERE id = NEW.steel_type_id;

  IF v_density IS NULL OR NEW.thickness_mm IS NULL
     OR NEW.sheet_size IS NULL OR NEW.quantity_sheets IS NULL THEN
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
    round((v_length * v_width * NEW.thickness_mm * v_density * NEW.quantity_sheets)::numeric, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weight_sheet_metal
  BEFORE INSERT OR UPDATE ON request_sheet_metal
  FOR EACH ROW EXECUTE FUNCTION trg_calc_weight_sheet_metal();

CREATE OR REPLACE FUNCTION trg_calc_weight_circle()
RETURNS trigger AS $$
DECLARE
  v_density numeric;
BEGIN
  IF NEW.steel_type_id IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  SELECT density_kg_mm3 INTO v_density
  FROM steel_types WHERE id = NEW.steel_type_id;

  IF v_density IS NULL OR NEW.diameter_mm IS NULL
     OR NEW.remainder_mm IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  NEW.calculated_weight_kg :=
    round((pi() * power(NEW.diameter_mm / 2, 2) * NEW.remainder_mm * v_density)::numeric, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weight_circle
  BEFORE INSERT OR UPDATE ON request_circle
  FOR EACH ROW EXECUTE FUNCTION trg_calc_weight_circle();

CREATE OR REPLACE FUNCTION trg_calc_weight_pipe()
RETURNS trigger AS $$
DECLARE
  v_density numeric;
  v_dims numeric[];
  v_a numeric;
  v_b numeric;
  v_cross_section numeric;
BEGIN
  IF NEW.pipe_type = 'wire' THEN
    NEW.calculated_weight_kg := NEW.remainder_kg;
    RETURN NEW;
  END IF;

  IF NEW.steel_type_id IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  SELECT density_kg_mm3 INTO v_density
  FROM steel_types WHERE id = NEW.steel_type_id;

  IF v_density IS NULL OR NEW.wall_thickness_mm IS NULL
     OR NEW.remainder_length_mm IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  IF NEW.pipe_type = 'square' THEN
    v_dims := parse_size_dimensions(NEW.size);
    IF v_dims IS NULL THEN
      NEW.calculated_weight_kg := NULL;
      RETURN NEW;
    END IF;

    v_a := v_dims[1];
    v_cross_section := power(v_a, 2) - power(v_a - 2 * NEW.wall_thickness_mm, 2);
  ELSIF NEW.pipe_type = 'rectangular' THEN
    v_dims := parse_size_dimensions(NEW.size);
    IF v_dims IS NULL THEN
      NEW.calculated_weight_kg := NULL;
      RETURN NEW;
    END IF;

    v_a := v_dims[1];
    v_b := v_dims[2];
    v_cross_section := (v_a * v_b)
      - ((v_a - 2 * NEW.wall_thickness_mm) * (v_b - 2 * NEW.wall_thickness_mm));
  ELSIF NEW.pipe_type = 'round' THEN
    IF NEW.diameter_mm IS NULL THEN
      NEW.calculated_weight_kg := NULL;
      RETURN NEW;
    END IF;

    v_cross_section := pi() * (
      power(NEW.diameter_mm / 2, 2)
      - power((NEW.diameter_mm - 2 * NEW.wall_thickness_mm) / 2, 2)
    );
  ELSE
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  NEW.calculated_weight_kg :=
    round((v_cross_section * NEW.remainder_length_mm * v_density * NEW.remainder_qty)::numeric, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weight_pipe
  BEFORE INSERT OR UPDATE ON request_pipe
  FOR EACH ROW EXECUTE FUNCTION trg_calc_weight_pipe();

CREATE OR REPLACE FUNCTION trg_calc_weight_knives()
RETURNS trigger AS $$
DECLARE
  v_density numeric;
BEGIN
  IF NEW.steel_type_id IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  SELECT density_kg_mm3 INTO v_density
  FROM steel_types WHERE id = NEW.steel_type_id;

  IF v_density IS NULL OR NEW.length_mm IS NULL
     OR NEW.width_mm IS NULL OR NEW.height_mm IS NULL
     OR NEW.remainder_qty IS NULL THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  NEW.calculated_weight_kg :=
    round((NEW.length_mm * NEW.width_mm * NEW.height_mm
           * v_density * NEW.remainder_qty)::numeric, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weight_knives
  BEFORE INSERT OR UPDATE ON request_knives
  FOR EACH ROW EXECUTE FUNCTION trg_calc_weight_knives();
