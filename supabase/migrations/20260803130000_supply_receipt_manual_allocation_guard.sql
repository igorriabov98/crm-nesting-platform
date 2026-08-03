-- Harden the existing atomic receiving RPC for operator-confirmed allocations.
-- The public signature stays unchanged; application code still sends trusted,
-- freshly recalculated physical and logical quantities through service_role.

DO $$
DECLARE
  v_definition text;
  v_allocation_validation_anchor text := $anchor$
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Некорректное распределение поставки';
  END IF;
$anchor$;
  v_allocation_validation_replacement text := $replacement$
  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' THEN
    RAISE EXCEPTION 'Некорректное распределение поставки';
  END IF;
  IF jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Распределите материал хотя бы на одну машину';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_allocations) AS allocation(value)
    GROUP BY allocation.value->>'table', allocation.value->>'id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Одна потребность указана в распределении несколько раз';
  END IF;
$replacement$;
  v_source_status_anchor text :=
    'status = CASE WHEN v_source_allocated > 0 THEN ''delivered'' ELSE ''cancelled'' END,';
  v_source_status_replacement text := 'status = ''delivered'',';
BEGIN
  SELECT pg_get_functiondef(
    'public.fn_receive_supply_order_schedule_v2(uuid,uuid,numeric,jsonb,numeric,numeric)'::regprocedure
  ) INTO v_definition;

  IF position(v_allocation_validation_anchor IN v_definition) = 0
    OR position(v_source_status_anchor IN v_definition) = 0
    OR position('Распределение превышает актуальный остаток потребности' IN v_definition) = 0
    OR position('FOR UPDATE' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected fn_receive_supply_order_schedule_v2 definition';
  END IF;

  v_definition := replace(
    v_definition,
    v_allocation_validation_anchor,
    v_allocation_validation_replacement
  );
  v_definition := replace(
    v_definition,
    v_source_status_anchor,
    v_source_status_replacement
  );

  EXECUTE v_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_receive_supply_order_schedule_v2(uuid, uuid, numeric, jsonb, numeric, numeric) TO service_role;
