-- Follow-up invariants from the repeated long-stock adversarial review.

-- This value is deliberately distinct from minimum_useful_length_mm. The
-- former is a disabled classification threshold, while the latter is only a
-- warehouse display/filter hint. Neither may suppress a positive remainder.
alter table public.long_stock_layout_categories
  add column if not exists business_scrap_threshold_mm numeric not null default 0;

alter table public.long_stock_layout_categories
  drop constraint if exists long_stock_layout_categories_business_scrap_threshold_check;
alter table public.long_stock_layout_categories
  add constraint long_stock_layout_categories_business_scrap_threshold_check
  check (business_scrap_threshold_mm = 0);

comment on column public.long_stock_layout_categories.business_scrap_threshold_mm is
  'Порог классификации делового остатка; отключён и равен 0. Не влияет на создание складской строки.';
comment on column public.long_stock_layout_categories.minimum_useful_length_mm is
  'Только пометка «мелочь» и фильтр склада. Не влияет на создание складской строки.';

create or replace function public.fn_get_long_stock_layout_settings_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'revision', settings.revision,
    'kerf_mm', settings.kerf_mm,
    'end_trim_mm', settings.end_trim_mm,
    'optimization_hint_threshold_percent', settings.optimization_hint_threshold_percent,
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', category.key,
          'material_category', category.material_category,
          'knife_bevel_count', category.knife_bevel_count,
          'business_scrap_threshold_mm', category.business_scrap_threshold_mm,
          'minimum_useful_length_mm', category.minimum_useful_length_mm,
          'standard_lengths', coalesce((
            select jsonb_agg(length.length_mm order by length.length_mm)
            from public.long_stock_layout_lengths length
            where length.category_key = category.key
              and length.length_group = 'standard'
          ), '[]'::jsonb),
          'nonstandard_lengths', coalesce((
            select jsonb_agg(length.length_mm order by length.length_mm)
            from public.long_stock_layout_lengths length
            where length.category_key = category.key
              and length.length_group = 'nonstandard'
          ), '[]'::jsonb)
        )
        order by category.sort_order
      )
      from public.long_stock_layout_categories category
    ), '[]'::jsonb)
  )
  from public.long_stock_layout_settings settings
  where settings.id = true
$$;

revoke all on function public.fn_get_long_stock_layout_settings_snapshot()
  from public, anon, authenticated;
grant execute on function public.fn_get_long_stock_layout_settings_snapshot()
  to service_role;

-- Keep the physical remainder invariant explicit even if the historical
-- threshold-removal migration is replayed against a slightly different base.
do $migration$
declare
  v_definition text;
  v_old_condition constant text :=
    'if v_remainder > 0 and v_remainder >= v_minimum_useful_length then';
  v_new_condition constant text := 'if v_remainder > 0 then';
begin
  v_definition := pg_get_functiondef(
    'public.fn_approve_long_stock_cutting_plan_before_recalculation(uuid,uuid)'::regprocedure
  );
  if position(v_old_condition in v_definition) > 0 then
    v_definition := replace(v_definition, v_old_condition, v_new_condition);
    execute v_definition;
  elsif position(v_new_condition in v_definition) = 0 then
    raise exception 'Не найден инвариант создания любого положительного остатка';
  end if;
end;
$migration$;

-- Save and cutting consequences remain one transaction, but an already
-- applied fact cannot be structurally moved: the historical event is keyed by
-- fact_id and cannot be safely re-applied to another machine or section.
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
  v_existing_factory_id uuid;
  v_existing_machine_id uuid;
  v_existing_section_id uuid;
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
      fact.factory_id,
      fact.machine_id,
      fact.section_id,
      coalesce(section.production_stage_type, parent.production_stage_type)
    into
      v_existing_factory_id,
      v_existing_machine_id,
      v_existing_section_id,
      v_existing_effective_stage
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

    if (
      v_existing_factory_id is distinct from p_factory_id
      or v_existing_machine_id is distinct from p_machine_id
      or v_existing_section_id is distinct from p_section_id
    ) and exists (
      select 1
      from public.production_fact_cutting_events event
      where event.fact_id = p_fact_id
    ) then
      raise exception
        'Проведённый факт заготовки нельзя перенести на другую машину или участок; сначала выполните откат';
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

-- Approval must count the attributed physical pieces on distribution children,
-- not only received_piece_count from the source receipt.
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
  v_schedule_actual_count numeric;
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
      and coalesce(
        schedule.allocated_piece_count,
        schedule.received_piece_count,
        schedule.allocated_physical_quantity / nullif(schedule.received_piece_length_mm, 0),
        schedule.received_quantity / nullif(schedule.received_piece_length_mm, 0),
        0
      ) > 0
    order by schedule.delivered_at nulls last, schedule.created_at, schedule.id
  loop
    v_schedule_actual_count := coalesce(
      v_schedule.allocated_piece_count,
      v_schedule.received_piece_count,
      v_schedule.allocated_physical_quantity / nullif(v_schedule.received_piece_length_mm, 0),
      v_schedule.received_quantity / nullif(v_schedule.received_piece_length_mm, 0)
    );

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

    select coalesce(sum(coalesce(
      schedule.allocated_piece_count,
      schedule.received_piece_count,
      schedule.allocated_physical_quantity / nullif(schedule.received_piece_length_mm, 0),
      schedule.received_quantity / nullif(schedule.received_piece_length_mm, 0),
      0
    )), 0) into v_actual_count
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
      and v_schedule_actual_count is distinct from v_schedule.planned_piece_count
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
        trim(to_char(v_schedule_actual_count, 'FM9999999990.###'))
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

drop trigger if exists a_serialize_long_stock_plan_supply_receipt
  on public.supply_order_delivery_schedules;
create trigger a_serialize_long_stock_plan_supply_receipt
after insert or update of
  status,
  received_piece_length_mm,
  received_piece_count,
  allocated_piece_count,
  allocated_physical_quantity,
  received_by,
  receipt_parent_schedule_id
on public.supply_order_delivery_schedules
for each row execute function public.fn_serialize_long_stock_supply_receipt_v1();

notify pgrst, 'reload schema';
