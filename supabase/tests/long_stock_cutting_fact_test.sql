\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.create_new_stock_plan(
  p_actor uuid,
  p_machine uuid,
  p_material uuid,
  p_variant uuid,
  p_lengths integer[],
  p_cut_lengths numeric[]
)
returns jsonb
language plpgsql
as $$
declare
  v_request uuid := gen_random_uuid();
  v_request_item uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_settings jsonb;
  v_segments jsonb := '[]'::jsonb;
  v_bars jsonb := '[]'::jsonb;
  v_bar_ids jsonb;
  v_scrap_ids jsonb;
  v_kerf numeric;
  v_end_trim numeric;
  v_weight_per_m numeric;
  v_purchased numeric := 0;
  v_net numeric := 0;
  v_loss numeric := 0;
  v_remainder numeric := 0;
  v_index integer;
begin
  if coalesce(array_length(p_lengths, 1), 0) = 0
    or array_length(p_lengths, 1) is distinct from array_length(p_cut_lengths, 1) then
    raise exception 'Некорректный тестовый набор хлыстов';
  end if;

  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, p_machine, p_actor);

  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  )
  select
    v_request_item,
    v_request,
    variant.diameter_mm,
    coalesce(variant.material_grade, 'S355'),
    (select sum(value) from unnest(p_cut_lengths) value),
    p_material,
    p_variant
  from public.material_variants variant
  where variant.id = p_variant;

  v_plan := public.fn_create_long_stock_cutting_plan(
    p_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    p_actor
  );

  select id into v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan and request_item_id = v_request_item;

  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_kerf := coalesce((v_settings->>'kerf_mm')::numeric, 0);
  v_end_trim := coalesce((v_settings->>'end_trim_mm')::numeric, 0);
  select coalesce(weight_per_m_kg, 0) into v_weight_per_m
  from public.material_variants where id = p_variant;

  for v_index in 1..array_length(p_lengths, 1)
  loop
    v_segments := v_segments || jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', v_index,
      'required_length_mm', p_cut_lengths[v_index],
      'required_weight_kg', p_cut_lengths[v_index] * v_weight_per_m / 1000
    ));
    v_bars := v_bars || jsonb_build_array(jsonb_build_object(
      'bar_number', v_index,
      'stock_length_mm', p_lengths[v_index],
      'length_group', case when v_index = 1 then 'standard' else 'nonstandard' end,
      'source_type', 'new_stock',
      'source_inventory_id', null,
      'cuts', jsonb_build_array(jsonb_build_object(
        'cut_number', 1,
        'segment_number', v_index,
        'cut_length_mm', p_cut_lengths[v_index]
      ))
    ));
    v_purchased := v_purchased + p_lengths[v_index];
    v_net := v_net + p_cut_lengths[v_index];
    v_loss := v_loss + v_kerf + v_end_trim;
    v_remainder := v_remainder
      + p_lengths[v_index] - p_cut_lengths[v_index] - v_kerf - v_end_trim;
  end loop;

  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object(
      'test', gen_random_uuid(),
      'material_id', p_material,
      'material_variant_id', p_variant
    ),
    v_settings,
    v_segments,
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', v_purchased,
        'net_parts_length_mm', v_net,
        'kerf_loss_length_mm', array_length(p_lengths, 1) * v_kerf,
        'end_trim_loss_length_mm', array_length(p_lengths, 1) * v_end_trim,
        'business_scrap_length_mm', v_remainder,
        'purchased_weight_kg', v_purchased * v_weight_per_m / 1000,
        'net_parts_weight_kg', v_net * v_weight_per_m / 1000,
        'kerf_loss_weight_kg', array_length(p_lengths, 1) * v_kerf * v_weight_per_m / 1000,
        'end_trim_loss_weight_kg', array_length(p_lengths, 1) * v_end_trim * v_weight_per_m / 1000,
        'business_scrap_weight_kg', v_remainder * v_weight_per_m / 1000
      ),
      'bars', v_bars
    )),
    1,
    p_actor,
    null,
    '{}'::jsonb
  );

  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version, p_actor);

  select jsonb_agg(bar.id order by bar.bar_number),
         jsonb_agg(scrap_link.inventory_id order by bar.bar_number)
  into v_bar_ids, v_scrap_ids
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  left join public.long_stock_cutting_business_scraps scrap_link on scrap_link.bar_id = bar.id
  where candidate.version_id = v_version
    and candidate.candidate_number = 1;

  return jsonb_build_object(
    'request_id', v_request,
    'plan_id', v_plan,
    'version_id', v_version,
    'request_item_id', v_request_item,
    'bar_ids', v_bar_ids,
    'scrap_ids', v_scrap_ids,
    'kerf_mm', v_kerf,
    'end_trim_mm', v_end_trim
  );
end;
$$;

create or replace function pg_temp.add_reserved_bar(
  p_actor uuid,
  p_machine uuid,
  p_material uuid,
  p_variant uuid,
  p_request_item uuid,
  p_source_inventory uuid,
  p_length numeric,
  p_logical_quantity numeric
)
returns uuid
language plpgsql
as $$
declare
  v_reservation uuid;
begin
  insert into public.inventory_reservations(
    inventory_id,
    source_inventory_id,
    material_id,
    material_variant_id,
    machine_id,
    request_item_table,
    request_item_id,
    reserved_quantity,
    logical_reserved_quantity,
    reserved_secondary_quantity,
    reserved_by,
    original_piece_length_mm,
    is_cut_reservation,
    reservation_source
  ) values (
    p_source_inventory,
    p_source_inventory,
    p_material,
    p_variant,
    p_machine,
    'request_circle',
    p_request_item,
    p_length,
    p_logical_quantity,
    1,
    p_actor,
    p_length,
    false,
    'whole_bar_stock'
  ) returning id into v_reservation;

  update public.inventory
  set reserved_quantity = reserved_quantity + p_length,
      reserved_secondary_quantity = coalesce(reserved_secondary_quantity, 0) + 1,
      last_updated_by = p_actor,
      updated_at = now()
  where id = p_source_inventory;

  return v_reservation;
end;
$$;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_section uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_machine_zero uuid := gen_random_uuid();
  v_machine_partial uuid := gen_random_uuid();
  v_machine_draft uuid := gen_random_uuid();
  v_variant_zero uuid := gen_random_uuid();
  v_variant_partial uuid := gen_random_uuid();
  v_variant_draft uuid := gen_random_uuid();
  v_plan_data jsonb;
  v_plan uuid;
  v_version uuid;
  v_request uuid;
  v_request_item uuid;
  v_source_first uuid;
  v_source_second uuid;
  v_reservation_first uuid;
  v_reservation_second uuid;
  v_fact uuid;
  v_scrap uuid;
  v_blocked boolean;
  v_error text;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then
    raise exception 'Для теста строгого сопоставления не найден завод';
  end if;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'long-stock-cutting-match@example.test', 'Тест строгого сопоставления', 'technologist', v_factory, true);
  insert into public.production_fact_sections(
    id, factory_id, name, production_stage_type, created_by, updated_by
  ) values (
    v_section, v_factory, 'Заготовка · тест строгого сопоставления', 'cutting', v_actor, v_actor
  );
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Тестовый круг строгого сопоставления', 'circle', v_actor);

  insert into public.machines(id, factory_id, name, created_by) values
    (v_machine_zero, v_factory, 'LONG-STOCK-FACT-ZERO-MATCH', v_actor),
    (v_machine_partial, v_factory, 'LONG-STOCK-FACT-PARTIAL-MATCH', v_actor),
    (v_machine_draft, v_factory, 'LONG-STOCK-FACT-NO-APPROVED', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values
    (v_variant_zero, v_material, 'circle', 51, 'S355', 6000, 2, 'мм'),
    (v_variant_partial, v_material, 'circle', 52, 'S355', 6000, 2, 'мм'),
    (v_variant_draft, v_material, 'circle', 53, 'S355', 6000, 2, 'мм');

  -- A physical 8000 mm bar cannot silently pass against a 6000 mm plan.
  v_plan_data := pg_temp.create_new_stock_plan(
    v_actor, v_machine_zero, v_material, v_variant_zero,
    array[6000], array[1000::numeric]
  );
  v_plan := (v_plan_data->>'plan_id')::uuid;
  v_version := (v_plan_data->>'version_id')::uuid;
  v_request_item := (v_plan_data->>'request_item_id')::uuid;
  v_scrap := (v_plan_data#>>'{scrap_ids,0}')::uuid;
  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant_zero, 8000,
    8000, 0, 'мм', 1, 0, 'шт', v_actor
  ) returning id into v_source_first;
  v_reservation_first := pg_temp.add_reserved_bar(
    v_actor, v_machine_zero, v_material, v_variant_zero,
    v_request_item, v_source_first, 8000, 1001
  );
  v_fact := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact, v_factory, current_date, 'day', v_machine_zero, v_section, v_actor, v_actor
  );
  v_blocked := false;
  begin
    perform public.fn_apply_production_fact_cutting(v_fact, v_actor);
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%физических: 1, сопоставлено: 0%' then raise; end if;
    v_blocked := true;
  end;
  if not v_blocked
    or exists (select 1 from public.production_fact_cutting_events where fact_id = v_fact)
    or (select total_quantity from public.inventory where id = v_source_first) <> 8000
    or (select reserved_quantity from public.inventory where id = v_source_first) <> 8000
    or (select consumed_at from public.inventory_reservations where id = v_reservation_first) is not null
    or (select business_scrap_state from public.inventory where id = v_scrap) <> 'future'
    or exists (
      select 1
      from public.long_stock_cutting_candidate_bars bar
      join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
      where candidate.version_id = v_version and bar.status <> 'planned'
    ) then
    raise exception 'Нулевое сопоставление изменило склад или карту';
  end if;

  -- One matching and one non-matching physical bar must reject the whole fact.
  v_plan_data := pg_temp.create_new_stock_plan(
    v_actor, v_machine_partial, v_material, v_variant_partial,
    array[6000, 6000], array[1000::numeric, 1000::numeric]
  );
  v_version := (v_plan_data->>'version_id')::uuid;
  v_request_item := (v_plan_data->>'request_item_id')::uuid;
  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant_partial, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_actor
  ) returning id into v_source_first;
  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant_partial, 8000,
    8000, 0, 'мм', 1, 0, 'шт', v_actor
  ) returning id into v_source_second;
  v_reservation_first := pg_temp.add_reserved_bar(
    v_actor, v_machine_partial, v_material, v_variant_partial,
    v_request_item, v_source_first, 6000, 1001
  );
  v_reservation_second := pg_temp.add_reserved_bar(
    v_actor, v_machine_partial, v_material, v_variant_partial,
    v_request_item, v_source_second, 8000, 1001
  );
  v_fact := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact, v_factory, current_date, 'day', v_machine_partial, v_section, v_actor, v_actor
  );
  v_blocked := false;
  begin
    perform public.fn_apply_production_fact_cutting(v_fact, v_actor);
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%физических: 2, сопоставлено: 1%' then raise; end if;
    v_blocked := true;
  end;
  if not v_blocked
    or exists (select 1 from public.production_fact_cutting_events where fact_id = v_fact)
    or (select total_quantity from public.inventory where id = v_source_first) <> 6000
    or (select reserved_quantity from public.inventory where id = v_source_first) <> 6000
    or (select total_quantity from public.inventory where id = v_source_second) <> 8000
    or (select reserved_quantity from public.inventory where id = v_source_second) <> 8000
    or (select consumed_at from public.inventory_reservations where id = v_reservation_first) is not null
    or (select consumed_at from public.inventory_reservations where id = v_reservation_second) is not null
    or (select count(*) from public.long_stock_cutting_fact_bars where version_id = v_version) <> 0
    or (select count(*) from public.long_stock_cutting_business_scraps link
        join public.inventory inventory on inventory.id = link.inventory_id
        where link.version_id = v_version and inventory.business_scrap_state = 'future') <> 2 then
    raise exception 'Частичное сопоставление изменило склад или карту';
  end if;

  -- A linked planning position without an approved version cannot be cut.
  v_request := gen_random_uuid();
  v_request_item := gen_random_uuid();
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine_draft, v_actor);
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_request_item, v_request, 53, 'S355', 1000,
    v_material, v_variant_draft
  );
  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant_draft,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    v_actor
  );
  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant_draft, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_actor
  ) returning id into v_source_first;
  v_reservation_first := pg_temp.add_reserved_bar(
    v_actor, v_machine_draft, v_material, v_variant_draft,
    v_request_item, v_source_first, 6000, 1001
  );
  v_fact := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact, v_factory, current_date, 'day', v_machine_draft, v_section, v_actor, v_actor
  );
  v_blocked := false;
  begin
    perform public.fn_apply_production_fact_cutting(v_fact, v_actor);
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%нет утверждённой версии карты раскроя%' then raise; end if;
    v_blocked := true;
  end;
  if not v_blocked
    or exists (select 1 from public.production_fact_cutting_events where fact_id = v_fact)
    or (select total_quantity from public.inventory where id = v_source_first) <> 6000
    or (select reserved_quantity from public.inventory where id = v_source_first) <> 6000
    or (select consumed_at from public.inventory_reservations where id = v_reservation_first) is not null
    or not exists (
      select 1 from public.long_stock_cutting_plan_items
      where plan_id = v_plan and cutting_status = 'planning'
    ) then
    raise exception 'Резка без утверждённой версии изменила склад или позицию карты';
  end if;
end;
$$;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_section uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_machine_two uuid := gen_random_uuid();
  v_machine_sequence uuid := gen_random_uuid();
  v_machine_lengths uuid := gen_random_uuid();
  v_machine_remnant uuid := gen_random_uuid();
  v_variant_two uuid := gen_random_uuid();
  v_variant_sequence uuid := gen_random_uuid();
  v_variant_lengths uuid := gen_random_uuid();
  v_variant_remnant uuid := gen_random_uuid();
  v_plan_data jsonb;
  v_plan uuid;
  v_version uuid;
  v_request_item uuid;
  v_source uuid;
  v_source_second uuid;
  v_reservation_first uuid;
  v_reservation_second uuid;
  v_fact_first uuid;
  v_fact_second uuid;
  v_event_first uuid;
  v_event_repeat uuid;
  v_bar_first uuid;
  v_bar_second uuid;
  v_scrap_first uuid;
  v_scrap_second uuid;
  v_count integer;
  v_count_two integer;
  v_total numeric;
  v_state_first text;
  v_state_second text;
  v_status_first text;
  v_status_second text;
  v_preview jsonb;
  v_rollback jsonb;
  v_remnant_request uuid := gen_random_uuid();
  v_remnant_item uuid := gen_random_uuid();
  v_remnant_plan uuid;
  v_remnant_plan_item uuid;
  v_remnant_version uuid;
  v_remnant_source uuid := gen_random_uuid();
  v_remnant_result uuid;
  v_settings jsonb;
  v_kerf numeric;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then
    raise exception 'Для теста факта длинномера не найден завод';
  end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'long-stock-cutting-fact@example.test', 'Тест факта длинномера', 'technologist', v_factory, true);

  insert into public.production_fact_sections(
    id, factory_id, name, production_stage_type, created_by, updated_by
  ) values (
    v_section, v_factory, 'Заготовка · тест факта длинномера', 'cutting', v_actor, v_actor
  );

  insert into public.machines(id, factory_id, name, created_by) values
    (v_machine_two, v_factory, 'LONG-STOCK-FACT-TWO', v_actor),
    (v_machine_sequence, v_factory, 'LONG-STOCK-FACT-SEQUENCE', v_actor),
    (v_machine_lengths, v_factory, 'LONG-STOCK-FACT-LENGTHS', v_actor),
    (v_machine_remnant, v_factory, 'LONG-STOCK-FACT-REMNANT', v_actor);

  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Тестовый круг факта длинномера', 'circle', v_actor);

  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values
    (v_variant_two, v_material, 'circle', 41, 'S355', 6000, 2, 'мм'),
    (v_variant_sequence, v_material, 'circle', 42, 'S355', 6000, 2, 'мм'),
    (v_variant_lengths, v_material, 'circle', 43, 'S355', 6000, 2, 'мм'),
    (v_variant_remnant, v_material, 'circle', 44, 'S355', 6000, 2, 'мм');

  -- Two physical bars present at the fact: both plan bars close and each
  -- calculated remnant becomes a separate available inventory row.
  v_plan_data := pg_temp.create_new_stock_plan(
    v_actor, v_machine_two, v_material, v_variant_two,
    array[6000, 6000], array[1000::numeric, 1000::numeric]
  );
  v_plan := (v_plan_data->>'plan_id')::uuid;
  v_version := (v_plan_data->>'version_id')::uuid;
  v_request_item := (v_plan_data->>'request_item_id')::uuid;

  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant_two, 6000,
    12000, 0, 'мм', 2, 0, 'шт', v_actor
  ) returning id into v_source;

  perform pg_temp.add_reserved_bar(
    v_actor, v_machine_two, v_material, v_variant_two,
    v_request_item, v_source, 6000, 1001
  );
  perform pg_temp.add_reserved_bar(
    v_actor, v_machine_two, v_material, v_variant_two,
    v_request_item, v_source, 6000, 1001
  );

  v_fact_first := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact_first, v_factory, current_date, 'day', v_machine_two, v_section, v_actor, v_actor
  );
  v_event_first := public.fn_apply_production_fact_cutting(v_fact_first, v_actor);

  select count(*) filter (where bar.status = 'cut'),
         count(*) filter (where bar.status = 'planned')
  into v_count, v_count_two
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  where candidate.version_id = v_version and candidate.candidate_number = 1;
  if v_count <> 2 or v_count_two <> 0 then
    raise exception 'Факт с двумя доступными хлыстами закрыл неверный набор: cut=%, planned=%', v_count, v_count_two;
  end if;

  select count(*), sum(inventory.total_quantity)
  into v_count, v_total
  from public.long_stock_cutting_business_scraps scrap_link
  join public.inventory inventory on inventory.id = scrap_link.inventory_id
  where scrap_link.version_id = v_version
    and inventory.deleted_at is null
    and inventory.business_scrap_state = 'available';
  if v_count <> 2 or v_total <> 9998 then
    raise exception 'Два хлыста не создали два доступных расчётных остатка: count=%, total=%', v_count, v_total;
  end if;
  if (select total_quantity from public.inventory where id = v_source) <> 0
    or (select total_secondary_quantity from public.inventory where id = v_source) <> 0 then
    raise exception 'Исходные хлысты не списаны полностью';
  end if;
  if (select status from public.long_stock_cutting_plans where id = v_plan) <> 'closed' then
    raise exception 'План с полностью порезанными хлыстами не закрыт';
  end if;
  select count(*), sum(kerf_loss_length_mm + end_trim_loss_length_mm)
  into v_count, v_total
  from public.long_stock_cutting_actual_losses where version_id = v_version;
  if v_count <> 2 or v_total <> 2 then
    raise exception 'Потери двух хлыстов записаны неверно: count=%, length=%', v_count, v_total;
  end if;
  if exists (
    select 1 from public.inventory
    where material_variant_id = v_variant_two
      and deleted_at is null
      and is_business_scrap
      and piece_length_mm = 1
  ) then
    raise exception 'Потеря на пропил попала на склад';
  end if;
  if (select count(*) from public.long_stock_cutting_fact_bars where event_id = v_event_first) <> 2 then
    raise exception 'Не сохранено соответствие факта двум физическим хлыстам';
  end if;

  v_preview := public.fn_get_production_cutting_rollback_preview(v_machine_two);
  if v_preview->'blockers' @> jsonb_build_array('Деловой отход уже удален со склада') then
    raise exception 'Заменённый сводный остаток ошибочно заблокировал штатный откат: %', v_preview;
  end if;
  delete from public.production_machine_facts where id = v_fact_first;
  v_preview := public.fn_get_production_cutting_rollback_preview(v_machine_two);
  if coalesce((v_preview->>'canRollback')::boolean, false) is not true then
    raise exception 'Штатный откат факта длинномера заблокирован: %', v_preview;
  end if;
  v_rollback := public.fn_apply_production_cutting_rollback(
    v_machine_two, null, v_actor, 'Тест отката факта длинномера'
  );
  if (v_rollback#>>'{longStock,reopenedBars}')::integer <> 2
    or (v_rollback#>>'{longStock,reopenedPlans}')::integer <> 1
    or (select count(*) from public.long_stock_cutting_actual_losses where version_id = v_version) <> 0
    or (select count(*) from public.long_stock_cutting_fact_bars where event_id = v_event_first and rolled_back_at is not null) <> 2
    or (select count(*) from public.long_stock_cutting_candidate_bars bar join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id where candidate.version_id = v_version and bar.status = 'planned') <> 2
    or (select status from public.long_stock_cutting_plans where id = v_plan) <> 'open'
    or (select total_quantity from public.inventory where id = v_source) <> 12000
    or (select reserved_quantity from public.inventory where id = v_source) <> 12000 then
    raise exception 'Штатный откат не восстановил карту и физические хлысты: %', v_rollback;
  end if;

  -- One bar at the first fact, the second bar arrives later. Replaying the old
  -- fact must not consume it; a new fact closes the second plan bar.
  v_plan_data := pg_temp.create_new_stock_plan(
    v_actor, v_machine_sequence, v_material, v_variant_sequence,
    array[6000, 6000], array[1000::numeric, 1000::numeric]
  );
  v_plan := (v_plan_data->>'plan_id')::uuid;
  v_version := (v_plan_data->>'version_id')::uuid;
  v_request_item := (v_plan_data->>'request_item_id')::uuid;
  v_bar_first := (v_plan_data#>>'{bar_ids,0}')::uuid;
  v_bar_second := (v_plan_data#>>'{bar_ids,1}')::uuid;
  v_scrap_first := (v_plan_data#>>'{scrap_ids,0}')::uuid;
  v_scrap_second := (v_plan_data#>>'{scrap_ids,1}')::uuid;

  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant_sequence, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_actor
  ) returning id into v_source;
  v_reservation_first := pg_temp.add_reserved_bar(
    v_actor, v_machine_sequence, v_material, v_variant_sequence,
    v_request_item, v_source, 6000, 1001
  );

  v_fact_first := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact_first, v_factory, current_date, 'day', v_machine_sequence, v_section, v_actor, v_actor
  );
  v_event_first := public.fn_apply_production_fact_cutting(v_fact_first, v_actor);

  select status into v_status_first from public.long_stock_cutting_candidate_bars where id = v_bar_first;
  select status into v_status_second from public.long_stock_cutting_candidate_bars where id = v_bar_second;
  select business_scrap_state into v_state_first from public.inventory where id = v_scrap_first;
  select business_scrap_state into v_state_second from public.inventory where id = v_scrap_second;
  if v_status_first <> 'cut' or v_status_second <> 'planned'
    or v_state_first <> 'available' or v_state_second <> 'future' then
    raise exception 'Один доступный хлыст не сохранил порядок карты: statuses=%/%, scraps=%/%',
      v_status_first, v_status_second, v_state_first, v_state_second;
  end if;
  if (select status from public.long_stock_cutting_plans where id = v_plan) <> 'open' then
    raise exception 'Незавершённый план был закрыт после первого хлыста';
  end if;

  update public.inventory
  set total_quantity = total_quantity + 6000,
      total_secondary_quantity = coalesce(total_secondary_quantity, 0) + 1,
      last_updated_by = v_actor,
      updated_at = now()
  where id = v_source;
  v_reservation_second := pg_temp.add_reserved_bar(
    v_actor, v_machine_sequence, v_material, v_variant_sequence,
    v_request_item, v_source, 6000, 1001
  );

  v_event_repeat := public.fn_apply_production_fact_cutting(v_fact_first, v_actor);
  if v_event_repeat is distinct from v_event_first
    or (select status from public.long_stock_cutting_candidate_bars where id = v_bar_second) <> 'planned'
    or (select consumed_at from public.inventory_reservations where id = v_reservation_second) is not null
    or (select count(*) from public.long_stock_cutting_fact_bars where event_id = v_event_first) <> 1 then
    raise exception 'Повторный факт не идемпотентен или забрал поздний приход';
  end if;

  v_fact_second := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact_second, v_factory, current_date + 1, 'day', v_machine_sequence, v_section, v_actor, v_actor
  );
  perform public.fn_apply_production_fact_cutting(v_fact_second, v_actor);
  if (select status from public.long_stock_cutting_candidate_bars where id = v_bar_second) <> 'cut'
    or (select consumed_at from public.inventory_reservations where id = v_reservation_second) is null
    or (select business_scrap_state from public.inventory where id = v_scrap_second) <> 'available'
    or (select status from public.long_stock_cutting_plans where id = v_plan) <> 'closed' then
    raise exception 'Следующий факт не закрыл хлыст позднего прихода';
  end if;

  -- Exact length wins before the bar order: a 6000 mm physical bar closes the
  -- second plan row when bar #1 expects 7000 mm.
  v_plan_data := pg_temp.create_new_stock_plan(
    v_actor, v_machine_lengths, v_material, v_variant_lengths,
    array[7000, 6000], array[1000::numeric, 1000::numeric]
  );
  v_version := (v_plan_data->>'version_id')::uuid;
  v_request_item := (v_plan_data->>'request_item_id')::uuid;
  v_bar_first := (v_plan_data#>>'{bar_ids,0}')::uuid;
  v_bar_second := (v_plan_data#>>'{bar_ids,1}')::uuid;
  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant_lengths, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_actor
  ) returning id into v_source;
  perform pg_temp.add_reserved_bar(
    v_actor, v_machine_lengths, v_material, v_variant_lengths,
    v_request_item, v_source, 6000, 1001
  );
  v_fact_first := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact_first, v_factory, current_date, 'day', v_machine_lengths, v_section, v_actor, v_actor
  );
  perform public.fn_apply_production_fact_cutting(v_fact_first, v_actor);
  if (select status from public.long_stock_cutting_candidate_bars where id = v_bar_first) <> 'planned'
    or (select status from public.long_stock_cutting_candidate_bars where id = v_bar_second) <> 'cut' then
    raise exception 'Сопоставление хлыстов не отдало приоритет точной длине';
  end if;

  -- Cutting from an existing business remnant consumes the old identity in
  -- full and promotes the separately-created calculated remainder identity.
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_remnant_request, v_machine_remnant, v_actor);
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_remnant_item, v_remnant_request, 44, 'S355', 300,
    v_material, v_variant_remnant
  );
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap, business_scrap_state
  ) values (
    v_remnant_source, v_factory, v_material, v_variant_remnant, 400,
    400, 0, 'мм', 1, 0, 'шт', v_actor, true, 'available'
  );
  v_remnant_plan := public.fn_create_long_stock_cutting_plan(
    v_variant_remnant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_remnant_item
    )),
    v_actor
  );
  select id into v_remnant_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_remnant_plan and request_item_id = v_remnant_item;
  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_kerf := coalesce((v_settings->>'kerf_mm')::numeric, 0);
  v_remnant_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_remnant_plan,
    jsonb_build_object('test', 'business-remnant-fact', 'material_variant_id', v_variant_remnant),
    v_settings,
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_remnant_plan_item,
      'segment_number', 1,
      'required_length_mm', 300
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 0,
        'net_parts_length_mm', 300,
        'kerf_loss_length_mm', v_kerf,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 400 - 300 - v_kerf,
        'purchased_weight_kg', 0,
        'net_parts_weight_kg', 0.6,
        'kerf_loss_weight_kg', v_kerf * 2 / 1000,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', (400 - 300 - v_kerf) * 2 / 1000
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', 400,
        'length_group', null,
        'source_type', 'business_remnant',
        'source_inventory_id', v_remnant_source,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1,
          'segment_number', 1,
          'cut_length_mm', 300
        ))
      ))
    )),
    1,
    v_actor,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_remnant_version, v_actor);
  select scrap_link.inventory_id into v_remnant_result
  from public.long_stock_cutting_business_scraps scrap_link
  where scrap_link.version_id = v_remnant_version;

  v_fact_first := gen_random_uuid();
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact_first, v_factory, current_date, 'day', v_machine_remnant, v_section, v_actor, v_actor
  );
  perform public.fn_apply_production_fact_cutting(v_fact_first, v_actor);

  if v_remnant_result is null or v_remnant_result = v_remnant_source
    or (select total_quantity from public.inventory where id = v_remnant_source) <> 0
    or (select total_secondary_quantity from public.inventory where id = v_remnant_source) <> 0
    or (select piece_length_mm from public.inventory where id = v_remnant_result) <> 400 - 300 - v_kerf
    or (select business_scrap_state from public.inventory where id = v_remnant_result) <> 'available' then
    raise exception 'Резка складского остатка не заменила старый идентификатор новым расчётным остатком';
  end if;
  if not exists (
    select 1 from public.long_stock_cutting_actual_losses
    where version_id = v_remnant_version
      and kerf_loss_length_mm = v_kerf
      and end_trim_loss_length_mm = 0
  ) then
    raise exception 'Потеря складского остатка не записана аналитически';
  end if;
end;
$$;

do $$
declare
  v_actor uuid;
  v_factory uuid;
  v_section uuid;
  v_material uuid;
  v_all_plan_request uuid;
  v_completion uuid;
  v_snapshot public.technologist_request_plan_fact_items%rowtype;
  v_count integer;
  v_machine uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_plan_data jsonb;
  v_mixed_request uuid;
  v_request_item uuid;
  v_version uuid;
  v_source uuid;
  v_result_inventory uuid;
  v_fact uuid := gen_random_uuid();
  v_sheet_item uuid := gen_random_uuid();
  v_steel_type uuid;
  v_steel_grade text;
  v_sheet_weight numeric;
  v_original_kerf_weight numeric;
  v_mismatch_blocked boolean := false;
  v_payload jsonb;
begin
  select id, factory_id into v_actor, v_factory
  from public.users
  where email = 'long-stock-cutting-fact@example.test';
  select id into v_section
  from public.production_fact_sections
  where name = 'Заготовка · тест факта длинномера';
  select id into v_material
  from public.materials
  where name = 'Тестовый круг факта длинномера';
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  -- A request consisting only of planned long-stock positions finalizes with
  -- an empty percentage-waste list. Its immutable snapshot reconciles exactly.
  select request.id into v_all_plan_request
  from public.technologist_requests request
  join public.machines machine on machine.id = request.machine_id
  where machine.name = 'LONG-STOCK-FACT-SEQUENCE';
  update public.technologist_requests
  set status = 'pending_stock_check'
  where id = v_all_plan_request;

  v_completion := public.fn_finalize_technologist_request(
    v_all_plan_request, v_actor, 'none', 0, '[]'::jsonb, '[]'::jsonb
  );
  if v_completion is null then
    raise exception 'Заявка только с раскроем не закрылась без процента';
  end if;
  select * into v_snapshot
  from public.technologist_request_plan_fact_items
  where completion_id = v_completion;
  if not found
    or abs(v_snapshot.reconciliation_delta_kg) > 0.001
    or abs(
      v_snapshot.purchased_weight_kg
      - v_snapshot.net_weight_kg
      - v_snapshot.kerf_loss_weight_kg
      - v_snapshot.end_trim_loss_weight_kg
      - v_snapshot.business_scrap_weight_kg
    ) > 0.001 then
    raise exception 'Сверка весов фактов плана не сохранилась: %', row_to_json(v_snapshot);
  end if;
  select count(*) into v_count
  from public.technologist_request_waste_items
  where request_id = v_all_plan_request;
  if v_count <> 0 or exists (
    select 1 from public.metal_scrap_lots where request_id = v_all_plan_request
  ) then
    raise exception 'Плановая позиция создала процентный металлолом';
  end if;

  -- Mixed request: one circle is accounted by the closed plan facts and one
  -- sheet keeps the existing manual percentage behavior.
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'LONG-STOCK-FACT-COMPLETION-MIXED', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (
    v_variant, v_material, 'circle', 45, 'S355', 6000, 2, 'мм'
  );
  v_plan_data := pg_temp.create_new_stock_plan(
    v_actor, v_machine, v_material, v_variant,
    array[6000], array[1000::numeric]
  );
  v_mixed_request := (v_plan_data->>'request_id')::uuid;
  v_request_item := (v_plan_data->>'request_item_id')::uuid;
  v_version := (v_plan_data->>'version_id')::uuid;
  v_result_inventory := (v_plan_data#>>'{scrap_ids,0}')::uuid;

  insert into public.inventory(
    factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_factory, v_material, v_variant, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_actor
  ) returning id into v_source;
  perform pg_temp.add_reserved_bar(
    v_actor, v_machine, v_material, v_variant, v_request_item, v_source, 6000,
    1000 + (v_plan_data->>'kerf_mm')::numeric + (v_plan_data->>'end_trim_mm')::numeric
  );
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact, v_factory, current_date, 'day', v_machine, v_section, v_actor, v_actor
  );
  perform public.fn_apply_production_fact_cutting(v_fact, v_actor);
  if (select status from public.long_stock_cutting_plans where id = (v_plan_data->>'plan_id')::uuid) <> 'closed' then
    raise exception 'План смешанной заявки не закрыт фактом';
  end if;

  select id, name into v_steel_type, v_steel_grade
  from public.steel_types
  where density_kg_mm3 is not null
  order by name
  limit 1;
  insert into public.request_sheet_metal(
    id, request_id, material_name, material_grade,
    thickness_mm, sheet_size, quantity_sheets, remainder_qty,
    weight_order_kg, steel_type_id
  ) values (
    v_sheet_item, v_mixed_request, 'Лист тестовый', v_steel_grade,
    10, '100x100', 1, 1, 0, v_steel_type
  ) returning calculated_weight_kg into v_sheet_weight;
  if v_sheet_weight is null or v_sheet_weight <= 0 then
    raise exception 'Не рассчитан вес обычной позиции смешанной заявки';
  end if;
  update public.technologist_requests
  set status = 'pending_stock_check'
  where id = v_mixed_request;

  v_payload := jsonb_build_array(jsonb_build_object(
    'sourceTable', 'request_sheet_metal',
    'sourceId', v_sheet_item,
    'itemName', 'Лист тестовый · ' || v_steel_grade,
    'materialId', null,
    'materialVariantId', null,
    'materialName', 'Лист тестовый',
    'materialGrade', v_steel_grade,
    'wastePercent', 10
  ));

  -- An artificial one-kilogram distortion of an immutable analytical loss
  -- must block finalization and name the concrete plan position.
  select kerf_loss_weight_kg into v_original_kerf_weight
  from public.long_stock_cutting_actual_losses
  where version_id = v_version;
  execute 'alter table public.long_stock_cutting_actual_losses disable trigger long_stock_cutting_actual_loss_guard_trigger';
  update public.long_stock_cutting_actual_losses
  set kerf_loss_weight_kg = kerf_loss_weight_kg + 1
  where version_id = v_version;
  execute 'alter table public.long_stock_cutting_actual_losses enable trigger long_stock_cutting_actual_loss_guard_trigger';
  begin
    perform public.fn_finalize_technologist_request(
      v_mixed_request, v_actor, 'none', 0, v_payload, '[]'::jsonb
    );
  exception when others then
    if position('Сверка веса не сошлась' in sqlerrm) = 0
      or position('Круг Ø45 мм' in sqlerrm) = 0 then
      raise exception 'Расхождение заблокировало закрытие неверной ошибкой: %', sqlerrm;
    end if;
    v_mismatch_blocked := true;
  end;
  if not v_mismatch_blocked then
    raise exception 'Искусственное расхождение веса не заблокировало закрытие';
  end if;
  if exists (
    select 1 from public.technologist_request_completions where request_id = v_mixed_request
  ) then
    raise exception 'Заблокированное закрытие оставило частичный completion';
  end if;
  execute 'alter table public.long_stock_cutting_actual_losses disable trigger long_stock_cutting_actual_loss_guard_trigger';
  update public.long_stock_cutting_actual_losses
  set kerf_loss_weight_kg = v_original_kerf_weight
  where version_id = v_version;
  execute 'alter table public.long_stock_cutting_actual_losses enable trigger long_stock_cutting_actual_loss_guard_trigger';

  v_completion := public.fn_finalize_technologist_request(
    v_mixed_request, v_actor, 'none', 0, v_payload, '[]'::jsonb
  );
  if (select count(*) from public.technologist_request_plan_fact_items where completion_id = v_completion) <> 1
    or (select count(*) from public.technologist_request_waste_items where completion_id = v_completion) <> 1
    or exists (
      select 1 from public.technologist_request_waste_items
      where completion_id = v_completion
        and source_table = 'request_circle'
    ) then
    raise exception 'Смешанная заявка неверно разделила факты плана и процент';
  end if;
  if not exists (
    select 1
    from public.technologist_request_waste_items waste
    join public.metal_scrap_lots lot on lot.waste_item_id = waste.id
    where waste.completion_id = v_completion
      and waste.source_table = 'request_sheet_metal'
      and waste.waste_percent = 10
      and abs(waste.scrap_weight_kg - round(v_sheet_weight * 0.1, 3)) <= 0.001
      and abs(lot.expected_weight_kg - waste.scrap_weight_kg) <= 0.001
  ) then
    raise exception 'Процент смешанной заявки не применён к обычной позиции';
  end if;
  if abs((
    select reconciliation_delta_kg
    from public.technologist_request_plan_fact_items
    where completion_id = v_completion
  )) > 0.001 then
    raise exception 'После восстановления данных смешанная заявка не прошла сверку';
  end if;
end;
$$;

do $$
declare
  v_actor uuid;
  v_factory uuid;
  v_material uuid;
  v_variant uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_single uuid := gen_random_uuid();
  v_reserved uuid := gen_random_uuid();
  v_batch_good uuid := gen_random_uuid();
  v_batch_reserved uuid := gen_random_uuid();
  v_lot uuid;
  v_result jsonb;
  v_plan_data jsonb;
  v_short_inventory uuid;
  v_short_length numeric;
  v_source_request uuid;
  v_blocked boolean := false;
  v_batch_blocked boolean := false;
  v_repeat_blocked boolean := false;
  v_constraint_blocked boolean := false;
begin
  select id, factory_id into v_actor, v_factory
  from public.users
  where email = 'long-stock-cutting-fact@example.test';
  select id into v_material
  from public.materials
  where name = 'Тестовый круг факта длинномера';
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'BUSINESS-SCRAP-TO-METAL-TEST', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (
    v_variant, v_material, 'circle', 46, 'S355', 6000, 2, 'мм'
  );

  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    calculated_weight_kg, is_business_scrap, business_scrap_state, last_updated_by
  ) values
    (v_single, v_factory, v_material, v_variant, 400, 400, 0, 'мм', 1, 0, 'шт', 0.8, true, 'available', v_actor),
    (v_reserved, v_factory, v_material, v_variant, 500, 500, 100, 'мм', 1, 0, 'шт', 1.0, true, 'available', v_actor),
    (v_batch_good, v_factory, v_material, v_variant, 600, 600, 0, 'мм', 1, 0, 'шт', 1.2, true, 'available', v_actor),
    (v_batch_reserved, v_factory, v_material, v_variant, 700, 700, 100, 'мм', 1, 0, 'шт', 1.4, true, 'available', v_actor);

  v_result := public.fn_convert_business_scrap_to_metal_v1(array[v_single], v_actor);
  select id into v_lot
  from public.metal_scrap_lots
  where source_inventory_id = v_single;
  if (v_result->>'count')::integer <> 1
    or abs((v_result->>'total_weight_kg')::numeric - 0.8) > 0.001
    or (select deleted_at from public.inventory where id = v_single) is null
    or (select total_quantity from public.inventory where id = v_single) <> 0
    or not exists (
      select 1 from public.metal_scrap_lots lot
      where lot.id = v_lot
        and lot.source_type = 'inventory_conversion'
        and lot.request_id is null
        and lot.waste_item_id is null
        and lot.machine_id is null
        and lot.status = 'available'
        and abs(lot.expected_weight_kg - 0.8) <= 0.001
        and abs(lot.available_weight_kg - 0.8) <= 0.001
    ) then
    raise exception 'Перевод делового остатка не списал строку или создал неверный лот: %', v_result;
  end if;
  if not exists (
    select 1 from public.metal_scrap_movements movement
    where movement.lot_id = v_lot
      and movement.movement_type = 'inventory_conversion'
      and abs(movement.weight_delta_kg - 0.8) <= 0.001
  ) or not exists (
    select 1 from public.inventory_transactions transaction
    where transaction.inventory_id = v_single
      and transaction.transaction_type = 'write_off'
      and transaction.quantity = -400
      and transaction.secondary_quantity = -1
  ) then
    raise exception 'Перевод делового остатка не записал движения и аудит';
  end if;

  begin
    perform public.fn_convert_business_scrap_to_metal_v1(array[v_reserved], v_actor);
  exception when others then
    if position('забронирован' in sqlerrm) = 0 then
      raise exception 'Бронь заблокировала перевод неверной ошибкой: %', sqlerrm;
    end if;
    v_blocked := true;
  end;
  if not v_blocked
    or (select deleted_at from public.inventory where id = v_reserved) is not null
    or exists (select 1 from public.metal_scrap_lots where source_inventory_id = v_reserved) then
    raise exception 'Забронированный деловой остаток был переведён';
  end if;

  begin
    perform public.fn_convert_business_scrap_to_metal_v1(
      array[v_batch_good, v_batch_reserved], v_actor
    );
  exception when others then
    if position('забронирован' in sqlerrm) = 0 then
      raise exception 'Пакет заблокирован неверной ошибкой: %', sqlerrm;
    end if;
    v_batch_blocked := true;
  end;
  if not v_batch_blocked
    or (select deleted_at from public.inventory where id = v_batch_good) is not null
    or exists (
      select 1 from public.metal_scrap_lots
      where source_inventory_id in (v_batch_good, v_batch_reserved)
    ) then
    raise exception 'Пакетный перевод оставил частичный результат';
  end if;

  begin
    perform public.fn_convert_business_scrap_to_metal_v1(array[v_single], v_actor);
  exception when others then
    v_repeat_blocked := true;
  end;
  if not v_repeat_blocked
    or (select count(*) from public.metal_scrap_lots where source_inventory_id = v_single) <> 1
    or to_regprocedure('public.fn_restore_business_scrap_from_metal_v1(uuid,uuid)') is not null then
    raise exception 'Обратная или повторная операция неожиданно доступна';
  end if;

  select id into v_source_request from public.technologist_requests order by created_at limit 1;
  begin
    insert into public.metal_scrap_lots(
      source_type, source_inventory_id, request_id,
      factory_id, created_by, material_id, material_variant_id,
      material_name, material_grade, expected_weight_kg, available_weight_kg, status
    ) values (
      'inventory_conversion', v_batch_good, v_source_request,
      v_factory, v_actor, v_material, v_variant,
      'Неверный тестовый источник', 'S355', 1.2, 1.2, 'available'
    );
  exception when check_violation then
    v_constraint_blocked := true;
  end;
  if not v_constraint_blocked then
    raise exception 'Условное ограничение источника лота не сработало';
  end if;

  -- Raising the display threshold must not suppress a positive remainder.
  update public.long_stock_layout_categories
  set minimum_useful_length_mm = 1000
  where key = 'circle';
  v_plan_data := pg_temp.create_new_stock_plan(
    v_actor, v_machine, v_material, v_variant,
    array[6000], array[5500::numeric]
  );
  v_short_inventory := (v_plan_data#>>'{scrap_ids,0}')::uuid;
  select piece_length_mm into v_short_length
  from public.inventory
  where id = v_short_inventory;
  if v_short_inventory is null or v_short_length is null
    or v_short_length <= 0 or v_short_length >= 1000 then
    raise exception 'Остаток короче визуального порога не был создан: %', v_plan_data;
  end if;

  update public.long_stock_layout_categories
  set minimum_useful_length_mm = 100
  where key = 'circle';
  if not exists (
    select 1 from public.inventory inventory
    where inventory.id = v_short_inventory
      and inventory.piece_length_mm = v_short_length
      and inventory.total_quantity = v_short_length
      and inventory.is_business_scrap
      and inventory.business_scrap_state = 'future'
      and inventory.deleted_at is null
  ) then
    raise exception 'Изменение визуального порога изменило существующий складской остаток';
  end if;
end;
$$;

rollback;

\echo '[long-stock-cutting-fact] all assertions passed'
