-- Return one procurement position to its technologist without rewriting history.
-- Approved long-stock cutting plans keep using their specialised recalculation
-- lifecycle; every other active category uses supply_position_revisions.

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'request_sheet_metal',
    'request_circle',
    'request_pipe',
    'request_knives',
    'request_paint',
    'request_components',
    'request_mesh',
    'request_chain_cord'
  ] loop
    execute format(
      'alter table public.%I '
      || 'add column if not exists cancelled_at timestamptz, '
      || 'add column if not exists cancelled_by uuid references public.users(id) on delete restrict, '
      || 'add column if not exists cancellation_reason text',
      v_table
    );

    execute format(
      'update public.%1$I item '
      || 'set cancelled_at = coalesce(item.cancelled_at, now()), '
      || 'cancelled_by = coalesce(item.cancelled_by, request.created_by), '
      || 'cancellation_reason = coalesce(nullif(btrim(item.cancellation_reason), ''''), ''Отменено до введения журнала возвратов'') '
      || 'from public.technologist_requests request '
      || 'where request.id = item.request_id and item.order_status = ''cancelled'' '
      || 'and (item.cancelled_at is null or item.cancelled_by is null or nullif(btrim(item.cancellation_reason), '''') is null)',
      v_table
    );

    execute format('alter table public.%I drop constraint if exists %I', v_table, v_table || '_cancellation_check');
    execute format(
      'alter table public.%1$I add constraint %2$I check ('
      || '(order_status = ''cancelled'') = ('
      || 'cancelled_at is not null and cancelled_by is not null '
      || 'and btrim(coalesce(cancellation_reason, '''')) <> ''''))',
      v_table,
      v_table || '_cancellation_check'
    );
  end loop;
end;
$migration$;

create or replace function public.fn_supply_position_cancellation_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_context_actor uuid;
  v_request_author uuid;
begin
  if new.order_status = 'cancelled' and old.order_status <> 'cancelled' then
    select context.actor_id into v_context_actor
    from public.machine_operational_cleanup_context_v1 context
    where context.backend_pid = pg_backend_pid()
      and context.transaction_id = txid_current()
      and context.request_item_table = tg_table_name
      and context.request_item_id = new.id
    limit 1;
    select request.created_by into v_request_author
    from public.technologist_requests request where request.id = new.request_id;
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, v_context_actor, auth.uid(), v_request_author);
    new.cancellation_reason := coalesce(
      nullif(btrim(new.cancellation_reason), ''),
      case when v_context_actor is not null
        then 'Отменено при архивировании заказа'
        else 'Позиция отменена'
      end
    );
  elsif new.order_status <> 'cancelled' then
    new.cancelled_at := null;
    new.cancelled_by := null;
    new.cancellation_reason := null;
  end if;
  return new;
end;
$$;

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives',
    'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
  ] loop
    execute format('drop trigger if exists supply_position_cancellation_audit on public.%I', v_table);
    execute format(
      'create trigger supply_position_cancellation_audit before update of order_status on public.%I '
      || 'for each row execute function public.fn_supply_position_cancellation_audit()',
      v_table
    );
    if v_table not in ('request_circle', 'request_pipe', 'request_knives') then
      execute format('drop trigger if exists guard_cancelled_%s_history on public.%I', replace(v_table, 'request_', ''), v_table);
      execute format(
        'create trigger guard_cancelled_%s_history before update or delete on public.%I '
        || 'for each row execute function public.fn_guard_cancelled_long_stock_request_item_history()',
        replace(v_table, 'request_', ''), v_table
      );
    end if;
  end loop;
end;
$migration$;

create or replace function public.fn_reject_cancelled_long_stock_request_item_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cancelled boolean := false;
begin
  if current_setting('app.supply_position_revision_lifecycle', true) = '1' then
    return new;
  end if;
  if new.request_item_table not in (
    'request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives',
    'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
  ) then
    return new;
  end if;
  if exists (
    select 1 from public.machine_operational_cleanup_context_v1 context
    where context.backend_pid = pg_backend_pid()
      and context.transaction_id = txid_current()
      and context.request_item_table = new.request_item_table
      and context.request_item_id = new.request_item_id
  ) then
    return new;
  end if;
  if to_regclass('public.supply_position_revisions') is not null
    and exists (
      select 1 from public.supply_position_revisions revision
      where revision.source_request_item_table = new.request_item_table
        and revision.source_request_item_id = new.request_item_id
        and revision.status in ('requested', 'editing', 'stock_check')
    ) then
    raise exception using errcode = '55000', message = '[RETURN_ALREADY_OPEN] Возвращённую позицию нельзя резервировать';
  end if;
  execute format(
    'select order_status = ''cancelled'' from public.%I where id = $1',
    new.request_item_table
  ) into v_cancelled using new.request_item_id;
  if coalesce(v_cancelled, false) then
    if new.request_item_table in ('request_circle', 'request_pipe', 'request_knives') then
      raise exception 'Отменённая по пересчёту позиция недоступна для закупки и резервирования';
    end if;
    raise exception 'Отменённая позиция недоступна для закупки и резервирования';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_supply_position_cancellation_audit() from public, anon, authenticated;
revoke all on function public.fn_reject_cancelled_long_stock_request_item_mutation() from public, anon, authenticated, service_role;

-- A normalised relation makes shared expenses and legacy ambiguity explicit.
alter table public.finance_expenses
  add column if not exists supply_item_links_complete boolean not null default false;

create table if not exists public.finance_expense_supply_items (
  expense_id uuid not null references public.finance_expenses(id) on delete cascade,
  request_item_table text not null,
  request_item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (expense_id, request_item_table, request_item_id),
  constraint finance_expense_supply_items_table_check check (request_item_table in (
    'request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives',
    'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
  ))
);

create index if not exists finance_expense_supply_items_position_idx
  on public.finance_expense_supply_items(request_item_table, request_item_id);

create or replace function public.fn_supply_expense_source_is_complete(
  p_source_type text,
  p_source_key text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_source_type is distinct from 'supply_order' then false
    when p_source_key is null
      or p_source_key !~ '^[0-9a-fA-F-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}:.+$' then false
    else not exists (
      select 1
      from regexp_split_to_table(
        regexp_replace(p_source_key, '^[^:]+:[^:]+:', ''),
        E'\\|'
      ) token
      where token !~ '^(request_sheet_metal|request_circle|request_pipe|request_knives|request_paint|request_components|request_mesh|request_chain_cord):[0-9a-fA-F-]{36}$'
    )
  end;
$$;

create or replace function public.fn_sync_finance_expense_supply_items()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  delete from public.finance_expense_supply_items where expense_id = new.id;
  if new.supply_item_links_complete then
    insert into public.finance_expense_supply_items(expense_id, request_item_table, request_item_id)
    select
      new.id,
      split_part(token, ':', 1),
      split_part(token, ':', 2)::uuid
    from regexp_split_to_table(
      regexp_replace(new.source_key, '^[^:]+:[^:]+:', ''),
      E'\\|'
    ) token
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.fn_mark_finance_expense_supply_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.supply_item_links_complete := public.fn_supply_expense_source_is_complete(new.source_type, new.source_key);
  return new;
end;
$$;

drop trigger if exists finance_expense_supply_links_mark on public.finance_expenses;
create trigger finance_expense_supply_links_mark
before insert or update of source_type, source_key, supply_item_links_complete on public.finance_expenses
for each row execute function public.fn_mark_finance_expense_supply_links();

drop trigger if exists finance_expense_supply_links_sync on public.finance_expenses;
create trigger finance_expense_supply_links_sync
after insert or update of source_type, source_key, supply_item_links_complete on public.finance_expenses
for each row execute function public.fn_sync_finance_expense_supply_items();

update public.finance_expenses
set supply_item_links_complete = public.fn_supply_expense_source_is_complete(source_type, source_key)
where supply_item_links_complete is distinct from public.fn_supply_expense_source_is_complete(source_type, source_key);

insert into public.finance_expense_supply_items(expense_id, request_item_table, request_item_id)
select
  expense.id,
  split_part(token, ':', 1),
  split_part(token, ':', 2)::uuid
from public.finance_expenses expense
cross join lateral regexp_split_to_table(
  regexp_replace(expense.source_key, '^[^:]+:[^:]+:', ''),
  E'\\|'
) token
where expense.supply_item_links_complete
on conflict do nothing;

revoke all on table public.finance_expense_supply_items from public, anon, authenticated;
grant select, insert, update, delete on table public.finance_expense_supply_items to service_role;
revoke all on function public.fn_supply_expense_source_is_complete(text, text) from public, anon, authenticated;
grant execute on function public.fn_supply_expense_source_is_complete(text, text) to service_role;
revoke all on function public.fn_sync_finance_expense_supply_items() from public, anon, authenticated;
revoke all on function public.fn_mark_finance_expense_supply_links() from public, anon, authenticated;

alter table public.department_requests
  drop constraint if exists department_requests_kind_check;
alter table public.department_requests
  add constraint department_requests_kind_check check (request_kind in (
    'manual', 'machine_layout', 'long_stock_recalculation',
    'supply_position_revision', 'transport_trip_date_approval'
  ));

alter table public.department_requests
  drop constraint if exists department_requests_long_stock_reference_check;
alter table public.department_requests
  add constraint department_requests_position_reference_check check (
    (
      request_kind = 'long_stock_recalculation'
      and request_item_table in ('request_circle', 'request_pipe', 'request_knives')
      and request_item_id is not null
      and technologist_request_id is not null
      and long_stock_plan_id is not null
      and long_stock_returned_version_id is not null
      and btrim(coalesce(request_item_label, '')) <> ''
    )
    or (
      request_kind = 'supply_position_revision'
      and request_item_table in (
        'request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives',
        'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
      )
      and request_item_id is not null
      and technologist_request_id is not null
      and long_stock_plan_id is null
      and long_stock_returned_version_id is null
      and btrim(coalesce(request_item_label, '')) <> ''
    )
    or (
      request_kind not in ('long_stock_recalculation', 'supply_position_revision')
      and request_item_table is null
      and request_item_id is null
      and technologist_request_id is null
      and long_stock_plan_id is null
      and long_stock_returned_version_id is null
      and request_item_label is null
    )
  );

create table public.supply_position_revisions (
  id uuid primary key default gen_random_uuid(),
  source_request_id uuid not null references public.technologist_requests(id) on delete restrict,
  source_request_item_table text not null,
  source_request_item_id uuid not null,
  category public.material_category not null,
  reason text not null,
  requested_by uuid not null references public.users(id) on delete restrict,
  assigned_to uuid not null references public.users(id) on delete restrict,
  department_request_id uuid not null unique references public.department_requests(id) on delete restrict,
  replacement_request_id uuid unique references public.technologist_requests(id) on delete restrict,
  replacement_request_item_table text,
  replacement_request_item_id uuid,
  status text not null default 'requested',
  external_order_cancellation_confirmed_at timestamptz,
  external_order_cancellation_confirmed_by uuid references public.users(id) on delete restrict,
  submitted_by uuid references public.users(id) on delete restrict,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supply_position_revisions_source_table_check check (source_request_item_table in (
    'request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives',
    'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
  )),
  constraint supply_position_revisions_replacement_table_check check (
    replacement_request_item_table is null
    or replacement_request_item_table = source_request_item_table
  ),
  constraint supply_position_revisions_category_check check (
    category not in ('round_tube', 'other')
  ),
  constraint supply_position_revisions_reason_check check (char_length(btrim(reason)) between 3 and 2000),
  constraint supply_position_revisions_status_check check (status in ('requested', 'editing', 'stock_check', 'submitted')),
  constraint supply_position_revisions_replacement_check check (
    (status = 'requested' and replacement_request_id is null and replacement_request_item_id is null and replacement_request_item_table is null)
    or (status in ('editing', 'stock_check', 'submitted') and replacement_request_id is not null and replacement_request_item_id is not null and replacement_request_item_table = source_request_item_table)
  ),
  constraint supply_position_revisions_submission_check check (
    (status = 'submitted') = (submitted_by is not null and submitted_at is not null)
  )
);

create unique index supply_position_revisions_one_open_source_idx
  on public.supply_position_revisions(source_request_item_table, source_request_item_id)
  where status in ('requested', 'editing', 'stock_check');
create index supply_position_revisions_replacement_idx
  on public.supply_position_revisions(replacement_request_id)
  where replacement_request_id is not null;

create or replace function public.fn_guard_supply_revision_finance_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.supply_position_revisions revision
    where revision.source_request_item_table = new.request_item_table
      and revision.source_request_item_id = new.request_item_id
      and revision.status in ('requested', 'editing', 'stock_check')
  ) then
    raise exception using errcode = '55000', message = '[RETURN_ALREADY_OPEN] Для возвращённой позиции нельзя создавать финансовый расход';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_supply_revision_finance_link
  on public.finance_expense_supply_items;
create trigger guard_supply_revision_finance_link
before insert or update on public.finance_expense_supply_items
for each row execute function public.fn_guard_supply_revision_finance_link();

alter table public.supply_position_revisions enable row level security;
grant select on table public.supply_position_revisions to authenticated;
grant select, insert, update, delete on table public.supply_position_revisions to service_role;
create policy supply_position_revisions_select
  on public.supply_position_revisions for select to authenticated
  using (
    requested_by = (select auth.uid())
    or assigned_to = (select auth.uid())
    or public.security_can_view_request_materials()
  );

create or replace function public.supply_position_category(p_table text)
returns public.material_category
language sql
immutable
set search_path = ''
as $$
  select case p_table
    when 'request_sheet_metal' then 'sheet_metal'::public.material_category
    when 'request_circle' then 'circle'::public.material_category
    when 'request_pipe' then 'pipe'::public.material_category
    when 'request_knives' then 'knives'::public.material_category
    when 'request_paint' then 'paint'::public.material_category
    when 'request_components' then 'components'::public.material_category
    when 'request_mesh' then 'mesh'::public.material_category
    when 'request_chain_cord' then 'chain_cord'::public.material_category
    else null
  end;
$$;

create or replace function public.fn_preview_supply_position_revision_v1(
  p_request_item_table text,
  p_request_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_request_id uuid;
  v_machine_id uuid;
  v_order_status text;
  v_blockers jsonb := '[]'::jsonb;
  v_schedule_count integer := 0;
  v_reservation_count integer := 0;
  v_trip_count integer := 0;
  v_finance_count integer := 0;
  v_existing_revision_id uuid;
  v_existing_department_request_id uuid;
  v_mode text := 'standard';
  v_expense record;
begin
  if public.supply_position_category(p_request_item_table) is null or p_request_item_id is null then
    raise exception using errcode = '22023', message = '[INVALID_POSITION_REF] Недопустимая категория позиции';
  end if;

  execute format('select to_jsonb(item) from public.%I item where item.id = $1', p_request_item_table)
    into v_item using p_request_item_id;
  if v_item is null then
    raise exception using errcode = 'P0002', message = '[POSITION_NOT_FOUND] Позиция снабжения не найдена';
  end if;

  v_request_id := (v_item->>'request_id')::uuid;
  v_order_status := coalesce(v_item->>'order_status', 'pending');
  select request.machine_id into v_machine_id
  from public.technologist_requests request where request.id = v_request_id;
  if v_machine_id is null then
    raise exception using errcode = 'P0002', message = '[REQUEST_NOT_FOUND] Исходная заявка не найдена';
  end if;
  if v_order_status in ('delivered', 'cancelled') then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'POSITION_CLOSED', 'message', 'Полученную или отменённую позицию вернуть нельзя'
    ));
  end if;

  select revision.id, revision.department_request_id
    into v_existing_revision_id, v_existing_department_request_id
  from public.supply_position_revisions revision
  where revision.source_request_item_table = p_request_item_table
    and revision.source_request_item_id = p_request_item_id
    and revision.status in ('requested', 'editing', 'stock_check')
  order by revision.created_at desc
  limit 1;

  if p_request_item_table in ('request_circle', 'request_pipe', 'request_knives')
    and exists (
      select 1 from public.long_stock_cutting_plan_items plan_item
      where plan_item.request_item_table = p_request_item_table
        and plan_item.request_item_id = p_request_item_id
        and plan_item.link_state = 'active'
        and plan_item.cutting_status in ('plan_approved', 'requires_recalculation')
    ) then
    v_mode := 'long_stock_recalculation';
    select request.id into v_existing_department_request_id
    from public.department_requests request
    where request.request_kind = 'long_stock_recalculation'
      and request.request_item_table = p_request_item_table
      and request.request_item_id = p_request_item_id
      and request.status in ('new', 'in_progress')
    order by request.created_at desc limit 1;
  end if;

  if exists (
    select 1 from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = p_request_item_table
      and schedule.request_item_id = p_request_item_id
      and (
        schedule.status = 'delivered'
        or coalesce(schedule.received_quantity, 0) > 0
        or coalesce(schedule.allocated_quantity, 0) > 0
        or coalesce(schedule.allocated_physical_quantity, 0) > 0
        or coalesce(schedule.received_piece_count, 0) > 0
        or coalesce(schedule.allocated_piece_count, 0) > 0
      )
  ) or exists (
    select 1 from public.inventory_reservations reservation
    where reservation.request_item_table = p_request_item_table
      and reservation.request_item_id = p_request_item_id
      and reservation.consumed_at is not null
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'RECEIPT_EXISTS', 'message', 'По позиции уже есть приёмка или фактическое распределение'
    ));
  end if;

  if exists (
    select 1
    from public.transport_trip_need_links link
    join public.supply_order_delivery_schedules schedule
      on link.need_source = 'supply_schedule' and link.need_id = schedule.id
    join public.machine_outsourcing_transport_orders trip on trip.id = link.transport_order_id
    where schedule.request_item_table = p_request_item_table
      and schedule.request_item_id = p_request_item_id
      and link.released_at is null
      and trip.status in ('in_transit', 'completed')
  ) then
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'TRANSPORT_STARTED', 'message', 'Связанный рейс уже отправлен или завершён'
    ));
  end if;

  for v_expense in
    select
      expense.id,
      expense.status::text status,
      expense.paid_amount,
      expense.paid_amount_uah,
      expense.supply_item_links_complete,
      (select count(*) from public.finance_expense_supply_items links where links.expense_id = expense.id) link_count,
      exists (
        select 1 from public.finance_expense_supply_items links
        where links.expense_id = expense.id
          and links.request_item_table = p_request_item_table
          and links.request_item_id = p_request_item_id
      ) exact_link
    from public.finance_expenses expense
    where expense.status <> 'rejected'
    and (exists (
      select 1 from public.finance_expense_supply_items links
      where links.expense_id = expense.id
        and links.request_item_table = p_request_item_table
        and links.request_item_id = p_request_item_id
    ) or (
      expense.source_type = 'supply_order'
      and not expense.supply_item_links_complete
      and coalesce(expense.source_key, '') like '%' || p_request_item_table || ':' || p_request_item_id::text || '%'
    ))
  loop
    if not v_expense.supply_item_links_complete or not v_expense.exact_link then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'FINANCE_AMBIGUOUS', 'message', 'Финансовую связь старых данных нельзя определить однозначно'
      ));
    elsif v_expense.status in ('partially_paid', 'paid')
      or coalesce(v_expense.paid_amount, 0) > 0
      or coalesce(v_expense.paid_amount_uah, 0) > 0 then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'FINANCE_PAID', 'message', 'Связанный расход уже частично или полностью оплачен'
      ));
    elsif v_expense.link_count > 1 and v_expense.status <> 'rejected' then
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'FINANCE_SHARED', 'message', 'Финансовый расход объединяет эту позицию с другими'
      ));
    elsif v_expense.status in ('planned', 'overdue') then
      v_finance_count := v_finance_count + 1;
    end if;
  end loop;

  select count(*) into v_schedule_count
  from public.supply_order_delivery_schedules schedule
  where schedule.request_item_table = p_request_item_table
    and schedule.request_item_id = p_request_item_id
    and schedule.status = 'planned';

  select count(*) into v_reservation_count
  from public.inventory_reservations reservation
  where reservation.request_item_table = p_request_item_table
    and reservation.request_item_id = p_request_item_id
    and reservation.consumed_at is null;

  select count(distinct link.transport_order_id) into v_trip_count
  from public.transport_trip_need_links link
  join public.supply_order_delivery_schedules schedule
    on link.need_source = 'supply_schedule' and link.need_id = schedule.id
  join public.machine_outsourcing_transport_orders trip on trip.id = link.transport_order_id
  where schedule.request_item_table = p_request_item_table
    and schedule.request_item_id = p_request_item_id
    and link.released_at is null
    and trip.status in ('needed', 'found');

  return jsonb_build_object(
    'eligible', jsonb_array_length(v_blockers) = 0,
    'mode', v_mode,
    'blockers', v_blockers,
    'requires_external_order_confirmation', v_order_status = 'ordered',
    'existing_revision_id', v_existing_revision_id,
    'existing_department_request_id', v_existing_department_request_id,
    'request_id', v_request_id,
    'machine_id', v_machine_id,
    'impacts', jsonb_build_object(
      'schedules_to_cancel', v_schedule_count,
      'reservations_to_release', v_reservation_count,
      'trips_to_detach', v_trip_count,
      'finance_expenses_to_reject', v_finance_count
    )
  );
end;
$$;

create or replace function public.fn_supply_position_revision_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) else null end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) else null end;
  v_request_id uuid := coalesce((v_new->>'request_id')::uuid, (v_old->>'request_id')::uuid);
  v_item_id uuid := coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid);
  v_replacement_table text;
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
    raise exception using errcode = '55000', message = '[REVISION_STRUCTURE_LOCKED] В корректирующей заявке должна остаться ровно одна позиция';
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

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives',
    'request_paint', 'request_components', 'request_mesh', 'request_chain_cord'
  ] loop
    execute format('drop trigger if exists supply_position_revision_guard on public.%I', v_table);
    execute format(
      'create trigger supply_position_revision_guard before insert or update or delete on public.%I '
      || 'for each row execute function public.fn_supply_position_revision_item_guard()',
      v_table
    );
  end loop;
end;
$migration$;

create or replace function public.fn_supply_position_revision_schedule_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_table text := case when tg_op = 'DELETE' then old.request_item_table else new.request_item_table end;
  v_item_id uuid := case when tg_op = 'DELETE' then old.request_item_id else new.request_item_id end;
begin
  if current_setting('app.supply_position_revision_lifecycle', true) = '1' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if exists (
    select 1 from public.supply_position_revisions revision
    where revision.source_request_item_table = v_table
      and revision.source_request_item_id = v_item_id
      and revision.status in ('requested', 'editing', 'stock_check')
  ) then
    raise exception using errcode = '55000', message = '[RETURN_ALREADY_OPEN] Для возвращённой позиции нельзя создавать или менять график';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists supply_position_revision_schedule_guard
  on public.supply_order_delivery_schedules;
create trigger supply_position_revision_schedule_guard
before insert or update or delete on public.supply_order_delivery_schedules
for each row execute function public.fn_supply_position_revision_schedule_guard();

create or replace function public.fn_return_supply_position_to_technologist_v1(
  p_request_item_table text,
  p_request_item_id uuid,
  p_reason text,
  p_actor uuid,
  p_confirm_external_order boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preview jsonb;
  v_item jsonb;
  v_request public.technologist_requests%rowtype;
  v_machine public.machines%rowtype;
  v_assigned_to uuid;
  v_department_request_id uuid;
  v_revision_id uuid;
  v_task_id uuid;
  v_item_label text;
  v_trip record;
  v_reservation record;
  v_long_stock_result jsonb;
begin
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 2000 then
    raise exception using errcode = '22023', message = '[REASON_REQUIRED] Укажите причину возврата от 3 до 2000 символов';
  end if;
  if not exists (select 1 from public.users where id = p_actor and coalesce(is_active, true)) then
    raise exception using errcode = '42501', message = '[ACTOR_FORBIDDEN] Необходим активный автор возврата';
  end if;
  if public.supply_position_category(p_request_item_table) is null or p_request_item_id is null then
    raise exception using errcode = '22023', message = '[INVALID_POSITION_REF] Недопустимая категория позиции';
  end if;

  execute format('select to_jsonb(item) from public.%I item where item.id = $1 for update', p_request_item_table)
    into v_item using p_request_item_id;
  if v_item is null then
    raise exception using errcode = 'P0002', message = '[POSITION_NOT_FOUND] Позиция снабжения не найдена';
  end if;

  select * into v_request from public.technologist_requests
  where id = (v_item->>'request_id')::uuid for update;
  if not found then
    raise exception using errcode = 'P0002', message = '[REQUEST_NOT_FOUND] Исходная заявка не найдена';
  end if;
  select * into v_machine from public.machines where id = v_request.machine_id;
  v_assigned_to := v_request.created_by;
  if not exists (select 1 from public.users where id = v_assigned_to and coalesce(is_active, true)) then
    raise exception using errcode = '55000', message = '[TECHNOLOGIST_UNAVAILABLE] Исходный технолог недоступен';
  end if;

  select revision.id, revision.department_request_id
    into v_revision_id, v_department_request_id
  from public.supply_position_revisions revision
  where revision.source_request_item_table = p_request_item_table
    and revision.source_request_item_id = p_request_item_id
    and revision.status in ('requested', 'editing', 'stock_check')
  order by revision.created_at desc limit 1;
  if v_revision_id is not null then
    return jsonb_build_object(
      'mode', 'standard', 'revision_id', v_revision_id,
      'department_request_id', v_department_request_id,
      'request_id', v_request.id, 'machine_id', v_request.machine_id,
      'assigned_to', v_assigned_to, 'idempotent', true
    );
  end if;

  v_preview := public.fn_preview_supply_position_revision_v1(p_request_item_table, p_request_item_id);
  if not coalesce((v_preview->>'eligible')::boolean, false) then
    raise exception using errcode = '55000', message = coalesce(
      '[' || (v_preview->'blockers'->0->>'code') || '] ' || (v_preview->'blockers'->0->>'message'),
      '[POSITION_RETURN_BLOCKED] Возврат позиции заблокирован'
    );
  end if;
  if coalesce((v_preview->>'requires_external_order_confirmation')::boolean, false)
    and not p_confirm_external_order then
    raise exception using errcode = '55000', message = '[EXTERNAL_ORDER_CONFIRMATION_REQUIRED] Позиция уже заказана поставщику. Подтвердите отмену внешнего заказа';
  end if;

  -- The old RPC remains the source of truth for approved long-stock maps.
  if v_preview->>'mode' = 'long_stock_recalculation' then
    v_long_stock_result := public.fn_return_long_stock_position_to_technologist_v1(
      p_request_item_table, p_request_item_id, btrim(p_reason), p_actor
    );
    v_department_request_id := (v_long_stock_result->>'department_request_id')::uuid;
  else
    v_item_label := coalesce(
      nullif(v_item->>'material_name', ''), nullif(v_item->>'component_name', ''),
      nullif(v_item->>'knife_type', ''), nullif(v_item->>'paint_type', ''),
      nullif(v_item->>'description', ''), nullif(v_item->>'item_type', ''),
      'Позиция ' || upper(left(p_request_item_id::text, 8))
    );
    v_department_request_id := gen_random_uuid();
    insert into public.department_requests (
      id, request_kind, target_department, title, description, priority, status,
      created_by, assigned_to, factory_id, machine_id,
      request_item_table, request_item_id, technologist_request_id, request_item_label
    ) values (
      v_department_request_id, 'supply_position_revision', 'technologist',
      'Исправить позицию снабжения: ' || v_item_label, btrim(p_reason), 'high', 'in_progress',
      p_actor, v_assigned_to, v_machine.factory_id, v_request.machine_id,
      p_request_item_table, p_request_item_id, v_request.id, v_item_label
    );

    insert into public.supply_position_revisions (
      source_request_id, source_request_item_table, source_request_item_id,
      category, reason, requested_by, assigned_to, department_request_id,
      external_order_cancellation_confirmed_at,
      external_order_cancellation_confirmed_by
    ) values (
      v_request.id, p_request_item_table, p_request_item_id,
      public.supply_position_category(p_request_item_table), btrim(p_reason),
      p_actor, v_assigned_to, v_department_request_id,
      case when (v_item->>'order_status') = 'ordered' then now() else null end,
      case when (v_item->>'order_status') = 'ordered' then p_actor else null end
    ) returning id into v_revision_id;

    insert into public.tasks (
      department_request_id, machine_id, assigned_to, task_type,
      title, description, status, start_date
    ) values (
      v_department_request_id, null, v_assigned_to, 'department_request',
      'Исправить позицию снабжения', btrim(p_reason), 'in_progress', current_date
    ) returning id into v_task_id;

    insert into public.department_request_events(request_id, event_type, actor_id)
    values (v_department_request_id, 'created', p_actor),
           (v_department_request_id, 'claimed', v_assigned_to);
  end if;

  perform set_config('app.supply_position_revision_lifecycle', '1', true);
  for v_reservation in
    select reservation.id
    from public.inventory_reservations reservation
    where reservation.request_item_table = p_request_item_table
      and reservation.request_item_id = p_request_item_id
      and reservation.consumed_at is null
    order by reservation.created_at, reservation.id
  loop
    perform public.fn_unreserve_inventory_reservation(
      v_reservation.id, p_actor, 'Возврат позиции снабжением технологу'
    );
  end loop;

  for v_trip in
    select distinct trip.id
    from public.transport_trip_need_links link
    join public.supply_order_delivery_schedules schedule
      on link.need_source = 'supply_schedule' and link.need_id = schedule.id
    join public.machine_outsourcing_transport_orders trip on trip.id = link.transport_order_id
    where schedule.request_item_table = p_request_item_table
      and schedule.request_item_id = p_request_item_id
      and link.released_at is null
      and trip.status in ('needed', 'found')
  loop
    update public.transport_trip_need_links link
    set released_at = now(),
        released_reason = 'Возврат позиции снабжением технологу',
        released_by = p_actor
    from public.supply_order_delivery_schedules schedule
    where link.transport_order_id = v_trip.id
      and link.need_source = 'supply_schedule'
      and link.need_id = schedule.id
      and schedule.request_item_table = p_request_item_table
      and schedule.request_item_id = p_request_item_id
      and link.released_at is null;

    update public.machine_outsourcing_transport_orders trip
    set status = 'cancelled',
        cancellation_reason = 'Отменён после возврата последней позиции технологу',
        cancelled_at = now(), cancelled_by = p_actor,
        updated_by = p_actor, updated_at = now()
    where trip.id = v_trip.id
      and trip.status in ('needed', 'found')
      and not exists (
        select 1 from public.transport_trip_need_links active_link
        where active_link.transport_order_id = trip.id and active_link.released_at is null
      );
  end loop;

  update public.tasks task
  set status = 'cancelled', completed_at = now(), updated_at = now()
  from public.supply_order_delivery_schedules schedule
  where task.supply_order_schedule_id = schedule.id
    and schedule.request_item_table = p_request_item_table
    and schedule.request_item_id = p_request_item_id
    and task.status in ('pending', 'in_progress');

  update public.supply_order_delivery_schedules schedule
  set status = 'cancelled',
      change_reason = 'Возврат позиции снабжением технологу',
      updated_by = p_actor, updated_at = now()
  where schedule.request_item_table = p_request_item_table
    and schedule.request_item_id = p_request_item_id
    and schedule.status = 'planned';

  insert into public.finance_event_actions(
    event_type, event_id, action, amount, comment, performed_by, performed_via
  )
  select 'expense', expense.id, 'rejected_for_supply_position_revision',
    expense.amount, 'Возврат позиции снабжением технологу: ' || btrim(p_reason), p_actor, 'crm'
  from public.finance_expenses expense
  where expense.status in ('planned', 'overdue')
    and coalesce(expense.paid_amount, 0) = 0
    and coalesce(expense.paid_amount_uah, 0) = 0
    and expense.supply_item_links_complete
    and (select count(*) from public.finance_expense_supply_items links where links.expense_id = expense.id) = 1
    and exists (
      select 1 from public.finance_expense_supply_items links
      where links.expense_id = expense.id
        and links.request_item_table = p_request_item_table
        and links.request_item_id = p_request_item_id
    );

  update public.finance_expenses expense
  set status = 'rejected', updated_by = p_actor, updated_at = now(),
      comment = concat_ws(E'\n', nullif(expense.comment, ''), 'Отклонён: позиция возвращена технологу')
  where expense.status in ('planned', 'overdue')
    and coalesce(expense.paid_amount, 0) = 0
    and coalesce(expense.paid_amount_uah, 0) = 0
    and expense.supply_item_links_complete
    and (select count(*) from public.finance_expense_supply_items links where links.expense_id = expense.id) = 1
    and exists (
      select 1 from public.finance_expense_supply_items links
      where links.expense_id = expense.id
        and links.request_item_table = p_request_item_table
        and links.request_item_id = p_request_item_id
    );

  if v_preview->>'mode' = 'long_stock_recalculation' then
    perform set_config('app.supply_position_revision_lifecycle', '', true);
    return v_long_stock_result || jsonb_build_object('mode', 'long_stock_recalculation');
  end if;
  perform set_config('app.supply_position_revision_lifecycle', '', true);
  return jsonb_build_object(
    'mode', 'standard', 'revision_id', v_revision_id,
    'department_request_id', v_department_request_id, 'task_id', v_task_id,
    'request_id', v_request.id, 'machine_id', v_request.machine_id,
    'assigned_to', v_assigned_to, 'idempotent', false
  );
exception
  when unique_violation then
    select revision.id, revision.department_request_id
      into v_revision_id, v_department_request_id
    from public.supply_position_revisions revision
    where revision.source_request_item_table = p_request_item_table
      and revision.source_request_item_id = p_request_item_id
      and revision.status in ('requested', 'editing', 'stock_check')
    order by revision.created_at desc limit 1;
    if v_revision_id is null then raise; end if;
    return jsonb_build_object(
      'mode', 'standard', 'revision_id', v_revision_id,
      'department_request_id', v_department_request_id,
      'request_id', v_request.id, 'machine_id', v_request.machine_id,
      'assigned_to', v_assigned_to, 'idempotent', true
    );
end;
$$;

create or replace function public.fn_create_supply_position_revision_request_v1(
  p_department_request_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_revision public.supply_position_revisions%rowtype;
  v_source jsonb;
  v_request_id uuid;
  v_item_id uuid;
  v_columns text;
  v_actor_role text;
begin
  select * into v_revision from public.supply_position_revisions
  where department_request_id = p_department_request_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = '[REVISION_NOT_FOUND] Запрос на исправление позиции не найден';
  end if;

  select role::text into v_actor_role from public.users
  where id = p_actor and coalesce(is_active, true);
  if p_actor is distinct from v_revision.assigned_to
    and coalesce(v_actor_role, '') not in ('planning_director', 'financial_director', 'commercial_director') then
    raise exception using errcode = '42501', message = '[REVISION_FORBIDDEN] Исправить позицию может назначенный технолог или руководитель';
  end if;

  if v_revision.replacement_request_id is not null then
    return jsonb_build_object(
      'revision_id', v_revision.id,
      'request_id', v_revision.replacement_request_id,
      'request_item_id', v_revision.replacement_request_item_id,
      'machine_id', (select machine_id from public.technologist_requests where id = v_revision.replacement_request_id),
      'idempotent', true
    );
  end if;

  execute format('select to_jsonb(item) from public.%I item where item.id = $1 for update', v_revision.source_request_item_table)
    into v_source using v_revision.source_request_item_id;
  if v_source is null then
    raise exception using errcode = 'P0002', message = '[POSITION_NOT_FOUND] Исходная позиция не найдена';
  end if;

  insert into public.technologist_requests(machine_id, created_by, status, notes, is_recalculation_staging)
  select machine_id, v_revision.assigned_to, 'draft',
    'Исправление одной позиции по возврату снабжения', false
  from public.technologist_requests where id = v_revision.source_request_id
  returning id into v_request_id;
  v_item_id := gen_random_uuid();

  v_source := v_source || jsonb_build_object(
    'id', v_item_id,
    'request_id', v_request_id,
    'sort_order', 0,
    'created_at', now(),
    'order_status', 'pending',
    'supplier_id', null,
    'ordered_at', null,
    'delivered_at', null,
    'custom_delivery_date', null,
    'cancelled_at', null,
    'cancelled_by', null,
    'cancellation_reason', null,
    'reserved_from_stock_kg', 0,
    'reserved_from_stock_mm', 0,
    'reserved_from_stock_m', 0,
    'reserved_from_stock', 0,
    'reserved_from_stock_length_mm', 0,
    'reserved_from_stock_qty', 0,
    'reserved_from_stock_meters', 0,
    'stock_on_hand_kg', null,
    'stock_remainder_kg', null,
    'stock_remainder_mm', null,
    'stock_remainder', null,
    'availability', null
  );

  select string_agg(quote_ident(attribute.attname), ', ' order by attribute.attnum)
    into v_columns
  from pg_attribute attribute
  where attribute.attrelid = format('public.%I', v_revision.source_request_item_table)::regclass
    and attribute.attnum > 0 and not attribute.attisdropped
    and attribute.attgenerated = '' and attribute.attidentity = '';

  perform set_config('app.supply_position_revision_lifecycle', '1', true);
  execute format(
    'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)',
    v_revision.source_request_item_table, v_columns
  ) using v_source;
  update public.supply_position_revisions
  set replacement_request_id = v_request_id,
      replacement_request_item_table = source_request_item_table,
      replacement_request_item_id = v_item_id,
      status = 'editing', updated_at = now()
  where id = v_revision.id;
  perform set_config('app.supply_position_revision_lifecycle', '', true);

  return jsonb_build_object(
    'revision_id', v_revision.id, 'request_id', v_request_id,
    'request_item_id', v_item_id,
    'machine_id', (select machine_id from public.technologist_requests where id = v_request_id),
    'idempotent', false
  );
end;
$$;

create or replace function public.fn_sync_supply_position_revision_stock_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('pending_stock_check', 'stock_checked')
    and new.status is distinct from old.status then
    update public.supply_position_revisions
    set status = 'stock_check', updated_at = now()
    where replacement_request_id = new.id and status = 'editing';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_supply_position_revision_stock_check on public.technologist_requests;
create trigger sync_supply_position_revision_stock_check
after update of status on public.technologist_requests
for each row execute function public.fn_sync_supply_position_revision_stock_check();

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
  if v_request.status not in ('pending_stock_check', 'stock_checked') then
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
      if v_count <> 1 then
        raise exception using errcode = '55000', message = '[REVISION_STRUCTURE_LOCKED] В корректирующей заявке должна быть одна позиция исходной категории';
      end if;
      execute format('select id from public.%I where request_id = $1', v_table)
        into v_replacement_item_id using p_request_id;
    elsif v_count <> 0 then
      raise exception using errcode = '55000', message = '[REVISION_CATEGORY_LOCKED] Категорию корректирующей позиции менять нельзя';
    end if;
  end loop;
  if v_total <> 1 or v_replacement_item_id is distinct from v_revision.replacement_request_item_id then
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

  perform public.notify_users_by_role(
    'supply_manager'::public.user_role,
    'supply_position_revision_submitted',
    'Исправленная позиция готова к закупке',
    'Технолог завершил исправление возвращённой позиции',
    v_request.machine_id
  );
  perform set_config('app.supply_position_revision_lifecycle', '', true);

  return jsonb_build_object(
    'revision_id', v_revision.id, 'request_id', p_request_id,
    'request_item_id', v_replacement_item_id,
    'source_request_id', v_revision.source_request_id,
    'machine_id', v_request.machine_id, 'idempotent', false
  );
end;
$$;

-- Recreate the latest identity guard with the new system lifecycle included.
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
  is_long_stock_lifecycle boolean :=
    old.request_kind = 'long_stock_recalculation'
    and current_setting('app.long_stock_recalculation_request_lifecycle', true) = '1';
  is_position_revision_lifecycle boolean :=
    old.request_kind = 'supply_position_revision'
    and current_setting('app.supply_position_revision_request_lifecycle', true) = '1';
  is_transport_date_lifecycle boolean :=
    old.request_kind = 'transport_trip_date_approval'
    and current_setting('app.transport_date_request_lifecycle', true) = '1';
begin
  if new.created_by is distinct from old.created_by
    or new.target_department is distinct from old.target_department
    or new.factory_id is distinct from old.factory_id
    or new.machine_id is distinct from old.machine_id
    or new.title is distinct from old.title
    or new.description is distinct from old.description
    or new.priority is distinct from old.priority
    or new.request_kind is distinct from old.request_kind
    or new.request_item_table is distinct from old.request_item_table
    or new.request_item_id is distinct from old.request_item_id
    or new.technologist_request_id is distinct from old.technologist_request_id
    or new.long_stock_plan_id is distinct from old.long_stock_plan_id
    or new.long_stock_returned_version_id is distinct from old.long_stock_returned_version_id
    or new.transport_trip_date_change_request_id is distinct from old.transport_trip_date_change_request_id
    or new.request_item_label is distinct from old.request_item_label
    or (new.due_date is distinct from old.due_date and not is_layout_claim) then
    raise exception 'Основные данные запроса нельзя менять после отправки';
  end if;

  if old.request_kind = 'long_stock_recalculation'
    and not is_long_stock_lifecycle
    and (
      new.status is distinct from old.status or new.assigned_to is distinct from old.assigned_to
      or new.completed_by is distinct from old.completed_by or new.completed_at is distinct from old.completed_at
      or new.response is distinct from old.response
    ) then
    raise exception 'Запрос на пересчёт закрывается только утверждением новой версии карты';
  end if;
  if old.request_kind = 'supply_position_revision'
    and not is_position_revision_lifecycle
    and (
      new.status is distinct from old.status or new.assigned_to is distinct from old.assigned_to
      or new.completed_by is distinct from old.completed_by or new.completed_at is distinct from old.completed_at
      or new.response is distinct from old.response
    ) then
    raise exception 'Запрос на исправление закрывается только отправкой заменяющей позиции';
  end if;
  if old.request_kind = 'transport_trip_date_approval'
    and not is_transport_date_lifecycle
    and (
      new.status is distinct from old.status or new.assigned_to is distinct from old.assigned_to
      or new.completed_by is distinct from old.completed_by or new.completed_at is distinct from old.completed_at
      or new.response is distinct from old.response
    ) then
    raise exception 'Системный запрос закрывается только решением транспортного согласования';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.supply_position_category(text) from public, anon, authenticated;
grant execute on function public.supply_position_category(text) to service_role;
revoke all on function public.fn_preview_supply_position_revision_v1(text, uuid) from public, anon, authenticated;
grant execute on function public.fn_preview_supply_position_revision_v1(text, uuid) to service_role;
revoke all on function public.fn_return_supply_position_to_technologist_v1(text, uuid, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.fn_return_supply_position_to_technologist_v1(text, uuid, text, uuid, boolean) to service_role;
revoke all on function public.fn_create_supply_position_revision_request_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_create_supply_position_revision_request_v1(uuid, uuid) to service_role;
revoke all on function public.fn_submit_supply_position_revision_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_submit_supply_position_revision_v1(uuid, uuid) to service_role;
revoke all on function public.fn_supply_position_revision_item_guard() from public, anon, authenticated;
revoke all on function public.fn_supply_position_revision_schedule_guard() from public, anon, authenticated;
revoke all on function public.fn_guard_supply_revision_finance_link() from public, anon, authenticated;
revoke all on function public.fn_sync_supply_position_revision_stock_check() from public, anon, authenticated;
revoke all on function public.protect_department_request_identity() from public, anon, authenticated;

comment on table public.supply_position_revisions is
  'Audit journal for one-position supply returns and their corrected replacements.';
comment on function public.fn_preview_supply_position_revision_v1(text, uuid) is
  'Read-only impact and blocker preview for a one-position supply return.';
comment on function public.fn_return_supply_position_to_technologist_v1(text, uuid, text, uuid, boolean) is
  'Atomically detaches safe commitments and assigns one procurement position back to its technologist.';
comment on function public.fn_create_supply_position_revision_request_v1(uuid, uuid) is
  'Idempotently creates the visible, one-row correction request in the same material category.';
comment on function public.fn_submit_supply_position_revision_v1(uuid, uuid) is
  'Atomically cancels the source position and submits its stock-checked replacement to supply.';
