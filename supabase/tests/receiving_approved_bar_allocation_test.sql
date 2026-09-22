\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE v_received_length numeric;
BEGIN
FOR v_received_length IN SELECT unnest(ARRAY[6000, 5900]) LOOP
DECLARE
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_segments jsonb;
  v_cuts jsonb;
  v_settings jsonb;
  v_error text;
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY created_at NULLS LAST LIMIT 1;
  IF v_factory IS NULL THEN RAISE EXCEPTION 'Full-schema factory fixture is required'; END IF;
  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
  VALUES (v_actor, 'approved-bar-' || v_actor || '@example.test', 'Approved bar receiving test', 'technologist', v_factory, true);
  INSERT INTO public.user_system_roles(user_id, role) VALUES (v_actor, 'crm_admin');
  IF NOT public.crm_user_is_admin(v_actor) THEN RAISE EXCEPTION 'Test administrator fixture is required'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_machine, v_factory, 'CIV-19 receiving regression', v_actor);
  INSERT INTO public.technologist_requests(id, machine_id, created_by, status)
  VALUES (v_request, v_machine, v_actor, 'submitted_to_supply');
  INSERT INTO public.suppliers(id, name) VALUES (v_supplier, 'Two-bar receiving test');
  INSERT INTO public.supplier_material_categories(supplier_id, category) VALUES (v_supplier, 'circle');
  INSERT INTO public.materials(id, name, category, default_supplier_id, created_by)
  VALUES (v_material, 'Круг Ø20 Hardox', 'circle', v_supplier, v_actor);
  INSERT INTO public.material_variants(id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit)
  VALUES (v_variant, v_material, 'circle', 20, 'Hardox', 6000, 2.45, 'мм');
  INSERT INTO public.request_circle(id, request_id, diameter_mm, steel_grade, remainder_mm, material_id, material_variant_id)
  VALUES (v_item, v_request, 20, 'Hardox', 6000, v_material, v_variant);

  v_plan := public.fn_create_long_stock_cutting_plan(v_variant,
    jsonb_build_array(jsonb_build_object('request_item_table', 'request_circle', 'request_item_id', v_item)), v_actor);
  SELECT id INTO STRICT v_plan_item FROM public.long_stock_cutting_plan_items WHERE plan_id = v_plan;
  SELECT jsonb_agg(jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', n, 'required_length_mm', 500) ORDER BY n)
    INTO v_segments FROM generate_series(1, 12) n;
  SELECT jsonb_agg(jsonb_build_object('cut_number', n, 'segment_number', n, 'cut_length_mm', 500) ORDER BY n)
    INTO v_cuts FROM generate_series(1, 11) n;
  v_settings := public.fn_get_long_stock_layout_settings_snapshot() || '{"kerf_mm":2,"end_trim_mm":10}'::jsonb;
  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan, jsonb_build_object('case', 'CIV-19: twelve cuts, two purchased bars'), v_settings, v_segments,
    jsonb_build_array(jsonb_build_object('candidate_number', 1, 'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 12000, 'net_parts_length_mm', 6000,
        'kerf_loss_length_mm', 24, 'end_trim_loss_length_mm', 20, 'business_scrap_length_mm', 5956,
        'purchased_weight_kg', 29.4, 'net_parts_weight_kg', 14.7,
        'kerf_loss_weight_kg', 0.0588, 'end_trim_loss_weight_kg', 0.049, 'business_scrap_weight_kg', 14.5922),
      'bars', jsonb_build_array(
        jsonb_build_object('bar_number', 1, 'stock_length_mm', 6000, 'length_group', 'standard',
          'source_type', 'new_stock', 'source_inventory_id', null, 'cuts', v_cuts),
        jsonb_build_object('bar_number', 2, 'stock_length_mm', 6000, 'length_group', 'standard',
          'source_type', 'new_stock', 'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object('cut_number', 1, 'segment_number', 12, 'cut_length_mm', 500)))
      ))), 1, v_actor, null, '{}'::jsonb);
  PERFORM public.fn_approve_long_stock_cutting_plan_version_v1(v_version, v_actor);
  UPDATE public.request_circle SET order_status = 'ordered', supplier_id = v_supplier, ordered_at = now() WHERE id = v_item;
  INSERT INTO public.supply_order_delivery_schedules(id, request_item_table, request_item_id,
    delivery_date, quantity, unit, supplier_id, planned_piece_length_mm, planned_piece_count, created_by, updated_by)
  VALUES
    (v_first, 'request_circle', v_item, current_date, 6000, 'мм', v_supplier, 6000, 1, v_actor, v_actor),
    (v_second, 'request_circle', v_item, current_date, 6000, 'мм', v_supplier, 6000, 1, v_actor, v_actor);

  IF v_received_length <> 6000 THEN
    PERFORM public.fn_receive_supply_order_schedule_batch_v1(jsonb_build_array(
      jsonb_build_object('schedule_id', v_first, 'received_quantity', v_received_length,
        'received_piece_length_mm', v_received_length, 'received_piece_count', 1,
        'allocations', jsonb_build_array(jsonb_build_object('table', 'request_circle', 'id', v_item,
          'quantity', 5500, 'physical_quantity', v_received_length, 'piece_count', 1))),
      jsonb_build_object('schedule_id', v_second, 'received_quantity', v_received_length,
        'received_piece_length_mm', v_received_length, 'received_piece_count', 1,
        'allocations', jsonb_build_array(jsonb_build_object('table', 'request_circle', 'id', v_item,
          'quantity', 500, 'physical_quantity', v_received_length, 'piece_count', 1)))
    ), v_actor);
    IF (SELECT status FROM public.long_stock_cutting_plan_versions WHERE id = v_version) <> 'invalid'
      OR (SELECT sum(allocated_piece_count) FROM public.supply_order_delivery_schedules WHERE id IN (v_first, v_second)) <> 2
      OR (SELECT sum(allocated_quantity) FROM public.supply_order_delivery_schedules WHERE id IN (v_first, v_second)) <> 6000 THEN
      RAISE EXCEPTION 'Measured-length batch must finish both rows and require recalculation';
    END IF;
    CONTINUE;
  END IF;

  -- Direct RPC: extra physical bars cannot be hidden behind a valid net length.
  BEGIN
    PERFORM public.fn_receive_supply_order_schedule_v2(v_first, v_actor, 18000,
      jsonb_build_array(jsonb_build_object('table', 'request_circle', 'id', v_item,
        'quantity', 6000, 'physical_quantity', 18000, 'piece_count', 3)), 6000, 3);
    RAISE EXCEPTION 'Expected physical plan overflow rejection';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE '%превышает остаток по утверждённой карте%' THEN RAISE; END IF;
  END;
  -- Direct RPC: a forged logical quantity must not close the whole request on bar 1.
  BEGIN
    PERFORM public.fn_receive_supply_order_schedule_v2(v_first, v_actor, 6000,
      jsonb_build_array(jsonb_build_object('table', 'request_circle', 'id', v_item,
        'quantity', 6000, 'physical_quantity', 6000, 'piece_count', 1)), 6000, 1);
    RAISE EXCEPTION 'Expected cut coverage rejection';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE '%отрезков не соответствует утверждённой карте%' THEN RAISE; END IF;
  END;
  PERFORM public.fn_receive_supply_order_schedule_v2(v_first, v_actor, 6000,
    jsonb_build_array(jsonb_build_object('table', 'request_circle', 'id', v_item,
      'quantity', 5500, 'physical_quantity', 6000, 'piece_count', 1)), 6000, 1);
  IF (SELECT order_status FROM public.request_circle WHERE id = v_item) <> 'ordered' THEN
    RAISE EXCEPTION 'First bar prematurely closed the request';
  END IF;
  -- Stale confirmation after another receipt must be rejected in the transaction.
  BEGIN
    PERFORM public.fn_receive_supply_order_schedule_v2(v_second, v_actor, 12000,
      jsonb_build_array(jsonb_build_object('table', 'request_circle', 'id', v_item,
        'quantity', 500, 'physical_quantity', 12000, 'piece_count', 2)), 6000, 2);
    RAISE EXCEPTION 'Expected stale confirmation rejection';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error NOT LIKE '%превышает остаток по утверждённой карте%' THEN RAISE; END IF;
  END;
  PERFORM public.fn_receive_supply_order_schedule_v2(v_second, v_actor, 6000,
    jsonb_build_array(jsonb_build_object('table', 'request_circle', 'id', v_item,
      'quantity', 500, 'physical_quantity', 6000, 'piece_count', 1)), 6000, 1);

  IF (SELECT sum(allocated_piece_count) FROM public.supply_order_delivery_schedules WHERE id IN (v_first, v_second)) <> 2
    OR (SELECT sum(allocated_quantity) FROM public.supply_order_delivery_schedules WHERE id IN (v_first, v_second)) <> 6000
    OR (SELECT sum(reserved_quantity) FROM public.inventory_reservations WHERE request_item_id = v_item AND reservation_source = 'supply_receipt') <> 12000
    OR (SELECT order_status FROM public.request_circle WHERE id = v_item) <> 'delivered'
    OR (SELECT status FROM public.long_stock_cutting_plan_versions WHERE id = v_version) <> 'approved' THEN
    RAISE EXCEPTION 'Physical bars, net cut coverage, reservations or approved plan diverged';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_assert_whole_bar_receipt_allocation_v1(text,uuid,numeric,numeric,numeric,numeric,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Internal guard must not be independently executable';
  END IF;
END;
END LOOP;
END;
$$;
ROLLBACK;
