-- Request-scoped cutting programs and the production cutting-area queue.
-- Direct table access stays closed; mutations are exposed only to service_role
-- after application-level production_cutting_area authorization.

create table public.production_cutting_cycles (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete restrict,
  factory_id uuid not null references public.factories(id) on delete restrict,
  fact_id uuid references public.production_machine_facts(id) on delete set null,
  cutting_event_id uuid references public.production_fact_cutting_events(id) on delete set null,
  cycle_number integer not null check (cycle_number > 0),
  planned_start_date date not null,
  fact_date date not null,
  shift public.production_fact_shift not null,
  section_id uuid not null references public.production_fact_sections(id) on delete restrict,
  status text not null default 'in_progress' check (status in ('in_progress','completed','cancelled')),
  source text not null default 'cutting_area' check (source in ('cutting_area','historical_backfill')),
  started_by uuid not null references public.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_by uuid references public.users(id) on delete restrict,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (machine_id, cycle_number),
  check ((status = 'completed') = (completed_at is not null))
);

create unique index production_cutting_cycles_active_machine_idx
  on public.production_cutting_cycles(machine_id)
  where status = 'in_progress';
create index production_cutting_cycles_queue_idx
  on public.production_cutting_cycles(status, planned_start_date, machine_id);
create index production_cutting_cycles_fact_idx
  on public.production_cutting_cycles(fact_id) where fact_id is not null;
create index production_cutting_cycles_event_idx
  on public.production_cutting_cycles(cutting_event_id) where cutting_event_id is not null;

create table public.production_cutting_cycle_requests (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.production_cutting_cycles(id) on delete restrict,
  request_id uuid not null references public.technologist_requests(id) on delete restrict,
  completion_id uuid not null references public.technologist_request_completions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (cycle_id, request_id),
  unique (cycle_id, completion_id)
);

create index production_cutting_cycle_requests_request_idx
  on public.production_cutting_cycle_requests(request_id, created_at desc);

create table public.production_cutting_cycle_events (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.production_cutting_cycles(id) on delete restrict,
  event_type text not null check (event_type in ('started','completed','reopened','cancelled')),
  actor_id uuid not null references public.users(id) on delete restrict,
  reason text,
  created_at timestamptz not null default now(),
  check (event_type <> 'reopened' or btrim(coalesce(reason, '')) <> '')
);

create index production_cutting_cycle_events_cycle_idx
  on public.production_cutting_cycle_events(cycle_id, created_at desc);

alter table public.production_cutting_cycles enable row level security;
alter table public.production_cutting_cycle_requests enable row level security;
alter table public.production_cutting_cycle_events enable row level security;
revoke all on table public.production_cutting_cycles, public.production_cutting_cycle_requests,
  public.production_cutting_cycle_events from public, anon, authenticated;
grant all on table public.production_cutting_cycles, public.production_cutting_cycle_requests,
  public.production_cutting_cycle_events to service_role;

create or replace function public.production_cutting_immutable_history_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'Production cutting history is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.production_cutting_immutable_history_guard() from public, anon, authenticated;
create trigger production_cutting_cycle_requests_immutable
  before update or delete on public.production_cutting_cycle_requests
  for each row execute function public.production_cutting_immutable_history_guard();
create trigger production_cutting_cycle_events_immutable
  before update or delete on public.production_cutting_cycle_events
  for each row execute function public.production_cutting_immutable_history_guard();

create or replace function public.production_cutting_cycle_request_insert_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_machine_id uuid; v_completion record;
begin
  select machine_id into v_machine_id from public.production_cutting_cycles where id = new.cycle_id;
  select request_id, machine_id, state into v_completion
    from public.technologist_request_completions where id = new.completion_id;
  if v_machine_id is null or v_completion.state is distinct from 'finalized'
     or v_completion.request_id is distinct from new.request_id
     or v_completion.machine_id is distinct from v_machine_id then
    raise exception 'Заявка не соответствует циклу Заготовки';
  end if;
  if exists (
    select 1 from public.production_cutting_cycle_requests snapshot
    join public.production_cutting_cycles cycle on cycle.id = snapshot.cycle_id
    where snapshot.request_id = new.request_id and cycle.status <> 'cancelled'
  ) then raise exception 'Заявка уже зафиксирована в другом цикле'; end if;
  return new;
end;
$$;
revoke all on function public.production_cutting_cycle_request_insert_guard() from public, anon, authenticated;
create trigger production_cutting_cycle_request_insert_validation
  before insert on public.production_cutting_cycle_requests
  for each row execute function public.production_cutting_cycle_request_insert_guard();

-- Finalize the technologist request and register every staged object in the
-- same transaction. A raised exception rolls back both the completion and all
-- archive rows; the application then removes only still-unregistered objects.
create or replace function public.fn_finalize_technologist_request_with_archives(
  p_request_id uuid,
  p_actor uuid,
  p_decision text,
  p_entered_plasma_minutes integer,
  p_waste_items jsonb,
  p_future_items jsonb,
  p_archives jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_request public.technologist_requests%rowtype;
  v_completion_id uuid;
  v_archive jsonb;
  v_storage storage.objects%rowtype;
  v_path_prefix text;
  v_file_size bigint;
  v_file_name text;
  v_object_path text;
  v_mime_type text;
begin
  if p_actor is null or p_actor <> auth.uid() then raise exception 'Недостаточно прав'; end if;
  if jsonb_typeof(coalesce(p_archives, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_archives, '[]'::jsonb)) > 20 then
    raise exception 'Можно прикрепить не более 20 архивов';
  end if;

  select * into v_request from public.technologist_requests where id = p_request_id for update;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  v_path_prefix := 'machine-cutting/' || v_request.machine_id || '/' || p_request_id || '/';

  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    v_file_name := btrim(coalesce(v_archive->>'fileName', ''));
    v_object_path := coalesce(v_archive->>'objectPath', '');
    v_mime_type := nullif(v_archive->>'mimeType', '');
    v_file_size := coalesce((v_archive->>'fileSize')::bigint, 0);
    if v_archive->>'requestId' is distinct from p_request_id::text
       or nullif(v_archive->>'completionId', '') is not null
       or v_file_name = '' or char_length(v_file_name) > 240
       or v_file_size <= 0 or v_file_size > 524288000
       or lower(v_file_name) !~ '\.(zip|rar|7z)$'
       or v_object_path not like v_path_prefix || '%'
       or v_object_path like '%..%'
       or lower(v_object_path) !~ '/[0-9]+-[0-9a-f-]{36}\.(zip|rar|7z)$' then
      raise exception 'Некорректный архив порезки';
    end if;
    select * into v_storage from storage.objects
      where bucket_id = 'nesting-files' and name = v_object_path;
    if not found then raise exception 'Загруженный архив не найден в хранилище'; end if;
    if coalesce((v_storage.metadata->>'size')::bigint, -1) <> v_file_size then
      raise exception 'Размер загруженного архива не совпадает с заявленным';
    end if;
  end loop;

  v_completion_id := public.fn_finalize_technologist_request(
    p_request_id, p_actor, p_decision, p_entered_plasma_minutes, p_waste_items, p_future_items
  );

  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    v_object_path := v_archive->>'objectPath';
    select * into v_storage from storage.objects
      where bucket_id = 'nesting-files' and name = v_object_path;
    insert into public.machine_cutting_archives (
      machine_id, request_id, completion_id, file_name, storage_path,
      mime_type, file_size, uploaded_by
    ) values (
      v_request.machine_id, p_request_id, v_completion_id, btrim(v_archive->>'fileName'), v_object_path,
      coalesce(nullif(v_storage.metadata->>'mimetype', ''), nullif(v_archive->>'mimeType', '')),
      (v_storage.metadata->>'size')::bigint, p_actor
    );
  end loop;
  return v_completion_id;
end;
$$;
revoke all on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb)
  from public, anon;
grant execute on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb)
  to authenticated;

create or replace function public.fn_start_production_cutting_cycle(
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

create or replace function public.fn_complete_production_cutting_cycle(p_cycle_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.production_cutting_cycles set status = 'completed', completed_by = p_actor,
    completed_at = now(), updated_at = now()
  where id = p_cycle_id and status = 'in_progress';
  if not found then raise exception 'Активный цикл не найден'; end if;
  insert into public.production_cutting_cycle_events(cycle_id, event_type, actor_id)
  values (p_cycle_id, 'completed', p_actor);
end;
$$;

create or replace function public.fn_reopen_production_cutting_cycle(p_cycle_id uuid, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_machine_id uuid;
  v_cycle_number integer;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Укажите причину возврата'; end if;
  select machine_id, cycle_number into v_machine_id, v_cycle_number from public.production_cutting_cycles
    where id = p_cycle_id and status = 'completed' for update;
  if not found then raise exception 'Завершенный цикл не найден'; end if;
  if exists(select 1 from public.production_cutting_cycles where machine_id = v_machine_id and id <> p_cycle_id and status = 'in_progress') then
    raise exception 'У машины уже есть новый активный цикл';
  end if;
  if exists(select 1 from public.production_cutting_cycles where machine_id = v_machine_id and cycle_number > v_cycle_number and status <> 'cancelled') then
    raise exception 'Вернуть можно только последний цикл машины';
  end if;
  update public.production_cutting_cycles set status = 'in_progress', completed_by = null,
    completed_at = null, updated_at = now() where id = p_cycle_id;
  insert into public.production_cutting_cycle_events(cycle_id, event_type, actor_id, reason)
  values (p_cycle_id, 'reopened', p_actor, btrim(p_reason));
end;
$$;

revoke all on function public.fn_start_production_cutting_cycle(uuid,uuid,uuid,date,public.production_fact_shift,uuid[],uuid),
  public.fn_complete_production_cutting_cycle(uuid,uuid),
  public.fn_reopen_production_cutting_cycle(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.fn_start_production_cutting_cycle(uuid,uuid,uuid,date,public.production_fact_shift,uuid[],uuid),
  public.fn_complete_production_cutting_cycle(uuid,uuid),
  public.fn_reopen_production_cutting_cycle(uuid,text,uuid) to service_role;

-- A confirmed inventory rollback cancels the linked cycle. Keeping the
-- inventory effect does not change the operational cycle.
create or replace function public.production_cutting_cancel_on_fact_rollback()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cycle_id uuid; v_actor uuid;
begin
  if old.status is distinct from 'rolled_back' and new.status = 'rolled_back' then
    select id into v_cycle_id from public.production_cutting_cycles
      where (cutting_event_id = new.id or (new.fact_id is not null and fact_id = new.fact_id))
        and status <> 'cancelled' for update;
    if v_cycle_id is not null then
      v_actor := coalesce(new.rolled_back_by, new.created_by);
      update public.production_cutting_cycles set status = 'cancelled', completed_by = null,
        completed_at = null, cancelled_at = now(), updated_at = now() where id = v_cycle_id;
      insert into public.production_cutting_cycle_events(cycle_id, event_type, actor_id, reason)
      values (v_cycle_id, 'cancelled', v_actor, 'Отменён связанный факт Заготовки');
    end if;
  end if;
  return new;
end;
$$;
create trigger production_cutting_cancel_after_fact_rollback
after update of status on public.production_fact_cutting_events
for each row execute function public.production_cutting_cancel_on_fact_rollback();

-- Historical state: one cycle for the latest non-rolled-back cutting fact of
-- each machine. Only requests finalized by that fact are frozen into it.
with latest as (
  select distinct on (event.machine_id)
    event.id as event_id, event.machine_id, event.factory_id, event.fact_id, event.fact_date,
    fact.shift, fact.section_id, event.created_at, coalesce(event.created_by, fact.created_by) as actor_id,
    stage.date_start as planned_start_date, machine.status::text as machine_status
  from public.production_fact_cutting_events event
  join public.production_machine_facts fact on fact.id = event.fact_id
  join public.machines machine on machine.id = event.machine_id
  left join public.production_stages stage on stage.id = event.stage_id
  where event.status in ('applied','kept')
  order by event.machine_id, event.created_at desc, event.id desc
), inserted as (
  insert into public.production_cutting_cycles (
    machine_id, factory_id, fact_id, cutting_event_id, cycle_number, planned_start_date, fact_date, shift,
    section_id, status, source, started_by, started_at, completed_by, completed_at
  )
  select machine_id, factory_id, fact_id, event_id, 1, coalesce(planned_start_date, fact_date), fact_date, shift,
    section_id, case when machine_status = 'shipped' then 'completed' else 'in_progress' end,
    'historical_backfill', actor_id, created_at,
    case when machine_status = 'shipped' then actor_id else null end,
    case when machine_status = 'shipped' then created_at else null end
  from latest where actor_id is not null
  on conflict do nothing returning id, machine_id, started_at, started_by, status
)
insert into public.production_cutting_cycle_requests(cycle_id, request_id, completion_id)
select inserted.id, completion.request_id, completion.id
from inserted join public.technologist_request_completions completion
  on completion.machine_id = inserted.machine_id and completion.state = 'finalized'
  and completion.finalized_at <= inserted.started_at
on conflict do nothing;

insert into public.production_cutting_cycle_events(cycle_id, event_type, actor_id, created_at)
select cycle.id, 'started', cycle.started_by, cycle.started_at
from public.production_cutting_cycles cycle
where cycle.source = 'historical_backfill'
  and not exists(select 1 from public.production_cutting_cycle_events event where event.cycle_id = cycle.id);

insert into public.production_cutting_cycle_events(cycle_id, event_type, actor_id, created_at)
select cycle.id, 'completed', coalesce(cycle.completed_by, cycle.started_by), cycle.completed_at
from public.production_cutting_cycles cycle
where cycle.source = 'historical_backfill' and cycle.status = 'completed'
  and not exists(select 1 from public.production_cutting_cycle_events event where event.cycle_id = cycle.id and event.event_type = 'completed');

-- Preserve the exact current production_fact matrix independently.
insert into public.role_permissions(role, resource_key, can_view, can_manage)
select role, 'production_cutting_area', can_view, can_manage
from public.role_permissions where resource_key = 'production_fact'
on conflict (role, resource_key) do nothing;

with scopes as (
  select department.id as department_id, scope.subject_scope
  from public.departments department
  cross join (values ('head'::text), ('member'::text)) as scope(subject_scope)
), source_access as (
  select department_id, subject_scope, can_view, can_manage
  from public.department_access_permissions where resource_key = 'production_fact'
)
insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage)
select scopes.department_id, scopes.subject_scope, 'production_cutting_area',
  coalesce(source_access.can_view, false), coalesce(source_access.can_manage, false)
from scopes left join source_access using (department_id, subject_scope)
on conflict (department_id, subject_scope, resource_key) do nothing;
