-- Keep one mutable draft owner for each production target, including concurrent editors.
CREATE OR REPLACE FUNCTION public.fn_patch_production_plan_draft(
  p_plan_id uuid, p_key text, p_patch jsonb, p_expected_revision bigint, p_actor uuid
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan public.production_month_plans%ROWTYPE; v_draft public.production_plan_drafts%ROWTYPE;
BEGIN
  IF p_key IS NULL OR length(p_key) > 180 OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Некорректное изменение плана';
  END IF;

  -- All writers of the same target serialize before reading draft ownership.
  PERFORM pg_advisory_xact_lock(hashtextextended('production-plan-target:' || p_key, 0));
  IF EXISTS (
    SELECT 1 FROM public.production_plan_drafts other_draft
    WHERE other_draft.production_month_plan_id <> p_plan_id
      AND other_draft.changes ? p_key
  ) THEN
    RAISE EXCEPTION 'Эта запись уже находится в другом черновике плана. Обновите страницу.';
  END IF;

  SELECT * INTO v_plan FROM public.production_month_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'План месяца не найден'; END IF;
  INSERT INTO public.production_plan_drafts(production_month_plan_id, base_version_number)
    VALUES (p_plan_id, v_plan.published_version_number)
    ON CONFLICT (production_month_plan_id) DO NOTHING;
  SELECT * INTO v_draft FROM public.production_plan_drafts
    WHERE production_month_plan_id = p_plan_id FOR UPDATE;
  IF v_draft.base_version_number <> v_plan.published_version_number THEN
    RAISE EXCEPTION 'План опубликован другим редактором. Обновите страницу.';
  END IF;
  IF v_draft.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Черновик изменён другим редактором. Обновите страницу.';
  END IF;
  UPDATE public.production_plan_drafts
    SET changes = jsonb_set(changes, ARRAY[p_key], p_patch, true),
        revision = revision + 1, updated_by = p_actor, updated_at = now()
    WHERE production_month_plan_id = p_plan_id
    RETURNING revision INTO v_draft.revision;
  RETURN v_draft.revision;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_patch_production_plan_draft(uuid, text, jsonb, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_patch_production_plan_draft(uuid, text, jsonb, bigint, uuid)
  TO service_role;
