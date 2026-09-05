BEGIN;

DO $test$
DECLARE
  v_actor constant uuid := '91000000-0000-0000-0000-000000000001';
  v_factory_a constant uuid := '92000000-0000-0000-0000-000000000001';
  v_factory_b constant uuid := '92000000-0000-0000-0000-000000000002';
  v_machine constant uuid := '93000000-0000-0000-0000-000000000001';
  v_other_machine constant uuid := '93000000-0000-0000-0000-000000000002';
  v_delete_machine constant uuid := '93000000-0000-0000-0000-000000000003';
  v_fact_machine constant uuid := '93000000-0000-0000-0000-000000000004';
  v_archived_delete_machine constant uuid := '93000000-0000-0000-0000-000000000005';
  v_material constant uuid := '94000000-0000-0000-0000-000000000001';
  v_variant constant uuid := '94000000-0000-0000-0000-000000000002';
  v_request constant uuid := '95000000-0000-0000-0000-000000000001';
  v_other_request constant uuid := '95000000-0000-0000-0000-000000000002';
  v_delete_request constant uuid := '95000000-0000-0000-0000-000000000003';
  v_fact_request constant uuid := '95000000-0000-0000-0000-000000000004';
  v_archived_delete_request constant uuid := '95000000-0000-0000-0000-000000000005';
  v_pipe_stock_item constant uuid := '96000000-0000-0000-0000-000000000001';
  v_pipe_transfer_item constant uuid := '96000000-0000-0000-0000-000000000002';
  v_pipe_supply_item constant uuid := '96000000-0000-0000-0000-000000000003';
  v_other_pipe_item constant uuid := '96000000-0000-0000-0000-000000000004';
  v_delete_pipe_item constant uuid := '96000000-0000-0000-0000-000000000005';
  v_pipe_delivered_item constant uuid := '96000000-0000-0000-0000-000000000006';
  v_archived_delete_pipe_item constant uuid := '96000000-0000-0000-0000-000000000007';
  v_stock constant uuid := '97000000-0000-0000-0000-000000000001';
  v_transfer_stock constant uuid := '97000000-0000-0000-0000-000000000002';
  v_future_scrap_a constant uuid := '97000000-0000-0000-0000-000000000003';
  v_future_scrap_b constant uuid := '97000000-0000-0000-0000-000000000004';
  v_delete_stock constant uuid := '97000000-0000-0000-0000-000000000005';
  v_stock_reservation constant uuid := '98000000-0000-0000-0000-000000000001';
  v_transfer_reservation constant uuid := '98000000-0000-0000-0000-000000000002';
  v_delete_reservation constant uuid := '98000000-0000-0000-0000-000000000003';
  v_inventory_transfer constant uuid := '99000000-0000-0000-0000-000000000001';
  v_other_inventory_transfer constant uuid := '99000000-0000-0000-0000-000000000002';
  v_inventory_transfer_item constant uuid := '99000000-0000-0000-0000-000000000003';
  v_part constant uuid := '9a000000-0000-0000-0000-000000000001';
  v_detailing_reservation constant uuid := '9a000000-0000-0000-0000-000000000002';
  v_detailing_transfer constant uuid := '9a000000-0000-0000-0000-000000000003';
  v_detailing_transfer_item constant uuid := '9a000000-0000-0000-0000-000000000004';
  v_future_batch constant uuid := '9a000000-0000-0000-0000-000000000005';
  v_future_item constant uuid := '9a000000-0000-0000-0000-000000000006';
  v_confirmed_part constant uuid := '9a000000-0000-0000-0000-000000000007';
  v_confirmed_future_item constant uuid := '9a000000-0000-0000-0000-000000000008';
  v_schedule constant uuid := '9b000000-0000-0000-0000-000000000001';
  v_delivered_schedule constant uuid := '9b000000-0000-0000-0000-000000000002';
  v_work_type constant uuid := '9c000000-0000-0000-0000-000000000001';
  v_operation constant uuid := '9c000000-0000-0000-0000-000000000002';
  v_outsourcing_need constant uuid := '9c000000-0000-0000-0000-000000000003';
  v_single_trip constant uuid := '9d000000-0000-0000-0000-000000000001';
  v_mixed_trip constant uuid := '9d000000-0000-0000-0000-000000000002';
  v_started_trip constant uuid := '9d000000-0000-0000-0000-000000000003';
  v_producer_plan constant uuid := 'a0000000-0000-0000-0000-000000000001';
  v_producer_plan_item constant uuid := 'a0000000-0000-0000-0000-000000000002';
  v_producer_version constant uuid := 'a0000000-0000-0000-0000-000000000003';
  v_producer_candidate constant uuid := 'a0000000-0000-0000-0000-000000000004';
  v_producer_bar constant uuid := 'a0000000-0000-0000-0000-000000000005';
  v_producer_segment constant uuid := 'a0000000-0000-0000-0000-000000000006';
  v_producer_cut constant uuid := 'a0000000-0000-0000-0000-000000000007';
  v_consumer_plan constant uuid := 'a1000000-0000-0000-0000-000000000001';
  v_consumer_plan_item constant uuid := 'a1000000-0000-0000-0000-000000000002';
  v_consumer_version constant uuid := 'a1000000-0000-0000-0000-000000000003';
  v_consumer_candidate constant uuid := 'a1000000-0000-0000-0000-000000000004';
  v_consumer_bar constant uuid := 'a1000000-0000-0000-0000-000000000005';
  v_consumer_reservation constant uuid := 'a1000000-0000-0000-0000-000000000006';
  v_dependency constant uuid := 'a1000000-0000-0000-0000-000000000007';
  v_result jsonb;
  v_failed boolean := false;
  v_fact_section uuid;
BEGIN
  INSERT INTO public.factories(id, name, city) VALUES
    (v_factory_a, 'Cleanup factory A', 'Cleanup A'),
    (v_factory_b, 'Cleanup factory B', 'Cleanup B');

  INSERT INTO public.users(id, email, full_name, role, factory_id)
  VALUES (v_actor, 'cleanup-director@example.test', 'Cleanup Director', 'planning_director', v_factory_a);

  INSERT INTO public.machines(
    id, name, created_by, factory_id, production_month, production_workshop,
    production_queue_number
  ) VALUES
    (v_machine, 'Cleanup archive order', v_actor, v_factory_a, '2026-09-01', 1, 1),
    (v_other_machine, 'Mixed trip survivor', v_actor, v_factory_a, '2026-09-01', 1, 2),
    (v_delete_machine, 'Cleanup delete order', v_actor, v_factory_a, '2026-09-01', 1, 3),
    (v_fact_machine, 'Cleanup immutable order', v_actor, v_factory_a, '2026-09-01', 1, 4),
    (v_archived_delete_machine, 'Cleanup archived delete order', v_actor, v_factory_a, '2026-09-01', 1, 5);

  INSERT INTO public.technologist_requests(id, machine_id, created_by, status) VALUES
    (v_request, v_machine, v_actor, 'submitted_to_supply'),
    (v_other_request, v_other_machine, v_actor, 'submitted_to_supply'),
    (v_delete_request, v_delete_machine, v_actor, 'submitted_to_supply'),
    (v_fact_request, v_fact_machine, v_actor, 'submitted_to_supply'),
    (v_archived_delete_request, v_archived_delete_machine, v_actor, 'submitted_to_supply');

  INSERT INTO public.materials(id, name, category, created_by)
  VALUES (v_material, 'Cleanup square pipe', 'pipe', v_actor);
  INSERT INTO public.material_variants(
    id, material_id, category, pipe_type, width_mm, height_mm,
    wall_thickness_mm, standard_length_mm, weight_per_m_kg, default_unit
  ) VALUES (
    v_variant, v_material, 'pipe', 'square', 40, 40, 10, 12000, 10, 'мм'
  );

  INSERT INTO public.request_pipe(
    id, request_id, pipe_type, size, wall_thickness_mm, remainder_length_mm,
    remainder_qty, remainder_kg, material_id, material_variant_id,
    reserved_from_stock_length_mm, reserved_from_stock_qty, reserved_from_stock_kg,
    order_status
  ) VALUES
    (v_pipe_stock_item, v_request, 'square', '40x40', 10, 12000, 1, 120,
      v_material, v_variant, 12000, 1, 120, 'pending'),
    (v_pipe_transfer_item, v_request, 'square', '40x40', 10, 12000, 1, 120,
      v_material, v_variant, 8000, 1, 80, 'ordered'),
    (v_pipe_supply_item, v_request, 'square', '40x40', 10, 13000, 10, 130,
      v_material, v_variant, 0, 0, 0, 'ordered'),
    (v_other_pipe_item, v_other_request, 'square', '40x40', 10, 1000, 1, 10,
      v_material, v_variant, 0, 0, 0, 'pending'),
    (v_delete_pipe_item, v_delete_request, 'square', '40x40', 10, 100, 1, 1,
      v_material, v_variant, 100, 1, 1, 'pending'),
    (v_pipe_delivered_item, v_request, 'square', '40x40', 10, 500, 1, 5,
      v_material, v_variant, 0, 0, 0, 'delivered'),
    (v_archived_delete_pipe_item, v_archived_delete_request, 'square', '40x40', 10, 500, 1, 5,
      v_material, v_variant, 0, 0, 0, 'pending');
  UPDATE public.request_pipe
  SET delivered_at = '2026-09-04 09:00:00+00'
  WHERE id = v_pipe_delivered_item;

  INSERT INTO public.inventory(
    id, factory_id, material_id, material_variant_id, total_quantity,
    reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, piece_length_mm, last_updated_by
  ) VALUES
    (v_stock, v_factory_a, v_material, v_variant, 12000, 12000, 'мм', 1, 1, 'шт', 12000, v_actor),
    (v_transfer_stock, v_factory_b, v_material, v_variant, 8000, 8000, 'мм', 1, 1, 'шт', 8000, v_actor),
    (v_delete_stock, v_factory_a, v_material, v_variant, 100, 100, 'мм', 1, 1, 'шт', 100, v_actor);

  INSERT INTO public.inventory(
    id, factory_id, material_id, material_variant_id, total_quantity,
    reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, piece_length_mm,
    is_business_scrap, business_scrap_state, source_machine_id, last_updated_by
  ) VALUES
    (v_future_scrap_a, v_factory_a, v_material, v_variant, 4688, 0, 'мм', 1, 0, 'шт', 4688,
      true, 'future', v_machine, v_actor),
    (v_future_scrap_b, v_factory_a, v_material, v_variant, 272, 0, 'мм', 1, 0, 'шт', 272,
      true, 'future', v_machine, v_actor);

  INSERT INTO public.inventory_reservations(
    id, inventory_id, source_inventory_id, material_id, material_variant_id,
    machine_id, request_item_table, request_item_id, reserved_quantity,
    reserved_secondary_quantity, reserved_by, reservation_source
  ) VALUES
    (v_stock_reservation, v_stock, v_stock, v_material, v_variant, v_machine,
      'request_pipe', v_pipe_stock_item, 12000, 1, v_actor, 'stock'),
    (v_transfer_reservation, v_transfer_stock, v_transfer_stock, v_material, v_variant, v_machine,
      'request_pipe', v_pipe_transfer_item, 8000, 1, v_actor, 'stock'),
    (v_delete_reservation, v_delete_stock, v_delete_stock, v_material, v_variant, v_delete_machine,
      'request_pipe', v_delete_pipe_item, 100, 1, v_actor, 'stock');

  INSERT INTO public.inventory_transfers(
    id, machine_id, source_factory_id, destination_factory_id, status,
    expected_arrival_date, created_by, updated_by
  ) VALUES
    (v_inventory_transfer, v_machine, v_factory_b, v_factory_a, 'partially_received',
      '2026-09-10', v_actor, v_actor),
    (v_other_inventory_transfer, v_other_machine, v_factory_a, v_factory_b, 'scheduled',
      '2026-09-10', v_actor, v_actor);

  INSERT INTO public.inventory_transfer_items(
    id, transfer_id, source_inventory_id, material_id, material_variant_id,
    request_item_table, request_item_id, requested_quantity, received_quantity,
    requested_secondary_quantity, received_secondary_quantity, unit, secondary_unit,
    piece_length_mm
  ) VALUES (
    v_inventory_transfer_item, v_inventory_transfer, v_transfer_stock, v_material, v_variant,
    'request_pipe', v_pipe_transfer_item, 12000, 4000, 1.5, 0.5, 'мм', 'шт', 8000
  );
  UPDATE public.inventory_reservations
  SET inventory_transfer_item_id = v_inventory_transfer_item
  WHERE id = v_transfer_reservation;

  INSERT INTO public.detailing_parts(id, name, drawing_number, unit_weight_kg, created_by, updated_by)
  VALUES
    (v_part, 'Cleanup part', 'CLEANUP-001', 1, v_actor, v_actor),
    (v_confirmed_part, 'Confirmed cleanup part', 'CLEANUP-002', 1, v_actor, v_actor);
  INSERT INTO public.detailing_balances(part_id, factory_id, on_hand_quantity, reserved_quantity, updated_by)
  VALUES
    (v_part, v_factory_b, 6, 6, v_actor),
    (v_part, v_factory_a, 4, 4, v_actor);
  INSERT INTO public.detailing_reservations(
    id, request_id, machine_id, part_id, requested_quantity, status, reserved_by
  ) VALUES (v_detailing_reservation, v_request, v_machine, v_part, 10, 'active', v_actor);
  INSERT INTO public.detailing_reservation_allocations(reservation_id, factory_id, quantity)
  VALUES
    (v_detailing_reservation, v_factory_b, 6),
    (v_detailing_reservation, v_factory_a, 4);
  INSERT INTO public.detailing_transfers(
    id, machine_id, source_factory_id, destination_factory_id, status,
    expected_arrival_date, created_by, updated_by
  ) VALUES (
    v_detailing_transfer, v_machine, v_factory_b, v_factory_a,
    'partially_received', '2026-09-10', v_actor, v_actor
  );
  INSERT INTO public.detailing_transfer_items(
    id, transfer_id, reservation_id, part_id, requested_quantity, received_quantity
  ) VALUES (
    v_detailing_transfer_item, v_detailing_transfer, v_detailing_reservation, v_part, 10, 4
  );

  INSERT INTO public.future_detailing_batches(
    id, request_id, machine_id, factory_id, created_by, status, confirmation_due_date
  ) VALUES (
    v_future_batch, v_request, v_machine, v_factory_a, v_actor, 'awaiting_confirmation', '2026-09-11'
  );
  INSERT INTO public.future_detailing_items(id, batch_id, part_id, planned_quantity, status)
  VALUES
    (v_future_item, v_future_batch, v_part, 7, 'awaiting_confirmation'),
    (v_confirmed_future_item, v_future_batch, v_confirmed_part, 3, 'confirmed');
  UPDATE public.future_detailing_items
  SET actual_quantity = 3
  WHERE id = v_confirmed_future_item;

  INSERT INTO public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, created_by, updated_by
  ) VALUES (
    v_schedule, 'request_pipe', v_pipe_supply_item, '2026-09-12', 13000, 'мм',
    'planned', v_actor, v_actor
  ), (
    v_delivered_schedule, 'request_pipe', v_pipe_delivered_item, '2026-09-04', 500, 'мм',
    'delivered', v_actor, v_actor
  );
  UPDATE public.supply_order_delivery_schedules
  SET received_quantity = 500,
      delivered_at = '2026-09-04 09:00:00+00',
      received_by = v_actor
  WHERE id = v_delivered_schedule;

  INSERT INTO public.outsourcing_work_types(id, code, name)
  VALUES (v_work_type, 'cleanup-test', 'Cleanup outsourcing');
  INSERT INTO public.machine_outsourcing_operations(
    id, machine_id, work_type_id, executor_type, executor_factory_id,
    planned_send_date, planned_return_date, created_by, updated_by
  ) VALUES (
    v_operation, v_machine, v_work_type, 'factory', v_factory_b,
    '2026-09-10', '2026-09-12', v_actor, v_actor
  );
  INSERT INTO public.machine_outsourcing_transport_needs(
    id, operation_id, direction, plan_state, status, needed_date
  ) VALUES (
    v_outsourcing_need, v_operation, 'outbound', 'confirmed', 'linked', '2026-09-10'
  );

  INSERT INTO public.machine_outsourcing_transport_orders(
    id, direction, status, scheduled_date, price, route_start_key, route_start,
    route, created_by, updated_by
  ) VALUES
    (v_single_trip, 'outbound', 'found', '2026-09-10', 100,
      'factory:b', 'Cleanup B', 'Cleanup B → Cleanup A', v_actor, v_actor),
    (v_mixed_trip, 'mixed', 'found', '2026-09-10', 200,
      'factory:a', 'Other source', 'Other source → Cleanup B → Destination', v_actor, v_actor),
    (v_started_trip, 'outbound', 'in_transit', '2026-09-10', 300,
      'factory:a', 'Cleanup A', 'Cleanup A → Cleanup B', v_actor, v_actor);
  UPDATE public.machine_outsourcing_transport_orders
  SET started_at = '2026-09-10 08:00:00+00', started_by = v_actor
  WHERE id = v_started_trip;

  INSERT INTO public.transport_trip_stops(
    id, transport_order_id, client_key, sequence_no, stop_kind,
    point_key, point_label, status
  ) VALUES
    ('9e000000-0000-0000-0000-000000000001', v_single_trip, 'single-start', 0, 'start',
      'factory:b', 'Cleanup B', 'planned'),
    ('9e000000-0000-0000-0000-000000000002', v_single_trip, 'single-finish', 1, 'finish',
      'factory:a', 'Cleanup A', 'planned'),
    ('9e000000-0000-0000-0000-000000000003', v_mixed_trip, 'other-start', 0, 'start',
      'other:source', 'Other source', 'planned'),
    ('9e000000-0000-0000-0000-000000000004', v_mixed_trip, 'cleanup-stop', 1, 'service',
      'factory:b', 'Cleanup B', 'planned'),
    ('9e000000-0000-0000-0000-000000000005', v_mixed_trip, 'shared-finish', 2, 'finish',
      'factory:a', 'Destination', 'planned');

  INSERT INTO public.transport_trip_need_links(
    transport_order_id, need_kind, need_source, need_id, direction,
    source_point_key, source_point_label, destination_point_key,
    destination_point_label, need_title, needed_date, pickup_stop_id,
    delivery_stop_id
  ) VALUES
    (v_single_trip, 'materials', 'inventory_transfer', v_inventory_transfer, 'outbound',
      'factory:b', 'Cleanup B', 'factory:a', 'Cleanup A', 'Cleanup material', '2026-09-10',
      '9e000000-0000-0000-0000-000000000001', '9e000000-0000-0000-0000-000000000002'),
    (v_mixed_trip, 'detailing', 'detailing_transfer', v_detailing_transfer, 'outbound',
      'factory:b', 'Cleanup B', 'factory:a', 'Destination', 'Cleanup detailing', '2026-09-10',
      '9e000000-0000-0000-0000-000000000004', '9e000000-0000-0000-0000-000000000005'),
    (v_mixed_trip, 'materials', 'inventory_transfer', v_other_inventory_transfer, 'outbound',
      'other:source', 'Other source', 'factory:a', 'Destination', 'Other material', '2026-09-10',
      '9e000000-0000-0000-0000-000000000003', '9e000000-0000-0000-0000-000000000005'),
    (v_started_trip, 'outsourcing', 'outsourcing', v_outsourcing_need, 'outbound',
      'factory:a', 'Cleanup A', 'factory:b', 'Cleanup B', 'Started outsourcing', '2026-09-10',
      NULL, NULL);
  UPDATE public.machine_outsourcing_transport_needs
  SET transport_order_id = v_started_trip
  WHERE id = v_outsourcing_need;

  -- Producer order creates a future remnant selected by another active order.
  -- The archive must invalidate that consumer through the normal dependency
  -- lifecycle before releasing and retiring the producer stock.
  INSERT INTO public.long_stock_cutting_plans(
    id, material_variant_id, layout_category_key, created_by
  ) VALUES
    (v_producer_plan, v_variant, 'pipe', v_actor),
    (v_consumer_plan, v_variant, 'pipe', v_actor);
  INSERT INTO public.long_stock_cutting_plan_items(
    id, plan_id, request_item_table, request_item_id, request_id, linked_by
  ) VALUES
    (v_producer_plan_item, v_producer_plan, 'request_pipe', v_pipe_stock_item, v_request, v_actor),
    (v_consumer_plan_item, v_consumer_plan, 'request_pipe', v_other_pipe_item, v_other_request, v_actor);

  PERFORM set_config('app.long_stock_cutting_version_create', '1', true);
  INSERT INTO public.long_stock_cutting_plan_versions(
    id, plan_id, version_number, input_snapshot, input_fingerprint,
    settings_snapshot, selected_candidate_number, status, created_by,
    approved_by, approved_at, definition_sealed
  ) VALUES
    (v_producer_version, v_producer_plan, 1, '{}'::jsonb,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{"kerf_mm":2,"end_trim_mm":0}'::jsonb,
      1, 'approved', v_actor, v_actor, now(), false),
    (v_consumer_version, v_consumer_plan, 1, '{}'::jsonb,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{"kerf_mm":2,"end_trim_mm":0}'::jsonb,
      1, 'approved', v_actor, v_actor, now(), false);
  PERFORM set_config('app.long_stock_cutting_version_create', '', true);

  INSERT INTO public.long_stock_cutting_segments(
    id, plan_id, version_id, plan_item_id, segment_number,
    required_length_mm, required_weight_kg
  ) VALUES (
    v_producer_segment, v_producer_plan, v_producer_version,
    v_producer_plan_item, 1, 1310, 13.1
  );

  INSERT INTO public.long_stock_cutting_candidates(
    id, version_id, candidate_number, purchased_length_mm,
    net_parts_length_mm, kerf_loss_length_mm, end_trim_loss_length_mm,
    business_scrap_length_mm, purchased_weight_kg, net_parts_weight_kg,
    kerf_loss_weight_kg, end_trim_loss_weight_kg, business_scrap_weight_kg,
    is_complete
  ) VALUES
    (v_producer_candidate, v_producer_version, 1, 6000, 1310, 2, 0, 4688,
      60, 13.1, 0.02, 0, 46.88, true),
    (v_consumer_candidate, v_consumer_version, 1, 4688, 4686, 2, 0, 0,
      46.88, 46.86, 0.02, 0, 0, true);
  INSERT INTO public.long_stock_cutting_candidate_bars(
    id, version_id, candidate_id, bar_number, stock_length_mm,
    length_group, source_type, source_inventory_id
  ) VALUES
    (v_producer_bar, v_producer_version, v_producer_candidate, 1, 6000,
      'standard', 'new_stock', NULL),
    (v_consumer_bar, v_consumer_version, v_consumer_candidate, 1, 4688,
      NULL, 'future_business_remnant', v_future_scrap_a);
  INSERT INTO public.long_stock_cutting_bar_cuts(
    id, version_id, candidate_id, bar_id, segment_id, cut_number, cut_length_mm
  ) VALUES (
    v_producer_cut, v_producer_version, v_producer_candidate,
    v_producer_bar, v_producer_segment, 1, 1310
  );

  PERFORM set_config('app.long_stock_cutting_version_lifecycle', '1', true);
  UPDATE public.long_stock_cutting_plan_versions
  SET definition_sealed = true
  WHERE id IN (v_producer_version, v_consumer_version);
  PERFORM set_config('app.long_stock_cutting_version_lifecycle', '', true);

  INSERT INTO public.long_stock_cutting_business_scraps(
    inventory_id, version_id, bar_id, linked_by
  ) VALUES (v_future_scrap_a, v_producer_version, v_producer_bar, v_actor);

  UPDATE public.inventory
  SET reserved_quantity = 4688, reserved_secondary_quantity = 1
  WHERE id = v_future_scrap_a;
  UPDATE public.request_pipe
  SET reserved_from_stock_length_mm = 4688, reserved_from_stock_qty = 1,
      reserved_from_stock_kg = 46.88
  WHERE id = v_other_pipe_item;
  PERFORM set_config('app.long_stock_source_selection', '1', true);
  INSERT INTO public.inventory_reservations(
    id, inventory_id, source_inventory_id, material_id, material_variant_id,
    machine_id, request_item_table, request_item_id, reserved_quantity,
    reserved_secondary_quantity, reserved_by, reservation_source
  ) VALUES (
    v_consumer_reservation, v_future_scrap_a, v_future_scrap_a, v_material, v_variant,
    v_other_machine, 'request_pipe', v_other_pipe_item, 4688, 1, v_actor, 'stock'
  );
  INSERT INTO public.long_stock_cutting_bar_reservations(
    version_id, bar_id, reservation_id
  ) VALUES (v_consumer_version, v_consumer_bar, v_consumer_reservation);
  INSERT INTO public.long_stock_cutting_source_dependencies(
    id, consumer_version_id, consumer_bar_id, source_inventory_id,
    producer_version_id, producer_bar_id, reservation_id,
    producer_cutting_date, consumer_cutting_date, status
  ) VALUES (
    v_dependency, v_consumer_version, v_consumer_bar, v_future_scrap_a,
    v_producer_version, v_producer_bar, v_consumer_reservation,
    '2026-09-10', '2026-09-12', 'waiting_for_source'
  );
  PERFORM set_config('app.long_stock_source_selection', '', true);

  INSERT INTO public.tasks(machine_id, assigned_to, task_type, title, status)
  VALUES (v_machine, v_actor, 'technologist_request', 'Cleanup active task', 'pending');

  INSERT INTO public.meeting_agenda_pool_items(
    source_key, source_type, machine_id, title
  ) VALUES (
    'cleanup-machine:' || v_machine::text,
    'sales_machine_unconfirmed',
    v_machine,
    'Cleanup agenda reference'
  );

  INSERT INTO public.production_fact_sections(factory_id, name, created_by, updated_by)
  VALUES (v_factory_a, 'Cleanup fact section', v_actor, v_actor)
  RETURNING id INTO v_fact_section;
  INSERT INTO public.production_machine_facts(
    factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) VALUES (
    v_factory_a, '2026-09-04', 'day', v_machine, v_fact_section, v_actor, v_actor
  );

  v_result := public.archive_machine_and_compact_production_queue(
    v_machine, v_actor, 'Тест полной очистки'
  );

  IF NOT (SELECT is_archived FROM public.machines WHERE id = v_machine) THEN
    RAISE EXCEPTION 'archive RPC did not archive the machine';
  END IF;
  IF (v_result->'cleanup'->>'inventoryReservationsReleased')::integer <> 2 THEN
    RAISE EXCEPTION 'cleanup summary has wrong inventory count: %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory_reservations
    WHERE machine_id = v_machine AND consumed_at IS NULL
  ) THEN RAISE EXCEPTION 'active inventory reservation survived archive'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.detailing_reservations
    WHERE machine_id = v_machine AND status IN ('active', 'partially_consumed')
  ) THEN RAISE EXCEPTION 'active detailing reservation survived archive'; END IF;
  IF (SELECT reserved_quantity FROM public.inventory WHERE id = v_stock) <> 0
     OR (SELECT available_quantity FROM public.inventory WHERE id = v_stock) <> 12000 THEN
    RAISE EXCEPTION 'ordinary stock was not restored';
  END IF;
  IF (SELECT status FROM public.inventory_transfers WHERE id = v_inventory_transfer) <> 'cancelled'
     OR (SELECT received_quantity FROM public.inventory_transfer_items WHERE id = v_inventory_transfer_item) <> 4000 THEN
    RAISE EXCEPTION 'partial material transfer fact was not preserved while cancelling remainder';
  END IF;
  IF (SELECT status FROM public.detailing_transfers WHERE id = v_detailing_transfer) <> 'cancelled'
     OR (SELECT received_quantity FROM public.detailing_transfer_items WHERE id = v_detailing_transfer_item) <> 4
     OR (SELECT requested_quantity FROM public.detailing_transfer_items WHERE id = v_detailing_transfer_item) <> 10 THEN
    RAISE EXCEPTION 'partial detailing transfer history was changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.detailing_balances
    WHERE part_id = v_part AND reserved_quantity <> 0
  ) THEN RAISE EXCEPTION 'detailing balance is still reserved'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id IN (v_future_scrap_a, v_future_scrap_b)
      AND (deleted_at IS NULL OR total_quantity <> 0 OR reserved_quantity <> 0)
  ) THEN RAISE EXCEPTION 'future business remnants survived archive'; END IF;
  IF (SELECT status FROM public.long_stock_cutting_source_dependencies WHERE id = v_dependency)
       <> 'invalidated'
     OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE id = v_consumer_reservation)
     OR (SELECT status FROM public.long_stock_cutting_plan_versions WHERE id = v_consumer_version)
       <> 'invalid'
     OR (SELECT status FROM public.long_stock_cutting_candidate_bars WHERE id = v_producer_bar)
       <> 'cancelled'
     OR (SELECT status FROM public.long_stock_cutting_plans WHERE id = v_producer_plan)
       <> 'closed' THEN
    RAISE EXCEPTION 'dependent long-stock map was not invalidated before producer cleanup';
  END IF;
  IF (SELECT order_status FROM public.request_pipe WHERE id = v_pipe_supply_item) <> 'cancelled'
     OR (SELECT status FROM public.supply_order_delivery_schedules WHERE id = v_schedule) <> 'cancelled' THEN
    RAISE EXCEPTION 'supply remainder survived archive';
  END IF;
  IF (SELECT status FROM public.future_detailing_batches WHERE id = v_future_batch) <> 'cancelled'
     OR (SELECT status FROM public.future_detailing_items WHERE id = v_future_item) <> 'cancelled' THEN
    RAISE EXCEPTION 'future detailing survived archive';
  END IF;
  IF (SELECT status FROM public.future_detailing_items WHERE id = v_confirmed_future_item) <> 'confirmed'
     OR (SELECT actual_quantity FROM public.future_detailing_items WHERE id = v_confirmed_future_item) <> 3 THEN
    RAISE EXCEPTION 'confirmed future detailing fact was changed';
  END IF;
  IF (SELECT order_status FROM public.request_pipe WHERE id = v_pipe_delivered_item) <> 'delivered'
     OR (SELECT status FROM public.supply_order_delivery_schedules WHERE id = v_delivered_schedule) <> 'delivered'
     OR (SELECT received_quantity FROM public.supply_order_delivery_schedules WHERE id = v_delivered_schedule) <> 500 THEN
    RAISE EXCEPTION 'delivered supply fact was changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.production_machine_facts WHERE machine_id = v_machine
  ) THEN RAISE EXCEPTION 'production fact was not preserved by archive'; END IF;
  IF (SELECT status FROM public.machine_outsourcing_transport_needs WHERE id = v_outsourcing_need) <> 'cancelled'
     OR (SELECT archived_at FROM public.machine_outsourcing_operations WHERE id = v_operation) IS NULL THEN
    RAISE EXCEPTION 'outsourcing remainder survived archive';
  END IF;
  IF (SELECT status FROM public.machine_outsourcing_transport_orders WHERE id = v_single_trip) <> 'cancelled' THEN
    RAISE EXCEPTION 'single-machine trip was not cancelled';
  END IF;
  IF (SELECT status FROM public.machine_outsourcing_transport_orders WHERE id = v_started_trip) <> 'cancelled'
     OR (SELECT started_at FROM public.machine_outsourcing_transport_orders WHERE id = v_started_trip) IS NULL THEN
    RAISE EXCEPTION 'started trip remainder/history was not handled correctly';
  END IF;
  IF (SELECT status FROM public.machine_outsourcing_transport_orders WHERE id = v_mixed_trip) <> 'found'
     OR (SELECT direction::text FROM public.machine_outsourcing_transport_orders WHERE id = v_mixed_trip) <> 'outbound'
     OR (SELECT route FROM public.machine_outsourcing_transport_orders WHERE id = v_mixed_trip)
        <> 'Other source → Destination' THEN
    RAISE EXCEPTION 'mixed trip was not preserved/recalculated';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transport_trip_need_links
    WHERE need_source IN ('inventory_transfer', 'detailing_transfer', 'outsourcing')
      AND public.fn_machine_for_transport_need_cleanup_v1(need_source, need_id) = v_machine
      AND released_at IS NULL
  ) THEN RAISE EXCEPTION 'archived machine still has an active trip link'; END IF;
  IF (SELECT count(*) FROM public.transport_trip_need_links
      WHERE transport_order_id = v_mixed_trip AND released_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'mixed trip lost another machine need';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND status IN ('pending', 'in_progress')
  ) THEN RAISE EXCEPTION 'active task survived archive'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.meeting_agenda_pool_items WHERE machine_id = v_machine
  ) OR (v_result->'cleanup'->>'agendaReferencesRemoved')::integer <> 1 THEN
    RAISE EXCEPTION 'agenda references were not removed atomically: %', v_result;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.machine_operational_cleanup_context_v1
    WHERE machine_id = v_machine
  ) THEN RAISE EXCEPTION 'cleanup authorization context leaked after archive'; END IF;

  v_failed := false;
  BEGIN
    UPDATE public.request_pipe
    SET cancellation_reason = 'Unauthorized history rewrite'
    WHERE id = v_pipe_stock_item;
  EXCEPTION WHEN OTHERS THEN
    v_failed := position('неизменяемая история' IN SQLERRM) > 0;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'cancelled long-stock history guard was weakened';
  END IF;

  v_result := public.fn_cleanup_machine_operational_dependencies_v1(
    v_machine, v_actor, 'Повторная очистка'
  );
  IF (v_result->>'inventoryReservationsReleased')::integer <> 0
     OR (v_result->>'futureScrapsRemoved')::integer <> 0
     OR (v_result->>'transportLinksReleased')::integer <> 0 THEN
    RAISE EXCEPTION 'cleanup is not idempotent: %', v_result;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM public.fn_delete_machine_with_inventory_cleanup(v_delete_machine, v_actor);
  IF EXISTS (SELECT 1 FROM public.machines WHERE id = v_delete_machine) THEN
    RAISE EXCEPTION 'fact-free machine was not physically deleted';
  END IF;
  IF (SELECT reserved_quantity FROM public.inventory WHERE id = v_delete_stock) <> 0 THEN
    RAISE EXCEPTION 'delete did not release stock reservation';
  END IF;

  v_result := public.archive_machine_and_compact_production_queue(
    v_archived_delete_machine, v_actor, 'Archive before permitted delete'
  );
  PERFORM public.fn_delete_machine_with_inventory_cleanup(v_archived_delete_machine, v_actor);
  IF EXISTS (SELECT 1 FROM public.machines WHERE id = v_archived_delete_machine) THEN
    RAISE EXCEPTION 'fact-free archived machine with cancelled request history was not deletable';
  END IF;

  INSERT INTO public.production_machine_facts(
    factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) VALUES (
    v_factory_a, '2026-09-05', 'day', v_fact_machine, v_fact_section, v_actor, v_actor
  );

  v_failed := false;
  BEGIN
    PERFORM public.fn_delete_machine_with_inventory_cleanup(v_fact_machine, v_actor);
  EXCEPTION WHEN OTHERS THEN
    v_failed := position('Архивируйте заказ вместо удаления' IN SQLERRM) > 0;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'machine with immutable production fact was deletable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.machines WHERE id = v_fact_machine) THEN
    RAISE EXCEPTION 'failed delete changed immutable machine';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.fn_cleanup_machine_operational_dependencies_v1(uuid,uuid,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.fn_cleanup_machine_operational_dependencies_v1(uuid,uuid,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.fn_cleanup_machine_operational_dependencies_v1(uuid,uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'cleanup RPC privileges are incorrect';
  END IF;
  IF has_table_privilege(
    'anon', 'public.machine_operational_cleanup_context_v1', 'INSERT'
  ) OR has_table_privilege(
    'authenticated', 'public.machine_operational_cleanup_context_v1', 'INSERT'
  ) OR has_table_privilege(
    'service_role', 'public.machine_operational_cleanup_context_v1', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'cleanup authorization context is writable by a client role';
  END IF;
END;
$test$;

ROLLBACK;
