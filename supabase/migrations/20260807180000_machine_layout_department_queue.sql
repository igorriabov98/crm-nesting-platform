-- Route machine-layout work through the shared technologist department queue.

alter table public.department_requests
  add column if not exists request_kind text not null default 'manual';

alter table public.department_requests
  drop constraint if exists department_requests_kind_check;

alter table public.department_requests
  add constraint department_requests_kind_check
  check (request_kind in ('manual', 'machine_layout'));

create or replace function public.protect_department_request_identity()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  is_layout_claim boolean :=
    old.request_kind = 'machine_layout'
    and old.status = 'new'
    and old.assigned_to is null
    and new.status = 'in_progress'
    and new.assigned_to is not null;
begin
  if new.created_by is distinct from old.created_by
    or new.target_department is distinct from old.target_department
    or new.factory_id is distinct from old.factory_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.priority is distinct from old.priority
    or new.request_kind is distinct from old.request_kind
    or (
      new.due_date is distinct from old.due_date
      and not is_layout_claim
    ) then
    raise exception 'Основные данные запроса нельзя менять после отправки';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.protect_department_request_identity()
  from public, anon, authenticated;

alter table public.machine_layout_requests
  add column if not exists department_request_id uuid
  references public.department_requests(id) on delete set null;

create index if not exists idx_machine_layout_requests_department_request
  on public.machine_layout_requests(department_request_id, version_no desc)
  where department_request_id is not null;

create unique index if not exists idx_machine_layout_requests_open_department_request
  on public.machine_layout_requests(department_request_id)
  where department_request_id is not null and status = 'requested';

create or replace function public.machine_layout_next_workday(p_date date)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  next_date date := p_date + 1;
begin
  while extract(isodow from next_date) in (6, 7) loop
    next_date := next_date + 1;
  end loop;
  return next_date;
end;
$$;

revoke all on function public.machine_layout_next_workday(date) from public, anon;
grant execute on function public.machine_layout_next_workday(date) to authenticated, service_role;

create or replace function public.can_claim_machine_layout_request(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and coalesce(app_user.is_active, true)
      and lower(concat_ws(' ', app_user.full_name, app_user.email)) !~
        '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
      and (
        app_user.role in ('technologist', 'engineer')
        or exists (
          select 1
          from public.department_members member
          join public.departments department on department.id = member.department_id
          left join public.positions position on position.id = member.position_id
          where member.user_id = app_user.id
            and department.is_active
            and concat_ws(' ', department.name, position.name) ~ '(Т|т)ехнолог|[Tt]echnolog'
        )
      )
  );
$$;

revoke all on function public.can_claim_machine_layout_request(uuid) from public, anon, authenticated;
grant execute on function public.can_claim_machine_layout_request(uuid) to service_role;

create or replace function public.create_machine_layout_department_request(
  p_machine_id uuid,
  p_requested_by uuid,
  p_item_snapshot jsonb
)
returns table(department_request_id uuid, layout_request_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  machine_row public.machines%rowtype;
  next_version integer;
  new_department_request_id uuid := gen_random_uuid();
  new_layout_request_id uuid := gen_random_uuid();
begin
  if p_requested_by is null or not exists (
    select 1
    from public.users app_user
    where app_user.id = p_requested_by
      and coalesce(app_user.is_active, true)
  ) then
    raise exception 'Необходим активный автор запроса';
  end if;

  if jsonb_typeof(p_item_snapshot) is distinct from 'array'
    or jsonb_array_length(p_item_snapshot) = 0 then
    raise exception 'Добавьте хотя бы один товар перед запросом расстановки';
  end if;

  select machine.*
    into machine_row
  from public.machines machine
  where machine.id = p_machine_id
  for update;

  if not found then
    raise exception 'Машина не найдена';
  end if;
  if coalesce(machine_row.is_archived, false) then
    raise exception 'Машина архивирована. Действия с ней остановлены.';
  end if;
  if exists (
    select 1
    from public.machine_layout_requests layout_request
    where layout_request.machine_id = p_machine_id
      and layout_request.status = 'requested'
  ) then
    raise exception 'По машине уже есть открытый запрос на расстановку';
  end if;

  select coalesce(max(layout_request.version_no), 0) + 1
    into next_version
  from public.machine_layout_requests layout_request
  where layout_request.machine_id = p_machine_id;

  insert into public.department_requests (
    id,
    request_kind,
    target_department,
    title,
    description,
    created_by,
    factory_id,
    machine_id,
    due_date
  )
  values (
    new_department_request_id,
    'machine_layout',
    'technologist',
    'Расстановка изделий в машине',
    'Выполните расстановку изделий для машины "' || coalesce(machine_row.name, 'Без названия') ||
      '" и загрузите PDF во вкладке "Технолог" карточки машины.',
    p_requested_by,
    machine_row.factory_id,
    p_machine_id,
    null
  );

  insert into public.machine_layout_requests (
    id,
    machine_id,
    department_request_id,
    task_id,
    requested_by,
    assigned_to,
    version_no,
    status,
    item_snapshot
  )
  values (
    new_layout_request_id,
    p_machine_id,
    new_department_request_id,
    null,
    p_requested_by,
    null,
    next_version,
    'requested',
    p_item_snapshot
  );

  return query select new_department_request_id, new_layout_request_id;
end;
$$;

revoke all on function public.create_machine_layout_department_request(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_machine_layout_department_request(uuid, uuid, jsonb)
  to service_role;

create or replace function public.sync_machine_layout_request_version(
  p_machine_id uuid,
  p_item_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  machine_row public.machines%rowtype;
  open_layout public.machine_layout_requests%rowtype;
  next_version integer;
  new_layout_request_id uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_item_snapshot) is distinct from 'array'
    or jsonb_array_length(p_item_snapshot) = 0 then
    raise exception 'Снимок изделий для расстановки пуст';
  end if;

  select machine.*
    into machine_row
  from public.machines machine
  where machine.id = p_machine_id
  for update;

  if not found or coalesce(machine_row.is_archived, false) then
    return null;
  end if;

  select layout_request.*
    into open_layout
  from public.machine_layout_requests layout_request
  where layout_request.machine_id = p_machine_id
    and layout_request.status = 'requested'
  order by layout_request.version_no desc
  limit 1;

  if not found then
    return null;
  end if;
  if open_layout.item_snapshot = p_item_snapshot then
    return open_layout.id;
  end if;

  select coalesce(max(layout_request.version_no), 0) + 1
    into next_version
  from public.machine_layout_requests layout_request
  where layout_request.machine_id = p_machine_id;

  update public.machine_layout_requests
  set
    status = 'completed',
    task_id = null,
    completed_at = now(),
    updated_at = now()
  where machine_id = p_machine_id
    and status = 'requested';

  insert into public.machine_layout_requests (
    id,
    machine_id,
    department_request_id,
    task_id,
    requested_by,
    assigned_to,
    version_no,
    status,
    item_snapshot
  )
  values (
    new_layout_request_id,
    p_machine_id,
    open_layout.department_request_id,
    open_layout.task_id,
    open_layout.requested_by,
    open_layout.assigned_to,
    next_version,
    'requested',
    p_item_snapshot
  );

  return new_layout_request_id;
end;
$$;

revoke all on function public.sync_machine_layout_request_version(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_machine_layout_request_version(uuid, jsonb)
  to service_role;

create or replace function public.claim_department_request(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  request_row public.department_requests%rowtype;
  layout_row public.machine_layout_requests%rowtype;
  new_task_id uuid;
  task_start_date date := (now() at time zone 'Europe/Uzhgorod')::date;
  task_deadline date;
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;

  select request.*
    into request_row
  from public.department_requests request
  where request.id = p_request_id;

  if not found then
    raise exception 'Запрос не найден';
  end if;
  if request_row.request_kind = 'machine_layout' then
    if not public.can_claim_machine_layout_request(current_user_id) then
      raise exception 'Взять расстановку в работу может только технолог или инженер';
    end if;

    select layout_request.*
      into layout_row
    from public.machine_layout_requests layout_request
    where layout_request.department_request_id = request_row.id
      and layout_request.status = 'requested'
    order by layout_request.version_no desc
    limit 1;

    if not found then
      raise exception 'Открытая версия расстановки не найдена';
    end if;
    task_deadline := public.machine_layout_next_workday(task_start_date);
  else
    if not public.can_manage_department_request_target(
      request_row.target_department,
      request_row.factory_id
    ) then
      raise exception 'Недостаточно прав';
    end if;
    task_deadline := request_row.due_date;
  end if;

  update public.department_requests
  set
    status = 'in_progress',
    assigned_to = current_user_id,
    due_date = case
      when request_kind = 'machine_layout' then task_deadline
      else due_date
    end,
    response = null,
    completed_by = null,
    completed_at = null
  where id = p_request_id
    and status = 'new'
    and assigned_to is null;

  if not found then
    raise exception 'Запрос уже взял другой сотрудник';
  end if;

  insert into public.tasks (
    department_request_id,
    machine_id,
    assigned_to,
    task_type,
    title,
    description,
    status,
    start_date,
    deadline
  )
  values (
    request_row.id,
    request_row.machine_id,
    current_user_id,
    case
      when request_row.request_kind = 'machine_layout' then 'machine_layout'::public.task_type
      else 'department_request'::public.task_type
    end,
    request_row.title,
    request_row.description,
    'in_progress',
    task_start_date,
    task_deadline
  )
  returning id into new_task_id;

  if request_row.request_kind = 'machine_layout' then
    update public.machine_layout_requests
    set
      task_id = new_task_id,
      assigned_to = current_user_id,
      updated_at = now()
    where id = layout_row.id;
  end if;

  return current_user_id;
end;
$$;

revoke all on function public.claim_department_request(uuid) from public, anon;
grant execute on function public.claim_department_request(uuid) to authenticated, service_role;

create or replace function public.complete_machine_layout_request(
  p_request_id uuid,
  p_uploaded_by uuid,
  p_file_name text,
  p_file_path text,
  p_mime_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  layout_row public.machine_layout_requests%rowtype;
  department_row public.department_requests%rowtype;
  completed_time timestamptz := now();
begin
  if p_uploaded_by is null or not exists (
    select 1
    from public.users app_user
    where app_user.id = p_uploaded_by
      and coalesce(app_user.is_active, true)
  ) then
    raise exception 'Необходим активный пользователь';
  end if;
  if char_length(btrim(coalesce(p_file_name, ''))) not between 1 and 240 then
    raise exception 'Некорректное имя PDF';
  end if;
  if char_length(btrim(coalesce(p_file_path, ''))) = 0
    or p_file_path not like 'machine-layouts/%'
    or p_file_path like '%..%' then
    raise exception 'Некорректный путь PDF';
  end if;
  if p_file_size <= 0 or p_file_size > 52428800 then
    raise exception 'PDF расстановки не должен превышать 50 МБ';
  end if;

  select layout_request.*
    into layout_row
  from public.machine_layout_requests layout_request
  where layout_request.id = p_request_id
  for update;

  if not found then
    raise exception 'Версия расстановки не найдена';
  end if;
  if layout_row.status <> 'requested' then
    raise exception 'Эта версия уже закрыта. Создайте новый запрос на расстановку.';
  end if;

  if layout_row.department_request_id is not null then
    select request.*
      into department_row
    from public.department_requests request
    where request.id = layout_row.department_request_id
    for update;

    if not found or department_row.request_kind <> 'machine_layout' then
      raise exception 'Связанная заявка на расстановку не найдена';
    end if;
    if department_row.status not in ('new', 'in_progress') then
      raise exception 'Связанная заявка уже закрыта';
    end if;
  end if;

  update public.machine_layout_requests
  set
    status = 'completed',
    pdf_file_name = btrim(p_file_name),
    pdf_file_path = p_file_path,
    pdf_mime_type = nullif(btrim(coalesce(p_mime_type, '')), ''),
    pdf_file_size = p_file_size,
    uploaded_by = p_uploaded_by,
    uploaded_at = completed_time,
    completed_at = completed_time,
    updated_at = completed_time
  where id = layout_row.id;

  if layout_row.task_id is not null then
    update public.tasks
    set
      status = 'completed',
      completed_at = completed_time,
      updated_at = completed_time
    where id = layout_row.task_id
      and task_type = 'machine_layout';
  end if;

  if layout_row.department_request_id is not null then
    update public.department_requests
    set
      status = 'done',
      response = 'PDF расстановки загружен: ' || btrim(p_file_name),
      completed_by = p_uploaded_by,
      completed_at = completed_time
    where id = layout_row.department_request_id;
  end if;

  return layout_row.id;
end;
$$;

revoke all on function public.complete_machine_layout_request(uuid, uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.complete_machine_layout_request(uuid, uuid, text, text, text, bigint)
  to service_role;

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

  select request.*
    into request_row
  from public.department_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Запрос не найден';
  end if;
  if request_row.request_kind = 'machine_layout' then
    raise exception 'Заявка на расстановку завершается автоматически после загрузки PDF во вкладке «Технолог»';
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

  update public.tasks
  set
    status = 'completed',
    completed_at = now(),
    updated_at = now()
  where department_request_id = p_request_id
    and status <> 'completed';

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
  completed_time timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;
  if char_length(btrim(coalesce(p_response, ''))) not between 3 and 5000 then
    raise exception 'Укажите причину отклонения';
  end if;

  select request.*
    into request_row
  from public.department_requests request
  where request.id = p_request_id
  for update;

  if not found then
    raise exception 'Запрос не найден';
  end if;
  if request_row.status not in ('new', 'in_progress') then
    raise exception 'Этот запрос уже нельзя отклонить';
  end if;
  if request_row.request_kind = 'machine_layout' then
    if not public.can_manage_department_request_target(
      request_row.target_department,
      request_row.factory_id
    ) and not public.can_claim_machine_layout_request(current_user_id) then
      raise exception 'Недостаточно прав';
    end if;
  elsif not public.can_manage_department_request_target(
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
    completed_at = completed_time
  where id = p_request_id;

  update public.tasks
  set
    status = 'cancelled',
    completed_at = completed_time,
    updated_at = completed_time
  where department_request_id = p_request_id
    and status not in ('completed', 'cancelled');

  if request_row.request_kind = 'machine_layout' then
    update public.machine_layout_requests
    set
      status = 'completed',
      task_id = null,
      completed_at = completed_time,
      updated_at = completed_time
    where department_request_id = p_request_id
      and status = 'requested';
  end if;

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
  request_row public.department_requests%rowtype;
  completed_time timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;

  select request.*
    into request_row
  from public.department_requests request
  where request.id = p_request_id
  for update;

  if not found
    or request_row.created_by <> current_user_id
    or request_row.status not in ('new', 'in_progress') then
    raise exception 'Этот запрос уже нельзя отменить';
  end if;

  update public.department_requests
  set
    status = 'cancelled',
    completed_by = null,
    completed_at = completed_time
  where id = p_request_id;

  update public.tasks
  set
    status = 'cancelled',
    completed_at = completed_time,
    updated_at = completed_time
  where department_request_id = p_request_id
    and status not in ('completed', 'cancelled');

  if request_row.request_kind = 'machine_layout' then
    update public.machine_layout_requests
    set
      status = 'completed',
      task_id = null,
      completed_at = completed_time,
      updated_at = completed_time
    where department_request_id = p_request_id
      and status = 'requested';
  end if;

  return current_user_id;
end;
$$;

revoke all on function public.cancel_department_request(uuid) from public, anon;
grant execute on function public.cancel_department_request(uuid) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
