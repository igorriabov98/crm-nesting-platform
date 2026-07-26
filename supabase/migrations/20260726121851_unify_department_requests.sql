alter table public.department_requests
  add column if not exists machine_id uuid references public.machines(id) on delete set null,
  add column if not exists completed_by uuid references public.users(id) on delete set null;

alter table public.department_requests
  drop constraint if exists department_requests_response_length;

alter table public.department_requests
  add constraint department_requests_response_length
  check (response is null or char_length(response) <= 5000);

alter table public.department_requests
  add column if not exists search_document tsvector
  generated always as (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(response, '')
    )
  ) stored;

create table if not exists public.department_request_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.department_requests(id) on delete cascade,
  phase text not null,
  uploaded_by uuid not null references public.users(id) on delete restrict,
  file_name text not null,
  mime_type text,
  file_size bigint not null,
  storage_path text not null unique,
  created_at timestamptz not null default now(),

  constraint department_request_attachments_phase_check
    check (phase in ('source', 'resolution')),
  constraint department_request_attachments_name_length
    check (char_length(btrim(file_name)) between 1 and 240),
  constraint department_request_attachments_size_check
    check (file_size > 0 and file_size <= 26214400),
  constraint department_request_attachments_path_check
    check (
      storage_path like 'department-requests/%'
      and storage_path not like '%..%'
    )
);

create table if not exists public.department_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.department_requests(id) on delete cascade,
  event_type text not null,
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint department_request_events_type_check
    check (event_type in ('created', 'claimed', 'completed', 'rejected', 'cancelled'))
);

create index if not exists department_requests_author_status_created_idx
  on public.department_requests (created_by, status, created_at desc);

create index if not exists department_requests_target_assignee_status_idx
  on public.department_requests (target_department, assigned_to, status, created_at desc);

create index if not exists department_requests_machine_idx
  on public.department_requests (machine_id, created_at desc)
  where machine_id is not null;

create index if not exists department_requests_due_date_idx
  on public.department_requests (due_date, status)
  where due_date is not null;

create index if not exists department_requests_search_idx
  on public.department_requests using gin (search_document);

create index if not exists department_request_attachments_request_phase_idx
  on public.department_request_attachments (request_id, phase, created_at);

create index if not exists department_request_events_request_created_idx
  on public.department_request_events (request_id, created_at);

alter table public.department_request_attachments enable row level security;
alter table public.department_request_events enable row level security;

grant select on public.department_request_attachments to authenticated;
grant select, insert, update, delete on public.department_request_attachments to service_role;
grant select on public.department_request_events to authenticated;
grant select, insert, update, delete on public.department_request_events to service_role;

drop policy if exists "department_request_attachments_select"
  on public.department_request_attachments;

create policy "department_request_attachments_select"
  on public.department_request_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.department_requests request
      where request.id = request_id
        and (
          request.created_by = (select auth.uid())
          or public.can_manage_department_request_target(
            request.target_department,
            request.factory_id
          )
        )
    )
  );

drop policy if exists "department_request_events_select"
  on public.department_request_events;

create policy "department_request_events_select"
  on public.department_request_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.department_requests request
      where request.id = request_id
        and (
          request.created_by = (select auth.uid())
          or public.can_manage_department_request_target(
            request.target_department,
            request.factory_id
          )
        )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('department-request-files', 'department-request-files', false, 26214400)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "department_requests_insert"
  on public.department_requests;
drop policy if exists "department_requests_recipient_update"
  on public.department_requests;

revoke insert, update on public.department_requests from authenticated;

create or replace function public.validate_department_request_attachments(
  p_request_id uuid,
  p_user_id uuid,
  p_phase text,
  p_attachments jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  attachment jsonb;
  attachment_count integer;
  object_path text;
  file_name text;
  mime_type text;
  file_size bigint;
  expected_prefix text;
begin
  if p_phase not in ('source', 'resolution') then
    raise exception 'Некорректный тип вложения';
  end if;

  if p_attachments is null then
    p_attachments := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_attachments) <> 'array' then
    raise exception 'Некорректный список вложений';
  end if;

  attachment_count := jsonb_array_length(p_attachments);
  if attachment_count > 10 then
    raise exception 'Можно прикрепить не больше 10 файлов';
  end if;

  expected_prefix := 'department-requests/' || p_request_id::text || '/' || p_user_id::text || '/' || p_phase || '/';

  for attachment in select value from jsonb_array_elements(p_attachments)
  loop
    object_path := btrim(coalesce(attachment->>'objectPath', ''));
    file_name := btrim(coalesce(attachment->>'fileName', ''));
    mime_type := nullif(btrim(coalesce(attachment->>'mimeType', '')), '');
    file_size := nullif(attachment->>'fileSize', '')::bigint;

    if object_path = ''
      or object_path not like expected_prefix || '%'
      or object_path like '%..%'
      or char_length(file_name) not between 1 and 240
      or file_size is null
      or file_size <= 0
      or file_size > 26214400 then
      raise exception 'Некорректные данные вложения';
    end if;

    if not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'department-request-files'
        and object.name = object_path
    ) then
      raise exception 'Загруженный файл не найден';
    end if;

    if exists (
      select 1
      from public.department_request_attachments existing
      where existing.storage_path = object_path
    ) then
      raise exception 'Файл уже прикреплён';
    end if;

    insert into public.department_request_attachments (
      request_id,
      phase,
      uploaded_by,
      file_name,
      mime_type,
      file_size,
      storage_path
    )
    values (
      p_request_id,
      p_phase,
      p_user_id,
      file_name,
      mime_type,
      file_size,
      object_path
    );
  end loop;
end;
$$;

revoke all on function public.validate_department_request_attachments(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

create or replace function public.create_department_request(
  p_request_id uuid,
  p_target_department text,
  p_title text,
  p_description text,
  p_machine_id uuid default null,
  p_due_date date default null,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_factory_id uuid;
  machine_factory_id uuid;
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;
  if p_target_department not in ('technologist', 'supply', 'production') then
    raise exception 'Неизвестный отдел';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 160 then
    raise exception 'Название должно содержать от 3 до 160 символов';
  end if;
  if char_length(btrim(coalesce(p_description, ''))) not between 3 and 5000 then
    raise exception 'Описание должно содержать от 3 до 5000 символов';
  end if;

  current_factory_id := public.get_user_factory_id();

  if p_machine_id is not null then
    select machine.factory_id
      into machine_factory_id
    from public.machines machine
    where machine.id = p_machine_id
      and not machine.is_archived;

    if not found then
      raise exception 'Заказ не найден';
    end if;
    if current_factory_id is not null
      and machine_factory_id is distinct from current_factory_id then
      raise exception 'Заказ относится к другому заводу';
    end if;
  end if;

  insert into public.department_requests (
    id,
    target_department,
    title,
    description,
    created_by,
    factory_id,
    machine_id,
    due_date
  )
  values (
    p_request_id,
    p_target_department,
    btrim(p_title),
    btrim(p_description),
    current_user_id,
    current_factory_id,
    p_machine_id,
    p_due_date
  );

  perform public.validate_department_request_attachments(
    p_request_id,
    current_user_id,
    'source',
    p_attachments
  );

  return p_request_id;
end;
$$;

revoke all on function public.create_department_request(uuid, text, text, text, uuid, date, jsonb)
  from public, anon;
grant execute on function public.create_department_request(uuid, text, text, text, uuid, date, jsonb)
  to authenticated, service_role;

create or replace function public.claim_department_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_row public.department_requests%rowtype;
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;

  select *
    into request_row
  from public.department_requests
  where id = p_request_id;

  if not found then
    raise exception 'Запрос не найден';
  end if;
  if not public.can_manage_department_request_target(
    request_row.target_department,
    request_row.factory_id
  ) then
    raise exception 'Недостаточно прав';
  end if;

  update public.department_requests
  set
    status = 'in_progress',
    assigned_to = current_user_id,
    response = null,
    completed_by = null,
    completed_at = null
  where id = p_request_id
    and status = 'new'
    and assigned_to is null;

  if not found then
    raise exception 'Запрос уже взял другой сотрудник';
  end if;

  return current_user_id;
end;
$$;

revoke all on function public.claim_department_request(uuid) from public, anon;
grant execute on function public.claim_department_request(uuid) to authenticated, service_role;

create or replace function public.complete_department_request(
  p_request_id uuid,
  p_response text,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_row public.department_requests%rowtype;
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;
  if char_length(btrim(coalesce(p_response, ''))) not between 3 and 5000 then
    raise exception 'Опишите решение запроса';
  end if;

  select *
    into request_row
  from public.department_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Запрос не найден';
  end if;
  if request_row.status <> 'in_progress' then
    raise exception 'Сначала возьмите запрос в работу';
  end if;
  if not public.can_manage_department_request_target(
    request_row.target_department,
    request_row.factory_id
  ) then
    raise exception 'Недостаточно прав';
  end if;

  perform public.validate_department_request_attachments(
    p_request_id,
    current_user_id,
    'resolution',
    p_attachments
  );

  update public.department_requests
  set
    status = 'done',
    response = btrim(p_response),
    completed_by = current_user_id,
    completed_at = now()
  where id = p_request_id;

  return current_user_id;
end;
$$;

revoke all on function public.complete_department_request(uuid, text, jsonb)
  from public, anon;
grant execute on function public.complete_department_request(uuid, text, jsonb)
  to authenticated, service_role;

create or replace function public.reject_department_request(
  p_request_id uuid,
  p_response text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_row public.department_requests%rowtype;
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;
  if char_length(btrim(coalesce(p_response, ''))) not between 3 and 5000 then
    raise exception 'Укажите причину отклонения';
  end if;

  select *
    into request_row
  from public.department_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Запрос не найден';
  end if;
  if request_row.status not in ('new', 'in_progress') then
    raise exception 'Этот запрос уже нельзя отклонить';
  end if;
  if not public.can_manage_department_request_target(
    request_row.target_department,
    request_row.factory_id
  ) then
    raise exception 'Недостаточно прав';
  end if;

  update public.department_requests
  set
    status = 'rejected',
    response = btrim(p_response),
    completed_by = current_user_id,
    completed_at = now()
  where id = p_request_id;

  return current_user_id;
end;
$$;

revoke all on function public.reject_department_request(uuid, text)
  from public, anon;
grant execute on function public.reject_department_request(uuid, text)
  to authenticated, service_role;

create or replace function public.cancel_department_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;

  update public.department_requests
  set
    status = 'cancelled',
    completed_by = null,
    completed_at = now()
  where id = p_request_id
    and created_by = current_user_id
    and status in ('new', 'in_progress');

  if not found then
    raise exception 'Этот запрос уже нельзя отменить';
  end if;

  return current_user_id;
end;
$$;

revoke all on function public.cancel_department_request(uuid) from public, anon;
grant execute on function public.cancel_department_request(uuid) to authenticated, service_role;

create or replace function public.protect_department_request_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by
    or new.target_department is distinct from old.target_department
    or new.factory_id is distinct from old.factory_id
    or new.machine_id is distinct from old.machine_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.priority is distinct from old.priority
    or new.due_date is distinct from old.due_date then
    raise exception 'Основные данные запроса нельзя менять после отправки';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.notify_department_request_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  author_name text;
  actor_name text;
  target_label text;
  status_message text;
begin
  target_label := case new.target_department
    when 'technologist' then 'технологу'
    when 'supply' then 'снабжению'
    else 'производству'
  end;

  if tg_op = 'INSERT' then
    select coalesce(full_name, 'Сотрудник') into author_name
    from public.users
    where id = new.created_by;

    insert into public.notifications (
      user_id,
      type,
      title,
      message,
      related_department_request_id
    )
    select distinct
      recipient.user_id,
      'department_request_new_' || new.target_department,
      'Новый запрос: ' || new.title,
      coalesce(author_name, 'Сотрудник') || ' отправил запрос ' || target_label,
      new.id
    from (
      select member.user_id
      from public.department_members member
      join public.departments department on department.id = member.department_id
      where department.is_active
        and (
          (new.target_department = 'technologist'
            and (lower(department.name) like '%техническ%' or lower(department.name) like '%технолог%'))
          or (new.target_department = 'supply'
            and (lower(department.name) like '%снабжен%' or lower(department.name) like '%закуп%'))
          or (new.target_department = 'production'
            and (lower(department.name) like '%производств%' or lower(department.name) like '%цех%')
            and (
              new.factory_id is null
              or department.factory_id is null
              or department.factory_id = new.factory_id
            ))
        )

      union

      select app_user.id
      from public.users app_user
      where app_user.is_active
        and (
          (new.target_department = 'technologist' and app_user.role::text in ('engineer', 'technologist'))
          or (new.target_department = 'supply' and app_user.role::text in ('supply_manager', 'procurement_head'))
          or (
            new.target_department = 'production'
            and app_user.role::text in ('production_manager', 'painting_head')
            and (new.factory_id is null or app_user.factory_id = new.factory_id)
          )
        )
    ) recipient
    where recipient.user_id <> new.created_by;
  elsif new.status is distinct from old.status then
    select coalesce(full_name, 'Сотрудник')
      into actor_name
    from public.users
    where id = case
      when new.status = 'in_progress' then new.assigned_to
      when new.status in ('done', 'rejected') then new.completed_by
      else new.created_by
    end;

    status_message := new.title || ': ' || case new.status
      when 'in_progress' then 'в работе · ' || coalesce(actor_name, 'исполнитель назначен')
      when 'done' then 'решён · ' || coalesce(actor_name, 'отдел')
      when 'rejected' then 'отклонён · ' || coalesce(actor_name, 'отдел')
      when 'cancelled' then 'отменён'
      else 'новый'
    end;

    insert into public.notifications (
      user_id,
      type,
      title,
      message,
      related_department_request_id
    )
    values (
      new.created_by,
      'department_request_status_' || new.target_department,
      'Статус запроса изменён',
      status_message,
      new.id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_department_request_change()
  from public, anon, authenticated;

create or replace function public.log_department_request_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_name text;
  event_actor uuid;
begin
  if tg_op = 'INSERT' then
    event_name := 'created';
    event_actor := new.created_by;
  elsif new.status is distinct from old.status then
    event_name := case new.status
      when 'in_progress' then 'claimed'
      when 'done' then 'completed'
      when 'rejected' then 'rejected'
      when 'cancelled' then 'cancelled'
      else null
    end;
    event_actor := case new.status
      when 'in_progress' then new.assigned_to
      when 'done' then new.completed_by
      when 'rejected' then new.completed_by
      when 'cancelled' then new.created_by
      else null
    end;
  end if;

  if event_name is not null then
    insert into public.department_request_events (
      request_id,
      event_type,
      actor_id
    )
    values (
      new.id,
      event_name,
      event_actor
    );
  end if;
  return new;
end;
$$;

revoke all on function public.log_department_request_event()
  from public, anon, authenticated;

drop trigger if exists log_department_request_event_after_write
  on public.department_requests;

create trigger log_department_request_event_after_write
after insert or update of status on public.department_requests
for each row execute function public.log_department_request_event();

insert into public.department_request_events (
  request_id,
  event_type,
  actor_id,
  created_at
)
select
  request.id,
  'created',
  request.created_by,
  request.created_at
from public.department_requests request
where not exists (
  select 1
  from public.department_request_events event
  where event.request_id = request.id
    and event.event_type = 'created'
);
