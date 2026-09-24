-- The production department name has a trailing space. Match its display name
-- after trimming so the already-applied access migration reaches that row.
DO $$
DECLARE
  v_department_id uuid;
  v_department_count integer;
  v_resource text;
  v_old public.department_access_permissions%ROWTYPE;
  v_new_manage boolean;
BEGIN
  SELECT count(*), (array_agg(id))[1] INTO v_department_count, v_department_id
  FROM public.departments
  WHERE btrim(name) = 'Отдел продаж';
  IF v_department_count = 0 THEN
    RAISE NOTICE 'Отдел продаж отсутствует; настройка прав будет пропущена';
    RETURN;
  END IF;
  IF v_department_count <> 1 THEN
    RAISE EXCEPTION 'Ожидался ровно один Отдел продаж, найдено: %', v_department_count;
  END IF;

  FOREACH v_resource IN ARRAY ARRAY['client_identity', 'client_prices'] LOOP
    v_new_manage := v_resource = 'client_prices';
    SELECT * INTO v_old
    FROM public.department_access_permissions
    WHERE department_id = v_department_id
      AND subject_scope = 'member'
      AND resource_key = v_resource;

    INSERT INTO public.department_access_permissions (
      department_id, subject_scope, resource_key, can_view, can_manage,
      company_view_scope, company_manage_scope
    ) VALUES (
      v_department_id, 'member', v_resource, true, v_new_manage, 'own', 'own'
    )
    ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE SET
      can_view = true,
      can_manage = EXCLUDED.can_manage,
      company_view_scope = 'own',
      company_manage_scope = 'own',
      updated_by = null;

    IF v_old.id IS NULL OR v_old.can_view IS DISTINCT FROM true
       OR v_old.can_manage IS DISTINCT FROM v_new_manage
       OR v_old.company_view_scope IS DISTINCT FROM 'own'
       OR v_old.company_manage_scope IS DISTINCT FROM 'own' THEN
      INSERT INTO public.department_access_audit_log (
        department_id, subject_scope, resource_key,
        old_can_view, old_can_manage, new_can_view, new_can_manage,
        old_factory_scope, new_factory_scope,
        old_company_view_scope, new_company_view_scope,
        old_company_manage_scope, new_company_manage_scope
      ) VALUES (
        v_department_id, 'member', v_resource,
        coalesce(v_old.can_view, false), coalesce(v_old.can_manage, false), true, v_new_manage,
        coalesce(v_old.factory_scope, 'own'), coalesce(v_old.factory_scope, 'own'),
        coalesce(v_old.company_view_scope, 'own'), 'own',
        coalesce(v_old.company_manage_scope, 'own'), 'own'
      );
    END IF;
  END LOOP;
END;
$$;
