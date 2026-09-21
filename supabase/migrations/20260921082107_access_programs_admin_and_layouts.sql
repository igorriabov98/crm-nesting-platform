-- Align matrix factory scopes with the database constraint, enforce the same
-- technologist request contract in privileged RPCs, and let active CRM
-- administrators use the approval workflow without impersonating a role.

ALTER TABLE public.department_access_audit_log
  DROP CONSTRAINT department_access_audit_log_old_factory_scope_check,
  DROP CONSTRAINT department_access_audit_log_new_factory_scope_check;
ALTER TABLE public.department_access_audit_log
  ADD CONSTRAINT department_access_audit_log_old_factory_scope_check CHECK (
    old_factory_scope IS NULL OR (
      old_factory_scope IN ('own','all') AND (
        old_factory_scope = 'own' OR resource_key IN (
          'production_reports','customs_clearance','production_fact',
          'production_cutting_area','inventory'
        )
      )
    )
  ),
  ADD CONSTRAINT department_access_audit_log_new_factory_scope_check CHECK (
    new_factory_scope IN ('own','all') AND (
      new_factory_scope = 'own' OR resource_key IN (
        'production_reports','customs_clearance','production_fact',
        'production_cutting_area','inventory'
      )
    )
  );

CREATE OR REPLACE FUNCTION public.crm_save_matrix_unchecked(p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item jsonb;
  v_department_id uuid;
  v_subject_scope text;
  v_resource_key text;
  v_can_view boolean;
  v_can_manage boolean;
  v_factory_scope text;
  v_company_view_scope text;
  v_company_manage_scope text;
  v_old public.department_access_permissions%ROWTYPE;
  v_had_old boolean;
  v_result jsonb := '[]'::jsonb;
  v_factory_resources constant text[] := ARRAY[
    'production_reports','customs_clearance','production_fact',
    'production_cutting_area','inventory'
  ];
  v_company_resources constant text[] := ARRAY[
    'my_orders','client_identity','client_prices','contracts','invoices','client_payments'
  ];
BEGIN
  IF NOT private.crm_has_permission('access_settings', 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_permissions) <> 'array' THEN
    RAISE EXCEPTION 'Ожидался массив прав' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_permissions) AS item
    GROUP BY item->>'departmentId', item->>'subjectScope', item->>'resourceKey'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'В запросе есть дубли прав' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_permissions) LOOP
    v_department_id := NULLIF(v_item->>'departmentId', '')::uuid;
    v_subject_scope := v_item->>'subjectScope';
    v_resource_key := v_item->>'resourceKey';
    v_can_manage := COALESCE((v_item->>'canManage')::boolean, false);
    v_can_view := COALESCE((v_item->>'canView')::boolean, false) OR v_can_manage;

    IF COALESCE(v_item->>'factoryScope', 'own') NOT IN ('own', 'all') THEN
      RAISE EXCEPTION 'Некорректная область доступа к заводам' USING ERRCODE = '22023';
    END IF;
    IF v_item->>'factoryScope' = 'all' AND NOT (v_resource_key = ANY(v_factory_resources)) THEN
      RAISE EXCEPTION 'Область «Все заводы» недоступна для ресурса %', v_resource_key USING ERRCODE = '22023';
    END IF;
    v_factory_scope := CASE WHEN v_item->>'factoryScope' = 'all' THEN 'all' ELSE 'own' END;

    IF COALESCE(v_item->>'companyViewScope', 'own') NOT IN ('own', 'all')
       OR COALESCE(v_item->>'companyManageScope', 'own') NOT IN ('own', 'all') THEN
      RAISE EXCEPTION 'Некорректная область доступа к компаниям' USING ERRCODE = '22023';
    END IF;
    IF (v_item->>'companyViewScope' = 'all' OR v_item->>'companyManageScope' = 'all')
       AND NOT (v_resource_key = ANY(v_company_resources)) THEN
      RAISE EXCEPTION 'Область «Все компании» недоступна для ресурса %', v_resource_key USING ERRCODE = '22023';
    END IF;
    v_company_view_scope := CASE WHEN v_item->>'companyViewScope' = 'all' THEN 'all' ELSE 'own' END;
    v_company_manage_scope := CASE WHEN v_item->>'companyManageScope' = 'all' THEN 'all' ELSE 'own' END;
    IF v_company_manage_scope = 'all' THEN v_company_view_scope := 'all'; END IF;

    IF v_subject_scope NOT IN ('head', 'member')
       OR NOT EXISTS (SELECT 1 FROM public.departments WHERE id = v_department_id)
       OR NOT EXISTS (SELECT 1 FROM public.department_access_permissions WHERE resource_key = v_resource_key) THEN
      RAISE EXCEPTION 'Некорректная строка матрицы доступа' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_old
    FROM public.department_access_permissions
    WHERE department_id = v_department_id
      AND subject_scope = v_subject_scope
      AND resource_key = v_resource_key
    FOR UPDATE;
    v_had_old := FOUND;

    INSERT INTO public.department_access_permissions (
      department_id, subject_scope, resource_key, can_view, can_manage,
      factory_scope, company_view_scope, company_manage_scope, updated_by
    ) VALUES (
      v_department_id, v_subject_scope, v_resource_key, v_can_view, v_can_manage,
      v_factory_scope, v_company_view_scope, v_company_manage_scope, auth.uid()
    )
    ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE SET
      can_view = EXCLUDED.can_view,
      can_manage = EXCLUDED.can_manage,
      factory_scope = EXCLUDED.factory_scope,
      company_view_scope = EXCLUDED.company_view_scope,
      company_manage_scope = EXCLUDED.company_manage_scope,
      updated_by = EXCLUDED.updated_by;

    IF NOT v_had_old
       OR v_old.can_view IS DISTINCT FROM v_can_view
       OR v_old.can_manage IS DISTINCT FROM v_can_manage
       OR v_old.factory_scope IS DISTINCT FROM v_factory_scope
       OR v_old.company_view_scope IS DISTINCT FROM v_company_view_scope
       OR v_old.company_manage_scope IS DISTINCT FROM v_company_manage_scope THEN
      INSERT INTO public.department_access_audit_log (
        department_id, subject_scope, resource_key,
        old_can_view, old_can_manage, new_can_view, new_can_manage,
        old_factory_scope, new_factory_scope,
        old_company_view_scope, new_company_view_scope,
        old_company_manage_scope, new_company_manage_scope, changed_by
      ) VALUES (
        v_department_id, v_subject_scope, v_resource_key,
        CASE WHEN v_had_old THEN v_old.can_view ELSE false END,
        CASE WHEN v_had_old THEN v_old.can_manage ELSE false END,
        v_can_view, v_can_manage,
        CASE WHEN v_had_old THEN v_old.factory_scope ELSE 'own' END, v_factory_scope,
        CASE WHEN v_had_old THEN v_old.company_view_scope ELSE 'own' END, v_company_view_scope,
        CASE WHEN v_had_old THEN v_old.company_manage_scope ELSE 'own' END, v_company_manage_scope,
        auth.uid()
      );
    END IF;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'departmentId', v_department_id,
      'subjectScope', v_subject_scope,
      'resourceKey', v_resource_key,
      'canView', v_can_view,
      'canManage', v_can_manage,
      'factoryScope', v_factory_scope,
      'companyViewScope', v_company_view_scope,
      'companyManageScope', v_company_manage_scope
    ));
  END LOOP;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_save_matrix_unchecked(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.crm_can_work_technologist_request(
  p_request_id uuid,
  p_actor uuid,
  p_inventory_operation text DEFAULT 'manage'
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_actor IS NOT NULL
    AND p_actor = auth.uid()
    AND p_inventory_operation IN ('view','manage')
    AND EXISTS (
      SELECT 1
      FROM public.technologist_requests request
      JOIN public.machines machine ON machine.id = request.machine_id
      JOIN public.users app_user ON app_user.id = p_actor
      WHERE request.id = p_request_id
        AND app_user.is_active IS TRUE
        AND app_user.archived_at IS NULL
        AND machine.is_archived IS NOT TRUE
        AND (
          public.crm_user_is_admin(p_actor)
          OR (
            private.crm_has_permission('technologist_requests', 'manage')
            AND private.crm_has_factory_permission('inventory', p_inventory_operation, machine.factory_id)
            AND (
              request.created_by = p_actor
              OR EXISTS (
                SELECT 1
                FROM public.tasks task
                JOIN public.technologist_request_approval_versions version
                  ON version.id = task.technologist_request_approval_id
                WHERE version.request_id = request.id
                  AND task.task_type = 'technologist_request_revision'
                  AND task.assigned_to = p_actor
                  AND task.status IN ('pending','in_progress')
              )
            )
          )
        )
    );
$function$;

REVOKE ALL ON FUNCTION private.crm_can_work_technologist_request(uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.crm_can_work_technologist_request(uuid,uuid,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_complete_business_scrap_stage_v1(
  p_request_id uuid,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_request public.technologist_requests%ROWTYPE;
  v_detailing_check jsonb;
  v_is_revision boolean;
BEGIN
  IF NOT private.crm_can_work_technologist_request(p_request_id, p_actor, 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для заявки или выбранного завода' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_request
  FROM public.technologist_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF v_request.id IS NULL THEN RAISE EXCEPTION 'Заявка технолога не найдена'; END IF;
  IF v_request.status <> 'pending_stock_check' THEN
    RAISE EXCEPTION 'Этап делового остатка уже завершён или ещё не открыт';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.supply_position_revisions revision
    WHERE revision.replacement_request_id = p_request_id
  ) INTO v_is_revision;

  IF NOT v_is_revision THEN
    v_detailing_check := public.fn_validate_detailing_request_check(p_request_id, p_actor);
    IF NOT COALESCE((v_detailing_check->>'ready')::boolean, false) THEN
      RAISE EXCEPTION '%', COALESCE(
        v_detailing_check->>'message',
        'Проверьте подходящую деталировку перед переходом к основному складу'
      );
    END IF;
  END IF;

  UPDATE public.technologist_requests
  SET status = 'stock_checked', updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'request_id', p_request_id,
    'status', 'stock_checked',
    'is_revision', v_is_revision
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_complete_business_scrap_stage_v1(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_complete_business_scrap_stage_v1(uuid,uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_submit_technologist_request_for_approval(
  p_request_id uuid,
  p_actor uuid,
  p_completion_payload jsonb,
  p_summary_snapshot jsonb,
  p_archives jsonb DEFAULT '[]'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.technologist_requests%ROWTYPE;
  v_machine_name text;
  v_version_id uuid;
  v_pending_version public.technologist_request_approval_versions%ROWTYPE;
  v_revision integer;
  v_request_number integer;
  v_recipients uuid[];
  v_recipient uuid;
  v_archive jsonb;
  v_storage storage.objects%ROWTYPE;
  v_path_prefix text;
  v_has_sheet_metal boolean;
  v_input_archives jsonb;
  v_saved_archives jsonb;
BEGIN
  IF NOT private.crm_can_work_technologist_request(p_request_id, p_actor, 'manage') THEN
    RAISE EXCEPTION 'Недостаточно прав для заявки или выбранного завода' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_completion_payload) <> 'object' OR jsonb_typeof(p_summary_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Некорректный снимок заявки';
  END IF;
  IF jsonb_typeof(COALESCE(p_archives, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_archives, '[]'::jsonb)) > 20 THEN
    RAISE EXCEPTION 'Можно прикрепить не более 20 архивов';
  END IF;
  IF COALESCE(p_completion_payload->'archives', '[]'::jsonb)
     IS DISTINCT FROM COALESCE(p_archives, '[]'::jsonb) THEN
    RAISE EXCEPTION 'Список программ порезки не совпадает со снимком заявки';
  END IF;

  SELECT request.* INTO v_request
  FROM public.technologist_requests request
  WHERE request.id = p_request_id
  FOR UPDATE OF request;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка недоступна'; END IF;

  SELECT machine.name INTO v_machine_name
  FROM public.machines machine
  WHERE machine.id = v_request.machine_id AND NOT machine.is_archived;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ находится в архиве'; END IF;

  IF p_summary_snapshot->'sourceData' IS DISTINCT FROM public.fn_technologist_approval_source(p_request_id) THEN
    RAISE EXCEPTION 'Данные заявки изменились. Обновите итоговый мастер';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.technologist_request_completions completion
    WHERE completion.request_id = p_request_id
  ) THEN
    RAISE EXCEPTION 'Производственные последствия уже зафиксированы';
  END IF;

  SELECT * INTO v_pending_version
  FROM public.technologist_request_approval_versions version
  WHERE version.request_id = p_request_id AND version.state = 'pending'
  ORDER BY version.revision_number DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'requestId', p_request_id,
      'completionId', NULL,
      'objectPath', archive.object_path,
      'fileName', archive.file_name,
      'mimeType', archive.mime_type,
      'fileSize', archive.file_size
    ) ORDER BY archive.object_path), '[]'::jsonb)
    INTO v_saved_archives
    FROM public.technologist_request_approval_archives archive
    WHERE archive.approval_version_id = v_pending_version.id;
    SELECT COALESCE(jsonb_agg(value ORDER BY value->>'objectPath'), '[]'::jsonb)
    INTO v_input_archives
    FROM jsonb_array_elements(COALESCE(p_archives, '[]'::jsonb));
    IF v_pending_version.completion_payload = p_completion_payload
       AND v_pending_version.summary_snapshot = p_summary_snapshot
       AND v_saved_archives = v_input_archives THEN
      RETURN v_pending_version.id;
    END IF;
    RAISE EXCEPTION 'Заявка уже ожидает согласования с другими данными' USING ERRCODE = '40001';
  END IF;

  IF v_request.status <> 'stock_checked' THEN RAISE EXCEPTION 'Заявка не готова к согласованию'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.request_sheet_metal sheet WHERE sheet.request_id = p_request_id
  ) INTO v_has_sheet_metal;
  IF v_has_sheet_metal AND jsonb_array_length(COALESCE(p_archives, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Для заявки с листовым металлом загрузите программу порезки';
  END IF;
  IF NOT v_has_sheet_metal AND jsonb_array_length(COALESCE(p_archives, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'Программа порезки доступна только для заявки с листовым металлом';
  END IF;

  v_path_prefix := 'machine-cutting/' || v_request.machine_id || '/' || p_request_id || '/';
  FOR v_archive IN SELECT * FROM jsonb_array_elements(COALESCE(p_archives, '[]'::jsonb)) LOOP
    IF v_archive->>'requestId' IS DISTINCT FROM p_request_id::text
       OR NULLIF(v_archive->>'completionId', '') IS NOT NULL
       OR btrim(COALESCE(v_archive->>'fileName', '')) = ''
       OR (v_archive->>'fileSize')::bigint <= 0
       OR (v_archive->>'fileSize')::bigint > 524288000
       OR lower(v_archive->>'fileName') !~ '\.(zip|rar|7z)$'
       OR v_archive->>'objectPath' NOT LIKE v_path_prefix || '%'
       OR v_archive->>'objectPath' LIKE '%..%'
       OR lower(v_archive->>'objectPath') !~ '/[0-9]+-[0-9a-f-]{36}\.(zip|rar|7z)$' THEN
      RAISE EXCEPTION 'Некорректный архив порезки';
    END IF;
    SELECT * INTO v_storage
    FROM storage.objects
    WHERE bucket_id = 'nesting-files' AND name = v_archive->>'objectPath';
    IF NOT FOUND OR COALESCE((v_storage.metadata->>'size')::bigint, -1) <> (v_archive->>'fileSize')::bigint THEN
      RAISE EXCEPTION 'Загруженный архив не найден или его размер не совпадает';
    END IF;
  END LOOP;

  v_recipients := ARRAY[public.fn_technologist_approval_department_head('Финансовый отдел')];
  IF v_recipients[1] IS NULL THEN
    RAISE EXCEPTION 'Не назначен действующий начальник Финансового отдела';
  END IF;

  SELECT COALESCE(max(version.revision_number), -1) + 1 INTO v_revision
  FROM public.technologist_request_approval_versions version
  WHERE version.request_id = p_request_id;
  SELECT count(*) INTO v_request_number
  FROM public.technologist_requests numbered
  WHERE numbered.machine_id = v_request.machine_id
    AND (numbered.created_at, numbered.id) <= (v_request.created_at, v_request.id);

  INSERT INTO public.technologist_request_approval_versions(
    request_id, revision_number, state, completion_payload, summary_snapshot, submitted_by
  ) VALUES (
    p_request_id, v_revision, 'pending', p_completion_payload, p_summary_snapshot, p_actor
  ) RETURNING id INTO v_version_id;

  FOR v_archive IN SELECT * FROM jsonb_array_elements(COALESCE(p_archives, '[]'::jsonb)) LOOP
    INSERT INTO public.technologist_request_approval_archives(
      approval_version_id, object_path, file_name, mime_type, file_size
    ) VALUES (
      v_version_id, v_archive->>'objectPath', btrim(v_archive->>'fileName'),
      NULLIF(v_archive->>'mimeType', ''), (v_archive->>'fileSize')::bigint
    );
  END LOOP;

  FOREACH v_recipient IN ARRAY v_recipients LOOP
    INSERT INTO public.tasks(
      machine_id, assigned_to, task_type, title, description, status,
      start_date, deadline, technologist_request_approval_id, technologist_request_approval_machine_id
    ) VALUES (
      NULL, v_recipient, 'technologist_request_approval',
      'Проверить и одобрить заявку',
      'Заявка №' || v_request_number || ' для заказа «' || COALESCE(v_machine_name, 'Без названия') || '»',
      'pending', (now() AT TIME ZONE 'Europe/Kyiv')::date,
      (now() AT TIME ZONE 'Europe/Kyiv')::date, v_version_id, v_request.machine_id
    );
  END LOOP;

  PERFORM public.fn_technologist_approval_work_item(
    v_version_id, 'technologist_approval', p_actor, v_recipients[1],
    'Проверьте заявку №' || v_request_number || ' для заказа «' || COALESCE(v_machine_name, 'Без названия') || '» сегодня.'
  );
  UPDATE public.department_requests request
  SET status = 'done', completed_by = p_actor, completed_at = now()
  WHERE request.request_kind = 'technologist_revision'
    AND request.status IN ('new', 'in_progress')
    AND request.technologist_approval_version_id IN (
      SELECT id FROM public.technologist_request_approval_versions WHERE request_id = p_request_id
    );
  UPDATE public.tasks
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE task_type = 'technologist_request_revision'
    AND status IN ('pending', 'in_progress')
    AND technologist_request_approval_id IN (
      SELECT id FROM public.technologist_request_approval_versions WHERE request_id = p_request_id
    );
  DELETE FROM public.technologist_request_revision_drafts WHERE request_id = p_request_id;
  PERFORM set_config('app.financial_approval_request', p_request_id::text, true);
  UPDATE public.technologist_requests
  SET status = 'pending_financial_approval', submitted_at = NULL, updated_at = now()
  WHERE id = p_request_id;
  PERFORM set_config('app.financial_approval_request', '', true);
  RETURN v_version_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_submit_technologist_request_for_approval(uuid,uuid,jsonb,jsonb,jsonb)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_begin_technologist_request_revision(
  p_request_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.technologist_requests%ROWTYPE;
  v_version uuid;
  v_original uuid;
  v_original_active boolean;
  v_next integer;
  v_source jsonb;
  v_created integer;
  v_is_admin boolean;
BEGIN
  IF p_actor IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (
       SELECT 1 FROM public.users
       WHERE id = p_actor AND is_active IS TRUE AND archived_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  v_is_admin := public.crm_user_is_admin(p_actor);

  SELECT * INTO v_request
  FROM public.technologist_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка недоступна'; END IF;

  SELECT submitted_by INTO v_original
  FROM public.technologist_request_approval_versions
  WHERE request_id = p_request_id AND revision_number = 0;
  SELECT COALESCE(is_active, false) INTO v_original_active
  FROM public.users WHERE id = v_original;

  IF NOT v_is_admin
     AND p_actor IS DISTINCT FROM v_original
     AND p_actor IS DISTINCT FROM v_request.created_by
     AND NOT (
       NOT COALESCE(v_original_active, false)
       AND EXISTS (
         SELECT 1
         FROM public.tasks task
         JOIN public.technologist_request_approval_versions version
           ON version.id = task.technologist_request_approval_id
         WHERE version.request_id = p_request_id
           AND task.task_type = 'technologist_request_revision'
           AND task.assigned_to = p_actor
           AND task.status IN ('pending', 'in_progress')
       )
     ) THEN
    RAISE EXCEPTION 'Редактирование доступно только ответственному технологу';
  END IF;
  IF v_request.status NOT IN ('pending_financial_approval', 'pending_stock_check', 'stock_checked') THEN
    RAISE EXCEPTION 'Редактирование на этом этапе недоступно';
  END IF;

  IF v_request.status = 'pending_financial_approval' THEN
    SELECT id INTO v_version
    FROM public.technologist_request_approval_versions
    WHERE request_id = p_request_id AND state = 'pending'
    FOR UPDATE;
    IF v_version IS NULL THEN RAISE EXCEPTION 'Актуальная версия не найдена'; END IF;
    UPDATE public.technologist_request_approval_versions
    SET state = 'superseded', updated_at = now()
    WHERE id = v_version;
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = now(), updated_at = now()
    WHERE technologist_request_approval_id = v_version
      AND task_type = 'technologist_request_approval'
      AND status IN ('pending', 'in_progress');
    UPDATE public.department_requests
    SET status = 'cancelled', completed_at = now()
    WHERE technologist_approval_version_id = v_version
      AND request_kind = 'technologist_approval'
      AND status IN ('new', 'in_progress');
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.technologist_request_approval_versions
    WHERE request_id = p_request_id AND state IN ('returned', 'superseded')
  ) THEN
    RAISE EXCEPTION 'Версия для редактирования не найдена';
  END IF;

  IF NOT COALESCE(v_original_active, false) AND v_request.created_by <> p_actor AND NOT v_is_admin THEN
    UPDATE public.technologist_requests SET created_by = p_actor WHERE id = p_request_id;
  END IF;
  SELECT COALESCE(max(revision_number), -1) + 1 INTO v_next
  FROM public.technologist_request_approval_versions WHERE request_id = p_request_id;
  INSERT INTO public.technologist_request_revision_drafts(request_id, revision_number, editor_id)
  VALUES (p_request_id, v_next, p_actor)
  ON CONFLICT (request_id) DO NOTHING;
  GET DIAGNOSTICS v_created = ROW_COUNT;
  PERFORM set_config('app.financial_approval_request', p_request_id::text, true);
  UPDATE public.technologist_requests
  SET status = 'pending_stock_check', submitted_at = NULL, updated_at = now()
  WHERE id = p_request_id;
  PERFORM set_config('app.financial_approval_request', '', true);
  IF v_created > 0 THEN
    SELECT version.summary_snapshot->'sourceData' INTO v_source
    FROM public.technologist_request_approval_versions version
    WHERE version.request_id = p_request_id
    ORDER BY version.revision_number DESC LIMIT 1;
    PERFORM public.fn_restore_technologist_revision_positions(p_request_id, v_source);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_begin_technologist_request_revision(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_begin_technologist_request_revision(uuid,uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_return_technologist_request_for_revision(
  p_approval_version_id uuid,
  p_actor uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.technologist_request_approval_versions%ROWTYPE;
  v_request public.technologist_requests%ROWTYPE;
  v_assignee uuid;
  v_original uuid;
BEGIN
  IF p_actor IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (
       SELECT 1 FROM public.users
       WHERE id = p_actor AND is_active IS TRUE AND archived_at IS NULL
     )
     OR (
       NOT public.crm_user_is_admin(p_actor)
       AND p_actor IS DISTINCT FROM public.fn_technologist_approval_department_head('Финансовый отдел')
     ) THEN
    RAISE EXCEPTION 'Согласование доступно начальнику Финансового отдела или администратору CRM'
      USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Укажите причину возврата';
  END IF;

  SELECT request.* INTO v_request
  FROM public.technologist_requests request
  JOIN public.technologist_request_approval_versions version ON version.request_id = request.id
  WHERE version.id = p_approval_version_id
  FOR UPDATE OF request;
  SELECT * INTO v_version
  FROM public.technologist_request_approval_versions
  WHERE id = p_approval_version_id
  FOR UPDATE;
  IF NOT FOUND OR v_version.state <> 'pending' THEN RAISE EXCEPTION 'Решение по версии уже принято'; END IF;
  IF v_request.status <> 'pending_financial_approval' THEN
    RAISE EXCEPTION 'Заявка больше не ожидает согласования';
  END IF;

  UPDATE public.technologist_request_approval_versions
  SET state = 'returned', return_reason = btrim(p_reason), decided_by = p_actor,
      decided_at = now(), updated_at = now()
  WHERE id = v_version.id;
  UPDATE public.tasks
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE technologist_request_approval_id = v_version.id
    AND status IN ('pending', 'in_progress');
  PERFORM set_config('app.financial_approval_request', v_request.id::text, true);
  UPDATE public.technologist_requests
  SET status = 'pending_stock_check', submitted_at = NULL, updated_at = now()
  WHERE id = v_request.id;
  PERFORM set_config('app.financial_approval_request', '', true);
  UPDATE public.department_requests
  SET status = 'rejected', completed_by = p_actor, completed_at = now(), response = btrim(p_reason)
  WHERE technologist_approval_version_id = v_version.id
    AND request_kind = 'technologist_approval'
    AND status IN ('new', 'in_progress');

  SELECT version.submitted_by INTO v_original
  FROM public.technologist_request_approval_versions version
  WHERE version.request_id = v_request.id AND version.revision_number = 0;
  SELECT id INTO v_assignee FROM public.users WHERE id = v_original AND is_active;
  IF v_assignee IS NULL THEN
    v_assignee := public.fn_technologist_approval_department_head('Технический отдел');
    IF v_assignee IS NULL THEN
      RAISE EXCEPTION 'Не назначен действующий начальник Технического отдела';
    END IF;
  END IF;
  PERFORM public.fn_technologist_approval_work_item(
    v_version.id, 'technologist_revision', p_actor,
    CASE WHEN v_assignee = v_original THEN v_assignee ELSE NULL END,
    'Заявка возвращена на доработку. Причина: ' || btrim(p_reason)
  );
  INSERT INTO public.tasks(
    machine_id, assigned_to, task_type, title, description,
    status, start_date, deadline, technologist_request_approval_id,
    technologist_request_approval_machine_id
  ) VALUES (
    NULL, v_assignee, 'technologist_request_revision', 'Доработать заявку',
    btrim(p_reason), 'pending', (now() AT TIME ZONE 'Europe/Kyiv')::date,
    (now() AT TIME ZONE 'Europe/Kyiv')::date, v_version.id, v_request.machine_id
  );
  IF v_assignee IS DISTINCT FROM v_original THEN
    INSERT INTO public.notifications(
      user_id, type, title, message, related_machine_id, related_department_request_id
    )
    SELECT v_assignee, 'department_request_new_technologist_revision',
      'Заявка возвращена на доработку', btrim(p_reason), v_request.machine_id, request.id
    FROM public.department_requests request
    WHERE request.technologist_approval_version_id = v_version.id
      AND request.request_kind = 'technologist_revision';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_return_technologist_request_for_revision(uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_return_technologist_request_for_revision(uuid,uuid,text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_approve_technologist_request(
  p_approval_version_id uuid,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_version public.technologist_request_approval_versions%ROWTYPE;
  v_request public.technologist_requests%ROWTYPE;
  v_completion uuid;
  v_original_sub text;
  v_original_claims text;
BEGIN
  IF p_actor IS DISTINCT FROM auth.uid()
     OR NOT EXISTS (
       SELECT 1 FROM public.users
       WHERE id = p_actor AND is_active IS TRUE AND archived_at IS NULL
     )
     OR (
       NOT public.crm_user_is_admin(p_actor)
       AND p_actor IS DISTINCT FROM public.fn_technologist_approval_department_head('Финансовый отдел')
     ) THEN
    RAISE EXCEPTION 'Согласование доступно начальнику Финансового отдела или администратору CRM'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.machines machine
  JOIN public.technologist_requests request ON request.machine_id = machine.id
  JOIN public.technologist_request_approval_versions version ON version.request_id = request.id
  WHERE version.id = p_approval_version_id
  FOR UPDATE OF machine;
  SELECT request.* INTO v_request
  FROM public.technologist_requests request
  JOIN public.technologist_request_approval_versions version ON version.request_id = request.id
  WHERE version.id = p_approval_version_id
  FOR UPDATE OF request;
  SELECT * INTO v_version
  FROM public.technologist_request_approval_versions
  WHERE id = p_approval_version_id
  FOR UPDATE;
  IF NOT FOUND OR v_version.state <> 'pending' THEN RAISE EXCEPTION 'Решение по версии уже принято'; END IF;
  IF v_request.status <> 'pending_financial_approval' THEN
    RAISE EXCEPTION 'Заявка больше не ожидает согласования';
  END IF;
  IF EXISTS (SELECT 1 FROM public.machines WHERE id = v_request.machine_id AND is_archived) THEN
    RAISE EXCEPTION 'Заказ находится в архиве';
  END IF;
  IF v_version.summary_snapshot->'sourceData'
     IS DISTINCT FROM public.fn_technologist_approval_source(v_request.id) THEN
    RAISE EXCEPTION 'Данные заявки изменились. Верните заявку на доработку';
  END IF;

  -- The existing finalizer is bound to the request owner. Preserve its
  -- validations and side effects, while the decision remains attributed to
  -- the real reviewer in decided_by and all work-item records.
  PERFORM set_config('app.financial_approval_request', v_request.id::text, true);
  UPDATE public.technologist_requests
  SET status = 'stock_checked', updated_at = now()
  WHERE id = v_request.id;
  v_original_sub := current_setting('request.jwt.claim.sub', true);
  v_original_claims := current_setting('request.jwt.claims', true);
  PERFORM set_config('request.jwt.claim.sub', v_request.created_by::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_set(
      COALESCE(NULLIF(v_original_claims, '')::jsonb, '{}'::jsonb),
      '{sub}', to_jsonb(v_request.created_by::text), true
    )::text,
    true
  );
  v_completion := public.fn_finalize_technologist_request_with_archives(
    v_request.id,
    v_request.created_by,
    v_version.completion_payload->>'decision',
    COALESCE((v_version.completion_payload->>'enteredPlasmaMinutes')::integer, 0),
    COALESCE(v_version.completion_payload->'wasteItems', '[]'::jsonb),
    COALESCE(v_version.completion_payload->'futureItems', '[]'::jsonb),
    COALESCE(v_version.completion_payload->'archives', '[]'::jsonb)
  );
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_original_sub, p_actor::text), true);
  PERFORM set_config(
    'request.jwt.claims',
    COALESCE(NULLIF(v_original_claims, ''), jsonb_build_object('sub', p_actor::text)::text),
    true
  );
  IF EXISTS (
    SELECT 1 FROM public.supply_position_revisions
    WHERE replacement_request_id = v_request.id
  ) THEN
    PERFORM public.fn_submit_supply_position_revision_v1(v_request.id, v_request.created_by);
  END IF;
  PERFORM set_config('app.financial_approval_request', '', true);

  UPDATE public.technologist_request_approval_versions
  SET state = 'approved', decided_by = p_actor, decided_at = now(), updated_at = now()
  WHERE id = v_version.id;
  UPDATE public.tasks
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE technologist_request_approval_id = v_version.id
    AND status IN ('pending', 'in_progress');
  UPDATE public.department_requests
  SET status = 'done', completed_by = p_actor, completed_at = now(), response = 'Заявка одобрена'
  WHERE technologist_approval_version_id = v_version.id
    AND request_kind = 'technologist_approval'
    AND status IN ('new', 'in_progress');
  INSERT INTO public.notifications(user_id, type, title, message, related_machine_id)
  SELECT app_user.id, 'technologist_request', 'Заявка одобрена и готова для снабжения',
    'Итоговая версия заявки одобрена финансовым руководителем или администратором CRM.',
    v_request.machine_id
  FROM public.users app_user
  WHERE app_user.is_active AND app_user.role IN ('supply_manager','procurement_head');
  RETURN v_completion;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_approve_technologist_request(uuid,uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_approve_technologist_request(uuid,uuid)
  TO authenticated, service_role;
