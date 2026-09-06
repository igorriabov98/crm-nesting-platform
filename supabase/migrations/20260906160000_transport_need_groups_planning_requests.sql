-- Transport date approvals are exposed as one planning-department request.
-- Supply schedule rows remain untouched: grouping is a read projection.

alter table public.department_requests
  drop constraint if exists department_requests_target_check;

alter table public.department_requests
  add constraint department_requests_target_check
  check (target_department in ('technologist', 'supply', 'production', 'planning'));

alter table public.department_requests
  add column if not exists transport_trip_date_change_request_id uuid
    references public.transport_trip_date_change_requests(id) on delete restrict;

alter table public.department_requests
  drop constraint if exists department_requests_kind_check;

alter table public.department_requests
  add constraint department_requests_kind_check
  check (request_kind in (
    'manual',
    'machine_layout',
    'long_stock_recalculation',
    'transport_trip_date_approval'
  ));

alter table public.department_requests
  add constraint department_requests_transport_date_reference_check
  check (
    (
      request_kind = 'transport_trip_date_approval'
      and target_department = 'planning'
      and transport_trip_date_change_request_id is not null
    )
    or (
      request_kind <> 'transport_trip_date_approval'
      and target_department <> 'planning'
      and transport_trip_date_change_request_id is null
    )
  );

create unique index if not exists department_requests_transport_date_request_unique_idx
  on public.department_requests(transport_trip_date_change_request_id)
  where transport_trip_date_change_request_id is not null;

create or replace function public.can_manage_department_request_target(
  p_target_department text,
  p_factory_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with current_access as (
    select
      public.get_user_role()::text as role_name,
      public.get_user_factory_id() as factory_id
  )
  select
    case
      when access.role_name in ('financial_director', 'commercial_director', 'planning_director')
        then true
      when p_target_department = 'technologist'
        and access.role_name in ('engineer', 'technologist')
        then true
      when p_target_department = 'supply'
        and access.role_name in ('supply_manager', 'procurement_head')
        then true
      when p_target_department = 'production'
        and access.role_name in ('production_manager', 'painting_head')
        and (p_factory_id is null or p_factory_id = access.factory_id)
        then true
      when p_target_department = 'planning'
        and access.role_name = 'planning_director'
        then true
      else exists (
        select 1
        from public.department_members member
        join public.departments department on department.id = member.department_id
        where member.user_id = (select auth.uid())
          and department.is_active
          and (
            (p_target_department = 'technologist'
              and (lower(department.name) like '%техническ%' or lower(department.name) like '%технолог%'))
            or (p_target_department = 'supply'
              and (lower(department.name) like '%снабжен%' or lower(department.name) like '%закуп%'))
            or (p_target_department = 'production'
              and (lower(department.name) like '%производств%' or lower(department.name) like '%цех%')
              and (
                p_factory_id is null
                or department.factory_id is null
                or department.factory_id = access.factory_id
              ))
            or (p_target_department = 'planning'
              and (lower(department.name) like '%планирован%' or lower(department.name) like '%planning%'))
          )
      )
    end
  from current_access access;
$$;

revoke all on function public.can_manage_department_request_target(text, uuid) from public, anon;
grant execute on function public.can_manage_department_request_target(text, uuid) to authenticated, service_role;

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
      new.status is distinct from old.status
      or new.assigned_to is distinct from old.assigned_to
      or new.completed_by is distinct from old.completed_by
      or new.completed_at is distinct from old.completed_at
      or new.response is distinct from old.response
    ) then
    raise exception 'Запрос на пересчёт закрывается только утверждением новой версии карты';
  end if;

  if old.request_kind = 'transport_trip_date_approval'
    and not is_transport_date_lifecycle
    and (
      new.status is distinct from old.status
      or new.assigned_to is distinct from old.assigned_to
      or new.completed_by is distinct from old.completed_by
      or new.completed_at is distinct from old.completed_at
      or new.response is distinct from old.response
    ) then
    raise exception 'Системный запрос закрывается только решением транспортного согласования';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.protect_department_request_identity()
  from public, anon, authenticated;

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
    values (v_department_request_id, 'created', v_transport_request.requested_by),
           (v_department_request_id, 'claimed', v_task.assigned_to);
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

create or replace function public.notify_transport_date_department_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (
    user_id,
    type,
    title,
    message,
    related_department_request_id
  ) values (
    new.assigned_to,
    'department_request_new_planning',
    'Новый запрос: ' || new.title,
    'Требуется согласовать перенос дат транспортного рейса',
    new.id
  );
  return new;
end;
$$;

revoke all on function public.notify_transport_date_department_request()
  from public, anon, authenticated;

drop trigger if exists notify_transport_date_department_request_after_insert
  on public.department_requests;
create trigger notify_transport_date_department_request_after_insert
after insert on public.department_requests
for each row
when (new.request_kind = 'transport_trip_date_approval')
execute function public.notify_transport_date_department_request();

create or replace function public.sync_transport_date_department_request_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_department_request_id uuid;
  v_department_status text;
  v_event_type text;
begin
  if new.task_id is not null then
    v_department_request_id := public.sync_transport_date_department_request(new.id);
  end if;

  if v_department_request_id is not null
    and (tg_op = 'INSERT' or new.status is distinct from old.status)
    and new.status <> 'pending' then
    v_department_status := case
      when new.status = 'approved' then 'done'
      when new.status in ('rejected', 'conflicted') then 'rejected'
      else 'cancelled'
    end;
    v_event_type := case when v_department_status = 'done' then 'completed' else v_department_status::text end;
    perform set_config('app.transport_date_request_lifecycle', '1', true);
    update public.department_requests
    set status = v_department_status,
        response = coalesce(
          nullif(btrim(new.decision_comment), ''),
          case new.status
            when 'approved' then 'Перенос дат одобрен'
            when 'conflicted' then 'Согласование закрыто из-за конфликта исходных дат'
            else 'Перенос дат отклонён'
          end
        ),
        completed_by = new.decided_by,
        completed_at = new.decided_at
    where id = v_department_request_id
      and status in ('new', 'in_progress');
    if found then
      insert into public.department_request_events(request_id, event_type, actor_id)
      values (v_department_request_id, v_event_type, new.decided_by);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_transport_date_department_request_trigger()
  from public, anon, authenticated;

drop trigger if exists sync_transport_date_department_request_after_write
  on public.transport_trip_date_change_requests;
create trigger sync_transport_date_department_request_after_write
after insert or update of task_id, status
on public.transport_trip_date_change_requests
for each row execute function public.sync_transport_date_department_request_trigger();

do $$
declare
  v_request record;
begin
  for v_request in
    select id
    from public.transport_trip_date_change_requests
    where status = 'pending' and task_id is not null
    order by created_at
  loop
    perform public.sync_transport_date_department_request(v_request.id);
  end loop;
end;
$$;

comment on column public.department_requests.transport_trip_date_change_request_id is
  'Unique system projection of one transport trip date-change approval';

create or replace function public.fn_move_transport_trip_position_v1(
  p_source_trip_id uuid,
  p_target_trip_id uuid,
  p_moved_links jsonb,
  p_source_stops jsonb,
  p_source_links jsonb,
  p_target_stops jsonb,
  p_target_links jsonb,
  p_reason text,
  p_date_change_reason text,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.machine_outsourcing_transport_orders%rowtype;
  v_target public.machine_outsourcing_transport_orders%rowtype;
  v_first_schedule public.supply_order_delivery_schedules%rowtype;
  v_source_remaining integer;
begin
  if p_actor is null then raise exception 'Не указан пользователь'; end if;
  if p_source_trip_id = p_target_trip_id then raise exception 'Выберите другой рейс'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Укажите причину переноса позиции'; end if;
  if jsonb_typeof(p_moved_links) is distinct from 'array' or jsonb_array_length(p_moved_links) = 0 then
    raise exception 'Выберите позицию для переноса';
  end if;

  perform 1
  from public.machine_outsourcing_transport_orders
  where id in (p_source_trip_id, p_target_trip_id)
  order by id
  for update;
  select * into v_source from public.machine_outsourcing_transport_orders where id = p_source_trip_id;
  select * into v_target from public.machine_outsourcing_transport_orders where id = p_target_trip_id;
  if v_source.id is null or v_target.id is null then raise exception 'Исходный или целевой рейс не найден'; end if;
  if v_source.status not in ('needed', 'found', 'in_transit')
    or v_target.status not in ('needed', 'found', 'in_transit') then
    raise exception 'Завершённый или отменённый рейс нельзя изменить';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_moved_links) value
    group by value->>'source', value->>'id' having count(*) > 1
  ) then raise exception 'Позиция содержит повторяющиеся внутренние ссылки'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_moved_links) value
    where not exists (
      select 1 from public.transport_trip_need_links link
      where link.transport_order_id = p_source_trip_id
        and link.released_at is null
        and link.need_source = value->>'source'
        and link.need_id = (value->>'id')::uuid
    )
  ) then raise exception 'Позиция уже перемещена или отсутствует в исходном рейсе'; end if;

  if v_source.status = 'in_transit' and exists (
    select 1
    from jsonb_array_elements(p_moved_links) value
    join public.transport_trip_need_links link
      on link.transport_order_id = p_source_trip_id
     and link.released_at is null
     and link.need_source = value->>'source'
     and link.need_id = (value->>'id')::uuid
    join public.transport_trip_stops pickup on pickup.id = link.pickup_stop_id
    where pickup.status <> 'planned'
  ) then raise exception 'Нельзя перенести позицию после начала её точки забора'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_moved_links) value
    where value->>'source' <> (p_moved_links->0)->>'source'
  ) then raise exception 'За одну операцию переносится одна логическая позиция'; end if;

  if (p_moved_links->0)->>'source' = 'supply_schedule' then
    select * into v_first_schedule
    from public.supply_order_delivery_schedules
    where id = ((p_moved_links->0)->>'id')::uuid;
    if not found then raise exception 'Строка графика поставки не найдена'; end if;
    if exists (
      select 1
      from jsonb_array_elements(p_moved_links) value
      join public.supply_order_delivery_schedules schedule on schedule.id = (value->>'id')::uuid
      where schedule.request_item_table is distinct from v_first_schedule.request_item_table
        or schedule.request_item_id is distinct from v_first_schedule.request_item_id
        or schedule.supplier_id is distinct from v_first_schedule.supplier_id
        or schedule.delivery_date is distinct from v_first_schedule.delivery_date
    ) then raise exception 'Технические строки относятся к разным позициям'; end if;
    if exists (
      select 1
      from public.transport_trip_need_links link
      join public.supply_order_delivery_schedules schedule
        on link.need_source = 'supply_schedule' and schedule.id = link.need_id
      where link.transport_order_id = p_source_trip_id
        and link.released_at is null
        and schedule.request_item_table = v_first_schedule.request_item_table
        and schedule.request_item_id = v_first_schedule.request_item_id
        and schedule.supplier_id is not distinct from v_first_schedule.supplier_id
        and schedule.delivery_date = v_first_schedule.delivery_date
        and not exists (
          select 1 from jsonb_array_elements(p_moved_links) value
          where value->>'source' = link.need_source and (value->>'id')::uuid = link.need_id
        )
    ) then raise exception 'Технические части одной позиции можно переносить только вместе'; end if;
  elsif jsonb_array_length(p_moved_links) <> 1 then
    raise exception 'За одну операцию переносится одна логическая позиция';
  end if;

  if v_target.status = 'in_transit' and exists (
    select 1
    from jsonb_array_elements(p_moved_links) value
    join public.transport_trip_need_links moved
      on moved.transport_order_id = p_source_trip_id
     and moved.need_source = value->>'source'
     and moved.need_id = (value->>'id')::uuid
     and moved.released_at is null
    join public.transport_trip_stops target_stop
      on target_stop.transport_order_id = p_target_trip_id
     and target_stop.point_key = moved.source_point_key
    where target_stop.status <> 'planned'
  ) then raise exception 'Точка забора в целевом рейсе уже начата'; end if;

  if exists (
    (
      select link.need_source, link.need_id
      from public.transport_trip_need_links link
      where link.transport_order_id = p_source_trip_id and link.released_at is null
        and not exists (
          select 1 from jsonb_array_elements(p_moved_links) value
          where value->>'source' = link.need_source and (value->>'id')::uuid = link.need_id
        )
      except
      select value->>'needSource', (value->>'needId')::uuid from jsonb_array_elements(p_source_links) value
    ) union all (
      select value->>'needSource', (value->>'needId')::uuid from jsonb_array_elements(p_source_links) value
      except
      select link.need_source, link.need_id
      from public.transport_trip_need_links link
      where link.transport_order_id = p_source_trip_id and link.released_at is null
        and not exists (
          select 1 from jsonb_array_elements(p_moved_links) value
          where value->>'source' = link.need_source and (value->>'id')::uuid = link.need_id
        )
    )
  ) then raise exception 'Состав исходного рейса изменился конкурентно'; end if;

  if exists (
    (
      select link.need_source, link.need_id
      from public.transport_trip_need_links link
      where link.transport_order_id = p_target_trip_id and link.released_at is null
      union
      select value->>'source', (value->>'id')::uuid from jsonb_array_elements(p_moved_links) value
      except
      select value->>'needSource', (value->>'needId')::uuid from jsonb_array_elements(p_target_links) value
    ) union all (
      select value->>'needSource', (value->>'needId')::uuid from jsonb_array_elements(p_target_links) value
      except
      (
        select link.need_source, link.need_id
        from public.transport_trip_need_links link
        where link.transport_order_id = p_target_trip_id and link.released_at is null
        union
        select value->>'source', (value->>'id')::uuid from jsonb_array_elements(p_moved_links) value
      )
    )
  ) then raise exception 'Состав целевого рейса изменился конкурентно'; end if;

  select count(*) into v_source_remaining
  from public.transport_trip_need_links link
  where link.transport_order_id = p_source_trip_id
    and link.released_at is null
    and not exists (
      select 1 from jsonb_array_elements(p_moved_links) value
      where value->>'source' = link.need_source and (value->>'id')::uuid = link.need_id
    );

  if v_source_remaining = 0 then
    perform public.fn_cancel_transport_trip_v1(p_source_trip_id, btrim(p_reason), p_actor);
  else
    perform public.fn_update_transport_trip_v4(
      p_source_trip_id,
      v_source.carrier_supplier_id,
      v_source.scheduled_date,
      v_source.price,
      v_source.comment,
      p_source_stops,
      p_source_links,
      btrim(p_reason),
      nullif(btrim(p_date_change_reason), ''),
      p_actor
    );
  end if;

  perform public.fn_update_transport_trip_v4(
    p_target_trip_id,
    v_target.carrier_supplier_id,
    v_target.scheduled_date,
    v_target.price,
    v_target.comment,
    p_target_stops,
    p_target_links,
    null,
    nullif(btrim(p_date_change_reason), ''),
    p_actor
  );

  return jsonb_build_object(
    'sourceTripId', p_source_trip_id,
    'targetTripId', p_target_trip_id,
    'sourceCancelled', v_source_remaining = 0,
    'movedCount', jsonb_array_length(p_moved_links)
  );
end;
$$;

revoke all on function public.fn_move_transport_trip_position_v1(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.fn_move_transport_trip_position_v1(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, uuid
) to service_role;
