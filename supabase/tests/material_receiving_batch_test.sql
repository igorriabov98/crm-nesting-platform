\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_schedule_22 uuid := gen_random_uuid();
  v_schedule_3 uuid := gen_random_uuid();
  v_inventory uuid;
  v_result jsonb;

  v_rollback_material uuid := gen_random_uuid();
  v_rollback_item uuid := gen_random_uuid();
  v_rollback_schedule_1 uuid := gen_random_uuid();
  v_rollback_schedule_2 uuid := gen_random_uuid();

  v_shortage_material uuid := gen_random_uuid();
  v_shortage_item uuid := gen_random_uuid();
  v_shortage_schedule_22 uuid := gen_random_uuid();
  v_shortage_schedule_3 uuid := gen_random_uuid();
  v_error text;
begin
  if to_regprocedure('public.fn_receive_supply_order_schedule_batch_v1(jsonb,uuid)') is null then
    raise exception 'Пакетная RPC приёмки не создана';
  end if;
  if to_regprocedure('public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)') is null then
    raise exception 'Пакетная RPC ручной приёмки не создана';
  end if;
  if has_function_privilege('anon', 'public.fn_receive_supply_order_schedule_batch_v1(jsonb,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_batch_v1(jsonb,uuid)', 'EXECUTE') then
    raise exception 'Пакетная RPC доступна браузерным ролям';
  end if;

  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then raise exception 'Для теста не найден завод'; end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'material-batch-receiving@example.test', 'Тест пакетной приёмки', 'supply_manager', v_factory, true);
  insert into public.suppliers(id, name) values (v_supplier, 'Varian test');
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'Тестовый заказ пакетной приёмки', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by, status)
  values (v_request, v_machine, v_actor, 'submitted_to_supply');

  -- Exact 22+3 technical paint rows must be received as one 25 kg operation.
  insert into public.materials(id, name, category, default_supplier_id, created_by)
  values (v_material, 'RAL 6050 test', 'paint', v_supplier, v_actor);
  insert into public.request_paint(
    id, request_id, paint_type, ral_code, finish, weight_kg, waste_percent,
    order_status, ordered_at, material_id, supplier_id, remainder_kg
  ) values (
    v_item, v_request, 'ral 6050', '6050', 'матовый', 22, 0,
    'ordered', now(), v_material, v_supplier, 22
  );
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    supplier_id, created_by, updated_by, created_at
  ) values
    (v_schedule_22, 'request_paint', v_item, date '2026-09-10', 22, 'кг', v_supplier, v_actor, v_actor, now()),
    (v_schedule_3, 'request_paint', v_item, date '2026-09-10', 3, 'кг', v_supplier, v_actor, v_actor, now() + interval '1 second');

  begin
    perform public.fn_receive_supply_order_schedule_batch_v1(
      jsonb_build_array(
        jsonb_build_object('schedule_id', v_schedule_22, 'received_quantity', 22, 'allocations', '[]'::jsonb),
        jsonb_build_object('schedule_id', v_schedule_3, 'received_quantity', 3, 'allocations', '[]'::jsonb)
      ),
      v_actor
    );
    raise exception 'Legacy batch v1 accepted an ordinary receipt without manual confirmation';
  exception when others then
    v_error := sqlerrm;
    if v_error not like '%окно ручного распределения%' then raise; end if;
  end;
  if (select count(*) from public.supply_order_delivery_schedules
      where id in (v_schedule_22, v_schedule_3) and status <> 'planned') <> 0
    or exists (select 1 from public.inventory where factory_id = v_factory and material_id = v_material) then
    raise exception 'Legacy batch v1 guard left an ordinary receipt partially applied';
  end if;

  select public.fn_receive_supply_order_schedule_batch_v2(
    jsonb_build_array(
      jsonb_build_object(
        'schedule_id', v_schedule_22, 'received_quantity', 22,
        'received_piece_length_mm', null, 'received_piece_count', null,
        'allocations', jsonb_build_array(jsonb_build_object(
          'table', 'request_paint', 'id', v_item, 'quantity', 22,
          'physical_quantity', 22, 'piece_count', null
        ))
      ),
      jsonb_build_object(
        'schedule_id', v_schedule_3, 'received_quantity', 3,
        'received_piece_length_mm', null, 'received_piece_count', null,
        'allocations', '[]'::jsonb
      )
    ),
    v_actor,
    null
  ) into v_result;

  if (v_result->>'planned_quantity')::numeric <> 25
    or (v_result->>'received_quantity')::numeric <> 25
    or (v_result->>'allocated_physical_quantity')::numeric <> 22
    or (v_result->>'excess_quantity')::numeric <> 3 then
    raise exception 'Неверные итоги полной пакетной приёмки: %', v_result;
  end if;
  if (select count(*) from public.supply_order_delivery_schedules
      where id in (v_schedule_22, v_schedule_3) and status = 'delivered') <> 2 then
    raise exception 'Технические строки полной партии не закрыты';
  end if;
  if (select allocated_quantity from public.supply_order_delivery_schedules where id = v_schedule_22) <> 22
    or (select excess_quantity from public.supply_order_delivery_schedules where id = v_schedule_3) <> 3 then
    raise exception 'Потребность и излишек распределены неверно';
  end if;
  select id into strict v_inventory
  from public.inventory
  where factory_id = v_factory and material_id = v_material and material_variant_id is null and is_business_scrap = false;
  if (select total_quantity from public.inventory where id = v_inventory) <> 25
    or (select reserved_quantity from public.inventory where id = v_inventory) <> 22 then
    raise exception 'Складской итог 25/22/3 рассчитан неверно';
  end if;
  if (select count(*) from public.inventory_reservations where request_item_id = v_item) <> 1 then
    raise exception 'Полная партия создала неверное число резервов';
  end if;
  if exists (
    select 1 from public.meeting_agenda_pool_items
    where source_key like 'material_receipt_batch_variance:%'
      and machine_id = v_machine
  ) then
    raise exception 'Точная партия создала ложное отклонение по технической строке';
  end if;

  begin
    perform public.fn_receive_supply_order_schedule_batch_v2(
      jsonb_build_array(
        jsonb_build_object('schedule_id', v_schedule_22, 'received_quantity', 22, 'allocations', '[]'::jsonb),
        jsonb_build_object('schedule_id', v_schedule_3, 'received_quantity', 3, 'allocations', '[]'::jsonb)
      ),
      v_actor,
      null
    );
    raise exception 'Повторная пакетная приёмка не была отклонена';
  exception
    when others then
      v_error := sqlerrm;
      if v_error not like '%Поставка уже принята%' then raise; end if;
  end;

  -- If a later technical fragment fails, the earlier fragment and warehouse receipt roll back.
  insert into public.materials(id, name, category, default_supplier_id, created_by)
  values (v_rollback_material, 'RAL rollback test', 'paint', v_supplier, v_actor);
  insert into public.request_paint(
    id, request_id, paint_type, ral_code, finish, weight_kg, waste_percent,
    order_status, ordered_at, material_id, supplier_id, remainder_kg
  ) values (
    v_rollback_item, v_request, 'ral rollback', 'ROLLBACK', 'матовый', 10, 0,
    'ordered', now(), v_rollback_material, v_supplier, 10
  );
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    supplier_id, created_by, updated_by, created_at
  ) values
    (v_rollback_schedule_1, 'request_paint', v_rollback_item, date '2026-09-11', 5, 'кг', v_supplier, v_actor, v_actor, now()),
    (v_rollback_schedule_2, 'request_paint', v_rollback_item, date '2026-09-11', 5, 'кг', v_supplier, v_actor, v_actor, now() + interval '1 second');

  begin
    perform public.fn_receive_supply_order_schedule_batch_v2(
      jsonb_build_array(
        jsonb_build_object(
          'schedule_id', v_rollback_schedule_1, 'received_quantity', 5,
          'allocations', jsonb_build_array(jsonb_build_object(
            'table', 'request_paint', 'id', v_rollback_item,
            'quantity', 5, 'physical_quantity', 5, 'piece_count', null
          ))
        ),
        jsonb_build_object(
          'schedule_id', v_rollback_schedule_2, 'received_quantity', 5,
          'allocations', jsonb_build_array(jsonb_build_object(
            'table', 'request_paint', 'id', v_rollback_item,
            'quantity', 5, 'physical_quantity', 6, 'piece_count', null
          ))
        )
      ),
      v_actor,
      null
    );
    raise exception 'Некорректная вторая часть пакета не была отклонена';
  exception
    when check_violation then
      null;
    when others then
      v_error := sqlerrm;
      if v_error not like '%фактически принятый объем%' then raise; end if;
  end;
  if (select count(*) from public.supply_order_delivery_schedules
      where id in (v_rollback_schedule_1, v_rollback_schedule_2) and status = 'planned') <> 2 then
    raise exception 'Ошибка второй части не откатила статусы всей партии';
  end if;
  if exists (select 1 from public.inventory where factory_id = v_factory and material_id = v_rollback_material) then
    raise exception 'Ошибка второй части не откатила складской приход всей партии';
  end if;
  if exists (select 1 from public.inventory_reservations where request_item_id = v_rollback_item) then
    raise exception 'Ошибка второй части не откатила резервы всей партии';
  end if;

  -- Partial aggregate receipt closes its unreceived technical fragment and escalates once.
  insert into public.materials(id, name, category, default_supplier_id, created_by)
  values (v_shortage_material, 'RAL shortage test', 'paint', v_supplier, v_actor);
  insert into public.request_paint(
    id, request_id, paint_type, ral_code, finish, weight_kg, waste_percent,
    order_status, ordered_at, material_id, supplier_id, remainder_kg
  ) values (
    v_shortage_item, v_request, 'ral shortage', 'SHORT', 'матовый', 22, 0,
    'ordered', now(), v_shortage_material, v_supplier, 22
  );
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    supplier_id, created_by, updated_by, created_at
  ) values
    (v_shortage_schedule_22, 'request_paint', v_shortage_item, date '2026-09-12', 22, 'кг', v_supplier, v_actor, v_actor, now()),
    (v_shortage_schedule_3, 'request_paint', v_shortage_item, date '2026-09-12', 3, 'кг', v_supplier, v_actor, v_actor, now() + interval '1 second');

  perform public.fn_receive_supply_order_schedule_batch_v2(
    jsonb_build_array(
      jsonb_build_object(
        'schedule_id', v_shortage_schedule_22, 'received_quantity', 20,
        'allocations', jsonb_build_array(jsonb_build_object(
          'table', 'request_paint', 'id', v_shortage_item,
          'quantity', 20, 'physical_quantity', 20, 'piece_count', null
        ))
      ),
      jsonb_build_object(
        'schedule_id', v_shortage_schedule_3, 'received_quantity', 0,
        'allocations', '[]'::jsonb
      )
    ),
    v_actor,
    null
  );
  if (select status from public.supply_order_delivery_schedules where id = v_shortage_schedule_22) <> 'delivered'
    or (select status from public.supply_order_delivery_schedules where id = v_shortage_schedule_3) <> 'cancelled'
    or (select order_status from public.request_paint where id = v_shortage_item) <> 'ordered' then
    raise exception 'Частичная пакетная приёмка неверно закрыла график или потребность';
  end if;
  if (select count(*) from public.meeting_agenda_pool_items
      where source_key like 'material_receipt_batch_variance:%' and machine_id = v_machine) <> 1 then
    raise exception 'Частичная партия должна создать одно агрегированное отклонение';
  end if;
  if not exists (
      select 1 from public.tasks
      where supply_order_schedule_id = v_shortage_schedule_22
        and task_type = 'supply_material_receipt_shortage'
    ) or exists (
      select 1 from public.tasks
      where supply_order_schedule_id = v_shortage_schedule_3
        and task_type = 'supply_material_receipt_shortage'
    ) then
    raise exception 'Частичная партия должна привязать задачи по недовесу только к одной опорной строке: anchor %, fragment %',
      (select count(*) from public.tasks where supply_order_schedule_id = v_shortage_schedule_22 and task_type = 'supply_material_receipt_shortage'),
      (select count(*) from public.tasks where supply_order_schedule_id = v_shortage_schedule_3 and task_type = 'supply_material_receipt_shortage');
  end if;
end;
$$;

rollback;
