-- Separately approved business change: Finance may read inventory, never manage it.
DO $migration$
DECLARE finance_id uuid; matched integer;
BEGIN
  SELECT count(*),(array_agg(id))[1] INTO matched,finance_id FROM public.departments WHERE name='Финансовый отдел' AND is_active IS TRUE;
  IF matched<>1 THEN RAISE EXCEPTION 'Ожидался один активный Финансовый отдел. Согласуйте его идентификатор перед переносом.'; END IF;
  INSERT INTO public.organization_audit_log(entity_type,entity_id,action,before_data,after_data)
  SELECT 'department',finance_id,'finance_inventory_view',
    (SELECT jsonb_agg(to_jsonb(p)) FROM public.department_access_permissions p WHERE department_id=finance_id AND resource_key='inventory'),
    jsonb_build_object('resource','inventory','canView',true,'canManage',false,'subjects',jsonb_build_array('head','member'));
  INSERT INTO public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage,factory_scope,company_view_scope,company_manage_scope)
  SELECT finance_id,subject,'inventory',true,false,'own','own','own' FROM unnest(ARRAY['head','member']) subject
  ON CONFLICT(department_id,subject_scope,resource_key) DO UPDATE SET can_view=true,can_manage=false,updated_at=now();
END;
$migration$;
