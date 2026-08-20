-- Keep approved long-stock layouts aligned with physical receiving and reject
-- cutting facts unless every physical bar can be matched to one planned bar.

create or replace function public.fn_invalidate_long_stock_plan_after_supply_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_expected_count numeric := 0;
  v_scheduled_count numeric := 0;
  v_received_count numeric := 0;
  v_actual_count numeric;
  v_attributed_count numeric;
  v_expected_composition text;
  v_reason text;
  v_mismatch boolean := false;
begin
  if new.status <> 'delivered'
    or new.request_item_table not in ('request_circle', 'request_pipe', 'request_knives')
    or new.received_piece_length_mm is null
    or new.received_by is null then
    return new;
  end if;

  v_actual_count := coalesce(
    new.received_piece_count,
    new.allocated_piece_count,
    new.received_quantity / nullif(new.received_piece_length_mm, 0),
    new.allocated_physical_quantity / nullif(new.received_piece_length_mm, 0)
  );
  v_attributed_count := coalesce(
    new.allocated_piece_count,
    new.received_piece_count,
    new.allocated_physical_quantity / nullif(new.received_piece_length_mm, 0),
    new.received_quantity / nullif(new.received_piece_length_mm, 0)
  );
  if coalesce(v_attributed_count, 0) <= 0 then
    return new;
  end if;

  select version.id
  into v_version_id
  from public.long_stock_cutting_plan_items item
  join public.long_stock_cutting_plans plan
    on plan.id = item.plan_id
   and plan.status = 'open'
  join public.long_stock_cutting_plan_versions version
    on version.plan_id = plan.id
   and version.status = 'approved'
  join public.long_stock_cutting_candidates candidate
    on candidate.version_id = version.id
   and candidate.candidate_number = version.selected_candidate_number
  where item.request_item_table = new.request_item_table
    and item.request_item_id = new.request_item_id
  order by version.approved_at desc, version.id desc
  limit 1;

  if v_version_id is null then
    return new;
  end if;

  select string_agg(
           format(
             '%s мм × %s',
             trim(to_char(composition.stock_length_mm, 'FM9999999990.###')),
             trim(to_char(composition.bar_count, 'FM9999999990.###'))
           ),
           ', ' order by composition.stock_length_mm
         )
  into v_expected_composition
  from (
    select bar.stock_length_mm, count(*)::numeric as bar_count
    from public.long_stock_cutting_candidate_bars bar
    join public.long_stock_cutting_candidates candidate
      on candidate.id = bar.candidate_id
     and candidate.version_id = v_version_id
    where candidate.candidate_number = (
      select version.selected_candidate_number
      from public.long_stock_cutting_plan_versions version
      where version.id = v_version_id
    )
      and bar.source_type = 'new_stock'
    group by bar.stock_length_mm
  ) composition;

  if new.receipt_parent_schedule_id is null
    and new.planned_piece_length_mm is not null
    and new.planned_piece_count is not null then
    select count(*)::numeric
    into v_expected_count
    from public.long_stock_cutting_candidate_bars bar
    join public.long_stock_cutting_candidates candidate
      on candidate.id = bar.candidate_id
     and candidate.version_id = v_version_id
    where candidate.candidate_number = (
      select version.selected_candidate_number
      from public.long_stock_cutting_plan_versions version
      where version.id = v_version_id
    )
      and bar.source_type = 'new_stock'
      and bar.stock_length_mm = new.planned_piece_length_mm;

    select coalesce(sum(schedule.planned_piece_count), 0)
    into v_scheduled_count
    from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = new.request_item_table
      and schedule.request_item_id = new.request_item_id
      and schedule.receipt_parent_schedule_id is null
      and schedule.planned_piece_length_mm = new.planned_piece_length_mm;

    v_mismatch := new.received_piece_length_mm is distinct from new.planned_piece_length_mm
      or v_actual_count is distinct from new.planned_piece_count
      or v_expected_count = 0
      or v_scheduled_count > v_expected_count;

    if v_mismatch then
      v_reason := format(
        'Расхождение при закупочной приёмке: по карте %s мм × %s, принято %s мм × %s',
        trim(to_char(new.planned_piece_length_mm, 'FM9999999990.###')),
        trim(to_char(new.planned_piece_count, 'FM9999999990.###')),
        trim(to_char(new.received_piece_length_mm, 'FM9999999990.###')),
        trim(to_char(v_actual_count, 'FM9999999990.###'))
      );
    end if;
  else
    select count(*)::numeric
    into v_expected_count
    from public.long_stock_cutting_candidate_bars bar
    join public.long_stock_cutting_candidates candidate
      on candidate.id = bar.candidate_id
     and candidate.version_id = v_version_id
    where candidate.candidate_number = (
      select version.selected_candidate_number
      from public.long_stock_cutting_plan_versions version
      where version.id = v_version_id
    )
      and bar.source_type = 'new_stock'
      and bar.stock_length_mm = new.received_piece_length_mm;

    select coalesce(sum(
      coalesce(
        schedule.allocated_piece_count,
        schedule.received_piece_count,
        schedule.allocated_physical_quantity / nullif(schedule.received_piece_length_mm, 0),
        schedule.received_quantity / nullif(schedule.received_piece_length_mm, 0),
        0
      )
    ), 0)
    into v_received_count
    from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = new.request_item_table
      and schedule.request_item_id = new.request_item_id
      and schedule.status = 'delivered'
      and schedule.received_piece_length_mm = new.received_piece_length_mm;

    v_mismatch := v_expected_count = 0 or v_received_count > v_expected_count;
    if v_mismatch then
      v_reason := format(
        'Расхождение при закупочной приёмке: по утверждённой карте %s, принято %s мм × %s',
        coalesce(v_expected_composition, 'нет закупаемых хлыстов'),
        trim(to_char(new.received_piece_length_mm, 'FM9999999990.###')),
        trim(to_char(v_attributed_count, 'FM9999999990.###'))
      );
    end if;
  end if;

  if v_mismatch then
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

drop trigger if exists invalidate_long_stock_plan_after_supply_receipt
  on public.supply_order_delivery_schedules;
create trigger invalidate_long_stock_plan_after_supply_receipt
after insert or update of
  status,
  received_piece_length_mm,
  received_piece_count,
  allocated_piece_count,
  allocated_physical_quantity,
  received_by,
  receipt_parent_schedule_id
on public.supply_order_delivery_schedules
for each row execute function public.fn_invalidate_long_stock_plan_after_supply_receipt();

create or replace function public.fn_assert_long_stock_cutting_ready(p_machine_id uuid)
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
    raise exception 'Резка заблокирована: позиция длинномера требует пересчёта';
  end if;

  if exists (
    select 1
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan on plan.id = item.plan_id
    join public.technologist_requests request on request.id = item.request_id
    where request.machine_id = p_machine_id
      and plan.status = 'open'
      and (
        item.cutting_status = 'planning'
        or not exists (
          select 1
          from public.long_stock_cutting_plan_versions version
          join public.long_stock_cutting_candidates candidate
            on candidate.version_id = version.id
           and candidate.candidate_number = version.selected_candidate_number
          where version.plan_id = plan.id
            and version.status = 'approved'
        )
      )
  ) then
    raise exception 'Резка заблокирована: для позиции длинномера нет утверждённой версии карты раскроя';
  end if;
end;
$$;

revoke all on function public.fn_assert_long_stock_cutting_ready(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_assert_long_stock_cutting_ready(uuid)
  to service_role;

create or replace function public.fn_long_stock_cutting_match_rows_v1(
  p_machine_id uuid,
  p_event_id uuid default null
)
returns table (
  version_id uuid,
  reservation_id uuid,
  reservation_piece_number integer,
  source_inventory_id uuid,
  stock_length_mm numeric,
  bar_id uuid,
  result_inventory_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with active_plan_items as (
    select distinct on (item.request_item_table, item.request_item_id)
      item.request_item_table,
      item.request_item_id,
      plan.material_variant_id,
      version.id as version_id,
      candidate.id as candidate_id
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan
      on plan.id = item.plan_id
     and plan.status = 'open'
    join public.long_stock_cutting_plan_versions version
      on version.plan_id = plan.id
     and version.status = 'approved'
    join public.long_stock_cutting_candidates candidate
      on candidate.version_id = version.id
     and candidate.candidate_number = version.selected_candidate_number
    join public.technologist_requests request
      on request.id = item.request_id
     and request.machine_id = p_machine_id
    order by
      item.request_item_table,
      item.request_item_id,
      version.approved_at desc,
      version.id desc
  ),
  reservation_sources as (
    select
      plan_item.version_id,
      plan_item.material_variant_id as plan_material_variant_id,
      reservation.material_variant_id,
      reservation.id as reservation_id,
      reservation.inventory_id,
      coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm) as stock_length_mm,
      reservation.created_at,
      reservation.reserved_quantity,
      reservation.reserved_secondary_quantity
    from public.inventory_reservations reservation
    join public.inventory inventory on inventory.id = reservation.inventory_id
    join active_plan_items plan_item
      on plan_item.request_item_table = reservation.request_item_table
     and plan_item.request_item_id = reservation.request_item_id
    where p_event_id is null
      and reservation.machine_id = p_machine_id
      and reservation.consumed_at is null
      and coalesce(reservation.is_cut_reservation, false) = false

    union all

    select
      plan_item.version_id,
      plan_item.material_variant_id as plan_material_variant_id,
      event_reservation.material_variant_id,
      event_reservation.reservation_id,
      event_reservation.inventory_id,
      coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm) as stock_length_mm,
      reservation.created_at,
      event_reservation.reserved_quantity,
      event_reservation.reserved_secondary_quantity
    from public.production_fact_cutting_event_reservations event_reservation
    join public.inventory_reservations reservation
      on reservation.id = event_reservation.reservation_id
    join public.inventory inventory on inventory.id = event_reservation.inventory_id
    join active_plan_items plan_item
      on plan_item.request_item_table = event_reservation.request_item_table
     and plan_item.request_item_id = event_reservation.request_item_id
    where p_event_id is not null
      and event_reservation.event_id = p_event_id
      and coalesce(event_reservation.is_cut_reservation, false) = false
  ),
  reservation_units as (
    select
      source.version_id,
      source.plan_material_variant_id,
      source.material_variant_id,
      source.reservation_id,
      source.inventory_id,
      source.stock_length_mm,
      source.created_at,
      piece.piece_number
    from reservation_sources source
    cross join lateral generate_series(
      1,
      greatest(
        floor(coalesce(source.reserved_secondary_quantity, 0))::integer,
        case
          when coalesce(source.stock_length_mm, 0) > 0 then
            floor(source.reserved_quantity / source.stock_length_mm)::integer
          else 0
        end,
        1
      )
    ) piece(piece_number)
  ),
  ranked_units as (
    select
      unit.*,
      row_number() over (
        partition by unit.version_id, unit.material_variant_id, unit.stock_length_mm
        order by unit.created_at, unit.reservation_id, unit.piece_number
      ) as length_rank
    from reservation_units unit
  ),
  ranked_bars as (
    select
      plan_item.version_id,
      plan_item.material_variant_id,
      bar.id as bar_id,
      bar.stock_length_mm,
      row_number() over (
        partition by plan_item.version_id, bar.stock_length_mm
        order by bar.bar_number, bar.id
      ) as length_rank
    from (
      select distinct version_id, material_variant_id, candidate_id
      from active_plan_items
    ) plan_item
    join public.long_stock_cutting_candidate_bars bar
      on bar.candidate_id = plan_item.candidate_id
     and bar.status = 'planned'
  )
  select
    unit.version_id,
    unit.reservation_id,
    unit.piece_number,
    unit.inventory_id,
    unit.stock_length_mm,
    bar.bar_id,
    scrap.inventory_id
  from ranked_units unit
  left join ranked_bars bar
    on bar.version_id = unit.version_id
   and bar.material_variant_id is not distinct from unit.material_variant_id
   and unit.plan_material_variant_id is not distinct from unit.material_variant_id
   and bar.stock_length_mm = unit.stock_length_mm
   and bar.length_rank = unit.length_rank
  left join public.long_stock_cutting_business_scraps scrap
    on scrap.version_id = unit.version_id
   and scrap.bar_id = bar.bar_id;
$$;

revoke all on function public.fn_long_stock_cutting_match_rows_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_assert_long_stock_cutting_reservation_match_v1(
  p_machine_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_physical_count integer;
  v_matched_count integer;
  v_unmatched text;
begin
  if exists (
    select 1
    from public.supply_order_delivery_schedules schedule
    join public.long_stock_cutting_plan_items item
      on item.request_item_table = schedule.request_item_table
     and item.request_item_id = schedule.request_item_id
    join public.long_stock_cutting_plans plan
      on plan.id = item.plan_id
     and plan.status = 'open'
    join public.technologist_requests request
      on request.id = item.request_id
     and request.machine_id = p_machine_id
    join public.long_stock_cutting_plan_versions version
      on version.plan_id = plan.id
     and version.status = 'approved'
    where schedule.status = 'delivered'
      and coalesce(schedule.received_piece_length_mm, 0) > 0
      and not exists (
        select 1
        from public.inventory_reservations reservation
        where reservation.supply_order_schedule_id = schedule.id
      )
  ) then
    raise exception 'Резка заблокирована: принятый хлыст утверждённой карты не имеет физической складской брони';
  end if;

  select
    count(*)::integer,
    count(match_row.bar_id)::integer,
    string_agg(
      coalesce(trim(to_char(match_row.stock_length_mm, 'FM9999999990.###')) || ' мм', 'без длины'),
      ', ' order by match_row.stock_length_mm nulls last
    ) filter (where match_row.bar_id is null)
  into v_physical_count, v_matched_count, v_unmatched
  from public.fn_long_stock_cutting_match_rows_v1(p_machine_id, null) match_row;

  if v_physical_count <> v_matched_count then
    raise exception
      'Резка заблокирована: сопоставление физических хлыстов с утверждённой картой неполное (физических: %, сопоставлено: %, не сопоставлено: %)',
      v_physical_count,
      v_matched_count,
      coalesce(v_unmatched, '—');
  end if;
end;
$$;

revoke all on function public.fn_assert_long_stock_cutting_reservation_match_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_assert_long_stock_cutting_event_match_v1(
  p_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_machine_id uuid;
  v_physical_count integer;
  v_matched_count integer;
  v_unmatched text;
begin
  select event.machine_id into v_machine_id
  from public.production_fact_cutting_events event
  where event.id = p_event_id;
  if v_machine_id is null then
    raise exception 'Событие факта заготовки не найдено';
  end if;

  select
    count(*)::integer,
    count(match_row.bar_id)::integer,
    string_agg(
      coalesce(trim(to_char(match_row.stock_length_mm, 'FM9999999990.###')) || ' мм', 'без длины'),
      ', ' order by match_row.stock_length_mm nulls last
    ) filter (where match_row.bar_id is null)
  into v_physical_count, v_matched_count, v_unmatched
  from public.fn_long_stock_cutting_match_rows_v1(v_machine_id, p_event_id) match_row;

  if v_physical_count <> v_matched_count then
    raise exception
      'Факт заготовки отклонён: сопоставление физических хлыстов с утверждённой картой неполное (физических: %, сопоставлено: %, не сопоставлено: %)',
      v_physical_count,
      v_matched_count,
      coalesce(v_unmatched, '—');
  end if;
end;
$$;

revoke all on function public.fn_assert_long_stock_cutting_event_match_v1(uuid)
  from public, anon, authenticated, service_role;

alter function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  rename to fn_apply_long_stock_cutting_fact_before_complete_match_v1;

revoke all on function public.fn_apply_long_stock_cutting_fact_before_complete_match_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_apply_long_stock_cutting_fact_v1(
  p_event_id uuid,
  p_performed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.production_fact_cutting_events%rowtype;
  v_result jsonb;
  v_matched_count integer;
begin
  select * into v_event
  from public.production_fact_cutting_events
  where id = p_event_id
  for update;
  if not found then
    raise exception 'Событие факта заготовки не найдено';
  end if;
  if v_event.status <> 'applied' then
    return jsonb_build_object(
      'event_id', v_event.id,
      'matched_bars', 0,
      'promoted_scraps', 0,
      'archived_aggregate_scraps', 0
    );
  end if;

  select count(*)::integer into v_matched_count
  from public.long_stock_cutting_fact_bars fact_bar
  where fact_bar.event_id = p_event_id
    and fact_bar.rolled_back_at is null;
  if v_matched_count > 0 then
    return jsonb_build_object(
      'event_id', v_event.id,
      'matched_bars', v_matched_count,
      'promoted_scraps', 0,
      'archived_aggregate_scraps', 0
    );
  end if;

  perform public.fn_assert_long_stock_cutting_event_match_v1(p_event_id);

  insert into public.long_stock_cutting_fact_bars(
    event_id,
    version_id,
    bar_id,
    reservation_id,
    reservation_piece_number,
    source_inventory_id,
    result_inventory_id,
    recorded_by
  )
  select
    p_event_id,
    match_row.version_id,
    match_row.bar_id,
    match_row.reservation_id,
    match_row.reservation_piece_number,
    match_row.source_inventory_id,
    match_row.result_inventory_id,
    p_performed_by
  from public.fn_long_stock_cutting_match_rows_v1(v_event.machine_id, p_event_id) match_row
  where match_row.bar_id is not null
  order by match_row.stock_length_mm, match_row.bar_id
  on conflict do nothing;

  get diagnostics v_matched_count = row_count;
  if v_matched_count <> (
    select count(*)
    from public.fn_long_stock_cutting_match_rows_v1(v_event.machine_id, p_event_id)
  ) then
    raise exception 'Факт заготовки отклонён: соответствия физических хлыстов изменились во время записи';
  end if;

  v_result := public.fn_apply_long_stock_cutting_fact_before_complete_match_v1(
    p_event_id,
    p_performed_by
  );
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('matched_bars', v_matched_count);
end;
$$;

revoke all on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  to service_role;

create or replace function public.fn_apply_production_fact_cutting(
  p_fact_id uuid,
  p_performed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_machine_id uuid;
  v_effective_stage public.stage_type;
begin
  select event.id into v_event_id
  from public.production_fact_cutting_events event
  where event.fact_id = p_fact_id
  limit 1;
  if v_event_id is not null then
    return v_event_id;
  end if;

  select fact.machine_id,
         coalesce(section.production_stage_type, parent.production_stage_type)
  into v_machine_id, v_effective_stage
  from public.production_machine_facts fact
  join public.production_fact_sections section on section.id = fact.section_id
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where fact.id = p_fact_id;

  if v_effective_stage = 'cutting'::public.stage_type then
    perform public.fn_assert_long_stock_cutting_ready(v_machine_id);
    perform public.fn_assert_long_stock_cutting_reservation_match_v1(v_machine_id);
  end if;

  v_event_id := public.fn_apply_production_fact_cutting_before_long_stock_fact(
    p_fact_id,
    p_performed_by
  );
  if v_event_id is not null then
    perform public.fn_apply_long_stock_cutting_fact_v1(v_event_id, p_performed_by);
  end if;
  return v_event_id;
end;
$$;

notify pgrst, 'reload schema';
