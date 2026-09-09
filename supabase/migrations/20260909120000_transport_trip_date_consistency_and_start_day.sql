-- Keep the approved transport date, its stops, and linked needs on one calendar
-- day. Trip lifecycle dates use the business timezone of the CRM.

do $$
declare
  v_repair record;
begin
  -- Repair the narrow legacy state produced when an approved request updated
  -- every linked need but left the planned trip on the request's old date.
  for v_repair in
    select
      trip.id as trip_id,
      item_dates.target_date
    from public.machine_outsourcing_transport_orders trip
    cross join lateral (
      select request.id
      from public.transport_trip_date_change_requests request
      where request.transport_order_id = trip.id
        and request.status = 'approved'
      order by request.decided_at desc nulls last, request.created_at desc, request.id desc
      limit 1
    ) latest_request
    cross join lateral (
      select min(item.old_date) as original_date, min(item.new_date) as target_date
      from public.transport_trip_date_change_items item
      where item.request_id = latest_request.id
      having count(*) > 0
        and min(item.old_date) = max(item.old_date)
        and min(item.new_date) = max(item.new_date)
    ) item_dates
    where trip.status = 'found'
      and trip.date_change_state = 'approved'
      and item_dates.original_date = trip.scheduled_date
      and item_dates.target_date is distinct from trip.scheduled_date
      and not exists (
        select 1
        from public.transport_trip_date_change_items item
        left join public.transport_trip_need_links link
          on link.id = item.transport_need_link_id
          and link.transport_order_id = trip.id
          and link.released_at is null
        where item.request_id = latest_request.id
          and (
            item.status <> 'approved'
            or link.id is null
            or public.transport_need_current_date(item.need_source, item.need_id)
              is distinct from item.new_date
          )
      )
      and exists (
        select 1
        from public.transport_trip_stops stop
        where stop.transport_order_id = trip.id
          and stop.status = 'planned'
          and stop.planned_arrival_at is not null
      )
      and not exists (
        select 1
        from public.transport_trip_stops stop
        where stop.transport_order_id = trip.id
          and stop.status <> 'planned'
      )
  loop
    update public.transport_trip_stops
    set planned_arrival_at = (
          v_repair.target_date
          + (planned_arrival_at at time zone 'Europe/Kyiv')::time
        ) at time zone 'Europe/Kyiv',
        updated_at = now()
    where transport_order_id = v_repair.trip_id
      and status = 'planned'
      and planned_arrival_at is not null;

    update public.transport_trip_need_links link
    set needed_date = v_repair.target_date
    where link.transport_order_id = v_repair.trip_id
      and link.released_at is null;

    update public.machine_outsourcing_transport_orders
    set scheduled_date = v_repair.target_date,
        updated_at = now()
    where id = v_repair.trip_id;
  end loop;
end;
$$;

create or replace function public.invalidate_transport_trip_date_request_on_date_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.transport_trip_date_change_requests%rowtype;
  v_actor uuid;
begin
  select request.* into v_request
  from public.transport_trip_date_change_requests request
  where request.transport_order_id = old.id
    and request.status = 'pending'
    and exists (
      select 1
      from public.transport_trip_date_change_items item
      where item.request_id = request.id
        and item.new_date is distinct from new.scheduled_date
    )
  for update;

  if not found then return new; end if;

  v_actor := coalesce(new.updated_by, old.updated_by, v_request.requested_by);

  update public.tasks
  set status = 'completed',
      completed_at = now(),
      updated_at = now()
  where id = v_request.task_id
    and status in ('pending', 'in_progress');

  update public.transport_trip_date_change_items
  set status = 'conflicted',
      decided_at = now()
  where request_id = v_request.id
    and status = 'pending';

  update public.transport_trip_date_change_requests
  set status = 'conflicted',
      decided_by = v_actor,
      decided_at = now(),
      decision_comment = concat_ws(
        E'\n',
        nullif(decision_comment, ''),
        'Согласование закрыто: дата рейса изменена после отправки запроса'
      ),
      updated_at = now()
  where id = v_request.id;

  new.date_change_state := 'not_required';
  return new;
end;
$$;

revoke all on function public.invalidate_transport_trip_date_request_on_date_change()
  from public, anon, authenticated;

drop trigger if exists invalidate_transport_trip_date_request_on_date_change
  on public.machine_outsourcing_transport_orders;
create trigger invalidate_transport_trip_date_request_on_date_change
before update of scheduled_date on public.machine_outsourcing_transport_orders
for each row
when (old.scheduled_date is distinct from new.scheduled_date)
execute function public.invalidate_transport_trip_date_request_on_date_change();

create or replace function public.guard_transport_trip_date_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip public.machine_outsourcing_transport_orders%rowtype;
begin
  select trip.* into v_trip
  from public.machine_outsourcing_transport_orders trip
  where trip.id = new.transport_order_id
  for update;

  if not found
    or v_trip.date_change_state <> 'pending'
    or not exists (
      select 1
      from public.transport_trip_date_change_items item
      where item.request_id = new.id
    )
    or exists (
      select 1
      from public.transport_trip_date_change_items item
      left join public.transport_trip_need_links link
        on link.id = item.transport_need_link_id
        and link.transport_order_id = new.transport_order_id
        and link.released_at is null
      where item.request_id = new.id
        and (
          item.status <> 'pending'
          or item.new_date is distinct from v_trip.scheduled_date
          or link.id is null
        )
    ) then
    raise exception 'Согласование переноса устарело: дата или состав рейса уже изменены';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_transport_trip_date_approval()
  from public, anon, authenticated;

drop trigger if exists guard_transport_trip_date_approval
  on public.transport_trip_date_change_requests;
create trigger guard_transport_trip_date_approval
before update of status on public.transport_trip_date_change_requests
for each row
when (old.status = 'pending' and new.status = 'approved')
execute function public.guard_transport_trip_date_approval();

create or replace function public.fn_start_transport_trip_v1(
  p_trip_id uuid,
  p_actor uuid
) returns public.outsourcing_transport_order_status
language plpgsql
set search_path = ''
as $$
declare
  v_trip public.machine_outsourcing_transport_orders%rowtype;
  v_first_stop public.transport_trip_stops%rowtype;
begin
  if p_actor is null then raise exception 'Не указан пользователь'; end if;

  select * into v_trip
  from public.machine_outsourcing_transport_orders
  where id = p_trip_id
  for update;
  if not found then raise exception 'Рейс не найден'; end if;
  if v_trip.status <> 'found' then
    raise exception 'Начать можно только запланированный рейс';
  end if;
  if v_trip.date_change_state not in ('not_required', 'approved') then
    raise exception 'Начало рейса заблокировано до согласования переноса дат';
  end if;
  if not exists (
    select 1
    from public.transport_trip_need_links link
    where link.transport_order_id = p_trip_id
      and link.released_at is null
  ) then
    raise exception 'В рейсе нет активных потребностей';
  end if;

  select * into v_first_stop
  from public.transport_trip_stops
  where transport_order_id = p_trip_id
    and stop_kind <> 'start'
  order by sequence_no
  limit 1;
  if not found or v_first_stop.planned_arrival_at is null then
    raise exception 'У рейса не указано время начала';
  end if;
  if (now() at time zone 'Europe/Kyiv')::date < v_trip.scheduled_date then
    raise exception 'Запланированный день начала рейса ещё не наступил';
  end if;

  update public.machine_outsourcing_transport_orders
  set status = 'in_transit',
      started_at = now(),
      started_by = p_actor,
      completed_at = null,
      completed_by = null,
      updated_by = p_actor,
      updated_at = now()
  where id = p_trip_id;

  return 'in_transit';
end;
$$;

revoke all on function public.fn_start_transport_trip_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_start_transport_trip_v1(uuid, uuid)
  to service_role;

comment on function public.invalidate_transport_trip_date_request_on_date_change() is
  'Closes a pending date approval when the trip no longer matches its requested target date';
comment on function public.guard_transport_trip_date_approval() is
  'Rejects approval of a stale transport date or composition snapshot before source dates can commit';
