-- Route active knife positions with exact variants through the whole-bar stock lifecycle.
-- Legacy knife positions and stock rows without piece_length_mm keep the cut-reservation path.

CREATE OR REPLACE FUNCTION public.fn_whole_bar_request_matches_inventory(
  p_request_item_table text,
  p_request_item_id uuid,
  p_inventory_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_variant public.material_variants%ROWTYPE;
  v_knife public.request_knives%ROWTYPE;
  v_circle public.request_circle%ROWTYPE;
  v_pipe public.request_pipe%ROWTYPE;
BEGIN
  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id
    AND deleted_at IS NULL;

  IF NOT FOUND OR v_inventory.material_variant_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_variant
  FROM public.material_variants
  WHERE id = v_inventory.material_variant_id;

  IF NOT FOUND OR v_variant.material_id IS DISTINCT FROM v_inventory.material_id THEN
    RETURN false;
  END IF;

  IF p_request_item_table = 'request_knives' THEN
    SELECT * INTO v_knife FROM public.request_knives WHERE id = p_request_item_id;
    IF NOT FOUND OR v_knife.material_id IS DISTINCT FROM v_inventory.material_id THEN
      RETURN false;
    END IF;
    RETURN v_variant.category = 'knives'::public.material_category
      AND v_knife.material_variant_id IS NOT NULL
      AND v_knife.material_variant_id = v_inventory.material_variant_id;
  END IF;

  IF p_request_item_table = 'request_circle' THEN
    SELECT * INTO v_circle FROM public.request_circle WHERE id = p_request_item_id;
    IF NOT FOUND OR v_circle.material_id IS DISTINCT FROM v_inventory.material_id THEN
      RETURN false;
    END IF;
    RETURN v_variant.category = 'circle'::public.material_category
      AND v_variant.diameter_mm IS NOT DISTINCT FROM v_circle.diameter_mm
      AND v_variant.steel_type_id IS NOT DISTINCT FROM v_circle.steel_type_id
      AND lower(btrim(COALESCE(v_variant.material_grade, ''))) = lower(btrim(COALESCE(v_circle.steel_grade, '')))
      AND COALESCE(v_variant.is_calibrated, false) = COALESCE(v_circle.is_calibrated, false);
  END IF;

  IF p_request_item_table = 'request_pipe' THEN
    SELECT * INTO v_pipe FROM public.request_pipe WHERE id = p_request_item_id;
    IF NOT FOUND
      OR v_pipe.pipe_type = 'wire'::public.pipe_subtype
      OR v_pipe.material_id IS DISTINCT FROM v_inventory.material_id THEN
      RETURN false;
    END IF;
    RETURN v_variant.category = 'pipe'::public.material_category
      AND v_variant.pipe_type IS NOT DISTINCT FROM v_pipe.pipe_type
      AND lower(regexp_replace(COALESCE(v_variant.piece_description, ''), '[[:space:]]', '', 'g'))
        = lower(regexp_replace(COALESCE(v_pipe.size, ''), '[[:space:]]', '', 'g'))
      AND v_variant.wall_thickness_mm IS NOT DISTINCT FROM v_pipe.wall_thickness_mm
      AND v_variant.diameter_mm IS NOT DISTINCT FROM v_pipe.diameter_mm
      AND v_variant.steel_type_id IS NOT DISTINCT FROM v_pipe.steel_type_id;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_whole_bar_request_matches_inventory(text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_whole_bar_request_matches_inventory(text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_whole_bar_request_matches_inventory(text, uuid, uuid) TO service_role;
