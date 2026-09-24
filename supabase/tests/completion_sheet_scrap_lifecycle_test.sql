BEGIN;
DO $test$
DECLARE
  v_actor uuid;
  v_factory uuid;
  v_machine uuid;
  v_request uuid;
  v_material uuid;
  v_variant uuid;
  v_source uuid;
  v_inventory uuid;
  v_late_inventory uuid;
  v_completion uuid;
  v_stage uuid;
  v_event uuid;
  v_second_event uuid;
  v_third_event uuid;
  v_plan uuid;
  v_calc jsonb;
  v_preview jsonb;
BEGIN
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
  INSERT INTO public.material_variants(material_id,category,thickness_mm,sheet_size)
    VALUES (v_material,'sheet_metal',2,'500x300') RETURNING id INTO v_variant;
  INSERT INTO public.request_sheet_metal(request_id,material_name,sheet_size,quantity_sheets)
    VALUES (v_request,'Test sheet','1200x300',2) RETURNING id INTO v_source;
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
  INSERT INTO public.production_fact_cutting_events(machine_id,factory_id,fact_date,stage_id,created_by)
    VALUES (v_machine,v_factory,current_date,v_stage,v_actor) RETURNING id INTO v_event;
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'available'
    OR (SELECT promoted_event_id FROM public.technologist_sheet_scrap_plans WHERE id=v_plan) IS DISTINCT FROM v_event
    OR (SELECT count(*) FROM public.production_fact_cutting_event_scrap_promotions WHERE inventory_id=v_inventory) <> 1 THEN
    RAISE EXCEPTION 'First cutting fact did not promote once';
  END IF;
  INSERT INTO public.production_fact_cutting_events(machine_id,factory_id,fact_date,stage_id,created_by)
    VALUES (v_machine,v_factory,current_date,v_stage,v_actor) RETURNING id INTO v_second_event;
  IF (SELECT count(*) FROM public.production_fact_cutting_event_scrap_promotions WHERE inventory_id=v_inventory) <> 1 THEN
    RAISE EXCEPTION 'Repeated cutting fact promoted again';
  END IF;
  v_preview := public.fn_get_production_cutting_rollback_preview(v_machine);
  IF (v_preview->>'canRollback')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Untouched remnant blocked rollback: %', v_preview;
  END IF;
  PERFORM public.fn_apply_production_cutting_rollback(v_machine,null,v_actor,'sheet test');
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'future'
    OR (SELECT promoted_event_id FROM public.technologist_sheet_scrap_plans WHERE id=v_plan) IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback did not restore future sheet remnant';
  END IF;
  INSERT INTO public.production_fact_cutting_events(machine_id,factory_id,fact_date,stage_id,created_by)
    VALUES (v_machine,v_factory,current_date,v_stage,v_actor) RETURNING id INTO v_third_event;
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_inventory) <> 'available'
    OR (SELECT promoted_event_id FROM public.technologist_sheet_scrap_plans WHERE id=v_plan) IS DISTINCT FROM v_third_event THEN
    RAISE EXCEPTION 'Cutting fact after rollback did not promote again';
  END IF;
  INSERT INTO public.inventory(factory_id,material_id,material_variant_id,total_quantity,
    reserved_quantity,unit,is_business_scrap,business_scrap_state,source_machine_id,
    available_from_stage_id,last_updated_by)
    VALUES (v_factory,v_material,v_variant,1,0,'шт',true,'future',v_machine,v_stage,v_actor)
    RETURNING id INTO v_late_inventory;
  INSERT INTO public.technologist_sheet_scrap_plans(completion_id,request_id,source_item_id,
    line_number,inventory_id,length_mm,width_mm,quantity,weight_kg)
    VALUES (v_completion,v_request,v_source,2,v_late_inventory,500,300,1,35.100);
  PERFORM public.fn_promote_sheet_scrap_for_cutting_event_v1(v_third_event,null);
  IF (SELECT business_scrap_state FROM public.inventory WHERE id=v_late_inventory) <> 'available'
    OR (SELECT count(*) FROM public.production_fact_cutting_event_scrap_promotions
        WHERE event_id=v_third_event AND inventory_id=v_late_inventory) <> 1 THEN
    RAISE EXCEPTION 'Plan approved after cutting fact did not promote';
  END IF;
  INSERT INTO public.inventory_transactions(inventory_id,material_id,transaction_type,
    quantity,performed_by,comment,factory_id)
    VALUES (v_inventory,v_material,'adjustment',-1,v_actor,'use remnant',v_factory);
  v_preview := public.fn_get_production_cutting_rollback_preview(v_machine);
  IF NOT (v_preview->'blockers' ? 'Будущий листовой остаток уже использован или перемещён') THEN
    RAISE EXCEPTION 'Rollback preview failed to block consumed remnant: %', v_preview;
  END IF;
END;
$test$;
ROLLBACK;
