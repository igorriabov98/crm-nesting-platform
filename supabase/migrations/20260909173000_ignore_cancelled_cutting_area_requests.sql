-- Cancelled technologist requests are immutable history and must not block a
-- new production cutting cycle. The public wrapper keeps the machine/plan
-- serialization locks; this replaces only its original transactional body.
create or replace function public.fn_start_production_cutting_cycle_before_race_serialization(
  p_machine_id uuid,
  p_factory_id uuid,
  p_section_id uuid,
  p_fact_date date,
  p_shift public.production_fact_shift,
  p_request_ids uuid[],
  p_actor uuid
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_machine public.machines%rowtype;
  v_stage public.production_stages%rowtype;
  v_effective_stage public.stage_type;
  v_expected_request_ids uuid[];
  v_fact_id uuid;
  v_cutting_event_id uuid;
  v_cycle_id uuid;
  v_cycle_number integer;
begin
  if p_actor is null or not exists(select 1 from public.users where id = p_actor and is_active) then
    raise exception 'Пользователь недоступен';
  end if;
  if p_fact_date is null or p_fact_date <> (now() at time zone 'Europe/Kyiv')::date then
    raise exception 'Фактическая дата старта должна быть сегодняшней';
  end if;
  select * into v_machine from public.machines where id = p_machine_id for update;
  if not found or v_machine.factory_id is distinct from p_factory_id then raise exception 'Машина не найдена'; end if;
  if coalesce(v_machine.is_archived, false) or not coalesce(v_machine.is_confirmed, false) then
    raise exception 'В работу можно взять только подтвержденную неархивную машину';
  end if;
  select * into v_stage from public.production_stages
    where machine_id = p_machine_id and stage_type = 'cutting'::public.stage_type
    order by created_at limit 1 for update;
  if not found or coalesce(v_stage.is_skipped, false) or v_stage.date_start is null then
    raise exception 'Для Заготовки должна быть указана плановая дата';
  end if;
  if exists(select 1 from public.production_cutting_cycles where machine_id = p_machine_id and status = 'in_progress') then
    raise exception 'Машина уже находится в работе';
  end if;

  select coalesce(array_agg(request.id order by request.created_at, request.id), array[]::uuid[])
  into v_expected_request_ids
  from public.technologist_requests request
  where request.machine_id = p_machine_id
    and request.status <> 'cancelled'::public.request_status
    and not exists (
      select 1 from public.production_cutting_cycle_requests snapshot
      join public.production_cutting_cycles cycle on cycle.id = snapshot.cycle_id
      where snapshot.request_id = request.id and cycle.status <> 'cancelled'
    );
  if coalesce(array_length(v_expected_request_ids, 1), 0) = 0 then raise exception 'Нет новых заявок для цикла'; end if;
  if v_expected_request_ids is distinct from coalesce(p_request_ids, array[]::uuid[]) then
    raise exception 'Состав заявок изменился. Обновите очередь';
  end if;
  if exists (
    select 1 from unnest(v_expected_request_ids) request_id
    where not exists (
      select 1 from public.technologist_request_completions completion
      where completion.request_id = request_id and completion.state = 'finalized'
    )
  ) then raise exception 'Сначала завершите все заявки технолога'; end if;

  select coalesce(section.production_stage_type, parent.production_stage_type)
    into v_effective_stage
  from public.production_fact_sections section
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where section.id = p_section_id and section.factory_id = p_factory_id
    and section.is_active and section.archived_at is null and section.parent_id is not null
    and parent.is_active and parent.archived_at is null;
  if v_effective_stage is distinct from 'cutting'::public.stage_type then
    raise exception 'Выберите активный участок Заготовки';
  end if;

  insert into public.production_machine_facts (
    factory_id, fact_date, shift, machine_id, section_id, comment, created_by, updated_by
  ) values (
    p_factory_id, p_fact_date, p_shift, p_machine_id, p_section_id,
    'Создано со страницы «Участок заготовки»', p_actor, p_actor
  ) on conflict (factory_id, fact_date, shift, machine_id, section_id)
  do update set updated_by = excluded.updated_by, updated_at = now()
  returning id into v_fact_id;

  if exists(select 1 from public.production_cutting_cycles where fact_id = v_fact_id) then
    raise exception 'Производственный факт уже связан с циклом';
  end if;
  v_cutting_event_id := public.fn_apply_production_fact_cutting(v_fact_id, p_actor);
  if v_cutting_event_id is null then raise exception 'Не удалось применить факт Заготовки'; end if;
  if not exists(select 1 from public.production_fact_cutting_events where id = v_cutting_event_id and status = 'applied') then
    raise exception 'Складские последствия факта Заготовки не применены';
  end if;

  select coalesce(max(cycle_number), 0) + 1 into v_cycle_number
  from public.production_cutting_cycles where machine_id = p_machine_id;
  insert into public.production_cutting_cycles (
    machine_id, factory_id, fact_id, cutting_event_id, cycle_number, planned_start_date, fact_date,
    shift, section_id, started_by
  ) values (
    p_machine_id, p_factory_id, v_fact_id, v_cutting_event_id, v_cycle_number, v_stage.date_start, p_fact_date,
    p_shift, p_section_id, p_actor
  ) returning id into v_cycle_id;

  insert into public.production_cutting_cycle_requests(cycle_id, request_id, completion_id)
  select v_cycle_id, completion.request_id, completion.id
  from public.technologist_request_completions completion
  where completion.request_id = any(v_expected_request_ids) and completion.state = 'finalized';
  insert into public.production_cutting_cycle_events(cycle_id, event_type, actor_id)
  values (v_cycle_id, 'started', p_actor);
  return v_cycle_id;
end;
$$;

revoke all on function public.fn_start_production_cutting_cycle_before_race_serialization(
  uuid, uuid, uuid, date, public.production_fact_shift, uuid[], uuid
) from public, anon, authenticated, service_role;
