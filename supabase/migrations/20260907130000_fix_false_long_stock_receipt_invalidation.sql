-- Compare approved long-stock layouts with physical receipt reservations.
-- Historical/cancelled supplier schedules are audit data and must never add bars
-- to the composition used to invalidate a cutting plan.

create table public.long_stock_receipt_revalidation_events (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null unique
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  plan_id uuid not null references public.long_stock_cutting_plans(id) on delete restrict,
  prior_invalidation_reason text not null,
  compared_compositions jsonb not null check (jsonb_typeof(compared_compositions) = 'array'),
  schedule_audit jsonb not null check (jsonb_typeof(schedule_audit) = 'array'),
  restored_by uuid not null references public.users(id) on delete restrict,
  restored_at timestamptz not null default now()
);

comment on table public.long_stock_receipt_revalidation_events is
  'Append-only audit of same-version recovery after a false supply-receipt invalidation.';

alter table public.long_stock_receipt_revalidation_events enable row level security;
revoke all on table public.long_stock_receipt_revalidation_events
  from public, anon, authenticated;
grant select, insert on table public.long_stock_receipt_revalidation_events
  to service_role;

create or replace function public.fn_guard_long_stock_receipt_revalidation_event_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Событие восстановления карты раскроя неизменяемо';
end;
$$;

create trigger long_stock_receipt_revalidation_event_guard
before update or delete on public.long_stock_receipt_revalidation_events
for each row execute function public.fn_guard_long_stock_receipt_revalidation_event_v1();

revoke all on function public.fn_guard_long_stock_receipt_revalidation_event_v1()
  from public, anon, authenticated, service_role;

create or replace function public.fn_get_long_stock_receipt_composition_v1(
  p_version_id uuid,
  p_request_item_table text,
  p_request_item_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with selected_candidate as (
    select candidate.id
    from public.long_stock_cutting_plan_versions version
    join public.long_stock_cutting_candidates candidate
      on candidate.version_id = version.id
     and candidate.candidate_number = version.selected_candidate_number
    where version.id = p_version_id
  ), target_item as (
    select item.id
    from public.long_stock_cutting_plan_items item
    where item.plan_id = (
      select version.plan_id
      from public.long_stock_cutting_plan_versions version
      where version.id = p_version_id
    )
      and item.request_item_table = p_request_item_table
      and item.request_item_id = p_request_item_id
  ), expected as (
    select bar.stock_length_mm::numeric as stock_length_mm, count(*)::numeric as piece_count
    from selected_candidate candidate
    join public.long_stock_cutting_candidate_bars bar
      on bar.candidate_id = candidate.id
    where bar.source_type = 'new_stock'
      and bar.status = 'planned'
      and exists (
        select 1
        from public.long_stock_cutting_bar_cuts cut
        join public.long_stock_cutting_segments segment on segment.id = cut.segment_id
        where cut.bar_id = bar.id
          and segment.plan_item_id = (select id from target_item)
      )
    group by bar.stock_length_mm
  ), reservation_presence as (
    select exists (
      select 1
      from public.inventory_reservations reservation
      where reservation.request_item_table = p_request_item_table
        and reservation.request_item_id = p_request_item_id
        and reservation.reservation_source = 'supply_receipt'
        and reservation.consumed_at is null
        and reservation.is_cut_reservation = false
    ) as has_rows
  ), reservation_actual as (
    select
      coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm)::numeric
        as stock_length_mm,
      sum(
        case
          when coalesce(reservation.reserved_secondary_quantity, 0) > 0
            then floor(reservation.reserved_secondary_quantity)
          else floor(
            reservation.reserved_quantity
            / nullif(coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm), 0)
          )
        end
      )::numeric as piece_count
    from public.inventory_reservations reservation
    join public.inventory inventory on inventory.id = reservation.inventory_id
    where reservation.request_item_table = p_request_item_table
      and reservation.request_item_id = p_request_item_id
      and reservation.reservation_source = 'supply_receipt'
      and reservation.consumed_at is null
      and reservation.is_cut_reservation = false
      and inventory.deleted_at is null
      and not inventory.is_business_scrap
      and coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm, 0) > 0
    group by coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm)
  ), legacy_schedule_actual as (
    -- Compatibility for old delivered rows that predate reservation provenance.
    -- Application receipts have reservations and never enter this branch.
    select
      schedule.received_piece_length_mm::numeric as stock_length_mm,
      sum(
        case
          when schedule.allocated_piece_count is not null then schedule.allocated_piece_count
          when schedule.allocated_physical_quantity is not null then
            schedule.allocated_physical_quantity / nullif(schedule.received_piece_length_mm, 0)
          when schedule.receipt_parent_schedule_id is null then schedule.received_piece_count
          else 0
        end
      )::numeric as piece_count
    from public.supply_order_delivery_schedules schedule
    cross join reservation_presence presence
    where not presence.has_rows
      and schedule.request_item_table = p_request_item_table
      and schedule.request_item_id = p_request_item_id
      and schedule.status = 'delivered'
      and coalesce(schedule.received_piece_length_mm, 0) > 0
    group by schedule.received_piece_length_mm
  ), actual as (
    select stock_length_mm, sum(piece_count)::numeric as piece_count
    from (
      select * from reservation_actual
      union all
      select * from legacy_schedule_actual
    ) source
    where piece_count > 0
    group by stock_length_mm
  ), comparison as (
    select
      coalesce(expected.stock_length_mm, actual.stock_length_mm) as stock_length_mm,
      coalesce(expected.piece_count, 0) as expected_piece_count,
      coalesce(actual.piece_count, 0) as actual_piece_count
    from expected
    full join actual using (stock_length_mm)
  )
  select jsonb_build_object(
    'expected', coalesce((
      select jsonb_agg(jsonb_build_object(
        'piece_length_mm', stock_length_mm,
        'piece_count', piece_count,
        'physical_quantity', stock_length_mm * piece_count
      ) order by stock_length_mm)
      from expected
    ), '[]'::jsonb),
    'actual', coalesce((
      select jsonb_agg(jsonb_build_object(
        'piece_length_mm', stock_length_mm,
        'piece_count', piece_count,
        'physical_quantity', stock_length_mm * piece_count
      ) order by stock_length_mm)
      from actual
    ), '[]'::jsonb),
    'expected_text', coalesce((
      select string_agg(
        trim(to_char(stock_length_mm, 'FM9999999990.###')) || ' мм × '
          || trim(to_char(piece_count, 'FM9999999990.###')),
        ', ' order by stock_length_mm
      ) from expected
    ), 'нет закупаемых хлыстов'),
    'actual_text', coalesce((
      select string_agg(
        trim(to_char(stock_length_mm, 'FM9999999990.###')) || ' мм × '
          || trim(to_char(piece_count, 'FM9999999990.###')),
        ', ' order by stock_length_mm
      ) from actual
    ), 'ничего не принято'),
    'has_unexpected', coalesce((
      select bool_or(actual_piece_count > expected_piece_count) from comparison
    ), false),
    'is_complete', coalesce((
      select bool_and(actual_piece_count = expected_piece_count) from comparison
    ), false) and exists (select 1 from expected),
    'mismatches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'piece_length_mm', stock_length_mm,
        'expected_piece_count', expected_piece_count,
        'actual_piece_count', actual_piece_count,
        'kind', case
          when expected_piece_count = 0 then 'unexpected_length'
          when actual_piece_count > expected_piece_count then 'excess_allocated_pieces'
          when actual_piece_count < expected_piece_count then 'missing_pieces'
          else 'match'
        end
      ) order by stock_length_mm)
      from comparison
      where actual_piece_count <> expected_piece_count
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.fn_get_long_stock_receipt_composition_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_get_long_stock_receipt_composition_v1(uuid, text, uuid)
  to service_role;

create or replace function public.fn_invalidate_long_stock_plan_after_supply_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_plan_id uuid;
  v_composition jsonb;
  v_reason text;
begin
  if new.status <> 'delivered'
    or new.request_item_table not in ('request_circle', 'request_pipe', 'request_knives')
    or new.received_piece_length_mm is null
    or new.received_by is null then
    return new;
  end if;

  select version.id, plan.id
  into v_version_id, v_plan_id
  from public.long_stock_cutting_plan_items item
  join public.long_stock_cutting_plans plan on plan.id = item.plan_id and plan.status = 'open'
  join public.long_stock_cutting_plan_versions version
    on version.plan_id = plan.id and version.status = 'approved'
  where item.request_item_table = new.request_item_table
    and item.request_item_id = new.request_item_id
    and item.link_state = 'active'
  order by version.approved_at desc, version.id desc
  limit 1;

  if v_version_id is null then return new; end if;
  perform 1
  from public.long_stock_cutting_plans plan
  where plan.id = v_plan_id
  for update;
  if not exists (
    select 1 from public.long_stock_cutting_plan_versions version
    where version.id = v_version_id and version.status = 'approved'
  ) then
    return new;
  end if;
  v_composition := public.fn_get_long_stock_receipt_composition_v1(
    v_version_id, new.request_item_table, new.request_item_id
  );

  -- A correct partial delivery is a subset of the approved composition. The
  -- normal cutting-readiness check continues to block fact until it is complete.
  if coalesce((v_composition->>'has_unexpected')::boolean, false) then
    v_reason := format(
      'Расхождение при закупочной приёмке: ожидалось %s; физически распределено %s; расхождения: %s',
      v_composition->>'expected_text',
      v_composition->>'actual_text',
      v_composition->'mismatches'
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

-- The schedule-trigger function cannot be called as a normal function because
-- it depends on NEW. Keep reservation validation in a small explicit wrapper.
create or replace function public.fn_check_long_stock_receipt_reservation_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version_id uuid;
  v_plan_id uuid;
  v_composition jsonb;
  v_reason text;
begin
  if new.reservation_source <> 'supply_receipt'
    or new.consumed_at is not null
    or new.is_cut_reservation
    or new.request_item_table not in ('request_circle', 'request_pipe', 'request_knives') then
    return new;
  end if;

  select version.id, plan.id
  into v_version_id, v_plan_id
  from public.long_stock_cutting_plan_items item
  join public.long_stock_cutting_plans plan on plan.id = item.plan_id and plan.status = 'open'
  join public.long_stock_cutting_plan_versions version
    on version.plan_id = plan.id and version.status = 'approved'
  where item.request_item_table = new.request_item_table
    and item.request_item_id = new.request_item_id
    and item.link_state = 'active'
  order by version.approved_at desc, version.id desc
  limit 1;
  if v_version_id is null then return new; end if;

  -- Receipt and approval use the same plan-level lock, so a concurrent insert
  -- cannot validate against a half-transitioned version.
  perform 1
  from public.long_stock_cutting_plans plan
  where plan.id = v_plan_id
  for update;
  if not exists (
    select 1 from public.long_stock_cutting_plan_versions version
    where version.id = v_version_id and version.status = 'approved'
  ) then
    return new;
  end if;

  v_composition := public.fn_get_long_stock_receipt_composition_v1(
    v_version_id, new.request_item_table, new.request_item_id
  );
  if coalesce((v_composition->>'has_unexpected')::boolean, false) then
    v_reason := format(
      'Расхождение при закупочной приёмке: ожидалось %s; физически распределено %s; расхождения: %s',
      v_composition->>'expected_text',
      v_composition->>'actual_text',
      v_composition->'mismatches'
    );
    perform public.fn_invalidate_long_stock_cutting_plan_for_receipt(
      new.request_item_table,
      new.request_item_id,
      new.reserved_by,
      v_reason,
      new.supply_order_schedule_id,
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists check_long_stock_receipt_reservation
  on public.inventory_reservations;
create trigger check_long_stock_receipt_reservation
after insert on public.inventory_reservations
for each row execute function public.fn_check_long_stock_receipt_reservation_v1();

revoke all on function public.fn_invalidate_long_stock_plan_after_supply_receipt()
  from public, anon, authenticated;
revoke all on function public.fn_check_long_stock_receipt_reservation_v1()
  from public, anon, authenticated, service_role;

-- Approval-time validation uses the same physical composition. This closes the
-- race where receipt commits immediately before a draft version is approved.
create or replace function public.fn_revalidate_long_stock_receipts_after_approval_v1(
  p_version_id uuid,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_item record;
  v_transfer_item record;
  v_composition jsonb;
  v_schedule_id uuid;
  v_expected_count numeric;
  v_actual_count numeric;
  v_requested_count numeric;
  v_reason text;
  v_invalidated_version_id uuid;
  v_is_recalculation boolean;
begin
  select
    plan_id,
    nullif(input_snapshot#>>'{recalculation,source_version_id}', '') is not null
  into strict v_plan_id, v_is_recalculation
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;
  if v_is_recalculation then return null; end if;

  for v_item in
    select item.*
    from public.long_stock_cutting_plan_items item
    where item.plan_id = v_plan_id and item.link_state = 'active'
    order by item.id
  loop
    v_composition := public.fn_get_long_stock_receipt_composition_v1(
      p_version_id, v_item.request_item_table, v_item.request_item_id
    );
    if coalesce((v_composition->>'has_unexpected')::boolean, false) then
      select schedule.id into v_schedule_id
      from public.supply_order_delivery_schedules schedule
      where schedule.request_item_table = v_item.request_item_table
        and schedule.request_item_id = v_item.request_item_id
        and schedule.status = 'delivered'
      order by schedule.delivered_at desc nulls last, schedule.created_at desc, schedule.id desc
      limit 1;
      if v_schedule_id is null then continue; end if;

      v_reason := format(
        'Расхождение уже принятого материала при утверждении карты: ожидалось %s; физически распределено %s; расхождения: %s',
        v_composition->>'expected_text',
        v_composition->>'actual_text',
        v_composition->'mismatches'
      );
      v_invalidated_version_id := public.fn_invalidate_long_stock_cutting_plan_for_receipt(
        v_item.request_item_table,
        v_item.request_item_id,
        p_actor,
        v_reason,
        v_schedule_id,
        null
      );
      if v_invalidated_version_id is not null then return v_invalidated_version_id; end if;
    end if;
  end loop;

  -- Preserve the established interfactory validation. This change is scoped to
  -- supplier receipt schedules and their warehouse reservations.
  for v_transfer_item in
    select transfer_item.*
    from public.long_stock_cutting_plan_items item
    join public.inventory_transfer_items transfer_item
      on transfer_item.request_item_table = item.request_item_table
     and transfer_item.request_item_id = item.request_item_id
    where item.plan_id = v_plan_id
      and coalesce(transfer_item.piece_length_mm, 0) > 0
      and coalesce(transfer_item.received_quantity, 0) > 0
    order by transfer_item.created_at, transfer_item.id
  loop
    select count(*)::numeric into v_expected_count
    from public.long_stock_cutting_candidates candidate
    join public.long_stock_cutting_candidate_bars bar on bar.candidate_id = candidate.id
    where candidate.version_id = p_version_id
      and candidate.candidate_number = (
        select selected_candidate_number
        from public.long_stock_cutting_plan_versions
        where id = p_version_id
      )
      and bar.stock_length_mm = v_transfer_item.piece_length_mm;

    v_actual_count := coalesce(
      v_transfer_item.received_secondary_quantity,
      v_transfer_item.received_quantity / nullif(v_transfer_item.piece_length_mm, 0)
    );
    select coalesce(sum(coalesce(
      item.requested_secondary_quantity,
      item.requested_quantity / nullif(item.piece_length_mm, 0)
    )), 0)
    into v_requested_count
    from public.inventory_transfer_items item
    where item.request_item_table = v_transfer_item.request_item_table
      and item.request_item_id = v_transfer_item.request_item_id
      and item.piece_length_mm = v_transfer_item.piece_length_mm;

    if v_transfer_item.received_quantity is distinct from v_transfer_item.requested_quantity
      or (v_transfer_item.requested_secondary_quantity is not null
        and v_actual_count is distinct from v_transfer_item.requested_secondary_quantity)
      or v_expected_count = 0
      or v_requested_count > v_expected_count then
      v_reason := format(
        'Расхождение уже принятого межзаводского материала при утверждении карты: принято %s мм × %s',
        trim(to_char(v_transfer_item.piece_length_mm, 'FM9999999990.###')),
        trim(to_char(v_actual_count, 'FM9999999990.###'))
      );
      v_invalidated_version_id := public.fn_invalidate_long_stock_cutting_plan_for_receipt(
        v_transfer_item.request_item_table,
        v_transfer_item.request_item_id,
        p_actor,
        v_reason,
        null,
        v_transfer_item.transfer_id
      );
      if v_invalidated_version_id is not null then return v_invalidated_version_id; end if;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.fn_revalidate_long_stock_receipts_after_approval_v1(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.fn_restore_false_receipt_invalidated_long_stock_plan_v1(
  p_version_id uuid,
  p_actor uuid,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.long_stock_cutting_plans%rowtype;
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_candidate public.long_stock_cutting_candidates%rowtype;
  v_item record;
  v_composition jsonb;
  v_compositions jsonb := '[]'::jsonb;
  v_schedule_audit jsonb := '[]'::jsonb;
  v_eligible boolean := true;
  v_reasons text[] := array[]::text[];
  v_minimum_useful_length numeric;
  v_missing_scraps integer := 0;
  v_audit_id uuid;
begin
  if p_actor is null then raise exception 'Не указан исполнитель восстановления'; end if;
  if not exists (select 1 from public.users where id = p_actor and is_active) then
    raise exception 'Исполнитель восстановления не найден или заблокирован';
  end if;

  select plan_id into strict v_version.plan_id
  from public.long_stock_cutting_plan_versions where id = p_version_id;
  select * into strict v_plan
  from public.long_stock_cutting_plans where id = v_version.plan_id
  for update;
  select * into strict v_version
  from public.long_stock_cutting_plan_versions where id = p_version_id
  for update;

  select id into v_audit_id
  from public.long_stock_receipt_revalidation_events
  where version_id = p_version_id;
  if v_version.status = 'approved' and v_audit_id is not null then
    return jsonb_build_object(
      'eligible', true, 'dry_run', p_dry_run, 'restored', true,
      'idempotent', true, 'version_id', p_version_id, 'audit_event_id', v_audit_id
    );
  end if;

  select * into strict v_candidate
  from public.long_stock_cutting_candidates candidate
  where candidate.version_id = p_version_id
    and candidate.candidate_number = v_version.selected_candidate_number;

  -- Serialize every row used by the decision and expose the exact production
  -- audit in dry-run output before any state change.
  perform 1
  from public.long_stock_cutting_plan_items item
  where item.plan_id = v_plan.id
  order by item.id
  for update;
  perform 1
  from public.supply_order_delivery_schedules schedule
  join public.long_stock_cutting_plan_items item
    on item.request_item_table = schedule.request_item_table
   and item.request_item_id = schedule.request_item_id
  where item.plan_id = v_plan.id
  order by schedule.id
  for update of schedule;
  perform 1
  from public.inventory_reservations reservation
  join public.long_stock_cutting_plan_items item
    on item.request_item_table = reservation.request_item_table
   and item.request_item_id = reservation.request_item_id
  where item.plan_id = v_plan.id
  order by reservation.id
  for update of reservation;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', schedule.id,
    'status', schedule.status,
    'receipt_parent_schedule_id', schedule.receipt_parent_schedule_id,
    'request_item_table', schedule.request_item_table,
    'request_item_id', schedule.request_item_id,
    'planned_piece_length_mm', schedule.planned_piece_length_mm,
    'planned_piece_count', schedule.planned_piece_count,
    'received_piece_length_mm', schedule.received_piece_length_mm,
    'received_piece_count', schedule.received_piece_count,
    'allocated_piece_count', schedule.allocated_piece_count,
    'received_quantity', schedule.received_quantity,
    'allocated_quantity', schedule.allocated_quantity,
    'allocated_physical_quantity', schedule.allocated_physical_quantity
  ) order by schedule.created_at, schedule.id), '[]'::jsonb)
  into v_schedule_audit
  from public.supply_order_delivery_schedules schedule
  join public.long_stock_cutting_plan_items item
    on item.request_item_table = schedule.request_item_table
   and item.request_item_id = schedule.request_item_id
  where item.plan_id = v_plan.id;

  for v_item in
    select item.* from public.long_stock_cutting_plan_items item
    where item.plan_id = v_plan.id and item.link_state = 'active'
    order by item.id
  loop
    v_composition := public.fn_get_long_stock_receipt_composition_v1(
      p_version_id, v_item.request_item_table, v_item.request_item_id
    );
    v_compositions := v_compositions || jsonb_build_array(jsonb_build_object(
      'request_item_table', v_item.request_item_table,
      'request_item_id', v_item.request_item_id,
      'composition', v_composition
    ));
    if not coalesce((v_composition->>'is_complete')::boolean, false) then
      v_eligible := false;
      v_reasons := array_append(v_reasons,
        format('%s:%s — физический состав неполный или отличается',
          v_item.request_item_table, v_item.request_item_id));
    end if;
  end loop;

  if v_version.status <> 'invalid'
    or v_version.invalidation_receipt_schedule_id is null
    or v_version.invalidation_inventory_transfer_id is not null
    or v_version.invalidation_department_request_id is not null
    or v_version.invalidation_dependency_id is not null then
    v_eligible := false;
    v_reasons := array_append(v_reasons, 'Версия не является receipt-инвалидацией');
  end if;
  if exists (
    select 1 from public.long_stock_cutting_candidate_bars bar
    where bar.candidate_id = v_candidate.id and bar.status <> 'planned'
  ) then
    v_eligible := false;
    v_reasons := array_append(v_reasons, 'Порезка по версии уже начата');
  end if;
  if exists (
    select 1 from public.long_stock_cutting_candidate_bars bar
    where bar.candidate_id = v_candidate.id and bar.source_type <> 'new_stock'
  ) then
    v_eligible := false;
    v_reasons := array_append(v_reasons, 'Карта использует складские источники; нужен штатный пересчёт');
  end if;
  if exists (
    select 1 from public.long_stock_recalculation_replacements replacement
    where replacement.source_version_id = p_version_id
      and replacement.status = 'replacement_staging'
  ) then
    v_eligible := false;
    v_reasons := array_append(v_reasons, 'Уже создана активная замещающая заявка');
  end if;
  if exists (
    select 1 from public.long_stock_cutting_source_dependencies dependency
    where (dependency.producer_version_id = p_version_id
        or dependency.consumer_version_id = p_version_id)
  ) then
    v_eligible := false;
    v_reasons := array_append(v_reasons, 'Версия участвует в зависимых картах');
  end if;
  if exists (
    select 1 from public.long_stock_cutting_plan_versions other_version
    where other_version.plan_id = v_plan.id
      and other_version.id <> p_version_id
      and other_version.status = 'approved'
  ) then
    v_eligible := false;
    v_reasons := array_append(v_reasons, 'У карты уже есть другая утверждённая версия');
  end if;

  v_minimum_useful_length := coalesce(
    nullif(v_version.settings_snapshot->>'minimum_useful_length_mm', '')::numeric,
    nullif(v_version.settings_snapshot->>'min_business_scrap_length_mm', '')::numeric,
    0
  );
  select count(*) into v_missing_scraps
  from (
    select bar.id,
      bar.stock_length_mm
        - coalesce(sum(cut.cut_length_mm), 0)
        - count(cut.id) * coalesce((v_version.settings_snapshot->>'kerf_mm')::numeric, 0)
        - coalesce((v_version.settings_snapshot->>'end_trim_mm')::numeric, 0) as remainder
    from public.long_stock_cutting_candidate_bars bar
    left join public.long_stock_cutting_bar_cuts cut on cut.bar_id = bar.id
    where bar.candidate_id = v_candidate.id
    group by bar.id, bar.stock_length_mm
  ) expected_scrap
  where expected_scrap.remainder >= v_minimum_useful_length
    and expected_scrap.remainder > 0
    and not exists (
      select 1 from public.long_stock_cutting_business_scraps link
      join public.inventory inventory on inventory.id = link.inventory_id
      where link.version_id = p_version_id
        and link.bar_id = expected_scrap.id
        and coalesce(inventory.reserved_quantity, 0) = 0
        and coalesce(inventory.reserved_secondary_quantity, 0) = 0
    );
  if v_missing_scraps > 0 then
    v_eligible := false;
    v_reasons := array_append(v_reasons, 'Будущие остатки нельзя безопасно восстановить');
  end if;

  if p_dry_run or not v_eligible then
    return jsonb_build_object(
      'eligible', v_eligible,
      'dry_run', p_dry_run,
      'restored', false,
      'version_id', p_version_id,
      'plan_id', v_plan.id,
      'plan_number', v_plan.plan_number,
      'version_number', v_version.version_number,
      'prior_invalidation_reason', v_version.invalidation_reason,
      'reasons', to_jsonb(v_reasons),
      'compared_compositions', v_compositions,
      'schedule_audit', v_schedule_audit
    );
  end if;

  insert into public.long_stock_receipt_revalidation_events(
    version_id, plan_id, prior_invalidation_reason,
    compared_compositions, schedule_audit, restored_by
  ) values (
    p_version_id, v_plan.id, v_version.invalidation_reason,
    v_compositions, v_schedule_audit, p_actor
  ) returning id into v_audit_id;

  update public.inventory inventory
  set total_quantity = restored.remainder,
      reserved_quantity = 0,
      total_secondary_quantity = 1,
      reserved_secondary_quantity = 0,
      deleted_at = null,
      deleted_by = null,
      delete_comment = null,
      last_updated_by = p_actor,
      updated_at = now()
  from (
    select link.inventory_id,
      bar.stock_length_mm
        - coalesce(sum(cut.cut_length_mm), 0)
        - count(cut.id) * coalesce((v_version.settings_snapshot->>'kerf_mm')::numeric, 0)
        - coalesce((v_version.settings_snapshot->>'end_trim_mm')::numeric, 0) as remainder
    from public.long_stock_cutting_candidate_bars bar
    join public.long_stock_cutting_business_scraps link
      on link.version_id = p_version_id and link.bar_id = bar.id
    left join public.long_stock_cutting_bar_cuts cut on cut.bar_id = bar.id
    where bar.candidate_id = v_candidate.id
    group by link.inventory_id, bar.id, bar.stock_length_mm
  ) restored
  where inventory.id = restored.inventory_id
    and restored.remainder >= v_minimum_useful_length
    and restored.remainder > 0;

  perform set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  update public.long_stock_cutting_plan_versions
  set status = 'approved'
  where id = p_version_id;
  perform set_config('app.long_stock_cutting_version_lifecycle', '', true);

  perform set_config('app.long_stock_cutting_item_status', '1', true);
  update public.long_stock_cutting_plan_items
  set cutting_status = case when v_candidate.purchased_length_mm > 0
    then 'plan_approved' else 'accepted' end
  where plan_id = v_plan.id and link_state = 'active';
  perform set_config('app.long_stock_cutting_item_status', '', true);

  update public.tasks
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where long_stock_cutting_plan_id = v_plan.id
    and long_stock_cutting_plan_version_id = p_version_id
    and task_type = 'long_stock_cutting_recalculation'
    and status in ('pending', 'in_progress');

  return jsonb_build_object(
    'eligible', true, 'dry_run', false, 'restored', true,
    'idempotent', false, 'version_id', p_version_id,
    'plan_id', v_plan.id, 'audit_event_id', v_audit_id,
    'compared_compositions', v_compositions,
    'schedule_audit', v_schedule_audit
  );
end;
$$;

revoke all on function public.fn_restore_false_receipt_invalidated_long_stock_plan_v1(
  uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.fn_restore_false_receipt_invalidated_long_stock_plan_v1(
  uuid, uuid, boolean
) to service_role;

notify pgrst, 'reload schema';
