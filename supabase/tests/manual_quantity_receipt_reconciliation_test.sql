\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_assignee uuid := gen_random_uuid();
  v_department uuid := gen_random_uuid();
  v_supply_department uuid := gen_random_uuid();
  v_factory uuid;
  v_supplier uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_free_material uuid := gen_random_uuid();
  v_stock_material uuid := gen_random_uuid();
  v_source_machine uuid := gen_random_uuid();
  v_cancel_owner_machine uuid := gen_random_uuid();
  v_cancel_machine uuid := gen_random_uuid();
  v_partial_machine uuid := gen_random_uuid();
  v_protected_machine uuid := gen_random_uuid();
  v_free_machine uuid := gen_random_uuid();
  v_source_request uuid := gen_random_uuid();
  v_cancel_owner_request uuid := gen_random_uuid();
  v_cancel_request uuid := gen_random_uuid();
  v_partial_request uuid := gen_random_uuid();
  v_protected_request uuid := gen_random_uuid();
  v_free_request uuid := gen_random_uuid();
  v_stock_request uuid := gen_random_uuid();
  v_source_item uuid := gen_random_uuid();
  v_cancel_owner_item uuid := gen_random_uuid();
  v_cancel_item uuid := gen_random_uuid();
  v_partial_item uuid := gen_random_uuid();
  v_protected_item uuid := gen_random_uuid();
  v_free_item uuid := gen_random_uuid();
  v_stock_item uuid := gen_random_uuid();
  v_source_schedule uuid := gen_random_uuid();
  v_cancel_early_schedule uuid := gen_random_uuid();
  v_cancel_late_schedule uuid := gen_random_uuid();
  v_partial_schedule uuid := gen_random_uuid();
  v_protected_schedule uuid := gen_random_uuid();
  v_free_schedule uuid := gen_random_uuid();
  v_stock_current_schedule uuid := gen_random_uuid();
  v_stock_future_schedule uuid := gen_random_uuid();
  v_cancel_trip uuid := gen_random_uuid();
  v_protected_trip uuid := gen_random_uuid();
  v_result jsonb;
  v_error text;
  v_case_id uuid;
  v_assigned_task_id uuid;
begin
  if to_regprocedure('public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)') is null
    or to_regprocedure('public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)') is null then
    raise exception 'Новые RPC ручной приёмки не созданы';
  end if;
  if has_function_privilege('anon', 'public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)', 'EXECUTE') then
    raise exception 'Права RPC ручной приёмки не соответствуют matrix cutover';
  end if;
  if not has_table_privilege('authenticated', 'public.supply_schedule_review_cases', 'SELECT')
    or has_table_privilege('authenticated', 'public.supply_schedule_review_cases', 'INSERT')
    or has_table_privilege('anon', 'public.supply_schedule_review_cases', 'SELECT') then
    raise exception 'Права чтения случаев проверки снабжением настроены неверно';
  end if;

  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then raise exception 'Для теста не найден завод'; end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_actor, 'manual-quantity-receipt-' || v_actor || '@example.test', 'Оператор ручной приёмки', 'sales_manager', v_factory, true),
    (v_assignee, 'manual-quantity-assignee-' || v_assignee || '@example.test', 'Ответственный снабжения', 'supply_manager', v_factory, true);
  insert into public.departments(id, name, factory_id, is_active, created_by)
  values
    (v_department, 'Manual receipt ' || v_actor, v_factory, true, v_actor),
    (v_supply_department, 'Supply receipt review ' || v_assignee, v_factory, true, v_actor);
  insert into public.department_members(user_id, department_id, is_department_head, created_by)
  values
    (v_actor, v_department, false, v_actor),
    (v_assignee, v_supply_department, true, v_actor);
  insert into public.department_access_permissions(department_id, subject_scope, resource_key, can_view, can_manage, updated_by)
  values
    (v_department, 'member', 'inventory_receiving', true, true, v_actor),
    (v_department, 'member', 'technologist_requests', true, true, v_actor),
    (v_supply_department, 'head', 'supply_orders', true, true, v_actor);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.suppliers(id, name) values (v_supplier, 'Поставщик ручной приёмки');
  insert into public.supplier_material_categories(supplier_id,category) values(v_supplier,'paint');
  insert into public.materials(id, name, category, default_supplier_id, created_by) values
    (v_material, 'Краска ручного распределения', 'paint', v_supplier, v_actor),
    (v_free_material, 'Краска свободного прихода', 'paint', v_supplier, v_actor),
    (v_stock_material, 'Краска складской заявки 3 плюс 2', 'paint', v_supplier, v_actor);

  insert into public.machines(id, factory_id, name, created_by, planned_material_date) values
    (v_source_machine, v_factory, 'Источник текущего прихода', v_actor, date '2026-09-10'),
    (v_cancel_owner_machine, v_factory, 'Владелец агрегатного графика', v_actor, date '2026-10-01'),
    (v_cancel_machine, v_factory, 'Будущая машина — отмена', v_actor, date '2026-10-01'),
    (v_partial_machine, v_factory, 'Будущая машина — частично', v_actor, date '2026-10-02'),
    (v_protected_machine, v_factory, 'Будущая машина — в пути', v_actor, date '2026-10-03'),
    (v_free_machine, v_factory, 'Полностью свободный приход', v_actor, date '2026-10-04');
  insert into public.technologist_requests(id, machine_id, created_by, status) values
    (v_source_request, v_source_machine, v_actor, 'submitted_to_supply'),
    (v_cancel_owner_request, v_cancel_owner_machine, v_actor, 'submitted_to_supply'),
    (v_cancel_request, v_cancel_machine, v_actor, 'submitted_to_supply'),
    (v_partial_request, v_partial_machine, v_actor, 'submitted_to_supply'),
    (v_protected_request, v_protected_machine, v_actor, 'submitted_to_supply'),
    (v_free_request, v_free_machine, v_actor, 'submitted_to_supply');

  insert into public.request_paint(
    id, request_id, paint_type, ral_code, finish, weight_kg, waste_percent,
    order_status, ordered_at, material_id, supplier_id, remainder_kg
  ) values
    (v_source_item, v_source_request, 'manual paint', 'MANUAL', 'матовый', 9, 0, 'ordered', now(), v_material, v_supplier, 9),
    (v_cancel_owner_item, v_cancel_owner_request, 'manual paint', 'MANUAL', 'матовый', 2, 0, 'ordered', now(), v_material, v_supplier, 2),
    (v_cancel_item, v_cancel_request, 'manual paint', 'MANUAL', 'матовый', 3, 0, 'ordered', now(), v_material, v_supplier, 3),
    (v_partial_item, v_partial_request, 'manual paint', 'MANUAL', 'матовый', 5, 0, 'ordered', now(), v_material, v_supplier, 5),
    (v_protected_item, v_protected_request, 'manual paint', 'MANUAL', 'матовый', 4, 0, 'ordered', now(), v_material, v_supplier, 4),
    (v_free_item, v_free_request, 'free paint', 'FREE', 'матовый', 5, 0, 'ordered', now(), v_free_material, v_supplier, 5);

  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    supplier_id, created_by, updated_by, created_at
  ) values
    (v_source_schedule, 'request_paint', v_source_item, date '2026-09-10', 9, 'кг', v_supplier, v_actor, v_actor, now()),
    (v_cancel_early_schedule, 'request_paint', v_cancel_owner_item, date '2026-10-10', 2, 'кг', v_supplier, v_actor, v_actor, now()),
    (v_cancel_late_schedule, 'request_paint', v_cancel_owner_item, date '2026-10-20', 3, 'кг', v_supplier, v_actor, v_actor, now() + interval '1 second'),
    (v_partial_schedule, 'request_paint', v_partial_item, date '2026-10-21', 5, 'кг', v_supplier, v_actor, v_actor, now()),
    (v_protected_schedule, 'request_paint', v_protected_item, date '2026-10-22', 4, 'кг', v_supplier, v_actor, v_actor, now()),
    (v_free_schedule, 'request_paint', v_free_item, date '2026-09-11', 5, 'кг', v_supplier, v_actor, v_actor, now());

  insert into public.machine_outsourcing_transport_orders(
    id, direction, status, created_by, updated_by
  ) values (v_cancel_trip, 'outbound', 'needed', v_actor, v_actor);
  insert into public.machine_outsourcing_transport_orders(
    id, direction, status, created_by, updated_by, started_at, started_by
  ) values (v_protected_trip, 'outbound', 'in_transit', v_actor, v_actor, now(), v_actor);
  insert into public.transport_trip_need_links(
    transport_order_id, need_kind, need_source, need_id, direction,
    source_point_key, source_point_label, destination_point_key, destination_point_label, need_title
  ) values
    (v_cancel_trip, 'materials', 'supply_schedule', v_cancel_late_schedule, 'outbound',
      'supplier:test', 'Поставщик', 'factory:test', 'Завод', 'Поздняя будущая поставка'),
    (v_protected_trip, 'materials', 'supply_schedule', v_protected_schedule, 'outbound',
      'supplier:test', 'Поставщик', 'factory:test', 'Завод', 'Поставка в пути');

  begin
    perform public.fn_receive_supply_order_schedule_v2(
      v_source_schedule,
      v_actor,
      9,
      jsonb_build_array(jsonb_build_object(
        'table', 'request_paint', 'id', v_source_item,
        'quantity', 9, 'physical_quantity', 9, 'piece_count', null
      )),
      null,
      null
    );
    raise exception 'Legacy v2 accepted an ordinary receipt without manual confirmation';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%окно ручного распределения%' then raise; end if;
  end;
  if (select status from public.supply_order_delivery_schedules where id = v_source_schedule) <> 'planned'
    or exists (select 1 from public.inventory where factory_id = v_factory and material_id = v_material) then
    raise exception 'Legacy v2 guard left an ordinary receipt partially applied';
  end if;

  begin
    -- A missing supply owner cannot block the physical receipt. Roll back the
    -- fixture after asserting that the review remains durable and unassigned.
    alter table public.departments disable trigger organization_validate_department;
    alter table public.users disable trigger organization_guard_user_status;
    update public.departments
    set is_active = false
    where lower(btrim(name)) in ('снабжение', 'отдел снабжения');
    update public.users
    set is_active = false
    where role in ('procurement_head', 'supply_manager');
    select public.fn_receive_supply_order_schedule_v3(
      v_source_schedule,
      v_actor,
      9,
      jsonb_build_array(
        jsonb_build_object('table', 'request_paint', 'id', v_cancel_item, 'quantity', 3, 'physical_quantity', 3, 'piece_count', null),
        jsonb_build_object('table', 'request_paint', 'id', v_partial_item, 'quantity', 2, 'physical_quantity', 2, 'piece_count', null),
        jsonb_build_object('table', 'request_paint', 'id', v_protected_item, 'quantity', 4, 'physical_quantity', 4, 'piece_count', null)
      ),
      null,
      null,
      null
    ) into v_result;
    if (select status from public.supply_order_delivery_schedules where id = v_source_schedule) <> 'delivered'
      or (select count(*) from public.supply_schedule_review_cases
          where source_schedule_id = v_source_schedule and assigned_to is null) <> 3
      or exists (select 1 from public.tasks
          where supply_schedule_review_case_id in (
            select id from public.supply_schedule_review_cases where source_schedule_id = v_source_schedule
          ) and task_type = 'supply_schedule_reconciliation_review') then
      raise exception 'Приёмка без ответственного не сохранила неназначенную проверку';
    end if;
    raise exception 'ROLLBACK_MISSING_SUPPLY_OWNER';
  exception when others then
    v_error := sqlerrm;
    if v_error <> 'ROLLBACK_MISSING_SUPPLY_OWNER' then raise; end if;
  end;
  if (select status from public.supply_order_delivery_schedules where id = v_source_schedule) <> 'planned'
    or (select quantity from public.supply_order_delivery_schedules where id = v_cancel_late_schedule) <> 3
    or exists (select 1 from public.inventory where factory_id = v_factory and material_id = v_material) then
    raise exception 'Проверочная приёмка без ответственного не откатилась';
  end if;

  select public.fn_receive_supply_order_schedule_v3(
    v_source_schedule,
    v_actor,
    9,
    jsonb_build_array(
      jsonb_build_object('table', 'request_paint', 'id', v_cancel_item, 'quantity', 3, 'physical_quantity', 3, 'piece_count', null),
      jsonb_build_object('table', 'request_paint', 'id', v_partial_item, 'quantity', 2, 'physical_quantity', 2, 'piece_count', null),
      jsonb_build_object('table', 'request_paint', 'id', v_protected_item, 'quantity', 4, 'physical_quantity', 4, 'piece_count', null)
    ),
    null,
    null,
    null
  ) into v_result;

  if (v_result#>>'{reconciliation,reduced_quantity}')::numeric <> 0
    or (v_result#>>'{reconciliation,review_quantity}')::numeric <> 9
    or (v_result#>>'{reconciliation,review_case_count}')::integer <> 3 then
    raise exception 'Неверный итог проверки будущего графика: %', v_result;
  end if;
  if (select status from public.supply_order_delivery_schedules where id = v_source_schedule) <> 'delivered'
    or (select allocated_quantity from public.supply_order_delivery_schedules where id = v_source_schedule) <> 0
    or (select excess_quantity from public.supply_order_delivery_schedules where id = v_source_schedule) <> 0 then
    raise exception 'Исходный факт прихода записан неверно';
  end if;
  if (select quantity from public.supply_order_delivery_schedules where id = v_cancel_early_schedule) <> 2
    or (select status from public.supply_order_delivery_schedules where id = v_cancel_late_schedule) <> 'planned'
    or (select quantity from public.supply_order_delivery_schedules where id = v_cancel_late_schedule) <> 3
    or (select quantity from public.supply_order_delivery_schedules where id = v_partial_schedule) <> 5 then
    raise exception 'Приёмка изменила будущие строки графика';
  end if;
  if (select status from public.machine_outsourcing_transport_orders where id = v_cancel_trip) <> 'needed'
    or not exists (
      select 1 from public.transport_trip_need_links
      where transport_order_id = v_cancel_trip and need_id = v_cancel_late_schedule and released_at is null
    ) then
    raise exception 'Приёмка изменила будущий рейс';
  end if;
  if (select quantity from public.supply_order_delivery_schedules where id = v_protected_schedule) <> 4
    or (select status from public.supply_order_delivery_schedules where id = v_protected_schedule) <> 'planned'
    or not exists (
      select 1 from public.transport_trip_need_links
      where transport_order_id = v_protected_trip and need_id = v_protected_schedule and released_at is null
    ) then
    raise exception 'Поставка начатого рейса была изменена';
  end if;
  if exists (select 1 from public.supply_order_delivery_schedule_changes
      where schedule_id in (v_cancel_early_schedule, v_cancel_late_schedule, v_partial_schedule)) then
    raise exception 'Приёмка записала изменение будущего графика';
  end if;
  if (select count(*) from public.supply_schedule_review_cases
      where source_schedule_id = v_source_schedule and assigned_to is not null) <> 3 then
    raise exception 'Не сохранены три независимых случая проверки графика';
  end if;
  select id into v_case_id from public.supply_schedule_review_cases
  where source_schedule_id = v_source_schedule order by id limit 1;
  begin
    perform public.fn_assign_supply_schedule_review_case_v1(v_case_id, v_actor);
    raise exception 'Оператор приёмки смог назначить задачу снабжению';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Недостаточно прав%' then raise; end if;
  end;
  if (select count(*) from public.tasks
      where supply_schedule_review_case_id in (
        select id from public.supply_schedule_review_cases where source_schedule_id = v_source_schedule
      ) and task_type = 'supply_schedule_reconciliation_review') <> 3 then
    raise exception 'Повторная попытка назначения создала дубликат задачи';
  end if;
  if (select count(*) from public.tasks
      where supply_schedule_review_case_id in (
        select id from public.supply_schedule_review_cases where source_schedule_id = v_source_schedule
      )
        and task_type = 'supply_schedule_reconciliation_review'
        and status = 'pending') <> 3 then
    raise exception 'Должна быть создана отдельная задача для каждого случая';
  end if;
  if not exists (
    select 1 from public.tasks
    where supply_schedule_review_case_id in (
      select id from public.supply_schedule_review_cases where source_schedule_id = v_source_schedule
    )
      and description like '%График и договорённости с поставщиком не изменялись%'
  ) then
    raise exception 'Задача не объясняет, что график остался прежним';
  end if;
  begin
    delete from public.tasks where supply_schedule_review_case_id = v_case_id;
    perform set_config('request.jwt.claim.sub', v_assignee::text, true);
    select public.fn_assign_supply_schedule_review_case_v1(v_case_id, v_assignee)
      into v_assigned_task_id;
    if v_assigned_task_id is null
      or public.fn_assign_supply_schedule_review_case_v1(v_case_id, v_assignee) <> v_assigned_task_id
      or (select count(*) from public.tasks where supply_schedule_review_case_id = v_case_id) <> 1 then
      raise exception 'Повторное назначение случая создало дубликат задачи';
    end if;
    raise exception 'ROLLBACK_REASSIGNMENT_CHECK';
  exception when others then
    v_error := sqlerrm;
    if v_error <> 'ROLLBACK_REASSIGNMENT_CHECK' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  -- An explicit empty allocation means the full quantity is free stock. A
  -- missing array remains a rejected, unconfirmed operation.
  begin
    perform public.fn_receive_supply_order_schedule_v3(
      v_free_schedule, v_actor, 5, null, null, null, null
    );
    raise exception 'Неподтверждённая приёмка без массива не была отклонена';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%confirmed_allocations%' then raise; end if;
  end;

  select public.fn_receive_supply_order_schedule_v3(
    v_free_schedule, v_actor, 5, '[]'::jsonb, null, null, null
  ) into v_result;
  if (select status from public.supply_order_delivery_schedules where id = v_free_schedule) <> 'delivered'
    or (select allocated_quantity from public.supply_order_delivery_schedules where id = v_free_schedule) <> 0
    or (select excess_quantity from public.supply_order_delivery_schedules where id = v_free_schedule) <> 5
    or (select order_status from public.request_paint where id = v_free_item) <> 'ordered'
    or exists (select 1 from public.inventory_reservations where request_item_id = v_free_item) then
    raise exception 'Полностью свободный приход сохранился неверно: %', v_result;
  end if;
  if not exists (
    select 1 from public.inventory
    where factory_id = v_factory and material_id = v_free_material
      and total_quantity = 5 and reserved_quantity = 0
  ) then
    raise exception 'Свободный склад после нулевого распределения рассчитан неверно';
  end if;

  insert into public.technologist_requests(
    id, request_kind, machine_id, factory_id, title, needed_by, created_by, status
  ) values (v_stock_request, 'stock', null, v_factory, 'На склад: 5 кг', null, v_actor, 'draft');
  insert into public.request_paint(
    id, request_id, paint_type, ral_code, finish, weight_kg, waste_percent,
    order_status, ordered_at, material_id, supplier_id, remainder_kg
  ) values (
    v_stock_item, v_stock_request, 'stock paint', 'STOCK-3-2', 'матовый', 5, 0,
    'ordered', now(), v_stock_material, v_supplier, 5
  );
  perform set_config('app.financial_approval_request', v_stock_request::text, true);
  update public.technologist_requests set status = 'submitted_to_supply' where id = v_stock_request;
  perform set_config('app.financial_approval_request', '', true);
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    supplier_id, created_by, updated_by
  ) values
    (v_stock_current_schedule, 'request_paint', v_stock_item, date '2026-10-07', 3, 'кг', v_supplier, v_actor, v_actor),
    (v_stock_future_schedule, 'request_paint', v_stock_item, date '2026-10-15', 2, 'кг', v_supplier, v_actor, v_actor);
  select public.fn_receive_supply_order_schedule_v3(
    v_stock_current_schedule, v_actor, 3,
    jsonb_build_array(jsonb_build_object(
      'table', 'request_paint', 'id', v_stock_item, 'quantity', 3,
      'physical_quantity', 3, 'piece_count', null
    )), null, null, 'Параметр старого клиента не меняет график'
  ) into v_result;
  if (v_result#>>'{reconciliation,review_quantity}')::numeric <> 0
    or (select status from public.supply_order_delivery_schedules where id = v_stock_future_schedule) <> 'planned'
    or (select quantity from public.supply_order_delivery_schedules where id = v_stock_future_schedule) <> 2
    or exists (select 1 from public.supply_schedule_review_cases
      where source_schedule_id = v_stock_current_schedule)
    or exists (select 1 from public.tasks
      where supply_schedule_review_case_id in (
        select id from public.supply_schedule_review_cases where source_schedule_id = v_stock_current_schedule
      ) and task_type = 'supply_schedule_reconciliation_review')
    or not exists (select 1 from public.inventory
      where factory_id = v_factory and material_id = v_stock_material
        and total_quantity = 3 and available_quantity = 3 and reserved_quantity = 0) then
    raise exception 'Складская заявка 5 = 3 принято + 2 запланировано обработана неверно: %', v_result;
  end if;

  begin
    perform public.fn_receive_supply_order_schedule_v3(
      v_source_schedule, v_actor, 9, '[]'::jsonb, null, null, null
    );
    raise exception 'Повторная приёмка не была отклонена';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%Поставка уже принята%' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_department uuid := gen_random_uuid();
  v_factory uuid;
  v_supplier uuid := gen_random_uuid();
  v_machine uuid;
  v_request uuid;
  v_material uuid;
  v_variant uuid;
  v_item uuid;
  v_schedule uuid;
  v_table text;
  v_category public.material_category;
  v_unit text;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then raise exception 'Для теста не найден завод'; end if;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'manual-quantity-categories-' || v_actor || '@example.test', 'Проверка количественных категорий', 'supply_manager', v_factory, true);
  insert into public.departments(id, name, factory_id, is_active, created_by)
  values (v_department, 'Manual categories ' || v_actor, v_factory, true, v_actor);
  insert into public.department_members(user_id, department_id, is_department_head, created_by)
  values (v_actor, v_department, false, v_actor);
  insert into public.department_access_permissions(department_id, subject_scope, resource_key, can_view, can_manage, updated_by)
  values (v_department, 'member', 'inventory_receiving', true, true, v_actor);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.suppliers(id, name) values (v_supplier, 'Поставщик всех количественных категорий');

  foreach v_table in array array[
    'request_sheet_metal',
    'request_round_tube',
    'request_components',
    'request_mesh',
    'request_chain_cord',
    'request_pipe'
  ]
  loop
    v_machine := gen_random_uuid();
    v_request := gen_random_uuid();
    v_material := gen_random_uuid();
    v_variant := null;
    v_item := gen_random_uuid();
    v_schedule := gen_random_uuid();
    v_category := case v_table
      when 'request_sheet_metal' then 'sheet_metal'::public.material_category
      when 'request_round_tube' then 'round_tube'::public.material_category
      when 'request_components' then 'components'::public.material_category
      when 'request_mesh' then 'mesh'::public.material_category
      when 'request_chain_cord' then 'chain_cord'::public.material_category
      else 'pipe'::public.material_category
    end;
    insert into public.supplier_material_categories(supplier_id,category) values(v_supplier,v_category);
    v_unit := case
      when v_table in ('request_round_tube', 'request_pipe') then 'кг'
      when v_table = 'request_chain_cord' then 'мм'
      else 'шт'
    end;

    insert into public.machines(id, factory_id, name, created_by, planned_material_date)
    values (v_machine, v_factory, 'Свободная приёмка ' || v_table, v_actor, date '2026-09-15');
    insert into public.technologist_requests(id, machine_id, created_by, status)
    values (v_request, v_machine, v_actor, 'submitted_to_supply');
    insert into public.materials(id, name, category, default_supplier_id, created_by)
    values (v_material, 'Материал ' || v_table, v_category, v_supplier, v_actor);
    if v_table = 'request_pipe' then
      v_variant := gen_random_uuid();
      insert into public.material_variants(id, material_id, category, pipe_type, diameter_mm, default_unit)
      values (v_variant, v_material, 'pipe', 'wire', 4, 'кг');
    end if;

    case v_table
      when 'request_sheet_metal' then
        insert into public.request_sheet_metal(
          id, request_id, material_name, quantity_sheets, weight_order_kg, remainder_qty,
          order_status, ordered_at, material_id, supplier_id
        ) values (v_item, v_request, 'Лист', 2, 20, 2, 'ordered', now(), v_material, v_supplier);
      when 'request_round_tube' then
        insert into public.request_round_tube(
          id, request_id, material_name, order_meters, order_kg,
          order_status, ordered_at, material_id, supplier_id
        ) values (v_item, v_request, 'Круг / Труба legacy', 1, 2, 'ordered', now(), v_material, v_supplier);
      when 'request_components' then
        insert into public.request_components(
          id, request_id, component_name, quantity_needed, unit,
          order_status, ordered_at, material_id, supplier_id
        ) values (v_item, v_request, 'Комплектация', 2, 'шт', 'ordered', now(), v_material, v_supplier);
      when 'request_mesh' then
        insert into public.request_mesh(
          id, request_id, description, remainder_qty,
          order_status, ordered_at, material_id, supplier_id
        ) values (v_item, v_request, 'Сетка', 2, 'ordered', now(), v_material, v_supplier);
      when 'request_chain_cord' then
        insert into public.request_chain_cord(
          id, request_id, item_type, parameters, remainder_meters,
          order_status, ordered_at, material_id, supplier_id
        ) values (v_item, v_request, 'chain', 'Цепь', 0.002, 'ordered', now(), v_material, v_supplier);
      when 'request_pipe' then
        insert into public.request_pipe(
          id, request_id, pipe_type, size, remainder_kg,
          order_status, ordered_at, material_id, material_variant_id, supplier_id
        ) values (v_item, v_request, 'wire', 'Ø 4', 2, 'ordered', now(), v_material, v_variant, v_supplier);
    end case;

    insert into public.supply_order_delivery_schedules(
      id, request_item_table, request_item_id, delivery_date, quantity, unit,
      supplier_id, created_by, updated_by
    ) values (v_schedule, v_table, v_item, date '2026-09-15', 2, v_unit, v_supplier, v_actor, v_actor);

    perform public.fn_receive_supply_order_schedule_v3(
      v_schedule, v_actor, 2, '[]'::jsonb, null, null, null
    );
    if (select status from public.supply_order_delivery_schedules where id = v_schedule) <> 'delivered'
      or (select allocated_quantity from public.supply_order_delivery_schedules where id = v_schedule) <> 0
      or (select excess_quantity from public.supply_order_delivery_schedules where id = v_schedule) <> 2
      or not exists (
        select 1 from public.inventory
        where factory_id = v_factory and material_id = v_material
          and total_quantity = 2 and reserved_quantity = 0
      )
      or exists (
        select 1 from public.inventory_reservations
        where request_item_table = v_table and request_item_id = v_item
      ) then
      raise exception 'Свободная ручная приёмка категории % сохранилась неверно', v_table;
    end if;
  end loop;
end;
$$;

rollback;
