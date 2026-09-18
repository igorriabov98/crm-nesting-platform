-- Complete revision drafts, department-head authorization and contract company scope.

alter table public.department_access_permissions
  drop constraint if exists department_access_permissions_company_view_scope_check,
  drop constraint if exists department_access_permissions_company_manage_scope_check;

alter table public.department_access_permissions
  add constraint department_access_permissions_company_view_scope_check
    check (
      company_view_scope in ('own', 'all')
      and (company_view_scope = 'own' or resource_key in (
        'my_orders', 'client_identity', 'client_prices', 'contracts', 'invoices', 'client_payments'
      ))
    ),
  add constraint department_access_permissions_company_manage_scope_check
    check (
      company_manage_scope in ('own', 'all')
      and (company_manage_scope = 'own' or resource_key in (
        'my_orders', 'client_identity', 'client_prices', 'contracts', 'invoices', 'client_payments'
      ))
    );

-- A configured head_user_id is authoritative even while an old membership row
-- has not yet been synchronized to is_department_head.
create or replace function private.crm_has_permission(
  p_resource_key text,
  p_operation text default 'view'
) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_operation in ('view', 'manage') and exists (
    select 1 from public.users app_user
    where app_user.id = auth.uid() and app_user.is_active is true and (
      exists (
        select 1 from public.department_members member
        join public.positions position on position.id = member.position_id
        where member.user_id = app_user.id and position.is_active is true
          and position.name = 'Администратор CRM'
      ) or exists (
        select 1 from public.department_members member
        join public.departments department on department.id = member.department_id
        join public.department_access_permissions permission
          on permission.department_id = member.department_id
         and permission.subject_scope = case
           when member.is_department_head or department.head_user_id = member.user_id then 'head'
           else 'member'
         end
        where member.user_id = app_user.id and department.is_active
          and permission.resource_key = p_resource_key
          and case p_operation when 'manage' then permission.can_manage
            else permission.can_view or permission.can_manage end
      )
    )
  );
$$;

create or replace function private.crm_has_company_permission(
  p_resource_key text,
  p_operation text,
  p_client_id uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_resource_key in ('my_orders', 'client_identity', 'client_prices', 'contracts', 'invoices', 'client_payments')
    and p_client_id is not null
    and private.crm_has_permission(p_resource_key, p_operation)
    and exists (
      select 1 from public.users app_user
      where app_user.id = auth.uid() and app_user.is_active is true and (
        exists (
          select 1 from public.department_members member
          join public.positions position on position.id = member.position_id
          where member.user_id = app_user.id and position.is_active is true
            and position.name = 'Администратор CRM'
        ) or exists (
          select 1 from public.clients client
          where client.id = p_client_id and client.responsible_user_id = app_user.id
        ) or exists (
          select 1 from public.department_members member
          join public.departments department on department.id = member.department_id
          join public.department_access_permissions permission
            on permission.department_id = member.department_id
           and permission.subject_scope = case
             when member.is_department_head or department.head_user_id = member.user_id then 'head'
             else 'member'
           end
          where member.user_id = app_user.id and department.is_active
            and permission.resource_key = p_resource_key
            and case p_operation
              when 'manage' then permission.company_manage_scope = 'all' and permission.can_manage
              else permission.company_view_scope = 'all' and (permission.can_view or permission.can_manage)
            end
        )
      )
    );
$$;

revoke all on function private.crm_has_permission(text,text) from public, anon;
revoke all on function private.crm_has_company_permission(text,text,uuid) from public, anon;
grant execute on function private.crm_has_permission(text,text) to authenticated, service_role;
grant execute on function private.crm_has_company_permission(text,text,uuid) to authenticated, service_role;

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts for select to authenticated
  using (private.crm_has_company_permission('contracts', 'view', client_id));
drop policy if exists contracts_insert_sales on public.contracts;
create policy contracts_insert_sales on public.contracts for insert to authenticated
  with check (private.crm_has_company_permission('contracts', 'manage', client_id));
drop policy if exists contracts_update_sales on public.contracts;
create policy contracts_update_sales on public.contracts for update to authenticated
  using (private.crm_has_company_permission('contracts', 'manage', client_id))
  with check (private.crm_has_company_permission('contracts', 'manage', client_id));
drop policy if exists contracts_delete_sales on public.contracts;
create policy contracts_delete_sales on public.contracts for delete to authenticated
  using (private.crm_has_company_permission('contracts', 'manage', client_id));

-- The head is selected only from the named active department. Legacy role names
-- and fuzzy technologist department names are intentionally not fallbacks.
create or replace function public.fn_technologist_approval_department_head(p_name text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_head uuid;
begin
  select candidate.user_id into v_head
  from public.departments department
  cross join lateral (
    select department.head_user_id user_id, 0 priority where department.head_user_id is not null
    union all
    select member.user_id, 1 from public.department_members member
    where member.department_id = department.id and member.is_department_head
  ) candidate
  join public.users app_user on app_user.id = candidate.user_id and app_user.is_active
  where department.is_active and lower(btrim(department.name)) = lower(btrim(p_name))
  order by candidate.priority, department.created_at, candidate.user_id
  limit 1;
  return v_head;
end $$;

revoke all on function public.fn_technologist_approval_department_head(text) from public, anon, authenticated;
grant execute on function public.fn_technologist_approval_department_head(text) to service_role;

insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage)
select department.id, 'head', resource.key, true, true
from public.departments department
cross join (values ('technologist_request_results'), ('technologist_requests')) resource(key)
where department.is_active and lower(btrim(department.name)) = lower('Технический отдел')
on conflict (department_id, subject_scope, resource_key)
do update set can_view = true, can_manage = true;

insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage)
select department.id, 'head', 'technologist_request_results', true, true
from public.departments department
where department.is_active and lower(btrim(department.name)) = lower('Финансовый отдел')
on conflict (department_id, subject_scope, resource_key)
do update set can_view = true, can_manage = true;

-- Sales employees receive the module with own-company scope. Administrators can
-- change both view and manage scope to all companies in the access matrix.
insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage,
   company_view_scope, company_manage_scope)
select department.id, subject.scope, 'contracts', true, true, 'own', 'own'
from public.departments department
cross join (values ('head'), ('member')) subject(scope)
where department.is_active and lower(department.name) like '%продаж%'
on conflict (department_id, subject_scope, resource_key)
do update set can_view = true, can_manage = true;

create or replace function public.fn_restore_technologist_revision_positions(
  p_request_id uuid,
  p_source jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_table text;
  v_columns text;
  v_rows jsonb;
  v_replication_role text := current_setting('session_replication_role');
begin
  if p_source is null or jsonb_typeof(p_source) <> 'object' then
    raise exception 'Снимок исходной заявки не найден';
  end if;

  -- Approval snapshots already contain the validated calculated and lifecycle
  -- values. Replaying business triggers while restoring them can both mutate
  -- that immutable snapshot and invoke legacy trigger functions whose hardened
  -- search_path no longer resolves unqualified relations. The SECURITY DEFINER
  -- owner is the migration owner, so trigger suppression remains scoped to this
  -- transaction and is restored before returning to the caller.
  perform set_config('session_replication_role', 'replica', true);

  foreach v_table in array array[
    'request_sheet_metal','request_round_tube','request_circle','request_pipe',
    'request_knives','request_components','request_paint','request_mesh','request_chain_cord'
  ] loop
    v_rows := coalesce(p_source->v_table, '[]'::jsonb);
    if jsonb_typeof(v_rows) <> 'array' then raise exception 'Некорректный снимок позиций'; end if;
    if exists (
      select 1 from jsonb_array_elements(v_rows) row
      where row->>'request_id' is distinct from p_request_id::text
    ) then raise exception 'Снимок относится к другой заявке'; end if;
    if jsonb_array_length(v_rows) = 0 then continue; end if;
    select string_agg(format('%I', attribute.attname), ', ' order by attribute.attnum)
      into v_columns
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = format('public.%I', v_table)::regclass
      and attribute.attnum > 0 and not attribute.attisdropped
      and attribute.attgenerated = '' and attribute.attidentity = '';
    execute format(
      'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict (id) do nothing',
      v_table, v_columns
    ) using v_rows;
  end loop;

  perform set_config('session_replication_role', v_replication_role, true);
exception when others then
  perform set_config('session_replication_role', v_replication_role, true);
  raise;
end $$;

revoke all on function public.fn_restore_technologist_revision_positions(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.fn_restore_technologist_revision_positions(uuid,jsonb) to service_role;

create or replace function public.fn_begin_technologist_request_revision(p_request_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request public.technologist_requests%rowtype; v_version uuid;
  v_original uuid; v_original_active boolean; v_next integer;
  v_source jsonb; v_created integer;
begin
  if not exists (select 1 from public.users where id = p_actor and is_active) then raise exception 'Недостаточно прав'; end if;
  select * into v_request from public.technologist_requests where id = p_request_id for update;
  if not found then raise exception 'Заявка недоступна'; end if;
  select submitted_by into v_original from public.technologist_request_approval_versions
    where request_id = p_request_id and revision_number = 0;
  select coalesce(is_active, false) into v_original_active from public.users where id = v_original;
  if p_actor is distinct from v_original and p_actor is distinct from v_request.created_by
    and not (not coalesce(v_original_active, false) and exists (
      select 1 from public.tasks task
      join public.technologist_request_approval_versions version on version.id = task.technologist_request_approval_id
      where version.request_id = p_request_id and task.task_type = 'technologist_request_revision'
        and task.assigned_to = p_actor and task.status in ('pending', 'in_progress')
    )) then raise exception 'Редактирование доступно только ответственному технологу'; end if;
  if v_request.status not in ('pending_financial_approval', 'pending_stock_check', 'stock_checked') then
    raise exception 'Редактирование на этом этапе недоступно';
  end if;
  if v_request.status = 'pending_financial_approval' then
    select id into v_version from public.technologist_request_approval_versions
      where request_id = p_request_id and state = 'pending' for update;
    if v_version is null then raise exception 'Актуальная версия не найдена'; end if;
    update public.technologist_request_approval_versions set state = 'superseded', updated_at = now() where id = v_version;
    update public.tasks set status = 'cancelled', completed_at = now(), updated_at = now()
      where technologist_request_approval_id = v_version and task_type = 'technologist_request_approval'
        and status in ('pending', 'in_progress');
    update public.department_requests set status = 'cancelled', completed_at = now()
      where technologist_approval_version_id = v_version and request_kind = 'technologist_approval'
        and status in ('new', 'in_progress');
  elsif not exists (select 1 from public.technologist_request_approval_versions
    where request_id = p_request_id and state in ('returned', 'superseded')) then
    raise exception 'Версия для редактирования не найдена';
  end if;
  if not coalesce(v_original_active, false) and v_request.created_by <> p_actor then
    update public.technologist_requests set created_by = p_actor where id = p_request_id;
  end if;
  select coalesce(max(revision_number), -1) + 1 into v_next
    from public.technologist_request_approval_versions where request_id = p_request_id;
  insert into public.technologist_request_revision_drafts(request_id, revision_number, editor_id)
    values (p_request_id, v_next, p_actor) on conflict (request_id) do nothing;
  get diagnostics v_created = row_count;
  perform set_config('app.financial_approval_request', p_request_id::text, true);
  update public.technologist_requests set status = 'pending_stock_check', submitted_at = null, updated_at = now()
    where id = p_request_id;
  perform set_config('app.financial_approval_request', '', true);
  if v_created > 0 then
    select version.summary_snapshot->'sourceData' into v_source
    from public.technologist_request_approval_versions version
    where version.request_id = p_request_id
    order by version.revision_number desc limit 1;
    perform public.fn_restore_technologist_revision_positions(p_request_id, v_source);
  end if;
end $$;

revoke all on function public.fn_begin_technologist_request_revision(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fn_begin_technologist_request_revision(uuid,uuid) to service_role;

-- Repair missing rows in drafts that existed before this migration without
-- overwriting positions the editor has already changed.
do $$ declare draft record; v_source jsonb; begin
  for draft in select request_id from public.technologist_request_revision_drafts loop
    select version.summary_snapshot->'sourceData' into v_source
    from public.technologist_request_approval_versions version
    where version.request_id = draft.request_id
    order by version.revision_number desc limit 1;
    if v_source is not null then
      perform public.fn_restore_technologist_revision_positions(draft.request_id, v_source);
    end if;
  end loop;
end $$;

-- Rework requests stay personal while the original submitter is active. The
-- shared pool is used only when that user is inactive, with the Technical
-- department head receiving the task and notification.
do $$ declare v_definition text; v_updated text; begin
  v_definition := pg_get_functiondef('public.fn_return_technologist_request_for_revision(uuid,uuid,text)'::regprocedure);
  v_updated := replace(v_definition,
    'fn_technologist_approval_department_head(''technologist'')',
    'fn_technologist_approval_department_head(''Технический отдел'')');
  if v_updated = v_definition then raise exception 'Revision routing contract changed'; end if;
  v_updated := replace(v_updated,
    'Не назначен действующий начальник отдела технологов',
    'Не назначен действующий начальник Технического отдела');
  execute v_updated;
end $$;

-- The exact finance head check is sufficient for a decision. Matrix view rights
-- still control page access, while an outdated member flag cannot reject the RPC.
do $$ declare v_name text; v_definition text; v_updated text; begin
  foreach v_name in array array['fn_approve_technologist_request(uuid,uuid)', 'fn_return_technologist_request_for_revision(uuid,uuid,text)'] loop
    v_definition := pg_get_functiondef(v_name::regprocedure);
    v_updated := replace(v_definition,
      E'    or not private.crm_has_permission(''technologist_request_results'', ''manage'')\n    then',
      E'    then');
    if v_updated = v_definition then raise exception 'Finance decision permission contract changed for %', v_name; end if;
    execute v_updated;
  end loop;
end $$;
