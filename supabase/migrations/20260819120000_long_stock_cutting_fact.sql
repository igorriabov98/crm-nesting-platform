-- Apply one production cutting fact to the exact long-stock bars that were
-- physically reserved when the fact was recorded. Later receipts remain for a
-- later fact; plan scraps are promoted per bar instead of per cutting stage.

create table public.long_stock_cutting_fact_bars (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null
    references public.production_fact_cutting_events(id) on delete restrict,
  version_id uuid not null,
  bar_id uuid not null,
  reservation_id uuid not null
    references public.inventory_reservations(id) on delete restrict,
  reservation_piece_number integer not null check (reservation_piece_number > 0),
  source_inventory_id uuid not null
    references public.inventory(id) on delete restrict,
  result_inventory_id uuid
    references public.inventory(id) on delete restrict,
  recorded_by uuid not null references public.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  rolled_back_by uuid references public.users(id) on delete restrict,
  rolled_back_at timestamptz,
  foreign key (version_id, bar_id)
    references public.long_stock_cutting_candidate_bars(version_id, id) on delete restrict,
  unique (event_id, reservation_id, reservation_piece_number),
  check ((rolled_back_at is null) = (rolled_back_by is null))
);

create index long_stock_cutting_fact_bars_event_idx
  on public.long_stock_cutting_fact_bars(event_id);

create unique index long_stock_cutting_fact_bars_active_bar_idx
  on public.long_stock_cutting_fact_bars(bar_id)
  where rolled_back_at is null;

alter table public.long_stock_cutting_fact_bars enable row level security;
revoke all on table public.long_stock_cutting_fact_bars
  from public, anon, authenticated;
grant select, insert on table public.long_stock_cutting_fact_bars to service_role;

comment on table public.long_stock_cutting_fact_bars is
  'Immutable matching between a production cutting event, one physical reserved bar and one selected plan bar.';

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
  v_match record;
  v_matched_count integer := 0;
  v_promoted_count integer := 0;
  v_archived_aggregate_count integer := 0;
  v_kerf_length numeric;
  v_end_trim_length numeric;
  v_weight_per_m numeric;
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

  -- One reservation can physically contain several equal bars. Expand it to
  -- pieces, rank pieces and still-planned bars by exact length, then match by
  -- the rank inside that length. This makes length the primary key and the map
  -- order (bar_number) the deterministic tie-breaker.
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
     and request.machine_id = v_event.machine_id
    order by
      item.request_item_table,
      item.request_item_id,
      version.approved_at desc,
      version.id desc
  ),
  ranked_bars as (
    select
      plan_item.request_item_table,
      plan_item.request_item_id,
      plan_item.material_variant_id,
      plan_item.version_id,
      bar.id as bar_id,
      bar.stock_length_mm,
      bar.bar_number,
      row_number() over (
        partition by plan_item.version_id, bar.stock_length_mm
        order by bar.bar_number, bar.id
      ) as length_rank
    from active_plan_items plan_item
    join public.long_stock_cutting_candidate_bars bar
      on bar.candidate_id = plan_item.candidate_id
     and bar.status = 'planned'
  ),
  reservation_units as (
    select
      plan_item.version_id,
      plan_item.request_item_table,
      plan_item.request_item_id,
      plan_item.material_variant_id,
      event_reservation.reservation_id,
      event_reservation.inventory_id,
      coalesce(
        reservation.original_piece_length_mm,
        source_inventory.piece_length_mm
      ) as stock_length_mm,
      reservation.created_at,
      piece.piece_number
    from public.production_fact_cutting_event_reservations event_reservation
    join public.inventory_reservations reservation
      on reservation.id = event_reservation.reservation_id
    join public.inventory source_inventory
      on source_inventory.id = event_reservation.inventory_id
    join active_plan_items plan_item
      on plan_item.request_item_table = event_reservation.request_item_table
     and plan_item.request_item_id = event_reservation.request_item_id
     and plan_item.material_variant_id is not distinct from event_reservation.material_variant_id
    cross join lateral generate_series(
      1,
      greatest(
        floor(coalesce(
          event_reservation.reserved_secondary_quantity,
          reservation.reserved_secondary_quantity,
          0
        ))::integer,
        case
          when coalesce(
            reservation.original_piece_length_mm,
            source_inventory.piece_length_mm,
            0
          ) > 0 then floor(
            event_reservation.reserved_quantity
            / coalesce(reservation.original_piece_length_mm, source_inventory.piece_length_mm)
          )::integer
          else 0
        end
      )
    ) piece(piece_number)
    where event_reservation.event_id = v_event.id
      and event_reservation.is_cut_reservation = false
      and coalesce(
        reservation.original_piece_length_mm,
        source_inventory.piece_length_mm,
        0
      ) > 0
  ),
  ranked_units as (
    select
      reservation_unit.*,
      row_number() over (
        partition by reservation_unit.version_id, reservation_unit.stock_length_mm
        order by
          reservation_unit.created_at,
          reservation_unit.reservation_id,
          reservation_unit.piece_number
      ) as length_rank
    from reservation_units reservation_unit
  )
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
    v_event.id,
    bar.version_id,
    bar.bar_id,
    reservation_unit.reservation_id,
    reservation_unit.piece_number,
    reservation_unit.inventory_id,
    scrap_link.inventory_id,
    p_performed_by
  from ranked_bars bar
  join ranked_units reservation_unit
    on reservation_unit.version_id = bar.version_id
   and reservation_unit.request_item_table = bar.request_item_table
   and reservation_unit.request_item_id = bar.request_item_id
   and reservation_unit.stock_length_mm = bar.stock_length_mm
   and reservation_unit.length_rank = bar.length_rank
  left join public.long_stock_cutting_business_scraps scrap_link
    on scrap_link.version_id = bar.version_id
   and scrap_link.bar_id = bar.bar_id
  on conflict do nothing;

  get diagnostics v_matched_count = row_count;

  for v_match in
    select
      fact_bar.version_id,
      fact_bar.bar_id,
      fact_bar.result_inventory_id,
      bar.bar_number,
      version.settings_snapshot,
      variant.weight_per_m_kg
    from public.long_stock_cutting_fact_bars fact_bar
    join public.long_stock_cutting_candidate_bars bar on bar.id = fact_bar.bar_id
    join public.long_stock_cutting_plan_versions version on version.id = fact_bar.version_id
    join public.long_stock_cutting_plans plan on plan.id = version.plan_id
    join public.material_variants variant on variant.id = plan.material_variant_id
    where fact_bar.event_id = v_event.id
      and bar.status = 'planned'
    order by bar.stock_length_mm, bar.bar_number, bar.id
  loop
    perform public.fn_set_long_stock_cutting_bar_status(
      v_match.bar_id,
      'cut',
      p_performed_by
    );

    select
      count(*)::numeric * coalesce((v_match.settings_snapshot->>'kerf_mm')::numeric, 0),
      coalesce((v_match.settings_snapshot->>'end_trim_mm')::numeric, 0)
    into v_kerf_length, v_end_trim_length
    from public.long_stock_cutting_bar_cuts cut
    where cut.bar_id = v_match.bar_id;

    v_weight_per_m := coalesce(v_match.weight_per_m_kg, 0);
    insert into public.long_stock_cutting_actual_losses(
      version_id,
      bar_id,
      kerf_loss_length_mm,
      end_trim_loss_length_mm,
      kerf_loss_weight_kg,
      end_trim_loss_weight_kg,
      recorded_by
    ) values (
      v_match.version_id,
      v_match.bar_id,
      v_kerf_length,
      v_end_trim_length,
      v_kerf_length * v_weight_per_m / 1000,
      v_end_trim_length * v_weight_per_m / 1000,
      p_performed_by
    )
    on conflict (bar_id) do nothing;
  end loop;

  insert into public.production_fact_cutting_event_scrap_promotions(
    event_id,
    inventory_id,
    previous_business_scrap_state
  )
  select
    v_event.id,
    inventory.id,
    inventory.business_scrap_state
  from public.long_stock_cutting_fact_bars fact_bar
  join public.inventory inventory on inventory.id = fact_bar.result_inventory_id
  where fact_bar.event_id = v_event.id
    and inventory.deleted_at is null
    and inventory.is_business_scrap = true
    and inventory.business_scrap_state = 'future'
  on conflict (event_id, inventory_id) do nothing;

  update public.inventory inventory
  set business_scrap_state = 'available',
      last_updated_by = p_performed_by,
      updated_at = now()
  from public.long_stock_cutting_fact_bars fact_bar
  where fact_bar.event_id = v_event.id
    and fact_bar.result_inventory_id = inventory.id
    and inventory.deleted_at is null
    and inventory.business_scrap_state = 'future';

  get diagnostics v_promoted_count = row_count;

  -- Supply/whole-bar reservation logic can have created one aggregate future
  -- scrap for several physical bars. Replace that aggregate with the immutable
  -- per-bar rows from the approved cutting plan. A plan-linked row is already
  -- canonical and is never archived here.
  insert into public.inventory_transactions(
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  select distinct
    aggregate_scrap.factory_id,
    aggregate_scrap.id,
    aggregate_scrap.material_id,
    aggregate_scrap.material_variant_id,
    'adjustment'::public.inventory_transaction_type,
    -aggregate_scrap.total_quantity,
    case
      when aggregate_scrap.total_secondary_quantity is null then null
      else -aggregate_scrap.total_secondary_quantity
    end,
    v_event.machine_id,
    event_reservation.request_item_table,
    event_reservation.request_item_id,
    p_performed_by,
    'Замена сводного будущего остатка индивидуальными остатками карты раскроя'
  from public.long_stock_cutting_fact_bars fact_bar
  join public.production_fact_cutting_event_reservations event_reservation
    on event_reservation.event_id = fact_bar.event_id
   and event_reservation.reservation_id = fact_bar.reservation_id
  join public.inventory aggregate_scrap
    on aggregate_scrap.id = event_reservation.business_scrap_inventory_id
  where fact_bar.event_id = v_event.id
    and aggregate_scrap.deleted_at is null
    and not exists (
      select 1
      from public.long_stock_cutting_business_scraps plan_scrap
      where plan_scrap.inventory_id = aggregate_scrap.id
    );

  update public.inventory aggregate_scrap
  set total_quantity = 0,
      reserved_quantity = 0,
      total_secondary_quantity = 0,
      reserved_secondary_quantity = 0,
      deleted_at = now(),
      deleted_by = p_performed_by,
      delete_comment = 'Заменён индивидуальными остатками карты раскроя',
      last_updated_by = p_performed_by,
      updated_at = now()
  where aggregate_scrap.id in (
    select distinct event_reservation.business_scrap_inventory_id
    from public.long_stock_cutting_fact_bars fact_bar
    join public.production_fact_cutting_event_reservations event_reservation
      on event_reservation.event_id = fact_bar.event_id
     and event_reservation.reservation_id = fact_bar.reservation_id
    where fact_bar.event_id = v_event.id
      and event_reservation.business_scrap_inventory_id is not null
      and not exists (
        select 1
        from public.long_stock_cutting_business_scraps plan_scrap
        where plan_scrap.inventory_id = event_reservation.business_scrap_inventory_id
      )
  )
    and aggregate_scrap.deleted_at is null;

  get diagnostics v_archived_aggregate_count = row_count;

  insert into public.inventory_transactions(
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  select
    result_inventory.factory_id,
    result_inventory.id,
    result_inventory.material_id,
    result_inventory.material_variant_id,
    'adjustment'::public.inventory_transaction_type,
    result_inventory.total_quantity,
    result_inventory.total_secondary_quantity,
    v_event.machine_id,
    event_reservation.request_item_table,
    event_reservation.request_item_id,
    p_performed_by,
    'Индивидуальный деловой остаток хлыста карты раскроя стал доступен'
  from public.long_stock_cutting_fact_bars fact_bar
  join public.production_fact_cutting_event_reservations event_reservation
    on event_reservation.event_id = fact_bar.event_id
   and event_reservation.reservation_id = fact_bar.reservation_id
  join public.inventory result_inventory on result_inventory.id = fact_bar.result_inventory_id
  where fact_bar.event_id = v_event.id
    and (
      event_reservation.business_scrap_inventory_id is null
      or event_reservation.business_scrap_inventory_id is distinct from fact_bar.result_inventory_id
    );

  return jsonb_build_object(
    'event_id', v_event.id,
    'matched_bars', v_matched_count,
    'promoted_scraps', v_promoted_count,
    'archived_aggregate_scraps', v_archived_aggregate_count
  );
end;
$$;

revoke all on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  to service_role;

-- The legacy function promotes every future scrap for the cutting stage. Plan
-- rows are created for all bars at approval time, so exclude them and let the
-- exact fact-to-bar function above promote only the rows actually cut.
do $migration$
declare
  v_target regprocedure;
  v_definition text;
  v_anchor text := '    AND inventory.available_from_stage_id = v_stage.id';
  v_replacement text := $replacement$
    AND inventory.available_from_stage_id = v_stage.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.long_stock_cutting_business_scraps AS plan_scrap
      WHERE plan_scrap.inventory_id = inventory.id
    )
$replacement$;
begin
  select procedure.oid::regprocedure,
         pg_get_functiondef(procedure.oid)
  into v_target, v_definition
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname like 'fn_apply_production_fact_cutting%'
    and procedure.pronargs = 2
    and procedure.proargtypes[0] = 'uuid'::regtype
    and procedure.proargtypes[1] = 'uuid'::regtype
    and position(v_anchor in pg_get_functiondef(procedure.oid)) > 0
  order by (procedure.proname = 'fn_apply_production_fact_cutting') desc,
           procedure.proname
  limit 1;

  if v_target is null or position(v_anchor in v_definition) = 0 then
    raise exception 'Не найдено продвижение будущих остатков в fn_apply_production_fact_cutting';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;

alter function public.fn_apply_production_fact_cutting(uuid, uuid)
  rename to fn_apply_production_fact_cutting_before_long_stock_fact;

revoke all on function public.fn_apply_production_fact_cutting_before_long_stock_fact(uuid, uuid)
  from public, anon, authenticated, service_role;

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
begin
  -- A fact is a closed snapshot. Reservations created after it belong to the
  -- next fact instead of being replayed into the already-applied event.
  select event.id into v_event_id
  from public.production_fact_cutting_events event
  where event.fact_id = p_fact_id
  limit 1;

  if v_event_id is not null then
    return v_event_id;
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

revoke all on function public.fn_apply_production_fact_cutting(uuid, uuid)
  from public, anon;
grant execute on function public.fn_apply_production_fact_cutting(uuid, uuid)
  to authenticated, service_role;

create or replace function public.fn_long_stock_cutting_actual_loss_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE'
    and current_setting('app.long_stock_cutting_fact_rollback', true) = '1' then
    return old;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'Фактические потери раскроя неизменяемы';
  end if;
  select status into v_status
  from public.long_stock_cutting_candidate_bars
  where id = new.bar_id and version_id = new.version_id;
  if v_status is distinct from 'cut' then
    raise exception 'Фактические потери записываются только для порезанного хлыста';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_long_stock_cutting_actual_loss_guard()
  from public, anon, authenticated;

create or replace function public.fn_rollback_long_stock_cutting_fact_v1(
  p_event_ids uuid[],
  p_performed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reopened_bars integer := 0;
  v_reopened_plans integer := 0;
  v_restored_aggregate_scraps integer := 0;
begin
  if coalesce(array_length(p_event_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'reopenedBars', 0,
      'reopenedPlans', 0,
      'restoredAggregateScraps', 0
    );
  end if;

  -- Reverse the two analytical transfers added when an aggregate reservation
  -- scrap was replaced by the per-bar plan scraps.
  insert into public.inventory_transactions(
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  select distinct
    aggregate_scrap.factory_id,
    aggregate_scrap.id,
    aggregate_scrap.material_id,
    aggregate_scrap.material_variant_id,
    'adjustment'::public.inventory_transaction_type,
    event_reservation.business_scrap_quantity,
    event_reservation.business_scrap_secondary_quantity,
    event.machine_id,
    event_reservation.request_item_table,
    event_reservation.request_item_id,
    p_performed_by,
    'Откат замены сводного остатка индивидуальными остатками карты раскроя'
  from public.long_stock_cutting_fact_bars fact_bar
  join public.production_fact_cutting_events event on event.id = fact_bar.event_id
  join public.production_fact_cutting_event_reservations event_reservation
    on event_reservation.event_id = fact_bar.event_id
   and event_reservation.reservation_id = fact_bar.reservation_id
  join public.inventory aggregate_scrap
    on aggregate_scrap.id = event_reservation.business_scrap_inventory_id
  where fact_bar.event_id = any(p_event_ids)
    and fact_bar.rolled_back_at is null
    and not exists (
      select 1
      from public.long_stock_cutting_business_scraps plan_scrap
      where plan_scrap.inventory_id = aggregate_scrap.id
    );

  insert into public.inventory_transactions(
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  select
    result_inventory.factory_id,
    result_inventory.id,
    result_inventory.material_id,
    result_inventory.material_variant_id,
    'adjustment'::public.inventory_transaction_type,
    -result_inventory.total_quantity,
    case
      when result_inventory.total_secondary_quantity is null then null
      else -result_inventory.total_secondary_quantity
    end,
    event.machine_id,
    event_reservation.request_item_table,
    event_reservation.request_item_id,
    p_performed_by,
    'Возврат индивидуального остатка карты в будущее состояние при откате'
  from public.long_stock_cutting_fact_bars fact_bar
  join public.production_fact_cutting_events event on event.id = fact_bar.event_id
  join public.production_fact_cutting_event_reservations event_reservation
    on event_reservation.event_id = fact_bar.event_id
   and event_reservation.reservation_id = fact_bar.reservation_id
  join public.inventory result_inventory on result_inventory.id = fact_bar.result_inventory_id
  where fact_bar.event_id = any(p_event_ids)
    and fact_bar.rolled_back_at is null
    and (
      event_reservation.business_scrap_inventory_id is null
      or event_reservation.business_scrap_inventory_id is distinct from fact_bar.result_inventory_id
    );

  with aggregate_snapshot as (
    select distinct on (aggregate_scrap.id)
      aggregate_scrap.id,
      event_reservation.business_scrap_quantity as total_quantity,
      event_reservation.business_scrap_secondary_quantity as total_secondary_quantity
    from public.long_stock_cutting_fact_bars fact_bar
    join public.production_fact_cutting_event_reservations event_reservation
      on event_reservation.event_id = fact_bar.event_id
     and event_reservation.reservation_id = fact_bar.reservation_id
    join public.inventory aggregate_scrap
      on aggregate_scrap.id = event_reservation.business_scrap_inventory_id
    where fact_bar.event_id = any(p_event_ids)
      and fact_bar.rolled_back_at is null
      and not exists (
        select 1
        from public.long_stock_cutting_business_scraps plan_scrap
        where plan_scrap.inventory_id = aggregate_scrap.id
      )
    order by aggregate_scrap.id, fact_bar.recorded_at
  )
  update public.inventory aggregate_scrap
  set total_quantity = aggregate_snapshot.total_quantity,
      reserved_quantity = 0,
      total_secondary_quantity = coalesce(aggregate_snapshot.total_secondary_quantity, 1),
      reserved_secondary_quantity = 0,
      business_scrap_state = 'future',
      deleted_at = null,
      deleted_by = null,
      delete_comment = null,
      last_updated_by = p_performed_by,
      updated_at = now()
  from aggregate_snapshot
  where aggregate_scrap.id = aggregate_snapshot.id;

  get diagnostics v_restored_aggregate_scraps = row_count;

  perform set_config('app.long_stock_cutting_fact_rollback', '1', true);
  delete from public.long_stock_cutting_actual_losses loss
  where exists (
    select 1
    from public.long_stock_cutting_fact_bars fact_bar
    where fact_bar.event_id = any(p_event_ids)
      and fact_bar.rolled_back_at is null
      and fact_bar.bar_id = loss.bar_id
  );
  perform set_config('app.long_stock_cutting_fact_rollback', '', true);

  perform set_config('app.long_stock_cutting_bar_fact', '1', true);
  update public.long_stock_cutting_candidate_bars bar
  set status = 'planned',
      cut_by = null,
      cut_at = null,
      cancelled_by = null,
      cancelled_at = null
  where bar.status = 'cut'
    and exists (
      select 1
      from public.long_stock_cutting_fact_bars fact_bar
      where fact_bar.event_id = any(p_event_ids)
        and fact_bar.rolled_back_at is null
        and fact_bar.bar_id = bar.id
    );
  get diagnostics v_reopened_bars = row_count;
  perform set_config('app.long_stock_cutting_bar_fact', '', true);

  perform set_config('app.long_stock_cutting_plan_closure', '1', true);
  update public.long_stock_cutting_plans plan
  set status = 'open',
      closed_at = null,
      closed_by = null
  where plan.status = 'closed'
    and exists (
      select 1
      from public.long_stock_cutting_fact_bars fact_bar
      join public.long_stock_cutting_plan_versions version
        on version.id = fact_bar.version_id
      where fact_bar.event_id = any(p_event_ids)
        and fact_bar.rolled_back_at is null
        and version.plan_id = plan.id
    );
  get diagnostics v_reopened_plans = row_count;
  perform set_config('app.long_stock_cutting_plan_closure', '', true);

  update public.long_stock_cutting_fact_bars
  set rolled_back_by = p_performed_by,
      rolled_back_at = now()
  where event_id = any(p_event_ids)
    and rolled_back_at is null;

  return jsonb_build_object(
    'reopenedBars', v_reopened_bars,
    'reopenedPlans', v_reopened_plans,
    'restoredAggregateScraps', v_restored_aggregate_scraps
  );
end;
$$;

revoke all on function public.fn_rollback_long_stock_cutting_fact_v1(uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.fn_rollback_long_stock_cutting_fact_v1(uuid[], uuid)
  to service_role;

alter function public.fn_get_production_cutting_rollback_preview(uuid)
  rename to fn_cutting_rollback_preview_before_long_stock_fact;

revoke all on function public.fn_cutting_rollback_preview_before_long_stock_fact(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_get_production_cutting_rollback_preview(
  p_machine_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_preview jsonb;
  v_expected_deleted integer := 0;
  v_remaining_deleted integer := 0;
  v_blockers jsonb;
begin
  v_preview := public.fn_cutting_rollback_preview_before_long_stock_fact(
    p_machine_id
  );

  select count(distinct aggregate_scrap.id)::integer
  into v_expected_deleted
  from public.long_stock_cutting_fact_bars fact_bar
  join public.production_fact_cutting_events event on event.id = fact_bar.event_id
  join public.production_fact_cutting_event_reservations event_reservation
    on event_reservation.event_id = fact_bar.event_id
   and event_reservation.reservation_id = fact_bar.reservation_id
  join public.inventory aggregate_scrap
    on aggregate_scrap.id = event_reservation.business_scrap_inventory_id
  where event.machine_id = p_machine_id
    and event.status = 'applied'
    and fact_bar.rolled_back_at is null
    and aggregate_scrap.deleted_at is not null
    and not exists (
      select 1
      from public.long_stock_cutting_business_scraps plan_scrap
      where plan_scrap.inventory_id = aggregate_scrap.id
    );

  v_remaining_deleted := greatest(
    coalesce((v_preview#>>'{scrap,deletedCount}')::integer, 0) - v_expected_deleted,
    0
  );

  select coalesce(jsonb_agg(blocker.value), '[]'::jsonb)
  into v_blockers
  from jsonb_array_elements_text(coalesce(v_preview->'blockers', '[]'::jsonb)) blocker(value)
  where blocker.value <> 'Деловой отход уже удален со склада'
     or v_remaining_deleted > 0;

  v_preview := jsonb_set(v_preview, '{blockers}', v_blockers, true);
  v_preview := jsonb_set(
    v_preview,
    '{canRollback}',
    to_jsonb(jsonb_array_length(v_blockers) = 0),
    true
  );
  v_preview := jsonb_set(
    v_preview,
    '{scrap,deletedCount}',
    to_jsonb(v_remaining_deleted),
    true
  );
  return v_preview;
end;
$$;

revoke all on function public.fn_get_production_cutting_rollback_preview(uuid)
  from public, anon;
grant execute on function public.fn_get_production_cutting_rollback_preview(uuid)
  to authenticated, service_role;

alter function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  rename to fn_apply_production_cutting_rollback_before_long_stock_fact;

revoke all on function public.fn_apply_production_cutting_rollback_before_long_stock_fact(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.fn_apply_production_cutting_rollback(
  p_machine_id uuid,
  p_task_id uuid,
  p_performed_by uuid,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_ids uuid[];
  v_result jsonb;
  v_long_stock_result jsonb;
begin
  select coalesce(array_agg(event.id order by event.created_at), '{}'::uuid[])
  into v_event_ids
  from public.production_fact_cutting_events event
  where event.machine_id = p_machine_id
    and event.status = 'applied';

  v_result := public.fn_apply_production_cutting_rollback_before_long_stock_fact(
    p_machine_id,
    p_task_id,
    p_performed_by,
    p_comment
  );
  v_long_stock_result := public.fn_rollback_long_stock_cutting_fact_v1(
    v_event_ids,
    p_performed_by
  );
  return v_result || jsonb_build_object('longStock', v_long_stock_result);
end;
$$;

revoke all on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  from public, anon;
grant execute on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  to authenticated, service_role;

comment on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid) is
  'Matches reserved physical bars to approved plan bars by exact length then bar order and atomically closes them with their calculated scraps and losses.';

notify pgrst, 'reload schema';
