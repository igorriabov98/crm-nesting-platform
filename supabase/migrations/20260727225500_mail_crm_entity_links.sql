-- Link a whole Gmail thread or one immutable Gmail message to CRM entities.

create table public.department_request_mail_threads (
  id uuid primary key default gen_random_uuid(),
  department_request_id uuid not null references public.department_requests(id) on delete cascade,
  thread_id uuid not null references public.mail_threads(id) on delete restrict,
  linked_by uuid not null references public.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  unlinked_by uuid references public.users(id) on delete set null,
  unique (department_request_id, thread_id)
);

create table public.department_request_mail_messages (
  id uuid primary key default gen_random_uuid(),
  department_request_id uuid not null references public.department_requests(id) on delete cascade,
  message_id uuid not null references public.mail_messages(id) on delete restrict,
  linked_by uuid not null references public.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  unlinked_by uuid references public.users(id) on delete set null,
  unique (department_request_id, message_id)
);

create table public.product_project_mail_messages (
  id uuid primary key default gen_random_uuid(),
  product_project_id uuid not null references public.product_projects(id) on delete cascade,
  message_id uuid not null references public.mail_messages(id) on delete restrict,
  linked_by uuid not null references public.users(id) on delete restrict,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  unlinked_by uuid references public.users(id) on delete set null,
  unique (product_project_id, message_id)
);

create index department_request_mail_threads_request_active_idx
  on public.department_request_mail_threads (department_request_id, linked_at desc)
  where unlinked_at is null;
create index department_request_mail_threads_thread_active_idx
  on public.department_request_mail_threads (thread_id)
  where unlinked_at is null;
create index department_request_mail_messages_request_active_idx
  on public.department_request_mail_messages (department_request_id, linked_at desc)
  where unlinked_at is null;
create index department_request_mail_messages_message_active_idx
  on public.department_request_mail_messages (message_id)
  where unlinked_at is null;
create index product_project_mail_messages_project_active_idx
  on public.product_project_mail_messages (product_project_id, linked_at desc)
  where unlinked_at is null;
create index product_project_mail_messages_message_active_idx
  on public.product_project_mail_messages (message_id)
  where unlinked_at is null;

create index department_request_mail_threads_linked_by_idx on public.department_request_mail_threads (linked_by);
create index department_request_mail_threads_unlinked_by_idx on public.department_request_mail_threads (unlinked_by);
create index department_request_mail_messages_linked_by_idx on public.department_request_mail_messages (linked_by);
create index department_request_mail_messages_unlinked_by_idx on public.department_request_mail_messages (unlinked_by);
create index product_project_mail_messages_linked_by_idx on public.product_project_mail_messages (linked_by);
create index product_project_mail_messages_unlinked_by_idx on public.product_project_mail_messages (unlinked_by);

alter table public.department_request_mail_threads enable row level security;
alter table public.department_request_mail_messages enable row level security;
alter table public.product_project_mail_messages enable row level security;

grant select, insert, update on public.department_request_mail_threads to authenticated;
grant select, insert, update on public.department_request_mail_messages to authenticated;
grant select, insert, update on public.product_project_mail_messages to authenticated;
grant all on public.department_request_mail_threads to service_role;
grant all on public.department_request_mail_messages to service_role;
grant all on public.product_project_mail_messages to service_role;

create policy department_request_mail_threads_reader
  on public.department_request_mail_threads for select to authenticated
  using (exists (
    select 1 from public.department_requests request
    where request.id = department_request_id
      and (
        request.created_by = (select auth.uid())
        or public.can_manage_department_request_target(request.target_department, request.factory_id)
      )
  ));

create policy department_request_mail_messages_reader
  on public.department_request_mail_messages for select to authenticated
  using (exists (
    select 1 from public.department_requests request
    where request.id = department_request_id
      and (
        request.created_by = (select auth.uid())
        or public.can_manage_department_request_target(request.target_department, request.factory_id)
      )
  ));

create policy department_request_mail_threads_owner_insert
  on public.department_request_mail_threads for insert to authenticated
  with check (
    linked_by = (select auth.uid())
    and exists (
      select 1 from public.mail_threads thread
      join public.mail_accounts account on account.id = thread.account_id
      where thread.id = thread_id and account.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.department_requests request
      where request.id = department_request_id and request.created_by = (select auth.uid())
    )
  );

create policy department_request_mail_messages_owner_insert
  on public.department_request_mail_messages for insert to authenticated
  with check (
    linked_by = (select auth.uid())
    and exists (
      select 1 from public.mail_messages message
      join public.mail_accounts account on account.id = message.account_id
      where message.id = message_id and account.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.department_requests request
      where request.id = department_request_id and request.created_by = (select auth.uid())
    )
  );

create policy department_request_mail_threads_unlink
  on public.department_request_mail_threads for update to authenticated
  using (exists (
    select 1 from public.department_requests request
    where request.id = department_request_id
      and (
        request.created_by = (select auth.uid())
        or public.can_manage_department_request_target(request.target_department, request.factory_id)
      )
  ))
  with check (unlinked_at is not null and unlinked_by = (select auth.uid()));

create policy department_request_mail_messages_unlink
  on public.department_request_mail_messages for update to authenticated
  using (exists (
    select 1 from public.department_requests request
    where request.id = department_request_id
      and (
        request.created_by = (select auth.uid())
        or public.can_manage_department_request_target(request.target_department, request.factory_id)
      )
  ))
  with check (unlinked_at is not null and unlinked_by = (select auth.uid()));

create policy product_project_mail_messages_reader
  on public.product_project_mail_messages for select to authenticated
  using (exists (
    select 1 from public.role_permissions permission
    join public.users actor on actor.id = (select auth.uid())
    where permission.role = actor.role
      and permission.resource_key = 'product_projects'
      and permission.can_view = true
  ));

create policy product_project_mail_messages_manager_insert
  on public.product_project_mail_messages for insert to authenticated
  with check (
    linked_by = (select auth.uid())
    and exists (
      select 1 from public.mail_messages message
      join public.mail_accounts account on account.id = message.account_id
      where message.id = message_id and account.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.role_permissions permission
      join public.users actor on actor.id = (select auth.uid())
      where permission.role = actor.role
        and permission.resource_key = 'product_projects'
        and permission.can_manage = true
    )
  );

create policy product_project_mail_messages_manager_update
  on public.product_project_mail_messages for update to authenticated
  using (exists (
    select 1 from public.role_permissions permission
    join public.users actor on actor.id = (select auth.uid())
    where permission.role = actor.role
      and permission.resource_key = 'product_projects'
      and permission.can_manage = true
  ))
  with check (
    exists (
      select 1 from public.role_permissions permission
      join public.users actor on actor.id = (select auth.uid())
      where permission.role = actor.role
        and permission.resource_key = 'product_projects'
        and permission.can_manage = true
    )
    and (unlinked_at is null or unlinked_by = (select auth.uid()))
  );

drop policy if exists mail_threads_owner_or_project_reader on public.mail_threads;
create policy mail_threads_owner_or_crm_reader
  on public.mail_threads for select to authenticated
  using (
    exists (
      select 1 from public.mail_accounts account
      where account.id = mail_threads.account_id and account.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.product_project_mail_threads link
      where link.thread_id = mail_threads.id and link.unlinked_at is null
        and exists (
          select 1 from public.role_permissions permission
          join public.users actor on actor.id = (select auth.uid())
          where permission.role = actor.role
            and permission.resource_key = 'product_projects'
            and permission.can_view = true
        )
    )
    or exists (
      select 1 from public.department_request_mail_threads link
      join public.department_requests request on request.id = link.department_request_id
      where link.thread_id = mail_threads.id and link.unlinked_at is null
        and (
          request.created_by = (select auth.uid())
          or public.can_manage_department_request_target(request.target_department, request.factory_id)
        )
    )
  );

drop policy if exists mail_messages_owner_or_project_reader on public.mail_messages;
create policy mail_messages_owner_or_crm_reader
  on public.mail_messages for select to authenticated
  using (
    exists (
      select 1 from public.mail_accounts account
      where account.id = mail_messages.account_id and account.user_id = (select auth.uid())
    )
    or exists (
      select 1 from public.product_project_mail_threads link
      where link.thread_id = mail_messages.thread_id and link.unlinked_at is null
        and exists (
          select 1 from public.role_permissions permission
          join public.users actor on actor.id = (select auth.uid())
          where permission.role = actor.role
            and permission.resource_key = 'product_projects'
            and permission.can_view = true
        )
    )
    or exists (
      select 1 from public.product_project_mail_messages link
      where link.message_id = mail_messages.id and link.unlinked_at is null
        and exists (
          select 1 from public.role_permissions permission
          join public.users actor on actor.id = (select auth.uid())
          where permission.role = actor.role
            and permission.resource_key = 'product_projects'
            and permission.can_view = true
        )
    )
    or exists (
      select 1 from public.department_request_mail_threads link
      join public.department_requests request on request.id = link.department_request_id
      where link.thread_id = mail_messages.thread_id and link.unlinked_at is null
        and (
          request.created_by = (select auth.uid())
          or public.can_manage_department_request_target(request.target_department, request.factory_id)
        )
    )
    or exists (
      select 1 from public.department_request_mail_messages link
      join public.department_requests request on request.id = link.department_request_id
      where link.message_id = mail_messages.id and link.unlinked_at is null
        and (
          request.created_by = (select auth.uid())
          or public.can_manage_department_request_target(request.target_department, request.factory_id)
        )
    )
  );

drop policy if exists mail_attachments_owner_or_project_reader on public.mail_attachments;
create policy mail_attachments_owner_or_crm_reader
  on public.mail_attachments for select to authenticated
  using (exists (
    select 1 from public.mail_messages message
    where message.id = mail_attachments.message_id
  ));

create or replace function public.create_department_request_with_mail(
  p_request_id uuid,
  p_target_department text,
  p_title text,
  p_description text,
  p_machine_id uuid default null,
  p_due_date date default null,
  p_attachments jsonb default '[]'::jsonb,
  p_mail_link jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := (select auth.uid());
  link_kind text;
  link_id uuid;
begin
  if current_user_id is null then
    raise exception 'Необходима авторизация';
  end if;

  if p_mail_link is not null then
    link_kind := p_mail_link ->> 'kind';
    begin
      link_id := (p_mail_link ->> 'id')::uuid;
    exception when others then
      raise exception 'Некорректная ссылка на письмо';
    end;
    if link_kind not in ('thread', 'message') or link_id is null then
      raise exception 'Некорректная ссылка на письмо';
    end if;

    if link_kind = 'thread' and not exists (
      select 1 from public.mail_threads thread
      join public.mail_accounts account on account.id = thread.account_id
      where thread.id = link_id and account.user_id = current_user_id
    ) then
      raise exception 'Переписка не найдена или недоступна';
    elsif link_kind = 'message' and not exists (
      select 1 from public.mail_messages message
      join public.mail_accounts account on account.id = message.account_id
      where message.id = link_id and account.user_id = current_user_id
    ) then
      raise exception 'Письмо не найдено или недоступно';
    end if;
  end if;

  perform public.create_department_request(
    p_request_id,
    p_target_department,
    p_title,
    p_description,
    p_machine_id,
    p_due_date,
    p_attachments
  );

  if link_kind = 'thread' then
    insert into public.department_request_mail_threads (
      department_request_id, thread_id, linked_by
    ) values (p_request_id, link_id, current_user_id);
  elsif link_kind = 'message' then
    insert into public.department_request_mail_messages (
      department_request_id, message_id, linked_by
    ) values (p_request_id, link_id, current_user_id);
  end if;

  return p_request_id;
end;
$$;

revoke all on function public.create_department_request_with_mail(uuid, text, text, text, uuid, date, jsonb, jsonb)
  from public, anon;
grant execute on function public.create_department_request_with_mail(uuid, text, text, text, uuid, date, jsonb, jsonb)
  to authenticated, service_role;

comment on table public.department_request_mail_threads is 'Soft-deletable whole-thread links for department requests';
comment on table public.department_request_mail_messages is 'Soft-deletable single-message links for department requests';
comment on table public.product_project_mail_messages is 'Soft-deletable single-message links for product projects';
