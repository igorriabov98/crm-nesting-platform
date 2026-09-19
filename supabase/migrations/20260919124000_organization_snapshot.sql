CREATE FUNCTION public.crm_organization_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE can_users boolean; can_departments boolean;
BEGIN
  can_users:=private.crm_has_permission('admin_users','view');
  can_departments:=private.crm_has_permission('departments','view');
  IF NOT can_users AND NOT can_departments THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'version',(SELECT version::text FROM public.organization_revision WHERE singleton),
    'users',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'full_name',u.full_name,'email',CASE WHEN can_users THEN u.email ELSE NULL END,
      'factory_id',u.factory_id,'telegram_chat_id',CASE WHEN can_users THEN u.telegram_chat_id ELSE NULL END,'is_active',u.is_active,
      'is_admin',EXISTS(SELECT 1 FROM public.user_system_roles WHERE user_id=u.id),
      'auth_sync_pending',EXISTS(SELECT 1 FROM public.user_auth_sync WHERE user_id=u.id AND synced_at IS NULL)) ORDER BY u.full_name),'[]'::jsonb) FROM public.users u),
    'departments',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.sort_order,d.name),'[]'::jsonb) FROM public.departments d),
    'positions',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.level DESC,p.name),'[]'::jsonb) FROM public.positions p),
    'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.joined_at,m.id),'[]'::jsonb) FROM public.department_members m),
    'factories',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name) ORDER BY f.name),'[]'::jsonb) FROM public.factories f)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_organization_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_organization_snapshot() TO authenticated;
