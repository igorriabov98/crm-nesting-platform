-- The shared department-request trigger already writes the initial "created"
-- history event. Keep only the explicit "claimed" event for system projections.

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
  v_task public.tasks%rowtype;
  v_department_request_id uuid;
  v_changes text;
  v_status text;
begin
  select * into v_transport_request
  from public.transport_trip_date_change_requests
  where id = p_transport_request_id;
  if not found or v_transport_request.task_id is null then return null; end if;

  select * into v_task from public.tasks where id = v_transport_request.task_id;
  if not found or v_task.assigned_to is null then return null; end if;

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
    'Согласовать перенос дат рейса #' || upper(left(v_transport_request.transport_order_id::text, 8)),
    'Рейс: ' || v_transport_request.transport_order_id::text || E'\n'
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
      updated_at = now()
  where id = v_task.id
    and department_request_id is distinct from v_department_request_id;

  return v_department_request_id;
end;
$$;

revoke all on function public.sync_transport_date_department_request(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_transport_date_department_request(uuid)
  to service_role;

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
