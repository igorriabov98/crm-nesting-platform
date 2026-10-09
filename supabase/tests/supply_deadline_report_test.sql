\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_first_factory uuid;
  v_second_factory uuid;
  v_employee uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_author uuid := gen_random_uuid();
  v_department uuid := gen_random_uuid();
  v_tech_department uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_first_item uuid := gen_random_uuid();
  v_second_item uuid := gen_random_uuid();
  v_schedule uuid := gen_random_uuid();
  v_error text;
BEGIN
  SELECT id INTO v_first_factory FROM public.factories WHERE name = 'Берегово';
  SELECT id INTO v_second_factory FROM public.factories WHERE name = 'Ужгород';
  IF v_first_factory IS NULL OR v_second_factory IS NULL THEN
    RAISE EXCEPTION 'Для проверки отчёта нужны оба завода';
  END IF;

  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active) VALUES
    (v_employee, v_employee || '@deadlines.test', 'Снабженец без завода', 'supply_manager', NULL, true),
    (v_outsider, v_outsider || '@deadlines.test', 'Без доступа к отчёту', 'engineer', NULL, true),
    (v_author, v_author || '@deadlines.test', 'Автор складской заявки', 'technologist', v_first_factory, true);
  INSERT INTO public.departments(id, name, is_active, created_by)
  VALUES (v_department, 'Supply deadline test', true, v_employee);
  INSERT INTO public.departments(id, name, factory_id, is_active, created_by)
  VALUES (v_tech_department, 'Supply deadline tech test', v_first_factory, true, v_author);
  INSERT INTO public.department_members(user_id, department_id, is_department_head, created_by)
  VALUES (v_employee, v_department, false, v_employee),
         (v_author, v_tech_department, false, v_author);
  INSERT INTO public.department_access_permissions
    (department_id, subject_scope, resource_key, can_view, can_manage, updated_by)
  VALUES (v_department, 'member', 'supply_deadline_report', true, true, v_employee),
         (v_tech_department, 'member', 'technologist_requests', true, true, v_author);
  INSERT INTO public.supply_deadline_factory_grants
    (department_id, subject_scope, factory_id, can_view, can_manage)
  VALUES
    (v_department, 'member', v_first_factory, true, true),
    (v_department, 'member', v_second_factory, true, false);

  PERFORM set_config('request.jwt.claim.sub', v_employee::text, true);
  IF NOT private.crm_has_supply_deadline_factory_permission('view', v_first_factory)
     OR NOT private.crm_has_supply_deadline_factory_permission('manage', v_first_factory)
     OR NOT private.crm_has_supply_deadline_factory_permission('view', v_second_factory)
     OR private.crm_has_supply_deadline_factory_permission('manage', v_second_factory) THEN
    RAISE EXCEPTION 'Права по заводам зависят от профиля или выданы неверно';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  IF private.crm_has_supply_deadline_factory_permission('view', v_first_factory) THEN
    RAISE EXCEPTION 'Посторонний сотрудник видит отчёт';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  INSERT INTO public.technologist_requests
    (id, request_kind, factory_id, title, needed_by, created_by, status)
  VALUES (v_request, 'stock', v_first_factory, 'Проверка сроков склада', '2026-10-01', v_author, 'draft');
  INSERT INTO public.request_paint
    (id, request_id, paint_type, ral_code, weight_kg, waste_percent, remainder_kg)
  VALUES
    (v_first_item, v_request, 'Тестовая краска', '9010', 5, 0, 5),
    (v_second_item, v_request, 'Другая краска', '9011', 7, 0, 7);
  -- This fixture tests the reporting trigger, not the financial approval flow.
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.technologist_requests SET status = 'submitted_to_supply' WHERE id = v_request;
  PERFORM set_config('session_replication_role', 'origin', true);
  PERFORM set_config('request.jwt.claim.sub', v_employee::text, true);
  INSERT INTO public.supply_order_delivery_schedules
    (id, request_item_table, request_item_id, delivery_date, quantity, unit,
     status, received_quantity, delivered_at, created_by, received_by)
  VALUES (v_schedule, 'request_paint', v_first_item, '2026-10-01', 5, 'кг',
    'delivered', 3, '2026-10-03 10:00:00+03', v_employee, v_employee);
  IF (SELECT material_deadline FROM public.supply_deadline_receipt_snapshots
      WHERE schedule_id = v_schedule) IS DISTINCT FROM DATE '2026-10-01' THEN
    RAISE EXCEPTION 'Срок приёмки не зафиксирован в той же транзакции';
  END IF;
  PERFORM set_config('session_replication_role', 'replica', true);
  UPDATE public.technologist_requests SET needed_by = '2026-10-10' WHERE id = v_request;
  PERFORM set_config('session_replication_role', 'origin', true);
  IF (SELECT material_deadline FROM public.supply_deadline_receipt_snapshots
      WHERE schedule_id = v_schedule) IS DISTINCT FROM DATE '2026-10-01' THEN
    RAISE EXCEPTION 'Изменение текущего срока переписало исторический срок';
  END IF;

  PERFORM public.fn_set_supply_deadline_exclusion(
    'item', 'request_paint', v_first_item, NULL, true, 'Не учитывать в просрочке');
  PERFORM public.fn_set_supply_deadline_exclusion(
    'item', 'request_paint', v_first_item, NULL, true, 'Не учитывать в просрочке');
  IF (SELECT count(*) FROM public.supply_deadline_exclusion_events) <> 1
     OR EXISTS (SELECT 1 FROM public.supply_deadline_exclusions
                WHERE request_item_id = v_second_item) THEN
    RAISE EXCEPTION 'Повторное исключение создало дубль или затронуло другую позицию';
  END IF;
  PERFORM public.fn_set_supply_deadline_exclusion(
    'item', 'request_paint', v_first_item, NULL, false, 'Вернуть в расчёт');
  IF (SELECT count(*) FROM public.supply_deadline_exclusion_events) <> 2 THEN
    RAISE EXCEPTION 'Отмена исключения не сохранила историю';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  BEGIN
    PERFORM public.fn_set_supply_deadline_exclusion(
      'item', 'request_paint', v_second_item, NULL, true, 'Нет права');
    RAISE EXCEPTION 'Изменение без права было разрешено';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_employee::text, true);
  BEGIN
    PERFORM public.fn_set_supply_deadline_exclusion(
      'schedule', 'request_paint', v_second_item, v_schedule, true, 'Чужая поставка');
    RAISE EXCEPTION 'Чужая поставка была исключена';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'Поставка не относится к позиции заявки' THEN RAISE; END IF;
  END;
END;
$test$;

ROLLBACK;
