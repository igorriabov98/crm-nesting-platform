create table public.department_requests (
  id uuid primary key default gen_random_uuid(),
  target_department text not null,
  title text not null,
  description text not null,
  priority text not null default 'normal',
  status text not null default 'new',
  created_by uuid not null references public.users(id) on delete restrict,
  assigned_to uuid references public.users(id) on delete set null,
  factory_id uuid references public.factories(id) on delete set null,
  due_date date,
  response text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint department_requests_target_check
    check (target_department in ('technologist', 'supply', 'production')),
  constraint department_requests_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint department_requests_status_check
    check (status in ('new', 'in_progress', 'done', 'rejected', 'cancelled')),
  constraint department_requests_title_length
    check (char_length(btrim(title)) between 3 and 160),
  constraint department_requests_description_length
    check (char_length(btrim(description)) between 3 and 5000),
  constraint department_requests_response_length
    check (response is null or char_length(response) <= 2000)
);

create index department_requests_author_created_idx
  on public.department_requests (created_by, created_at desc);

create index department_requests_inbox_idx
  on public.department_requests (target_department, status, created_at desc);

create index department_requests_factory_inbox_idx
  on public.department_requests (factory_id, target_department, status, created_at desc)
  where factory_id is not null;

alter table public.department_requests enable row level security;

grant select, insert, update on public.department_requests to authenticated;
grant select, insert, update, delete on public.department_requests to service_role;

insert into public.role_permissions (role, resource_key, can_view, can_manage)
select role, 'department_requests', true, true
from unnest(enum_range(null::public.user_role)) as roles(role)
on conflict (role, resource_key) do nothing;

insert into public.department_access_permissions (
  department_id,
  subject_scope,
  resource_key,
  can_view,
  can_manage
)
select
  department.id,
  scope.subject_scope,
  'department_requests',
  true,
  true
from public.departments department
cross join (values ('head'), ('member')) as scope(subject_scope)
on conflict (department_id, subject_scope, resource_key) do nothing;

create or replace function public.can_manage_department_request_target(
  p_target_department text,
  p_factory_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with current_access as (
    select
      public.get_user_role()::text as role_name,
      public.get_user_factory_id() as factory_id
  )
  select
    case
      when access.role_name in ('financial_director', 'commercial_director', 'planning_director')
        then true
      when p_target_department = 'technologist'
        and access.role_name in ('engineer', 'technologist')
        then true
      when p_target_department = 'supply'
        and access.role_name in ('supply_manager', 'procurement_head')
        then true
      when p_target_department = 'production'
        and access.role_name in ('production_manager', 'painting_head')
        and (p_factory_id is null or p_factory_id = access.factory_id)
        then true
      else exists (
        select 1
        from public.department_members member
        join public.departments department on department.id = member.department_id
        where member.user_id = (select auth.uid())
          and department.is_active
          and (
            (p_target_department = 'technologist'
              and (lower(department.name) like '%техническ%' or lower(department.name) like '%технолог%'))
            or (p_target_department = 'supply'
              and (lower(department.name) like '%снабжен%' or lower(department.name) like '%закуп%'))
            or (p_target_department = 'production'
              and (lower(department.name) like '%производств%' or lower(department.name) like '%цех%')
              and (
                p_factory_id is null
                or department.factory_id is null
                or department.factory_id = access.factory_id
              ))
          )
      )
    end
  from current_access access;
$$;

revoke all on function public.can_manage_department_request_target(text, uuid) from public, anon;
grant execute on function public.can_manage_department_request_target(text, uuid) to authenticated, service_role;

create policy "department_requests_select"
  on public.department_requests
  for select
  to authenticated
  using (
    created_by = (select auth.uid())
    or public.can_manage_department_request_target(target_department, factory_id)
  );

create policy "department_requests_insert"
  on public.department_requests
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

create policy "department_requests_recipient_update"
  on public.department_requests
  for update
  to authenticated
  using (public.can_manage_department_request_target(target_department, factory_id))
  with check (public.can_manage_department_request_target(target_department, factory_id));

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

revoke all on function public.protect_department_request_identity() from public, anon, authenticated;

create trigger protect_department_request_identity_before_update
before update on public.department_requests
for each row execute function public.protect_department_request_identity();

alter table public.notifications
  add column if not exists related_department_request_id uuid
  references public.department_requests(id) on delete set null;

create index if not exists notifications_department_request_idx
  on public.notifications (related_department_request_id)
  where related_department_request_id is not null;

create or replace function public.notify_department_request_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  author_name text;
  target_label text;
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
      new.title || ': ' || case new.status
        when 'in_progress' then 'в работе'
        when 'done' then 'выполнен'
        when 'rejected' then 'отклонён'
        when 'cancelled' then 'отменён'
        else 'новый'
      end,
      new.id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_department_request_change() from public, anon, authenticated;

create trigger notify_department_request_change_after_write
after insert or update of status on public.department_requests
for each row execute function public.notify_department_request_change();
