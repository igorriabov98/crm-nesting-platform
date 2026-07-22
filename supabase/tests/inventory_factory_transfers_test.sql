\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_beregovo uuid;
  v_uzhgorod uuid;
  v_mukachevo uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_supply_actor uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_scrap_material uuid := gen_random_uuid();
  v_knife_material uuid := gen_random_uuid();
  v_knife_variant uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_local_item uuid := gen_random_uuid();
  v_source_inventory uuid := gen_random_uuid();
  v_local_inventory uuid := gen_random_uuid();
  v_reservation uuid;
  v_transfer uuid;
  v_transfer_item uuid;
  v_task uuid;
  v_deadline date;
  v_status text;
  v_value numeric;
  v_count integer;
  v_destination_inventory uuid;
  v_section uuid := gen_random_uuid();
  v_fact uuid := gen_random_uuid();
  v_event uuid;

  v_cancel_machine uuid := gen_random_uuid();
  v_cancel_request uuid := gen_random_uuid();
  v_cancel_item uuid := gen_random_uuid();
  v_cancel_inventory uuid := gen_random_uuid();
  v_cancel_reservation uuid;
  v_cancel_transfer uuid;

  v_release_machine uuid := gen_random_uuid();
  v_release_request uuid := gen_random_uuid();
  v_release_item uuid := gen_random_uuid();
  v_release_inventory uuid := gen_random_uuid();
  v_release_reservation uuid;
  v_release_transfer uuid;
  v_release_destination uuid;

  v_move_machine uuid := gen_random_uuid();
  v_move_request uuid := gen_random_uuid();
  v_move_item uuid := gen_random_uuid();
  v_move_inventory uuid := gen_random_uuid();
  v_old_transfer uuid;
  v_new_transfer uuid;

  v_scrap_machine uuid := gen_random_uuid();
  v_scrap_request uuid := gen_random_uuid();
  v_scrap_item uuid := gen_random_uuid();
  v_scrap_inventory uuid := gen_random_uuid();
  v_scrap_transfer uuid;

  v_knife_machine uuid := gen_random_uuid();
  v_knife_request uuid := gen_random_uuid();
  v_knife_item uuid := gen_random_uuid();
  v_knife_inventory uuid := gen_random_uuid();
  v_knife_transfer uuid;
  v_knife_transfer_item record;
BEGIN
  SELECT id INTO v_beregovo FROM public.factories WHERE name = 'Берегово' LIMIT 1;
  SELECT id INTO v_uzhgorod FROM public.factories WHERE name = 'Ужгород' LIMIT 1;
  IF v_beregovo IS NULL OR v_uzhgorod IS NULL THEN
    RAISE EXCEPTION 'Для теста нужны заводы Берегово и Ужгород';
  END IF;

  INSERT INTO public.factories(id, name) VALUES (v_mukachevo, 'Мукачево — тест перевозок');
  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
  VALUES
    (v_actor, 'inventory-transfer-technologist@example.test', 'Тестовый технолог перевозок', 'technologist', v_beregovo, true),
    (v_supply_actor, 'inventory-transfer-supply@example.test', 'Тестовый снабженец перевозок', 'procurement_head', v_beregovo, true);
  INSERT INTO public.departments(name, head_user_id, factory_id, is_active, sort_order, created_by)
  VALUES ('Снабжение', v_supply_actor, v_beregovo, true, -1000, v_actor);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  INSERT INTO public.materials(id, name, category, created_by)
  VALUES
    (v_material, 'Тестовая комплектация перевозки', 'components', v_actor),
    (v_scrap_material, 'Тестовый деловой отход перевозки', 'components', v_actor),
    (v_knife_material, 'Тестовый мерный нож перевозки', 'knives', v_actor);
  INSERT INTO public.material_variants(id, material_id, category, knife_dimensions, default_unit)
  VALUES (v_knife_variant, v_knife_material, 'knives', 'тест 40×10', 'мм');

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_machine, v_beregovo, 'INV-TRANSFER-MAIN', v_actor);
  INSERT INTO public.technologist_requests(id, machine_id, created_by)
  VALUES (v_request, v_machine, v_actor);
  INSERT INTO public.request_components(id, request_id, component_name, quantity_needed, unit, material_id)
  VALUES
    (v_item, v_request, 'Удалённая комплектация', 20, 'шт', v_material),
    (v_local_item, v_request, 'Локальная комплектация', 1, 'шт', v_material);
  INSERT INTO public.inventory(
    id, factory_id, material_id, total_quantity, reserved_quantity, unit, last_updated_by
  ) VALUES
    (v_source_inventory, v_uzhgorod, v_material, 10, 0, 'шт', v_actor),
    (v_local_inventory, v_beregovo, v_material, 1, 0, 'шт', v_actor);

  v_reservation := public.fn_reserve_inventory_row_for_machine(
    v_local_inventory, v_machine, 1, 'request_components', v_local_item, v_actor, NULL, false
  );
  IF EXISTS (
    SELECT 1 FROM public.inventory_transfers
    WHERE machine_id = v_machine AND status IN ('needs_date', 'scheduled', 'partially_received')
  ) THEN
    RAISE EXCEPTION 'Локальная бронь не должна создавать перевозку';
  END IF;
  PERFORM public.fn_unreserve_inventory_reservation(v_reservation, v_actor, 'Очистка локальной проверки');

  BEGIN
    PERFORM public.fn_reserve_inventory_row_for_machine_transfer(
      v_local_inventory, v_machine, 1, 'request_components', v_local_item, v_actor, NULL, false
    );
    RAISE EXCEPTION 'Удалённый RPC принял локальный остаток';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%обычное бронирование%' THEN RAISE; END IF;
  END;

  v_reservation := public.fn_reserve_inventory_row_for_machine_transfer(
    v_source_inventory, v_machine, 5, 'request_components', v_item, v_actor, NULL, false
  );
  SELECT transfer.id, item.id
  INTO v_transfer, v_transfer_item
  FROM public.inventory_transfers AS transfer
  JOIN public.inventory_transfer_items AS item ON item.transfer_id = transfer.id
  WHERE transfer.machine_id = v_machine
    AND transfer.source_factory_id = v_uzhgorod
    AND transfer.destination_factory_id = v_beregovo
    AND transfer.status = 'needs_date';
  IF v_transfer IS NULL THEN RAISE EXCEPTION 'Удалённая бронь не создала перевозку'; END IF;

  SELECT total_quantity, reserved_quantity
  INTO v_value, v_count
  FROM public.inventory WHERE id = v_source_inventory;
  IF v_value <> 10 OR v_count <> 5 THEN
    RAISE EXCEPTION 'Источник изменён до приёмки: total %, reserved %', v_value, v_count;
  END IF;
  SELECT id, deadline INTO v_task, v_deadline
  FROM public.tasks
  WHERE inventory_transfer_id = v_transfer AND status IN ('pending', 'in_progress');
  IF v_task IS NULL OR v_deadline IS NOT NULL THEN
    RAISE EXCEPTION 'Системная задача без даты заготовки создана неверно';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tasks AS task
    JOIN public.departments AS department ON department.head_user_id = task.assigned_to
    WHERE task.id = v_task
      AND department.factory_id = v_beregovo
      AND department.name = 'Снабжение'
      AND department.is_active = true
  ) THEN
    RAISE EXCEPTION 'Задача назначена не снабжению завода назначения';
  END IF;

  PERFORM set_config('app.inventory_transfer_task_sync', 'false', true);
  BEGIN
    UPDATE public.tasks SET status = 'completed' WHERE id = v_task;
    RAISE EXCEPTION 'Системную задачу удалось закрыть вручную';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%только при полной приёмке%' THEN RAISE; END IF;
  END;

  UPDATE public.production_stages
  SET date_start = DATE '2030-01-07', is_skipped = false, updated_by = v_actor
  WHERE machine_id = v_machine AND stage_type = 'cutting';
  SELECT deadline INTO v_deadline
  FROM public.tasks
  WHERE inventory_transfer_id = v_transfer AND status IN ('pending', 'in_progress');
  IF v_deadline <> DATE '2030-01-04' THEN
    RAISE EXCEPTION 'Дедлайн не равен предыдущему рабочему дню: %', v_deadline;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_supply_actor::text, true);
  SELECT public.fn_set_inventory_transfer_date(v_transfer, DATE '2030-01-06', v_supply_actor)::text
  INTO v_status;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  IF v_status <> 'scheduled' THEN RAISE EXCEPTION 'Дата не перевела перевозку в scheduled'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE inventory_transfer_id = v_transfer
      AND status IN ('pending', 'in_progress')
      AND description LIKE '%РИСК ОПОЗДАНИЯ%'
  ) THEN
    RAISE EXCEPTION 'В задаче отсутствует риск поздней доставки';
  END IF;

  INSERT INTO public.production_fact_sections(
    id, factory_id, name, production_stage_type, created_by, updated_by
  ) VALUES (v_section, v_beregovo, 'Тестовая заготовка перевозки', 'cutting', v_actor, v_actor);
  BEGIN
    INSERT INTO public.production_machine_facts(
      id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
    ) VALUES (v_fact, v_beregovo, DATE '2030-01-07', 'day', v_machine, v_section, v_actor, v_actor);
    RAISE EXCEPTION 'Непринятая перевозка не заблокировала факт заготовки';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%не весь межзаводской материал принят%' THEN RAISE; END IF;
  END;

  SELECT public.fn_receive_inventory_transfer(
    v_transfer,
    jsonb_build_array(jsonb_build_object('item_id', v_transfer_item, 'quantity', 2)),
    v_actor
  )::text INTO v_status;
  IF v_status <> 'partially_received' THEN RAISE EXCEPTION 'Частичная приёмка: %', v_status; END IF;
  SELECT total_quantity, reserved_quantity INTO v_value, v_count
  FROM public.inventory WHERE id = v_source_inventory;
  IF v_value <> 8 OR v_count <> 3 THEN
    RAISE EXCEPTION 'Источник после частичной приёмки неверен: total %, reserved %', v_value, v_count;
  END IF;
  SELECT destination_inventory_id INTO v_destination_inventory
  FROM public.inventory_transfer_items WHERE id = v_transfer_item;
  SELECT total_quantity, reserved_quantity INTO v_value, v_count
  FROM public.inventory WHERE id = v_destination_inventory AND factory_id = v_beregovo;
  IF v_value IS DISTINCT FROM 3 OR v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'Назначение после частичной приёмки неверно: inventory %, total %, reserved %',
      v_destination_inventory, v_value, v_count;
  END IF;

  BEGIN
    PERFORM public.fn_receive_inventory_transfer(
      v_transfer,
      jsonb_build_array(jsonb_build_object('item_id', v_transfer_item, 'quantity', 9)),
      v_actor
    );
    RAISE EXCEPTION 'Сверхплановая приёмка прошла при нехватке';
  EXCEPTION WHEN check_violation OR raise_exception THEN
    IF SQLERRM NOT LIKE '%Сверхплановая приёмка невозможна%' THEN RAISE; END IF;
  END;
  IF (SELECT total_quantity FROM public.inventory WHERE id = v_source_inventory) <> 8 THEN
    RAISE EXCEPTION 'Неуспешная сверхплановая приёмка изменила источник';
  END IF;

  SELECT public.fn_receive_inventory_transfer(
    v_transfer,
    jsonb_build_array(jsonb_build_object('item_id', v_transfer_item, 'quantity', 4)),
    v_actor
  )::text INTO v_status;
  IF v_status <> 'completed' THEN RAISE EXCEPTION 'Сверхплановая приёмка не завершила перевозку'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_source_inventory AND total_quantity = 4 AND reserved_quantity = 0
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_destination_inventory AND total_quantity = 7 AND reserved_quantity = 6
  ) THEN
    RAISE EXCEPTION 'Инварианты количества после полной приёмки нарушены';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.inventory_transactions
  WHERE machine_id = v_machine AND transaction_type IN ('transfer_out', 'transfer_in');
  IF v_count <> 6 THEN RAISE EXCEPTION 'Движения transfer_out/transfer_in не записаны попарно: %', v_count; END IF;
  SELECT COALESCE(sum(quantity), 0) INTO v_value
  FROM public.inventory_transactions
  WHERE machine_id = v_machine AND transaction_type = 'transfer_out';
  IF v_value <> -6 THEN RAISE EXCEPTION 'Сумма transfer_out неверна: %', v_value; END IF;
  SELECT COALESCE(sum(quantity), 0) INTO v_value
  FROM public.inventory_transactions
  WHERE machine_id = v_machine AND transaction_type = 'transfer_in';
  IF v_value <> 6 THEN RAISE EXCEPTION 'Сумма transfer_in неверна: %', v_value; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE inventory_transfer_id = v_transfer AND status = 'completed'
  ) THEN RAISE EXCEPTION 'Задача не закрылась полной приёмкой'; END IF;

  BEGIN
    PERFORM public.fn_receive_inventory_transfer(
      v_transfer,
      jsonb_build_array(jsonb_build_object('item_id', v_transfer_item, 'quantity', 1)),
      v_actor
    );
    RAISE EXCEPTION 'Повторная приёмка завершённой перевозки прошла';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Активная перевозка материалов не найдена%' THEN RAISE; END IF;
  END;

  INSERT INTO public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) VALUES (v_fact, v_beregovo, DATE '2030-01-07', 'day', v_machine, v_section, v_actor, v_actor);
  v_event := public.fn_apply_production_fact_cutting(v_fact, v_actor);
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_destination_inventory AND total_quantity = 1 AND reserved_quantity = 0
  ) THEN RAISE EXCEPTION 'Факт заготовки списал материал не со склада назначения'; END IF;
  DELETE FROM public.production_machine_facts WHERE id = v_fact;
  PERFORM public.fn_apply_production_cutting_rollback(v_machine, NULL, v_actor, 'Тестовый откат');
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_destination_inventory AND total_quantity = 7 AND reserved_quantity = 6
  ) THEN RAISE EXCEPTION 'Откат не восстановил склад назначения'; END IF;
  IF (SELECT total_quantity FROM public.inventory WHERE id = v_source_inventory) <> 4 THEN
    RAISE EXCEPTION 'Откат ошибочно вернул материал на исходный завод';
  END IF;

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_cancel_machine, v_beregovo, 'INV-TRANSFER-CANCEL', v_actor);
  INSERT INTO public.technologist_requests(id, machine_id, created_by)
  VALUES (v_cancel_request, v_cancel_machine, v_actor);
  INSERT INTO public.request_components(id, request_id, component_name, quantity_needed, unit, material_id)
  VALUES (v_cancel_item, v_cancel_request, 'Отмена до отправки', 3, 'шт', v_material);
  v_cancel_inventory := v_source_inventory;
  v_cancel_reservation := public.fn_reserve_inventory_row_for_machine_transfer(
    v_cancel_inventory, v_cancel_machine, 3, 'request_components', v_cancel_item, v_actor, NULL, false
  );
  SELECT id INTO v_cancel_transfer FROM public.inventory_transfers
  WHERE machine_id = v_cancel_machine AND status IN ('needs_date', 'scheduled', 'partially_received');
  PERFORM public.fn_unreserve_inventory_reservation(v_cancel_reservation, v_actor, 'Отмена до отправки');
  IF (SELECT status FROM public.inventory_transfers WHERE id = v_cancel_transfer) <> 'cancelled' THEN
    RAISE EXCEPTION 'Снятие брони до отправки не отменило перевозку';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory WHERE id = v_cancel_inventory AND total_quantity = 4 AND reserved_quantity = 0
  ) THEN RAISE EXCEPTION 'Снятие брони до отправки нарушило источник'; END IF;

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_release_machine, v_beregovo, 'INV-TRANSFER-RELEASE', v_actor);
  INSERT INTO public.technologist_requests(id, machine_id, created_by)
  VALUES (v_release_request, v_release_machine, v_actor);
  INSERT INTO public.request_components(id, request_id, component_name, quantity_needed, unit, material_id)
  VALUES (v_release_item, v_release_request, 'Снятие после приёмки', 2, 'шт', v_material);
  v_release_inventory := v_source_inventory;
  v_release_reservation := public.fn_reserve_inventory_row_for_machine_transfer(
    v_release_inventory, v_release_machine, 2, 'request_components', v_release_item, v_actor, NULL, false
  );
  SELECT transfer.id, item.id INTO v_release_transfer, v_transfer_item
  FROM public.inventory_transfers AS transfer
  JOIN public.inventory_transfer_items AS item ON item.transfer_id = transfer.id
  WHERE transfer.machine_id = v_release_machine AND transfer.status IN ('needs_date', 'scheduled');
  PERFORM public.fn_receive_inventory_transfer(
    v_release_transfer,
    jsonb_build_array(jsonb_build_object('item_id', v_transfer_item, 'quantity', 2)),
    v_actor
  );
  SELECT destination_inventory_id INTO v_release_destination
  FROM public.inventory_transfer_items WHERE id = v_transfer_item;
  SELECT id INTO v_release_reservation
  FROM public.inventory_reservations
  WHERE machine_id = v_release_machine AND inventory_id = v_release_destination AND consumed_at IS NULL;
  PERFORM public.fn_unreserve_inventory_reservation(v_release_reservation, v_actor, 'Снятие после приёмки');
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_release_destination AND total_quantity = 9 AND reserved_quantity = 6
  ) OR (SELECT total_quantity FROM public.inventory WHERE id = v_release_inventory) <> 2 THEN
    RAISE EXCEPTION 'Снятие после приёмки вернуло материал не на тот склад';
  END IF;

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_move_machine, v_beregovo, 'INV-TRANSFER-MOVE', v_actor);
  INSERT INTO public.technologist_requests(id, machine_id, created_by)
  VALUES (v_move_request, v_move_machine, v_actor);
  INSERT INTO public.request_components(id, request_id, component_name, quantity_needed, unit, material_id)
  VALUES (v_move_item, v_move_request, 'Смена завода', 2, 'шт', v_material);
  v_move_inventory := v_source_inventory;
  PERFORM public.fn_reserve_inventory_row_for_machine_transfer(
    v_move_inventory, v_move_machine, 2, 'request_components', v_move_item, v_actor, NULL, false
  );
  SELECT id INTO v_old_transfer FROM public.inventory_transfers
  WHERE machine_id = v_move_machine AND status IN ('needs_date', 'scheduled', 'partially_received');
  UPDATE public.machines SET factory_id = v_mukachevo, archived_by = v_actor WHERE id = v_move_machine;
  SELECT id INTO v_new_transfer FROM public.inventory_transfers
  WHERE machine_id = v_move_machine AND source_factory_id = v_uzhgorod
    AND destination_factory_id = v_mukachevo
    AND status IN ('needs_date', 'scheduled', 'partially_received');
  IF (SELECT status FROM public.inventory_transfers WHERE id = v_old_transfer) <> 'cancelled'
    OR v_new_transfer IS NULL THEN
    RAISE EXCEPTION 'Смена завода не перестроила маршрут из фактического склада';
  END IF;

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_scrap_machine, v_beregovo, 'INV-TRANSFER-SCRAP', v_actor);
  INSERT INTO public.technologist_requests(id, machine_id, created_by)
  VALUES (v_scrap_request, v_scrap_machine, v_actor);
  INSERT INTO public.request_components(id, request_id, component_name, quantity_needed, unit, material_id)
  VALUES (v_scrap_item, v_scrap_request, 'Деловой отход', 2, 'шт', v_scrap_material);
  INSERT INTO public.inventory(
    id, factory_id, material_id, total_quantity, reserved_quantity, unit,
    is_business_scrap, business_scrap_state, last_updated_by
  ) VALUES (v_scrap_inventory, v_uzhgorod, v_scrap_material, 2, 0, 'шт', true, 'available', v_actor);
  PERFORM public.fn_reserve_inventory_row_for_machine_transfer(
    v_scrap_inventory, v_scrap_machine, 2, 'request_components', v_scrap_item, v_actor, NULL, false
  );
  SELECT transfer.id, item.id INTO v_scrap_transfer, v_transfer_item
  FROM public.inventory_transfers AS transfer
  JOIN public.inventory_transfer_items AS item ON item.transfer_id = transfer.id
  WHERE transfer.machine_id = v_scrap_machine AND transfer.status IN ('needs_date', 'scheduled');
  PERFORM public.fn_receive_inventory_transfer(
    v_scrap_transfer,
    jsonb_build_array(jsonb_build_object('item_id', v_transfer_item, 'quantity', 2)),
    v_actor
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_transfer_items
    WHERE id = v_transfer_item AND is_business_scrap = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = (SELECT destination_inventory_id FROM public.inventory_transfer_items WHERE id = v_transfer_item)
      AND factory_id = v_beregovo AND is_business_scrap = true
  ) THEN RAISE EXCEPTION 'Деловой отход не сохранил категорию при перевозке'; END IF;

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_knife_machine, v_beregovo, 'INV-TRANSFER-KNIFE', v_actor);
  INSERT INTO public.technologist_requests(id, machine_id, created_by)
  VALUES (v_knife_request, v_knife_machine, v_actor);
  INSERT INTO public.request_knives(
    id, request_id, knife_type, order_mm, will_be_used_mm,
    material_id, material_variant_id, length_mm
  ) VALUES (
    v_knife_item, v_knife_request, 'Тестовый нож', 7000, 7000,
    v_knife_material, v_knife_variant, 7000
  );
  INSERT INTO public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) VALUES (
    v_knife_inventory, v_uzhgorod, v_knife_material, v_knife_variant, 6000,
    18000, 0, 'мм', 3, 0, 'шт', v_actor
  );
  PERFORM public.fn_reserve_inventory_row_for_machine_transfer(
    v_knife_inventory, v_knife_machine, 7000, 'request_knives', v_knife_item,
    v_actor, NULL, true
  );
  SELECT id INTO v_knife_transfer FROM public.inventory_transfers
  WHERE machine_id = v_knife_machine AND status IN ('needs_date', 'scheduled');
  IF (SELECT count(*) FROM public.inventory_transfer_items WHERE transfer_id = v_knife_transfer) <> 2 THEN
    RAISE EXCEPTION 'Мерная бронь не разделилась на целый и отрезанный кусок';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE source_inventory_id = v_knife_inventory AND is_business_scrap = true
      AND factory_id = v_uzhgorod AND total_quantity = 5000
  ) THEN RAISE EXCEPTION 'Отрезанный остаток не остался деловым отходом в источнике'; END IF;

  SELECT * INTO v_knife_transfer_item
  FROM public.inventory_transfer_items
  WHERE transfer_id = v_knife_transfer AND requested_quantity = 6000;
  BEGIN
    PERFORM public.fn_receive_inventory_transfer(
      v_knife_transfer,
      jsonb_build_array(jsonb_build_object('item_id', v_knife_transfer_item.id, 'quantity', 3000)),
      v_actor
    );
    RAISE EXCEPTION 'Мерный кусок принят частично';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%только целиком%' THEN RAISE; END IF;
  END;

  SELECT public.fn_receive_inventory_transfer(
    v_knife_transfer,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'item_id', id,
        'quantity', CASE WHEN requested_quantity = 6000 THEN 12000 ELSE requested_quantity END
      ))
      FROM public.inventory_transfer_items WHERE transfer_id = v_knife_transfer
    ), '[]'::jsonb),
    v_actor
  )::text INTO v_status;
  IF v_status <> 'completed' THEN RAISE EXCEPTION 'Мерные куски не приняты полностью'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.inventory_reservations AS reservation
    JOIN public.inventory AS inventory ON inventory.id = reservation.inventory_id
    WHERE reservation.machine_id = v_knife_machine
      AND reservation.consumed_at IS NULL
      AND (reservation.is_cut_reservation = true OR inventory.factory_id <> v_beregovo)
  ) THEN
    RAISE EXCEPTION 'Принятый мерный кусок не стал обычной бронью склада назначения';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_knife_inventory
      AND total_quantity = 0 AND total_secondary_quantity = 0
  ) THEN RAISE EXCEPTION 'Сверхплановый мерный кусок не списан целиком из источника'; END IF;
  SELECT COALESCE(sum(total_quantity), 0), COALESCE(sum(total_secondary_quantity), 0)
  INTO v_value, v_count
  FROM public.inventory
  WHERE factory_id = v_beregovo AND material_id = v_knife_material AND deleted_at IS NULL;
  IF v_value <> 13000 OR v_count <> 3 THEN
    RAISE EXCEPTION 'Инвариант мерных кусков в назначении нарушен: % мм / % шт', v_value, v_count;
  END IF;
  SELECT COALESCE(sum(quantity), 0), COALESCE(sum(secondary_quantity), 0)
  INTO v_value, v_count
  FROM public.inventory_transactions
  WHERE machine_id = v_knife_machine AND transaction_type = 'transfer_out';
  IF v_value <> -13000 OR v_count <> -3 THEN
    RAISE EXCEPTION 'transfer_out мерных кусков неверен: % мм / % шт', v_value, v_count;
  END IF;
  SELECT COALESCE(sum(quantity), 0), COALESCE(sum(secondary_quantity), 0)
  INTO v_value, v_count
  FROM public.inventory_transactions
  WHERE machine_id = v_knife_machine AND transaction_type = 'transfer_in';
  IF v_value <> 13000 OR v_count <> 3 THEN
    RAISE EXCEPTION 'transfer_in мерных кусков неверен: % мм / % шт', v_value, v_count;
  END IF;
END;
$$;

ROLLBACK;
