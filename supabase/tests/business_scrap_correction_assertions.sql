\set ON_ERROR_STOP on

DO $$
DECLARE
  v_factory uuid := '51000000-0000-0000-0000-000000000001';
  v_technologist uuid := '51000000-0000-0000-0000-000000000002';
  v_approver uuid := '51000000-0000-0000-0000-000000000003';
  v_material uuid := '51000000-0000-0000-0000-000000000004';
  v_variant uuid := '51000000-0000-0000-0000-000000000005';
  v_machine uuid := '51000000-0000-0000-0000-000000000006';
  v_request uuid := '51000000-0000-0000-0000-000000000007';
  v_item uuid := '51000000-0000-0000-0000-000000000008';
  v_source_2000 uuid := '51000000-0000-0000-0000-000000000009';
  v_source_4000 uuid := '51000000-0000-0000-0000-00000000000a';
  v_old_reservation uuid;
  v_new_reservation uuid;
  v_correction_one uuid := '51000000-0000-0000-0000-00000000000b';
  v_task_one uuid := '51000000-0000-0000-0000-00000000000c';
  v_correction_two uuid := '51000000-0000-0000-0000-00000000000d';
  v_task_two uuid := '51000000-0000-0000-0000-00000000000e';
  v_correction_three uuid := '51000000-0000-0000-0000-00000000000f';
  v_task_three uuid := '51000000-0000-0000-0000-000000000010';
  v_schedule uuid := '51000000-0000-0000-0000-000000000011';
  v_value numeric;
  v_text text;
BEGIN
  INSERT INTO public.factories(id, name) VALUES (v_factory, 'Correction factory');
  INSERT INTO public.users(id, role, is_active) VALUES
    (v_technologist, 'technologist', true),
    (v_approver, 'supply_manager', true);
  INSERT INTO public.materials(id, category) VALUES (v_material, 'knives');
  INSERT INTO public.material_variants(id) VALUES (v_variant);
  INSERT INTO public.machines(id, factory_id, name, is_archived)
  VALUES (v_machine, v_factory, 'Correction machine', false);
  INSERT INTO public.technologist_requests(id, machine_id, status)
  VALUES (v_request, v_machine, 'submitted_to_supply');
  INSERT INTO public.request_knives(
    id, request_id, material_id, material_variant_id, length_mm,
    remainder_meters, to_order_mm, order_status
  ) VALUES (v_item, v_request, v_material, v_variant, 6000, 6, 6000, 'ordered');

  INSERT INTO public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit, total_secondary_quantity,
    reserved_secondary_quantity, secondary_unit, last_updated_by, is_business_scrap
  ) VALUES
    (v_source_2000, v_factory, v_material, v_variant, 2000, 2000, 0, 'мм', 1, 0, 'шт', v_technologist, true),
    (v_source_4000, v_factory, v_material, v_variant, 4000, 4000, 0, 'мм', 1, 0, 'шт', v_technologist, true);

  v_old_reservation := public.fn_reserve_inventory_row_for_machine(
    v_source_2000, v_machine, 2000, 'request_knives', v_item, v_technologist, NULL, true
  );

  PERFORM public.fn_submit_business_scrap_correction(
    v_correction_one, v_task_one, v_request, v_technologist, v_approver,
    'Проверка отклонения',
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_knives',
      'request_item_id', v_item,
      'remove_reservation_ids', jsonb_build_array(v_old_reservation),
      'additions', jsonb_build_array(jsonb_build_object(
        'inventory_id', v_source_4000,
        'quantity', 4000,
        'is_cut_reservation', true
      ))
    ))
  );

  SELECT available_quantity INTO v_value FROM public.inventory WHERE id = v_source_4000;
  PERFORM public.test_assert_numeric(v_value, 0, 'pending correction holds newly selected business scrap');
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE id = v_old_reservation) THEN
    RAISE EXCEPTION 'old reservation changed before approval';
  END IF;

  PERFORM public.fn_decide_business_scrap_correction(v_correction_one, v_approver, 'rejected', 'Оставить старую бронь');
  SELECT available_quantity INTO v_value FROM public.inventory WHERE id = v_source_4000;
  PERFORM public.test_assert_numeric(v_value, 4000, 'rejection releases temporary hold');
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE id = v_old_reservation) THEN
    RAISE EXCEPTION 'rejection removed active old reservation';
  END IF;

  INSERT INTO public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, quantity, unit, delivery_date, status
  ) VALUES (v_schedule, 'request_knives', v_item, 2000, 'мм', current_date + 7, 'planned');

  PERFORM public.fn_submit_business_scrap_correction(
    v_correction_two, v_task_two, v_request, v_technologist, v_approver,
    'Проверка одобрения',
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_knives',
      'request_item_id', v_item,
      'remove_reservation_ids', jsonb_build_array(v_old_reservation),
      'additions', jsonb_build_array(jsonb_build_object(
        'inventory_id', v_source_4000,
        'quantity', 4000,
        'is_cut_reservation', true
      ))
    ))
  );
  PERFORM public.fn_decide_business_scrap_correction(v_correction_two, v_approver, 'approved', NULL);

  SELECT status INTO v_text FROM public.business_scrap_correction_requests WHERE id = v_correction_two;
  IF v_text <> 'approved' THEN RAISE EXCEPTION 'approval did not finish: %', v_text; END IF;
  IF EXISTS (SELECT 1 FROM public.inventory_reservations WHERE id = v_old_reservation) THEN
    RAISE EXCEPTION 'approved replacement kept old reservation';
  END IF;
  SELECT id INTO v_new_reservation
  FROM public.inventory_reservations
  WHERE request_item_id = v_item AND reserved_quantity = 4000 AND consumed_at IS NULL
  ORDER BY created_at DESC LIMIT 1;
  IF v_new_reservation IS NULL THEN RAISE EXCEPTION 'approved replacement did not create new reservation'; END IF;
  SELECT status INTO v_text FROM public.supply_order_delivery_schedules WHERE id = v_schedule;
  IF v_text <> 'cancelled' THEN RAISE EXCEPTION 'planned supply schedule was not cancelled'; END IF;
  SELECT available_quantity INTO v_value FROM public.inventory WHERE id = v_source_2000;
  PERFORM public.test_assert_numeric(v_value, 2000, 'approved replacement returns removed business scrap');

  PERFORM public.fn_submit_business_scrap_correction(
    v_correction_three, v_task_three, v_request, v_technologist, v_approver,
    'Проверка конфликта',
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_knives',
      'request_item_id', v_item,
      'remove_reservation_ids', jsonb_build_array(v_new_reservation),
      'additions', '[]'::jsonb
    ))
  );
  UPDATE public.inventory_reservations SET consumed_at = now() WHERE id = v_new_reservation;
  PERFORM public.fn_decide_business_scrap_correction(v_correction_three, v_approver, 'approved', NULL);
  SELECT status INTO v_text FROM public.business_scrap_correction_requests WHERE id = v_correction_three;
  IF v_text <> 'conflicted' THEN RAISE EXCEPTION 'changed reservation did not produce conflict'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.inventory_reservations WHERE id = v_new_reservation AND consumed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'conflict partially changed consumed reservation';
  END IF;
END;
$$;

SELECT 'business_scrap_correction_ok' AS result;
