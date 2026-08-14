\set ON_ERROR_STOP on

-- Active knife stock reservation keeps the physical bar until cutting, then promotes future scrap.
DO $$
DECLARE
  v_user uuid := '81000000-0000-0000-0000-000000000001';
  v_factory uuid := '81000000-0000-0000-0000-000000000002';
  v_material uuid := '81000000-0000-0000-0000-000000000003';
  v_variant uuid := '81000000-0000-0000-0000-000000000004';
  v_machine uuid := '81000000-0000-0000-0000-000000000005';
  v_request uuid := '81000000-0000-0000-0000-000000000006';
  v_item uuid := '81000000-0000-0000-0000-000000000007';
  v_inventory uuid := '81000000-0000-0000-0000-000000000008';
  v_stage uuid := '81000000-0000-0000-0000-000000000009';
  v_section uuid := '81000000-0000-0000-0000-00000000000a';
  v_fact uuid := '81000000-0000-0000-0000-00000000000b';
  v_reservation uuid;
  v_scrap uuid;
  v_value numeric;
BEGIN
  INSERT INTO public.factories (id, name) VALUES (v_factory, 'Active knife whole-bar factory');
  INSERT INTO public.users (id) VALUES (v_user);
  INSERT INTO public.materials (id, category) VALUES (v_material, 'knives');
  INSERT INTO public.material_variants (id, material_id, category)
  VALUES (v_variant, v_material, 'knives');
  INSERT INTO public.machines (id, factory_id) VALUES (v_machine, v_factory);
  INSERT INTO public.technologist_requests (id, machine_id) VALUES (v_request, v_machine);
  INSERT INTO public.request_knives (id, request_id, material_id, material_variant_id, length_mm)
  VALUES (v_item, v_request, v_material, v_variant, 12000);
  INSERT INTO public.production_stages (id, machine_id, stage_type, date_start, updated_by)
  VALUES (v_stage, v_machine, 'cutting', '2026-08-14', v_user);
  INSERT INTO public.inventory (
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, last_updated_by
  ) VALUES (
    v_inventory, v_factory, v_material, v_variant, 12000,
    12000, 0, 'мм', 1, 0, 'шт', v_user
  );

  SELECT public.fn_reserve_whole_bar_inventory_row_for_machine(
    v_inventory, v_machine, 6000, 'request_knives', v_item, v_user
  ) INTO v_reservation;

  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_inventory;
  PERFORM public.test_assert_numeric(v_value, 12000, 'active knife reservation keeps the physical bar on stock');
  SELECT reserved_quantity INTO v_value FROM public.inventory WHERE id = v_inventory;
  PERFORM public.test_assert_numeric(v_value, 12000, 'active knife reservation reserves the whole physical bar');
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_reservations
    WHERE id = v_reservation
      AND reservation_source = 'whole_bar_stock'
      AND is_cut_reservation = false
      AND reserved_quantity = 12000
      AND logical_reserved_quantity = 6000
  ) THEN
    RAISE EXCEPTION 'active knife did not use whole-bar reservation semantics';
  END IF;

  SELECT business_scrap_inventory_id INTO v_scrap
  FROM public.inventory_reservations WHERE id = v_reservation;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_scrap
      AND piece_length_mm = 6000
      AND total_quantity = 6000
      AND total_secondary_quantity = 1
      AND is_business_scrap = true
      AND business_scrap_state = 'future'
      AND source_inventory_id = v_inventory
      AND source_reservation_id = v_reservation
  ) THEN
    RAISE EXCEPTION 'active knife reservation did not create future business scrap';
  END IF;

  INSERT INTO public.production_fact_sections (id, production_stage_type)
  VALUES (v_section, 'cutting');
  INSERT INTO public.production_machine_facts (id, machine_id, section_id, fact_date)
  VALUES (v_fact, v_machine, v_section, '2026-08-14');
  PERFORM public.fn_apply_production_fact_cutting(v_fact, v_user);

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE id = v_scrap AND business_scrap_state = 'available' AND total_quantity = 6000
  ) THEN
    RAISE EXCEPTION 'knife cutting fact did not promote future business scrap';
  END IF;
  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_inventory;
  PERFORM public.test_assert_numeric(v_value, 0, 'knife cutting fact removes the physical source bar');

  PERFORM public.fn_apply_production_fact_cutting(v_fact, v_user);
  SELECT count(*) INTO v_value
  FROM public.production_fact_cutting_events WHERE fact_id = v_fact;
  PERFORM public.test_assert_numeric(v_value, 1, 'repeated active knife cutting fact is idempotent');
  SELECT count(*) INTO v_value
  FROM public.inventory_transactions
  WHERE machine_id = v_machine AND transaction_type = 'write_off' AND quantity = -6000;
  PERFORM public.test_assert_numeric(v_value, 1, 'repeated active knife fact does not duplicate consumption');

  PERFORM public.fn_apply_production_cutting_rollback(
    v_machine, NULL, v_user, 'Active knife whole-bar rollback test'
  );
  SELECT total_quantity INTO v_value FROM public.inventory WHERE id = v_inventory;
  PERFORM public.test_assert_numeric(v_value, 12000, 'active knife rollback restores the physical source bar');
  SELECT reserved_quantity INTO v_value FROM public.inventory WHERE id = v_inventory;
  PERFORM public.test_assert_numeric(v_value, 12000, 'active knife rollback restores the whole-bar reservation');
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory WHERE id = v_scrap AND business_scrap_state = 'future'
  ) THEN
    RAISE EXCEPTION 'active knife rollback did not restore future scrap state';
  END IF;
END;
$$;

-- Legacy knife positions without an exact variant and wire remain outside the whole-bar matcher.
DO $$
DECLARE
  v_user uuid := '82000000-0000-0000-0000-000000000001';
  v_factory uuid := '82000000-0000-0000-0000-000000000002';
  v_knife_material uuid := '82000000-0000-0000-0000-000000000003';
  v_knife_variant uuid := '82000000-0000-0000-0000-000000000004';
  v_machine uuid := '82000000-0000-0000-0000-000000000005';
  v_request uuid := '82000000-0000-0000-0000-000000000006';
  v_legacy_knife uuid := '82000000-0000-0000-0000-000000000007';
  v_knife_inventory uuid := '82000000-0000-0000-0000-000000000008';
  v_wire_material uuid := '82000000-0000-0000-0000-000000000009';
  v_wire_variant uuid := '82000000-0000-0000-0000-00000000000a';
  v_wire_item uuid := '82000000-0000-0000-0000-00000000000b';
  v_wire_inventory uuid := '82000000-0000-0000-0000-00000000000c';
BEGIN
  INSERT INTO public.factories (id, name) VALUES (v_factory, 'Legacy knife and wire factory');
  INSERT INTO public.users (id) VALUES (v_user);
  INSERT INTO public.materials (id, category) VALUES (v_knife_material, 'knives'), (v_wire_material, 'pipe');
  INSERT INTO public.material_variants (id, material_id, category, pipe_type)
  VALUES
    (v_knife_variant, v_knife_material, 'knives', NULL),
    (v_wire_variant, v_wire_material, 'pipe', 'wire');
  INSERT INTO public.machines (id, factory_id) VALUES (v_machine, v_factory);
  INSERT INTO public.technologist_requests (id, machine_id) VALUES (v_request, v_machine);
  INSERT INTO public.request_knives (id, request_id, material_id, material_variant_id, length_mm)
  VALUES (v_legacy_knife, v_request, v_knife_material, NULL, 12000);
  INSERT INTO public.request_pipe (
    id, request_id, material_id, material_variant_id, pipe_type
  ) VALUES (
    v_wire_item, v_request, v_wire_material, v_wire_variant, 'wire'
  );
  INSERT INTO public.inventory (
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, last_updated_by
  ) VALUES
    (v_knife_inventory, v_factory, v_knife_material, v_knife_variant, 12000, 12000, 0, 'мм', 1, 0, 'шт', v_user),
    (v_wire_inventory, v_factory, v_wire_material, v_wire_variant, 6000, 6000, 0, 'кг', 1, 0, 'шт', v_user);

  IF public.fn_whole_bar_request_matches_inventory('request_knives', v_legacy_knife, v_knife_inventory) THEN
    RAISE EXCEPTION 'legacy knife position unexpectedly entered the whole-bar path';
  END IF;
  IF public.fn_whole_bar_request_matches_inventory('request_pipe', v_wire_item, v_wire_inventory) THEN
    RAISE EXCEPTION 'wire unexpectedly entered the whole-bar path';
  END IF;
END;
$$;

-- Different physical lengths remain distinct inventory identities; no averaged length can be stored.
DO $$
DECLARE
  v_user uuid := '83000000-0000-0000-0000-000000000001';
  v_factory uuid := '83000000-0000-0000-0000-000000000002';
  v_material uuid := '83000000-0000-0000-0000-000000000003';
  v_variant uuid := '83000000-0000-0000-0000-000000000004';
  v_value numeric;
BEGIN
  INSERT INTO public.factories (id, name) VALUES (v_factory, 'Inventory length identity factory');
  INSERT INTO public.users (id) VALUES (v_user);
  INSERT INTO public.materials (id, category) VALUES (v_material, 'knives');
  INSERT INTO public.material_variants (id, material_id, category)
  VALUES (v_variant, v_material, 'knives');

  PERFORM public.fn_upsert_inventory_stock(
    p_material_id => v_material,
    p_material_variant_id => v_variant,
    p_piece_length_mm => 3699,
    p_quantity => 3699,
    p_unit => 'мм',
    p_secondary_quantity => 1,
    p_secondary_unit => 'шт',
    p_performed_by => v_user,
    p_factory_id => v_factory
  );
  PERFORM public.fn_upsert_inventory_stock(
    p_material_id => v_material,
    p_material_variant_id => v_variant,
    p_piece_length_mm => 3100,
    p_quantity => 3100,
    p_unit => 'мм',
    p_secondary_quantity => 1,
    p_secondary_unit => 'шт',
    p_performed_by => v_user,
    p_factory_id => v_factory
  );

  SELECT count(*) INTO v_value
  FROM public.inventory
  WHERE factory_id = v_factory AND material_id = v_material AND material_variant_id = v_variant;
  PERFORM public.test_assert_numeric(v_value, 2, '3699 and 3100 mm remain separate inventory rows');
  IF EXISTS (
    SELECT 1 FROM public.inventory
    WHERE factory_id = v_factory
      AND material_id = v_material
      AND material_variant_id = v_variant
      AND total_secondary_quantity = 2
  ) THEN
    RAISE EXCEPTION 'different piece lengths were merged into one quantity-2 row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE factory_id = v_factory AND material_variant_id = v_variant
      AND piece_length_mm = 3699 AND total_quantity = 3699 AND total_secondary_quantity = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.inventory
    WHERE factory_id = v_factory AND material_variant_id = v_variant
      AND piece_length_mm = 3100 AND total_quantity = 3100 AND total_secondary_quantity = 1
  ) THEN
    RAISE EXCEPTION 'inventory length identity did not preserve exact physical lengths';
  END IF;
END;
$$;

SELECT 'knife_whole_bar_stock_ok' AS result;
