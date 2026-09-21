-- One returned source can be replaced by a reviewed group of the same category.
create table public.supply_position_revision_items (
 revision_id uuid not null references public.supply_position_revisions(id) on delete restrict,
 request_item_table text not null,
 request_item_id uuid not null,
 primary key(revision_id, request_item_table, request_item_id),
 unique(request_item_table, request_item_id)
);
alter table public.supply_position_revision_items enable row level security;
revoke all on public.supply_position_revision_items from anon, authenticated;
grant select on public.supply_position_revision_items to authenticated;
grant all on public.supply_position_revision_items to service_role;
create policy revision_items_view on public.supply_position_revision_items for select to authenticated
 using (exists(select 1 from public.supply_position_revisions r where r.id = revision_id));
insert into public.supply_position_revision_items
 select id,replacement_request_item_table,replacement_request_item_id from public.supply_position_revisions
 where replacement_request_item_id is not null;

create or replace function public.fn_track_supply_revision_items() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_revision uuid; v_request uuid; v_item uuid;
begin
 v_request := case when tg_op='DELETE' then old.request_id else new.request_id end;
 v_item := case when tg_op='DELETE' then old.id else new.id end;
 select id into v_revision from public.supply_position_revisions
 where replacement_request_id=v_request and source_request_item_table=tg_table_name;
 if v_revision is not null then
   if tg_op='DELETE' then
     delete from public.supply_position_revision_items where revision_id=v_revision and request_item_id=v_item and request_item_table=tg_table_name;
     update public.supply_position_revisions set replacement_request_item_id=(
       select request_item_id from public.supply_position_revision_items where revision_id=v_revision order by request_item_id limit 1)
     where id=v_revision and replacement_request_item_id=v_item;
   else
     insert into public.supply_position_revision_items values(v_revision,tg_table_name,v_item) on conflict do nothing;
   end if;
 end if;
 return null;
end $$;
create or replace function public.fn_track_initial_supply_revision_item() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.replacement_request_item_id is not null then
   insert into public.supply_position_revision_items values(new.id,new.replacement_request_item_table,new.replacement_request_item_id) on conflict do nothing;
 end if;
 return null;
end $$;
create trigger track_initial_supply_revision_item after insert or update of replacement_request_item_id on public.supply_position_revisions
 for each row execute function public.fn_track_initial_supply_revision_item();
revoke all on function public.fn_track_supply_revision_items(), public.fn_track_initial_supply_revision_item() from public,anon,authenticated;
do $$ declare t text; begin
 foreach t in array array['request_sheet_metal','request_circle','request_pipe','request_knives','request_paint','request_components','request_mesh','request_chain_cord'] loop
 execute format('create trigger track_supply_revision_items after insert or delete on public.%I for each row execute function public.fn_track_supply_revision_items()',t);
 end loop;
end $$;

create or replace function public.fn_restore_technologist_revision_positions(
  p_request_id uuid,
  p_source jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_table text;
  v_columns text;
  v_rows jsonb;
  v_search_path text := current_setting('search_path');
begin
  if p_source is null or jsonb_typeof(p_source) <> 'object' then
    raise exception 'Снимок исходной заявки не найден';
  end if;

  -- Legacy calculation triggers inherit this SECURITY DEFINER function's
  -- hardened empty search_path. Give those triggers an explicit trusted schema
  -- while rows are restored, then restore the caller's path before returning.
  perform set_config('search_path', 'pg_catalog, public, pg_temp', true);

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
      'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) restored where not exists (select 1 from public.%1$I existing where existing.id=restored.id) on conflict (id) do nothing',
      v_table, v_columns
    ) using v_rows;
  end loop;

  perform set_config('search_path', v_search_path, true);
exception when others then
  perform set_config('search_path', v_search_path, true);
  raise;
end $$;

create or replace function public.fn_supply_position_revision_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  v_request_id uuid := coalesce((v_old->>'request_id')::uuid, (v_new->>'request_id')::uuid);
  v_item_id uuid := coalesce((v_old->>'id')::uuid, (v_new->>'id')::uuid);
  v_replacement_table text;
  v_count integer;
  v_status text;
begin
  if current_setting('app.supply_position_revision_lifecycle', true) = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op <> 'INSERT' and exists (
    select 1 from public.supply_position_revisions revision
    where revision.source_request_item_table = tg_table_name
      and revision.source_request_item_id = v_item_id
      and revision.status in ('requested', 'editing', 'stock_check')
  ) then
    raise exception using errcode = '55000', message = '[RETURN_ALREADY_OPEN] Возвращённую позицию нельзя менять до отправки замены';
  end if;

  select revision.source_request_item_table into v_replacement_table
  from public.supply_position_revisions revision
  where revision.replacement_request_id = v_request_id
    and revision.status in ('editing', 'stock_check')
  limit 1;

  if v_replacement_table is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_replacement_table <> tg_table_name then
    raise exception using errcode = '55000', message = '[REVISION_CATEGORY_LOCKED] Категорию корректирующей позиции менять нельзя';
  end if;
  if tg_op in ('INSERT', 'DELETE') then
    select status::text into v_status from public.technologist_requests where id=v_request_id for update;
    if v_status not in ('draft','pending_stock_check','stock_checked') then
      raise exception '[REVISION_STRUCTURE_LOCKED] Заявка не находится на доработке';
    end if;
    if tg_op='DELETE' then
      execute format('select count(*) from public.%I where request_id=$1',tg_table_name) into v_count using v_request_id;
      if v_count <= 1 then raise exception '[REVISION_STRUCTURE_LOCKED] Сохраните хотя бы одну позицию исходной категории'; end if;
      if exists(select 1 from public.inventory_reservations where request_item_table=tg_table_name and request_item_id=v_item_id)
        or exists(select 1 from public.supply_order_delivery_schedules where request_item_table=tg_table_name and request_item_id=v_item_id and status <> 'cancelled')
        or exists(select 1 from public.long_stock_cutting_plan_items where request_item_table=tg_table_name and request_item_id=v_item_id and link_state='active') then
        raise exception '[REVISION_STRUCTURE_LOCKED] Сначала снимите бронь и отмените раскладку позиции';
      end if;
      return old;
    end if;
    if coalesce(v_new->>'order_status','pending') <> 'pending' or v_new->>'supplier_id' is not null then
      raise exception '[REVISION_STRUCTURE_LOCKED] Новая позиция не может быть заказана';
    end if;
    return new;
  end if;
  if (v_new->>'id') is distinct from (v_old->>'id')
    or (v_new->>'request_id') is distinct from (v_old->>'request_id')
    or (v_new->>'sort_order') is distinct from (v_old->>'sort_order')
    or (v_new->>'created_at') is distinct from (v_old->>'created_at')
    or (v_new->>'order_status') is distinct from (v_old->>'order_status')
    or (v_new->>'supplier_id') is distinct from (v_old->>'supplier_id')
    or (v_new->>'ordered_at') is distinct from (v_old->>'ordered_at')
    or (v_new->>'delivered_at') is distinct from (v_old->>'delivered_at')
    or (v_new->>'custom_delivery_date') is distinct from (v_old->>'custom_delivery_date')
    or (v_new->>'cancelled_at') is distinct from (v_old->>'cancelled_at')
    or (v_new->>'cancelled_by') is distinct from (v_old->>'cancelled_by')
    or (v_new->>'cancellation_reason') is distinct from (v_old->>'cancellation_reason') then
    raise exception using errcode = '55000', message = '[REVISION_STRUCTURE_LOCKED] Системные поля корректирующей позиции менять нельзя';
  end if;
  return new;
end;
$$;

create or replace function public.fn_submit_supply_position_revision_v1(
  p_request_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.supply_position_revisions%rowtype;
  v_request public.technologist_requests%rowtype;
  v_actor_role text;
  v_count integer;
  v_total integer := 0;
  v_replacement_item_id uuid;
  v_table text;
  v_preview jsonb;
begin
  select * into v_revision from public.supply_position_revisions
  where replacement_request_id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = '[REVISION_NOT_FOUND] Корректирующая заявка не найдена';
  end if;
  if v_revision.status = 'submitted' then
    return jsonb_build_object(
      'revision_id', v_revision.id, 'request_id', p_request_id,
      'request_item_id', v_revision.replacement_request_item_id,
      'source_request_id', v_revision.source_request_id,
      'machine_id', (select machine_id from public.technologist_requests where id = p_request_id),
      'idempotent', true
    );
  end if;

  select role::text into v_actor_role from public.users
  where id = p_actor and coalesce(is_active, true);
  if p_actor is distinct from v_revision.assigned_to
    and coalesce(v_actor_role, '') not in ('planning_director', 'financial_director', 'commercial_director') then
    raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Отправить исправление может назначенный технолог или руководитель';
  end if;

  select * into v_request from public.technologist_requests where id = p_request_id for update;
  if v_request.status = 'pending_stock_check' then
    raise exception using errcode = '55000', message = '[REGULAR_STOCK_CHECK_REQUIRED] Сначала выполните проверку обычного склада';
  end if;
  if current_setting('app.financial_approval_request', true) is distinct from p_request_id::text then
    raise exception using errcode = '55000', message = '[FINANCIAL_APPROVAL_REQUIRED] Исправленная заявка требует финансового согласования';
  end if;
  if v_request.status <> 'submitted_to_supply' then
    raise exception using errcode = '55000', message = '[STOCK_CHECK_REQUIRED] Сначала выполните повторную проверку и резервирование склада';
  end if;

  foreach v_table in array array[
    'request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives',
    'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
  ] loop
    execute format('select count(*) from public.%I where request_id = $1', v_table)
      into v_count using p_request_id;
    v_total := v_total + v_count;
    if v_table = v_revision.source_request_item_table then
      if v_count < 1 then
        raise exception using errcode = '55000', message = '[REVISION_STRUCTURE_LOCKED] В корректирующей заявке должна быть хотя бы одна позиция исходной категории';
      end if;
      execute format('select id from public.%I where request_id = $1 order by id limit 1', v_table)
        into v_replacement_item_id using p_request_id;
    elsif v_count <> 0 then
      raise exception using errcode = '55000', message = '[REVISION_CATEGORY_LOCKED] Категорию корректирующей позиции менять нельзя';
    end if;
  end loop;
  if v_total < 1 or v_total <> (select count(*) from public.supply_position_revision_items where revision_id=v_revision.id) then
    raise exception using errcode = '55000', message = '[REVISION_STRUCTURE_LOCKED] Структура корректирующей заявки повреждена';
  end if;

  v_preview := public.fn_preview_supply_position_revision_v1(
    v_revision.source_request_item_table, v_revision.source_request_item_id
  );
  if not coalesce((v_preview->>'eligible')::boolean, false) then
    raise exception using errcode = '55000', message = coalesce(
      '[' || (v_preview->'blockers'->0->>'code') || '] ' || (v_preview->'blockers'->0->>'message'),
      '[POSITION_RETURN_BLOCKED] Исходная позиция больше не может быть заменена'
    );
  end if;

  perform set_config('app.supply_position_revision_lifecycle', '1', true);
  execute format(
    'update public.%I set order_status = ''cancelled'', cancelled_at = now(), '
    || 'cancelled_by = $1, cancellation_reason = $2 where id = $3',
    v_revision.source_request_item_table
  ) using p_actor, 'Заменено исправленной заявкой: ' || v_revision.reason, v_revision.source_request_item_id;

  update public.technologist_requests
  set status = 'submitted_to_supply', submitted_at = now(), updated_at = now()
  where id = p_request_id;

  update public.supply_position_revisions
  set status = 'submitted', submitted_by = p_actor, submitted_at = now(), updated_at = now()
  where id = v_revision.id;

  perform set_config('app.supply_position_revision_request_lifecycle', '1', true);
  update public.department_requests
  set status = 'done', completed_by = p_actor, completed_at = now(),
      response = 'Исправленная позиция отправлена снабжению', updated_at = now()
  where id = v_revision.department_request_id;
  perform set_config('app.supply_position_revision_request_lifecycle', '', true);

  update public.tasks
  set status = 'completed', completed_at = now(), updated_at = now()
  where department_request_id = v_revision.department_request_id
    and status in ('pending', 'in_progress');
  insert into public.department_request_events(request_id, event_type, actor_id)
  values (v_revision.department_request_id, 'completed', p_actor);

  -- Approval publishes the supply notification after completing all reviewer tasks.
  perform set_config('app.supply_position_revision_lifecycle', '', true);

  return jsonb_build_object(
    'revision_id', v_revision.id, 'request_id', p_request_id,
    'request_item_id', v_replacement_item_id,
    'source_request_id', v_revision.source_request_id,
    'machine_id', v_request.machine_id, 'idempotent', false
  );
end;
$$;

create or replace function public.fn_assert_supply_revision_cutting_plans(p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists (
   select 1 from public.supply_position_revisions r
   join public.supply_position_revision_items child on child.revision_id=r.id
   where r.replacement_request_id=p_request
     and child.request_item_table in ('request_circle','request_pipe','request_knives')
     and (child.request_item_table <> 'request_pipe' or exists(select 1 from public.request_pipe p where p.id=child.request_item_id and p.pipe_type <> 'wire'))
     and not exists(select 1 from public.long_stock_cutting_plan_items pi
       where pi.request_item_table=child.request_item_table and pi.request_item_id=child.request_item_id
       and pi.cutting_status in ('plan_approved','accepted') and pi.link_state='active')
 ) then raise exception '[CUTTING_PLAN_REQUIRED] Подготовьте и утвердите карту раскроя каждой позиции' using errcode='55000'; end if;
end $$;
revoke all on function public.fn_assert_supply_revision_cutting_plans(uuid) from public,anon,authenticated;

create or replace function public.fn_cleanup_cutting_drafts_and_guard_revision_stock_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := case
    when current_setting('app.financial_approval_request', true) = new.id::text
      then new.created_by
    else coalesce(auth.uid(), new.created_by)
  end;
  v_revision record;
begin
  if new.status in ('pending_stock_check', 'stock_checked')
    and new.status is distinct from old.status then
    select * into v_revision from public.supply_position_revisions
    where replacement_request_id = new.id and status in ('editing', 'stock_check')
    limit 1;
    -- Starting a returned draft must be possible before its plans are rebuilt.
    if new.status='stock_checked' or not exists(select 1 from public.technologist_request_revision_drafts where request_id=new.id) then perform public.fn_assert_supply_revision_cutting_plans(new.id); end if;
    perform public.fn_discard_long_stock_request_item_drafts_v1(new.id, v_actor, null, null);
  end if;
  return new;
end;
$$;

create or replace function public.fn_guard_long_stock_revision_submission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status='submitted' and old.status <> 'submitted' then
    perform public.fn_assert_supply_revision_cutting_plans(new.replacement_request_id);
  end if;
  return new;
end;
$$;

create or replace function public.fn_cancel_returned_supply_position_v1(
  p_request_item_table text,
  p_request_item_id uuid,
  p_reason text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_revision public.supply_position_revisions%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_department public.department_requests%rowtype;
  v_replacement public.long_stock_recalculation_replacements%rowtype;
  v_request_id uuid;
  v_reservation record;
  v_cleanup_plan_item record;
  v_replacement_table text;
  v_replacement_item_id uuid;
  v_row jsonb;
  v_child record;
begin
  if char_length(v_reason) not between 3 and 2000 then
    raise exception using errcode = '22023', message = '[REASON_REQUIRED] Укажите причину отмены от 3 до 2000 символов';
  end if;
  if public.supply_position_category(p_request_item_table) is null then
    raise exception using errcode = '22023', message = '[INVALID_POSITION_REF] Недопустимая категория позиции';
  end if;

  execute format('select to_jsonb(item) from public.%I item where id = $1 for update', p_request_item_table)
    into v_row using p_request_item_id;
  if v_row is null then
    raise exception using errcode = 'P0002', message = '[POSITION_NOT_FOUND] Позиция не найдена';
  end if;
  v_request_id := (v_row->>'request_id')::uuid;
  perform 1 from public.technologist_requests where id = v_request_id for update;

  select * into v_revision from public.supply_position_revisions
  where source_request_item_table = p_request_item_table
    and source_request_item_id = p_request_item_id
    and status in ('requested', 'editing', 'stock_check', 'submitted', 'cancelled')
  order by created_at desc limit 1 for update;

  if found then
    if v_revision.status = 'cancelled' then
      return jsonb_build_object('status', 'cancelled', 'idempotent', true, 'mode', 'standard');
    end if;
    if v_revision.status = 'submitted' then
      raise exception using errcode = '55000', message = '[REVISION_ALREADY_SUBMITTED] Исправленная позиция уже отправлена в снабжение';
    end if;
    v_replacement_table := v_revision.replacement_request_item_table;
    v_replacement_item_id := v_revision.replacement_request_item_id;
    select * into v_department from public.department_requests
    where id = v_revision.department_request_id for update;
    if not public.fn_can_process_returned_supply_position(p_actor, v_revision.assigned_to) then
      raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Отменить позицию может назначенный технолог или руководитель';
    end if;
  elsif p_request_item_table in ('request_circle', 'request_pipe', 'request_knives') then
    select * into v_plan_item from public.long_stock_cutting_plan_items
    where request_item_table = p_request_item_table
      and request_item_id = p_request_item_id
      and cutting_status in ('requires_recalculation', 'cancelled')
    order by linked_at desc limit 1 for update;
    if not found then
      raise exception using errcode = 'P0002', message = '[RETURN_NOT_FOUND] Активный возврат позиции не найден';
    end if;
    if v_plan_item.cutting_status = 'cancelled' then
      return jsonb_build_object('status', 'cancelled', 'idempotent', true, 'mode', 'long_stock_recalculation');
    end if;
    select department.* into v_department
    from public.long_stock_cutting_plan_versions version
    join public.department_requests department
      on department.id = version.invalidation_department_request_id
    where version.plan_id = v_plan_item.plan_id
      and version.status = 'invalid'
      and version.invalidation_department_request_id is not null
    order by version.invalidated_at desc nulls last
    limit 1
    for update of department;
    if not found or not public.fn_can_process_returned_supply_position(p_actor, v_department.assigned_to) then
      raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Отменить позицию может назначенный технолог или руководитель';
    end if;
    select * into v_replacement from public.long_stock_recalculation_replacements
    where plan_item_id = v_plan_item.id order by created_at desc limit 1 for update;
    if found and v_replacement.status = 'superseded' then
      raise exception using errcode = '55000', message = '[REVISION_ALREADY_SUBMITTED] Исправленная позиция уже отправлена в снабжение';
    end if;
    v_replacement_table := v_replacement.replacement_request_item_table;
    v_replacement_item_id := v_replacement.replacement_request_item_id;
  else
    raise exception using errcode = 'P0002', message = '[RETURN_NOT_FOUND] Активный возврат позиции не найден';
  end if;

  if exists (
    select 1 from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = p_request_item_table
      and schedule.request_item_id = p_request_item_id
      and (schedule.status = 'delivered' or schedule.delivered_at is not null or coalesce(schedule.received_quantity, 0) > 0)
  ) or exists (
    select 1 from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = v_replacement_table
      and schedule.request_item_id = v_replacement_item_id
      and (schedule.status = 'delivered' or schedule.delivered_at is not null or coalesce(schedule.received_quantity, 0) > 0)
  ) or exists (
    select 1 from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_candidate_bars bar on bar.version_id in (
      select version.id from public.long_stock_cutting_plan_versions version where version.plan_id = item.plan_id
    )
    where (
      (item.request_item_table = p_request_item_table and item.request_item_id = p_request_item_id)
      or (item.request_item_table = v_replacement_table and (item.request_item_id = v_replacement_item_id or item.request_item_id in (select child.request_item_id from public.supply_position_revision_items child where child.revision_id=v_revision.id)))
    ) and bar.status = 'cut'
  ) then
    raise exception using errcode = '55000', message = '[IRREVERSIBLE_POSITION_FACT] Позицию нельзя отменить после приёмки или резки';
  end if;

  perform set_config('app.supply_position_revision_lifecycle', '1', true);
  for v_reservation in
    select id from public.inventory_reservations
    where (
      (request_item_table = p_request_item_table and request_item_id = p_request_item_id)
      or (request_item_table = v_replacement_table and (request_item_id = v_replacement_item_id or request_item_id in (select request_item_id from public.supply_position_revision_items where revision_id=v_revision.id)))
    )
      and consumed_at is null
  loop
    perform public.fn_unreserve_inventory_reservation(v_reservation.id, p_actor, 'Окончательная отмена возвращённой позиции');
  end loop;
  update public.supply_order_delivery_schedules
  set status = 'cancelled', change_reason = v_reason, updated_by = p_actor, updated_at = now()
  where (
    (request_item_table = p_request_item_table and request_item_id = p_request_item_id)
    or (request_item_table = v_replacement_table and (request_item_id = v_replacement_item_id or request_item_id in (select request_item_id from public.supply_position_revision_items where revision_id=v_revision.id)))
  ) and status = 'planned';

  for v_cleanup_plan_item in
    select id, plan_id
    from public.long_stock_cutting_plan_items
    where (request_item_table = p_request_item_table and request_item_id = p_request_item_id)
      or (request_item_table = v_replacement_table and (request_item_id = v_replacement_item_id or request_item_id in (select request_item_id from public.supply_position_revision_items where revision_id=v_revision.id)))
    for update
  loop
    update public.inventory inventory_row
    set total_quantity = 0,
        reserved_quantity = 0,
        total_secondary_quantity = 0,
        reserved_secondary_quantity = 0,
        deleted_at = coalesce(deleted_at, now()),
        deleted_by = coalesce(deleted_by, p_actor),
        delete_comment = coalesce(delete_comment, 'Окончательная отмена возвращённой позиции'),
        last_updated_by = p_actor,
        updated_at = now()
    from public.long_stock_cutting_business_scraps scrap
    join public.long_stock_cutting_plan_versions version on version.id = scrap.version_id
    where version.plan_id = v_cleanup_plan_item.plan_id
      and scrap.inventory_id = inventory_row.id
      and inventory_row.deleted_at is null;

    delete from public.long_stock_cutting_bar_cuts where candidate_id in (
      select candidate.id from public.long_stock_cutting_candidates candidate
      join public.long_stock_cutting_plan_versions version on version.id = candidate.version_id
      where version.plan_id = v_cleanup_plan_item.plan_id and version.status = 'draft'
    );
    delete from public.long_stock_cutting_candidate_bars where version_id in (
      select id from public.long_stock_cutting_plan_versions
      where plan_id = v_cleanup_plan_item.plan_id and status = 'draft'
    );
    delete from public.long_stock_cutting_candidates where version_id in (
      select id from public.long_stock_cutting_plan_versions
      where plan_id = v_cleanup_plan_item.plan_id and status = 'draft'
    );
    delete from public.long_stock_cutting_segments where version_id in (
      select id from public.long_stock_cutting_plan_versions
      where plan_id = v_cleanup_plan_item.plan_id and status = 'draft'
    );
    perform set_config('app.long_stock_cutting_draft_cleanup', '1', true);
    delete from public.long_stock_cutting_plan_versions
    where plan_id = v_cleanup_plan_item.plan_id and status = 'draft';
    perform set_config('app.long_stock_cutting_draft_cleanup', '', true);

    perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
    update public.long_stock_cutting_plan_versions
    set status = 'invalid',
        invalidation_reason = 'Окончательная отмена: ' || v_reason,
        invalidation_receipt_schedule_id = null,
        invalidation_department_request_id = v_department.id,
        invalidated_by = p_actor,
        invalidated_at = now()
    where plan_id = v_cleanup_plan_item.plan_id and status = 'approved';
    perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

    perform set_config('app.long_stock_cutting_replacement_lifecycle', '1', true);
    update public.long_stock_cutting_plan_items
    set cutting_status = 'cancelled', link_state = 'superseded'
    where id = v_cleanup_plan_item.id;
    perform set_config('app.long_stock_cutting_replacement_lifecycle', '', true);
  end loop;

  perform public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
  if v_replacement_table is not null and v_replacement_item_id is not null then
    perform public.fn_set_request_reserved_quantity(v_replacement_table, v_replacement_item_id);
  end if;
  for v_child in select * from public.supply_position_revision_items where revision_id=v_revision.id loop
    perform public.fn_set_request_reserved_quantity(v_child.request_item_table,v_child.request_item_id);
  end loop;
  execute format(
    'update public.%I set order_status = ''cancelled'', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 where id = $1',
    p_request_item_table
  ) using p_request_item_id, p_actor, v_reason;

  if v_revision.id is not null then
    if v_revision.replacement_request_id is not null then
      execute format(
        'update public.%I set order_status = ''cancelled'', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 where request_id = $1 and order_status <> ''cancelled''',
        v_revision.replacement_request_item_table
      ) using v_revision.replacement_request_id, p_actor, v_reason;
      update public.technologist_requests set status = 'cancelled', updated_at = now()
      where id = v_revision.replacement_request_id and status in ('draft', 'pending_stock_check', 'stock_checked');
    end if;
    update public.supply_position_revisions
    set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(),
        cancellation_reason = v_reason, updated_at = now()
    where id = v_revision.id;
  else
    if v_replacement.id is not null and v_replacement.status = 'replacement_staging' then
      execute format(
        'update public.%I set order_status = ''cancelled'', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 where id = $1 and order_status <> ''cancelled''',
        v_replacement.replacement_request_item_table
      ) using v_replacement.replacement_request_item_id, p_actor, v_reason;
      update public.technologist_requests set status = 'cancelled', updated_at = now()
      where id = v_replacement.replacement_request_id and status = 'draft';
      perform set_config('app.long_stock_replacement_approval', '1', true);
      update public.long_stock_recalculation_replacements
      set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancellation_reason = v_reason
      where id = v_replacement.id;
      perform set_config('app.long_stock_replacement_approval', '', true);
    end if;
    perform set_config('app.long_stock_cutting_replacement_lifecycle', '1', true);
    update public.long_stock_cutting_plan_items
    set cutting_status = 'cancelled', link_state = 'superseded'
    where id = v_plan_item.id;
    perform set_config('app.long_stock_cutting_replacement_lifecycle', '', true);
  end if;
  perform set_config('app.supply_position_revision_lifecycle', '', true);

  perform set_config(
    case when v_revision.id is null
      then 'app.long_stock_recalculation_request_lifecycle'
      else 'app.supply_position_revision_request_lifecycle'
    end,
    '1', true
  );
  update public.department_requests
  set status = 'cancelled', response = v_reason, completed_by = p_actor,
      completed_at = now(), updated_at = now()
  where id = v_department.id and status in ('new', 'in_progress');
  perform set_config(
    case when v_revision.id is null
      then 'app.long_stock_recalculation_request_lifecycle'
      else 'app.supply_position_revision_request_lifecycle'
    end,
    '', true
  );
  update public.tasks
  set status = 'cancelled', completed_at = now(), updated_at = now()
  where department_request_id = v_department.id and status in ('pending', 'in_progress');
  insert into public.department_request_events(request_id, event_type, actor_id)
  select v_department.id, 'cancelled', p_actor
  where v_department.id is not null
    and not exists (
      select 1 from public.department_request_events event
      where event.request_id = v_department.id and event.event_type = 'cancelled'
    );

  return jsonb_build_object(
    'status', 'cancelled', 'idempotent', false,
    'mode', case when v_revision.id is null then 'long_stock_recalculation' else 'standard' end,
    'department_request_id', v_department.id
  );
end;
$$;

-- Keep immutable version/file links while allowing an unchanged program in a new revision.
alter table public.technologist_request_approval_archives drop constraint technologist_request_approval_archives_object_path_key;
alter table public.technologist_request_approval_archives add constraint approval_archive_version_path_key unique(approval_version_id,object_path);

-- Delete an additional draft row and release its unused reservations atomically.
create or replace function public.fn_delete_supply_revision_item(p_table text,p_item uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_request uuid; v_count integer; v_res record; v_status text;
begin
 if public.supply_position_category(p_table) is null then raise exception 'Недопустимая категория'; end if;
 execute format('select request_id from public.%I where id=$1',p_table) into v_request using p_item;
 if v_request is null then return; end if;
 if not private.crm_can_work_technologist_request(v_request,auth.uid(),'manage') then raise exception 'Недостаточно прав' using errcode='42501'; end if;
 select status::text into v_status from public.technologist_requests where id=v_request for update;
 if v_status not in ('draft','pending_stock_check','stock_checked') or not exists(select 1 from public.supply_position_revisions where replacement_request_id=v_request and status in ('editing','stock_check')) then
 raise exception 'Заявка не находится на доработке'; end if;
 execute format('select count(*) from public.%I where request_id=$1',p_table) into v_count using v_request;
 if v_count<=1 then raise exception 'Сохраните хотя бы одну позицию исходной категории'; end if;
 if exists(select 1 from public.inventory_reservations where request_item_table=p_table and request_item_id=p_item and consumed_at is not null)
 or exists(select 1 from public.supply_order_delivery_schedules where request_item_table=p_table and request_item_id=p_item and status<>'cancelled')
 or exists(select 1 from public.long_stock_cutting_plan_items where request_item_table=p_table and request_item_id=p_item and link_state='active') then
 raise exception 'Сначала отмените раскладку позиции. Позицию с приёмкой или резкой удалить нельзя'; end if;
 for v_res in select id from public.inventory_reservations where request_item_table=p_table and request_item_id=p_item for update loop
 perform public.fn_unreserve_inventory_reservation(v_res.id,auth.uid(),'Удаление позиции корректировки');
 end loop;
 execute format('delete from public.%I where id=$1',p_table) using p_item;
end $$;
revoke all on function public.fn_delete_supply_revision_item(text,uuid) from public,anon;
grant execute on function public.fn_delete_supply_revision_item(text,uuid) to authenticated;
