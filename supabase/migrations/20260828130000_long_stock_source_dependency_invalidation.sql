-- Cascade invalidation through future-remnant dependencies. An uncut consumer
-- is released and queued for recalculation; a cut consumer blocks automatic
-- history changes and requires the normal reverse-production flow first.

create or replace function public.fn_invalidate_long_stock_dependency_v1(
  p_dependency_id uuid,
  p_actor uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dependency public.long_stock_cutting_source_dependencies%rowtype;
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_plan public.long_stock_cutting_plans%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_machine_id uuid;
  v_factory_id uuid;
  v_department_request_id uuid;
  v_reservation record;
begin
  select * into v_dependency
  from public.long_stock_cutting_source_dependencies
  where id = p_dependency_id
  for update;
  if not found or v_dependency.status = 'invalidated' then return false; end if;
  if v_dependency.status = 'fulfilled' then
    raise exception 'Зависимый материал уже порезан; сначала выполните обратный производственный процесс';
  end if;

  select plan_id into strict v_version.plan_id
  from public.long_stock_cutting_plan_versions
  where id = v_dependency.consumer_version_id;
  select * into strict v_plan
  from public.long_stock_cutting_plans
  where id = v_version.plan_id
  for update;
  select * into strict v_version
  from public.long_stock_cutting_plan_versions
  where id = v_dependency.consumer_version_id
  for update;
  if v_version.status = 'invalid' then
    update public.long_stock_cutting_source_dependencies
    set status = 'invalidated',
        invalidation_reason = coalesce(invalidation_reason, btrim(p_reason)),
        invalidated_at = coalesce(invalidated_at, now())
    where id = v_dependency.id;
    return false;
  end if;
  if v_version.status <> 'approved' then
    raise exception 'Зависимая версия не находится в утверждённом состоянии';
  end if;
  if exists (
    select 1
    from public.long_stock_cutting_candidate_bars bar
    join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
    where candidate.version_id = v_version.id
      and candidate.candidate_number = v_version.selected_candidate_number
      and bar.status <> 'planned'
  ) or exists (
    select 1
    from public.long_stock_cutting_fact_bars fact_bar
    where fact_bar.version_id = v_version.id
      and fact_bar.rolled_back_at is null
  ) then
    raise exception 'Зависимый материал уже порезан; сначала выполните обратный производственный процесс';
  end if;

  select * into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan.id
  order by linked_at, id
  limit 1;
  select request.machine_id, machine.factory_id into strict v_machine_id, v_factory_id
  from public.technologist_requests request
  join public.machines machine on machine.id = request.machine_id
  where request.id = v_plan_item.request_id;

  v_department_request_id := gen_random_uuid();
  insert into public.department_requests(
    id, request_kind, target_department, title, description,
    status, created_by, assigned_to, factory_id, machine_id,
    request_item_table, request_item_id, technologist_request_id,
    long_stock_plan_id, long_stock_returned_version_id, request_item_label
  ) values (
    v_department_request_id,
    'long_stock_recalculation',
    'technologist',
    'Пересчитать зависимую карту №' || v_plan.plan_number,
    btrim(p_reason),
    'in_progress',
    p_actor,
    v_plan.created_by,
    v_factory_id,
    v_machine_id,
    v_plan_item.request_item_table,
    v_plan_item.request_item_id,
    v_plan_item.request_id,
    v_plan.id,
    v_version.id,
    'Длинномер · зависимость от будущего остатка'
  );

  -- Updating the version first fires the same function for downstream plans.
  -- Their reservations are released before this version's output is archived.
  perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  update public.long_stock_cutting_plan_versions
  set status = 'invalid',
      invalidation_reason = btrim(p_reason),
      invalidation_receipt_schedule_id = null,
      invalidation_inventory_transfer_id = null,
      invalidation_department_request_id = v_department_request_id,
      invalidation_dependency_id = null,
      invalidated_by = p_actor,
      invalidated_at = now()
  where id = v_version.id;
  perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

  for v_reservation in
    select reservation_link.reservation_id
    from public.long_stock_cutting_bar_reservations reservation_link
    where reservation_link.version_id = v_version.id
    order by reservation_link.bar_id
  loop
    perform public.fn_unreserve_inventory_reservation(
      v_reservation.reservation_id,
      p_actor,
      'Инвалидация зависимости будущего остатка: ' || btrim(p_reason)
    );
  end loop;

  update public.inventory inventory_row
  set total_quantity = 0,
      reserved_quantity = 0,
      total_secondary_quantity = 0,
      reserved_secondary_quantity = 0,
      deleted_at = coalesce(deleted_at, now()),
      deleted_by = coalesce(deleted_by, p_actor),
      delete_comment = coalesce(delete_comment, 'Инвалидация зависимой карты раскроя'),
      last_updated_by = p_actor,
      updated_at = now()
  from public.long_stock_cutting_business_scraps scrap_link
  where scrap_link.version_id = v_version.id
    and scrap_link.inventory_id = inventory_row.id
    and inventory_row.business_scrap_state = 'future'
    and coalesce(inventory_row.reserved_quantity, 0) = 0
    and coalesce(inventory_row.reserved_secondary_quantity, 0) = 0;

  perform set_config('app.long_stock_cutting_item_status', '1', true);
  update public.long_stock_cutting_plan_items
  set cutting_status = 'requires_recalculation'
  where id = v_plan_item.id;
  perform set_config('app.long_stock_cutting_item_status', '', true);

  if not exists (
    select 1
    from public.tasks task
    where task.long_stock_cutting_plan_id = v_plan.id
      and task.task_type = 'long_stock_cutting_recalculation'
      and task.status in ('pending', 'in_progress')
  ) then
    insert into public.tasks(
      department_request_id, machine_id, assigned_to, task_type, title, description, status,
      start_date, long_stock_cutting_plan_id, long_stock_cutting_plan_version_id
    ) values (
      v_department_request_id,
      v_machine_id,
      v_plan.created_by,
      'long_stock_cutting_recalculation',
      'Пересчитать зависимую карту №' || v_plan.plan_number,
      btrim(p_reason),
      'in_progress',
      current_date,
      v_plan.id,
      v_version.id
    );
  end if;

  update public.long_stock_cutting_source_dependencies
  set status = 'invalidated',
      invalidation_reason = btrim(p_reason),
      invalidated_at = now()
  where id = v_dependency.id;
  return true;
end;
$$;

revoke all on function public.fn_invalidate_long_stock_dependency_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_invalidate_long_stock_dependency_v1(uuid, uuid, text)
  to service_role;

create or replace function public.fn_invalidate_long_stock_dependency_consumers_v1(
  p_producer_version_id uuid,
  p_actor uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dependency record;
  v_count integer := 0;
begin
  if exists (
    select 1
    from public.long_stock_cutting_source_dependencies dependency
    where dependency.producer_version_id = p_producer_version_id
      and dependency.status = 'fulfilled'
  ) then
    raise exception 'Зависимая цепочка уже порезана; сначала выполните обратный производственный процесс';
  end if;

  for v_dependency in
    select dependency.id
    from public.long_stock_cutting_source_dependencies dependency
    where dependency.producer_version_id = p_producer_version_id
      and dependency.status not in ('fulfilled', 'invalidated')
    order by dependency.consumer_version_id, dependency.consumer_bar_id
  loop
    if public.fn_invalidate_long_stock_dependency_v1(
      v_dependency.id,
      p_actor,
      p_reason
    ) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.fn_invalidate_long_stock_dependency_consumers_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_invalidate_long_stock_dependency_consumers_v1(uuid, uuid, text)
  to service_role;

create or replace function public.fn_cascade_long_stock_source_invalidation_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'approved' and new.status = 'invalid' then
    perform public.fn_invalidate_long_stock_dependency_consumers_v1(
      new.id,
      new.invalidated_by,
      'Исходная карта №' || new.version_number || ' стала недействительной: ' || new.invalidation_reason
    );
  end if;
  return new;
end;
$$;

create trigger cascade_long_stock_source_invalidation
after update of status on public.long_stock_cutting_plan_versions
for each row execute function public.fn_cascade_long_stock_source_invalidation_v1();

create or replace function public.fn_revalidate_long_stock_dependency_dates_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dependency record;
  v_actor uuid;
begin
  if new.stage_type <> 'cutting'::public.stage_type
    or new.date_start is not distinct from old.date_start then
    return new;
  end if;

  update public.inventory
  set available_from_date = new.date_start,
      updated_at = now()
  where available_from_stage_id = new.id
    and is_business_scrap = true
    and business_scrap_state = 'future'
    and deleted_at is null;

  for v_dependency in
    select
      dependency.id,
      producer_stage.date_start as producer_date,
      consumer_stage.date_start as consumer_date,
      consumer_version.created_by
    from public.long_stock_cutting_source_dependencies dependency
    join public.inventory source_inventory on source_inventory.id = dependency.source_inventory_id
    join public.production_stages producer_stage on producer_stage.id = source_inventory.available_from_stage_id
    join public.long_stock_cutting_plan_versions consumer_version on consumer_version.id = dependency.consumer_version_id
    join public.long_stock_cutting_plan_items consumer_item on consumer_item.plan_id = consumer_version.plan_id
    join public.technologist_requests consumer_request on consumer_request.id = consumer_item.request_id
    join public.production_stages consumer_stage
      on consumer_stage.machine_id = consumer_request.machine_id
     and consumer_stage.stage_type = 'cutting'::public.stage_type
    where dependency.status not in ('fulfilled', 'invalidated')
      and (producer_stage.id = new.id or consumer_stage.id = new.id)
    order by dependency.id
  loop
    v_actor := v_dependency.created_by;
    if v_dependency.producer_date is null
      or v_dependency.consumer_date is null
      or v_dependency.producer_date >= v_dependency.consumer_date then
      perform public.fn_invalidate_long_stock_dependency_v1(
        v_dependency.id,
        v_actor,
        'Нарушен порядок дат: исходная порезка должна быть строго раньше потребляющей'
      );
    else
      update public.long_stock_cutting_source_dependencies
      set producer_cutting_date = v_dependency.producer_date,
          consumer_cutting_date = v_dependency.consumer_date
      where id = v_dependency.id;
    end if;
  end loop;
  return new;
end;
$$;

create trigger revalidate_long_stock_dependency_dates
after update of date_start on public.production_stages
for each row execute function public.fn_revalidate_long_stock_dependency_dates_v1();

create or replace function public.fn_invalidate_long_stock_after_source_rollback_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dependency record;
begin
  if old.rolled_back_at is null and new.rolled_back_at is not null
    and old.result_inventory_id is not null then
    for v_dependency in
      select dependency.id
      from public.long_stock_cutting_source_dependencies dependency
      where dependency.source_inventory_id = old.result_inventory_id
        and dependency.status not in ('fulfilled', 'invalidated')
      order by dependency.id
    loop
      perform public.fn_invalidate_long_stock_dependency_v1(
        v_dependency.id,
        new.rolled_back_by,
        'Исходный факт порезки отменён'
      );
    end loop;
  end if;
  return new;
end;
$$;

create trigger invalidate_long_stock_after_source_rollback
after update of rolled_back_at on public.long_stock_cutting_fact_bars
for each row execute function public.fn_invalidate_long_stock_after_source_rollback_v1();

revoke all on function public.fn_cascade_long_stock_source_invalidation_v1()
  from public, anon, authenticated;
revoke all on function public.fn_revalidate_long_stock_dependency_dates_v1()
  from public, anon, authenticated;
revoke all on function public.fn_invalidate_long_stock_after_source_rollback_v1()
  from public, anon, authenticated;
