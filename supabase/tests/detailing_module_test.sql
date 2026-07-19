\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_bergovo uuid;
  v_uzhgorod uuid;
  v_actor uuid := gen_random_uuid();
  v_supply_actor uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_version_one uuid := gen_random_uuid();
  v_version_two uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_machine_item uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_part uuid;
  v_version_part uuid;
  v_reservation uuid;
  v_transfer uuid;
  v_task uuid;
  v_section uuid := gen_random_uuid();
  v_fact uuid := gen_random_uuid();
  v_cutting_event uuid := gen_random_uuid();
  v_count integer;
  v_status text;
  v_deadline date;
  v_balance record;
BEGIN
  SELECT id INTO v_bergovo FROM public.factories WHERE lower(name) = 'берегово' LIMIT 1;
  SELECT id INTO v_uzhgorod FROM public.factories WHERE lower(name) = 'ужгород' LIMIT 1;
  IF v_bergovo IS NULL OR v_uzhgorod IS NULL THEN RAISE EXCEPTION 'Test factories are missing'; END IF;

  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
  VALUES
    (v_actor, 'detailing-test-technologist@example.test', 'Тестовый технолог', 'technologist', v_bergovo, true),
    (v_supply_actor, 'detailing-test-supply@example.test', 'Тестовый руководитель снабжения', 'procurement_head', v_bergovo, true);
  INSERT INTO public.departments(name, head_user_id, factory_id, is_active)
  VALUES ('Снабжение', v_supply_actor, v_bergovo, true);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  INSERT INTO public.products(
    id, name_uk, name_en, uktzed, drawing_number, unit_weight_kg,
    base_price_eur, status, created_by, updated_by
  ) VALUES (
    v_product, 'Тестовий виріб', 'Test product', '0000', 'PRODUCT-DWG', 10,
    0, 'active', v_actor, v_actor
  );
  INSERT INTO public.product_versions(id, product_id, version_number, status, drawing_number, created_by)
  VALUES
    (v_version_one, v_product, 1, 'current', 'PRODUCT-DWG-V1', v_actor),
    (v_version_two, v_product, 2, 'archived', 'PRODUCT-DWG-V2', v_actor);

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_machine, v_bergovo, 'DET-TEST-ORDER', v_actor);
  INSERT INTO public.machine_items(
    id, machine_id, drawing_number, product_name, weight, price, quantity,
    product_id, product_version_id
  ) VALUES (
    v_machine_item, v_machine, 'PRODUCT-DWG-V1', 'Тестовий виріб', 10, 0, 2,
    v_product, v_version_one
  );
  INSERT INTO public.technologist_requests(id, machine_id, created_by, status)
  VALUES (v_request, v_machine, v_actor, 'pending_stock_check');

  v_part := public.fn_create_detailing_part(
    'Опорна пластина', '  dt-001  ', 2.5, v_uzhgorod, 10,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'all_versions', true, 'version_ids', '[]'::jsonb)),
    v_actor
  );

  BEGIN
    PERFORM public.fn_create_detailing_part(
      'Дубликат', 'DT-001', 1, v_bergovo, 1,
      jsonb_build_array(jsonb_build_object('product_id', v_product, 'all_versions', true, 'version_ids', '[]'::jsonb)),
      v_actor
    );
    RAISE EXCEPTION 'Normalized drawing number uniqueness was not enforced';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  v_version_part := public.fn_create_detailing_part(
    'Версионная деталь', 'DT-VER', 1, v_uzhgorod, 1,
    jsonb_build_array(jsonb_build_object('product_id', v_product, 'all_versions', false, 'version_ids', jsonb_build_array(v_version_one))),
    v_actor
  );
  IF NOT public.detailing_part_matches_machine_item(v_version_part, v_machine_item) THEN
    RAISE EXCEPTION 'Selected product version should match';
  END IF;
  UPDATE public.machine_items SET product_version_id = v_version_two WHERE id = v_machine_item;
  IF public.detailing_part_matches_machine_item(v_version_part, v_machine_item) THEN
    RAISE EXCEPTION 'Unselected product version should not match';
  END IF;
  UPDATE public.machine_items SET product_version_id = v_version_one WHERE id = v_machine_item;

  SELECT (public.fn_reserve_detailing(v_request, v_machine_item, v_part, v_uzhgorod, 6, v_actor) ->> 'reservation_id')::uuid
  INTO v_reservation;
  SELECT id INTO v_transfer
  FROM public.detailing_transfers
  WHERE machine_id = v_machine AND status IN ('needs_date', 'scheduled', 'partially_received');
  IF v_transfer IS NULL THEN RAISE EXCEPTION 'Cross-factory reservation did not create a transfer'; END IF;

  BEGIN
    PERFORM public.fn_reserve_detailing(v_request, v_machine_item, v_part, v_uzhgorod, 5, v_actor);
    RAISE EXCEPTION 'Over-reservation was not rejected';
  EXCEPTION WHEN check_violation OR raise_exception THEN
    IF SQLERRM NOT LIKE '%Недостаточно доступной деталировки%' THEN RAISE; END IF;
  END;

  SELECT id, deadline INTO v_task, v_deadline
  FROM public.tasks
  WHERE detailing_transfer_id = v_transfer AND status IN ('pending', 'in_progress');
  IF v_task IS NULL OR v_deadline IS NOT NULL THEN RAISE EXCEPTION 'Undated transfer task is invalid'; END IF;

  UPDATE public.production_stages
  SET date_start = DATE '2030-01-07', is_skipped = false, updated_by = v_actor
  WHERE machine_id = v_machine AND stage_type = 'cutting';
  SELECT deadline INTO v_deadline
  FROM public.tasks
  WHERE detailing_transfer_id = v_transfer AND status IN ('pending', 'in_progress');
  IF v_deadline <> DATE '2030-01-04' THEN RAISE EXCEPTION 'Previous workday deadline is invalid: %', v_deadline; END IF;
  SELECT count(*) INTO v_count
  FROM public.tasks
  WHERE detailing_transfer_id = v_transfer AND status = 'cancelled' AND deadline IS NULL;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Undated task was not replaced when first date appeared'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_supply_actor::text, true);
  PERFORM public.fn_set_detailing_transfer_date(v_transfer, DATE '2030-01-06', v_supply_actor);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  SELECT count(*) INTO v_count
  FROM public.tasks
  WHERE detailing_transfer_id = v_transfer
    AND status IN ('pending', 'in_progress')
    AND description LIKE '%РИСК ОПОЗДАНИЯ%';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Late expected delivery risk is missing from the task'; END IF;

  SELECT public.fn_receive_detailing_transfer(
    v_transfer,
    jsonb_build_array(jsonb_build_object(
      'item_id', (SELECT id FROM public.detailing_transfer_items WHERE transfer_id = v_transfer),
      'quantity', 4
    )),
    v_actor
  )::text INTO v_status;
  IF v_status <> 'partially_received' THEN RAISE EXCEPTION 'Partial receipt status is invalid: %', v_status; END IF;

  SELECT * INTO v_balance FROM public.detailing_balances WHERE part_id = v_part AND factory_id = v_uzhgorod;
  IF v_balance.on_hand_quantity <> 6 OR v_balance.reserved_quantity <> 2 THEN
    RAISE EXCEPTION 'Source balance after partial receipt is invalid';
  END IF;
  SELECT * INTO v_balance FROM public.detailing_balances WHERE part_id = v_part AND factory_id = v_bergovo;
  IF v_balance.on_hand_quantity <> 4 OR v_balance.reserved_quantity <> 4 THEN
    RAISE EXCEPTION 'Destination balance after partial receipt is invalid';
  END IF;

  SELECT public.fn_receive_detailing_transfer(
    v_transfer,
    jsonb_build_array(jsonb_build_object(
      'item_id', (SELECT id FROM public.detailing_transfer_items WHERE transfer_id = v_transfer),
      'quantity', 3
    )),
    v_actor
  )::text INTO v_status;
  IF v_status <> 'completed' THEN RAISE EXCEPTION 'Over-plan receipt did not complete the transfer'; END IF;

  SELECT * INTO v_balance FROM public.detailing_balances WHERE part_id = v_part AND factory_id = v_bergovo;
  IF v_balance.on_hand_quantity <> 7 OR v_balance.reserved_quantity <> 7 THEN
    RAISE EXCEPTION 'Destination balance after over-plan receipt is invalid';
  END IF;
  SELECT requested_quantity INTO v_count FROM public.detailing_reservations WHERE id = v_reservation;
  IF v_count <> 7 THEN RAISE EXCEPTION 'Over-plan receipt did not extend reservation atomically'; END IF;

  INSERT INTO public.production_fact_sections(id, factory_id, name, created_by, updated_by, production_stage_type)
  VALUES (v_section, v_bergovo, 'Тестовая заготовка', v_actor, v_actor, 'cutting');
  INSERT INTO public.production_machine_facts(id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by)
  VALUES (v_fact, v_bergovo, DATE '2030-01-07', 'day', v_machine, v_section, v_actor, v_actor);
  INSERT INTO public.production_fact_cutting_events(
    id, machine_id, factory_id, fact_id, section_id, fact_date, status, created_by
  ) VALUES (
    v_cutting_event, v_machine, v_bergovo, v_fact, v_section, DATE '2030-01-07', 'applied', v_actor
  );
  SELECT * INTO v_balance FROM public.detailing_balances WHERE part_id = v_part AND factory_id = v_bergovo;
  IF v_balance.on_hand_quantity <> 0 OR v_balance.reserved_quantity <> 0 THEN
    RAISE EXCEPTION 'Cutting fact did not write off received detailing';
  END IF;
  SELECT count(*) INTO v_count FROM public.detailing_consumption_events WHERE production_fact_id = v_fact;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Consumption event is not idempotently linked to fact'; END IF;

  UPDATE public.production_fact_cutting_events
  SET status = 'rolled_back', rolled_back_by = v_actor, rolled_back_at = now()
  WHERE id = v_cutting_event;
  SELECT * INTO v_balance FROM public.detailing_balances WHERE part_id = v_part AND factory_id = v_bergovo;
  IF v_balance.on_hand_quantity <> 7 OR v_balance.reserved_quantity <> 7 THEN
    RAISE EXCEPTION 'Fact rollback did not restore the linked quantity and reservation';
  END IF;

  BEGIN
    UPDATE public.detailing_movements SET comment = 'tamper' WHERE part_id = v_part;
    RAISE EXCEPTION 'Movement journal allowed mutation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%неизменяема%' THEN RAISE; END IF;
  END;

  PERFORM public.fn_release_detailing_reservation(v_reservation, 'Завершение теста', v_actor);
  PERFORM public.fn_adjust_detailing_stock(v_part, v_bergovo, 0, 'Завершение теста', v_actor);
  PERFORM public.fn_adjust_detailing_stock(v_part, v_uzhgorod, 0, 'Завершение теста', v_actor);
  PERFORM public.fn_archive_detailing_part(v_part, v_actor);
  PERFORM public.fn_adjust_detailing_stock(v_version_part, v_uzhgorod, 0, 'Завершение теста', v_actor);
  PERFORM public.fn_archive_detailing_part(v_version_part, v_actor);
END;
$$;

ROLLBACK;

SELECT 'detailing_module_test: ok' AS result;

DO $$
DECLARE
  v_table text;
  v_rls boolean;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'detailing_parts', 'detailing_part_products', 'detailing_part_product_versions',
    'detailing_balances', 'detailing_reservations', 'detailing_reservation_allocations',
    'detailing_request_checks', 'detailing_transfers', 'detailing_transfer_items',
    'detailing_consumption_events', 'detailing_consumption_items', 'detailing_movements'
  ] LOOP
    SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = ('public.' || v_table)::regclass;
    IF NOT v_rls THEN RAISE EXCEPTION 'RLS is disabled for %', v_table; END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
      RAISE EXCEPTION 'Authenticated SELECT grant is missing for %', v_table;
    END IF;
    IF has_table_privilege('authenticated', 'public.' || v_table, 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Direct browser write grant exists for %', v_table;
    END IF;
  END LOOP;

  IF NOT has_function_privilege(
    'authenticated',
    'public.fn_reserve_detailing(uuid,uuid,uuid,uuid,integer,uuid)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'Reservation RPC grant is missing'; END IF;
  IF has_function_privilege(
    'authenticated',
    'public.detailing_release_reservation_internal(uuid,uuid,text,boolean)',
    'EXECUTE'
  ) THEN RAISE EXCEPTION 'Internal release function is exposed'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.tasks'::regclass AND attname = 'deadline' AND attnotnull
  ) THEN RAISE EXCEPTION 'tasks.deadline is still NOT NULL'; END IF;
END;
$$;

SELECT 'detailing_security_test: ok' AS result;
