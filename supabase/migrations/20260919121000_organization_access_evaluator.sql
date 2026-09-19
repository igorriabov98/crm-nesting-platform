
CREATE FUNCTION private.crm_subject_permission(p_user_id uuid, p_resource text, p_operation text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT p_operation IN ('view','manage') AND EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.is_active IS TRUE AND (
      public.crm_user_is_admin(u.id) OR EXISTS (
        SELECT 1 FROM public.department_members m JOIN public.departments d ON d.id = m.department_id
        JOIN public.department_access_permissions p ON p.department_id = m.department_id
          AND p.subject_scope = CASE WHEN m.is_department_head THEN 'head' ELSE 'member' END
        WHERE m.user_id = u.id AND d.is_active IS TRUE AND p.resource_key = p_resource
          AND CASE WHEN p_operation = 'manage' THEN p.can_manage ELSE p.can_view OR p.can_manage END
      )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.crm_has_permission(p_resource_key text, p_operation text DEFAULT 'view')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT private.crm_subject_permission(auth.uid(), p_resource_key, p_operation);
$function$;

CREATE OR REPLACE FUNCTION private.crm_has_factory_permission(p_resource_key text, p_operation text, p_factory_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT p_factory_id IS NOT NULL AND private.crm_has_permission(p_resource_key,p_operation) AND (
    public.crm_user_is_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND factory_id = p_factory_id)
    OR EXISTS (
      SELECT 1 FROM public.department_members m JOIN public.departments d ON d.id = m.department_id
      JOIN public.department_access_permissions p ON p.department_id = m.department_id
        AND p.subject_scope = CASE WHEN m.is_department_head THEN 'head' ELSE 'member' END
      WHERE m.user_id = auth.uid() AND d.is_active IS TRUE AND p.resource_key = p_resource_key
        AND p.factory_scope = 'all'
        AND CASE WHEN p_operation = 'manage' THEN p.can_manage ELSE p.can_view OR p.can_manage END
    )
  );
$function$;

CREATE OR REPLACE FUNCTION private.crm_has_company_permission(p_resource_key text, p_operation text, p_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT p_resource_key IN ('my_orders','client_identity','client_prices','contracts','invoices','client_payments')
    AND p_client_id IS NOT NULL AND private.crm_has_permission(p_resource_key,p_operation) AND (
      public.crm_user_is_admin(auth.uid())
      OR EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id AND responsible_user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.department_members m JOIN public.departments d ON d.id = m.department_id
        JOIN public.department_access_permissions p ON p.department_id = m.department_id
          AND p.subject_scope = CASE WHEN m.is_department_head THEN 'head' ELSE 'member' END
        WHERE m.user_id = auth.uid() AND d.is_active IS TRUE AND p.resource_key = p_resource_key
          AND CASE WHEN p_operation = 'manage' THEN p.can_manage AND p.company_manage_scope = 'all'
            ELSE (p.can_view OR p.can_manage) AND (p.company_view_scope = 'all' OR (p.can_manage AND p.company_manage_scope = 'all')) END
      )
    );
$function$;

CREATE FUNCTION public.crm_access_snapshot(p_user_id uuid DEFAULT auth.uid())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE profile public.users%ROWTYPE; member_rows jsonb; access_rows jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND (auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = auth.uid() AND is_active IS TRUE
  ) OR (p_user_id <> auth.uid() AND NOT private.crm_has_permission('access_settings','view')
    AND NOT private.crm_has_permission('admin_users','view'))) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO profile FROM public.users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Профиль пользователя не найден' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'departmentId',d.id,'departmentName',d.name,'positionId',m.position_id,
    'positionName',p.name,'positionLevel',p.level,'isDepartmentHead',m.is_department_head,
    'isPrimary',m.is_primary
  ) ORDER BY m.id),'[]'::jsonb) INTO member_rows
  FROM public.department_members m JOIN public.departments d ON d.id=m.department_id
  LEFT JOIN public.positions p ON p.id=m.position_id
  WHERE m.user_id=p_user_id AND d.is_active IS TRUE;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.department_id,p.subject_scope,p.resource_key),'[]'::jsonb)
  INTO access_rows FROM public.department_access_permissions p
  WHERE EXISTS(SELECT 1 FROM public.department_members m JOIN public.departments d ON d.id=m.department_id
    WHERE m.user_id=p_user_id AND m.department_id=p.department_id AND d.is_active IS TRUE);
  RETURN jsonb_build_object('userId',p_user_id,'isActive',profile.is_active IS TRUE,
    'hasAdminStatus',EXISTS(SELECT 1 FROM public.user_system_roles WHERE user_id=p_user_id),'isAdmin',public.crm_user_is_admin(p_user_id), 'fullName',profile.full_name,'email',profile.email,
    'version',(SELECT version::text FROM public.organization_revision WHERE singleton),
    'memberships',member_rows,'accessRows',access_rows);
END;
$function$;

-- Keep the old implementation private. Only the versioned delta API is callable.
ALTER FUNCTION public.fn_save_department_access_permissions(jsonb) RENAME TO crm_save_matrix_unchecked;
REVOKE ALL ON FUNCTION public.crm_save_matrix_unchecked(jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.crm_save_matrix(p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE item jsonb; current_revision bigint; saved jsonb;
BEGIN
  IF NOT private.crm_has_permission('access_settings','manage') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.organization_revision WHERE singleton FOR UPDATE;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes) > 10000 THEN
    RAISE EXCEPTION 'Некорректный пакет изменений';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    SELECT revision INTO current_revision FROM public.department_access_permissions
    WHERE department_id=(item->>'departmentId')::uuid AND subject_scope=item->>'subjectScope' AND resource_key=item->>'resourceKey'
    FOR UPDATE;
    IF item->>'expectedRevision' IS NULL OR item->>'expectedRevision' !~ '^[0-9]+$' OR coalesce(current_revision,0) <> (item->>'expectedRevision')::bigint THEN
      RAISE EXCEPTION 'Матрица изменена другим пользователем. Обновите данные и проверьте черновик.' USING ERRCODE='40001';
    END IF;
  END LOOP;
  saved := public.crm_save_matrix_unchecked(p_changes);
  RETURN (SELECT coalesce(jsonb_agg(value || jsonb_build_object('revision',p.revision::text)),'[]'::jsonb)
    FROM jsonb_array_elements(saved) JOIN public.department_access_permissions p
      ON p.department_id=(value->>'departmentId')::uuid AND p.subject_scope=value->>'subjectScope' AND p.resource_key=value->>'resourceKey');
END;
$function$;

REVOKE ALL ON FUNCTION private.crm_subject_permission(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.crm_subject_permission(uuid,text,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.crm_access_snapshot(uuid), public.crm_save_matrix(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_access_snapshot(uuid), public.crm_save_matrix(jsonb) TO authenticated, service_role;
