-- Mandatory financial approval between the technologist completion wizard and supply.

alter type public.request_status add value if not exists 'pending_financial_approval' after 'stock_checked';
alter type public.task_type add value if not exists 'technologist_request_approval';

create table if not exists public.technologist_request_approval_versions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.technologist_requests(id) on delete cascade,
  revision_number integer not null check (revision_number >= 0),
  state text not null check (state in ('pending', 'returned', 'superseded', 'approved')),
  completion_payload jsonb not null,
  summary_snapshot jsonb not null,
  submitted_by uuid references public.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  return_reason text,
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, revision_number),
  constraint technologist_request_approval_return_reason_check check (
    (state = 'returned' and nullif(btrim(return_reason), '') is not null)
    or (state <> 'returned' and return_reason is null)
  )
);

create unique index if not exists technologist_request_approval_one_pending
  on public.technologist_request_approval_versions(request_id)
  where state = 'pending';
create index if not exists technologist_request_approval_request_history
  on public.technologist_request_approval_versions(request_id, revision_number desc);

create table if not exists public.technologist_request_approval_archives (
  id uuid primary key default gen_random_uuid(),
  approval_version_id uuid not null references public.technologist_request_approval_versions(id) on delete cascade,
  object_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size bigint not null check (file_size > 0 and file_size <= 524288000),
  created_at timestamptz not null default now()
);

alter table public.tasks
  add column if not exists technologist_request_approval_id uuid
    references public.technologist_request_approval_versions(id) on delete set null;
create index if not exists tasks_technologist_request_approval_idx
  on public.tasks(technologist_request_approval_id);
create unique index if not exists tasks_one_active_technologist_approval_per_user
  on public.tasks(technologist_request_approval_id, assigned_to)
  where technologist_request_approval_id is not null and status in ('pending', 'in_progress');

alter table public.technologist_request_approval_versions enable row level security;
alter table public.technologist_request_approval_archives enable row level security;

create policy "technologist_request_approval_versions_select" on public.technologist_request_approval_versions
  for select to authenticated using (
    submitted_by = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role = 'financial_director')
    or exists (
      select 1 from public.department_members dm
      join public.positions p on p.id = dm.position_id
      join public.users u on u.id = dm.user_id
      where dm.user_id = auth.uid() and u.is_active and p.is_active and p.name = 'Администратор CRM'
    )
  );
create policy "technologist_request_approval_archives_select" on public.technologist_request_approval_archives
  for select to authenticated using (
    exists (
      select 1 from public.technologist_request_approval_versions v
      where v.id = approval_version_id
    )
  );

grant select on public.technologist_request_approval_versions to authenticated;
grant select on public.technologist_request_approval_archives to authenticated;
grant all on public.technologist_request_approval_versions to service_role;
grant all on public.technologist_request_approval_archives to service_role;

insert into public.role_permissions(role, resource_key, can_view, can_manage)
select role_value, 'technologist_request_results', true, role_value = 'financial_director'
from unnest(array['technologist'::public.user_role, 'financial_director'::public.user_role]) role_value
on conflict (role, resource_key) do update
set can_view = excluded.can_view,
    can_manage = excluded.can_manage;

create or replace function public.fn_submit_technologist_request_for_approval(
  p_request_id uuid,
  p_actor uuid,
  p_completion_payload jsonb,
  p_summary_snapshot jsonb,
  p_archives jsonb default '[]'::jsonb
) returns uuid
language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_request public.technologist_requests%rowtype;
  v_machine_name text;
  v_version_id uuid;
  v_revision integer;
  v_request_number integer;
  v_recipients uuid[];
  v_recipient uuid;
  v_archive jsonb;
  v_storage storage.objects%rowtype;
  v_path_prefix text;
begin
  if p_actor is null then raise exception 'Недостаточно прав'; end if;
  if jsonb_typeof(p_completion_payload) <> 'object' or jsonb_typeof(p_summary_snapshot) <> 'object' then
    raise exception 'Некорректный снимок заявки';
  end if;
  if jsonb_typeof(coalesce(p_archives, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_archives, '[]'::jsonb)) > 20 then
    raise exception 'Можно прикрепить не более 20 архивов';
  end if;

  select r, m.name into v_request, v_machine_name
  from public.technologist_requests r
  join public.machines m on m.id = r.machine_id
  where r.id = p_request_id
  for update of r;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  if v_request.status <> 'stock_checked' then raise exception 'Заявка не готова к согласованию'; end if;
  if exists (select 1 from public.technologist_request_completions c where c.request_id = p_request_id) then
    raise exception 'Производственные последствия уже зафиксированы';
  end if;
  if exists (select 1 from public.technologist_request_approval_versions v where v.request_id = p_request_id and v.state = 'pending') then
    raise exception 'Заявка уже ожидает согласования';
  end if;
  v_path_prefix := 'machine-cutting/' || v_request.machine_id || '/' || p_request_id || '/';
  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    if v_archive->>'requestId' is distinct from p_request_id::text
       or nullif(v_archive->>'completionId', '') is not null
       or btrim(coalesce(v_archive->>'fileName', '')) = ''
       or (v_archive->>'fileSize')::bigint <= 0
       or (v_archive->>'fileSize')::bigint > 524288000
       or lower(v_archive->>'fileName') !~ '\.(zip|rar|7z)$'
       or v_archive->>'objectPath' not like v_path_prefix || '%'
       or v_archive->>'objectPath' like '%..%' then
      raise exception 'Некорректный архив порезки';
    end if;
    select * into v_storage from storage.objects
    where bucket_id = 'nesting-files' and name = v_archive->>'objectPath';
    if not found or coalesce((v_storage.metadata->>'size')::bigint, -1) <> (v_archive->>'fileSize')::bigint then
      raise exception 'Загруженный архив не найден или его размер не совпадает';
    end if;
  end loop;

  select coalesce(array_agg(u.id order by u.id), '{}'::uuid[]) into v_recipients
  from public.users u where u.is_active and u.role = 'financial_director';
  if cardinality(v_recipients) = 0 then
    select coalesce(array_agg(distinct u.id order by u.id), '{}'::uuid[]) into v_recipients
    from public.users u
    join public.department_members dm on dm.user_id = u.id
    join public.positions p on p.id = dm.position_id
    where u.is_active and p.is_active and p.name = 'Администратор CRM';
  end if;
  if cardinality(v_recipients) = 0 then
    raise exception 'Нет активного финансового директора или администратора CRM';
  end if;

  select coalesce(max(v.revision_number), -1) + 1 into v_revision
  from public.technologist_request_approval_versions v where v.request_id = p_request_id;
  select count(*) into v_request_number
  from public.technologist_requests numbered
  where numbered.machine_id = v_request.machine_id
    and (numbered.created_at, numbered.id) <= (v_request.created_at, v_request.id);
  insert into public.technologist_request_approval_versions(
    request_id, revision_number, state, completion_payload, summary_snapshot, submitted_by
  ) values (p_request_id, v_revision, 'pending', p_completion_payload, p_summary_snapshot, p_actor)
  returning id into v_version_id;

  for v_archive in select * from jsonb_array_elements(coalesce(p_archives, '[]'::jsonb)) loop
    insert into public.technologist_request_approval_archives(
      approval_version_id, object_path, file_name, mime_type, file_size
    ) values (
      v_version_id, v_archive->>'objectPath', btrim(v_archive->>'fileName'),
      nullif(v_archive->>'mimeType', ''), (v_archive->>'fileSize')::bigint
    );
  end loop;

  foreach v_recipient in array v_recipients loop
    insert into public.tasks(
      machine_id, assigned_to, task_type, title, description, status,
      start_date, deadline, technologist_request_approval_id
    ) values (
      v_request.machine_id, v_recipient, 'technologist_request_approval',
      'Проверить и одобрить заявку',
      'Заявка №' || v_request_number || ' для заказа «' || coalesce(v_machine_name, 'Без названия') || '»',
      'pending', (now() at time zone 'Europe/Uzhgorod')::date,
      (now() at time zone 'Europe/Uzhgorod')::date, v_version_id
    );
  end loop;

  update public.technologist_requests
  set status = 'pending_financial_approval', submitted_at = null, updated_at = now()
  where id = p_request_id;
  return v_version_id;
end;
$$;

create or replace function public.fn_begin_technologist_request_revision(p_request_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.technologist_requests%rowtype; v_version uuid;
begin
  if p_actor is null then raise exception 'Недостаточно прав'; end if;
  select * into v_request from public.technologist_requests where id = p_request_id for update;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  if v_request.status not in ('pending_financial_approval', 'pending_stock_check', 'stock_checked') then
    raise exception 'Редактирование на этом этапе недоступно';
  end if;
  if v_request.status = 'pending_financial_approval' then
    select id into v_version from public.technologist_request_approval_versions
    where request_id = p_request_id and state = 'pending' for update;
    if v_version is null then raise exception 'Актуальная версия не найдена'; end if;
    update public.technologist_request_approval_versions set state = 'superseded', updated_at = now() where id = v_version;
    update public.tasks set status = 'cancelled', completed_at = now(), updated_at = now()
    where technologist_request_approval_id = v_version and status in ('pending', 'in_progress');
  elsif not exists (
    select 1 from public.technologist_request_approval_versions
    where request_id = p_request_id and state in ('returned', 'superseded')
  ) then
    raise exception 'Версия для редактирования не найдена';
  end if;
  update public.technologist_requests set status = 'pending_stock_check', submitted_at = null, updated_at = now() where id = p_request_id;
end;
$$;

create or replace function public.fn_return_technologist_request_for_revision(
  p_approval_version_id uuid, p_actor uuid, p_reason text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_version public.technologist_request_approval_versions%rowtype; v_request public.technologist_requests%rowtype;
begin
  if p_actor is null then raise exception 'Недостаточно прав'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Укажите причину возврата'; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active and u.role = 'financial_director')
     and not exists (
       select 1 from public.users u join public.department_members dm on dm.user_id = u.id
       join public.positions p on p.id = dm.position_id
       where u.id = p_actor and u.is_active and p.is_active and p.name = 'Администратор CRM'
     ) then raise exception 'Вернуть заявку может финансовый директор или администратор CRM'; end if;
  select * into v_version from public.technologist_request_approval_versions where id = p_approval_version_id for update;
  if not found or v_version.state <> 'pending' then raise exception 'Решение по версии уже принято'; end if;
  select * into v_request from public.technologist_requests where id = v_version.request_id for update;
  if v_request.status <> 'pending_financial_approval' then raise exception 'Заявка больше не ожидает согласования'; end if;
  update public.technologist_request_approval_versions
    set state = 'returned', return_reason = btrim(p_reason), decided_by = p_actor, decided_at = now(), updated_at = now()
    where id = v_version.id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
    where technologist_request_approval_id = v_version.id and status in ('pending', 'in_progress');
  update public.technologist_requests set status = 'pending_stock_check', submitted_at = null, updated_at = now()
    where id = v_request.id;
  insert into public.notifications(user_id, type, title, message, related_machine_id)
  values (v_request.created_by, 'technologist_request_approval', 'Заявка возвращена на доработку', btrim(p_reason), v_request.machine_id);
end;
$$;

create or replace function public.fn_approve_technologist_request(
  p_approval_version_id uuid, p_actor uuid
) returns uuid language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare
  v_version public.technologist_request_approval_versions%rowtype;
  v_request public.technologist_requests%rowtype;
  v_completion uuid;
  v_original_sub text;
begin
  if p_actor is null then raise exception 'Недостаточно прав'; end if;
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active and u.role = 'financial_director')
     and not exists (
       select 1 from public.users u join public.department_members dm on dm.user_id = u.id
       join public.positions p on p.id = dm.position_id
       where u.id = p_actor and u.is_active and p.is_active and p.name = 'Администратор CRM'
     ) then raise exception 'Одобрить заявку может финансовый директор или администратор CRM'; end if;
  select * into v_version from public.technologist_request_approval_versions where id = p_approval_version_id for update;
  if not found or v_version.state <> 'pending' then raise exception 'Решение по версии уже принято'; end if;
  select * into v_request from public.technologist_requests where id = v_version.request_id for update;
  if v_request.status <> 'pending_financial_approval' then raise exception 'Заявка больше не ожидает согласования'; end if;

  -- The legacy finalizer is owner-bound. Keep its validations and side effects,
  -- but invoke it atomically as the immutable version's submitting technologist.
  update public.technologist_requests set status = 'stock_checked', updated_at = now() where id = v_request.id;
  v_original_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claim.sub', v_request.created_by::text, true);
  v_completion := public.fn_finalize_technologist_request_with_archives(
    v_request.id,
    v_request.created_by,
    v_version.completion_payload->>'decision',
    coalesce((v_version.completion_payload->>'enteredPlasmaMinutes')::integer, 0),
    coalesce(v_version.completion_payload->'wasteItems', '[]'::jsonb),
    coalesce(v_version.completion_payload->'futureItems', '[]'::jsonb),
    coalesce(v_version.completion_payload->'archives', '[]'::jsonb)
  );
  perform set_config('request.jwt.claim.sub', coalesce(v_original_sub, p_actor::text), true);

  update public.technologist_request_approval_versions
    set state = 'approved', decided_by = p_actor, decided_at = now(), updated_at = now()
    where id = v_version.id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
    where technologist_request_approval_id = v_version.id and status in ('pending', 'in_progress');
  return v_completion;
end;
$$;

revoke all on function public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb) from public, anon;
revoke all on function public.fn_begin_technologist_request_revision(uuid,uuid) from public, anon;
revoke all on function public.fn_return_technologist_request_for_revision(uuid,uuid,text) from public, anon;
revoke all on function public.fn_approve_technologist_request(uuid,uuid) from public, anon;
revoke all on function public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb) from authenticated;
revoke all on function public.fn_begin_technologist_request_revision(uuid,uuid) from authenticated;
revoke all on function public.fn_return_technologist_request_for_revision(uuid,uuid,text) from authenticated;
revoke all on function public.fn_approve_technologist_request(uuid,uuid) from authenticated;
grant execute on function public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.fn_begin_technologist_request_revision(uuid,uuid) to service_role;
grant execute on function public.fn_return_technologist_request_for_revision(uuid,uuid,text) to service_role;
grant execute on function public.fn_approve_technologist_request(uuid,uuid) to service_role;

-- Old public completion endpoints would bypass approval; only the approval RPC may invoke them.
revoke all on function public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb) from authenticated;
revoke all on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb) from authenticated;
grant execute on function public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb) to service_role;
grant execute on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb) to service_role;

-- Already handed-off requests become approved legacy versions. No fictitious approver is created.
insert into public.technologist_request_approval_versions(
  request_id, revision_number, state, completion_payload, summary_snapshot,
  submitted_by, submitted_at, decided_at, is_legacy
)
select r.id, 0, 'approved', '{}'::jsonb,
  jsonb_build_object('schemaVersion', 1, 'legacy', true),
  r.created_by, coalesce(r.submitted_at, r.updated_at, r.created_at),
  coalesce(r.submitted_at, r.updated_at, r.created_at), true
from public.technologist_requests r
where r.status in ('submitted_to_supply', 'completed')
  and not exists (select 1 from public.technologist_request_approval_versions v where v.request_id = r.id)
on conflict (request_id, revision_number) do nothing;

notify pgrst, 'reload schema';
