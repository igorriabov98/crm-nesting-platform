\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_mismatch_schedule uuid := gen_random_uuid();
  v_matching_schedule uuid := gen_random_uuid();
  v_missing_fact_schedule uuid := gen_random_uuid();
  v_invalid_schedule uuid := gen_random_uuid();
  v_discrepancy public.supply_order_delivery_length_discrepancies%rowtype;
  v_schedule public.supply_order_delivery_schedules%rowtype;
  v_error text;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then
    raise exception 'Для теста не найден завод из полно-схемной миграции';
  end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    'supply-receiving-plan-fact@example.test',
    'Тест приёмки плана и факта',
    'supply_manager',
    v_factory,
    true
  );

  if (
    select constraint_record.convalidated
    from pg_constraint as constraint_record
    where constraint_record.conrelid = 'public.supply_order_delivery_schedules'::regclass
      and constraint_record.conname = 'supply_order_delivery_schedules_piece_values_check'
  ) is distinct from false then
    raise exception 'Усиленный constraint должен сохранять legacy-строки как NOT VALID';
  end if;

  begin
    insert into public.supply_order_delivery_schedules (
      id, request_item_table, request_item_id, delivery_date, quantity, unit,
      status, received_quantity, received_piece_length_mm, received_piece_count,
      delivered_at, received_by, updated_by
    ) values (
      v_invalid_schedule, 'request_circle', gen_random_uuid(), current_date, 6000, 'мм',
      'delivered', 6000, 6000, null, now(), v_actor, v_actor
    );
    raise exception 'Новая строка с неполным физическим составом прошла constraint';
  exception
    when check_violation then
      null;
  end;

  insert into public.supply_order_delivery_schedules (
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    planned_piece_length_mm, planned_piece_count
  ) values (
    v_mismatch_schedule, 'request_circle', gen_random_uuid(), current_date, 12000, 'мм',
    6000, 2
  );

  update public.supply_order_delivery_schedules
  set status = 'delivered',
      received_quantity = 16000,
      received_piece_length_mm = 8000,
      received_piece_count = 2,
      delivered_at = now(),
      received_by = v_actor,
      updated_by = v_actor
  where id = v_mismatch_schedule;

  set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;

  select * into strict v_schedule
  from public.supply_order_delivery_schedules
  where id = v_mismatch_schedule;

  if v_schedule.planned_piece_length_mm <> 6000
    or v_schedule.planned_piece_count <> 2
    or v_schedule.received_piece_length_mm <> 8000
    or v_schedule.received_piece_count <> 2 then
    raise exception 'Приёмка затёрла плановые поля или не сохранила фактические';
  end if;

  select * into strict v_discrepancy
  from public.supply_order_delivery_length_discrepancies
  where schedule_id = v_mismatch_schedule;

  if v_discrepancy.planned_piece_length_mm <> 6000
    or v_discrepancy.received_piece_length_mm <> 8000
    or v_discrepancy.received_by is distinct from v_actor
    or v_discrepancy.received_at is null then
    raise exception 'Запись расхождения не сохранила план, факт, кладовщика и время';
  end if;

  begin
    update public.supply_order_delivery_length_discrepancies
    set received_piece_length_mm = 7000
    where schedule_id = v_mismatch_schedule;
    raise exception 'Неизменяемую запись расхождения удалось обновить';
  exception
    when others then
      if sqlerrm not like '%Расхождение длины при приёмке неизменяемо%' then
        raise;
      end if;
  end;

  begin
    update public.supply_order_delivery_schedules
    set planned_piece_length_mm = 7000
    where id = v_mismatch_schedule;
    raise exception 'Плановую длину удалось изменить после приёмки';
  exception
    when others then
      if sqlerrm not like '%Плановые длина и количество хлыстов после приёмки неизменяемы%' then
        raise;
      end if;
  end;

  set constraints supply_order_delivery_piece_fact_constraint_trigger deferred;

  insert into public.supply_order_delivery_schedules (
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    planned_piece_length_mm, planned_piece_count
  ) values (
    v_matching_schedule, 'request_circle', gen_random_uuid(), current_date, 12000, 'мм',
    6000, 2
  );

  update public.supply_order_delivery_schedules
  set status = 'delivered',
      received_quantity = 12000,
      received_piece_length_mm = 6000,
      received_piece_count = 2,
      delivered_at = now(),
      received_by = v_actor,
      updated_by = v_actor
  where id = v_matching_schedule;

  set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;

  if exists (
    select 1
    from public.supply_order_delivery_length_discrepancies
    where schedule_id = v_matching_schedule
  ) then
    raise exception 'Совпадающая длина создала лишнюю запись расхождения';
  end if;

  set constraints supply_order_delivery_piece_fact_constraint_trigger deferred;

  insert into public.supply_order_delivery_schedules (
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    planned_piece_length_mm, planned_piece_count
  ) values (
    v_missing_fact_schedule, 'request_circle', gen_random_uuid(), current_date, 12000, 'мм',
    6000, 2
  );

  begin
    update public.supply_order_delivery_schedules
    set status = 'delivered',
        delivered_at = now(),
        received_by = v_actor,
        updated_by = v_actor
    where id = v_missing_fact_schedule;
    set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;
    raise exception 'Приёмка без фактических длины и количества прошла проверку';
  exception
    when others then
      v_error := sqlerrm;
      if v_error not like '%Приёмка хлыстов требует фактические длину и количество%' then
        raise;
      end if;
  end;

  if to_regprocedure('public.fn_receive_supply_order_schedule(uuid,uuid)') is not null
    or to_regprocedure('public.fn_receive_supply_order_schedule(uuid,uuid,numeric)') is not null then
    raise exception 'Старая RPC приёмки всё ещё доступна';
  end if;
end;
$$;

rollback;
