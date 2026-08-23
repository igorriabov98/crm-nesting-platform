-- Bind measured long-stock reservations to the exact physical composition of
-- the approved cutting map. Browser roles cannot invoke reservation RPCs
-- directly; application actions cross the service-role boundary after access
-- checks.

create or replace function public.fn_request_item_is_measured_long_stock_v1(
  p_request_item_table text,
  p_request_item_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_pipe_type public.pipe_subtype;
begin
  if p_request_item_table in ('request_knives', 'request_circle') then
    return exists (
      select 1
      from (
        select id from public.request_knives
        where p_request_item_table = 'request_knives' and id = p_request_item_id
        union all
        select id from public.request_circle
        where p_request_item_table = 'request_circle' and id = p_request_item_id
      ) request_item
    );
  end if;

  if p_request_item_table = 'request_pipe' then
    select pipe_type
    into v_pipe_type
    from public.request_pipe
    where id = p_request_item_id;
    return found and v_pipe_type is distinct from 'wire'::public.pipe_subtype;
  end if;

  return false;
end;
$$;

alter function public.fn_reserve_whole_bar_inventory_row_for_machine(
  uuid, uuid, numeric, text, uuid, uuid
) rename to fn_reserve_whole_bar_inventory_row_before_plan_integrity_v1;

alter function public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
  uuid, uuid, numeric, text, uuid, uuid
) rename to fn_reserve_whole_bar_row_transfer_pre_plan_v1;

-- Reserve every still-uncovered new-stock bar of the selected approved
-- candidate. A selected inventory row is an exact, user-visible anchor for
-- the source factory; every required length is then resolved independently.
create function public.fn_reserve_long_stock_plan_inventory_v1(
  p_anchor_inventory_id uuid,
  p_machine_id uuid,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_use_inventory_transfer boolean
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anchor public.inventory%rowtype;
  v_machine_factory_id uuid;
  v_version_id uuid;
  v_candidate_id uuid;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_required record;
  v_inventory public.inventory%rowtype;
  v_existing_piece_count integer;
  v_remaining_piece_count integer;
  v_remaining_logical_quantity numeric;
  v_physical_quantity numeric;
  v_reservation_id uuid;
  v_first_reservation_id uuid;
begin
  if not public.fn_request_item_is_measured_long_stock_v1(
    p_request_item_table,
    p_request_item_id
  ) then
    raise exception 'Позиция заявки не относится к мерному длинномеру';
  end if;

  perform public.fn_lock_production_cutting_machine_v1(p_machine_id);

  select factory_id
  into v_machine_factory_id
  from public.machines
  where id = p_machine_id;
  if v_machine_factory_id is null then
    raise exception 'Для машины не определён завод';
  end if;

  select *
  into v_anchor
  from public.inventory
  where id = p_anchor_inventory_id
    and deleted_at is null
  for update;
  if not found then
    raise exception 'Выбранный складской остаток не найден';
  end if;
  if v_anchor.is_business_scrap then
    raise exception 'Закупаемые хлысты резервируются только из обычного склада; деловой остаток выбирается в карте раскроя';
  end if;
  if v_anchor.business_scrap_state = 'future' then
    raise exception 'Будущий деловой остаток ещё недоступен';
  end if;
  if coalesce(v_anchor.piece_length_mm, 0) <= 0 then
    raise exception 'Выбранная складская строка не является мерным хлыстом';
  end if;

  if p_use_inventory_transfer then
    perform public.inventory_transfer_assert_actor(
      p_reserved_by,
      array[
        'technologist', 'supply_manager', 'procurement_head',
        'planning_director', 'financial_director', 'commercial_director'
      ]::public.user_role[]
    );
    if v_anchor.factory_id is not distinct from v_machine_factory_id then
      raise exception 'Для склада завода машины используйте обычное бронирование';
    end if;
  elsif v_anchor.factory_id is distinct from v_machine_factory_id then
    raise exception 'Выбранный складской остаток относится к другому заводу';
  end if;

  -- Lock the item first: two users cannot calculate the same missing
  -- composition and reserve it twice.
  perform 1
  from public.long_stock_cutting_plan_items item
  where item.request_item_table = p_request_item_table
    and item.request_item_id = p_request_item_id
  order by item.linked_at desc, item.id desc
  limit 1
  for update;

  select
    version.id,
    candidate.id,
    variant.material_id,
    plan.material_variant_id
  into
    v_version_id,
    v_candidate_id,
    v_material_id,
    v_material_variant_id
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
  join public.material_variants variant
    on variant.id = plan.material_variant_id
  join public.technologist_requests request
    on request.id = item.request_id
   and request.machine_id = p_machine_id
  where item.request_item_table = p_request_item_table
    and item.request_item_id = p_request_item_id
  order by version.approved_at desc, version.id desc
  limit 1;

  if v_version_id is null then
    raise exception 'Для позиции нет действующей утверждённой карты раскроя';
  end if;
  if v_anchor.material_id is distinct from v_material_id
    or v_anchor.material_variant_id is distinct from v_material_variant_id then
    raise exception 'Складская строка не соответствует варианту материала утверждённой карты';
  end if;
  if not exists (
    select 1
    from public.long_stock_cutting_candidate_bars bar
    where bar.candidate_id = v_candidate_id
      and bar.status = 'planned'
      and bar.source_type = 'new_stock'
      and bar.stock_length_mm = v_anchor.piece_length_mm
  ) then
    raise exception
      'Длина выбранной складской строки % мм отсутствует в закупочном составе утверждённой карты',
      v_anchor.piece_length_mm;
  end if;

  -- Existing regular-stock reservations may have been created before this
  -- migration or by receipt/transfer. Reject any physical composition that
  -- cannot be put in a one-to-one correspondence with the selected bars.
  if exists (
    with expected as (
      select bar.stock_length_mm, count(*)::integer as piece_count
      from public.long_stock_cutting_candidate_bars bar
      where bar.candidate_id = v_candidate_id
        and bar.status = 'planned'
        and bar.source_type = 'new_stock'
      group by bar.stock_length_mm
    ), actual as (
      select
        coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm) as stock_length_mm,
        sum(greatest(
          floor(coalesce(reservation.reserved_secondary_quantity, 0)),
          floor(
            reservation.reserved_quantity
            / nullif(coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm), 0)
          )
        ))::integer as piece_count
      from public.inventory_reservations reservation
      join public.inventory inventory on inventory.id = reservation.inventory_id
      where reservation.request_item_table = p_request_item_table
        and reservation.request_item_id = p_request_item_id
        and reservation.machine_id = p_machine_id
        and reservation.consumed_at is null
        and reservation.is_cut_reservation = false
        and not inventory.is_business_scrap
        and reservation.material_variant_id is not distinct from v_material_variant_id
        and coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm, 0) > 0
      group by coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm)
    )
    select 1
    from actual
    left join expected using (stock_length_mm)
    where expected.stock_length_mm is null
      or actual.piece_count > expected.piece_count
  ) then
    raise exception 'Существующая бронь хлыстов не соответствует длинам и количеству утверждённой карты';
  end if;

  select reservation.id
  into v_first_reservation_id
  from public.inventory_reservations reservation
  join public.inventory inventory on inventory.id = reservation.inventory_id
  where reservation.request_item_table = p_request_item_table
    and reservation.request_item_id = p_request_item_id
    and reservation.machine_id = p_machine_id
    and reservation.consumed_at is null
    and reservation.is_cut_reservation = false
    and not inventory.is_business_scrap
    and reservation.material_variant_id is not distinct from v_material_variant_id
  order by reservation.created_at, reservation.id
  limit 1;

  for v_required in
    with bar_usage as (
      select
        bar.id,
        bar.bar_number,
        bar.stock_length_mm,
        coalesce(sum(cut.cut_length_mm), 0) as logical_quantity,
        row_number() over (
          partition by bar.stock_length_mm
          order by bar.bar_number, bar.id
        ) as length_rank
      from public.long_stock_cutting_candidate_bars bar
      left join public.long_stock_cutting_bar_cuts cut on cut.bar_id = bar.id
      where bar.candidate_id = v_candidate_id
        and bar.status = 'planned'
        and bar.source_type = 'new_stock'
      group by bar.id, bar.bar_number, bar.stock_length_mm
    )
    select
      stock_length_mm,
      count(*)::integer as piece_count
    from bar_usage
    group by stock_length_mm
    order by stock_length_mm, min(bar_number)
  loop
    select coalesce(sum(greatest(
      floor(coalesce(reservation.reserved_secondary_quantity, 0)),
      floor(
        reservation.reserved_quantity
        / nullif(coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm), 0)
      )
    )), 0)::integer
    into v_existing_piece_count
    from public.inventory_reservations reservation
    join public.inventory inventory on inventory.id = reservation.inventory_id
    where reservation.request_item_table = p_request_item_table
      and reservation.request_item_id = p_request_item_id
      and reservation.machine_id = p_machine_id
      and reservation.consumed_at is null
      and reservation.is_cut_reservation = false
      and not inventory.is_business_scrap
      and reservation.material_variant_id is not distinct from v_material_variant_id
      and coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm)
        = v_required.stock_length_mm;

    v_remaining_piece_count := v_required.piece_count - v_existing_piece_count;
    if v_remaining_piece_count <= 0 then
      continue;
    end if;

    with ranked_bar_usage as (
      select
        bar.id,
        bar.bar_number,
        coalesce(sum(cut.cut_length_mm), 0) as logical_quantity,
        row_number() over (order by bar.bar_number, bar.id) as length_rank
      from public.long_stock_cutting_candidate_bars bar
      left join public.long_stock_cutting_bar_cuts cut on cut.bar_id = bar.id
      where bar.candidate_id = v_candidate_id
        and bar.status = 'planned'
        and bar.source_type = 'new_stock'
        and bar.stock_length_mm = v_required.stock_length_mm
      group by bar.id, bar.bar_number
    )
    select coalesce(sum(logical_quantity), 0)
    into v_remaining_logical_quantity
    from ranked_bar_usage
    where length_rank > v_existing_piece_count;

    select *
    into v_inventory
    from public.inventory
    where factory_id = v_anchor.factory_id
      and material_id = v_material_id
      and material_variant_id = v_material_variant_id
      and piece_length_mm = v_required.stock_length_mm
      and not is_business_scrap
      and business_scrap_state is distinct from 'future'
      and deleted_at is null
    for update;
    if not found then
      raise exception
        'На выбранном заводе нет обычной складской строки длиной % мм из утверждённой карты',
        v_required.stock_length_mm;
    end if;

    v_physical_quantity := v_required.stock_length_mm * v_remaining_piece_count;
    if floor(coalesce(v_inventory.available_secondary_quantity, 0)) < v_remaining_piece_count
      or v_inventory.available_quantity < v_physical_quantity then
      raise exception
        'Недостаточно хлыстов % мм по утверждённой карте: нужно % шт, доступно % шт',
        v_required.stock_length_mm,
        v_remaining_piece_count,
        floor(coalesce(v_inventory.available_secondary_quantity, 0));
    end if;

    insert into public.inventory_reservations(
      inventory_id, source_inventory_id, material_id, material_variant_id,
      machine_id, request_item_table, request_item_id,
      reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity,
      reserved_by, original_piece_length_mm, is_cut_reservation, reservation_source
    ) values (
      v_inventory.id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
      p_machine_id, p_request_item_table, p_request_item_id,
      v_physical_quantity, v_remaining_logical_quantity, v_remaining_piece_count,
      p_reserved_by, v_inventory.piece_length_mm, false, 'whole_bar_stock'
    ) returning id into v_reservation_id;
    v_first_reservation_id := coalesce(v_first_reservation_id, v_reservation_id);

    update public.inventory
    set reserved_quantity = reserved_quantity + v_physical_quantity,
        reserved_secondary_quantity = coalesce(reserved_secondary_quantity, 0)
          + v_remaining_piece_count,
        last_updated_by = p_reserved_by,
        updated_at = now()
    where id = v_inventory.id;

    if p_use_inventory_transfer then
      perform public.inventory_attach_reservation_to_transfer(
        v_reservation_id,
        v_machine_factory_id,
        p_reserved_by
      );
      update public.inventory_transfer_items
      set logical_requested_quantity = v_remaining_logical_quantity,
          logical_received_quantity = 0
      where id = (
        select reservation.inventory_transfer_item_id
        from public.inventory_reservations reservation
        where reservation.id = v_reservation_id
      );
    end if;

    insert into public.inventory_transactions(
      factory_id, inventory_id, material_id, material_variant_id, transaction_type,
      quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
      performed_by, comment
    ) values (
      v_inventory.factory_id,
      v_inventory.id,
      v_inventory.material_id,
      v_inventory.material_variant_id,
      'reserve',
      -v_physical_quantity,
      -v_remaining_piece_count,
      p_machine_id,
      p_request_item_table,
      p_request_item_id,
      p_reserved_by,
      case when p_use_inventory_transfer
        then 'Бронирование точного состава хлыстов по карте для межзаводской перевозки'
        else 'Бронирование точного состава хлыстов по утверждённой карте раскроя'
      end
    );
  end loop;

  if v_first_reservation_id is null then
    raise exception 'В утверждённой карте нет закупаемых хлыстов для резервирования';
  end if;

  perform public.fn_set_request_reserved_quantity(
    p_request_item_table,
    p_request_item_id
  );
  return v_first_reservation_id;
end;
$$;

create function public.fn_reserve_whole_bar_inventory_row_for_machine(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_logical_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan
      on plan.id = item.plan_id and plan.status = 'open'
    join public.long_stock_cutting_plan_versions version
      on version.plan_id = plan.id and version.status = 'approved'
    where item.request_item_table = p_request_item_table
      and item.request_item_id = p_request_item_id
  ) then
    return public.fn_reserve_long_stock_plan_inventory_v1(
      p_inventory_id,
      p_machine_id,
      p_request_item_table,
      p_request_item_id,
      p_reserved_by,
      false
    );
  end if;

  return public.fn_reserve_whole_bar_inventory_row_before_plan_integrity_v1(
    p_inventory_id,
    p_machine_id,
    p_logical_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by
  );
end;
$$;

create function public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_logical_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan
      on plan.id = item.plan_id and plan.status = 'open'
    join public.long_stock_cutting_plan_versions version
      on version.plan_id = plan.id and version.status = 'approved'
    where item.request_item_table = p_request_item_table
      and item.request_item_id = p_request_item_id
  ) then
    return public.fn_reserve_long_stock_plan_inventory_v1(
      p_inventory_id,
      p_machine_id,
      p_request_item_table,
      p_request_item_id,
      p_reserved_by,
      true
    );
  end if;

  return public.fn_reserve_whole_bar_row_transfer_pre_plan_v1(
    p_inventory_id,
    p_machine_id,
    p_logical_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by
  );
end;
$$;

-- Material-only reservation must use the actual request row to decide whether
-- it is long stock. Client-supplied null length/variant values cannot downgrade
-- a knife, circle or non-wire pipe to the generic quantitative path.
create or replace function public.fn_reserve_inventory_for_machine(
  p_material_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric default null,
  p_material_variant_id uuid default null,
  p_piece_length_mm numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.fn_request_item_is_measured_long_stock_v1(
    p_request_item_table,
    p_request_item_id
  ) then
    raise exception
      'Мерный длинномер резервируется только из конкретной складской строки по карте раскроя';
  end if;

  return public.fn_reserve_inventory_for_machine_before_long_stock_map_v1(
    p_material_id,
    p_machine_id,
    p_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by,
    p_secondary_quantity,
    p_material_variant_id,
    p_piece_length_mm
  );
end;
$$;

create or replace function public.fn_reserve_inventory_row_for_machine(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric default null,
  p_is_cut_reservation boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.fn_request_item_is_measured_long_stock_v1(
    p_request_item_table,
    p_request_item_id
  ) then
    return public.fn_reserve_whole_bar_inventory_row_for_machine(
      p_inventory_id,
      p_machine_id,
      p_quantity,
      p_request_item_table,
      p_request_item_id,
      p_reserved_by
    );
  end if;

  return public.fn_reserve_inventory_row_for_machine_before_long_stock_map_v1(
    p_inventory_id,
    p_machine_id,
    p_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by,
    p_secondary_quantity,
    p_is_cut_reservation
  );
end;
$$;

create or replace function public.fn_reserve_inventory_row_for_machine_transfer(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric default null,
  p_is_cut_reservation boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.fn_request_item_is_measured_long_stock_v1(
    p_request_item_table,
    p_request_item_id
  ) then
    return public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
      p_inventory_id,
      p_machine_id,
      p_quantity,
      p_request_item_table,
      p_request_item_id,
      p_reserved_by
    );
  end if;

  return public.fn_reserve_inventory_row_transfer_pre_map_v1(
    p_inventory_id,
    p_machine_id,
    p_quantity,
    p_request_item_table,
    p_request_item_id,
    p_reserved_by,
    p_secondary_quantity,
    p_is_cut_reservation
  );
end;
$$;

-- The legacy event is applied in the same transaction as long-stock matching.
-- Raise after matching when the event reservations cannot cover the selected
-- bars one-to-one; PostgreSQL then rolls the legacy consumption back as well.
alter function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  rename to fn_apply_long_stock_fact_pre_reservation_guard_v1;

create function public.fn_apply_long_stock_cutting_fact_v1(
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
  v_expected_piece_count integer;
  v_event_piece_count integer;
  v_result jsonb;
  v_matched_piece_count integer;
begin
  select *
  into v_event
  from public.production_fact_cutting_events
  where id = p_event_id
  for update;
  if not found then
    raise exception 'Событие факта заготовки не найдено';
  end if;

  with active_plan_items as (
    select distinct on (item.request_item_table, item.request_item_id)
      item.request_item_table,
      item.request_item_id,
      plan.material_variant_id,
      candidate.id as candidate_id
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan
      on plan.id = item.plan_id and plan.status = 'open'
    join public.long_stock_cutting_plan_versions version
      on version.plan_id = plan.id and version.status = 'approved'
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
  )
  select count(*)::integer
  into v_expected_piece_count
  from active_plan_items plan_item
  join public.long_stock_cutting_candidate_bars bar
    on bar.candidate_id = plan_item.candidate_id
   and bar.status = 'planned';

  with active_plan_items as (
    select distinct on (item.request_item_table, item.request_item_id)
      item.request_item_table,
      item.request_item_id,
      plan.material_variant_id
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan
      on plan.id = item.plan_id and plan.status = 'open'
    join public.long_stock_cutting_plan_versions version
      on version.plan_id = plan.id and version.status = 'approved'
    join public.technologist_requests request
      on request.id = item.request_id
     and request.machine_id = v_event.machine_id
    order by
      item.request_item_table,
      item.request_item_id,
      version.approved_at desc,
      version.id desc
  )
  select coalesce(sum(greatest(
    floor(coalesce(event_reservation.reserved_secondary_quantity, reservation.reserved_secondary_quantity, 0)),
    floor(
      event_reservation.reserved_quantity
      / nullif(coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm), 0)
    )
  )), 0)::integer
  into v_event_piece_count
  from public.production_fact_cutting_event_reservations event_reservation
  join public.inventory_reservations reservation
    on reservation.id = event_reservation.reservation_id
  join public.inventory inventory
    on inventory.id = event_reservation.inventory_id
  join active_plan_items plan_item
    on plan_item.request_item_table = event_reservation.request_item_table
   and plan_item.request_item_id = event_reservation.request_item_id
   and plan_item.material_variant_id is not distinct from event_reservation.material_variant_id
  where event_reservation.event_id = v_event.id
    and event_reservation.is_cut_reservation = false
    and coalesce(reservation.original_piece_length_mm, inventory.piece_length_mm, 0) > 0;

  v_result := public.fn_apply_long_stock_fact_pre_reservation_guard_v1(
    p_event_id,
    p_performed_by
  );
  v_matched_piece_count := coalesce((v_result->>'matched_bars')::integer, 0);

  if v_expected_piece_count > 0
    and (
      v_event_piece_count <= 0
      or v_matched_piece_count is distinct from v_event_piece_count
    ) then
    raise exception
      'Факт заготовки не соответствует утверждённой карте: осталось % хлыстов, в событии %, сопоставлено %',
      v_expected_piece_count,
      v_event_piece_count,
      v_matched_piece_count;
  end if;

  return v_result;
end;
$$;

-- Close every current and retained overload participating in reservation.
do $$
declare
  v_function record;
begin
  for v_function in
    select procedure.proname,
           pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'fn_request_item_is_measured_long_stock_v1',
        'fn_reserve_long_stock_plan_inventory_v1',
        'fn_reserve_inventory_for_machine',
        'fn_reserve_inventory_for_machine_before_long_stock_map_v1',
        'fn_reserve_inventory_row_for_machine',
        'fn_reserve_inventory_row_for_machine_before_long_stock_map_v1',
        'fn_reserve_inventory_row_for_machine_transfer',
        'fn_reserve_inventory_row_transfer_pre_map_v1',
        'fn_reserve_whole_bar_inventory_row_for_machine',
        'fn_reserve_whole_bar_inventory_row_before_plan_integrity_v1',
        'fn_reserve_whole_bar_inventory_row_for_machine_transfer',
        'fn_reserve_whole_bar_row_transfer_pre_plan_v1',
        'fn_apply_long_stock_cutting_fact_v1',
        'fn_apply_long_stock_fact_pre_reservation_guard_v1'
      ])
  loop
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      v_function.proname,
      v_function.identity_arguments
    );
  end loop;
end;
$$;

-- Retained implementations are callable only by their SECURITY DEFINER
-- wrappers (the function owner), never as alternate service-role RPCs.
revoke all on function public.fn_reserve_inventory_for_machine_before_long_stock_map_v1(
  uuid, uuid, numeric, text, uuid, uuid, numeric, uuid, numeric
) from service_role;
revoke all on function public.fn_reserve_inventory_row_for_machine_before_long_stock_map_v1(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) from service_role;
revoke all on function public.fn_reserve_inventory_row_transfer_pre_map_v1(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) from service_role;
revoke all on function public.fn_reserve_whole_bar_inventory_row_before_plan_integrity_v1(
  uuid, uuid, numeric, text, uuid, uuid
) from service_role;
revoke all on function public.fn_reserve_whole_bar_row_transfer_pre_plan_v1(
  uuid, uuid, numeric, text, uuid, uuid
) from service_role;
revoke all on function public.fn_apply_long_stock_fact_pre_reservation_guard_v1(uuid, uuid)
  from service_role;

grant execute on function public.fn_reserve_inventory_for_machine(
  uuid, uuid, numeric, text, uuid, uuid, numeric, uuid, numeric
) to service_role;
grant execute on function public.fn_reserve_inventory_row_for_machine(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) to service_role;
grant execute on function public.fn_reserve_inventory_row_for_machine_transfer(
  uuid, uuid, numeric, text, uuid, uuid, numeric, boolean
) to service_role;
grant execute on function public.fn_reserve_whole_bar_inventory_row_for_machine(
  uuid, uuid, numeric, text, uuid, uuid
) to service_role;
grant execute on function public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
  uuid, uuid, numeric, text, uuid, uuid
) to service_role;
grant execute on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
