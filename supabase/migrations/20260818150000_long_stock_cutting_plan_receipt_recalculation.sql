-- Invalidate an approved long-stock cutting plan when the physical bars accepted
-- by purchasing or an interfactory transfer differ from the approved layout.

alter table public.long_stock_cutting_plan_items
  drop constraint if exists long_stock_cutting_plan_items_cutting_status_check;
alter table public.long_stock_cutting_plan_items
  add constraint long_stock_cutting_plan_items_cutting_status_check
  check (cutting_status in ('planning', 'plan_approved', 'accepted', 'requires_recalculation'));

alter table public.long_stock_cutting_plan_versions
  add column invalidation_inventory_transfer_id uuid
    references public.inventory_transfers(id) on delete restrict;

do $$
declare
  v_constraint_name text;
begin
  select constraint_name into v_constraint_name
  from information_schema.check_constraints
  where constraint_schema = 'public'
    and constraint_name in (
      select conname
      from pg_constraint
      where conrelid = 'public.long_stock_cutting_plan_versions'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%status <> ''invalid''%'
    )
  limit 1;

  if v_constraint_name is not null then
    execute format(
      'alter table public.long_stock_cutting_plan_versions drop constraint %I',
      v_constraint_name
    );
  end if;
end;
$$;

alter table public.long_stock_cutting_plan_versions
  add constraint long_stock_cutting_plan_versions_invalidation_check
  check (
    status <> 'invalid'
    or (
      btrim(coalesce(invalidation_reason, '')) <> ''
      and num_nonnulls(
        invalidation_receipt_schedule_id,
        invalidation_inventory_transfer_id
      ) = 1
      and invalidated_by is not null
      and invalidated_at is not null
    )
  );

comment on column public.long_stock_cutting_plan_versions.invalidation_inventory_transfer_id is
  'Interfactory receiving document that made this immutable plan version invalid.';

alter table public.tasks
  add column long_stock_cutting_plan_id uuid
    references public.long_stock_cutting_plans(id) on delete set null,
  add column long_stock_cutting_plan_version_id uuid
    references public.long_stock_cutting_plan_versions(id) on delete set null;

create unique index tasks_active_long_stock_cutting_recalculation_idx
  on public.tasks(long_stock_cutting_plan_id)
  where long_stock_cutting_plan_id is not null
    and task_type = 'long_stock_cutting_recalculation'
    and status in ('pending', 'in_progress');

create unique index tasks_active_long_stock_cutting_supply_shortage_idx
  on public.tasks(long_stock_cutting_plan_version_id)
  where long_stock_cutting_plan_version_id is not null
    and task_type = 'long_stock_cutting_supply_shortage'
    and status in ('pending', 'in_progress');

create or replace function public.fn_long_stock_cutting_plan_item_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_material_variant_id uuid;
  v_pipe_type public.pipe_subtype;
  v_plan_variant_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'Связь карты раскроя с позицией заявки неизменяема';
  end if;

  if tg_op = 'UPDATE' then
    if current_setting('app.long_stock_cutting_item_status', true) <> '1' then
      raise exception 'Статус позиции карты раскроя меняется только атомарным RPC';
    end if;
    if new.id is distinct from old.id
      or new.plan_id is distinct from old.plan_id
      or new.request_item_table is distinct from old.request_item_table
      or new.request_item_id is distinct from old.request_item_id
      or new.request_id is distinct from old.request_id
      or new.linked_by is distinct from old.linked_by
      or new.linked_at is distinct from old.linked_at then
      raise exception 'Связь карты раскроя с позицией заявки неизменяема';
    end if;
    if new.cutting_status is distinct from old.cutting_status
      and not (
        (old.cutting_status = 'planning' and new.cutting_status in ('plan_approved', 'accepted'))
        or (
          old.cutting_status in ('plan_approved', 'accepted')
          and new.cutting_status = 'requires_recalculation'
        )
        or (
          old.cutting_status = 'requires_recalculation'
          and new.cutting_status in ('plan_approved', 'accepted')
        )
      ) then
      raise exception 'Недопустимый переход статуса позиции карты раскроя: % -> %',
        old.cutting_status, new.cutting_status;
    end if;
    return new;
  end if;

  if new.request_item_table = 'request_circle' then
    select request_id, material_variant_id
    into v_request_id, v_material_variant_id
    from public.request_circle where id = new.request_item_id;
  elsif new.request_item_table = 'request_pipe' then
    select request_id, material_variant_id, pipe_type
    into v_request_id, v_material_variant_id, v_pipe_type
    from public.request_pipe where id = new.request_item_id;
    if v_pipe_type = 'wire' then
      raise exception 'Проволока не входит в раскрой длинномера';
    end if;
  elsif new.request_item_table = 'request_knives' then
    select request_id, material_variant_id
    into v_request_id, v_material_variant_id
    from public.request_knives where id = new.request_item_id;
  end if;

  if v_request_id is null then
    raise exception 'Позиция заявки длинномера не найдена';
  end if;
  if v_material_variant_id is null then
    raise exception 'Для позиции заявки не выбран точный вариант материала';
  end if;

  select material_variant_id into v_plan_variant_id
  from public.long_stock_cutting_plans where id = new.plan_id;
  if v_plan_variant_id is distinct from v_material_variant_id then
    raise exception 'Позиции одного плана должны иметь одинаковый вариант материала';
  end if;

  new.request_id := v_request_id;
  return new;
end;
$$;

create or replace function public.fn_invalidate_long_stock_cutting_plan_for_receipt(
  p_request_item_table text,
  p_request_item_id uuid,
  p_actor uuid,
  p_reason text,
  p_receipt_schedule_id uuid default null,
  p_inventory_transfer_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.long_stock_cutting_plans%rowtype;
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_machine_id uuid;
  v_machine_name text;
  v_task_id uuid;
  v_reservation_id uuid;
begin
  if p_request_item_table not in ('request_circle', 'request_pipe', 'request_knives') then
    return null;
  end if;
  if p_actor is null then raise exception 'Не указан принявший материал'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Не указана причина пересчёта'; end if;
  if num_nonnulls(p_receipt_schedule_id, p_inventory_transfer_id) <> 1 then
    raise exception 'Нужен один документ приёмки';
  end if;

  select item.*
  into v_plan_item
  from public.long_stock_cutting_plan_items item
  join public.long_stock_cutting_plans plan on plan.id = item.plan_id
  where item.request_item_table = p_request_item_table
    and item.request_item_id = p_request_item_id
    and plan.status = 'open'
  order by item.linked_at desc, item.id desc
  limit 1
  for update of item;
  if not found then return null; end if;

  select * into strict v_plan
  from public.long_stock_cutting_plans
  where id = v_plan_item.plan_id
  for update;

  select * into v_version
  from public.long_stock_cutting_plan_versions
  where plan_id = v_plan.id and status = 'approved'
  for update;
  if not found then return null; end if;

  select request.machine_id, machine.name
  into v_machine_id, v_machine_name
  from public.technologist_requests request
  join public.machines machine on machine.id = request.machine_id
  where request.id = v_plan_item.request_id;
  if v_machine_id is null then raise exception 'Машина карты раскроя не найдена'; end if;

  -- Release only resources of bars that have not been cut. Operational facts and
  -- future scraps of bars already marked cut remain untouched.
  for v_reservation_id in
    select distinct inventory.source_reservation_id
    from public.long_stock_cutting_business_scraps link
    join public.long_stock_cutting_candidate_bars bar on bar.id = link.bar_id
    join public.inventory inventory on inventory.id = link.inventory_id
    where link.version_id = v_version.id
      and bar.status = 'planned'
      and inventory.business_scrap_state = 'future'
      and inventory.source_reservation_id is not null
  loop
    perform public.fn_unreserve_inventory_reservation(
      v_reservation_id,
      p_actor,
      'Карта раскроя требует пересчёта после расхождения при приёмке'
    );
  end loop;

  update public.inventory inventory
  set total_quantity = 0,
      reserved_quantity = 0,
      total_secondary_quantity = 0,
      reserved_secondary_quantity = 0,
      deleted_at = now(),
      deleted_by = p_actor,
      delete_comment = 'Недействительная карта раскроя: ' || btrim(p_reason),
      last_updated_by = p_actor,
      updated_at = now()
  from public.long_stock_cutting_business_scraps link
  join public.long_stock_cutting_candidate_bars bar on bar.id = link.bar_id
  where link.version_id = v_version.id
    and link.inventory_id = inventory.id
    and bar.status = 'planned'
    and inventory.business_scrap_state = 'future'
    and inventory.deleted_at is null
    and coalesce(inventory.reserved_quantity, 0) = 0
    and coalesce(inventory.reserved_secondary_quantity, 0) = 0;

  perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  update public.long_stock_cutting_plan_versions
  set status = 'invalid',
      invalidation_reason = btrim(p_reason),
      invalidation_receipt_schedule_id = p_receipt_schedule_id,
      invalidation_inventory_transfer_id = p_inventory_transfer_id,
      invalidated_by = p_actor,
      invalidated_at = now()
  where id = v_version.id;
  perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

  perform set_config('app.long_stock_cutting_item_status', '1', true);
  update public.long_stock_cutting_plan_items
  set cutting_status = 'requires_recalculation'
  where plan_id = v_plan.id;
  perform set_config('app.long_stock_cutting_item_status', '', true);

  select id into v_task_id
  from public.tasks
  where long_stock_cutting_plan_id = v_plan.id
    and task_type = 'long_stock_cutting_recalculation'
    and status in ('pending', 'in_progress')
  order by created_at desc
  limit 1
  for update;

  if v_task_id is null then
    insert into public.tasks(
      machine_id, assigned_to, task_type, title, description, status,
      start_date, deadline, long_stock_cutting_plan_id,
      long_stock_cutting_plan_version_id
    ) values (
      v_machine_id,
      v_plan.created_by,
      'long_stock_cutting_recalculation',
      format('Пересчитать карту раскроя №%s', v_plan.plan_number),
      concat_ws(E'\n',
        'Машина: ' || coalesce(v_machine_name, '—'),
        'Версия ' || v_version.version_number::text || ' недействительна.',
        btrim(p_reason)
      ),
      'pending',
      current_date,
      current_date,
      v_plan.id,
      v_version.id
    ) returning id into v_task_id;
  end if;

  perform public.notify_user(
    v_plan.created_by,
    'long_stock_cutting_recalculation',
    format('Требуется пересчёт карты №%s', v_plan.plan_number),
    btrim(p_reason),
    v_machine_id
  );

  return v_version.id;
end;
$$;

create or replace function public.fn_invalidate_long_stock_plan_after_supply_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expected_count numeric;
  v_scheduled_count numeric;
  v_reason text;
begin
  if new.status <> 'delivered'
    or new.receipt_parent_schedule_id is not null
    or new.request_item_table not in ('request_circle', 'request_pipe', 'request_knives')
    or new.planned_piece_length_mm is null
    or new.planned_piece_count is null
    or new.received_piece_length_mm is null
    or new.received_piece_count is null then
    return new;
  end if;

  select count(*)::numeric into v_expected_count
  from public.long_stock_cutting_plan_items item
  join public.long_stock_cutting_plan_versions version
    on version.plan_id = item.plan_id and version.status = 'approved'
  join public.long_stock_cutting_candidates candidate
    on candidate.version_id = version.id
   and candidate.candidate_number = version.selected_candidate_number
  join public.long_stock_cutting_candidate_bars bar
    on bar.candidate_id = candidate.id
  where item.request_item_table = new.request_item_table
    and item.request_item_id = new.request_item_id
    and bar.source_type = 'new_stock'
    and bar.stock_length_mm = new.planned_piece_length_mm;

  select coalesce(sum(schedule.planned_piece_count), 0) into v_scheduled_count
  from public.supply_order_delivery_schedules schedule
  where schedule.request_item_table = new.request_item_table
    and schedule.request_item_id = new.request_item_id
    and schedule.receipt_parent_schedule_id is null
    and schedule.planned_piece_length_mm = new.planned_piece_length_mm;

  if new.received_piece_length_mm is distinct from new.planned_piece_length_mm
    or new.received_piece_count is distinct from new.planned_piece_count
    or v_expected_count = 0
    or v_scheduled_count > v_expected_count then
    v_reason := format(
      'Расхождение при закупочной приёмке: по карте %s мм × %s, принято %s мм × %s',
      trim(to_char(new.planned_piece_length_mm, 'FM9999999990.###')),
      trim(to_char(new.planned_piece_count, 'FM9999999990.###')),
      trim(to_char(new.received_piece_length_mm, 'FM9999999990.###')),
      trim(to_char(new.received_piece_count, 'FM9999999990.###'))
    );
    perform public.fn_invalidate_long_stock_cutting_plan_for_receipt(
      new.request_item_table,
      new.request_item_id,
      new.received_by,
      v_reason,
      new.id,
      null
    );
  end if;
  return new;
end;
$$;

create trigger invalidate_long_stock_plan_after_supply_receipt
after insert or update of status, received_piece_length_mm, received_piece_count, received_by
on public.supply_order_delivery_schedules
for each row execute function public.fn_invalidate_long_stock_plan_after_supply_receipt();

create or replace function public.fn_invalidate_long_stock_plan_after_transfer_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transfer public.inventory_transfers%rowtype;
  v_expected_count numeric;
  v_expected_composition text;
  v_requested_count numeric;
  v_actual_count numeric;
  v_reason text;
  v_actor uuid;
begin
  if new.received_quantity <= old.received_quantity
    or new.request_item_table not in ('request_circle', 'request_pipe', 'request_knives')
    or coalesce(new.piece_length_mm, 0) <= 0 then
    return new;
  end if;

  select * into v_transfer
  from public.inventory_transfers
  where id = new.transfer_id;
  if not found then return new; end if;

  select
    coalesce(max(composition.length_count) filter (
      where composition.stock_length_mm = new.piece_length_mm
    ), 0),
    string_agg(
      format(
        '%s мм × %s',
        trim(to_char(composition.stock_length_mm, 'FM9999999990.###')),
        trim(to_char(composition.length_count, 'FM9999999990.###'))
      ),
      ' + ' order by composition.stock_length_mm
    )
  into v_expected_count, v_expected_composition
  from (
    select bar.stock_length_mm, count(*)::numeric as length_count
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plan_versions version
      on version.plan_id = item.plan_id and version.status = 'approved'
    join public.long_stock_cutting_candidates candidate
      on candidate.version_id = version.id
     and candidate.candidate_number = version.selected_candidate_number
    join public.long_stock_cutting_candidate_bars bar
      on bar.candidate_id = candidate.id
    where item.request_item_table = new.request_item_table
      and item.request_item_id = new.request_item_id
    group by bar.stock_length_mm
  ) composition;

  select coalesce(sum(
    coalesce(
      item.requested_secondary_quantity,
      item.requested_quantity / nullif(item.piece_length_mm, 0)
    )
  ), 0)
  into v_requested_count
  from public.inventory_transfer_items item
  where item.request_item_table = new.request_item_table
    and item.request_item_id = new.request_item_id
    and item.piece_length_mm = new.piece_length_mm;

  /*
   * The transfer row carries the physical source-bar length. A length absent
   * from the approved candidate is therefore an actual length discrepancy.
   */
  if v_expected_composition is null then return new; end if;

  v_actual_count := coalesce(
    new.received_secondary_quantity,
    new.received_quantity / nullif(new.piece_length_mm, 0)
  );
  v_actor := coalesce(auth.uid(), v_transfer.updated_by, v_transfer.created_by);

  if new.received_quantity is distinct from new.requested_quantity
    or (
      new.requested_secondary_quantity is not null
      and v_actual_count is distinct from new.requested_secondary_quantity
    )
    or v_expected_count = 0
    or v_requested_count > v_expected_count then
    v_reason := format(
      'Расхождение при межзаводской приёмке: по утверждённой карте %s, принято %s мм × %s',
      v_expected_composition,
      trim(to_char(new.piece_length_mm, 'FM9999999990.###')),
      trim(to_char(v_actual_count, 'FM9999999990.###'))
    );
    perform public.fn_invalidate_long_stock_cutting_plan_for_receipt(
      new.request_item_table,
      new.request_item_id,
      v_actor,
      v_reason,
      null,
      new.transfer_id
    );
  end if;
  return new;
end;
$$;

create trigger invalidate_long_stock_plan_after_transfer_receipt
after update of received_quantity, received_secondary_quantity
on public.inventory_transfer_items
for each row execute function public.fn_invalidate_long_stock_plan_after_transfer_receipt();

create or replace function public.fn_assert_no_invalid_long_stock_cutting_plan(
  p_machine_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.long_stock_cutting_plan_items item
    join public.technologist_requests request on request.id = item.request_id
    where request.machine_id = p_machine_id
      and item.cutting_status = 'requires_recalculation'
  ) then
    raise exception 'Заготовка заблокирована: карта раскроя требует пересчёта';
  end if;
end;
$$;

create or replace function public.fn_guard_invalid_long_stock_cutting_plan_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_assert_no_invalid_long_stock_cutting_plan(new.machine_id);
  return new;
end;
$$;

create trigger long_stock_cutting_recalculation_guard
before insert on public.production_fact_cutting_events
for each row execute function public.fn_guard_invalid_long_stock_cutting_plan_event();

alter function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  rename to fn_approve_long_stock_cutting_plan_before_recalculation;

create or replace function public.fn_approve_long_stock_cutting_plan_version_v1(
  p_version_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
  v_plan_id uuid;
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_invalid_version_id uuid;
  v_recalculation_required boolean;
  v_machine_id uuid;
  v_factory_id uuid;
  v_plan_number bigint;
  v_supply_assignee uuid;
  v_supply_task_id uuid;
  v_shortage_composition text;
begin
  select * into v_version
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;
  if not found then raise exception 'Версия карты раскроя не найдена'; end if;

  select exists (
    select 1
    from public.long_stock_cutting_plan_items item
    where item.plan_id = v_version.plan_id
      and item.cutting_status = 'requires_recalculation'
  ) into v_recalculation_required;

  if v_recalculation_required then
    select id into v_invalid_version_id
    from public.long_stock_cutting_plan_versions
    where plan_id = v_version.plan_id and status = 'invalid'
    order by invalidated_at desc, version_number desc
    limit 1;

    if nullif(v_version.input_snapshot#>>'{recalculation,source_version_id}', '')::uuid
      is distinct from v_invalid_version_id then
      raise exception 'Утвердить можно только пересчёт текущей недействительной версии';
    end if;

    if exists (
      with expected as (
        select segment.required_length_mm, count(*)::bigint as segment_count
        from public.long_stock_cutting_segments segment
        where segment.version_id = v_invalid_version_id
          and not exists (
            select 1
            from public.long_stock_cutting_bar_cuts cut
            join public.long_stock_cutting_candidate_bars bar on bar.id = cut.bar_id
            join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
            join public.long_stock_cutting_plan_versions invalid_version
              on invalid_version.id = candidate.version_id
            where cut.segment_id = segment.id
              and candidate.version_id = v_invalid_version_id
              and candidate.candidate_number = invalid_version.selected_candidate_number
              and bar.status = 'cut'
          )
        group by segment.required_length_mm
      ), actual as (
        select segment.required_length_mm, count(*)::bigint as segment_count
        from public.long_stock_cutting_segments segment
        where segment.version_id = p_version_id
        group by segment.required_length_mm
      )
      select 1
      from expected
      full join actual using (required_length_mm)
      where expected.segment_count is distinct from actual.segment_count
    ) then
      raise exception 'Новая версия должна содержать только непорезанные заготовки';
    end if;

    if exists (
      select 1
      from public.long_stock_cutting_plan_versions version
      join public.long_stock_cutting_candidates candidate
        on candidate.version_id = version.id
       and candidate.candidate_number = version.selected_candidate_number
      join public.long_stock_cutting_candidate_bars bar on bar.candidate_id = candidate.id
      join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
      where version.id = p_version_id
        and bar.source_type = 'new_stock'
        and not exists (
          select 1
          from public.supply_order_delivery_schedules schedule
          where schedule.request_item_table = item.request_item_table
            and schedule.request_item_id = item.request_item_id
            and schedule.status = 'delivered'
            and schedule.receipt_parent_schedule_id is null
            and schedule.received_piece_length_mm = bar.stock_length_mm
            and coalesce(schedule.received_piece_count, 0) > 0
        )
        and not exists (
          select 1
          from public.inventory_transfer_items transfer_item
          where transfer_item.request_item_table = item.request_item_table
            and transfer_item.request_item_id = item.request_item_id
            and transfer_item.piece_length_mm = bar.stock_length_mm
            and coalesce(
              transfer_item.received_secondary_quantity,
              transfer_item.received_quantity / nullif(transfer_item.piece_length_mm, 0),
              0
            ) > 0
        )
    ) then
      raise exception 'Новая версия использует длину, которой нет в фактической приёмке';
    end if;
  end if;

  v_result := public.fn_approve_long_stock_cutting_plan_before_recalculation(
    p_version_id,
    p_actor
  );
  select plan_id into v_plan_id
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;

  if v_recalculation_required then
    select request.machine_id, machine.factory_id, plan.plan_number
    into v_machine_id, v_factory_id, v_plan_number
    from public.long_stock_cutting_plans plan
    join public.long_stock_cutting_plan_items item on item.plan_id = plan.id
    join public.technologist_requests request on request.id = item.request_id
    join public.machines machine on machine.id = request.machine_id
    where plan.id = v_plan_id
    order by item.linked_at, item.id
    limit 1;

    with required as (
      select bar.stock_length_mm, count(*)::numeric as piece_count
      from public.long_stock_cutting_plan_versions version
      join public.long_stock_cutting_candidates candidate
        on candidate.version_id = version.id
       and candidate.candidate_number = version.selected_candidate_number
      join public.long_stock_cutting_candidate_bars bar on bar.candidate_id = candidate.id
      where version.id = p_version_id
        and bar.source_type = 'new_stock'
      group by bar.stock_length_mm
    ), accepted_rows as (
      select
        schedule.received_piece_length_mm as stock_length_mm,
        schedule.received_piece_count as piece_count
      from public.long_stock_cutting_plan_items item
      join public.supply_order_delivery_schedules schedule
        on schedule.request_item_table = item.request_item_table
       and schedule.request_item_id = item.request_item_id
      where item.plan_id = v_plan_id
        and schedule.status = 'delivered'
        and schedule.receipt_parent_schedule_id is null
        and schedule.received_piece_length_mm is not null
        and coalesce(schedule.received_piece_count, 0) > 0
      union all
      select
        transfer_item.piece_length_mm,
        coalesce(
          transfer_item.received_secondary_quantity,
          transfer_item.received_quantity / nullif(transfer_item.piece_length_mm, 0)
        )
      from public.long_stock_cutting_plan_items item
      join public.inventory_transfer_items transfer_item
        on transfer_item.request_item_table = item.request_item_table
       and transfer_item.request_item_id = item.request_item_id
      where item.plan_id = v_plan_id
        and transfer_item.piece_length_mm is not null
        and coalesce(
          transfer_item.received_secondary_quantity,
          transfer_item.received_quantity / nullif(transfer_item.piece_length_mm, 0),
          0
        ) > 0
    ), accepted as (
      select stock_length_mm, sum(piece_count) as piece_count
      from accepted_rows
      group by stock_length_mm
    ), consumed as (
      select bar.stock_length_mm, count(*)::numeric as piece_count
      from public.long_stock_cutting_plan_versions version
      join public.long_stock_cutting_candidates candidate
        on candidate.version_id = version.id
       and candidate.candidate_number = version.selected_candidate_number
      join public.long_stock_cutting_candidate_bars bar on bar.candidate_id = candidate.id
      where version.plan_id = v_plan_id
        and bar.source_type = 'new_stock'
        and bar.status = 'cut'
      group by bar.stock_length_mm
    ), shortage as (
      select
        required.stock_length_mm,
        greatest(
          required.piece_count
          - greatest(coalesce(accepted.piece_count, 0) - coalesce(consumed.piece_count, 0), 0),
          0
        ) as piece_count
      from required
      left join accepted using (stock_length_mm)
      left join consumed using (stock_length_mm)
    )
    select string_agg(
      format(
        '%s мм × %s',
        trim(to_char(stock_length_mm, 'FM9999999990.###')),
        trim(to_char(piece_count, 'FM9999999990.###'))
      ),
      ' + ' order by stock_length_mm desc
    )
    into v_shortage_composition
    from shortage
    where piece_count > 0;

    if v_shortage_composition is not null then
      v_supply_assignee := public.resolve_machine_supply_task_assignee(v_factory_id);
      if v_supply_assignee is null then
        select created_by into v_supply_assignee
        from public.long_stock_cutting_plans where id = v_plan_id;
      end if;

      insert into public.tasks(
        machine_id, assigned_to, task_type, title, description, status,
        start_date, deadline, long_stock_cutting_plan_id,
        long_stock_cutting_plan_version_id
      ) values (
        v_machine_id,
        v_supply_assignee,
        'long_stock_cutting_supply_shortage',
        format('Дозаказать материал по карте раскроя №%s', v_plan_number),
        'После пересчёта не хватает целых хлыстов: ' || v_shortage_composition,
        'pending',
        current_date,
        current_date,
        v_plan_id,
        p_version_id
      )
      on conflict (long_stock_cutting_plan_version_id)
        where long_stock_cutting_plan_version_id is not null
          and task_type = 'long_stock_cutting_supply_shortage'
          and status in ('pending', 'in_progress')
      do nothing
      returning id into v_supply_task_id;

      if v_supply_task_id is not null then
        perform public.notify_user(
          v_supply_assignee,
          'long_stock_cutting_supply_shortage',
          format('Нужен дозаказ по карте №%s', v_plan_number),
          'Не хватает целых хлыстов: ' || v_shortage_composition,
          v_machine_id
        );
      end if;
    end if;
  end if;

  update public.tasks
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where long_stock_cutting_plan_id = v_plan_id
    and task_type = 'long_stock_cutting_recalculation'
    and status in ('pending', 'in_progress');
  return v_result;
end;
$$;

revoke all on function public.fn_invalidate_long_stock_cutting_plan_for_receipt(
  text, uuid, uuid, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.fn_invalidate_long_stock_plan_after_supply_receipt()
  from public, anon, authenticated;
revoke all on function public.fn_invalidate_long_stock_plan_after_transfer_receipt()
  from public, anon, authenticated;
revoke all on function public.fn_assert_no_invalid_long_stock_cutting_plan(uuid)
  from public, anon, authenticated;
revoke all on function public.fn_guard_invalid_long_stock_cutting_plan_event()
  from public, anon, authenticated;
revoke all on function public.fn_approve_long_stock_cutting_plan_before_recalculation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.fn_assert_no_invalid_long_stock_cutting_plan(uuid)
  to service_role;
grant execute on function public.fn_approve_long_stock_cutting_plan_version_v1(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
