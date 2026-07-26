alter table public.tasks
  add column if not exists department_request_id uuid
  references public.department_requests(id) on delete cascade;

create unique index if not exists tasks_department_request_unique_idx
  on public.tasks (department_request_id)
  where department_request_id is not null;

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
select
  request.id,
  request.machine_id,
  request.assigned_to,
  'department_request',
  request.title,
  request.description,
  'in_progress',
  request.updated_at::date,
  request.due_date
from public.department_requests request
where request.status = 'in_progress'
  and request.assigned_to is not null
on conflict do nothing;

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
    'department_request',
    request_row.title,
    request_row.description,
    'in_progress',
    current_date,
    request_row.due_date
  );

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

  update public.tasks
  set
    status = 'cancelled',
    completed_at = now(),
    updated_at = now()
  where department_request_id = p_request_id
    and status not in ('completed', 'cancelled');

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

  update public.tasks
  set
    status = 'cancelled',
    completed_at = now(),
    updated_at = now()
  where department_request_id = p_request_id
    and status not in ('completed', 'cancelled');

  return current_user_id;
end;
$$;

revoke all on function public.cancel_department_request(uuid) from public, anon;
grant execute on function public.cancel_department_request(uuid) to authenticated, service_role;
