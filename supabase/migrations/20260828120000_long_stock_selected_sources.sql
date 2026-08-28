-- Make exact warehouse bars and future plan remnants first-class inputs of a
-- long-stock cutting map. Draft calculation remains read-only; all physical
-- effects are created by the protected approval transaction below.

alter table public.long_stock_cutting_candidate_bars
  drop constraint if exists long_stock_cutting_bar_source_check;

alter table public.long_stock_cutting_candidate_bars
  add constraint long_stock_cutting_bar_source_check check (
    (
      source_type = 'new_stock'
      and source_inventory_id is null
      and length_group in ('standard', 'nonstandard')
    )
    or (
      source_type in (
        'warehouse_stock',
        'business_remnant',
        'future_business_remnant'
      )
      and source_inventory_id is not null
      and length_group is null
    )
  );

-- One inventory row may aggregate several equal physical bars. Capacity is
-- checked while the row is locked at approval, not by identifier uniqueness.
drop index if exists public.long_stock_cutting_candidate_source_inventory_idx;

create table public.long_stock_cutting_source_dependencies (
  id uuid primary key default gen_random_uuid(),
  consumer_version_id uuid not null
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  consumer_bar_id uuid not null,
  source_inventory_id uuid not null
    references public.inventory(id) on delete restrict,
  producer_version_id uuid not null
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  producer_bar_id uuid not null,
  reservation_id uuid
    references public.inventory_reservations(id) on delete set null,
  transfer_item_id uuid
    references public.inventory_transfer_items(id) on delete restrict,
  producer_cutting_date date not null,
  consumer_cutting_date date not null,
  status text not null default 'waiting_for_source'
    check (status in (
      'waiting_for_source', 'ready_for_transfer', 'ready', 'fulfilled', 'invalidated'
    )),
  invalidation_reason text,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  invalidated_at timestamptz,
  foreign key (consumer_version_id, consumer_bar_id)
    references public.long_stock_cutting_candidate_bars(version_id, id) on delete restrict,
  foreign key (producer_version_id, producer_bar_id)
    references public.long_stock_cutting_candidate_bars(version_id, id) on delete restrict,
  unique (consumer_bar_id),
  unique (reservation_id),
  check (producer_cutting_date < consumer_cutting_date),
  check ((status = 'fulfilled') = (fulfilled_at is not null)),
  check ((status = 'invalidated') = (invalidated_at is not null))
);

create index long_stock_source_dependencies_producer_idx
  on public.long_stock_cutting_source_dependencies(producer_version_id, status);
create index long_stock_source_dependencies_inventory_idx
  on public.long_stock_cutting_source_dependencies(source_inventory_id, status);

alter table public.long_stock_cutting_source_dependencies enable row level security;
revoke all on table public.long_stock_cutting_source_dependencies
  from public, anon, authenticated;
grant select, insert, update on table public.long_stock_cutting_source_dependencies
  to service_role;

alter table public.long_stock_cutting_plan_versions
  add column invalidation_dependency_id uuid
    references public.long_stock_cutting_source_dependencies(id) on delete restrict;

alter table public.long_stock_cutting_plan_versions
  drop constraint if exists long_stock_cutting_plan_versions_invalidation_check;
alter table public.long_stock_cutting_plan_versions
  add constraint long_stock_cutting_plan_versions_invalidation_check
  check (
    status <> 'invalid'
    or (
      btrim(coalesce(invalidation_reason, '')) <> ''
      and invalidated_by is not null
      and invalidated_at is not null
      and num_nonnulls(
        invalidation_receipt_schedule_id,
        invalidation_inventory_transfer_id,
        invalidation_department_request_id,
        invalidation_dependency_id
      ) = 1
    )
  );

-- The generic reservation guard stays strict. Only this approval transaction
-- may reserve a future plan remnant under the producer-before-consumer rule.
create or replace function public.fn_block_supply_bar_future_scrap_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.long_stock_source_selection', true) = '1' then
    return new;
  end if;

  if exists (
    select 1
    from public.inventory as future_scrap
    left join public.inventory_reservations as source_reservation
      on source_reservation.id = future_scrap.source_reservation_id
    where future_scrap.id = new.inventory_id
      and future_scrap.is_business_scrap = true
      and future_scrap.business_scrap_state = 'future'
      and future_scrap.deleted_at is null
  ) then
    raise exception 'Будущий остаток станет доступен только после исходного факта Заготовки';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_block_supply_bar_future_scrap_reservation()
  from public, anon, authenticated;

create or replace function public.fn_reserve_long_stock_selected_sources_v1(
  p_version_id uuid,
  p_actor uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.long_stock_cutting_plan_versions%rowtype;
  v_plan public.long_stock_cutting_plans%rowtype;
  v_candidate public.long_stock_cutting_candidates%rowtype;
  v_plan_item public.long_stock_cutting_plan_items%rowtype;
  v_machine_id uuid;
  v_factory_id uuid;
  v_material_id uuid;
  v_consumer_cutting_date date;
  v_bar record;
  v_source public.inventory%rowtype;
  v_reservation_id uuid;
  v_transfer_item_id uuid;
  v_logical_quantity numeric;
  v_producer_version_id uuid;
  v_producer_bar_id uuid;
  v_producer_status text;
  v_reserved_count integer := 0;
begin
  select * into v_version
  from public.long_stock_cutting_plan_versions
  where id = p_version_id
  for update;
  if not found then raise exception 'Версия карты раскроя не найдена'; end if;
  if v_version.status = 'approved' then return 0; end if;
  if v_version.status <> 'draft' then
    raise exception 'Источники можно резервировать только для черновика версии';
  end if;

  select * into strict v_plan
  from public.long_stock_cutting_plans
  where id = v_version.plan_id
  for update;
  select * into strict v_candidate
  from public.long_stock_cutting_candidates
  where version_id = v_version.id
    and candidate_number = v_version.selected_candidate_number
  for update;
  select * into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan.id
  order by linked_at, id
  limit 1
  for update;

  select request.machine_id, machine.factory_id
  into v_machine_id, v_factory_id
  from public.technologist_requests request
  join public.machines machine on machine.id = request.machine_id
  where request.id = v_plan_item.request_id;
  if v_machine_id is null or v_factory_id is null then
    raise exception 'Для позиции не найдены машина и завод';
  end if;
  select material_id into strict v_material_id
  from public.material_variants
  where id = v_plan.material_variant_id;
  select stage.date_start
  into v_consumer_cutting_date
  from public.production_stages stage
  where stage.machine_id = v_machine_id
    and stage.stage_type = 'cutting'::public.stage_type
  order by stage.created_at, stage.id
  limit 1
  for update;

  perform set_config('app.long_stock_source_selection', '1', true);
  for v_bar in
    select bar.*
    from public.long_stock_cutting_candidate_bars bar
    where bar.candidate_id = v_candidate.id
      and bar.source_type in ('warehouse_stock', 'future_business_remnant')
    order by bar.source_inventory_id, bar.bar_number, bar.id
  loop
    select * into v_source
    from public.inventory
    where id = v_bar.source_inventory_id
    for update;
    if not found
      or v_source.deleted_at is not null
      or v_source.material_id is distinct from v_material_id
      or v_source.material_variant_id is distinct from v_plan.material_variant_id
      or v_source.piece_length_mm is distinct from v_bar.stock_length_mm then
      raise exception 'Хлыст №%: материал или фактическая длина источника изменились', v_bar.bar_number;
    end if;
    if v_source.available_quantity < v_bar.stock_length_mm
      or floor(coalesce(v_source.available_secondary_quantity, 0)) < 1 then
      raise exception 'Хлыст №%: выбранный источник уже занят другим технологом', v_bar.bar_number;
    end if;

    v_producer_version_id := null;
    v_producer_bar_id := null;
    v_producer_status := null;
    if v_bar.source_type = 'warehouse_stock' then
      if v_source.is_business_scrap or v_source.business_scrap_state = 'future' then
        raise exception 'Хлыст №%: источник больше не является обычным складом', v_bar.bar_number;
      end if;
    else
      if not v_source.is_business_scrap
        or v_source.business_scrap_state is distinct from 'future' then
        raise exception 'Хлыст №%: будущий деловой остаток изменил состояние', v_bar.bar_number;
      end if;
      select link.version_id, link.bar_id, producer.status
      into v_producer_version_id, v_producer_bar_id, v_producer_status
      from public.long_stock_cutting_business_scraps link
      join public.long_stock_cutting_plan_versions producer on producer.id = link.version_id
      where link.inventory_id = v_source.id;
      if v_producer_version_id is null or v_producer_status <> 'approved' then
        raise exception 'Хлыст №%: исходная раскладка будущего остатка недействительна', v_bar.bar_number;
      end if;
      if v_source.available_from_date is null or v_consumer_cutting_date is null then
        raise exception 'Хлыст №%: для зависимости не назначены обе даты порезки', v_bar.bar_number;
      end if;
      if v_source.available_from_date >= v_consumer_cutting_date then
        raise exception 'Хлыст №%: исходная порезка должна быть строго раньше порезки потребителя', v_bar.bar_number;
      end if;
    end if;

    select coalesce(sum(cut.cut_length_mm), 0)
      + count(*) * (v_version.settings_snapshot->>'kerf_mm')::numeric
      + (v_version.settings_snapshot->>'end_trim_mm')::numeric
    into v_logical_quantity
    from public.long_stock_cutting_bar_cuts cut
    where cut.bar_id = v_bar.id;
    if v_logical_quantity <= 0 or v_logical_quantity > v_bar.stock_length_mm then
      raise exception 'Хлыст №%: выбранный физический хлыст должен получить хотя бы один допустимый рез', v_bar.bar_number;
    end if;

    insert into public.inventory_reservations(
      inventory_id, source_inventory_id, material_id, material_variant_id,
      machine_id, request_item_table, request_item_id,
      reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity,
      reserved_by, original_piece_length_mm, is_cut_reservation, reservation_source
    ) values (
      v_source.id, v_source.id, v_source.material_id, v_source.material_variant_id,
      v_machine_id, v_plan_item.request_item_table, v_plan_item.request_item_id,
      v_bar.stock_length_mm, v_logical_quantity, 1,
      p_actor, v_bar.stock_length_mm, false, 'stock'
    ) returning id into v_reservation_id;

    update public.inventory
    set reserved_quantity = reserved_quantity + v_bar.stock_length_mm,
        reserved_secondary_quantity = coalesce(reserved_secondary_quantity, 0) + 1,
        last_updated_by = p_actor,
        updated_at = now()
    where id = v_source.id;

    insert into public.inventory_transactions(
      factory_id, inventory_id, material_id, material_variant_id,
      transaction_type, quantity, secondary_quantity,
      machine_id, request_item_table, request_item_id, performed_by, comment
    ) values (
      v_source.factory_id, v_source.id, v_source.material_id, v_source.material_variant_id,
      'reserve', -v_bar.stock_length_mm, -1,
      v_machine_id, v_plan_item.request_item_table, v_plan_item.request_item_id, p_actor,
      'Точный физический хлыст выбран в утверждаемой карте раскроя'
    );

    insert into public.long_stock_cutting_bar_reservations(version_id, bar_id, reservation_id)
    values (v_version.id, v_bar.id, v_reservation_id);

    v_transfer_item_id := null;
    if v_source.factory_id is distinct from v_factory_id then
      v_transfer_item_id := public.inventory_attach_reservation_to_transfer(
        v_reservation_id, v_factory_id, p_actor
      );
      update public.inventory_transfer_items
      set logical_requested_quantity = v_logical_quantity,
          logical_received_quantity = 0
      where id = v_transfer_item_id;
    end if;

    if v_bar.source_type = 'future_business_remnant' then
      insert into public.long_stock_cutting_source_dependencies(
        consumer_version_id, consumer_bar_id, source_inventory_id,
        producer_version_id, producer_bar_id, reservation_id, transfer_item_id,
        producer_cutting_date, consumer_cutting_date, status
      ) values (
        v_version.id, v_bar.id, v_source.id,
        v_producer_version_id, v_producer_bar_id, v_reservation_id, v_transfer_item_id,
        v_source.available_from_date, v_consumer_cutting_date, 'waiting_for_source'
      );
    end if;
    v_reserved_count := v_reserved_count + 1;
  end loop;
  perform set_config('app.long_stock_source_selection', '', true);
  return v_reserved_count;
end;
$$;

revoke all on function public.fn_reserve_long_stock_selected_sources_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_reserve_long_stock_selected_sources_v1(uuid, uuid)
  to service_role;

alter function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  rename to fn_approve_long_stock_cutting_plan_before_source_selection_v1;
revoke all on function public.fn_approve_long_stock_cutting_plan_before_source_selection_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_approve_long_stock_cutting_plan_version_core_v1(
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
  v_selected_candidate_number integer;
  v_missing_bar integer;
begin
  perform public.fn_reserve_long_stock_selected_sources_v1(p_version_id, p_actor);
  v_result := public.fn_approve_long_stock_cutting_plan_before_source_selection_v1(
    p_version_id, p_actor
  );

  select selected_candidate_number into v_selected_candidate_number
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;

  -- The legacy core creates the calculated remainder. Complete its provenance
  -- for every newly supported physical source.
  update public.inventory inventory_row
  set source_inventory_id = bar.source_inventory_id,
      source_reservation_id = reservation_link.reservation_id,
      source_piece_length_mm = bar.stock_length_mm,
      updated_at = now()
  from public.long_stock_cutting_business_scraps scrap_link
  join public.long_stock_cutting_candidate_bars bar
    on bar.version_id = scrap_link.version_id
   and bar.id = scrap_link.bar_id
  join public.long_stock_cutting_bar_reservations reservation_link
    on reservation_link.version_id = bar.version_id
   and reservation_link.bar_id = bar.id
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  where scrap_link.version_id = p_version_id
    and inventory_row.id = scrap_link.inventory_id
    and candidate.candidate_number = v_selected_candidate_number
    and bar.source_type in ('warehouse_stock', 'future_business_remnant');

  update public.inventory_reservations reservation
  set business_scrap_inventory_id = scrap_link.inventory_id,
      business_scrap_quantity = inventory_row.piece_length_mm
  from public.long_stock_cutting_bar_reservations reservation_link
  join public.long_stock_cutting_business_scraps scrap_link
    on scrap_link.version_id = reservation_link.version_id
   and scrap_link.bar_id = reservation_link.bar_id
  join public.inventory inventory_row on inventory_row.id = scrap_link.inventory_id
  where reservation.id = reservation_link.reservation_id
    and reservation_link.version_id = p_version_id;

  select bar.bar_number into v_missing_bar
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  where candidate.version_id = p_version_id
    and candidate.candidate_number = v_selected_candidate_number
    and bar.source_type in ('warehouse_stock', 'business_remnant', 'future_business_remnant')
    and not exists (
      select 1
      from public.long_stock_cutting_bar_reservations reservation_link
      where reservation_link.version_id = p_version_id
        and reservation_link.bar_id = bar.id
    )
  order by bar.bar_number
  limit 1;
  if v_missing_bar is not null then
    raise exception 'Хлыст №%: утверждение не создало точный физический резерв', v_missing_bar;
  end if;
  return v_result;
end;
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Receiving a transfer of a forecast before its producer fact would create a
-- physical row that does not exist. Preserve the existing signature and ACL.
alter function public.fn_receive_inventory_transfer(uuid, jsonb, uuid)
  rename to fn_receive_inventory_transfer_before_future_source_gate_v1;
revoke all on function public.fn_receive_inventory_transfer_before_future_source_gate_v1(uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_receive_inventory_transfer(
  p_transfer_id uuid,
  p_items jsonb,
  p_actor uuid
)
returns public.inventory_transfer_status
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.inventory_transfer_status;
begin
  if exists (
    select 1
    from jsonb_array_elements(p_items) payload
    join public.inventory_transfer_items transfer_item
      on transfer_item.id = nullif(payload->>'item_id', '')::uuid
     and transfer_item.transfer_id = p_transfer_id
    join public.inventory source_inventory on source_inventory.id = transfer_item.source_inventory_id
    where coalesce((payload->>'quantity')::numeric, 0) > 0
      and source_inventory.is_business_scrap = true
      and source_inventory.business_scrap_state = 'future'
      and source_inventory.deleted_at is null
  ) then
    raise exception 'Приёмка перевода запрещена: будущий остаток ещё не подтверждён исходной порезкой';
  end if;
  v_status := public.fn_receive_inventory_transfer_before_future_source_gate_v1(
    p_transfer_id, p_items, p_actor
  );
  update public.long_stock_cutting_source_dependencies dependency
  set reservation_id = destination_reservation.id,
      status = 'ready'
  from public.inventory_transfer_items transfer_item
  join lateral (
    select reservation.id
    from public.inventory_reservations reservation
    where reservation.inventory_id = transfer_item.destination_inventory_id
      and reservation.source_inventory_id = transfer_item.source_inventory_id
      and reservation.request_item_table = transfer_item.request_item_table
      and reservation.request_item_id = transfer_item.request_item_id
      and reservation.consumed_at is null
    order by reservation.created_at desc, reservation.id desc
    limit 1
  ) destination_reservation on true
  where transfer_item.transfer_id = p_transfer_id
    and transfer_item.id = dependency.transfer_item_id
    and transfer_item.received_quantity >= transfer_item.requested_quantity
    and dependency.status <> 'invalidated';

  insert into public.long_stock_cutting_bar_reservations(version_id, bar_id, reservation_id)
  select dependency.consumer_version_id, dependency.consumer_bar_id, dependency.reservation_id
  from public.long_stock_cutting_source_dependencies dependency
  join public.inventory_transfer_items transfer_item on transfer_item.id = dependency.transfer_item_id
  where transfer_item.transfer_id = p_transfer_id
    and transfer_item.received_quantity >= transfer_item.requested_quantity
    and dependency.reservation_id is not null
    and dependency.status = 'ready'
  on conflict (bar_id) do update
    set reservation_id = excluded.reservation_id,
        linked_at = now();
  return v_status;
end;
$$;

revoke all on function public.fn_receive_inventory_transfer(uuid, jsonb, uuid)
  from public, anon;
grant execute on function public.fn_receive_inventory_transfer(uuid, jsonb, uuid)
  to authenticated, service_role;

alter function public.fn_assert_long_stock_cutting_ready(uuid)
  rename to fn_assert_long_stock_ready_pre_dependencies_v1;
revoke all on function public.fn_assert_long_stock_ready_pre_dependencies_v1(uuid)
  from public, anon, authenticated, service_role;

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
    from public.long_stock_cutting_source_dependencies dependency
    join public.inventory source_inventory on source_inventory.id = dependency.source_inventory_id
    join public.long_stock_cutting_plan_items item on item.plan_id = (
      select version.plan_id
      from public.long_stock_cutting_plan_versions version
      where version.id = dependency.consumer_version_id
    )
    join public.technologist_requests request on request.id = item.request_id
    left join public.inventory_transfer_items transfer_item on transfer_item.id = dependency.transfer_item_id
    where request.machine_id = p_machine_id
      and dependency.status not in ('fulfilled', 'invalidated')
      and (
        source_inventory.business_scrap_state = 'future'
        or source_inventory.deleted_at is not null
        or (
          dependency.transfer_item_id is not null
          and coalesce(transfer_item.received_quantity, 0) < transfer_item.requested_quantity
        )
      )
  ) then
    raise exception 'Резка заблокирована: будущий остаток не появился или перевод не принят';
  end if;
  perform public.fn_assert_long_stock_ready_pre_dependencies_v1(p_machine_id);
end;
$$;

revoke all on function public.fn_assert_long_stock_cutting_ready(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_assert_long_stock_cutting_ready(uuid)
  to service_role;

create or replace function public.fn_sync_long_stock_source_dependency_state_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.business_scrap_state = 'future' and new.business_scrap_state = 'available' then
    update public.long_stock_cutting_source_dependencies dependency
    set status = case when dependency.transfer_item_id is null then 'ready' else 'ready_for_transfer' end
    where dependency.source_inventory_id = new.id
      and dependency.status = 'waiting_for_source';
  end if;
  return new;
end;
$$;

create trigger sync_long_stock_source_dependency_state
after update of business_scrap_state on public.inventory
for each row execute function public.fn_sync_long_stock_source_dependency_state_v1();

create or replace function public.fn_fulfill_long_stock_source_dependency_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.long_stock_cutting_source_dependencies
  set status = 'fulfilled', fulfilled_at = now()
  where consumer_bar_id = new.bar_id
    and status not in ('fulfilled', 'invalidated');
  return new;
end;
$$;

create trigger fulfill_long_stock_source_dependency
after insert on public.long_stock_cutting_fact_bars
for each row execute function public.fn_fulfill_long_stock_source_dependency_v1();

revoke all on function public.fn_sync_long_stock_source_dependency_state_v1()
  from public, anon, authenticated;
revoke all on function public.fn_fulfill_long_stock_source_dependency_v1()
  from public, anon, authenticated;

-- Close every new callable signature to browser roles. The application uses
-- service-role RPCs only after its server-side permission checks.
revoke all on function public.fn_reserve_future_business_scrap_for_machine(uuid, uuid, numeric, text, uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.fn_reserve_future_business_scrap_for_machine(uuid, uuid, numeric, text, uuid, uuid, numeric)
  to service_role;
