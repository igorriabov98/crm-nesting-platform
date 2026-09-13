do $$
declare
  v_value integer;
begin
  select count(*) into v_value
  from public.future_detailing_batches
  where id = '10000000-0000-0000-0000-000000000009'
    and status = 'confirmed'
    and confirmation_due_date is null
    and confirmed_at is not null;
  if v_value <> 1 then raise exception 'existing batch was not backfilled'; end if;

  select coalesce(sum(on_hand_quantity), 0) into v_value
  from public.detailing_balances;
  if v_value <> 5 then raise exception 'backfill expected 5 pieces, got %', v_value; end if;

  select count(*) into v_value
  from public.future_detailing_items
  where batch_id = '10000000-0000-0000-0000-000000000009'
    and status = 'confirmed'
    and actual_quantity = planned_quantity;
  if v_value <> 2 then raise exception 'backfill did not confirm every item'; end if;

  if not exists (
    select 1 from public.tasks
    where id = '10000000-0000-0000-0000-000000000004'
      and status = 'completed'
      and completed_at is not null
  ) then raise exception 'legacy confirmation task was not completed'; end if;

  if not exists (
    select 1 from public.future_detailing_batches
    where id = '10000000-0000-0000-0000-000000000013'
      and status = 'planned'
      and first_cutting_event_id is null
  ) then raise exception 'newer plan was incorrectly promoted by an older event'; end if;

  insert into public.future_detailing_batches(
    id, request_id, machine_id, factory_id, created_by, status
  ) values (
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'planned'
  );
  insert into public.future_detailing_items(
    id, batch_id, part_id, planned_quantity, status
  ) values (
    '20000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000005',
    4,
    'planned'
  );
  insert into public.production_machine_facts values ('20000000-0000-0000-0000-000000000004');
  insert into public.production_fact_cutting_events(
    id, machine_id, fact_id, fact_date, created_by
  ) values (
    '20000000-0000-0000-0000-000000000005',
    '10000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000004',
    '2026-09-13',
    '10000000-0000-0000-0000-000000000002'
  );

  select on_hand_quantity into v_value
  from public.detailing_balances
  where part_id = '10000000-0000-0000-0000-000000000005';
  if v_value <> 6 then raise exception 'first fact expected cumulative 6 pieces, got %', v_value; end if;

  select on_hand_quantity into v_value
  from public.detailing_balances
  where part_id = '10000000-0000-0000-0000-000000000006';
  if v_value <> 10 then raise exception 'next fact did not promote waiting plan, got %', v_value; end if;

  insert into public.production_machine_facts values ('20000000-0000-0000-0000-000000000006');
  insert into public.production_fact_cutting_events(
    id, machine_id, fact_id, fact_date, created_by
  ) values (
    '20000000-0000-0000-0000-000000000007',
    '10000000-0000-0000-0000-000000000003',
    '20000000-0000-0000-0000-000000000006',
    '2026-09-14',
    '10000000-0000-0000-0000-000000000002'
  );

  select on_hand_quantity into v_value
  from public.detailing_balances
  where part_id = '10000000-0000-0000-0000-000000000005';
  if v_value <> 6 then raise exception 'repeat fact duplicated pieces, got %', v_value; end if;

  select count(*) into v_value from public.detailing_movements;
  if v_value <> 4 then raise exception 'expected one movement per promoted item, got %', v_value; end if;

  if has_function_privilege(
    'authenticated',
    'public.fn_promote_future_detailing_batch_on_cutting_event_v1(uuid,uuid,uuid)',
    'execute'
  ) then raise exception 'authenticated must not call the internal promotion function'; end if;
end;
$$;
