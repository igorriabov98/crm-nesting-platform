\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory uuid;
  v_author uuid := gen_random_uuid();
  v_supply uuid := gen_random_uuid();
  v_reviewer uuid;
  v_tech_department uuid := gen_random_uuid();
  v_supply_department uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_machine_request uuid := gen_random_uuid();
  v_stock_item uuid := gen_random_uuid();
  v_machine_item uuid := gen_random_uuid();
  v_supplier uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_schedule uuid := gen_random_uuid();
  v_version uuid;
  v_result jsonb;
  v_error text;
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY id LIMIT 1;
  IF v_factory IS NULL THEN RAISE EXCEPTION 'Нет тестового завода'; END IF;

  INSERT INTO public.users(id,email,full_name,role,factory_id,is_active) VALUES
    (v_author, v_author || '@stock-request.test', 'Технолог склада', 'technologist', v_factory, true),
    (v_supply, v_supply || '@stock-request.test', 'Снабженец склада', 'supply_manager', v_factory, true);
  INSERT INTO public.departments(id,name,factory_id,is_active,created_by) VALUES
    (v_tech_department, 'Stock request tech ' || v_author, v_factory, true, v_author),
    (v_supply_department, 'Stock request supply ' || v_supply, v_factory, true, v_supply);
  INSERT INTO public.department_members(user_id,department_id,is_department_head,created_by) VALUES
    (v_author,v_tech_department,false,v_author),
    (v_supply,v_supply_department,false,v_supply);
  INSERT INTO public.department_access_permissions(
    department_id,subject_scope,resource_key,can_view,can_manage,updated_by
  ) VALUES
    (v_tech_department,'member','technologist_requests',true,true,v_author),
    (v_supply_department,'member','supply_orders',true,true,v_supply),
    (v_supply_department,'member','supply_material_requests',true,true,v_supply),
    (v_supply_department,'member','inventory_receiving',true,true,v_supply);
  SELECT public.fn_technologist_approval_department_head('Финансовый отдел') INTO v_reviewer;
  IF v_reviewer IS NULL THEN RAISE EXCEPTION 'Нет финансового согласующего в тестовой схеме'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  INSERT INTO public.technologist_requests(id,request_kind,machine_id,factory_id,title,needed_by,created_by,status)
  VALUES (v_request,'stock',NULL,v_factory,'Тестовая закупка на склад',NULL,v_author,'draft');
  IF NOT EXISTS (SELECT 1 FROM private.technologist_number_series
    WHERE id = v_request AND machine_id IS NULL AND request_number > 0) THEN
    RAISE EXCEPTION 'Складская заявка не получила отдельный номер';
  END IF;
  BEGIN
    PERFORM public.fn_submit_stock_request_for_approval(v_request,v_author,
      jsonb_build_object('requestId',v_request,'orderName','Тестовая закупка на склад',
        'factoryId',v_factory,'neededBy',NULL,'sourceData',public.fn_technologist_approval_source(v_request)));
    RAISE EXCEPTION 'Пустая заявка была отправлена';
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
    IF v_error NOT LIKE '%Добавьте хотя бы одну позицию%' THEN RAISE; END IF;
  END;

  INSERT INTO public.suppliers(id,name) VALUES (v_supplier,'Поставщик тестовой заявки');
  INSERT INTO public.supplier_material_categories(supplier_id,category) VALUES (v_supplier,'paint');
  INSERT INTO public.materials(id,name,category,default_supplier_id,created_by)
  VALUES (v_material,'Краска для свободного склада','paint',v_supplier,v_author);
  INSERT INTO public.request_paint(id,request_id,paint_type,ral_code,finish,weight_kg,
    waste_percent,material_id,supplier_id,remainder_kg)
  VALUES (v_stock_item,v_request,'stock test','9010','матовый',4,0,v_material,v_supplier,4);

  PERFORM set_config('request.jwt.claim.sub', v_supply::text, true);
  IF private.stock_request_visible(v_request) THEN
    RAISE EXCEPTION 'Снабжение видит черновик складской заявки';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  SELECT public.fn_submit_stock_request_for_approval(v_request,v_author,
    jsonb_build_object('requestId',v_request,'orderName','Тестовая закупка на склад',
      'factoryId',v_factory,'neededBy',NULL,'sourceData',public.fn_technologist_approval_source(v_request)))
  INTO v_version;
  IF (SELECT status FROM public.technologist_requests WHERE id = v_request) <> 'pending_financial_approval' THEN
    RAISE EXCEPTION 'Заявка не отправлена на согласование';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_supply::text, true);
  IF private.stock_request_visible(v_request) THEN
    RAISE EXCEPTION 'Снабжение видит заявку до одобрения';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_reviewer::text, true);
  PERFORM public.fn_return_stock_request_for_revision(v_version,v_reviewer,'Уточнить количество');
  IF (SELECT status FROM public.technologist_requests WHERE id = v_request) <> 'draft' THEN
    RAISE EXCEPTION 'Возврат не открыл черновик';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  PERFORM public.fn_begin_stock_request_revision(v_request,v_author);
  UPDATE public.request_paint SET weight_kg = 5, remainder_kg = 5 WHERE id = v_stock_item;
  SELECT public.fn_submit_stock_request_for_approval(v_request,v_author,
    jsonb_build_object('requestId',v_request,'orderName','Тестовая закупка на склад',
      'factoryId',v_factory,'neededBy',NULL,'sourceData',public.fn_technologist_approval_source(v_request)))
  INTO v_version;
  IF (SELECT count(*) FROM public.technologist_request_approval_versions WHERE request_id = v_request) <> 2 THEN
    RAISE EXCEPTION 'Повторная отправка не сохранила историю версий';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_reviewer::text, true);
  PERFORM public.fn_approve_stock_request(v_version,v_reviewer);
  IF (SELECT status FROM public.technologist_requests WHERE id = v_request) <> 'submitted_to_supply'
    OR EXISTS (SELECT 1 FROM public.technologist_request_completions WHERE request_id = v_request)
    OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE request_item_id = v_stock_item) THEN
    RAISE EXCEPTION 'Одобрение ошибочно запустило производство или бронь';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_supply::text, true);
  IF NOT private.stock_request_visible(v_request) THEN
    RAISE EXCEPTION 'Снабжение не видит одобренную заявку';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_author::text, true);
  INSERT INTO public.machines(id,factory_id,name,created_by)
  VALUES (v_machine,v_factory,'Машина смешанной приёмки',v_author);
  INSERT INTO public.technologist_requests(id,machine_id,created_by,status)
  VALUES (v_machine_request,v_machine,v_author,'submitted_to_supply');
  INSERT INTO public.request_paint(id,request_id,paint_type,ral_code,finish,weight_kg,
    waste_percent,material_id,supplier_id,remainder_kg,order_status,ordered_at)
  VALUES (v_machine_item,v_machine_request,'machine test','9010','матовый',6,0,
    v_material,v_supplier,6,'ordered',now());
  PERFORM set_config('request.jwt.claim.sub', v_supply::text, true);
  UPDATE public.request_paint SET order_status = 'ordered', ordered_at = now()
  WHERE id = v_stock_item;
  INSERT INTO public.supply_order_delivery_schedules(
    id,request_item_table,request_item_id,delivery_date,quantity,unit,supplier_id,created_by,updated_by
  ) VALUES (v_schedule,'request_paint',v_stock_item,current_date,15,'кг',v_supplier,v_supply,v_supply);
  SELECT public.fn_receive_supply_order_schedule_v3(
    v_schedule,v_supply,15,
    jsonb_build_array(
      jsonb_build_object('table','request_paint','id',v_stock_item,'quantity',5,'physical_quantity',5,'piece_count',NULL),
      jsonb_build_object('table','request_paint','id',v_machine_item,'quantity',6,'physical_quantity',6,'piece_count',NULL)
    ),NULL,NULL,NULL
  ) INTO v_result;
  IF (SELECT total_quantity FROM public.inventory WHERE factory_id = v_factory AND material_id = v_material) <> 15
    OR (SELECT reserved_quantity FROM public.inventory WHERE factory_id = v_factory AND material_id = v_material) <> 6
    OR (SELECT available_quantity FROM public.inventory WHERE factory_id = v_factory AND material_id = v_material) <> 9
    OR EXISTS (SELECT 1 FROM public.inventory_reservations WHERE request_item_id = v_stock_item)
    OR (SELECT count(*) FROM public.inventory_reservations WHERE request_item_id = v_machine_item) <> 1
    OR (SELECT status FROM public.technologist_requests WHERE id = v_request) <> 'completed' THEN
    RAISE EXCEPTION 'Смешанная приёмка неверно распределила свободный остаток: %', v_result;
  END IF;
END;
$$;

ROLLBACK;
