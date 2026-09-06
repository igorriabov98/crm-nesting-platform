-- The shared department-request trigger already writes the initial "created"
-- history event. Keep only the explicit "claimed" event for system projections.

create or replace function public.transport_trip_display_name(
  p_transport_order_id uuid
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(to_char(transport_order.scheduled_date, 'DDMM'), '0000')
    || coalesce((
      select string_agg(
        upper(left(regexp_replace(
          regexp_replace(
            coalesce(
              nullif(btrim(stop.city), ''),
              nullif(btrim(regexp_replace(stop.point_label, '^.*[—-][[:space:]]*', '')), '')
            ),
            '^м\.?[[:space:]]+',
            '',
            'i'
          ),
          '[^[:alpha:]]',
          '',
          'g'
        ), 2)),
        '' order by stop.sequence_no
      )
      from public.transport_trip_stops stop
      where stop.transport_order_id = transport_order.id
        and stop.stop_kind <> 'start'
        and coalesce(nullif(btrim(stop.city), ''), nullif(btrim(stop.point_label), '')) is not null
    ), '')
  from public.machine_outsourcing_transport_orders transport_order
  where transport_order.id = p_transport_order_id;
$$;

revoke all on function public.transport_trip_display_name(uuid)
  from public, anon, authenticated;
grant execute on function public.transport_trip_display_name(uuid)
  to service_role;

create or replace function public.sync_transport_date_department_request(
  p_transport_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transport_request public.transport_trip_date_change_requests%rowtype;
  v_transport_order public.machine_outsourcing_transport_orders%rowtype;
  v_task public.tasks%rowtype;
  v_department_request_id uuid;
  v_changes text;
  v_status text;
  v_trip_name text;
  v_trip_label text;
begin
  select * into v_transport_request
  from public.transport_trip_date_change_requests
  where id = p_transport_request_id;
  if not found or v_transport_request.task_id is null then return null; end if;

  select * into v_task from public.tasks where id = v_transport_request.task_id;
  if not found or v_task.assigned_to is null then return null; end if;

  select * into v_transport_order
  from public.machine_outsourcing_transport_orders
  where id = v_transport_request.transport_order_id;
  v_trip_name := public.transport_trip_display_name(v_transport_order.id);
  v_trip_label := coalesce(
    nullif(btrim(v_transport_order.route), ''),
    nullif(btrim(v_transport_order.route_start), ''),
    'Маршрут не указан'
  );

  select string_agg(
    to_char(item.old_date, 'DD.MM.YYYY') || ' -> ' || to_char(item.new_date, 'DD.MM.YYYY'),
    E'\n' order by item.sort_order
  ) into v_changes
  from public.transport_trip_date_change_items item
  where item.request_id = v_transport_request.id;

  v_status := case
    when v_transport_request.status = 'pending' then 'in_progress'
    when v_transport_request.status = 'approved' then 'done'
    when v_transport_request.status in ('rejected', 'conflicted') then 'rejected'
    else 'cancelled'
  end;

  insert into public.department_requests (
    request_kind,
    target_department,
    title,
    description,
    priority,
    status,
    created_by,
    assigned_to,
    completed_by,
    due_date,
    response,
    completed_at,
    transport_trip_date_change_request_id
  ) values (
    'transport_trip_date_approval',
    'planning',
    'Согласовать перенос дат рейса ' || v_trip_name,
    'Рейс: ' || v_trip_name || ' · ' || v_trip_label
      || case when v_transport_order.scheduled_date is not null
        then ' · ' || to_char(v_transport_order.scheduled_date, 'DD.MM.YYYY') else '' end || E'\n'
      || 'Причина: ' || v_transport_request.reason || E'\n'
      || 'Переносы:' || E'\n' || coalesce(v_changes, 'Нет строк переноса'),
    'high',
    v_status,
    v_transport_request.requested_by,
    v_task.assigned_to,
    case when v_status in ('done', 'rejected', 'cancelled') then v_transport_request.decided_by else null end,
    v_task.deadline,
    v_transport_request.decision_comment,
    case when v_status in ('done', 'rejected', 'cancelled') then v_transport_request.decided_at else null end,
    v_transport_request.id
  )
  on conflict (transport_trip_date_change_request_id) where transport_trip_date_change_request_id is not null
  do nothing
  returning id into v_department_request_id;

  if v_department_request_id is null then
    select id into v_department_request_id
    from public.department_requests
    where transport_trip_date_change_request_id = v_transport_request.id;
  else
    insert into public.department_request_events(request_id, event_type, actor_id)
    values (v_department_request_id, 'claimed', v_task.assigned_to);
  end if;

  update public.tasks
  set department_request_id = v_department_request_id,
      title = 'Согласовать перенос дат рейса ' || v_trip_name,
      updated_at = now()
  where id = v_task.id
    and (
      department_request_id is distinct from v_department_request_id
      or title is distinct from 'Согласовать перенос дат рейса ' || v_trip_name
    );

  return v_department_request_id;
end;
$$;

revoke all on function public.sync_transport_date_department_request(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_transport_date_department_request(uuid)
  to service_role;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.department_requests'::regclass
      and tgname = 'protect_department_request_identity_before_update'
      and not tgisinternal
  ) then
    alter table public.department_requests
      disable trigger protect_department_request_identity_before_update;
  end if;
end;
$$;

with request_labels as (
  select
    request.id,
    'Согласовать перенос дат рейса ' || public.transport_trip_display_name(transport_order.id) as title,
    'Рейс: ' || public.transport_trip_display_name(transport_order.id) || ' · ' || coalesce(
      nullif(btrim(transport_order.route), ''),
      nullif(btrim(transport_order.route_start), ''),
      'Маршрут не указан'
    )
      || case when transport_order.scheduled_date is not null
        then ' · ' || to_char(transport_order.scheduled_date, 'DD.MM.YYYY') else '' end || E'\n'
      || 'Причина: ' || transport_request.reason || E'\n'
      || 'Переносы:' || E'\n'
      || coalesce(string_agg(
        to_char(item.old_date, 'DD.MM.YYYY') || ' -> ' || to_char(item.new_date, 'DD.MM.YYYY'),
        E'\n' order by item.sort_order
      ), 'Нет строк переноса') as description
  from public.department_requests request
  join public.transport_trip_date_change_requests transport_request
    on transport_request.id = request.transport_trip_date_change_request_id
  join public.machine_outsourcing_transport_orders transport_order
    on transport_order.id = transport_request.transport_order_id
  left join public.transport_trip_date_change_items item
    on item.request_id = transport_request.id
  where request.request_kind = 'transport_trip_date_approval'
  group by request.id, transport_order.id, transport_order.route, transport_order.route_start,
    transport_order.scheduled_date, transport_request.reason
)
update public.department_requests request
set title = label.title,
    description = label.description,
    updated_at = now()
from request_labels label
where request.id = label.id;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.department_requests'::regclass
      and tgname = 'protect_department_request_identity_before_update'
      and not tgisinternal
  ) then
    alter table public.department_requests
      enable trigger protect_department_request_identity_before_update;
  end if;
end;
$$;

update public.tasks task
set title = 'Согласовать перенос дат рейса '
      || public.transport_trip_display_name(transport_request.transport_order_id),
    updated_at = now()
from public.transport_trip_date_change_requests transport_request
where transport_request.task_id = task.id
  and task.title is distinct from 'Согласовать перенос дат рейса '
    || public.transport_trip_display_name(transport_request.transport_order_id);

with duplicated_events as (
  select
    event.id,
    row_number() over (
      partition by event.request_id, event.event_type
      order by event.created_at, event.id
    ) as duplicate_order
  from public.department_request_events event
  join public.department_requests request on request.id = event.request_id
  where request.request_kind = 'transport_trip_date_approval'
    and event.event_type = 'created'
)
delete from public.department_request_events event
using duplicated_events duplicate
where event.id = duplicate.id
  and duplicate.duplicate_order > 1;
