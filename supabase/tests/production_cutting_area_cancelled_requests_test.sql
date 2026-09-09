begin;

do $$
declare
  v_factory uuid;
  v_actor constant uuid := '99000000-0000-4000-8000-000000000001';
  v_parent constant uuid := '99000000-0000-4000-8000-000000000002';
  v_section constant uuid := '99000000-0000-4000-8000-000000000003';
  v_machine constant uuid := '99000000-0000-4000-8000-000000000004';
  v_active_request constant uuid := '99000000-0000-4000-8000-000000000005';
  v_cancelled_request constant uuid := '99000000-0000-4000-8000-000000000006';
  v_completion constant uuid := '99000000-0000-4000-8000-000000000007';
  v_cycle uuid;
begin
  select id into strict v_factory from public.factories order by created_at, id limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'cutting-cancelled-request@example.test', 'Cutting cancelled request', 'production_manager', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by, is_confirmed)
  values (v_machine, v_factory, 'CUTTING-CANCELLED-REQUEST', v_actor, true);
  insert into public.production_stages(machine_id, stage_type, workshop, date_start, is_skipped, updated_by)
  values (v_machine, 'cutting', 1, current_date, false, v_actor)
  on conflict (machine_id, stage_type) do update
  set workshop = excluded.workshop,
      date_start = excluded.date_start,
      is_skipped = excluded.is_skipped,
      updated_by = excluded.updated_by;
  insert into public.production_fact_sections(id, factory_id, name, production_stage_type, created_by, updated_by)
  values (v_parent, v_factory, 'Заготовка cancelled request', 'cutting', v_actor, v_actor);
  insert into public.production_fact_sections(id, factory_id, parent_id, name, production_stage_type, created_by, updated_by)
  values (v_section, v_factory, v_parent, 'Участок cancelled request', 'cutting', v_actor, v_actor);

  insert into public.technologist_requests(id, machine_id, created_by, status, created_at)
  values (v_active_request, v_machine, v_actor, 'completed', now() - interval '2 days');
  insert into public.technologist_request_completions(
    id, request_id, machine_id, factory_id, created_by, future_detailing_decision,
    entered_plasma_minutes, added_plasma_minutes, actual_plasma_minutes, state
  ) values (
    v_completion, v_active_request, v_machine, v_factory, v_actor, 'none',
    0, 0, 0, 'finalized'
  );
  insert into public.technologist_requests(id, machine_id, created_by, status, created_at)
  values (v_cancelled_request, v_machine, v_actor, 'cancelled', now() - interval '1 day');

  v_cycle := public.fn_start_production_cutting_cycle(
    v_machine, v_factory, v_section, current_date, 'day', array[v_active_request], v_actor
  );

  if (select count(*) from public.production_cutting_cycle_requests where cycle_id = v_cycle) <> 1 then
    raise exception 'Цикл должен содержать только одну активную заявку';
  end if;
  if not exists (
    select 1 from public.production_cutting_cycle_requests
    where cycle_id = v_cycle and request_id = v_active_request and completion_id = v_completion
  ) then
    raise exception 'Завершённая активная заявка не попала в цикл';
  end if;
  if exists (
    select 1 from public.production_cutting_cycle_requests
    where cycle_id = v_cycle and request_id = v_cancelled_request
  ) then
    raise exception 'Отменённая заявка попала в цикл';
  end if;
end;
$$;

rollback;
