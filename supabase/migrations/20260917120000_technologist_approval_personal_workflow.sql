alter table public.department_requests drop constraint department_requests_target_check;
alter table public.department_requests add constraint department_requests_target_check
  check (target_department in ('technologist', 'supply', 'production', 'planning', 'finance'));
alter table public.department_requests drop constraint department_requests_kind_check;
alter table public.department_requests add constraint department_requests_kind_check
  check (request_kind in ('manual', 'machine_layout', 'long_stock_recalculation',
    'supply_position_revision', 'transport_trip_date_approval',
    'technologist_approval', 'technologist_revision'));
alter table public.department_requests add column technologist_approval_version_id uuid
  references public.technologist_request_approval_versions(id) on delete restrict;
create unique index department_requests_technologist_approval_kind_unique
  on public.department_requests(technologist_approval_version_id, request_kind)
  where technologist_approval_version_id is not null;

create table public.technologist_request_revision_drafts (
  request_id uuid primary key references public.technologist_requests(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  editor_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
revoke all on public.technologist_request_revision_drafts from public, anon, authenticated;
grant all on public.technologist_request_revision_drafts to service_role;

-- The department head is the configured person, not every holder of a legacy role.
create or replace function public.fn_technologist_approval_department_head(p_name text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_head uuid;
begin
  select candidate.user_id into v_head
  from public.departments d
  cross join lateral (
    select d.head_user_id user_id, 0 priority where d.head_user_id is not null
    union all
    select dm.user_id, 1 from public.department_members dm
    where dm.department_id = d.id and dm.is_department_head
  ) candidate
  join public.users u on u.id = candidate.user_id and u.is_active
  where d.is_active and (
    lower(btrim(d.name)) = lower(p_name)
    or (p_name = 'technologist' and lower(d.name) like '%технолог%')
  )
  order by candidate.priority, d.created_at, candidate.user_id limit 1;
  return v_head;
end $$;

create or replace function public.fn_begin_technologist_request_revision(p_request_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request public.technologist_requests%rowtype; v_version uuid;
  v_original uuid; v_original_active boolean; v_next integer;
begin
  if not exists (select 1 from public.users where id = p_actor and is_active) then
    raise exception 'Недостаточно прав';
  end if;
  select * into v_request from public.technologist_requests where id = p_request_id for update;
  if not found then raise exception 'Заявка недоступна'; end if;
  select submitted_by into v_original from public.technologist_request_approval_versions
  where request_id = p_request_id and revision_number = 0;
  select coalesce(is_active, false) into v_original_active from public.users where id = v_original;
  if p_actor is distinct from v_original and p_actor is distinct from v_request.created_by
    and not (not coalesce(v_original_active, false) and exists (
      select 1 from public.tasks t
      join public.technologist_request_approval_versions v on v.id = t.technologist_request_approval_id
      where v.request_id = p_request_id and t.task_type = 'technologist_request_revision'
        and t.assigned_to = p_actor and t.status in ('pending', 'in_progress')
    )) then raise exception 'Редактирование доступно только ответственному технологу'; end if;
  if v_request.status not in ('pending_financial_approval', 'pending_stock_check', 'stock_checked') then
    raise exception 'Редактирование на этом этапе недоступно';
  end if;
  if v_request.status = 'pending_financial_approval' then
    select id into v_version from public.technologist_request_approval_versions
    where request_id = p_request_id and state = 'pending' for update;
    if v_version is null then raise exception 'Актуальная версия не найдена'; end if;
    update public.technologist_request_approval_versions
      set state = 'superseded', updated_at = now() where id = v_version;
    update public.tasks set status = 'cancelled', completed_at = now(), updated_at = now()
      where technologist_request_approval_id = v_version
        and task_type = 'technologist_request_approval' and status in ('pending', 'in_progress');
    update public.department_requests set status = 'cancelled', completed_at = now()
      where technologist_approval_version_id = v_version
        and request_kind = 'technologist_approval' and status in ('new', 'in_progress');
  elsif not exists (select 1 from public.technologist_request_approval_versions
    where request_id = p_request_id and state in ('returned', 'superseded')) then
    raise exception 'Версия для редактирования не найдена';
  end if;
  -- Retain the first submitter in version history. Transfer the editable source
  -- row only when that person is inactive and the head takes the rework task.
  if not coalesce(v_original_active, false) and v_request.created_by <> p_actor then
    update public.technologist_requests set created_by = p_actor where id = p_request_id;
  end if;
  select coalesce(max(revision_number), -1) + 1 into v_next
  from public.technologist_request_approval_versions where request_id = p_request_id;
  insert into public.technologist_request_revision_drafts(request_id, revision_number, editor_id)
    values (p_request_id, v_next, p_actor) on conflict (request_id) do nothing;
  perform set_config('app.financial_approval_request', p_request_id::text, true);
  update public.technologist_requests set status = 'pending_stock_check', submitted_at = null,
    updated_at = now() where id = p_request_id;
  perform set_config('app.financial_approval_request', '', true);
end $$;
revoke all on function public.fn_begin_technologist_request_revision(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fn_begin_technologist_request_revision(uuid,uuid) to service_role;
revoke all on function public.fn_technologist_approval_department_head(text) from public, anon, authenticated;
grant execute on function public.fn_technologist_approval_department_head(text) to service_role;

-- Head access is needed in both Next server permissions and PostgreSQL RPC/RLS.
insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage)
select d.id, 'head', 'technologist_request_results', true, true
from public.departments d where lower(btrim(d.name)) = lower('Финансовый отдел') and d.is_active
on conflict (department_id, subject_scope, resource_key)
do update set can_view = true, can_manage = true;

insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage)
select d.id, 'head', resource.key, true, true
from public.departments d
cross join (values ('technologist_request_results'), ('technologist_requests')) resource(key)
where d.is_active and lower(d.name) like '%технолог%'
on conflict (department_id, subject_scope, resource_key)
do update set can_view = true, can_manage = true;

create or replace function public.fn_technologist_approval_work_item(
  p_version_id uuid, p_kind text, p_actor uuid, p_assignee uuid, p_message text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_version public.technologist_request_approval_versions%rowtype;
  v_request public.technologist_requests%rowtype; v_id uuid; v_title text;
begin
  select * into v_version from public.technologist_request_approval_versions where id = p_version_id;
  select * into v_request from public.technologist_requests where id = v_version.request_id;
  if p_kind not in ('technologist_approval', 'technologist_revision') or v_request.id is null then
    raise exception 'Некорректная версия согласования';
  end if;
  v_title := case when p_kind = 'technologist_approval'
    then 'Проверить заявку технолога' else 'Доработать заявку технолога' end;
  insert into public.department_requests(
    request_kind, technologist_approval_version_id, target_department, title,
    description, created_by, assigned_to, machine_id, due_date, status
  ) values (
    p_kind, p_version_id,
    case when p_kind = 'technologist_approval' then 'finance' else 'technologist' end,
    v_title, p_message, p_actor, p_assignee, v_request.machine_id,
    (now() at time zone 'Europe/Kyiv')::date, 'new'
  ) on conflict do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.department_requests
    where technologist_approval_version_id = p_version_id and request_kind = p_kind;
  end if;
  if p_assignee is not null and not exists (
    select 1 from public.notifications where user_id = p_assignee
      and related_department_request_id = v_id
      and type = 'department_request_new_' || p_kind
  ) then
    insert into public.notifications(user_id, type, title, message,
      related_machine_id, related_department_request_id)
    values (p_assignee, 'department_request_new_' || p_kind, v_title,
      p_message, v_request.machine_id, v_id);
  end if;
  return v_id;
end $$;
revoke all on function public.fn_technologist_approval_work_item(uuid,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.fn_technologist_approval_work_item(uuid,text,uuid,uuid,text) to service_role;

-- Existing department notifications broadcast to every technologist. Workflow
-- requests deliver only to their assigned person (or the pool head).
do $$ declare v_definition text; v_updated text; begin
  v_definition := pg_get_functiondef('public.notify_department_request_change()'::regprocedure);
  v_updated := replace(v_definition, E'begin\n  target_label :=',
    E'begin\n  if new.request_kind in (''technologist_approval'', ''technologist_revision'') then return new; end if;\n  target_label :=');
  if v_updated = v_definition then raise exception 'Department notification hook changed'; end if;
  execute v_updated;
end $$;

-- Preserve the validated snapshot and archive logic in the deployed submit RPC,
-- replacing only routing and the associated work-item transitions.
do $$ declare v_definition text; v_updated text; begin
  v_definition := pg_get_functiondef('public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
  v_updated := replace(v_definition,
    $old$  select coalesce(array_agg(u.id order by u.id), '{}'::uuid[]) into v_recipients
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
  end if;$old$,
    $new$  v_recipients := array[public.fn_technologist_approval_department_head('Финансовый отдел')];
  if v_recipients[1] is null then
    raise exception 'Не назначен действующий начальник Финансового отдела';
  end if;$new$);
  if v_updated = v_definition then raise exception 'Approval submit recipient contract changed'; end if;
  v_definition := v_updated;
  v_updated := replace(v_definition,
    $old$  perform set_config('app.financial_approval_request', p_request_id::text, true);$old$,
    $new$  perform public.fn_technologist_approval_work_item(
    v_version_id, 'technologist_approval', p_actor, v_recipients[1],
    'Проверьте заявку №' || v_request_number || ' для заказа «' || coalesce(v_machine_name, 'Без названия') || '» сегодня.'
  );
  update public.department_requests d set status = 'done', completed_by = p_actor, completed_at = now()
  where d.request_kind = 'technologist_revision' and d.status in ('new', 'in_progress')
    and d.technologist_approval_version_id in (
      select id from public.technologist_request_approval_versions where request_id = p_request_id
    );
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
  where task_type = 'technologist_request_revision' and status in ('pending', 'in_progress')
    and technologist_request_approval_id in (
      select id from public.technologist_request_approval_versions where request_id = p_request_id
    );
  delete from public.technologist_request_revision_drafts where request_id = p_request_id;
  perform set_config('app.financial_approval_request', p_request_id::text, true);$new$);
  if v_updated = v_definition then raise exception 'Approval submit transition contract changed'; end if;
  execute v_updated;
end $$;

do $$ declare v_definition text; v_updated text; begin
  v_definition := pg_get_functiondef('public.fn_return_technologist_request_for_revision(uuid,uuid,text)'::regprocedure);
  v_updated := replace(v_definition,
    $old$if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_request_results', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;$old$,
    $new$if p_actor is distinct from auth.uid()
    or p_actor is distinct from public.fn_technologist_approval_department_head('Финансовый отдел')
    or not private.crm_has_permission('technologist_request_results', 'manage')
    then raise exception 'Согласование доступно только начальнику Финансового отдела' using errcode = '42501'; end if;$new$);
  if v_updated = v_definition then raise exception 'Approval return permission contract changed'; end if;
  v_definition := v_updated;
  v_updated := replace(v_definition,
    $old$declare v_version public.technologist_request_approval_versions%rowtype; v_request public.technologist_requests%rowtype;$old$,
    $new$declare v_version public.technologist_request_approval_versions%rowtype;
  v_request public.technologist_requests%rowtype; v_assignee uuid; v_original uuid;$new$);
  if v_updated = v_definition then raise exception 'Approval return declaration changed'; end if;
  v_definition := v_updated;
  v_updated := replace(v_definition,
    $old$  insert into public.notifications(user_id, type, title, message, related_machine_id)
  values (v_request.created_by, 'technologist_request_approval', 'Заявка возвращена на доработку', btrim(p_reason), v_request.machine_id);$old$,
    $new$  update public.department_requests set status = 'rejected', completed_by = p_actor,
    completed_at = now(), response = btrim(p_reason)
  where technologist_approval_version_id = v_version.id
    and request_kind = 'technologist_approval' and status in ('new', 'in_progress');
  select v.submitted_by into v_original
  from public.technologist_request_approval_versions v
  where v.request_id = v_request.id and v.revision_number = 0;
  select u.id into v_assignee from public.users u
  where u.id = v_original and u.is_active;
  if v_assignee is null then
    v_assignee := public.fn_technologist_approval_department_head('technologist');
    if v_assignee is null then raise exception 'Не назначен действующий начальник отдела технологов'; end if;
  end if;
  perform public.fn_technologist_approval_work_item(
    v_version.id, 'technologist_revision', p_actor,
    case when v_assignee = v_original then v_assignee else null end,
    'Заявка возвращена на доработку. Причина: ' || btrim(p_reason)
  );
  insert into public.tasks(machine_id, assigned_to, task_type, title, description,
    status, start_date, deadline, technologist_request_approval_id,
    technologist_request_approval_machine_id)
  values (null, v_assignee, 'technologist_request_revision', 'Доработать заявку',
    btrim(p_reason), 'pending', (now() at time zone 'Europe/Kyiv')::date,
    (now() at time zone 'Europe/Kyiv')::date, v_version.id, v_request.machine_id);
  if v_assignee is distinct from v_original then
    insert into public.notifications(user_id, type, title, message, related_machine_id,
      related_department_request_id)
    select v_assignee, 'department_request_new_technologist_revision',
      'Заявка возвращена на доработку', btrim(p_reason), v_request.machine_id, d.id
    from public.department_requests d where d.technologist_approval_version_id = v_version.id
      and d.request_kind = 'technologist_revision';
  end if;$new$);
  if v_updated = v_definition then raise exception 'Approval return notification contract changed'; end if;
  execute v_updated;
end $$;

do $$ declare v_definition text; v_updated text; begin
  v_definition := pg_get_functiondef('public.fn_approve_technologist_request(uuid,uuid)'::regprocedure);
  v_updated := replace(v_definition,
    $old$if p_actor is distinct from auth.uid() or not private.crm_has_permission('technologist_request_results', 'manage') then raise exception 'Недостаточно прав' using errcode = '42501'; end if;$old$,
    $new$if p_actor is distinct from auth.uid()
    or p_actor is distinct from public.fn_technologist_approval_department_head('Финансовый отдел')
    or not private.crm_has_permission('technologist_request_results', 'manage')
    then raise exception 'Согласование доступно только начальнику Финансового отдела' using errcode = '42501'; end if;$new$);
  if v_updated = v_definition then raise exception 'Approval decision permission contract changed'; end if;
  v_definition := v_updated;
  v_updated := replace(v_definition,
    $old$  insert into public.notifications(user_id, type, title, message, related_machine_id)
  select u.id, 'technologist_request', 'Заявка одобрена и готова для снабжения',$old$,
    $new$  update public.department_requests set status = 'done', completed_by = p_actor,
    completed_at = now(), response = 'Заявка одобрена'
  where technologist_approval_version_id = v_version.id
    and request_kind = 'technologist_approval' and status in ('new', 'in_progress');
  insert into public.notifications(user_id, type, title, message, related_machine_id)
  select u.id, 'technologist_request', 'Заявка одобрена и готова для снабжения',$new$);
  if v_updated = v_definition then raise exception 'Approval decision contract changed'; end if;
  execute v_updated;
end $$;

create or replace function public.fn_guard_technologist_approval_work_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_state text;
begin
  if old.request_kind not in ('technologist_approval', 'technologist_revision') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then raise exception 'Запрос согласования нельзя удалить'; end if;
  if new.assigned_to is distinct from old.assigned_to
    or new.technologist_approval_version_id is distinct from old.technologist_approval_version_id
    or new.request_kind is distinct from old.request_kind then
    raise exception 'Адресата запроса согласования нельзя изменить';
  end if;
  if new.status is not distinct from old.status then return new; end if;
  select state into v_state from public.technologist_request_approval_versions
    where id = old.technologist_approval_version_id;
  if old.request_kind = 'technologist_approval' and (
    (new.status = 'done' and v_state = 'approved')
    or (new.status = 'rejected' and v_state = 'returned')
    or (new.status = 'cancelled' and v_state = 'superseded')
  ) then return new; end if;
  if old.request_kind = 'technologist_revision' and new.status = 'done'
    and exists (select 1 from public.technologist_request_approval_versions newer
      join public.technologist_request_approval_versions previous
        on previous.request_id = newer.request_id
      where previous.id = old.technologist_approval_version_id
        and newer.revision_number > previous.revision_number)
  then return new; end if;
  raise exception 'Запрос завершается только решением по заявке';
end $$;
create trigger guard_technologist_approval_work_item
before update or delete on public.department_requests
for each row execute function public.fn_guard_technologist_approval_work_item();
revoke all on function public.fn_guard_technologist_approval_work_item() from public, anon, authenticated;

create or replace function public.fn_guard_technologist_revision_task()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.task_type <> 'technologist_request_revision' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE'
    or new.assigned_to is distinct from old.assigned_to
    or new.technologist_request_approval_id is distinct from old.technologist_request_approval_id
  then raise exception 'Задачу доработки нельзя удалить или переназначить'; end if;
  if new.status in ('completed', 'cancelled') and old.status in ('pending', 'in_progress')
    and not exists (
      select 1 from public.technologist_request_approval_versions newer
      join public.technologist_request_approval_versions previous
        on previous.request_id = newer.request_id
      where previous.id = old.technologist_request_approval_id
        and newer.revision_number > previous.revision_number
    ) then raise exception 'Задача завершается после повторной отправки заявки'; end if;
  return new;
end $$;
create trigger guard_technologist_revision_task
before update or delete on public.tasks
for each row execute function public.fn_guard_technologist_revision_task();
revoke all on function public.fn_guard_technologist_revision_task() from public, anon, authenticated;

-- Restore work items for versions that were already returned before this
-- migration. The unique indexes and NOT EXISTS guards make the repair idempotent.
do $$ declare row record; v_original uuid; v_assignee uuid; begin
  for row in
    select v.id version_id, v.request_id, v.return_reason, r.machine_id,
      coalesce(v.decided_by, v.submitted_by, r.created_by) actor_id
    from public.technologist_request_approval_versions v
    join public.technologist_requests r on r.id = v.request_id
    where v.state = 'returned'
      and not exists (select 1 from public.technologist_request_approval_versions newer
        where newer.request_id = v.request_id and newer.revision_number > v.revision_number)
  loop
    select submitted_by into v_original
    from public.technologist_request_approval_versions
    where request_id = row.request_id and revision_number = 0;
    select u.id into v_assignee from public.users u where u.id = v_original and u.is_active;
    if v_assignee is null then
      v_assignee := public.fn_technologist_approval_department_head('technologist');
    end if;
    if v_assignee is null then continue; end if;
    perform public.fn_technologist_approval_work_item(
      row.version_id, 'technologist_revision', row.actor_id,
      case when v_assignee = v_original then v_assignee else null end,
      'Заявка возвращена на доработку. Причина: ' || coalesce(row.return_reason, 'Уточните заявку')
    );
    if v_assignee is distinct from v_original and not exists (
      select 1 from public.notifications n
      join public.department_requests d on d.id = n.related_department_request_id
      where n.user_id = v_assignee and d.technologist_approval_version_id = row.version_id
        and n.type = 'department_request_new_technologist_revision'
    ) then
      insert into public.notifications(user_id, type, title, message, related_machine_id,
        related_department_request_id)
      select v_assignee, 'department_request_new_technologist_revision',
        'Заявка возвращена на доработку', coalesce(row.return_reason, 'Уточните заявку'),
        row.machine_id, d.id
      from public.department_requests d where d.technologist_approval_version_id = row.version_id
        and d.request_kind = 'technologist_revision';
    end if;
    if not exists (select 1 from public.tasks where technologist_request_approval_id = row.version_id
      and task_type = 'technologist_request_revision' and status in ('pending', 'in_progress')) then
      insert into public.tasks(machine_id, assigned_to, task_type, title, description,
        status, start_date, deadline, technologist_request_approval_id,
        technologist_request_approval_machine_id)
      values (null, v_assignee, 'technologist_request_revision', 'Доработать заявку',
        coalesce(row.return_reason, 'Уточните заявку'), 'pending',
        (now() at time zone 'Europe/Kyiv')::date,
        (now() at time zone 'Europe/Kyiv')::date, row.version_id, row.machine_id);
    end if;
  end loop;
end $$;
