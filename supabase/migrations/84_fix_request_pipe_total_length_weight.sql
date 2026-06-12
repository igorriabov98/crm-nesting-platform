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
     OR NEW.wall_thickness_mm <= 0
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
    IF NEW.wall_thickness_mm * 2 >= v_a THEN
      NEW.calculated_weight_kg := NULL;
      RETURN NEW;
    END IF;
    v_cross_section := power(v_a, 2) - power(v_a - 2 * NEW.wall_thickness_mm, 2);
  ELSIF NEW.pipe_type = 'rectangular' THEN
    v_dims := parse_size_dimensions(NEW.size);
    IF v_dims IS NULL THEN
      NEW.calculated_weight_kg := NULL;
      RETURN NEW;
    END IF;

    v_a := v_dims[1];
    v_b := v_dims[2];
    IF NEW.wall_thickness_mm * 2 >= LEAST(v_a, v_b) THEN
      NEW.calculated_weight_kg := NULL;
      RETURN NEW;
    END IF;
    v_cross_section := (v_a * v_b)
      - ((v_a - 2 * NEW.wall_thickness_mm) * (v_b - 2 * NEW.wall_thickness_mm));
  ELSIF NEW.pipe_type = 'round' THEN
    IF NEW.diameter_mm IS NULL OR NEW.wall_thickness_mm * 2 >= NEW.diameter_mm THEN
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

  IF v_cross_section IS NULL OR v_cross_section <= 0 THEN
    NEW.calculated_weight_kg := NULL;
    RETURN NEW;
  END IF;

  -- remainder_length_mm stores total requested length. remainder_qty is a secondary
  -- piece count and must not multiply the primary length again.
  NEW.calculated_weight_kg :=
    round((v_cross_section * NEW.remainder_length_mm * v_density)::numeric, 2);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE request_pipe
SET remainder_length_mm = remainder_length_mm
WHERE pipe_type <> 'wire';
