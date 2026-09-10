\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_supplier uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_free_material uuid := gen_random_uuid();
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
  v_source_item uuid := gen_random_uuid();
  v_cancel_owner_item uuid := gen_random_uuid();
  v_cancel_item uuid := gen_random_uuid();
  v_partial_item uuid := gen_random_uuid();
  v_protected_item uuid := gen_random_uuid();
  v_free_item uuid := gen_random_uuid();
  v_source_schedule uuid := gen_random_uuid();
  v_cancel_early_schedule uuid := gen_random_uuid();
  v_cancel_late_schedule uuid := gen_random_uuid();
  v_partial_schedule uuid := gen_random_uuid();
  v_protected_schedule uuid := gen_random_uuid();
  v_free_schedule uuid := gen_random_uuid();
  v_cancel_trip uuid := gen_random_uuid();
  v_protected_trip uuid := gen_random_uuid();
  v_result jsonb;
  v_error text;
begin
  if to_regprocedure('public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)') is null
    or to_regprocedure('public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)') is null then
    raise exception 'Новые RPC ручной приёмки не созданы';
  end if;
  if has_function_privilege('anon', 'public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)', 'EXECUTE') then
    raise exception 'RPC ручной приёмки доступны браузерным ролям';
  end if;

  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then raise exception 'Для теста не найден завод'; end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'manual-quantity-receipt-' || v_actor || '@example.test', 'Оператор ручной приёмки', 'supply_manager', v_factory, true);
  insert into public.suppliers(id, name) values (v_supplier, 'Поставщик ручной приёмки');
  insert into public.materials(id, name, category, default_supplier_id, created_by) values
    (v_material, 'Краска ручного распределения', 'paint', v_supplier, v_actor),
    (v_free_material, 'Краска свободного прихода', 'paint', v_supplier, v_actor);

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
    perform public.fn_receive_supply_order_schedule_v3(
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
    );
    raise exception 'Пересечение с будущим графиком принято без причины';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%причин%' then raise; end if;
  end;
  if (select status from public.supply_order_delivery_schedules where id = v_source_schedule) <> 'planned'
    or (select quantity from public.supply_order_delivery_schedules where id = v_cancel_late_schedule) <> 3
    or exists (select 1 from public.inventory where factory_id = v_factory and material_id = v_material) then
    raise exception 'Отклонённая приёмка без причины оставила частичные изменения';
  end if;

  begin
    update public.departments
    set is_active = false
    where lower(btrim(name)) in ('снабжение', 'отдел снабжения');
    update public.users
    set is_active = false
    where role in ('procurement_head', 'supply_manager');
    perform public.fn_receive_supply_order_schedule_v3(
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
      'Проверка обязательного ответственного'
    );
    raise exception 'Изменение графика принято без активного ответственного';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%активный руководитель отдела снабжения%' then raise; end if;
  end;
  if (select status from public.supply_order_delivery_schedules where id = v_source_schedule) <> 'planned'
    or (select quantity from public.supply_order_delivery_schedules where id = v_cancel_late_schedule) <> 3
    or exists (select 1 from public.inventory where factory_id = v_factory and material_id = v_material) then
    raise exception 'Отклонённая приёмка без ответственного оставила частичные изменения';
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
    'Текущий приход направлен на будущие машины'
  ) into v_result;

  if (v_result#>>'{reconciliation,reduced_quantity}')::numeric <> 5
    or (v_result#>>'{reconciliation,protected_quantity}')::numeric <> 4 then
    raise exception 'Неверный итог пересчёта будущего графика: %', v_result;
  end if;
  if (select status from public.supply_order_delivery_schedules where id = v_source_schedule) <> 'delivered'
    or (select allocated_quantity from public.supply_order_delivery_schedules where id = v_source_schedule) <> 0
    or (select excess_quantity from public.supply_order_delivery_schedules where id = v_source_schedule) <> 0 then
    raise exception 'Исходный факт прихода записан неверно';
  end if;
  if (select quantity from public.supply_order_delivery_schedules where id = v_cancel_early_schedule) <> 2
    or (select status from public.supply_order_delivery_schedules where id = v_cancel_late_schedule) <> 'cancelled'
    or (select quantity from public.supply_order_delivery_schedules where id = v_partial_schedule) <> 3 then
    raise exception 'Будущие строки уменьшены не с самой поздней или не в нужном объёме';
  end if;
  if (select status from public.machine_outsourcing_transport_orders where id = v_cancel_trip) <> 'cancelled'
    or not exists (
      select 1 from public.transport_trip_need_links
      where transport_order_id = v_cancel_trip and need_id = v_cancel_late_schedule and released_at is not null
    ) then
    raise exception 'Пустой будущий рейс не освобождён и не отменён';
  end if;
  if (select quantity from public.supply_order_delivery_schedules where id = v_protected_schedule) <> 4
    or (select status from public.supply_order_delivery_schedules where id = v_protected_schedule) <> 'planned'
    or not exists (
      select 1 from public.transport_trip_need_links
      where transport_order_id = v_protected_trip and need_id = v_protected_schedule and released_at is null
    ) then
    raise exception 'Поставка начатого рейса была изменена';
  end if;
  if (select count(*) from public.supply_order_delivery_schedule_changes
      where schedule_id in (v_cancel_early_schedule, v_cancel_late_schedule, v_partial_schedule)) <> 2 then
    raise exception 'История частичного уменьшения и отмены записана неверно';
  end if;
  if (select count(*) from public.tasks
      where supply_order_schedule_id = v_source_schedule
        and task_type = 'supply_schedule_reconciliation_review'
        and status = 'pending') <> 1 then
    raise exception 'Должна быть создана ровно одна задача руководителю снабжения';
  end if;
  if not exists (
    select 1 from public.tasks
    where supply_order_schedule_id = v_source_schedule
      and description like '%Текущий приход направлен на будущие машины%'
      and description like '%Поставщик ручной приёмки%'
      and description like '%Неизменённый потенциальный излишек%'
  ) then
    raise exception 'В задаче отсутствуют причина, поставщик или защищённый объём';
  end if;

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
