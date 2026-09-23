CREATE UNIQUE INDEX tasks_one_open_steel_density_idx ON public.tasks(steel_type_id)
  WHERE task_type = 'steel_density_completion' AND status IN ('pending','in_progress');

CREATE OR REPLACE FUNCTION private.prepare_sheet_inventory_import(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_input jsonb; v_row integer; v_count integer;
  v_material text; v_grade text;
  v_thickness numeric; v_width numeric; v_length numeric; v_qty numeric;
  v_material_id uuid; v_steel_id uuid; v_variant_id uuid;
  v_density numeric; v_weight numeric;
  v_rows jsonb := '[]'; v_errors jsonb := '[]'; v_message text;
  v_seen_rows jsonb := '{}'; v_fingerprint text;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Импорт должен содержать от 1 до 2 000 строк';
  END IF;
  IF pg_column_size(p_rows) > 3000000 THEN RAISE EXCEPTION 'Слишком большой объём данных'; END IF;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_row := 0;
    BEGIN
      v_row := (v_input->>'row')::integer;
      IF v_input ?| ARRAY['density','supplier','comment'] THEN
        RAISE EXCEPTION 'Формат старого шаблона больше не поддерживается. Скачайте шаблон с колонками A–F';
      END IF;
      v_material := btrim(regexp_replace(v_input->>'material', '\s+', ' ', 'g'));
      v_grade := btrim(regexp_replace(v_input->>'grade', '\s+', ' ', 'g'));
      v_thickness := (v_input->>'thickness')::numeric;
      v_width := (v_input->>'width')::numeric;
      v_length := (v_input->>'length')::numeric;
      v_qty := (v_input->>'quantity')::numeric;
      IF v_row IS NULL OR v_row < 2 OR v_row > 1048576
        OR coalesce(length(v_material),0) NOT BETWEEN 1 AND 200
        OR coalesce(length(v_grade),0) NOT BETWEEN 1 AND 200
        OR v_thickness IS NULL OR NOT (v_thickness > 0 AND v_thickness <= 1000000)
        OR v_width IS NULL OR NOT (v_width > 0 AND v_width <= 1000000)
        OR v_length IS NULL OR NOT (v_length > 0 AND v_length <= 1000000)
        OR v_qty IS NULL OR NOT (v_qty > 0 AND v_qty <= 1000000000) OR trunc(v_qty) <> v_qty THEN
        RAISE EXCEPTION 'Некорректные названия, размеры или количество листов';
      END IF;
      IF v_seen_rows ? v_row::text THEN RAISE EXCEPTION 'Повтор номера строки'; END IF;
      v_seen_rows := v_seen_rows || jsonb_build_object(v_row::text,true);

      SELECT count(*), (array_agg(id ORDER BY id))[1], min(density_kg_mm3) * 1000000
      INTO v_count, v_steel_id, v_density FROM public.steel_types
      WHERE private.sheet_import_name(name) = private.sheet_import_name(v_grade);
      IF v_count > 1 THEN RAISE EXCEPTION 'Несколько марок стали «%». Уточните справочник', v_grade; END IF;
      IF v_steel_id IS NULL AND NOT (private.crm_has_permission('materials','manage') OR private.crm_has_permission('nesting_catalog','manage')) THEN
        RAISE EXCEPTION 'Нет права создавать марки стали' USING ERRCODE = '42501';
      END IF;
      IF v_density IS NOT NULL AND NOT (v_density > 0 AND v_density <= 30) THEN
        RAISE EXCEPTION 'В справочнике указана некорректная плотность';
      END IF;

      -- A material name is not unique: the position is the complete variant.
      v_material_id := NULL; v_variant_id := NULL;
      IF v_steel_id IS NOT NULL THEN
        SELECT count(*), (array_agg(v.id ORDER BY v.id))[1], (array_agg(m.id ORDER BY v.id))[1]
        INTO v_count, v_variant_id, v_material_id
        FROM public.material_variants v JOIN public.materials m ON m.id = v.material_id
        WHERE m.category = 'sheet_metal' AND m.is_active AND v.category = 'sheet_metal'
          AND private.sheet_import_name(m.name) = private.sheet_import_name(v_material)
          AND (v.steel_type_id = v_steel_id OR
            (v.steel_type_id IS NULL AND private.sheet_import_name(v.material_grade) = private.sheet_import_name(v_grade)))
          AND v.thickness_mm = v_thickness
          AND public.parse_size_dimensions(v.sheet_size) = ARRAY[v_width,v_length];
        IF v_count > 1 THEN RAISE EXCEPTION 'Несколько одинаковых позиций «%», марка «%», % × % × % мм. Уточните справочник',
          v_material,v_grade,v_thickness,v_width,v_length; END IF;
      END IF;
      IF v_variant_id IS NULL AND NOT private.crm_has_permission('materials','manage') THEN
        RAISE EXCEPTION 'Для создания новой позиции нужно право редактирования справочника материалов' USING ERRCODE = '42501';
      END IF;

      v_weight := CASE WHEN v_density IS NULL THEN NULL
        ELSE round(v_thickness*v_width*v_length*v_density/1000000*v_qty,2) END;
      v_rows := v_rows || jsonb_build_array(v_input || jsonb_build_object(
        'material',v_material,'grade',v_grade,'materialId',v_material_id,
        'steelTypeId',v_steel_id,'variantId',v_variant_id,'density',v_density,'weightKg',v_weight));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row',coalesce(v_row,0),'message',v_message));
    END;
  END LOOP;
  -- File order and splitting one position over several rows must not evade duplicate detection.
  SELECT encode(sha256(convert_to(coalesce(jsonb_agg(position ORDER BY position::text),'[]')::text,'UTF8')),'hex')
  INTO v_fingerprint FROM (
    SELECT jsonb_build_array(private.sheet_import_name(r->>'material'),private.sheet_import_name(r->>'grade'),
      (r->>'thickness')::numeric,(r->>'width')::numeric,(r->>'length')::numeric,
      sum((r->>'quantity')::numeric)) AS position
    FROM jsonb_array_elements(v_rows) r
    GROUP BY private.sheet_import_name(r->>'material'),private.sheet_import_name(r->>'grade'),
      (r->>'thickness')::numeric,(r->>'width')::numeric,(r->>'length')::numeric
  ) positions;
  RETURN jsonb_build_object('rows',v_rows,'errors',v_errors,'fingerprint',v_fingerprint,
    'previewHash',encode(sha256(convert_to(v_rows::text,'UTF8')),'hex'),
    'quantity',coalesce((SELECT sum((r->>'quantity')::numeric) FROM jsonb_array_elements(v_rows) r),0),
    'weightKg',(SELECT CASE WHEN bool_or(r->>'weightKg' IS NULL) THEN NULL
      ELSE coalesce(sum((r->>'weightKg')::numeric),0) END FROM jsonb_array_elements(v_rows) r),
    'pendingDensityGrades',coalesce((SELECT jsonb_agg(name ORDER BY name) FROM (
      SELECT DISTINCT r->>'grade' AS name FROM jsonb_array_elements(v_rows) r WHERE r->>'density' IS NULL
    ) missing),'[]'),
    'newMaterials',(SELECT count(DISTINCT jsonb_build_array(private.sheet_import_name(r->>'material'),
      private.sheet_import_name(r->>'grade'),r->'thickness',r->'width',r->'length'))
      FROM jsonb_array_elements(v_rows) r WHERE r->>'variantId' IS NULL),
    'newGrades',(SELECT count(DISTINCT private.sheet_import_name(r->>'grade'))
      FROM jsonb_array_elements(v_rows) r WHERE r->>'steelTypeId' IS NULL),
    'newVariants',(SELECT count(DISTINCT jsonb_build_array(private.sheet_import_name(r->>'material'),
      private.sheet_import_name(r->>'grade'),r->'thickness',r->'width',r->'length'))
      FROM jsonb_array_elements(v_rows) r WHERE r->>'variantId' IS NULL));
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_commit_sheet_inventory_import(
  p_factory_id uuid, p_rows jsonb, p_file_name text, p_operation_id uuid,
  p_preview_hash text, p_previous_import_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid(); v_preview jsonb; v_row jsonb;
  v_input_hash text; v_previous uuid; v_existing public.inventory_sheet_imports%rowtype;
  v_material uuid; v_steel uuid; v_variant uuid; v_inventory uuid; v_count integer;
  v_assignee uuid; v_logged_rows jsonb := '[]';
BEGIN
  IF v_actor IS NULL OR NOT private.crm_has_factory_permission('inventory','manage',p_factory_id) THEN
    RAISE EXCEPTION 'Нет права пополнять склад выбранного завода' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR coalesce(length(p_file_name),0) NOT BETWEEN 1 AND 255 THEN
    RAISE EXCEPTION 'Некорректный идентификатор операции или имя файла';
  END IF;
  v_input_hash := encode(sha256(convert_to(p_rows::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-sheet-import-v1',0));
  SELECT * INTO v_existing FROM public.inventory_sheet_imports WHERE id = p_operation_id;
  IF FOUND THEN
    IF v_existing.factory_id <> p_factory_id OR v_existing.performed_by <> v_actor OR v_existing.input_hash IS DISTINCT FROM v_input_hash THEN
      RAISE EXCEPTION 'Идентификатор операции уже использован для другого импорта';
    END IF;
    RETURN jsonb_build_object('batchId',v_existing.id,'receiptCount',v_existing.receipt_count,
      'quantity',v_existing.quantity,'weightKg',v_existing.weight_kg,'replayed',true);
  END IF;
  LOCK TABLE public.materials,public.material_variants,public.steel_types IN SHARE ROW EXCLUSIVE MODE;
  v_preview := private.prepare_sheet_inventory_import(p_rows);
  IF jsonb_array_length(v_preview->'errors') > 0 THEN
    RAISE EXCEPTION 'Строка %: %',v_preview->'errors'->0->>'row',v_preview->'errors'->0->>'message';
  END IF;
  IF v_preview->>'previewHash' IS DISTINCT FROM p_preview_hash THEN
    RAISE EXCEPTION 'Справочники или данные изменились. Повторите проверку файла' USING ERRCODE = '40001';
  END IF;
  SELECT id INTO v_previous FROM public.inventory_sheet_imports
  WHERE factory_id = p_factory_id AND fingerprint = v_preview->>'fingerprint' ORDER BY created_at DESC,id LIMIT 1;
  IF v_previous IS DISTINCT FROM p_previous_import_id THEN
    RAISE EXCEPTION 'Эти данные уже импортированы или изменился предыдущий импорт. Повторите проверку и подтвердите новый приход' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.inventory_sheet_imports(id,factory_id,performed_by,file_name,fingerprint,input_hash,source_rows,receipt_count,quantity,weight_kg,repeated_from)
  VALUES(p_operation_id,p_factory_id,v_actor,p_file_name,v_preview->>'fingerprint',v_input_hash,v_preview->'rows',jsonb_array_length(p_rows),
    (v_preview->>'quantity')::numeric,(v_preview->>'weightKg')::numeric,p_previous_import_id);

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_preview->'rows') LOOP
    SELECT id INTO v_steel FROM public.steel_types
    WHERE private.sheet_import_name(name) = private.sheet_import_name(v_row->>'grade');
    IF v_steel IS NULL THEN
      INSERT INTO public.steel_types(name,density_kg_mm3) VALUES(v_row->>'grade',NULL) RETURNING id INTO v_steel;
    END IF;
    IF v_row->>'density' IS NULL THEN
      SELECT u.id INTO v_assignee FROM public.company_settings s JOIN public.users u
        ON u.id = s.auto_task_technologist_user_id
      WHERE s.id = '00000000-0000-0000-0000-000000000001'
        AND u.role = 'technologist' AND u.is_active IS TRUE AND coalesce(u.is_service_account,false) IS FALSE LIMIT 1;
      IF v_assignee IS NULL THEN
        SELECT id INTO v_assignee FROM public.users
        WHERE role = 'technologist' AND is_active IS TRUE AND coalesce(is_service_account,false) IS FALSE
        ORDER BY id LIMIT 1;
      END IF;
      IF v_assignee IS NULL THEN RAISE EXCEPTION 'Не найден активный технолог для задачи по плотности марки «%»',v_row->>'grade'; END IF;
      INSERT INTO public.tasks(steel_type_id,assigned_to,task_type,title,description,status,start_date,deadline)
      VALUES(v_steel,v_assignee,'steel_density_completion',
        'Указать плотность стали: ' || (v_row->>'grade'),
        'Заполните плотность марки «' || (v_row->>'grade') || '» в справочнике марок стали. Вес складских остатков пересчитается автоматически.',
        'pending',current_date,current_date)
      ON CONFLICT DO NOTHING;
    END IF;

    SELECT count(*), (array_agg(v.id ORDER BY v.id))[1], (array_agg(m.id ORDER BY v.id))[1]
    INTO v_count,v_variant,v_material FROM public.material_variants v JOIN public.materials m ON m.id = v.material_id
    WHERE m.category = 'sheet_metal' AND m.is_active AND v.category = 'sheet_metal'
      AND private.sheet_import_name(m.name) = private.sheet_import_name(v_row->>'material')
      AND (v.steel_type_id = v_steel OR
        (v.steel_type_id IS NULL AND private.sheet_import_name(v.material_grade) = private.sheet_import_name(v_row->>'grade')))
      AND v.thickness_mm = (v_row->>'thickness')::numeric
      AND public.parse_size_dimensions(v.sheet_size) = ARRAY[(v_row->>'width')::numeric,(v_row->>'length')::numeric];
    IF v_count > 1 THEN RAISE EXCEPTION 'Найдено несколько одинаковых позиций листа'; END IF;
    IF v_variant IS NULL THEN
      INSERT INTO public.materials(name,category,created_by)
      VALUES(v_row->>'material','sheet_metal',v_actor) RETURNING id INTO v_material;
      INSERT INTO public.material_variants(material_id,category,steel_type_id,material_grade,thickness_mm,sheet_size,default_unit)
      VALUES(v_material,'sheet_metal',v_steel,v_row->>'grade',(v_row->>'thickness')::numeric,
        (v_row->>'width') || 'x' || (v_row->>'length'),'шт') RETURNING id INTO v_variant;
    END IF;
    v_inventory := public.fn_upsert_inventory_stock(
      p_material_id := v_material,p_quantity := (v_row->>'quantity')::numeric,p_unit := 'шт',p_performed_by := v_actor,
      p_secondary_quantity := NULL,p_secondary_unit := NULL,p_material_variant_id := v_variant,
      p_piece_length_mm := NULL,p_factory_id := p_factory_id,p_is_business_scrap := false);
    INSERT INTO public.inventory_transactions(factory_id,inventory_id,material_id,material_variant_id,
      transaction_type,quantity,performed_by,comment,supplier_id,sheet_import_id,sheet_import_row)
    VALUES(p_factory_id,v_inventory,v_material,v_variant,'receipt',(v_row->>'quantity')::numeric,v_actor,
      'Импорт Excel: ' || p_file_name || ', строка ' || (v_row->>'row'),NULL,p_operation_id,(v_row->>'row')::integer);
    v_logged_rows := v_logged_rows || jsonb_build_array(v_row || jsonb_build_object(
      'materialId',v_material,'steelTypeId',v_steel,'variantId',v_variant));
  END LOOP;
  UPDATE public.inventory_sheet_imports SET source_rows = v_logged_rows WHERE id = p_operation_id;
  RETURN jsonb_build_object('batchId',p_operation_id,'receiptCount',jsonb_array_length(p_rows),
    'quantity',v_preview->'quantity','weightKg',v_preview->'weightKg','replayed',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sheet_inventory_import_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.crm_has_permission('inventory','manage') THEN
    RAISE EXCEPTION 'Нет права пополнять склад' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('grades',coalesce((SELECT jsonb_agg(
    jsonb_build_object('name',name,'density',density_kg_mm3*1000000) ORDER BY name)
    FROM public.steel_types),'[]'));
END;
$$;

CREATE FUNCTION private.finish_sheet_density_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.density_kg_mm3 IS NULL THEN
    IF OLD.density_kg_mm3 IS NOT NULL THEN RAISE EXCEPTION 'Нельзя удалить уже указанную плотность марки стали'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.density_kg_mm3 <= 0 OR NEW.density_kg_mm3 > 0.00003 THEN
    RAISE EXCEPTION 'Плотность должна быть больше нуля и не превышать 30 г/см³';
  END IF;
  UPDATE public.inventory i SET total_quantity = total_quantity
  FROM public.material_variants v
  WHERE i.material_variant_id = v.id AND v.steel_type_id = NEW.id AND i.deleted_at IS NULL;
  UPDATE public.inventory_sheet_imports i SET weight_kg = (
    SELECT CASE WHEN count(*) FILTER (WHERE s.density_kg_mm3 IS NULL) > 0 THEN NULL
      ELSE sum(round((r->>'thickness')::numeric*(r->>'width')::numeric*(r->>'length')::numeric
        *s.density_kg_mm3*(r->>'quantity')::numeric,2)) END
    FROM jsonb_array_elements(i.source_rows) r
    LEFT JOIN public.steel_types s ON s.id = NULLIF(r->>'steelTypeId','')::uuid
  ) WHERE i.source_rows @> jsonb_build_array(jsonb_build_object('steelTypeId',NEW.id));
  UPDATE public.tasks SET status = 'completed',completed_at = now(),updated_at = now()
  WHERE steel_type_id = NEW.id AND task_type = 'steel_density_completion'
    AND status IN ('pending','in_progress');
  RETURN NEW;
END;
$$;
CREATE TRIGGER sheet_import_density_completed AFTER UPDATE OF density_kg_mm3 ON public.steel_types
FOR EACH ROW WHEN (NEW.density_kg_mm3 IS DISTINCT FROM OLD.density_kg_mm3)
EXECUTE FUNCTION private.finish_sheet_density_task();

CREATE FUNCTION private.guard_sheet_density_task() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.task_type = 'steel_density_completion' AND NEW.status IN ('completed','cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.steel_types s WHERE s.id = NEW.steel_type_id AND s.density_kg_mm3 IS NOT NULL) THEN
    RAISE EXCEPTION 'Задача закроется после заполнения плотности в справочнике';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_sheet_density_task BEFORE UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION private.guard_sheet_density_task();

REVOKE ALL ON FUNCTION private.finish_sheet_density_task() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.guard_sheet_density_task() FROM PUBLIC, anon, authenticated;
