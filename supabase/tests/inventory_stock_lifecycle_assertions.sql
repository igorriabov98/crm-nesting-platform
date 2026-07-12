CREATE OR REPLACE FUNCTION public.test_assert_numeric(actual numeric, expected numeric, message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '%: expected %, got %', message, expected, actual;
  END IF;
END;
$$;

DO $$
DECLARE
  v_value numeric;
  v_unit text;
BEGIN
  SELECT total_quantity, unit INTO v_value, v_unit
  FROM public.inventory WHERE id = '00000000-0000-0000-0000-000000000030';
  PERFORM public.test_assert_numeric(v_value, 6000, 'meter inventory converted to millimeters');
  IF v_unit IS DISTINCT FROM 'мм' THEN RAISE EXCEPTION 'inventory unit was not converted to mm'; END IF;

  SELECT reserved_quantity INTO v_value FROM public.inventory_reservations
  WHERE id = '00000000-0000-0000-0000-000000000040';
  PERFORM public.test_assert_numeric(v_value, 4000, 'meter reservation converted to millimeters');

  SELECT quantity INTO v_value FROM public.inventory_transactions
  WHERE inventory_id = '00000000-0000-0000-0000-000000000030';
  PERFORM public.test_assert_numeric(v_value, 6000, 'meter transaction converted to millimeters');

  SELECT reserved_from_stock_meters INTO v_value FROM public.request_chain_cord
  WHERE id = '00000000-0000-0000-0000-000000000020';
  PERFORM public.test_assert_numeric(v_value, 4, 'legacy chain/cord mirror remains in meters');

  SELECT reserved_from_stock_meters INTO v_value FROM public.request_chain_cord
  WHERE id = '00000000-0000-0000-0000-000000000021';
  PERFORM public.test_assert_numeric(v_value, 4, 'corrupted 4000 meter mirror repaired from reservation rows');

  SELECT quantity, unit INTO v_value, v_unit FROM public.supply_order_delivery_schedules
  WHERE id = '00000000-0000-0000-0000-000000000050';
  PERFORM public.test_assert_numeric(v_value, 6000, 'delivery schedule converted to millimeters');
  IF v_unit IS DISTINCT FROM 'мм' THEN RAISE EXCEPTION 'delivery schedule unit was not converted to mm'; END IF;
END;
$$;

DO $$
DECLARE
  v_factory uuid := '10000000-0000-0000-0000-000000000001';
  v_user uuid := '10000000-0000-0000-0000-000000000002';
  v_material uuid := '10000000-0000-0000-0000-000000000003';
  v_variant uuid := '10000000-0000-0000-0000-000000000004';
  v_machine uuid := '10000000-0000-0000-0000-000000000005';
  v_source uuid := '10000000-0000-0000-0000-000000000006';
  v_request_4000 uuid := '10000000-0000-0000-0000-000000000007';
  v_request_1000 uuid := '10000000-0000-0000-0000-000000000008';
  v_reservation_4000 uuid;
  v_reservation_1000 uuid;
  v_scrap_2000 uuid;
  v_scrap_1000 uuid;
  v_value numeric;
BEGIN
  INSERT INTO public.factories (id, name) VALUES (v_factory, 'Cut factory');
  INSERT INTO public.users (id) VALUES (v_user);
  INSERT INTO public.materials (id, category) VALUES (v_material, 'knives');
  INSERT INTO public.material_variants (id) VALUES (v_variant);
  INSERT INTO public.machines (id, factory_id) VALUES (v_machine, v_factory);
  INSERT INTO public.request_knives (id) VALUES (v_request_4000), (v_request_1000);
  INSERT INTO public.inventory (
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, last_updated_by
  ) VALUES (
    v_source, v_factory, v_material, v_variant, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_user
  );

  v_reservation_4000 := public.fn_reserve_inventory_row_for_machine(
    v_source, v_machine, 4000, 'request_knives', v_request_4000, v_user, NULL, true
  );

  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_source;
  PERFORM public.test_assert_numeric(v_value, 0, '6000 source piece consumed by 4000 cut');
  SELECT reserved_quantity INTO v_value FROM public.inventory_reservations WHERE id = v_reservation_4000;
  PERFORM public.test_assert_numeric(v_value, 4000, '4000 reservation created');
  SELECT business_scrap_inventory_id INTO v_scrap_2000 FROM public.inventory_reservations WHERE id = v_reservation_4000;
  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_scrap_2000;
  PERFORM public.test_assert_numeric(v_value, 2000, '2000 business scrap created');
  SELECT reserved_from_stock_mm INTO v_value FROM public.request_knives WHERE id = v_request_4000;
  PERFORM public.test_assert_numeric(v_value, 4000, 'knife request mirror updated');

  v_reservation_1000 := public.fn_reserve_inventory_row_for_machine(
    v_scrap_2000, v_machine, 1000, 'request_knives', v_request_1000, v_user, NULL, true
  );
  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_scrap_2000;
  PERFORM public.test_assert_numeric(v_value, 0, '2000 scrap piece consumed by 1000 cut');
  SELECT business_scrap_inventory_id INTO v_scrap_1000 FROM public.inventory_reservations WHERE id = v_reservation_1000;
  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_scrap_1000;
  PERFORM public.test_assert_numeric(v_value, 1000, '1000 chained business scrap created');

  PERFORM public.fn_unreserve_inventory_reservation(v_reservation_4000, v_user, 'test unreserve after scrap reuse');
  SELECT COALESCE(SUM(total_quantity), 0) INTO v_value
  FROM public.inventory
  WHERE material_id = v_material AND is_business_scrap = true AND deleted_at IS NULL;
  PERFORM public.test_assert_numeric(v_value, 5000, 'used scrap prevents rejoin and returns separate 4000 piece');
END;
$$;

DO $$
DECLARE
  v_factory uuid := '20000000-0000-0000-0000-000000000001';
  v_user uuid := '20000000-0000-0000-0000-000000000002';
  v_material uuid := '20000000-0000-0000-0000-000000000003';
  v_variant uuid := '20000000-0000-0000-0000-000000000004';
  v_machine uuid := '20000000-0000-0000-0000-000000000005';
  v_source uuid := '20000000-0000-0000-0000-000000000006';
  v_request uuid := '20000000-0000-0000-0000-000000000007';
  v_reservation uuid;
  v_scrap uuid;
  v_value numeric;
  v_deleted_at timestamptz;
BEGIN
  INSERT INTO public.factories (id, name) VALUES (v_factory, 'Rejoin factory');
  INSERT INTO public.users (id) VALUES (v_user);
  INSERT INTO public.materials (id, category) VALUES (v_material, 'knives');
  INSERT INTO public.material_variants (id) VALUES (v_variant);
  INSERT INTO public.machines (id, factory_id) VALUES (v_machine, v_factory);
  INSERT INTO public.request_knives (id) VALUES (v_request);
  INSERT INTO public.inventory (
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, last_updated_by
  ) VALUES (
    v_source, v_factory, v_material, v_variant, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_user
  );

  v_reservation := public.fn_reserve_inventory_row_for_machine(
    v_source, v_machine, 4000, 'request_knives', v_request, v_user, NULL, true
  );
  SELECT business_scrap_inventory_id INTO v_scrap FROM public.inventory_reservations WHERE id = v_reservation;
  PERFORM public.fn_unreserve_inventory_reservation(v_reservation, v_user, 'test untouched scrap rejoin');

  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_source;
  PERFORM public.test_assert_numeric(v_value, 6000, 'untouched 2000 scrap rejoins original 6000 piece');
  SELECT deleted_at INTO v_deleted_at FROM public.inventory WHERE id = v_scrap;
  IF v_deleted_at IS NULL THEN RAISE EXCEPTION 'empty business scrap was not archived after rejoin'; END IF;
  SELECT reserved_from_stock_mm INTO v_value FROM public.request_knives WHERE id = v_request;
  PERFORM public.test_assert_numeric(v_value, 0, 'request mirror reset after unreserve');
END;
$$;

DO $$
DECLARE
  v_factory uuid := '30000000-0000-0000-0000-000000000001';
  v_user uuid := '30000000-0000-0000-0000-000000000002';
  v_material uuid := '30000000-0000-0000-0000-000000000003';
  v_variant uuid := '30000000-0000-0000-0000-000000000004';
  v_cut_machine uuid := '30000000-0000-0000-0000-000000000005';
  v_normal_machine uuid := '30000000-0000-0000-0000-000000000006';
  v_cut_source uuid := '30000000-0000-0000-0000-000000000007';
  v_normal_source uuid := '30000000-0000-0000-0000-000000000008';
  v_cut_request uuid := '30000000-0000-0000-0000-000000000009';
  v_normal_request uuid := '30000000-0000-0000-0000-00000000000a';
  v_section uuid := '30000000-0000-0000-0000-00000000000b';
  v_cut_fact uuid := '30000000-0000-0000-0000-00000000000c';
  v_normal_fact uuid := '30000000-0000-0000-0000-00000000000d';
  v_cut_reservation uuid;
  v_value numeric;
  v_before numeric;
BEGIN
  INSERT INTO public.factories (id, name) VALUES (v_factory, 'Fact factory');
  INSERT INTO public.users (id) VALUES (v_user);
  INSERT INTO public.materials (id, category) VALUES (v_material, 'knives');
  INSERT INTO public.material_variants (id) VALUES (v_variant);
  INSERT INTO public.machines (id, factory_id) VALUES (v_cut_machine, v_factory), (v_normal_machine, v_factory);
  INSERT INTO public.request_knives (id) VALUES (v_cut_request);
  INSERT INTO public.request_components (id) VALUES (v_normal_request);
  INSERT INTO public.inventory (
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, last_updated_by
  ) VALUES (
    v_cut_source, v_factory, v_material, v_variant, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_user
  );
  INSERT INTO public.inventory (
    id, factory_id, material_id, material_variant_id,
    total_quantity, reserved_quantity, unit, last_updated_by
  ) VALUES (
    v_normal_source, v_factory, v_material, NULL,
    100, 40, 'шт', v_user
  );

  v_cut_reservation := public.fn_reserve_inventory_row_for_machine(
    v_cut_source, v_cut_machine, 4000, 'request_knives', v_cut_request, v_user, NULL, true
  );
  INSERT INTO public.inventory_reservations (
    inventory_id, material_id, machine_id, request_item_table, request_item_id,
    reserved_quantity, reserved_by
  ) VALUES (
    v_normal_source, v_material, v_normal_machine, 'request_components', v_normal_request,
    40, v_user
  );
  PERFORM public.fn_set_request_reserved_quantity('request_components', v_normal_request);

  INSERT INTO public.production_fact_sections (id, production_stage_type) VALUES (v_section, 'cutting');
  INSERT INTO public.production_stages (machine_id, stage_type, date_start, updated_by)
  VALUES (v_cut_machine, 'cutting', '2026-07-12', v_user), (v_normal_machine, 'cutting', '2026-07-12', v_user);
  INSERT INTO public.production_machine_facts (id, machine_id, section_id, fact_date) VALUES
    (v_cut_fact, v_cut_machine, v_section, '2026-07-12'),
    (v_normal_fact, v_normal_machine, v_section, '2026-07-12');

  SELECT COALESCE(SUM(total_quantity), 0) INTO v_before FROM public.inventory WHERE material_id = v_material;
  PERFORM public.fn_apply_production_fact_cutting(v_cut_fact, v_user);
  SELECT COALESCE(SUM(total_quantity), 0) INTO v_value FROM public.inventory WHERE material_id = v_material;
  PERFORM public.test_assert_numeric(v_value, v_before, 'cut reservation is not deducted twice by production fact');
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE id = v_cut_reservation AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'cut reservation was not marked consumed';
  END IF;
  SELECT COUNT(*) INTO v_value FROM public.inventory_transactions
  WHERE machine_id = v_cut_machine AND transaction_type = 'write_off';
  PERFORM public.test_assert_numeric(v_value, 0, 'cut reservation produces no second write-off');

  PERFORM public.fn_apply_production_fact_cutting(v_cut_fact, v_user);
  SELECT COUNT(*) INTO v_value FROM public.production_fact_cutting_events WHERE fact_id = v_cut_fact;
  PERFORM public.test_assert_numeric(v_value, 1, 'repeated cutting fact is idempotent');

  PERFORM public.fn_apply_production_fact_cutting(v_normal_fact, v_user);
  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_normal_source;
  PERFORM public.test_assert_numeric(v_value, 60, 'normal reservation deducted at cutting fact');
  SELECT reserved_quantity INTO v_value FROM public.inventory WHERE id = v_normal_source;
  PERFORM public.test_assert_numeric(v_value, 0, 'normal reservation released at cutting fact');
  SELECT COUNT(*) INTO v_value FROM public.inventory_transactions
  WHERE machine_id = v_normal_machine AND transaction_type = 'write_off' AND quantity = -40;
  PERFORM public.test_assert_numeric(v_value, 1, 'normal reservation creates one write-off');
END;
$$;

SELECT 'inventory_stock_lifecycle_ok' AS result;
