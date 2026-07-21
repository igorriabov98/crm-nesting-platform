\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory_one uuid := gen_random_uuid();
  v_factory_two uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_parent_one uuid := gen_random_uuid();
  v_leaf_one uuid := gen_random_uuid();
  v_leaf_one_second uuid := gen_random_uuid();
  v_parent_two uuid := gen_random_uuid();
  v_leaf_two uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_other_employee uuid := gen_random_uuid();
  v_section_employee uuid := gen_random_uuid();
  v_assignment uuid;
  v_vacation uuid;
  v_count integer;
  v_confirmed integer;
  v_pending integer;
  v_kg numeric;
  v_copied integer;
  v_cancelled integer;
BEGIN
  INSERT INTO public.factories(id, name) VALUES
    (v_factory_one, 'PEOPLE-TEST-ONE'),
    (v_factory_two, 'PEOPLE-TEST-TWO');
  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
  VALUES (v_actor, 'people-planning-test@example.test', 'People planning test', 'planning_director', v_factory_one, true);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  INSERT INTO public.production_fact_sections(id, factory_id, name, sort_order, created_by, updated_by) VALUES
    (v_parent_one, v_factory_one, 'Сборка/Сварка TEST', 10, v_actor, v_actor),
    (v_parent_two, v_factory_two, 'Сборка/Сварка TEST', 10, v_actor, v_actor);
  INSERT INTO public.production_fact_sections(id, factory_id, parent_id, name, sort_order, created_by, updated_by) VALUES
    (v_leaf_one, v_factory_one, v_parent_one, 'Цех 1', 10, v_actor, v_actor),
    (v_leaf_one_second, v_factory_one, v_parent_one, 'Цех 2', 20, v_actor, v_actor),
    (v_leaf_two, v_factory_two, v_parent_two, 'Цех 2', 10, v_actor, v_actor);

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_machine, v_factory_one, 'PEOPLE-TEST-MACHINE', v_actor);
  INSERT INTO public.machine_items(machine_id, drawing_number, product_name, weight, price, quantity)
  VALUES (v_machine, 'PEOPLE-TEST-DWG', 'People test item', 100, 0, 10);

  INSERT INTO public.employees(id, full_name, factory_id, default_section_id, created_by, updated_by)
  VALUES (v_employee, 'Тестовый сотрудник', v_factory_one, v_leaf_one, v_actor, v_actor);
  INSERT INTO public.employee_rates(employee_id, section_id, kg_per_day)
  VALUES (v_employee, v_leaf_one, 400);
  INSERT INTO public.employees(id, full_name, factory_id, default_section_id, created_by, updated_by)
  VALUES (v_section_employee, 'Сотрудник второго участка', v_factory_one, v_leaf_one_second, v_actor, v_actor);
  INSERT INTO public.employee_rates(employee_id, section_id, kg_per_day)
  VALUES (v_section_employee, v_leaf_one_second, 400);

  BEGIN
    INSERT INTO public.employee_rates(employee_id, section_id, kg_per_day) VALUES (v_employee, v_leaf_one, 500);
    RAISE EXCEPTION 'Duplicate employee section rate was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.employees(id, full_name, factory_id, created_by, updated_by)
  VALUES (v_other_employee, 'Другой завод', v_factory_two, v_actor, v_actor);
  INSERT INTO public.employee_rates(employee_id, section_id, kg_per_day)
  VALUES (v_other_employee, v_leaf_two, 400);
  BEGIN
    INSERT INTO public.employee_assignments(
      employee_id, machine_id, section_id, work_date, half, status, kg_planned, created_by, updated_by
    ) VALUES (v_other_employee, v_machine, v_leaf_two, DATE '2030-01-07', 1, 'confirmed', 200, v_actor, v_actor);
    RAISE EXCEPTION 'Cross-factory assignment was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%same factory%' THEN RAISE; END IF;
  END;

  SELECT id INTO v_assignment
  FROM public.fn_people_schedule_assignment(v_employee, v_machine, v_leaf_one, DATE '2030-01-07', 2::smallint)
  ORDER BY work_date, half LIMIT 1;
  SELECT count(*), count(*) FILTER (WHERE status = 'confirmed'), count(*) FILTER (WHERE status = 'pending')
    INTO v_count, v_confirmed, v_pending
    FROM public.employee_assignments
    WHERE employee_id = v_employee
      AND cancelled_at IS NULL;
  IF v_count <> 1 OR v_confirmed <> 1 OR v_pending <> 0 THEN
    RAISE EXCEPTION 'Expected exactly one confirmed half-day, got %, %, %', v_count, v_confirmed, v_pending;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_assignments
    WHERE id = v_assignment
      AND work_date = DATE '2030-01-07'
      AND half = 2
      AND cancelled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Exact assignment was shifted away from the requested slot';
  END IF;
  SELECT kg_planned INTO v_kg FROM public.employee_assignments WHERE id = v_assignment;
  IF v_kg <> 200 THEN RAISE EXCEPTION 'Half-day snapshot must be 200 kg, got %', v_kg; END IF;

  BEGIN
    PERFORM public.fn_people_schedule_assignment(v_employee, v_machine, v_leaf_one, DATE '2030-01-07', 2::smallint);
    RAISE EXCEPTION 'Occupied employee slot was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%already assigned in selected half-day%' THEN RAISE; END IF;
  END;

  PERFORM public.fn_people_schedule_assignment(
    v_employee, v_machine, v_leaf_one, DATE '2030-01-08', 1::smallint
  );
  IF (SELECT count(*) FROM public.employee_assignments
      WHERE employee_id = v_employee AND work_date = DATE '2030-01-08' AND cancelled_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'A second exact slot was not created independently';
  END IF;

  PERFORM public.fn_people_schedule_assignment(
    v_section_employee, v_machine, v_leaf_one_second, DATE '2030-01-07', 1::smallint
  );
  SELECT count(*) INTO v_count
    FROM public.employee_assignments
    WHERE employee_id = v_section_employee
      AND section_id = v_leaf_one_second
      AND cancelled_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Second section must create one exact slot independently, got % slots', v_count;
  END IF;

  PERFORM public.fn_people_schedule_full_day(
    v_employee, v_machine, v_leaf_one, DATE '2030-01-09'
  );
  SELECT count(*), count(*) FILTER (WHERE status = 'confirmed')
    INTO v_count, v_confirmed
    FROM public.employee_assignments
    WHERE employee_id = v_employee
      AND work_date = DATE '2030-01-09'
      AND cancelled_at IS NULL;
  IF v_count <> 2 OR v_confirmed <> 2 THEN
    RAISE EXCEPTION 'Full-day scheduling must create two confirmed halves, got %, %', v_count, v_confirmed;
  END IF;

  INSERT INTO public.employee_assignments(
    employee_id, machine_id, section_id, work_date, half, status, kg_planned, created_by, updated_by
  ) VALUES
    (v_employee, v_machine, v_leaf_one, DATE '2030-01-20', 1, 'confirmed', 200, v_actor, v_actor),
    (v_employee, v_machine, v_leaf_one, DATE '2030-01-20', 2, 'confirmed', 200, v_actor, v_actor);
  PERFORM public.fn_people_copy_previous_day(v_employee, DATE '2030-01-21');
  SELECT count(*) INTO v_copied
    FROM public.employee_assignments
    WHERE employee_id = v_employee
      AND work_date = DATE '2030-01-21'
      AND cancelled_at IS NULL;
  IF v_copied <> 2 THEN
    RAISE EXCEPTION 'Expected both previous-day halves to be copied, got %', v_copied;
  END IF;

  BEGIN
    INSERT INTO public.employee_assignments(
      employee_id, machine_id, section_id, work_date, half, status, kg_planned, created_by, updated_by
    )
    SELECT employee_id, machine_id, section_id, work_date, half, 'pending', kg_planned, v_actor, v_actor
    FROM public.employee_assignments WHERE id = v_assignment;
    RAISE EXCEPTION 'Employee slot uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  SELECT count(*) INTO v_count
    FROM public.fn_people_planning_period(v_factory_one, DATE '2030-01-20', DATE '2030-01-21');
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Expected four active rows in the fast period read, got %', v_count;
  END IF;

  INSERT INTO public.employee_vacations(
    employee_id, start_date, end_date, note, created_by, updated_by
  ) VALUES (
    v_employee, DATE '2030-02-01', DATE '2030-02-05', 'Тестовый отпуск', v_actor, v_actor
  ) RETURNING id INTO v_vacation;
  IF (SELECT count(*) FROM public.fn_people_vacations_period(
    v_factory_one, DATE '2030-02-01', DATE '2030-02-07'
  )) <> 1 THEN
    RAISE EXCEPTION 'Vacation period read did not return the active vacation';
  END IF;
  BEGIN
    INSERT INTO public.employee_assignments(
      employee_id, machine_id, section_id, work_date, half, status, kg_planned, created_by, updated_by
    ) VALUES (v_employee, v_machine, v_leaf_one, DATE '2030-02-02', 1, 'confirmed', 200, v_actor, v_actor);
    RAISE EXCEPTION 'Assignment inside vacation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%on vacation for selected date%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.employee_vacations(
      employee_id, start_date, end_date, created_by, updated_by
    ) VALUES (v_employee, DATE '2030-02-05', DATE '2030-02-10', v_actor, v_actor);
    RAISE EXCEPTION 'Overlapping vacation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%overlaps existing vacation%' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO public.employee_vacations(
      employee_id, start_date, end_date, created_by, updated_by
    ) VALUES (v_employee, DATE '2030-01-20', DATE '2030-01-20', v_actor, v_actor);
    RAISE EXCEPTION 'Vacation over an active assignment was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%assignments in vacation period%' THEN RAISE; END IF;
  END;
  UPDATE public.employee_vacations
  SET cancelled_at = now(), updated_by = v_actor
  WHERE id = v_vacation;
  INSERT INTO public.employee_assignments(
    employee_id, machine_id, section_id, work_date, half, status, kg_planned, created_by, updated_by
  ) VALUES (v_employee, v_machine, v_leaf_one, DATE '2030-02-02', 1, 'confirmed', 200, v_actor, v_actor);

  UPDATE public.employees SET active = false WHERE id = v_employee;
  SELECT count(*) INTO v_cancelled
    FROM public.fn_people_cancel_employee_day(v_employee, DATE '2030-01-21');
  IF v_cancelled <> 2 THEN
    RAISE EXCEPTION 'Expected both half-days to be cancelled, got %', v_cancelled;
  END IF;
  IF (SELECT count(*) FROM public.employee_assignments
      WHERE employee_id = v_employee AND work_date = DATE '2030-01-21') <> 2 THEN
    RAISE EXCEPTION 'Cancelled assignments were removed from history';
  END IF;
  IF (SELECT count(*) FROM public.employee_assignments
      WHERE employee_id = v_employee AND work_date = DATE '2030-01-21' AND cancelled_at IS NULL) <> 0 THEN
    RAISE EXCEPTION 'Cancelled assignments remain active';
  END IF;
  SELECT count(*) INTO v_cancelled
    FROM public.fn_people_cancel_employee_day(v_employee, DATE '2030-01-21');
  IF v_cancelled <> 0 THEN
    RAISE EXCEPTION 'Repeated day cancellation is not idempotent';
  END IF;
  SELECT count(*) INTO v_count
    FROM public.fn_people_planning_period(v_factory_one, DATE '2030-01-20', DATE '2030-01-21');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Fast period read includes cancelled rows, got %', v_count;
  END IF;
END;
$$;

ROLLBACK;

DO $$
DECLARE
  v_table text;
  v_rls boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['employees', 'employee_rates', 'employee_vacations', 'employee_assignments'] LOOP
    SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = ('public.' || v_table)::regclass;
    IF NOT v_rls THEN RAISE EXCEPTION 'RLS is disabled for %', v_table; END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT,INSERT,UPDATE') THEN
      RAISE EXCEPTION 'Authenticated SELECT/INSERT/UPDATE is missing for %', v_table;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'Authenticated DELETE is available for %', v_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Anon has privileges for %', v_table;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
    'authenticated',
    'public.fn_people_copy_previous_day(uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated execute is missing for fn_people_copy_previous_day';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.fn_people_copy_previous_day(uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anon can execute fn_people_copy_previous_day';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.fn_people_schedule_full_day(uuid,uuid,uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated execute is missing for fn_people_schedule_full_day';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.fn_people_schedule_full_day(uuid,uuid,uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anon can execute fn_people_schedule_full_day';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.fn_people_planning_period(uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated execute is missing for fn_people_planning_period';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.fn_people_planning_period(uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anon can execute fn_people_planning_period';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.fn_people_cancel_employee_day(uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated execute is missing for fn_people_cancel_employee_day';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.fn_people_cancel_employee_day(uuid,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anon can execute fn_people_cancel_employee_day';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.fn_people_vacations_period(uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Authenticated execute is missing for fn_people_vacations_period';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.fn_people_vacations_period(uuid,date,date)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anon can execute fn_people_vacations_period';
  END IF;
END;
$$;

SELECT 'people_planning_v1_test: ok' AS result;
