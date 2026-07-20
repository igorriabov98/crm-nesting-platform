\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory_one uuid := gen_random_uuid();
  v_factory_two uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_parent_one uuid := gen_random_uuid();
  v_leaf_one uuid := gen_random_uuid();
  v_parent_two uuid := gen_random_uuid();
  v_leaf_two uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_employee uuid := gen_random_uuid();
  v_other_employee uuid := gen_random_uuid();
  v_assignment uuid;
  v_count integer;
  v_confirmed integer;
  v_pending integer;
  v_kg numeric;
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
    (v_leaf_two, v_factory_two, v_parent_two, 'Цех 2', 10, v_actor, v_actor);

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_machine, v_factory_one, 'PEOPLE-TEST-MACHINE', v_actor);
  INSERT INTO public.machine_items(machine_id, drawing_number, product_name, weight, price, quantity)
  VALUES (v_machine, 'PEOPLE-TEST-DWG', 'People test item', 100, 0, 10);

  INSERT INTO public.employees(id, full_name, factory_id, default_section_id, created_by, updated_by)
  VALUES (v_employee, 'Тестовый сотрудник', v_factory_one, v_leaf_one, v_actor, v_actor);
  INSERT INTO public.employee_rates(employee_id, section_id, kg_per_day)
  VALUES (v_employee, v_leaf_one, 400);

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
    FROM public.employee_assignments WHERE employee_id = v_employee;
  IF v_count <> 5 OR v_confirmed <> 1 OR v_pending <> 4 THEN
    RAISE EXCEPTION 'Expected one confirmed and four pending half-days, got %, %, %', v_count, v_confirmed, v_pending;
  END IF;
  SELECT kg_planned INTO v_kg FROM public.employee_assignments WHERE id = v_assignment;
  IF v_kg <> 200 THEN RAISE EXCEPTION 'Half-day snapshot must be 200 kg, got %', v_kg; END IF;

  BEGIN
    PERFORM public.fn_people_schedule_assignment(v_employee, v_machine, v_leaf_one, DATE '2030-01-10', 1::smallint);
    RAISE EXCEPTION 'Duplicate pending chain was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%pending people planning suggestions%' THEN RAISE; END IF;
  END;

  SELECT id INTO v_assignment FROM public.employee_assignments
    WHERE employee_id = v_employee AND status = 'pending' ORDER BY work_date, half LIMIT 1;
  PERFORM public.fn_people_confirm_assignment(v_assignment);
  IF (SELECT status FROM public.employee_assignments WHERE id = v_assignment) <> 'confirmed' THEN
    RAISE EXCEPTION 'Pending assignment was not confirmed';
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
END;
$$;

ROLLBACK;

DO $$
DECLARE
  v_table text;
  v_rls boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['employees', 'employee_rates', 'employee_assignments'] LOOP
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
END;
$$;

SELECT 'people_planning_v1_test: ok' AS result;
