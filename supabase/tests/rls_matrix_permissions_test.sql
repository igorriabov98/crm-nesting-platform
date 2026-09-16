\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory uuid;
  v_other_factory uuid;
  v_head uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_multi uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_inactive uuid := gen_random_uuid();
  v_no_department uuid := gen_random_uuid();
  v_head_department uuid := gen_random_uuid();
  v_member_department uuid := gen_random_uuid();
  v_second_department uuid := gen_random_uuid();
  v_admin_department uuid := gen_random_uuid();
  v_admin_position uuid;
  v_audit_before integer;
  v_audit_after integer;
  v_saved jsonb;
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY name LIMIT 1;
  SELECT id INTO v_other_factory FROM public.factories WHERE id <> v_factory ORDER BY name LIMIT 1;
  IF v_factory IS NULL OR v_other_factory IS NULL THEN
    RAISE EXCEPTION 'RLS matrix test requires two factories';
  END IF;

  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
  VALUES
    (v_head, v_head || '@rls.test', 'RLS head', 'sales_manager', v_factory, true),
    (v_member, v_member || '@rls.test', 'RLS member', 'sales_manager', v_factory, true),
    (v_multi, v_multi || '@rls.test', 'RLS multi', 'sales_manager', v_factory, true),
    (v_admin, v_admin || '@rls.test', 'RLS admin', 'sales_manager', v_factory, true),
    (v_inactive, v_inactive || '@rls.test', 'RLS inactive', 'sales_manager', v_factory, false),
    (v_no_department, v_no_department || '@rls.test', 'RLS no department', 'planning_director', v_factory, true);

  SELECT id INTO v_admin_position
  FROM public.positions
  WHERE name = 'Администратор CRM';
  IF v_admin_position IS NULL THEN
    v_admin_position := gen_random_uuid();
    INSERT INTO public.positions(id, name, is_active, created_by)
    VALUES (v_admin_position, 'Администратор CRM', true, v_head);
  END IF;

  INSERT INTO public.departments(id, name, head_user_id, factory_id, is_active, created_by)
  VALUES
    (v_head_department, 'RLS head department ' || v_head, v_head, v_factory, true, v_head),
    (v_member_department, 'RLS member department ' || v_member, NULL, v_factory, true, v_head),
    (v_second_department, 'RLS second department ' || v_multi, NULL, v_factory, true, v_head),
    (v_admin_department, 'RLS admin department ' || v_admin, NULL, v_factory, true, v_head);

  INSERT INTO public.department_members(
    user_id, department_id, position_id, is_department_head, created_by
  ) VALUES
    (v_head, v_head_department, NULL, true, v_head),
    (v_member, v_member_department, NULL, false, v_head),
    (v_multi, v_member_department, NULL, false, v_head),
    (v_multi, v_second_department, NULL, false, v_head),
    (v_admin, v_admin_department, v_admin_position, false, v_head),
    (v_inactive, v_member_department, NULL, false, v_head);

  INSERT INTO public.department_access_permissions(
    department_id, subject_scope, resource_key, can_view, can_manage,
    factory_scope, company_view_scope, company_manage_scope, updated_by
  ) VALUES
    (v_head_department, 'head', 'dashboard', true, false, 'own', 'own', 'own', v_head),
    (v_head_department, 'head', 'production_reports', true, false, 'all', 'own', 'own', v_head),
    (v_head_department, 'head', 'inventory', true, false, 'own', 'own', 'own', v_head),
    (v_head_department, 'head', 'client_prices', true, false, 'own', 'all', 'own', v_head),
    (v_member_department, 'member', 'materials', true, true, 'own', 'own', 'own', v_head),
    (v_second_department, 'member', 'inventory_history', true, false, 'own', 'own', 'own', v_head);

  PERFORM set_config('request.jwt.claim.sub', v_head::text, true);
  IF NOT private.crm_has_permission('dashboard', 'view')
     OR private.crm_has_permission('dashboard', 'manage') THEN
    RAISE EXCEPTION 'Head view/manage matrix resolution failed';
  END IF;
  IF NOT private.crm_has_factory_permission('production_reports', 'view', v_other_factory)
     OR private.crm_has_factory_permission('inventory', 'view', v_other_factory)
     OR NOT private.crm_has_factory_permission('inventory', 'view', v_factory) THEN
    RAISE EXCEPTION 'Factory own/all resolution failed';
  END IF;
  IF NOT private.crm_has_company_permission('client_prices', 'view', gen_random_uuid()) THEN
    RAISE EXCEPTION 'Company all resolution failed';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_member::text, true);
  IF NOT private.crm_has_permission('materials', 'manage')
     OR NOT private.crm_has_permission('materials', 'view') THEN
    RAISE EXCEPTION 'Manage must include view';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_multi::text, true);
  IF NOT private.crm_has_permission('materials', 'manage')
     OR NOT private.crm_has_permission('inventory_history', 'view') THEN
    RAISE EXCEPTION 'Multiple departments must combine through OR';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  IF NOT private.crm_has_permission('company_settings', 'manage') THEN
    RAISE EXCEPTION 'CRM administrator position did not receive full access';
  END IF;
  SELECT count(*) INTO v_audit_before
  FROM public.department_access_audit_log
  WHERE department_id = v_head_department
    AND subject_scope = 'head'
    AND resource_key = 'dashboard';
  SELECT public.fn_save_department_access_permissions(jsonb_build_array(jsonb_build_object(
    'departmentId', v_head_department,
    'subjectScope', 'head',
    'resourceKey', 'dashboard',
    'canView', true,
    'canManage', true,
    'factoryScope', 'own',
    'companyViewScope', 'own',
    'companyManageScope', 'own'
  ))) INTO v_saved;
  IF jsonb_array_length(v_saved) <> 1 OR (v_saved->0->>'canManage')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Matrix save did not return normalized persisted state';
  END IF;
  SELECT count(*) INTO v_audit_after
  FROM public.department_access_audit_log
  WHERE department_id = v_head_department
    AND subject_scope = 'head'
    AND resource_key = 'dashboard';
  IF v_audit_after <> v_audit_before + 1 THEN
    RAISE EXCEPTION 'Matrix save must write exactly one effective audit diff';
  END IF;
  PERFORM public.fn_save_department_access_permissions(v_saved);
  IF (SELECT count(*) FROM public.department_access_audit_log
      WHERE department_id = v_head_department
        AND subject_scope = 'head'
        AND resource_key = 'dashboard') <> v_audit_after THEN
    RAISE EXCEPTION 'Idempotent matrix save wrote a false audit diff';
  END IF;

  SELECT public.fn_save_department_access_permissions(jsonb_build_array(jsonb_build_object(
    'departmentId', v_head_department,
    'subjectScope', 'head',
    'resourceKey', 'production_fact',
    'canView', true,
    'canManage', true,
    'factoryScope', 'all',
    'companyViewScope', 'own',
    'companyManageScope', 'own'
  ))) INTO v_saved;
  IF v_saved->0->>'factoryScope' <> 'all'
     OR NOT EXISTS (
       SELECT 1
       FROM public.department_access_audit_log
       WHERE department_id = v_head_department
         AND subject_scope = 'head'
         AND resource_key = 'production_fact'
         AND old_factory_scope = 'own'
         AND new_factory_scope = 'all'
     ) THEN
    RAISE EXCEPTION 'Factory scope save or audit failed for production_fact';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_inactive::text, true);
  IF private.crm_has_permission('materials', 'view') THEN
    RAISE EXCEPTION 'Inactive user received access';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_no_department::text, true);
  IF private.crm_has_permission('dashboard', 'view') THEN
    RAISE EXCEPTION 'Legacy role granted access without a department';
  END IF;
END;
$$;

ROLLBACK;
