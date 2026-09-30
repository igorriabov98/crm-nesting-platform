BEGIN;

DO $$
DECLARE
  v_factory_a uuid;
  v_factory_b uuid;
  v_machine uuid;
  v_plan_a uuid;
  v_plan_b uuid;
  v_baseline uuid;
  v_revision bigint;
  v_actual date := '2026-09-09';
  v_actor uuid;
  v_new_machine uuid;
  v_stage uuid;
  v_fact_stage uuid;
  v_request uuid;
  v_version_before integer;
BEGIN
  IF has_table_privilege('authenticated', 'public.production_plan_drafts', 'SELECT')
    OR has_table_privilege('authenticated', 'public.production_plan_versions', 'SELECT')
    OR has_function_privilege('authenticated',
      'public.fn_publish_production_plan_draft(uuid,bigint,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Plan versions or draft functions are exposed to authenticated role';
  END IF;
  SELECT id INTO v_actor FROM public.users LIMIT 1;
  SELECT id INTO v_factory_a FROM public.factories WHERE name = 'Берегово' LIMIT 1;
  SELECT id INTO v_factory_b FROM public.factories WHERE name = 'Ужгород' LIMIT 1;
  IF v_factory_a IS NULL OR v_factory_b IS NULL THEN RAISE EXCEPTION 'Test factories are missing'; END IF;

  INSERT INTO public.machines(name, factory_id, production_month, production_workshop,
    production_queue_number, actual_material_date, created_by)
  VALUES ('Version fixture', v_factory_a, '2026-09-01', 1, 1, v_actual, v_actor)
  RETURNING id INTO v_machine;
  INSERT INTO public.production_month_plans(factory_id, production_month, status)
  VALUES (v_factory_a, '2026-09-01', 'draft') RETURNING id INTO v_plan_a;
  INSERT INTO public.production_month_plans(factory_id, production_month, status)
  VALUES (v_factory_b, '2026-10-01', 'draft') RETURNING id INTO v_plan_b;
  PERFORM public.fn_record_production_plan_version(v_plan_a, 'baseline', NULL);
  PERFORM public.fn_record_production_plan_version(v_plan_b, 'baseline', NULL);
  SELECT id INTO v_baseline FROM public.production_plan_versions
    WHERE production_month_plan_id = v_plan_a AND version_number = 1;

  v_revision := public.fn_patch_production_plan_draft(v_plan_a,
    'machine:' || v_machine::text,
    jsonb_build_object('target', 'machine', 'id', v_machine,
      'fields', jsonb_build_object('factory_id', v_factory_b,
        'production_month', '2026-10-01', 'production_workshop', 1,
        'production_queue_number', 1, 'planned_material_date', '2026-09-15')),
    0, v_actor);
  IF v_revision <> 1 THEN RAISE EXCEPTION 'Draft revision was not incremented'; END IF;
  BEGIN
    PERFORM public.fn_patch_production_plan_draft(v_plan_a, 'machine:' || v_machine::text,
      '{}'::jsonb, 0, v_actor);
    RAISE EXCEPTION 'Stale draft unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Черновик изменён другим редактором. Обновите страницу.' THEN RAISE; END IF;
  END;
  IF (SELECT factory_id FROM public.machines WHERE id = v_machine) <> v_factory_a THEN
    RAISE EXCEPTION 'Draft leaked into published machine';
  END IF;
  BEGIN
    PERFORM public.fn_publish_production_plan_draft(v_plan_a, 1, v_actor, v_factory_a);
    RAISE EXCEPTION 'Cross-factory publication unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Недостаточно прав для затронутого завода' THEN RAISE; END IF;
  END;
  IF (SELECT factory_id FROM public.machines WHERE id = v_machine) <> v_factory_a THEN
    RAISE EXCEPTION 'Rejected publication changed published machine';
  END IF;

  PERFORM public.fn_publish_production_plan_draft(v_plan_a, 1, v_actor, NULL);
  IF (SELECT factory_id FROM public.machines WHERE id = v_machine) <> v_factory_b THEN
    RAISE EXCEPTION 'Machine did not move at publication';
  END IF;
  IF (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_a) <> 2
    OR (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_b) <> 2 THEN
    RAISE EXCEPTION 'Publication did not version both affected months';
  END IF;
  IF (SELECT actual_material_date FROM public.machines WHERE id = v_machine) <> v_actual THEN
    RAISE EXCEPTION 'Publication changed actual data';
  END IF;

  BEGIN
    PERFORM public.fn_patch_production_plan_draft(v_plan_b,
      'machine:' || v_machine::text,
      jsonb_build_object('target', 'machine', 'id', v_machine,
        'fields', jsonb_build_object('planned_material_date', '2026-10-15')),
      0, v_actor);
    BEGIN
      PERFORM public.fn_restore_production_plan_version(v_plan_a, v_baseline, 2, v_actor, NULL);
      RAISE EXCEPTION 'Restoration ignored another affected draft';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'В затронутом месяце есть неопубликованный черновик' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION 'Rollback conflict fixture';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Rollback conflict fixture' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.fn_restore_production_plan_version(v_plan_a, v_baseline, 2, v_actor, v_factory_a);
    RAISE EXCEPTION 'Cross-factory restoration unexpectedly accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Недостаточно прав для затронутого завода' THEN RAISE; END IF;
  END;
  IF (SELECT factory_id FROM public.machines WHERE id = v_machine) <> v_factory_b THEN
    RAISE EXCEPTION 'Rejected restoration changed published machine';
  END IF;

  PERFORM public.fn_restore_production_plan_version(v_plan_a, v_baseline, 2, v_actor, NULL);
  IF (SELECT factory_id FROM public.machines WHERE id = v_machine) <> v_factory_a THEN
    RAISE EXCEPTION 'Restoration did not return machine';
  END IF;
  IF (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_a) <> 3
    OR (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_b) <> 3 THEN
    RAISE EXCEPTION 'Restoration did not version both affected months';
  END IF;
  IF (SELECT actual_material_date FROM public.machines WHERE id = v_machine) <> v_actual THEN
    RAISE EXCEPTION 'Restoration changed actual data';
  END IF;

  PERFORM public.fn_set_production_plan_version_status(v_plan_a, 'preliminary_ready', v_actor);
  PERFORM public.fn_set_production_plan_version_status(v_plan_a, 'confirmed', v_actor);
  IF (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_a) <> 5 THEN
    RAISE EXCEPTION 'Status transitions did not create versions';
  END IF;
  PERFORM public.fn_patch_production_plan_draft(v_plan_a,
    'machine:' || v_machine::text,
    jsonb_build_object('target', 'machine', 'id', v_machine,
      'fields', jsonb_build_object('planned_material_date', '2026-09-20')),
    0, v_actor);
  IF (SELECT planned_material_date FROM public.machines WHERE id = v_machine) IS NOT NULL THEN
    RAISE EXCEPTION 'Confirmed draft leaked before publication';
  END IF;
  PERFORM public.fn_publish_production_plan_draft(v_plan_a, 1, v_actor, NULL);
  IF (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_a) <> 6
    OR (SELECT status FROM public.production_month_plans WHERE id = v_plan_a) <> 'confirmed' THEN
    RAISE EXCEPTION 'Confirmed plan was not published';
  END IF;
  PERFORM public.fn_restore_production_plan_version(v_plan_a, v_baseline, 6, v_actor, NULL);
  IF (SELECT status FROM public.production_month_plans WHERE id = v_plan_a) <> 'confirmed'
    OR (SELECT actual_material_date FROM public.machines WHERE id = v_machine) <> v_actual THEN
    RAISE EXCEPTION 'Restoration changed current status or fact';
  END IF;

  SELECT id INTO v_fact_stage FROM public.production_stages
    WHERE machine_id = v_machine AND stage_type = 'cutting' LIMIT 1;
  IF v_fact_stage IS NULL THEN
    INSERT INTO public.production_stages(machine_id, stage_type)
      VALUES (v_machine, 'cutting') RETURNING id INTO v_fact_stage;
  END IF;
  INSERT INTO public.production_fact_cutting_events(
    machine_id, factory_id, stage_id, fact_date, previous_stage_date_start,
    applied_stage_date_start, status, created_by
  ) VALUES (
    v_machine, v_factory_a, v_fact_stage, '2026-09-25', NULL,
    '2026-09-25', 'applied', v_actor
  );
  UPDATE public.production_stages SET date_start = '2026-09-25' WHERE id = v_fact_stage;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      public.fn_capture_production_plan(v_factory_a, '2026-09-01') -> 'machines'
    ) machine_snapshot,
    jsonb_array_elements(machine_snapshot -> 'stages') stage_snapshot
    WHERE machine_snapshot ->> 'id' = v_machine::text
      AND stage_snapshot ->> 'id' = v_fact_stage::text
      AND stage_snapshot ->> 'date_start' IS NOT NULL
  ) THEN RAISE EXCEPTION 'Cutting fact leaked into version snapshot'; END IF;
  PERFORM public.fn_restore_production_plan_version(v_plan_a, v_baseline, 7, v_actor, NULL);
  IF (SELECT date_start FROM public.production_stages WHERE id = v_fact_stage) <> '2026-09-25' THEN
    RAISE EXCEPTION 'Restoration erased cutting fact';
  END IF;

  SELECT published_version_number INTO v_version_before
    FROM public.production_month_plans WHERE id = v_plan_a;
  INSERT INTO public.production_plan_date_change_requests(
    production_month_plan_id, machine_id, requested_by
  ) VALUES (v_plan_a, v_machine, v_actor) RETURNING id INTO v_request;
  INSERT INTO public.production_plan_date_change_request_items(
    request_id, machine_id, target_type, field_name, old_value, new_value
  ) VALUES (v_request, v_machine, 'machine', 'planned_material_date', NULL, '2026-09-26');
  PERFORM public.fn_apply_production_plan_date_change_items(v_request, v_actor, NULL);
  IF (SELECT planned_material_date FROM public.machines WHERE id = v_machine) <> '2026-09-26'
    OR (SELECT status FROM public.production_plan_date_change_requests WHERE id = v_request) <> 'approved'
    OR (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_a) <> v_version_before + 1 THEN
    RAISE EXCEPTION 'Legacy request did not apply and create a published version';
  END IF;
  INSERT INTO public.production_plan_date_change_requests(
    production_month_plan_id, machine_id, requested_by
  ) VALUES (v_plan_a, v_machine, v_actor) RETURNING id INTO v_request;
  INSERT INTO public.production_plan_date_change_request_items(
    request_id, machine_id, target_type, field_name, old_value, new_value
  ) VALUES (v_request, v_machine, 'machine', 'planned_material_date', '2026-09-20', '2026-09-27');
  BEGIN
    PERFORM public.fn_apply_production_plan_date_change_items(v_request, v_actor, NULL);
    RAISE EXCEPTION 'Conflicting legacy request unexpectedly applied';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Конфликт:%' THEN RAISE; END IF;
  END;
  IF (SELECT published_version_number FROM public.production_month_plans WHERE id = v_plan_a) <> v_version_before + 1
    OR (SELECT planned_material_date FROM public.machines WHERE id = v_machine) <> '2026-09-26' THEN
    RAISE EXCEPTION 'Conflicting legacy request changed the published plan';
  END IF;

  INSERT INTO public.machines(name, created_by) VALUES ('Draft-only machine', v_actor)
    RETURNING id INTO v_new_machine;
  SELECT id INTO v_stage FROM public.production_stages
    WHERE machine_id = v_new_machine AND stage_type = 'cutting' LIMIT 1;
  IF v_stage IS NULL THEN
    INSERT INTO public.production_stages(machine_id, stage_type)
      VALUES (v_new_machine, 'cutting') RETURNING id INTO v_stage;
  END IF;
  PERFORM public.fn_patch_production_plan_draft(v_plan_a,
    'machine:' || v_new_machine::text,
    jsonb_build_object('target', 'machine', 'id', v_new_machine,
      'fields', jsonb_build_object('factory_id', v_factory_a,
        'production_month', '2026-09-01', 'production_workshop', 1,
        'production_queue_number', 2)), 0, v_actor);
  PERFORM public.fn_patch_production_plan_draft(v_plan_a,
    'stage:' || v_stage::text,
    jsonb_build_object('target', 'stage', 'id', v_stage, 'stage_id', v_stage,
      'fields', jsonb_build_object('date_start', '2026-09-21', 'date_end', '2026-09-22')),
    1, v_actor);
  PERFORM public.fn_publish_production_plan_draft(v_plan_a, 2, v_actor, v_factory_a);
  IF (SELECT date_start FROM public.production_stages WHERE id = v_stage) <> '2026-09-21'
    OR (SELECT factory_id FROM public.machines WHERE id = v_new_machine) <> v_factory_a THEN
    RAISE EXCEPTION 'New machine with draft stage did not publish';
  END IF;
  BEGIN
    UPDATE public.production_plan_versions SET status = 'draft' WHERE id = v_baseline;
    RAISE EXCEPTION 'Published version was mutable';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Опубликованную версию плана нельзя изменить или удалить' THEN RAISE; END IF;
  END;
END;
$$;

ROLLBACK;
