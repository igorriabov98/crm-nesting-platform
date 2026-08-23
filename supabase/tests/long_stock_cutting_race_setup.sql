\set ON_ERROR_STOP on

begin;

create table public.test_long_stock_cutting_race_fixture (
  key text primary key,
  id uuid not null
);

do $$
declare
  v_actor uuid := '10000000-0000-4000-8000-000000000001';
  v_factory uuid;
  v_section uuid := '10000000-0000-4000-8000-000000000002';
  v_material uuid := '10000000-0000-4000-8000-000000000003';
  v_variant uuid := '10000000-0000-4000-8000-000000000004';
  v_machine uuid := '10000000-0000-4000-8000-000000000005';
  v_request uuid := '10000000-0000-4000-8000-000000000006';
  v_request_item uuid := '10000000-0000-4000-8000-000000000007';
  v_schedule uuid := '10000000-0000-4000-8000-000000000008';
  v_source_inventory uuid := '10000000-0000-4000-8000-000000000009';
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_reservation uuid;
  v_settings jsonb;
  v_rollback_machine uuid := '20000000-0000-4000-8000-000000000001';
  v_rollback_stage uuid;
  v_rollback_fact uuid := '20000000-0000-4000-8000-000000000003';
  v_rollback_event uuid := '20000000-0000-4000-8000-000000000004';
  v_move_source_machine uuid := '30000000-0000-4000-8000-000000000001';
  v_move_target_machine uuid := '30000000-0000-4000-8000-000000000002';
  v_move_fact uuid := '30000000-0000-4000-8000-000000000003';
  v_move_event uuid := '30000000-0000-4000-8000-000000000004';
begin
  select id into strict v_factory
  from public.factories
  order by created_at nulls last
  limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    'long-stock-cutting-races@example.test',
    'Тест конкурентного раскроя',
    'technologist',
    v_factory,
    true
  );
  insert into public.production_fact_sections(
    id, factory_id, name, production_stage_type, created_by, updated_by
  ) values (
    v_section,
    v_factory,
    'Заготовка · конкурентный тест',
    'cutting',
    v_actor,
    v_actor
  );
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Круг конкурентного теста', 'circle', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (
    v_variant, v_material, 'circle', 46, 'S355', 6000, 2, 'мм'
  );
  insert into public.machines(id, factory_id, name, created_by) values
    (v_machine, v_factory, 'LONG-STOCK-RACE-INVALIDATION', v_actor),
    (v_rollback_machine, v_factory, 'LONG-STOCK-RACE-ROLLBACK', v_actor),
    (v_move_source_machine, v_factory, 'LONG-STOCK-FACT-MOVE-SOURCE', v_actor),
    (v_move_target_machine, v_factory, 'LONG-STOCK-FACT-MOVE-TARGET', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_actor);
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_request_item, v_request, 46, 'S355', 1000, v_material, v_variant
  );

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    v_actor
  );
  select id into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan;

  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'invalidation-fact-race'),
    v_settings,
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', 1,
      'required_length_mm', 1000,
      'required_weight_kg', 2
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 6000,
        'net_parts_length_mm', 1000,
        'kerf_loss_length_mm', 1,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 4999,
        'purchased_weight_kg', 12,
        'net_parts_weight_kg', 2,
        'kerf_loss_weight_kg', 0.002,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 9.998
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', 6000,
        'length_group', 'standard',
        'source_type', 'new_stock',
        'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1,
          'segment_number', 1,
          'cut_length_mm', 1000
        ))
      ))
    )),
    1,
    v_actor,
    null,
    '{}'::jsonb
  );

  -- Matching receipt: it is only the immutable document used by the explicit
  -- invalidation transaction in the concurrent test.
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, planned_piece_length_mm, planned_piece_count,
    received_quantity, received_piece_length_mm, received_piece_count,
    delivered_at, received_by, created_by, updated_by
  ) values (
    v_schedule,
    'request_circle',
    v_request_item,
    current_date,
    6000,
    'мм',
    'delivered',
    6000,
    1,
    6000,
    6000,
    1,
    now(),
    v_actor,
    v_actor,
    v_actor
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version, v_actor);

  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_source_inventory, v_factory, v_material, v_variant, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_actor
  );
  insert into public.inventory_reservations(
    inventory_id, source_inventory_id, material_id, material_variant_id,
    machine_id, request_item_table, request_item_id,
    reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity,
    reserved_by, original_piece_length_mm, is_cut_reservation, reservation_source
  ) values (
    v_source_inventory, v_source_inventory, v_material, v_variant,
    v_machine, 'request_circle', v_request_item,
    6000, 1001, 1,
    v_actor, 6000, false, 'whole_bar_stock'
  ) returning id into v_reservation;
  update public.inventory
  set reserved_quantity = 6000,
      reserved_secondary_quantity = 1
  where id = v_source_inventory;

  -- A minimal valid rollback snapshot with no inventory rows. The fact row is
  -- deleted so preview permits rollback; the event remains applied.
  select id into strict v_rollback_stage
  from public.production_stages
  where machine_id = v_rollback_machine
    and stage_type = 'cutting';
  update public.production_stages
  set date_start = current_date,
      updated_by = v_actor
  where id = v_rollback_stage;
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_rollback_fact,
    v_factory,
    current_date,
    'day',
    v_rollback_machine,
    v_section,
    v_actor,
    v_actor
  );
  insert into public.production_fact_cutting_events(
    id, machine_id, factory_id, fact_id, section_id, fact_date, stage_id,
    previous_stage_date_start, applied_stage_date_start, created_by
  ) values (
    v_rollback_event,
    v_rollback_machine,
    v_factory,
    v_rollback_fact,
    v_section,
    current_date,
    v_rollback_stage,
    null,
    current_date,
    v_actor
  );
  delete from public.production_machine_facts where id = v_rollback_fact;

  -- Minimal historical cutting event: the move guard must reject before the
  -- idempotent fact application can return this old event for another machine.
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_move_fact,
    v_factory,
    current_date,
    'day',
    v_move_source_machine,
    v_section,
    v_actor,
    v_actor
  );
  insert into public.production_fact_cutting_events(
    id, machine_id, factory_id, fact_id, section_id, fact_date, created_by
  ) values (
    v_move_event,
    v_move_source_machine,
    v_factory,
    v_move_fact,
    v_section,
    current_date,
    v_actor
  );

  insert into public.test_long_stock_cutting_race_fixture(key, id) values
    ('actor', v_actor),
    ('factory', v_factory),
    ('section', v_section),
    ('invalidation_machine', v_machine),
    ('request_item', v_request_item),
    ('plan', v_plan),
    ('version', v_version),
    ('schedule', v_schedule),
    ('source_inventory', v_source_inventory),
    ('reservation', v_reservation),
    ('rollback_machine', v_rollback_machine),
    ('rollback_event', v_rollback_event),
    ('move_source_machine', v_move_source_machine),
    ('move_target_machine', v_move_target_machine),
    ('move_fact', v_move_fact),
    ('move_event', v_move_event);
end;
$$;

set constraints all immediate;
commit;

select jsonb_object_agg(key, id order by key)
from public.test_long_stock_cutting_race_fixture;
