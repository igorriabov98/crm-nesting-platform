BEGIN;

CREATE TABLE public.inventory_sheet_imports (
  id uuid PRIMARY KEY,
  factory_id uuid NOT NULL REFERENCES public.factories(id),
  performed_by uuid NOT NULL REFERENCES public.users(id),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  fingerprint text NOT NULL,
  input_hash text NOT NULL,
  source_rows jsonb NOT NULL,
  receipt_count integer NOT NULL,
  quantity numeric NOT NULL,
  weight_kg numeric NOT NULL,
  repeated_from uuid REFERENCES public.inventory_sheet_imports(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX inventory_sheet_imports_fingerprint_idx ON public.inventory_sheet_imports(factory_id, fingerprint, created_at DESC);
ALTER TABLE public.inventory_sheet_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_sheet_imports_select ON public.inventory_sheet_imports FOR SELECT TO authenticated
  USING (private.crm_has_factory_permission('inventory', 'view', factory_id)
    OR private.crm_has_factory_permission('inventory_history', 'view', factory_id));
REVOKE ALL ON public.inventory_sheet_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.inventory_sheet_imports TO authenticated;
GRANT ALL ON public.inventory_sheet_imports TO service_role;

ALTER TABLE public.inventory_transactions
  ADD COLUMN sheet_import_id uuid REFERENCES public.inventory_sheet_imports(id),
  ADD COLUMN sheet_import_row integer,
  ADD CONSTRAINT inventory_transactions_sheet_import_row_check CHECK (
    (sheet_import_id IS NULL AND sheet_import_row IS NULL)
    OR (sheet_import_id IS NOT NULL AND sheet_import_row >= 2)
  );
CREATE UNIQUE INDEX inventory_transactions_sheet_import_row_idx
  ON public.inventory_transactions(sheet_import_id, sheet_import_row) WHERE sheet_import_id IS NOT NULL;

CREATE FUNCTION private.sheet_import_name(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT lower(btrim(regexp_replace(coalesce(p_value, ''), '\s+', ' ', 'g')));
$$;
REVOKE ALL ON FUNCTION private.sheet_import_name(text) FROM PUBLIC, anon, authenticated;

CREATE INDEX materials_sheet_import_name_idx ON public.materials(lower(btrim(regexp_replace(coalesce(name,''), '\s+', ' ', 'g')))) WHERE category = 'sheet_metal';
CREATE INDEX steel_types_sheet_import_name_idx ON public.steel_types(lower(btrim(regexp_replace(coalesce(name,''), '\s+', ' ', 'g'))));
CREATE INDEX suppliers_sheet_import_name_idx ON public.suppliers(lower(btrim(regexp_replace(coalesce(name,''), '\s+', ' ', 'g')))) WHERE is_active;
CREATE INDEX material_variants_sheet_import_match_idx ON public.material_variants(material_id,steel_type_id,thickness_mm) WHERE category = 'sheet_metal';

-- Read-only resolver shared by preview and commit. Caller authorizes the factory.
CREATE FUNCTION private.prepare_sheet_inventory_import(p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_input jsonb; v_row integer; v_count integer;
  v_material text; v_grade text; v_supplier text;
  v_thickness numeric; v_width numeric; v_length numeric; v_qty numeric; v_density numeric;
  v_material_id uuid; v_steel_id uuid; v_variant_id uuid; v_supplier_id uuid;
  v_active boolean; v_stored_density numeric; v_weight numeric;
  v_rows jsonb := '[]'; v_errors jsonb := '[]'; v_message text;
  v_seen_rows jsonb := '{}'; v_densities jsonb := '{}'; v_grade_key text;
  v_fingerprint text;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Импорт должен содержать от 1 до 2 000 строк';
  END IF;
  IF pg_column_size(p_rows) > 3000000 THEN RAISE EXCEPTION 'Слишком большой объём данных'; END IF;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_row := 0;
    BEGIN
      v_row := (v_input->>'row')::integer;
      v_material := btrim(regexp_replace(v_input->>'material', '\s+', ' ', 'g'));
      v_grade := btrim(regexp_replace(v_input->>'grade', '\s+', ' ', 'g'));
      v_supplier := nullif(btrim(regexp_replace(v_input->>'supplier', '\s+', ' ', 'g')), '');
      v_thickness := (v_input->>'thickness')::numeric;
      v_width := (v_input->>'width')::numeric;
      v_length := (v_input->>'length')::numeric;
      v_qty := (v_input->>'quantity')::numeric;
      v_density := (v_input->>'density')::numeric;
      IF v_row IS NULL OR v_row < 2 OR v_row > 1048576
        OR coalesce(length(v_material),0) NOT BETWEEN 1 AND 200
        OR coalesce(length(v_grade),0) NOT BETWEEN 1 AND 200
        OR coalesce(length(v_supplier),0) > 200 OR coalesce(length(v_input->>'comment'),0) > 1000
        OR v_thickness IS NULL OR NOT (v_thickness > 0 AND v_thickness <= 1000000)
        OR v_width IS NULL OR NOT (v_width > 0 AND v_width <= 1000000)
        OR v_length IS NULL OR NOT (v_length > 0 AND v_length <= 1000000)
        OR v_qty IS NULL OR NOT (v_qty > 0 AND v_qty <= 1000000000) OR trunc(v_qty) <> v_qty
        OR (v_density IS NOT NULL AND NOT (v_density > 0 AND v_density <= 30)) THEN
        RAISE EXCEPTION 'Некорректные названия, размеры, плотность или количество листов';
      END IF;
      IF v_seen_rows ? v_row::text THEN
        RAISE EXCEPTION 'Повтор номера строки';
      END IF;
      v_seen_rows := v_seen_rows || jsonb_build_object(v_row::text,true);

      SELECT count(*), (array_agg(id ORDER BY id))[1], bool_and(is_active)
      INTO v_count, v_material_id, v_active FROM public.materials
      WHERE category = 'sheet_metal' AND private.sheet_import_name(name) = private.sheet_import_name(v_material);
      IF v_count > 1 THEN RAISE EXCEPTION 'Несколько материалов с названием «%». Уточните справочник', v_material; END IF;
      IF v_count = 1 AND v_active IS NOT TRUE THEN RAISE EXCEPTION 'Материал «%» неактивен', v_material; END IF;
      IF v_material_id IS NULL AND NOT private.crm_has_permission('materials','manage') THEN
        RAISE EXCEPTION 'Для создания материала «%» нужно право редактирования справочника материалов', v_material USING ERRCODE = '42501';
      END IF;

      SELECT count(*), (array_agg(id ORDER BY id))[1], min(density_kg_mm3) * 1000000
      INTO v_count, v_steel_id, v_stored_density FROM public.steel_types
      WHERE private.sheet_import_name(name) = private.sheet_import_name(v_grade);
      IF v_count > 1 THEN RAISE EXCEPTION 'Несколько марок стали «%». Уточните справочник', v_grade; END IF;
      IF v_steel_id IS NOT NULL THEN
        IF v_density IS NOT NULL AND abs(v_density-v_stored_density) > 0.00000001 THEN
          RAISE EXCEPTION 'Плотность марки «%» отличается от справочника (%)', v_grade, v_stored_density;
        END IF;
        v_density := v_stored_density;
      ELSE
        IF v_density IS NULL THEN RAISE EXCEPTION 'Укажите плотность новой марки «%», г/см³', v_grade; END IF;
        IF NOT (private.crm_has_permission('materials','manage') OR private.crm_has_permission('nesting_catalog','manage')) THEN
          RAISE EXCEPTION 'Нет права создавать марки стали' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF v_density IS NULL OR NOT (v_density > 0 AND v_density <= 30) THEN RAISE EXCEPTION 'В справочнике указана некорректная плотность'; END IF;
      v_grade_key := private.sheet_import_name(v_grade);
      IF v_densities ? v_grade_key AND abs((v_densities->>v_grade_key)::numeric - v_density) > 0.00000001 THEN
        RAISE EXCEPTION 'Для марки «%» указаны разные плотности', v_grade;
      END IF;
      v_densities := v_densities || jsonb_build_object(v_grade_key,v_density);

      v_variant_id := NULL;
      IF v_material_id IS NOT NULL AND v_steel_id IS NOT NULL THEN
        SELECT count(*), (array_agg(id ORDER BY id))[1] INTO v_count, v_variant_id
        FROM public.material_variants WHERE material_id = v_material_id AND category = 'sheet_metal'
          AND steel_type_id = v_steel_id AND thickness_mm = v_thickness
          AND public.parse_size_dimensions(sheet_size) = ARRAY[v_width, v_length];
        IF v_count > 1 THEN RAISE EXCEPTION 'Найдено несколько одинаковых характеристик материала'; END IF;
      END IF;
      IF v_variant_id IS NULL AND NOT private.crm_has_permission('materials','manage') THEN
        RAISE EXCEPTION 'Для создания характеристики нужно право редактирования справочника материалов' USING ERRCODE = '42501';
      END IF;

      v_supplier_id := NULL;
      IF v_supplier IS NOT NULL THEN
        SELECT count(*), (array_agg(id ORDER BY id))[1] INTO v_count, v_supplier_id
        FROM public.suppliers WHERE is_active AND private.sheet_import_name(name) = private.sheet_import_name(v_supplier);
        IF v_count <> 1 THEN RAISE EXCEPTION 'Поставщик «%» не найден или название неоднозначно', v_supplier; END IF;
      END IF;
      v_weight := round(v_thickness * v_width * v_length * v_density / 1000000 * v_qty, 2);
      v_rows := v_rows || jsonb_build_array(v_input || jsonb_build_object(
        'material',v_material,'grade',v_grade,'supplier',v_supplier,'materialId',v_material_id,
        'steelTypeId',v_steel_id,'variantId',v_variant_id,'supplierId',v_supplier_id,'density',v_density,'weightKg',v_weight));
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('row',coalesce(v_row,0),'message',v_message));
    END;
  END LOOP;
  -- Formatting, row order, comments and splitting a position over several rows
  -- do not allow an accidental duplicate receipt to evade detection.
  SELECT encode(sha256(convert_to(coalesce(jsonb_agg(position ORDER BY position::text),'[]')::text,'UTF8')),'hex')
  INTO v_fingerprint FROM (
    SELECT jsonb_build_array(private.sheet_import_name(r->>'material'),private.sheet_import_name(r->>'grade'),
      (r->>'thickness')::numeric,(r->>'width')::numeric,(r->>'length')::numeric,
      private.sheet_import_name(r->>'supplier'),sum((r->>'quantity')::numeric)) AS position
    FROM jsonb_array_elements(v_rows) r
    GROUP BY private.sheet_import_name(r->>'material'),private.sheet_import_name(r->>'grade'),
      (r->>'thickness')::numeric,(r->>'width')::numeric,(r->>'length')::numeric,private.sheet_import_name(r->>'supplier')
  ) positions;
  RETURN jsonb_build_object('rows',v_rows,'errors',v_errors,'fingerprint',v_fingerprint,
    'previewHash',encode(sha256(convert_to(v_rows::text,'UTF8')),'hex'),
    'quantity',coalesce((SELECT sum((r->>'quantity')::numeric) FROM jsonb_array_elements(v_rows) r),0),
    'weightKg',coalesce((SELECT sum((r->>'weightKg')::numeric) FROM jsonb_array_elements(v_rows) r),0),
    'newMaterials',(SELECT count(DISTINCT private.sheet_import_name(r->>'material')) FROM jsonb_array_elements(v_rows) r WHERE r->>'materialId' IS NULL),
    'newGrades',(SELECT count(DISTINCT private.sheet_import_name(r->>'grade')) FROM jsonb_array_elements(v_rows) r WHERE r->>'steelTypeId' IS NULL),
    'newVariants',(SELECT count(DISTINCT jsonb_build_array(private.sheet_import_name(r->>'material'),private.sheet_import_name(r->>'grade'),r->'thickness',r->'width',r->'length')) FROM jsonb_array_elements(v_rows) r WHERE r->>'variantId' IS NULL));
END;
$$;
REVOKE ALL ON FUNCTION private.prepare_sheet_inventory_import(jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.fn_preview_sheet_inventory_import(p_factory_id uuid, p_rows jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_preview jsonb; v_previous jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT private.crm_has_factory_permission('inventory','manage',p_factory_id) THEN
    RAISE EXCEPTION 'Нет права пополнять склад выбранного завода' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.factories WHERE id = p_factory_id) THEN RAISE EXCEPTION 'Завод не найден'; END IF;
  v_preview := private.prepare_sheet_inventory_import(p_rows);
  SELECT jsonb_build_object('id',i.id,'createdAt',i.created_at,'fileName',i.file_name,'author',u.full_name,'quantity',i.quantity)
  INTO v_previous FROM public.inventory_sheet_imports i JOIN public.users u ON u.id = i.performed_by
  WHERE i.factory_id = p_factory_id AND i.fingerprint = v_preview->>'fingerprint'
  ORDER BY i.created_at DESC,i.id LIMIT 1;
  RETURN v_preview || jsonb_build_object('previous',v_previous);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_preview_sheet_inventory_import(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_preview_sheet_inventory_import(uuid,jsonb) TO authenticated;

CREATE FUNCTION public.fn_commit_sheet_inventory_import(
  p_factory_id uuid, p_rows jsonb, p_file_name text, p_operation_id uuid,
  p_preview_hash text, p_previous_import_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid(); v_preview jsonb; v_row jsonb;
  v_input_hash text; v_previous uuid; v_existing public.inventory_sheet_imports%rowtype;
  v_material uuid; v_steel uuid; v_variant uuid; v_inventory uuid;
BEGIN
  IF v_actor IS NULL OR NOT private.crm_has_factory_permission('inventory','manage',p_factory_id) THEN
    RAISE EXCEPTION 'Нет права пополнять склад выбранного завода' USING ERRCODE = '42501';
  END IF;
  IF p_operation_id IS NULL OR coalesce(length(p_file_name),0) NOT BETWEEN 1 AND 255 THEN RAISE EXCEPTION 'Некорректный идентификатор операции или имя файла'; END IF;
  v_input_hash := encode(sha256(convert_to(p_rows::text,'UTF8')),'hex');
  -- Imports are rare administrative receipts. Serializing their catalogue writes
  -- also prevents concurrent imports creating the same new material/variant.
  PERFORM pg_advisory_xact_lock(hashtextextended('inventory-sheet-import-v1',0));
  SELECT * INTO v_existing FROM public.inventory_sheet_imports WHERE id = p_operation_id;
  IF FOUND THEN
    IF v_existing.factory_id <> p_factory_id OR v_existing.performed_by <> v_actor OR v_existing.input_hash IS DISTINCT FROM v_input_hash THEN
      RAISE EXCEPTION 'Идентификатор операции уже использован для другого импорта';
    END IF;
    RETURN jsonb_build_object('batchId',v_existing.id,'receiptCount',v_existing.receipt_count,'quantity',v_existing.quantity,'weightKg',v_existing.weight_kg,'replayed',true);
  END IF;
  -- Hold catalogue contents stable between the second validation and stock
  -- insertion, including concurrent manual edits/creation outside this importer.
  LOCK TABLE public.materials,public.material_variants,public.steel_types,public.suppliers IN SHARE ROW EXCLUSIVE MODE;
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
    SELECT id INTO v_material FROM public.materials WHERE category = 'sheet_metal' AND is_active
      AND private.sheet_import_name(name) = private.sheet_import_name(v_row->>'material');
    IF v_material IS NULL THEN
      INSERT INTO public.materials(name,category,created_by) VALUES(v_row->>'material','sheet_metal',v_actor) RETURNING id INTO v_material;
    END IF;
    SELECT id INTO v_steel FROM public.steel_types WHERE private.sheet_import_name(name) = private.sheet_import_name(v_row->>'grade');
    IF v_steel IS NULL THEN
      INSERT INTO public.steel_types(name,density_kg_mm3) VALUES(v_row->>'grade',(v_row->>'density')::numeric/1000000) RETURNING id INTO v_steel;
    END IF;
    SELECT id INTO v_variant FROM public.material_variants WHERE category = 'sheet_metal' AND material_id = v_material
      AND steel_type_id = v_steel AND thickness_mm = (v_row->>'thickness')::numeric
      AND public.parse_size_dimensions(sheet_size) = ARRAY[(v_row->>'width')::numeric,(v_row->>'length')::numeric];
    IF v_variant IS NULL THEN
      INSERT INTO public.material_variants(material_id,category,steel_type_id,material_grade,thickness_mm,sheet_size,default_unit)
      SELECT v_material,'sheet_metal',v_steel,name,(v_row->>'thickness')::numeric,
        (v_row->>'width') || 'x' || (v_row->>'length'),'шт' FROM public.steel_types WHERE id = v_steel RETURNING id INTO v_variant;
    END IF;
    v_inventory := public.fn_upsert_inventory_stock(
      p_material_id := v_material,p_quantity := (v_row->>'quantity')::numeric,p_unit := 'шт',p_performed_by := v_actor,
      p_secondary_quantity := NULL,p_secondary_unit := NULL,p_material_variant_id := v_variant,
      p_piece_length_mm := NULL,p_factory_id := p_factory_id,p_is_business_scrap := false);
    -- Same stock upsert and receipt ledger as fn_add_inventory_receipt, with
    -- the import link supplied at insertion rather than guessing a receipt ID.
    INSERT INTO public.inventory_transactions(factory_id,inventory_id,material_id,material_variant_id,
      transaction_type,quantity,performed_by,comment,supplier_id,sheet_import_id,sheet_import_row)
    VALUES(p_factory_id,v_inventory,v_material,v_variant,'receipt',(v_row->>'quantity')::numeric,v_actor,
      'Импорт Excel: ' || p_file_name || ', строка ' || (v_row->>'row') || coalesce('. ' || nullif(v_row->>'comment',''),''),
      (v_row->>'supplierId')::uuid,p_operation_id,(v_row->>'row')::integer);
  END LOOP;
  RETURN jsonb_build_object('batchId',p_operation_id,'receiptCount',jsonb_array_length(p_rows),
    'quantity',v_preview->'quantity','weightKg',v_preview->'weightKg','replayed',false);
END;
$$;
REVOKE ALL ON FUNCTION public.fn_commit_sheet_inventory_import(uuid,jsonb,text,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_commit_sheet_inventory_import(uuid,jsonb,text,uuid,text,uuid) TO authenticated;

-- The template exposes only warehouse catalogue labels, never commercial data.
CREATE FUNCTION public.fn_sheet_inventory_import_catalog() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.crm_has_permission('inventory','manage') THEN
    RAISE EXCEPTION 'Нет права пополнять склад' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'grades',coalesce((SELECT jsonb_agg(jsonb_build_object('name',name,'density',density_kg_mm3*1000000) ORDER BY name) FROM public.steel_types),'[]'),
    'suppliers',coalesce((SELECT jsonb_agg(jsonb_build_object('name',name) ORDER BY name) FROM public.suppliers WHERE is_active),'[]'));
END;
$$;
REVOKE ALL ON FUNCTION public.fn_sheet_inventory_import_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_sheet_inventory_import_catalog() TO authenticated;

COMMIT;
