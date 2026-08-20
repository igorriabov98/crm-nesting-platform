-- Serialize production cutting facts with their inventory effects, cutting-plan
-- invalidation and rollback. Every function introduced here is an internal
-- service-role boundary; application authorization stays in server actions.

create or replace function public.fn_try_lock_production_cutting_machine_v1(
  p_machine_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_machine_id is null then
    raise exception 'Не указана машина факта заготовки';
  end if;

  if not pg_try_advisory_xact_lock(
    hashtextextended('production-cutting-machine:' || p_machine_id::text, 0)
  ) then
    raise exception 'Факт заготовки отклонён: по машине выполняется другой факт или откат';
  end if;
end;
$$;

create or replace function public.fn_lock_production_cutting_machine_v1(
  p_machine_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_machine_id is null then
    raise exception 'Не указана машина отката заготовки';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('production-cutting-machine:' || p_machine_id::text, 0)
  );
end;
$$;

revoke all on function public.fn_try_lock_production_cutting_machine_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.fn_lock_production_cutting_machine_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_try_lock_production_cutting_machine_v1(uuid)
  to service_role;
grant execute on function public.fn_lock_production_cutting_machine_v1(uuid)
  to service_role;

create or replace function public.fn_lock_long_stock_cutting_plans_for_machine_v1(
  p_machine_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_version_id uuid;
begin
  for v_plan_id in
    select distinct plan.id
    from public.inventory_reservations reservation
    join public.long_stock_cutting_plan_items item
      on item.request_item_table = reservation.request_item_table
     and item.request_item_id = reservation.request_item_id
    join public.long_stock_cutting_plans plan on plan.id = item.plan_id
    where reservation.machine_id = p_machine_id
      and reservation.consumed_at is null
      and plan.status = 'open'
    order by plan.id
  loop
    perform 1
    from public.long_stock_cutting_plans
    where id = v_plan_id
    for update;

    select id into v_version_id
    from public.long_stock_cutting_plan_versions
    where plan_id = v_plan_id
      and status = 'approved'
    order by approved_at desc, id desc
    limit 1
    for update;

    if v_version_id is null then
      raise exception 'Факт заготовки отклонён: утверждённая версия карты уже недействительна';
    end if;
  end loop;
end;
$$;

revoke all on function public.fn_lock_long_stock_cutting_plans_for_machine_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_lock_long_stock_cutting_plans_for_machine_v1(uuid)
  to service_role;

-- The outer cutting RPC is also callable by internal SQL. Put the machine lock
-- at that boundary so no caller can create a new event while rollback owns the
-- machine snapshot.
alter function public.fn_apply_production_fact_cutting(uuid, uuid)
  rename to fn_apply_production_fact_cutting_before_race_serialization;

revoke all on function public.fn_apply_production_fact_cutting_before_race_serialization(uuid, uuid)
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
  v_machine_id uuid;
  v_effective_stage public.stage_type;
begin
  select
    fact.machine_id,
    coalesce(section.production_stage_type, parent.production_stage_type)
  into v_machine_id, v_effective_stage
  from public.production_machine_facts fact
  join public.production_fact_sections section on section.id = fact.section_id
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where fact.id = p_fact_id;

  if not found then
    raise exception 'Факт производства не найден';
  end if;

  if v_effective_stage = 'cutting'::public.stage_type then
    perform public.fn_try_lock_production_cutting_machine_v1(v_machine_id);

    -- Take the plan/version locks before the legacy RPC can consume a
    -- reservation or promote any scrap. This gives receipt invalidation and
    -- cutting one common mutation boundary rather than protecting bars only.
    perform public.fn_lock_long_stock_cutting_plans_for_machine_v1(v_machine_id);
  end if;

  return public.fn_apply_production_fact_cutting_before_race_serialization(
    p_fact_id,
    p_performed_by
  );
end;
$$;

revoke all on function public.fn_apply_production_fact_cutting(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_apply_production_fact_cutting(uuid, uuid)
  to service_role;

-- Save one row and apply every cutting consequence in the same PostgreSQL
-- transaction. Any exception raised by the cutting RPC rolls the row back too.
create or replace function public.fn_save_production_machine_fact_atomic_v1(
  p_fact_id uuid,
  p_factory_id uuid,
  p_fact_date date,
  p_machine_id uuid,
  p_section_id uuid,
  p_shift public.production_fact_shift,
  p_comment text,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fact_id uuid;
  v_effective_stage public.stage_type;
  v_existing_machine_id uuid;
  v_existing_effective_stage public.stage_type;
  v_locked_machine_id uuid;
begin
  if p_actor is null then
    raise exception 'Не указан автор факта производства';
  end if;

  select coalesce(section.production_stage_type, parent.production_stage_type)
  into v_effective_stage
  from public.production_fact_sections section
  left join public.production_fact_sections parent on parent.id = section.parent_id
  where section.id = p_section_id;

  if not found then
    raise exception 'Участок факта производства не найден';
  end if;

  if p_fact_id is not null then
    select
      fact.machine_id,
      coalesce(section.production_stage_type, parent.production_stage_type)
    into v_existing_machine_id, v_existing_effective_stage
    from public.production_machine_facts fact
    join public.production_fact_sections section on section.id = fact.section_id
    left join public.production_fact_sections parent on parent.id = section.parent_id
    where fact.id = p_fact_id;
    if not found then
      raise exception 'Запись факта не найдена';
    end if;
  end if;

  for v_locked_machine_id in
    select distinct machine_id
    from (
      values
        (
          case
            when v_effective_stage = 'cutting'::public.stage_type then p_machine_id
            else null
          end
        ),
        (
          case
            when v_existing_effective_stage = 'cutting'::public.stage_type
              then v_existing_machine_id
            else null
          end
        )
    ) cutting_machine(machine_id)
    where machine_id is not null
    order by machine_id
  loop
    perform public.fn_try_lock_production_cutting_machine_v1(v_locked_machine_id);
    perform public.fn_lock_long_stock_cutting_plans_for_machine_v1(v_locked_machine_id);
  end loop;

  if p_fact_id is null then
    insert into public.production_machine_facts(
      factory_id,
      fact_date,
      machine_id,
      section_id,
      shift,
      comment,
      created_by,
      updated_by
    ) values (
      p_factory_id,
      p_fact_date,
      p_machine_id,
      p_section_id,
      p_shift,
      p_comment,
      p_actor,
      p_actor
    )
    returning id into v_fact_id;
  else
    perform 1
    from public.production_machine_facts
    where id = p_fact_id
    for update;
    if not found then
      raise exception 'Запись факта не найдена';
    end if;

    update public.production_machine_facts
    set factory_id = p_factory_id,
        fact_date = p_fact_date,
        machine_id = p_machine_id,
        section_id = p_section_id,
        shift = p_shift,
        comment = p_comment,
        updated_by = p_actor
    where id = p_fact_id
    returning id into v_fact_id;
  end if;

  perform public.fn_apply_production_fact_cutting(v_fact_id, p_actor);
  return v_fact_id;
end;
$$;

revoke all on function public.fn_save_production_machine_fact_atomic_v1(
  uuid, uuid, date, uuid, uuid, public.production_fact_shift, text, uuid
) from public, anon, authenticated;
grant execute on function public.fn_save_production_machine_fact_atomic_v1(
  uuid, uuid, date, uuid, uuid, public.production_fact_shift, text, uuid
) to service_role;

-- Bulk entry keeps the previous insert-if-missing contract, but all inserted
-- rows and all cutting effects now share one transaction.
create or replace function public.fn_save_production_machine_facts_atomic_v1(
  p_facts jsonb,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_input record;
  v_fact_id uuid;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_fact_ids uuid[] := '{}'::uuid[];
begin
  if p_actor is null then
    raise exception 'Не указан автор фактов производства';
  end if;
  if jsonb_typeof(p_facts) is distinct from 'array' then
    raise exception 'Факты производства должны быть переданы массивом';
  end if;

  -- Acquire all machine locks in a deterministic order before the first row is
  -- inserted. A conflict rejects the complete batch without partial facts.
  for v_input in
    select distinct (input.value->>'machine_id')::uuid as machine_id
    from jsonb_array_elements(p_facts) input(value)
    join public.production_fact_sections section
      on section.id = (input.value->>'section_id')::uuid
    left join public.production_fact_sections parent on parent.id = section.parent_id
    where coalesce(section.production_stage_type, parent.production_stage_type)
      = 'cutting'::public.stage_type
    order by machine_id
  loop
    perform public.fn_try_lock_production_cutting_machine_v1(v_input.machine_id);
  end loop;

  for v_input in
    select distinct (input.value->>'machine_id')::uuid as machine_id
    from jsonb_array_elements(p_facts) input(value)
    join public.production_fact_sections section
      on section.id = (input.value->>'section_id')::uuid
    left join public.production_fact_sections parent on parent.id = section.parent_id
    where coalesce(section.production_stage_type, parent.production_stage_type)
      = 'cutting'::public.stage_type
    order by machine_id
  loop
    perform public.fn_lock_long_stock_cutting_plans_for_machine_v1(v_input.machine_id);
  end loop;

  for v_input in
    select value
    from jsonb_array_elements(p_facts) value
    order by
      value->>'machine_id',
      value->>'section_id',
      value->>'shift'
  loop
    v_fact_id := null;
    insert into public.production_machine_facts(
      factory_id,
      fact_date,
      machine_id,
      section_id,
      shift,
      comment,
      created_by,
      updated_by
    ) values (
      (v_input.value->>'factory_id')::uuid,
      (v_input.value->>'fact_date')::date,
      (v_input.value->>'machine_id')::uuid,
      (v_input.value->>'section_id')::uuid,
      (v_input.value->>'shift')::public.production_fact_shift,
      nullif(v_input.value->>'comment', ''),
      p_actor,
      p_actor
    )
    on conflict (factory_id, fact_date, shift, machine_id, section_id)
      do nothing
    returning id into v_fact_id;

    if v_fact_id is null then
      select id into strict v_fact_id
      from public.production_machine_facts
      where factory_id = (v_input.value->>'factory_id')::uuid
        and fact_date = (v_input.value->>'fact_date')::date
        and shift = (v_input.value->>'shift')::public.production_fact_shift
        and machine_id = (v_input.value->>'machine_id')::uuid
        and section_id = (v_input.value->>'section_id')::uuid
      for update;
      v_skipped := v_skipped + 1;
    else
      v_inserted := v_inserted + 1;
    end if;

    perform public.fn_apply_production_fact_cutting(v_fact_id, p_actor);
    v_fact_ids := array_append(v_fact_ids, v_fact_id);
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'fact_ids', to_jsonb(v_fact_ids)
  );
end;
$$;

revoke all on function public.fn_save_production_machine_facts_atomic_v1(jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_save_production_machine_facts_atomic_v1(jsonb, uuid)
  to service_role;

-- The cutting-area RPC already saves its fact and inventory effects in one
-- database call, but it used to acquire its machine/stage row locks before the
-- rollback serialization point. Put the shared lock ahead of that whole call.
alter function public.fn_start_production_cutting_cycle(
  uuid, uuid, uuid, date, public.production_fact_shift, uuid[], uuid
) rename to fn_start_production_cutting_cycle_before_race_serialization;

revoke all on function public.fn_start_production_cutting_cycle_before_race_serialization(
  uuid, uuid, uuid, date, public.production_fact_shift, uuid[], uuid
) from public, anon, authenticated, service_role;

create or replace function public.fn_start_production_cutting_cycle(
  p_machine_id uuid,
  p_factory_id uuid,
  p_section_id uuid,
  p_fact_date date,
  p_shift public.production_fact_shift,
  p_request_ids uuid[],
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.fn_try_lock_production_cutting_machine_v1(p_machine_id);
  perform public.fn_lock_long_stock_cutting_plans_for_machine_v1(p_machine_id);

  return public.fn_start_production_cutting_cycle_before_race_serialization(
    p_machine_id,
    p_factory_id,
    p_section_id,
    p_fact_date,
    p_shift,
    p_request_ids,
    p_actor
  );
end;
$$;

revoke all on function public.fn_start_production_cutting_cycle(
  uuid, uuid, uuid, date, public.production_fact_shift, uuid[], uuid
) from public, anon, authenticated;
grant execute on function public.fn_start_production_cutting_cycle(
  uuid, uuid, uuid, date, public.production_fact_shift, uuid[], uuid
) to service_role;

-- Receipt transactions and approval transactions serialize on the plan row.
-- The receipt trigger obtains this lock before the existing invalidation trigger
-- (trigger names are fired alphabetically), so one of the two sides always sees
-- the other's committed state.
create or replace function public.fn_lock_long_stock_plan_for_request_item_v1(
  p_request_item_table text,
  p_request_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
begin
  for v_plan_id in
    select distinct plan.id
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan on plan.id = item.plan_id
    where item.request_item_table = p_request_item_table
      and item.request_item_id = p_request_item_id
      and plan.status = 'open'
    order by plan.id
  loop
    perform 1
    from public.long_stock_cutting_plans
    where id = v_plan_id
    for update;
  end loop;
end;
$$;

create or replace function public.fn_serialize_long_stock_supply_receipt_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'delivered'
    and new.request_item_table in ('request_circle', 'request_pipe', 'request_knives') then
    perform public.fn_lock_long_stock_plan_for_request_item_v1(
      new.request_item_table,
      new.request_item_id
    );
  end if;
  return new;
end;
$$;

create or replace function public.fn_serialize_long_stock_transfer_receipt_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.received_quantity > old.received_quantity
    and new.request_item_table in ('request_circle', 'request_pipe', 'request_knives') then
    perform public.fn_lock_long_stock_plan_for_request_item_v1(
      new.request_item_table,
      new.request_item_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists a_serialize_long_stock_plan_supply_receipt
  on public.supply_order_delivery_schedules;
create trigger a_serialize_long_stock_plan_supply_receipt
after insert or update of status, received_piece_length_mm, received_piece_count, received_by
on public.supply_order_delivery_schedules
for each row execute function public.fn_serialize_long_stock_supply_receipt_v1();

drop trigger if exists a_serialize_long_stock_plan_transfer_receipt
  on public.inventory_transfer_items;
create trigger a_serialize_long_stock_plan_transfer_receipt
after update of received_quantity, received_secondary_quantity
on public.inventory_transfer_items
for each row execute function public.fn_serialize_long_stock_transfer_receipt_v1();

revoke all on function public.fn_lock_long_stock_plan_for_request_item_v1(text, uuid)
  from public, anon, authenticated;
revoke all on function public.fn_serialize_long_stock_supply_receipt_v1()
  from public, anon, authenticated;
revoke all on function public.fn_serialize_long_stock_transfer_receipt_v1()
  from public, anon, authenticated;

-- Recheck receipts which may have committed before the version became
-- approved. The plan row is already locked by the approval wrapper below.
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
  v_schedule record;
  v_transfer_item record;
  v_expected_count numeric;
  v_planned_count numeric;
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

  -- Recalculation versions are intentionally built from the accepted physical
  -- composition and may use only a subset of it. Their existing approval core
  -- validates every requested new-stock length against the accepted rows.
  if v_is_recalculation then
    return null;
  end if;

  for v_schedule in
    select schedule.*
    from public.long_stock_cutting_plan_items item
    join public.supply_order_delivery_schedules schedule
      on schedule.request_item_table = item.request_item_table
     and schedule.request_item_id = item.request_item_id
    where item.plan_id = v_plan_id
      and schedule.status = 'delivered'
      and schedule.received_piece_length_mm is not null
      and coalesce(schedule.received_piece_count, 0) > 0
    order by schedule.delivered_at nulls last, schedule.created_at, schedule.id
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
      and bar.source_type = 'new_stock'
      and bar.stock_length_mm = v_schedule.received_piece_length_mm;

    select coalesce(sum(schedule.planned_piece_count), 0) into v_planned_count
    from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = v_schedule.request_item_table
      and schedule.request_item_id = v_schedule.request_item_id
      and schedule.planned_piece_length_mm = coalesce(
        v_schedule.planned_piece_length_mm,
        v_schedule.received_piece_length_mm
      );

    select coalesce(sum(schedule.received_piece_count), 0) into v_actual_count
    from public.supply_order_delivery_schedules schedule
    where schedule.request_item_table = v_schedule.request_item_table
      and schedule.request_item_id = v_schedule.request_item_id
      and schedule.status = 'delivered'
      and schedule.received_piece_length_mm = v_schedule.received_piece_length_mm;

    if (
      v_schedule.planned_piece_length_mm is not null
      and v_schedule.received_piece_length_mm is distinct from v_schedule.planned_piece_length_mm
    ) or (
      v_schedule.planned_piece_count is not null
      and v_schedule.received_piece_count is distinct from v_schedule.planned_piece_count
    ) or v_expected_count = 0
      or v_planned_count > v_expected_count
      or v_actual_count > v_expected_count then
      v_reason := format(
        'Расхождение уже принятого материала при утверждении карты: по карте %s мм × %s, принято %s мм × %s',
        trim(to_char(
          coalesce(v_schedule.planned_piece_length_mm, v_schedule.received_piece_length_mm),
          'FM9999999990.###'
        )),
        trim(to_char(
          coalesce(v_schedule.planned_piece_count, v_expected_count),
          'FM9999999990.###'
        )),
        trim(to_char(v_schedule.received_piece_length_mm, 'FM9999999990.###')),
        trim(to_char(v_schedule.received_piece_count, 'FM9999999990.###'))
      );

      v_invalidated_version_id := public.fn_invalidate_long_stock_cutting_plan_for_receipt(
        v_schedule.request_item_table,
        v_schedule.request_item_id,
        p_actor,
        v_reason,
        v_schedule.id,
        null
      );
      if v_invalidated_version_id is not null then
        return v_invalidated_version_id;
      end if;
    end if;
  end loop;

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
      or (
        v_transfer_item.requested_secondary_quantity is not null
        and v_actual_count is distinct from v_transfer_item.requested_secondary_quantity
      )
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
      if v_invalidated_version_id is not null then
        return v_invalidated_version_id;
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.fn_revalidate_long_stock_receipts_after_approval_v1(uuid, uuid)
  from public, anon, authenticated;

alter function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  rename to fn_approve_long_stock_cutting_plan_before_race_serialization;

revoke all on function public.fn_approve_long_stock_cutting_plan_before_race_serialization(uuid, uuid)
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
  v_plan_id uuid;
  v_result jsonb;
  v_invalidated_version_id uuid;
begin
  select plan_id into strict v_plan_id
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;

  perform 1
  from public.long_stock_cutting_plans
  where id = v_plan_id
  for update;

  v_result := public.fn_approve_long_stock_cutting_plan_before_race_serialization(
    p_version_id,
    p_actor
  );

  v_invalidated_version_id := public.fn_revalidate_long_stock_receipts_after_approval_v1(
    p_version_id,
    p_actor
  );

  if v_invalidated_version_id is not null then
    return v_result || jsonb_build_object(
      'status', 'invalid',
      'position_status', 'requires_recalculation',
      'invalidated_version_id', v_invalidated_version_id
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

-- The PDF boundary used by the application previously locked the version
-- before it reached the core. Lock the plan first here as well, otherwise a
-- receipt holding the plan and waiting for the version can deadlock approval.
alter function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  rename to fn_approve_long_stock_cutting_plan_pdf_before_race_serialization;

revoke all on function public.fn_approve_long_stock_cutting_plan_pdf_before_race_serialization(
  uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.fn_approve_long_stock_cutting_plan_version_v2(
  p_version_id uuid,
  p_actor uuid,
  p_pdf_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
begin
  select plan_id into strict v_plan_id
  from public.long_stock_cutting_plan_versions
  where id = p_version_id;

  perform 1
  from public.long_stock_cutting_plans
  where id = v_plan_id
  for update;

  return public.fn_approve_long_stock_cutting_plan_pdf_before_race_serialization(
    p_version_id,
    p_actor,
    p_pdf_metadata
  );
end;
$$;

revoke all on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_approve_long_stock_cutting_plan_version_v2(uuid, uuid, jsonb)
  to service_role;

-- Invalidation locks plan then version. Fact processing now uses the same order
-- and verifies the version after waiting, before changing any physical bar.
alter function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  rename to fn_apply_long_stock_cutting_fact_before_race_serialization;

revoke all on function public.fn_apply_long_stock_cutting_fact_before_race_serialization(uuid, uuid)
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
  v_plan_id uuid;
  v_version_id uuid;
begin
  -- Lock every long-stock plan touched by the event independently of version
  -- status. If invalidation won, the subsequent approved-version lookup fails.
  for v_plan_id in
    select distinct plan.id
    from public.production_fact_cutting_event_reservations event_reservation
    join public.long_stock_cutting_plan_items item
      on item.request_item_table = event_reservation.request_item_table
     and item.request_item_id = event_reservation.request_item_id
    join public.long_stock_cutting_plans plan on plan.id = item.plan_id
    where event_reservation.event_id = p_event_id
    order by plan.id
  loop
    perform 1
    from public.long_stock_cutting_plans
    where id = v_plan_id
    for update;

    select id into v_version_id
    from public.long_stock_cutting_plan_versions
    where plan_id = v_plan_id
      and status = 'approved'
    order by approved_at desc, id desc
    limit 1
    for update;

    if v_version_id is null then
      raise exception 'Факт заготовки отклонён: утверждённая версия карты уже недействительна';
    end if;
  end loop;

  return public.fn_apply_long_stock_cutting_fact_before_race_serialization(
    p_event_id,
    p_performed_by
  );
end;
$$;

revoke all on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_apply_long_stock_cutting_fact_v1(uuid, uuid)
  to service_role;

-- The legacy rollback core used to select applied event IDs independently.
-- Make it consume the transaction-local snapshot set by the outer wrapper.
do $migration$
declare
  v_definition text;
  v_anchor text := E'  SELECT array_agg(id ORDER BY created_at)\n  INTO v_event_ids\n  FROM public.production_fact_cutting_events\n  WHERE machine_id = p_machine_id\n    AND status = \'applied\';';
  v_replacement text := E'  v_event_ids := nullif(\n    current_setting(\'app.production_cutting_rollback_event_ids\', true),\n    \'\'\n  )::uuid[];\n\n  IF v_event_ids IS NULL THEN\n    RAISE EXCEPTION \'Зафиксированный список событий отката не передан\';\n  END IF;';
begin
  v_definition := pg_get_functiondef(
    'public.fn_apply_production_cutting_rollback_before_long_stock_fact(uuid,uuid,uuid,text)'::regprocedure
  );

  if position(v_anchor in v_definition) = 0 then
    raise exception 'Не найден повторный выбор событий в ядре отката';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$migration$;

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
  perform public.fn_lock_production_cutting_machine_v1(p_machine_id);

  select coalesce(array_agg(locked_event.id order by locked_event.created_at), '{}'::uuid[])
  into v_event_ids
  from (
    select event.id, event.created_at
    from public.production_fact_cutting_events event
    where event.machine_id = p_machine_id
      and event.status = 'applied'
    order by event.created_at, event.id
    for update
  ) locked_event;

  perform set_config(
    'app.production_cutting_rollback_event_ids',
    v_event_ids::text,
    true
  );

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

  perform set_config('app.production_cutting_rollback_event_ids', '', true);
  return v_result || jsonb_build_object('longStock', v_long_stock_result);
end;
$$;

revoke all on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  to service_role;

comment on function public.fn_save_production_machine_fact_atomic_v1(
  uuid, uuid, date, uuid, uuid, public.production_fact_shift, text, uuid
) is
  'Atomically saves one production fact and applies its cutting inventory consequences.';
comment on function public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text) is
  'Serializes rollback with new facts and uses one locked applied-event snapshot for legacy and long-stock consequences.';

notify pgrst, 'reload schema';
