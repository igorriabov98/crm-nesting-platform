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
alter table public.tasks
  add column if not exists technologist_request_approval_machine_id uuid;
-- Keep the existing tasks->machines relation unambiguous for all legacy queries.
-- The authoritative FK remains task->version->request->machine.
create or replace function public.approval_machine(p_task public.tasks)
returns setof public.machines rows 1 language sql stable set search_path = public, pg_temp as $$
  select m.* from public.machines m where m.id = p_task.technologist_request_approval_machine_id
    and exists (select 1 from public.technologist_request_approval_versions v join public.technologist_requests r on r.id = v.request_id
      where v.id = p_task.technologist_request_approval_id and r.machine_id = m.id);
$$;
grant execute on function public.approval_machine(public.tasks) to authenticated;
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

revoke all on public.technologist_request_approval_versions, public.technologist_request_approval_archives from public, anon, authenticated;
grant select on public.technologist_request_approval_versions to authenticated;
grant select on public.technologist_request_approval_archives to authenticated;
grant all on public.technologist_request_approval_versions to service_role;
grant all on public.technologist_request_approval_archives to service_role;

-- Restrictive policies apply in addition to existing material-access policies.
create or replace function public.fn_financial_supply_visibility(p_request_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.technologist_requests r where r.id = p_request_id and r.status in ('submitted_to_supply','completed'))
    or (not exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('supply_manager','procurement_head')) and (
      exists (select 1 from public.technologist_requests r where r.id = p_request_id and r.created_by = auth.uid())
      or exists (select 1 from public.technologist_requests r join public.tasks t on t.machine_id = r.machine_id
        where r.id = p_request_id and t.assigned_to = auth.uid() and t.task_type = 'technologist_request' and t.status in ('pending','in_progress','completed'))
      or exists (select 1 from public.users u where u.id = auth.uid() and u.is_active and u.role in ('planning_director','financial_director','commercial_director'))
      or exists (select 1 from public.users u join public.department_members dm on dm.user_id = u.id join public.positions p on p.id = dm.position_id
        where u.id = auth.uid() and u.is_active and p.is_active and p.name = 'Администратор CRM')
    ));
$$;
grant execute on function public.fn_financial_supply_visibility(uuid) to authenticated;
create policy financial_supply_request_visibility on public.technologist_requests as restrictive
for select to authenticated using (public.fn_financial_supply_visibility(id));
create policy financial_request_insert_state on public.technologist_requests as restrictive
for insert to authenticated with check (status::text not in ('pending_financial_approval','submitted_to_supply','completed'));
do $$ declare v_table text; begin
  foreach v_table in array array['request_sheet_metal','request_round_tube','request_circle','request_pipe',
    'request_knives','request_components','request_paint','request_mesh','request_chain_cord'] loop
    execute format('create policy financial_supply_item_visibility on public.%I as restrictive for all to authenticated using (public.fn_financial_supply_visibility(request_id)) with check (public.fn_financial_supply_visibility(request_id))', v_table);
  end loop;
end $$;

insert into public.role_permissions(role, resource_key, can_view, can_manage)
select role_value, 'technologist_request_results', true, role_value = 'financial_director'
from unnest(array['technologist'::public.user_role, 'financial_director'::public.user_role]) role_value
on conflict (role, resource_key) do update
set can_view = excluded.can_view,
    can_manage = excluded.can_manage;

-- Serialise material changes with submission/decision using the same parent lock.
create or replace function public.fn_guard_financial_approval_item()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request_id uuid; v_status text; v_fields text[] := array[
  'order_status', 'ordered_at', 'delivered_at', 'custom_delivery_date', 'supplier_id',
  'stock_on_hand_kg', 'stock_parts_kg', 'reserved_from_stock_kg', 'stock_sheet_size',
  'reserved_from_stock_mm', 'reserved_from_stock_length_mm', 'reserved_from_stock_qty',
  'reserved_from_stock', 'stock_remainder',
  'cancelled_at', 'cancelled_by', 'cancellation_reason', 'to_order_kg'
];
begin
  v_request_id := case when tg_op = 'DELETE' then old.request_id else new.request_id end;
  -- Generated columns are unavailable in NEW during BEFORE triggers.
  -- Compare their input fields instead, never OLD's computed value with NULL.
  v_fields := v_fields || coalesce((select array_agg(attname::text) from pg_attribute where attrelid = tg_relid and attgenerated <> '' and not attisdropped), '{}'::text[]);
  select status::text into v_status from public.technologist_requests where id = v_request_id for update;
  if v_status = 'pending_financial_approval' then
    raise exception 'Сначала верните заявку на редактирование';
  end if;
  if tg_op = 'UPDATE' and new.order_status is distinct from old.order_status
     and new.order_status in ('ordered','delivered') and v_status not in ('submitted_to_supply','completed') then
    raise exception 'Заявка ещё не передана в снабжение';
  end if;
  if exists (select 1 from public.technologist_request_approval_versions where request_id = v_request_id and state = 'approved')
     and (tg_op <> 'UPDATE' or (to_jsonb(new) - v_fields) is distinct from (to_jsonb(old) - v_fields)) then
    raise exception 'Одобренную заявку нельзя редактировать';
  end if;
  if tg_op = 'UPDATE' and old.request_id <> new.request_id then
    raise exception 'Нельзя переносить позицию между заявками';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$ declare v_table text; begin
  foreach v_table in array array['request_sheet_metal','request_round_tube','request_circle','request_pipe',
    'request_knives','request_components','request_paint','request_mesh','request_chain_cord'] loop
    execute format('create trigger zz_financial_approval_item_guard before insert or update or delete on public.%I for each row execute function public.fn_guard_financial_approval_item()', v_table);
  end loop;
end $$;

create or replace function public.fn_guard_financial_linked_operation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row jsonb; v_table text; v_item uuid; v_request uuid; v_old_request uuid; v_lock_request uuid; v_status text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_table := v_row->>'request_item_table'; v_item := (v_row->>'request_item_id')::uuid;
  if v_table not in ('request_sheet_metal','request_round_tube','request_circle','request_pipe',
    'request_knives','request_components','request_paint','request_mesh','request_chain_cord') or v_item is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  execute format('select request_id from public.%I where id = $1', v_table) into v_request using v_item;
  if tg_table_name = 'supply_order_delivery_schedules' and v_request is null then raise exception 'Заявка ещё не передана в снабжение'; end if;
  if tg_op = 'UPDATE' and old.request_item_table in ('request_sheet_metal','request_round_tube','request_circle','request_pipe',
    'request_knives','request_components','request_paint','request_mesh','request_chain_cord') then
    execute format('select request_id from public.%I where id = $1', old.request_item_table) into v_old_request using old.request_item_id;
  end if;
  for v_lock_request in select distinct id from unnest(array[v_request,v_old_request]) id where id is not null order by id loop
  select status::text into v_status from public.technologist_requests where id = v_lock_request for update;
  if v_status = 'pending_financial_approval'
     or (tg_table_name = 'supply_order_delivery_schedules' and (v_status is null or v_status not in ('submitted_to_supply','completed')))
     or (exists (select 1 from public.users where id = auth.uid() and role in ('supply_manager','procurement_head'))
       and v_status not in ('submitted_to_supply','completed')) then
    raise exception 'Заявка ещё не передана в снабжение';
  end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger zz_financial_reservation_guard before insert or update or delete on public.inventory_reservations
for each row execute function public.fn_guard_financial_linked_operation();
create trigger zz_financial_schedule_guard before insert or update or delete on public.supply_order_delivery_schedules
for each row execute function public.fn_guard_financial_linked_operation();

create or replace function public.fn_guard_financial_cutting_definition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row jsonb; v_request uuid; v_status text;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  for v_request in
    select distinct request_id from public.long_stock_cutting_plan_items
      where plan_id = (v_row->>'plan_id')::uuid
    union select (v_row->>'request_id')::uuid where v_row->>'request_id' is not null
    order by 1
  loop
    select status::text into v_status from public.technologist_requests where id = v_request for update;
    if v_status = 'pending_financial_approval' then raise exception 'Сначала верните заявку на редактирование'; end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger zz_financial_cutting_definition_guard before insert or update or delete on public.long_stock_cutting_plan_versions
for each row execute function public.fn_guard_financial_cutting_definition();
create trigger zz_financial_cutting_link_guard before insert or update or delete on public.long_stock_cutting_plan_items
for each row execute function public.fn_guard_financial_cutting_definition();

create or replace function public.fn_guard_financial_approval_version()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'Историю согласования нельзя удалять'; end if;
  if (to_jsonb(new) - array['state','decided_by','decided_at','return_reason','updated_at'])
     is distinct from (to_jsonb(old) - array['state','decided_by','decided_at','return_reason','updated_at'])
     or old.state <> 'pending' or new.state not in ('returned','superseded','approved') then
    raise exception 'Снимок версии согласования неизменяем';
  end if;
  return new;
end;
$$;
create trigger financial_approval_version_immutable before update or delete
on public.technologist_request_approval_versions for each row execute function public.fn_guard_financial_approval_version();

create or replace function public.fn_guard_financial_approval_request_status()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if exists (select 1 from public.technologist_request_approval_versions where request_id = old.id and state = 'approved')
     and new.status not in ('submitted_to_supply','completed') then
    raise exception 'Одобренную заявку нельзя редактировать';
  end if;
  if (new.status = 'pending_financial_approval'
      or (new.status in ('submitted_to_supply','completed') and old.status not in ('submitted_to_supply','completed'))
      or old.status = 'pending_financial_approval')
     and current_setting('app.financial_approval_request', true) is distinct from old.id::text then
    raise exception 'Используйте операцию финансового согласования заявки';
  end if;
  return new;
end;
$$;
create trigger zz_financial_approval_request_status_guard before update of status
on public.technologist_requests for each row execute function public.fn_guard_financial_approval_request_status();

create or replace function public.fn_guard_financial_approval_completion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.technologist_request_approval_versions where request_id = old.request_id and state = 'approved') then
    raise exception 'Одобренную заявку нельзя редактировать';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger financial_approval_completion_guard before update or delete on public.technologist_request_completions
for each row execute function public.fn_guard_financial_approval_completion();
create trigger financial_approval_waste_guard before update or delete on public.technologist_request_waste_items
for each row execute function public.fn_guard_financial_approval_completion();

create or replace function public.fn_guard_financial_approval_task()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.technologist_request_approval_id is not null and exists (
    select 1 from public.technologist_request_approval_versions where id = old.technologist_request_approval_id and state = 'pending'
  ) and (tg_op = 'DELETE' or new.assigned_to is distinct from old.assigned_to
    or new.technologist_request_approval_machine_id is distinct from old.technologist_request_approval_machine_id
    or new.machine_id is distinct from old.machine_id
    or new.technologist_request_approval_id is distinct from old.technologist_request_approval_id
    or new.status in ('completed','cancelled')) then
    raise exception 'Задача завершается только решением по версии согласования';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger financial_approval_task_guard before update or delete on public.tasks
for each row execute function public.fn_guard_financial_approval_task();

create or replace function public.fn_archive_pending_financial_approvals()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request uuid;
begin
  if not new.is_archived or old.is_archived then return new; end if;
  for v_request in select r.id from public.technologist_requests r
    where r.machine_id = new.id order by r.id for update loop
    if not exists (select 1 from public.technologist_request_approval_versions where request_id = v_request and state = 'pending') then continue; end if;
    update public.technologist_request_approval_versions set state = 'superseded', updated_at = now() where request_id = v_request and state = 'pending';
    update public.tasks set status = 'cancelled', completed_at = now(), updated_at = now()
      where technologist_request_approval_machine_id = new.id and technologist_request_approval_id in (
        select id from public.technologist_request_approval_versions where request_id = v_request
      ) and status in ('pending','in_progress');
    perform set_config('app.financial_approval_request', v_request::text, true);
    update public.technologist_requests set status = 'cancelled', updated_at = now() where id = v_request;
    perform set_config('app.financial_approval_request', '', true);
  end loop;
  return new;
end;
$$;
create trigger financial_approval_archive_guard before update of is_archived on public.machines
for each row execute function public.fn_archive_pending_financial_approvals();

-- Capture all source rows, reservations and selected cutting definitions, not a UI-derived checksum.
create or replace function public.fn_technologist_approval_source(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result jsonb := '{}'::jsonb; v_table text; v_rows jsonb;
begin
  foreach v_table in array array['request_sheet_metal','request_round_tube','request_circle','request_pipe',
    'request_knives','request_components','request_paint','request_mesh','request_chain_cord'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(i) order by i.id), ''[]''::jsonb) from public.%I i where request_id = $1', v_table)
      into v_rows using p_request_id;
    v_result := v_result || jsonb_build_object(v_table, v_rows);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(ir) || jsonb_build_object('is_business_scrap', coalesce(i.is_business_scrap,false)) order by ir.id), '[]'::jsonb)
  into v_rows from public.inventory_reservations ir
  join public.inventory i on i.id = coalesce(ir.source_inventory_id, ir.inventory_id)
  where ir.consumed_at is null and exists (
    select 1 from jsonb_array_elements(v_result->ir.request_item_table) item where item->>'id' = ir.request_item_id::text
  );
  v_result := v_result || jsonb_build_object('reservations', v_rows);
  select coalesce(jsonb_agg(to_jsonb(v) order by v.id), '[]'::jsonb) into v_rows
  from public.long_stock_cutting_plan_versions v where exists (
    select 1 from public.long_stock_cutting_plan_items pi where pi.plan_id = v.plan_id and pi.request_id = p_request_id
  ) and v.status = 'approved';
  v_result := v_result || jsonb_build_object('cuttingVersions', v_rows);
  select coalesce(jsonb_agg(to_jsonb(pi) order by pi.id), '[]'::jsonb) into v_rows
  from public.long_stock_cutting_plan_items pi where pi.request_id = p_request_id;
  v_result := v_result || jsonb_build_object('cuttingItems', v_rows);
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb) into v_rows
  from public.long_stock_cutting_candidates c join public.long_stock_cutting_plan_versions v
    on v.id = c.version_id and v.selected_candidate_number = c.candidate_number
  where v.status = 'approved' and exists (
    select 1 from public.long_stock_cutting_plan_items pi where pi.plan_id = v.plan_id and pi.request_id = p_request_id
  );
  return v_result || jsonb_build_object('cuttingCandidates', v_rows);
end;
$$;
revoke all on function public.fn_technologist_approval_source(uuid) from public, anon, authenticated;
grant execute on function public.fn_technologist_approval_source(uuid) to service_role;

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
  if not exists (select 1 from public.users where id = p_actor and is_active) then raise exception 'Недостаточно прав'; end if;
  if jsonb_typeof(p_completion_payload) <> 'object' or jsonb_typeof(p_summary_snapshot) <> 'object' then
    raise exception 'Некорректный снимок заявки';
  end if;
  if jsonb_typeof(coalesce(p_archives, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_archives, '[]'::jsonb)) > 20 then
    raise exception 'Можно прикрепить не более 20 архивов';
  end if;

  select r.* into v_request
  from public.technologist_requests r
  where r.id = p_request_id
  for update of r;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  if not exists (select 1 from public.users where id = p_actor and is_active) then raise exception 'Недостаточно прав'; end if;
  select m.name into v_machine_name from public.machines m where m.id = v_request.machine_id and not m.is_archived;
  if not found then raise exception 'Заказ находится в архиве'; end if;
  if v_request.status <> 'stock_checked' then raise exception 'Заявка не готова к согласованию'; end if;
  if p_summary_snapshot->'sourceData' is distinct from public.fn_technologist_approval_source(p_request_id) then
    raise exception 'Данные заявки изменились. Обновите итоговый мастер';
  end if;
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
      start_date, deadline, technologist_request_approval_id, technologist_request_approval_machine_id
    ) values (
      null, v_recipient, 'technologist_request_approval',
      'Проверить и одобрить заявку',
      'Заявка №' || v_request_number || ' для заказа «' || coalesce(v_machine_name, 'Без названия') || '»',
      'pending', (now() at time zone 'Europe/Kyiv')::date,
      (now() at time zone 'Europe/Kyiv')::date, v_version_id, v_request.machine_id
    );
  end loop;

  perform set_config('app.financial_approval_request', p_request_id::text, true);
  update public.technologist_requests
  set status = 'pending_financial_approval', submitted_at = null, updated_at = now()
  where id = p_request_id;
  perform set_config('app.financial_approval_request', '', true);
  return v_version_id;
end;
$$;

create or replace function public.fn_begin_technologist_request_revision(p_request_id uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.technologist_requests%rowtype; v_version uuid;
begin
  if not exists (select 1 from public.users where id = p_actor and is_active) then raise exception 'Недостаточно прав'; end if;
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
  perform set_config('app.financial_approval_request', p_request_id::text, true);
  update public.technologist_requests set status = 'pending_stock_check', submitted_at = null, updated_at = now() where id = p_request_id;
  perform set_config('app.financial_approval_request', '', true);
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
  select r.* into v_request from public.technologist_requests r
    join public.technologist_request_approval_versions v on v.request_id = r.id
    where v.id = p_approval_version_id for update of r;
  select * into v_version from public.technologist_request_approval_versions where id = p_approval_version_id for update;
  if not found or v_version.state <> 'pending' then raise exception 'Решение по версии уже принято'; end if;
  if v_request.status <> 'pending_financial_approval' then raise exception 'Заявка больше не ожидает согласования'; end if;
  update public.technologist_request_approval_versions
    set state = 'returned', return_reason = btrim(p_reason), decided_by = p_actor, decided_at = now(), updated_at = now()
    where id = v_version.id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
    where technologist_request_approval_id = v_version.id and status in ('pending', 'in_progress');
  perform set_config('app.financial_approval_request', v_request.id::text, true);
  update public.technologist_requests set status = 'pending_stock_check', submitted_at = null, updated_at = now()
    where id = v_request.id;
  perform set_config('app.financial_approval_request', '', true);
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
  perform 1 from public.machines m join public.technologist_requests r on r.machine_id = m.id
    join public.technologist_request_approval_versions v on v.request_id = r.id
    where v.id = p_approval_version_id for update of m;
  select r.* into v_request from public.technologist_requests r
    join public.technologist_request_approval_versions v on v.request_id = r.id
    where v.id = p_approval_version_id for update of r;
  select * into v_version from public.technologist_request_approval_versions where id = p_approval_version_id for update;
  if not found or v_version.state <> 'pending' then raise exception 'Решение по версии уже принято'; end if;
  if v_request.status <> 'pending_financial_approval' then raise exception 'Заявка больше не ожидает согласования'; end if;
  if exists (select 1 from public.machines where id = v_request.machine_id and is_archived) then raise exception 'Заказ находится в архиве'; end if;
  if v_version.summary_snapshot->'sourceData' is distinct from public.fn_technologist_approval_source(v_request.id) then
    raise exception 'Данные заявки изменились. Верните заявку на доработку';
  end if;

  -- The legacy finalizer is owner-bound. Keep its validations and side effects,
  -- but invoke it atomically as the immutable version's submitting technologist.
  perform set_config('app.financial_approval_request', v_request.id::text, true);
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
  perform set_config('app.financial_approval_request', '', true);

  update public.technologist_request_approval_versions
    set state = 'approved', decided_by = p_actor, decided_at = now(), updated_at = now()
    where id = v_version.id;
  update public.tasks set status = 'completed', completed_at = now(), updated_at = now()
    where technologist_request_approval_id = v_version.id and status in ('pending', 'in_progress');
  insert into public.notifications(user_id, type, title, message, related_machine_id)
  select u.id, 'technologist_request', 'Заявка одобрена и готова для снабжения',
    'Итоговая версия заявки одобрена финансовым директором или администратором CRM.', v_request.machine_id
  from public.users u where u.is_active and u.role in ('supply_manager','procurement_head');
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
revoke all on function public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb) from public, anon;
revoke all on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb) to service_role;
grant execute on function public.fn_finalize_technologist_request_with_archives(uuid,uuid,text,integer,jsonb,jsonb,jsonb) to service_role;

-- Already handed-off requests become approved legacy versions. No fictitious approver is created.
insert into public.technologist_request_approval_versions(
  request_id, revision_number, state, completion_payload, summary_snapshot,
  submitted_by, submitted_at, decided_at, is_legacy
)
select r.id, 0, 'approved', payload.value,
  jsonb_build_object('schemaVersion', 1, 'legacy', true, 'requestId',r.id,'machineId',r.machine_id,
    'orderName',m.name,'materialType',m.material_type,'sourceData', public.fn_technologist_approval_source(r.id)),
  r.created_by, coalesce(r.submitted_at, r.updated_at, r.created_at),
  coalesce(r.submitted_at, r.updated_at, r.created_at), true
from public.technologist_requests r
join public.machines m on m.id = r.machine_id
cross join lateral (select jsonb_build_object(
  'decision', coalesce(c.future_detailing_decision,'none'),
  'enteredPlasmaMinutes', coalesce(c.entered_plasma_minutes,0),
  'wasteItems', coalesce((select jsonb_agg(jsonb_build_object(
    'sourceTable', w.source_table, 'sourceId', w.source_id, 'wastePercent', w.waste_percent
  )) from public.technologist_request_waste_items w where w.request_id = r.id), '[]'::jsonb),
  'futureItems', coalesce((select jsonb_agg(jsonb_build_object(
    'partId', p.id, 'name', p.name, 'drawingNumber', p.drawing_number, 'unitWeightKg', p.unit_weight_kg, 'quantity', fi.planned_quantity
  )) from public.future_detailing_batches b join public.future_detailing_items fi on fi.batch_id = b.id
    join public.detailing_parts p on p.id = fi.part_id where b.request_id = r.id), '[]'::jsonb),
  'archives', coalesce((select jsonb_agg(jsonb_build_object(
    'objectPath', a.storage_path, 'fileName', a.file_name, 'fileSize', a.file_size, 'mimeType', a.mime_type
  )) from public.machine_cutting_archives a where a.request_id = r.id), '[]'::jsonb)
) as value from (select 1) seed left join public.technologist_request_completions c on c.request_id = r.id) payload
where r.status in ('submitted_to_supply', 'completed')
  and not exists (select 1 from public.technologist_request_approval_versions v where v.request_id = r.id)
on conflict (request_id, revision_number) do nothing;

notify pgrst, 'reload schema';
