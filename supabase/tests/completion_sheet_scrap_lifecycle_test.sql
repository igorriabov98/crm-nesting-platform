BEGIN;
DO $test$
DECLARE
  v_actor uuid;
  v_factory uuid;
  v_machine uuid;
  v_request uuid;
  v_material uuid;
  v_variant uuid;
  v_source_variant uuid;
  v_steel uuid;
  v_source uuid;
  v_inventory uuid;
  v_late_inventory uuid;
  v_next_inventory uuid;
  v_nested_inventory uuid;
  v_other_nested_inventory uuid;
  v_source_inventory uuid;
  v_reservation uuid;
  v_next_reservation uuid;
  v_next_reservation_second uuid;
  v_next_source uuid;
  v_fact uuid;
  v_fact_second uuid;
  v_section uuid;
  v_no_weight uuid;
  v_convert_inventory uuid;
  v_lot jsonb;
  v_promoted integer;
  v_completion uuid;
  v_stage uuid;
  v_event uuid;
  v_second_event uuid;
  v_third_event uuid;
  v_fourth_event uuid;
  v_plan uuid;
  v_calc jsonb;
  v_preview jsonb;
BEGIN
  IF position('perform public.fn_promote_sheet_scrap_for_cutting_event_v1(v_existing_event'
    IN pg_get_functiondef('public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'Completion still replays an old machine fact into a new sheet plan';
  END IF;
  v_calc := public.fn_calculate_sheet_scrap_plan_v1('1200x300',1,168.480,
    '[{"lengthMm":500,"widthMm":300,"quantity":1}]'::jsonb,10);
  IF (v_calc->>'scrapWeightKg')::numeric <> 70.200
    OR (v_calc->>'wasteBasisKg')::numeric <> 98.280
    OR (v_calc->>'metalScrapKg')::numeric <> 9.828
    OR (v_calc->>'usefulKg')::numeric <> 88.452 THEN
    RAISE EXCEPTION 'Incorrect sheet weight balance: %', v_calc;
  END IF;
  IF public.fn_calculate_sheet_scrap_plan_v1('300x1200',1,168.480,
    '[{"lengthMm":500,"widthMm":300,"quantity":1}]'::jsonb,10) <> v_calc THEN
    RAISE EXCEPTION 'Rotated source sheet changed calculation';
  END IF;

  SELECT id INTO v_factory FROM public.factories LIMIT 1;
  INSERT INTO public.users(email,full_name,role,factory_id)
    VALUES ('sheet-scrap-test@local.invalid','Sheet test','technologist',v_factory) RETURNING id INTO v_actor;
  INSERT INTO public.machines(name,factory_id,created_by)
    VALUES ('Sheet scrap test',v_factory,v_actor) RETURNING id INTO v_machine;
  INSERT INTO public.technologist_requests(machine_id,created_by)
    VALUES (v_machine,v_actor) RETURNING id INTO v_request;
  INSERT INTO public.materials(name,category)
    VALUES ('Test sheet','sheet_metal') RETURNING id INTO v_material;
  INSERT INTO public.steel_types(name,density_kg_mm3)
    VALUES ('Sheet scrap test grade',0.0000078) RETURNING id INTO v_steel;
  INSERT INTO public.material_variants(material_id,category,thickness_mm,sheet_size,steel_type_id)
    VALUES (v_material,'sheet_metal',2,'500x300',v_steel) RETURNING id INTO v_variant;
  INSERT INTO public.material_variants(material_id,category,thickness_mm,sheet_size,steel_type_id)
    VALUES (v_material,'sheet_metal',2,'1200x300',v_steel) RETURNING id INTO v_source_variant;
  INSERT INTO public.request_sheet_metal(request_id,material_name,sheet_size,quantity_sheets,
    material_id,material_variant_id,steel_type_id,thickness_mm)
    VALUES (v_request,'Test sheet','1200x300',2,v_material,v_source_variant,v_steel,2)
    RETURNING id INTO v_source;
  SELECT id INTO v_stage FROM public.production_stages
    WHERE machine_id=v_machine AND stage_type='cutting' LIMIT 1;
  UPDATE public.production_stages SET date_start=current_date - 1 WHERE id=v_stage;
  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,source_machine_id,
    available_from_stage_id,last_updated_by)
    VALUES (v_factory,v_material,v_variant,2,0,'шт',true,'future',v_machine,v_stage,v_actor)
    RETURNING id INTO v_inventory;
  INSERT INTO public.technologist_request_completions(request_id,machine_id,factory_id,created_by,
    future_detailing_decision,entered_plasma_minutes,added_plasma_minutes,actual_plasma_minutes)
    VALUES (v_request,v_machine,v_factory,v_actor,'none',0,0,0) RETURNING id INTO v_completion;
  INSERT INTO public.technologist_sheet_scrap_plans(completion_id,request_id,source_item_id,
    line_number,inventory_id,length_mm,width_mm,quantity,weight_kg)
    VALUES (v_completion,v_request,v_source,1,v_inventory,500,300,2,70.200) RETURNING id INTO v_plan;
  IF public.fn_promote_due_future_business_scrap(current_date) <> 0 THEN
    RAISE EXCEPTION 'Date promoter advanced sheet remnant';
  END IF;
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'future' THEN
    RAISE EXCEPTION 'Sheet remnant advanced before cutting fact';
  END IF;
  -- Yesterday's fact and a new fact without a consumed source do not produce
  -- a sheet remnant declared in today's completion wizard.
  INSERT INTO public.production_fact_cutting_events(machine_id,factory_id,fact_date,stage_id,created_by,created_at)
    VALUES (v_machine,v_factory,current_date-1,v_stage,v_actor,now()-interval '1 day') RETURNING id INTO v_event;
  IF public.fn_promote_sheet_scrap_for_cutting_event_v1(v_event,NULL) <> 0
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'future' THEN
    RAISE EXCEPTION 'Earlier machine fact incorrectly promoted new sheet remnant';
  END IF;
  INSERT INTO public.production_fact_cutting_events(machine_id,factory_id,fact_date,stage_id,created_by)
    VALUES (v_machine,v_factory,current_date,v_stage,v_actor) RETURNING id INTO v_second_event;
  IF public.fn_promote_sheet_scrap_for_cutting_event_v1(v_second_event,NULL) <> 0
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'future' THEN
    RAISE EXCEPTION 'Machine-only fact incorrectly promoted sheet remnant';
  END IF;

  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,last_updated_by)
    VALUES (v_factory,v_material,v_source_variant,2,0,'шт',v_actor) RETURNING id INTO v_source_inventory;
  INSERT INTO public.inventory_reservations(inventory_id,material_id,machine_id,
    request_item_table,request_item_id,reserved_quantity,reserved_by)
    VALUES (v_source_inventory,v_material,v_machine,'request_sheet_metal',v_source,2,v_actor)
    RETURNING id INTO v_reservation;
  UPDATE public.inventory_reservations SET consumed_at=now(),consumed_by=v_actor,
    consumed_cutting_event_id=v_second_event WHERE id=v_reservation;
  INSERT INTO public.production_fact_cutting_event_reservations(event_id,reservation_id,
    inventory_id,material_id,material_variant_id,request_item_table,request_item_id,
    reserved_quantity,consumed_quantity)
    VALUES (v_second_event,v_reservation,v_source_inventory,v_material,v_source_variant,
      'request_sheet_metal',v_source,2,2);
  v_promoted := public.fn_promote_sheet_scrap_for_cutting_event_v1(v_second_event,NULL);
  IF v_promoted <> 1
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'available'
    OR (SELECT promoted_event_id FROM public.technologist_sheet_scrap_plans WHERE id=v_plan) IS DISTINCT FROM v_second_event THEN
    RAISE EXCEPTION 'Consumed source did not promote sheet remnant';
  END IF;
  IF public.fn_promote_sheet_scrap_for_cutting_event_v1(v_second_event,NULL) <> 0 THEN
    RAISE EXCEPTION 'Repeated fact promoted the same remnant twice';
  END IF;
  v_preview := public.fn_get_production_cutting_rollback_preview(v_machine);
  IF (v_preview->>'canRollback')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Untouched sheet remnant blocked rollback: %',v_preview;
  END IF;
  IF (SELECT count(*) FROM public.production_fact_cutting_event_scrap_promotions WHERE inventory_id=v_inventory) <> 1 THEN
    RAISE EXCEPTION 'Wrong number of sheet promotion records';
  END IF;

  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,source_machine_id,
    available_from_stage_id,last_updated_by,created_at)
    VALUES (v_factory,v_material,v_variant,1,0,'шт',true,'future',v_machine,v_stage,v_actor,
      now()+interval '1 minute')
    RETURNING id INTO v_late_inventory;
  INSERT INTO public.technologist_sheet_scrap_plans(completion_id,request_id,source_item_id,
    line_number,inventory_id,length_mm,width_mm,quantity,weight_kg,created_at)
    VALUES (v_completion,v_request,v_source,2,v_late_inventory,500,300,1,35.100,
      now()+interval '1 minute');
  IF public.fn_promote_sheet_scrap_for_cutting_event_v1(v_second_event,NULL) <> 0
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_late_inventory) <> 'future' THEN
    RAISE EXCEPTION 'Sheet remnant approved after fact was promoted retroactively';
  END IF;

  -- Real fact RPC: an already stocked source sheet is consumed, and only its
  -- newly planned remnant moves from future to available.
  INSERT INTO public.request_sheet_metal(request_id,material_name,sheet_size,quantity_sheets,
    material_id,material_variant_id,steel_type_id,thickness_mm,
    source_nesting_project_id,source_nesting_sheet_id,source_nesting_sheet_ids)
    VALUES (v_request,'Test sheet','1200x300',2,v_material,v_source_variant,v_steel,2,
      'sheet-fact-test-project','group-key',ARRAY['physical-sheet-a','physical-sheet-b'])
    RETURNING id INTO v_next_source;
  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,source_machine_id,
    available_from_stage_id,last_updated_by)
    VALUES (v_factory,v_material,v_variant,1,0,'шт',true,'future',v_machine,v_stage,v_actor)
    RETURNING id INTO v_next_inventory;
  INSERT INTO public.technologist_sheet_scrap_plans(completion_id,request_id,source_item_id,
    line_number,inventory_id,length_mm,width_mm,quantity,weight_kg)
    VALUES (v_completion,v_request,v_next_source,1,v_next_inventory,500,300,1,35.100);
  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,source_machine_id,
    available_from_stage_id,source_nesting_project_id,source_nesting_sheet_id,last_updated_by)
    VALUES (v_factory,v_material,v_variant,1,0,'шт',true,'future',v_machine,v_stage,
      'sheet-fact-test-project','physical-sheet-a',v_actor)
    RETURNING id INTO v_nested_inventory;
  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,source_machine_id,
    available_from_stage_id,source_nesting_project_id,source_nesting_sheet_id,last_updated_by)
    VALUES (v_factory,v_material,v_variant,1,0,'шт',true,'future',v_machine,v_stage,
      'sheet-fact-test-project','physical-sheet-b',v_actor)
    RETURNING id INTO v_other_nested_inventory;
  INSERT INTO public.inventory_reservations(inventory_id,material_id,machine_id,
    request_item_table,request_item_id,reserved_quantity,reserved_by)
    VALUES (v_source_inventory,v_material,v_machine,'request_sheet_metal',v_next_source,1,v_actor)
    RETURNING id INTO v_next_reservation;
  UPDATE public.inventory SET reserved_quantity=1 WHERE id=v_source_inventory;
  INSERT INTO public.production_fact_sections(factory_id,name,production_stage_type,created_by,updated_by)
    VALUES (v_factory,'Sheet scrap fact test','cutting',v_actor,v_actor) RETURNING id INTO v_section;
  INSERT INTO public.production_machine_facts(factory_id,fact_date,shift,machine_id,section_id,
    created_by,updated_by)
    VALUES (v_factory,current_date,'day',v_machine,v_section,v_actor,v_actor)
    RETURNING id INTO v_fact;
  v_third_event := public.fn_apply_production_fact_cutting(v_fact,v_actor);
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_next_inventory) <> 'available'
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_nested_inventory) <> 'available'
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_other_nested_inventory) <> 'future'
    OR (SELECT promoted_event_id FROM public.technologist_sheet_scrap_plans
        WHERE inventory_id=v_next_inventory) IS DISTINCT FROM v_third_event
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_late_inventory) <> 'future'
    OR (SELECT consumed_cutting_event_id FROM public.inventory_reservations
        WHERE id=v_next_reservation) IS DISTINCT FROM v_third_event THEN
    RAISE EXCEPTION 'Real sheet cutting fact failed to promote only its source remnant';
  END IF;
  IF public.fn_apply_production_fact_cutting(v_fact,v_actor) IS DISTINCT FROM v_third_event
    OR (SELECT count(*) FROM public.production_fact_cutting_event_scrap_promotions
        WHERE inventory_id=v_next_inventory) <> 1 THEN
    RAISE EXCEPTION 'Repeated real sheet cutting fact promoted twice';
  END IF;
  INSERT INTO public.inventory_reservations(inventory_id,material_id,machine_id,
    request_item_table,request_item_id,reserved_quantity,reserved_by)
    VALUES (v_source_inventory,v_material,v_machine,'request_sheet_metal',v_next_source,1,v_actor)
    RETURNING id INTO v_next_reservation_second;
  UPDATE public.inventory SET reserved_quantity=1 WHERE id=v_source_inventory;
  INSERT INTO public.production_machine_facts(factory_id,fact_date,shift,machine_id,section_id,
    created_by,updated_by)
    VALUES (v_factory,current_date+1,'day',v_machine,v_section,v_actor,v_actor)
    RETURNING id INTO v_fact_second;
  v_fourth_event := public.fn_apply_production_fact_cutting(v_fact_second,v_actor);
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_other_nested_inventory) <> 'available'
    OR (SELECT consumed_cutting_event_id FROM public.inventory_reservations
        WHERE id=v_next_reservation_second) IS DISTINCT FROM v_fourth_event
    OR (SELECT count(*) FROM public.production_fact_cutting_event_scrap_promotions
        WHERE inventory_id=v_other_nested_inventory) <> 1 THEN
    RAISE EXCEPTION 'Second partial sheet fact did not release the remaining remnant';
  END IF;
  DELETE FROM public.production_machine_facts WHERE id IN (v_fact,v_fact_second);
  v_preview := public.fn_get_production_cutting_rollback_preview(v_machine);
  IF (v_preview->>'canRollback')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Unused sheet remnants blocked rollback: %',v_preview;
  END IF;
  PERFORM public.fn_apply_production_cutting_rollback(v_machine,NULL,v_actor,'sheet source rollback');
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_next_inventory) <> 'future'
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_nested_inventory) <> 'future'
    OR (SELECT promoted_event_id FROM public.technologist_sheet_scrap_plans
        WHERE inventory_id=v_next_inventory) IS NOT NULL
    OR (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'future' THEN
    RAISE EXCEPTION 'Rollback did not restore unused sheet remnants';
  END IF;

  -- The conversion RPC uses the inventory row's mass, including sheet rows
  -- without a physical bar length or a per-metre variant weight.
  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,last_updated_by)
    VALUES (v_factory,v_material,v_variant,1,0,'шт',true,'available',v_actor)
    RETURNING id INTO v_convert_inventory;
  UPDATE public.inventory SET calculated_weight_kg=9.36 WHERE id=v_convert_inventory;
  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,last_updated_by)
    VALUES (v_factory,v_material,v_variant,1,0,'шт',true,'available',v_actor)
    RETURNING id INTO v_no_weight;
  UPDATE public.inventory SET calculated_weight_kg=NULL WHERE id=v_no_weight;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN
    PERFORM public.fn_convert_business_scrap_to_metal_v1(ARRAY[v_convert_inventory,v_no_weight],v_actor);
    RAISE EXCEPTION 'Conversion without weight was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Conversion without weight was accepted' THEN RAISE; END IF;
    IF position('не рассчитан вес позиции' IN SQLERRM)=0 THEN
      RAISE EXCEPTION 'Missing weight was blocked for an unrelated reason: %',SQLERRM;
    END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.metal_scrap_lots WHERE source_inventory_id=v_convert_inventory) THEN
    RAISE EXCEPTION 'Failed batch partially converted a remnant';
  END IF;
  v_lot := public.fn_convert_business_scrap_to_metal_v1(ARRAY[v_convert_inventory],v_actor);
  IF (v_lot->>'total_weight_kg')::numeric <> 9.36
    OR NOT EXISTS (SELECT 1 FROM public.metal_scrap_lots
      WHERE source_inventory_id=v_convert_inventory AND available_weight_kg=9.36) THEN
    RAISE EXCEPTION 'Inventory row mass was not preserved in metal scrap: %', v_lot;
  END IF;
END;
$test$;
ROLLBACK;
