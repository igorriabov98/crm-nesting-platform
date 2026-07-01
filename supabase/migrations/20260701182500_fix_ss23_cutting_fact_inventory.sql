-- Link the Beregovo production-fact "Заготовка" section to the cutting stage
-- and apply the missing cutting fact side effects for SS23 on 2026-06-30.

UPDATE public.production_fact_sections AS section
SET production_stage_type = 'cutting'::public.stage_type
FROM public.factories AS factory
WHERE section.id = '03c85630-bfc7-487d-b79c-ce5b1763793f'::uuid
  AND section.factory_id = factory.id
  AND factory.id = '14fc4014-3149-4127-b886-d56e30337763'::uuid
  AND lower(btrim(section.name)) = 'заготовка'
  AND section.is_active = true
  AND section.archived_at IS NULL
  AND section.production_stage_type IS DISTINCT FROM 'cutting'::public.stage_type;

DO $$
DECLARE
  v_fact_id uuid;
  v_performed_by uuid;
BEGIN
  SELECT fact.id, COALESCE(fact.updated_by, fact.created_by)
  INTO v_fact_id, v_performed_by
  FROM public.production_machine_facts AS fact
  JOIN public.machines AS machine ON machine.id = fact.machine_id
  WHERE fact.id = 'c7d02e9c-5576-404c-a52a-59150263c0ef'::uuid
    AND fact.fact_date = '2026-06-30'::date
    AND fact.section_id = '03c85630-bfc7-487d-b79c-ce5b1763793f'::uuid
    AND machine.id = '013f3abf-f512-4826-a3ba-8c2a744480f6'::uuid
    AND machine.factory_id = '14fc4014-3149-4127-b886-d56e30337763'::uuid
    AND machine.production_month = '2026-06-01'::date
    AND machine.name = 'SS23'
  LIMIT 1;

  IF v_fact_id IS NULL THEN
    RAISE NOTICE 'SS23 cutting fact for 2026-06-30 was not found; skipping replay.';
    RETURN;
  END IF;

  IF v_performed_by IS NULL THEN
    SELECT id
    INTO v_performed_by
    FROM public.users
    WHERE is_active = true
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF v_performed_by IS NULL THEN
    RAISE EXCEPTION 'Cannot apply SS23 cutting fact: no performed_by user found.';
  END IF;

  PERFORM public.fn_apply_production_fact_cutting(v_fact_id, v_performed_by);
END;
$$;
