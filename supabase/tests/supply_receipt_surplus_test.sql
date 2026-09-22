\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_section uuid := gen_random_uuid();
  v_category text;
  v_table text;
  v_machine uuid;
  v_request uuid;
  v_item uuid;
  v_material uuid;
  v_inventory uuid;
  v_allocated uuid;
  v_surplus uuid;
  v_reservation uuid;
  v_fact uuid;
  v_event uuid;
  v_error text;
  v_is_bar boolean;
  v_snapshot jsonb;
BEGIN
  SELECT id INTO STRICT v_factory FROM public.factories ORDER BY created_at LIMIT 1;
  INSERT INTO public.users(id,email,full_name,role,factory_id,is_active)
  VALUES(v_actor,v_actor || '@surplus.test','Receipt surplus regression','technologist',v_factory,true);
  INSERT INTO public.user_system_roles(user_id,role) VALUES(v_actor,'crm_admin');
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  INSERT INTO public.production_fact_sections(id,factory_id,name,production_stage_type,created_by,updated_by)
  VALUES(v_section,v_factory,'Surplus cutting test','cutting',v_actor,v_actor);

  FOREACH v_category IN ARRAY ARRAY['sheet_metal','round_tube','circle','pipe','knives','components','paint','mesh','chain_cord']
  LOOP
    v_table := 'request_' || v_category;
    v_machine := gen_random_uuid(); v_request := gen_random_uuid(); v_item := gen_random_uuid();
    v_material := gen_random_uuid(); v_inventory := gen_random_uuid();
    v_allocated := gen_random_uuid(); v_surplus := gen_random_uuid(); v_reservation := gen_random_uuid();
    v_is_bar := v_category IN ('circle','pipe','knives');
    INSERT INTO public.machines(id,factory_id,name,created_by)
    VALUES(v_machine,v_factory,'Surplus ' || v_category,v_actor);
    INSERT INTO public.technologist_requests(id,machine_id,created_by,status)
    VALUES(v_request,v_machine,v_actor,'submitted_to_supply');
    INSERT INTO public.materials(id,name,category,created_by)
    VALUES(v_material,'Surplus ' || v_category,v_category::public.material_category,v_actor);

    -- Reproduce an already received historical state for every category. Only
    -- fixture insertion skips unrelated approval/plan/characteristic triggers.
    -- ALL calls under test below run with the real triggers enabled.
    PERFORM set_config('session_replication_role','replica',true);
    CASE v_category
      WHEN 'sheet_metal' THEN
        INSERT INTO public.request_sheet_metal(id,request_id,material_name,material_id,remainder_qty,order_status)
        VALUES(v_item,v_request,'Sheet',v_material,12,'delivered');
      WHEN 'round_tube' THEN
        INSERT INTO public.request_round_tube(id,request_id,material_name,material_id,order_kg,order_status)
        VALUES(v_item,v_request,'Legacy round tube',v_material,12,'delivered');
      WHEN 'circle' THEN
        INSERT INTO public.request_circle(id,request_id,material_id,remainder_mm,order_status)
        VALUES(v_item,v_request,v_material,12,'delivered');
      WHEN 'pipe' THEN
        INSERT INTO public.request_pipe(id,request_id,pipe_type,material_id,remainder_length_mm,order_status)
        VALUES(v_item,v_request,'round',v_material,12,'delivered');
      WHEN 'knives' THEN
        INSERT INTO public.request_knives(id,request_id,knife_type,material_id,remainder_meters,length_mm,order_status)
        VALUES(v_item,v_request,'Knife',v_material,0.012,1,'delivered');
      WHEN 'components' THEN
        INSERT INTO public.request_components(id,request_id,component_name,material_id,quantity_needed,order_status)
        VALUES(v_item,v_request,'Bolt',v_material,12,'delivered');
      WHEN 'paint' THEN
        INSERT INTO public.request_paint(id,request_id,ral_code,material_id,remainder_kg,order_status)
        VALUES(v_item,v_request,'TEST',v_material,12,'delivered');
      WHEN 'mesh' THEN
        INSERT INTO public.request_mesh(id,request_id,material_id,remainder_qty,order_status)
        VALUES(v_item,v_request,v_material,12,'delivered');
      WHEN 'chain_cord' THEN
        INSERT INTO public.request_chain_cord(id,request_id,item_type,material_id,remainder_meters,order_status)
        VALUES(v_item,v_request,'chain',v_material,0.012,'delivered');
    END CASE;
    INSERT INTO public.inventory(id,material_id,factory_id,total_quantity,reserved_quantity,unit,
      piece_length_mm,total_secondary_quantity,reserved_secondary_quantity)
    VALUES(v_inventory,v_material,v_factory,15,12,'шт',
      CASE WHEN v_category='knives' THEN 1 END,15,12);
    INSERT INTO public.supply_order_delivery_schedules(id,request_item_table,request_item_id,delivery_date,
      quantity,unit,status,received_quantity,allocated_quantity,allocated_physical_quantity,
      excess_quantity,receipt_inventory_id,delivered_at,received_by)
    VALUES
      (v_allocated,v_table,v_item,current_date,12,'шт','delivered',12,12,12,0,v_inventory,now(),v_actor),
      (v_surplus,v_table,v_item,current_date,3,'шт','delivered',3,0,0,3,v_inventory,now(),v_actor);
    INSERT INTO public.inventory_reservations(id,inventory_id,material_id,machine_id,request_item_table,
      request_item_id,reserved_quantity,reserved_by,reservation_source,supply_order_schedule_id)
    VALUES(v_reservation,v_inventory,v_material,v_machine,v_table,v_item,12,v_actor,'supply_receipt',v_allocated);
    PERFORM set_config('session_replication_role','origin',true);

    -- Compare full stock/ledger state, not merely a returned counter.
    SELECT jsonb_build_object('inventory',to_jsonb(i),'reservations',
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.inventory_reservations r WHERE r.machine_id=v_machine),
      'transactions',(SELECT count(*) FROM public.inventory_transactions WHERE machine_id=v_machine))
    INTO v_snapshot FROM public.inventory i WHERE id=v_inventory;
    PERFORM public.fn_reserve_delivered_supply_for_cutting(v_machine,v_actor);
    PERFORM public.fn_reserve_delivered_supply_for_cutting(v_machine,v_actor);
    IF v_snapshot IS DISTINCT FROM (SELECT jsonb_build_object('inventory',to_jsonb(i),'reservations',
      (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.inventory_reservations r WHERE r.machine_id=v_machine),
      'transactions',(SELECT count(*) FROM public.inventory_transactions WHERE machine_id=v_machine))
      FROM public.inventory i WHERE id=v_inventory) THEN
      RAISE EXCEPTION '%: cutting stole free surplus or changed receipt allocation',v_category;
    END IF;

    -- A direct attempt to repurpose the zero-allocation schedule must fail for
    -- every category. UPDATE avoids the unrelated sheet characteristic fixture.
    BEGIN
      UPDATE public.inventory_reservations SET supply_order_schedule_id=v_surplus WHERE id=v_reservation;
      RAISE EXCEPTION 'Expected zero-allocation rejection for %',v_category;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      IF v_error NOT LIKE '%свободный излишек%' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.inventory_reservations SET reserved_quantity=15 WHERE id=v_reservation;
      RAISE EXCEPTION 'Expected over-allocation rejection for %',v_category;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      IF v_error NOT LIKE '%свободный излишек%' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.inventory_reservations SET supply_order_schedule_id=NULL WHERE id=v_reservation;
      RAISE EXCEPTION 'Expected missing allocation rejection for %',v_category;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error=MESSAGE_TEXT;
      IF v_error NOT LIKE '%принятому распределению%' THEN RAISE; END IF;
    END;

    -- Non-bar categories go through the actual cutting entry point. Whole-bar
    -- consumption/rollback uses the real approved-plan suite separately.
    IF NOT v_is_bar THEN
      INSERT INTO public.production_machine_facts(factory_id,fact_date,machine_id,section_id,shift,created_by,updated_by)
      VALUES(v_factory,current_date,v_machine,v_section,'day',v_actor,v_actor) RETURNING id INTO v_fact;
      v_event := public.fn_apply_production_fact_cutting(v_fact,v_actor);
      PERFORM public.fn_apply_production_fact_cutting(v_fact,v_actor);
      IF (SELECT total_quantity FROM public.inventory WHERE id=v_inventory) <> 3
        OR (SELECT reserved_quantity FROM public.inventory WHERE id=v_inventory) <> 0
        OR (SELECT available_quantity FROM public.inventory WHERE id=v_inventory) <> 3
        OR (SELECT sum(quantity) FROM public.inventory_transactions WHERE machine_id=v_machine AND transaction_type='write_off') <> -12
        OR (SELECT count(*) FROM public.production_fact_cutting_event_reservations WHERE event_id=v_event) <> 1 THEN
        RAISE EXCEPTION '%: receipt 15 / allocation 12 must leave exactly 3 free after cutting',v_category;
      END IF;
    END IF;

    -- Released/archived receipts must never be silently recreated either.
    PERFORM set_config('session_replication_role','replica',true);
    DELETE FROM public.production_fact_cutting_event_reservations WHERE reservation_id=v_reservation;
    DELETE FROM public.inventory_reservations WHERE id=v_reservation;
    UPDATE public.inventory SET total_quantity=15,reserved_quantity=0 WHERE id=v_inventory;
    PERFORM set_config('session_replication_role','origin',true);
    PERFORM public.fn_reserve_delivered_supply_for_cutting(v_machine,v_actor);
    IF EXISTS(SELECT 1 FROM public.inventory_reservations WHERE machine_id=v_machine)
      OR (SELECT available_quantity FROM public.inventory WHERE id=v_inventory) <> 15 THEN
      RAISE EXCEPTION '%: released reservation was recreated',v_category;
    END IF;
  END LOOP;
END;
$$;

-- Exact reported scenario through the actual receiving and cutting RPCs, with
-- all sheet identity and financial guards enabled throughout.
DO $$
DECLARE
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_steel uuid;
  v_supplier uuid := gen_random_uuid();
  v_allocated uuid := gen_random_uuid();
  v_surplus uuid := gen_random_uuid();
  v_section uuid := gen_random_uuid();
  v_fact uuid;
  v_inventory uuid;
BEGIN
  SELECT id INTO STRICT v_factory FROM public.factories ORDER BY created_at LIMIT 1;
  SELECT id INTO STRICT v_steel FROM public.steel_types ORDER BY name LIMIT 1;
  INSERT INTO public.users(id,email,full_name,role,factory_id,is_active)
  VALUES(v_actor,v_actor || '@surplus.test','Sheet surplus regression','technologist',v_factory,true);
  INSERT INTO public.user_system_roles(user_id,role) VALUES(v_actor,'crm_admin');
  PERFORM set_config('request.jwt.claim.sub',v_actor::text,true);
  INSERT INTO public.machines(id,factory_id,name,created_by)
  VALUES(v_machine,v_factory,'CIV-19 12 + 3 regression',v_actor);
  INSERT INTO public.technologist_requests(id,machine_id,created_by,status)
  VALUES(v_request,v_machine,v_actor,'submitted_to_supply');
  INSERT INTO public.suppliers(id,name) VALUES(v_supplier,'Surplus test supplier');
  INSERT INTO public.supplier_material_categories(supplier_id,category) VALUES(v_supplier,'sheet_metal');
  INSERT INTO public.materials(id,name,category,created_by,default_supplier_id)
  VALUES(v_material,'Sheet 1200x1200x32','sheet_metal',v_actor,v_supplier);
  INSERT INTO public.material_variants(id,material_id,category,steel_type_id,sheet_size,thickness_mm,default_unit)
  VALUES(v_variant,v_material,'sheet_metal',v_steel,'1200x1200',32,'шт');
  INSERT INTO public.request_sheet_metal(id,request_id,material_name,material_id,material_variant_id,
    steel_type_id,sheet_size,thickness_mm,remainder_qty,order_status,supplier_id,ordered_at)
  VALUES(v_item,v_request,'Sheet',v_material,v_variant,v_steel,'1200x1200',32,12,'ordered',v_supplier,now());
  INSERT INTO public.supply_order_delivery_schedules(id,request_item_table,request_item_id,delivery_date,
    quantity,unit,supplier_id,created_by,updated_by)
  VALUES
    (v_allocated,'request_sheet_metal',v_item,current_date,12,'шт',v_supplier,v_actor,v_actor),
    (v_surplus,'request_sheet_metal',v_item,current_date,3,'шт',v_supplier,v_actor,v_actor);
  PERFORM public.fn_receive_supply_order_schedule_batch_v2(jsonb_build_array(
    jsonb_build_object('schedule_id',v_allocated,'received_quantity',12,'allocations',
      jsonb_build_array(jsonb_build_object('table','request_sheet_metal','id',v_item,'quantity',12,'physical_quantity',12))),
    jsonb_build_object('schedule_id',v_surplus,'received_quantity',3,'allocations','[]'::jsonb)
  ),v_actor,'12 листов для заказа, 3 на свободный склад');
  SELECT receipt_inventory_id INTO STRICT v_inventory FROM public.supply_order_delivery_schedules WHERE id=v_allocated;
  IF (SELECT total_quantity FROM public.inventory WHERE id=v_inventory) <> 15
    OR (SELECT reserved_quantity FROM public.inventory WHERE id=v_inventory) <> 12
    OR (SELECT excess_quantity FROM public.supply_order_delivery_schedules WHERE id=v_surplus) <> 3 THEN
    RAISE EXCEPTION 'Receiving must allocate 12 and leave 3 free';
  END IF;
  INSERT INTO public.production_fact_sections(id,factory_id,name,production_stage_type,created_by,updated_by)
  VALUES(v_section,v_factory,'Sheet surplus cutting','cutting',v_actor,v_actor);
  INSERT INTO public.production_machine_facts(factory_id,fact_date,machine_id,section_id,shift,created_by,updated_by)
  VALUES(v_factory,current_date,v_machine,v_section,'day',v_actor,v_actor) RETURNING id INTO v_fact;
  PERFORM public.fn_apply_production_fact_cutting(v_fact,v_actor);
  PERFORM public.fn_apply_production_fact_cutting(v_fact,v_actor);
  IF (SELECT available_quantity FROM public.inventory WHERE id=v_inventory) <> 3
    OR (SELECT total_quantity FROM public.inventory WHERE id=v_inventory) <> 3
    OR (SELECT sum(quantity) FROM public.inventory_transactions WHERE machine_id=v_machine AND transaction_type='write_off') <> -12
    OR EXISTS(SELECT 1 FROM public.inventory_reservations WHERE supply_order_schedule_id=v_surplus) THEN
    RAISE EXCEPTION 'CIV-19 regression: cutting must consume 12, preserve 3, and be idempotent';
  END IF;
END;
$$;

ROLLBACK;
