CREATE OR REPLACE FUNCTION calc_inventory_weight_kg(
  p_material_id uuid,
  p_material_variant_id uuid,
  p_total_quantity numeric,
  p_unit text,
  p_piece_length_mm numeric,
  p_total_secondary_quantity numeric DEFAULT NULL
)
RETURNS numeric AS $$
DECLARE
  v_category material_category;
  v_variant material_variants%ROWTYPE;
  v_density numeric;
  v_dims numeric[];
  v_a numeric;
  v_b numeric;
  v_cross_section numeric;
  v_total_length numeric;
BEGIN
  IF p_total_quantity IS NULL THEN
    RETURN NULL;
  END IF;

  IF lower(COALESCE(p_unit, '')) IN ('кг', 'kg') THEN
    RETURN round(p_total_quantity::numeric, 2);
  END IF;

  SELECT category INTO v_category
  FROM materials
  WHERE id = p_material_id;

  IF p_material_variant_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_variant
  FROM material_variants
  WHERE id = p_material_variant_id;

  IF v_variant.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_variant.steel_type_id IS NOT NULL THEN
    SELECT density_kg_mm3 INTO v_density
    FROM steel_types
    WHERE id = v_variant.steel_type_id;
  END IF;

  IF v_density IS NULL AND v_variant.material_grade IS NOT NULL THEN
    SELECT density_kg_mm3 INTO v_density
    FROM steel_types
    WHERE lower(name) = lower(trim(v_variant.material_grade))
    LIMIT 1;
  END IF;

  IF v_category = 'sheet_metal' THEN
    IF v_density IS NULL OR v_variant.sheet_size IS NULL OR v_variant.thickness_mm IS NULL THEN
      RETURN NULL;
    END IF;

    v_dims := parse_size_dimensions(v_variant.sheet_size);
    IF v_dims IS NULL THEN
      RETURN NULL;
    END IF;

    RETURN round((v_dims[1] * v_dims[2] * v_variant.thickness_mm * v_density * p_total_quantity)::numeric, 2);
  END IF;

  IF v_category = 'circle' THEN
    IF v_density IS NULL OR v_variant.diameter_mm IS NULL THEN
      RETURN NULL;
    END IF;

    RETURN round((pi() * power(v_variant.diameter_mm / 2, 2) * p_total_quantity * v_density)::numeric, 2);
  END IF;

  IF v_category = 'pipe' THEN
    IF v_variant.pipe_type = 'wire' THEN
      RETURN round(p_total_quantity::numeric, 2);
    END IF;

    IF v_density IS NULL OR v_variant.wall_thickness_mm IS NULL THEN
      RETURN NULL;
    END IF;

    v_total_length := COALESCE(p_piece_length_mm * NULLIF(p_total_secondary_quantity, 0), p_total_quantity);

    IF v_variant.pipe_type = 'round' THEN
      IF v_variant.diameter_mm IS NULL THEN
        RETURN NULL;
      END IF;

      v_cross_section := pi() * (
        power(v_variant.diameter_mm / 2, 2)
        - power((v_variant.diameter_mm - 2 * v_variant.wall_thickness_mm) / 2, 2)
      );
    ELSE
      v_dims := parse_size_dimensions(v_variant.piece_description);
      IF v_dims IS NULL THEN
        RETURN NULL;
      END IF;

      v_a := v_dims[1];
      v_b := CASE WHEN v_variant.pipe_type = 'square' THEN v_dims[1] ELSE v_dims[2] END;
      v_cross_section := (v_a * v_b)
        - ((v_a - 2 * v_variant.wall_thickness_mm) * (v_b - 2 * v_variant.wall_thickness_mm));
    END IF;

    RETURN round((v_cross_section * v_total_length * v_density)::numeric, 2);
  END IF;

  IF v_category = 'knives' THEN
    IF v_density IS NULL OR v_variant.standard_length_mm IS NULL
       OR v_variant.width_mm IS NULL OR v_variant.height_mm IS NULL THEN
      RETURN NULL;
    END IF;

    RETURN round((v_variant.standard_length_mm * v_variant.width_mm * v_variant.height_mm
      * v_density * p_total_quantity)::numeric, 2);
  END IF;

  IF v_variant.unit_weight_kg IS NOT NULL THEN
    RETURN round((v_variant.unit_weight_kg * p_total_quantity)::numeric, 2);
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

UPDATE inventory
SET total_quantity = total_quantity
WHERE deleted_at IS NULL;
