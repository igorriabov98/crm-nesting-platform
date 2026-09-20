\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE admin_id uuid:=gen_random_uuid(); employee uuid:=gen_random_uuid(); boss uuid:=gen_random_uuid();
 department_a uuid:=gen_random_uuid(); department_b uuid:=gen_random_uuid(); position_a uuid:=gen_random_uuid();
 source_id uuid; target_id uuid; boss_id uuid; before_rights boolean; ver bigint;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(admin_id,'member-fix-admin@test.local'),(employee,'member-fix-user@test.local'),(boss,'member-fix-boss@test.local');
 INSERT INTO public.users(id,email,full_name,role,is_active) VALUES(admin_id,'member-fix-admin@test.local','Fix admin','engineer',true),(employee,'member-fix-user@test.local','Fix member','engineer',true),(boss,'member-fix-boss@test.local','Fix boss','engineer',true);
 INSERT INTO public.user_system_roles(user_id,role) VALUES(admin_id,'crm_admin');
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 INSERT INTO public.departments(id,name) VALUES(department_a,'Fix source'),(department_b,'Fix destination');
 INSERT INTO public.positions(id,name) VALUES(position_a,'Fix position');
 source_id:=(public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',employee,'department_id',department_a,'is_primary',true),(SELECT version FROM public.organization_revision))->>'id')::uuid;
 target_id:=(public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',employee,'department_id',department_b,'position_id',position_a),(SELECT version FROM public.organization_revision))->>'id')::uuid;
 boss_id:=(public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',boss,'department_id',department_a),(SELECT version FROM public.organization_revision))->>'id')::uuid;
 -- Reproduce a user-only legacy supervisor from before the migration.
 ALTER TABLE public.department_members DISABLE TRIGGER organization_validate_member;
 UPDATE public.department_members SET reports_to_user_id=boss WHERE id=source_id;
 ALTER TABLE public.department_members ENABLE TRIGGER organization_validate_member;
 PERFORM public.crm_change_organization('assignment',source_id,'{"is_primary":true}',(SELECT version FROM public.organization_revision));
 ASSERT (SELECT reports_to_user_id=boss FROM public.department_members WHERE id=source_id),'Unrelated edit must retain unresolved relationship';
 PERFORM public.crm_change_organization('assignment',source_id,'{"reports_to_membership_id":null}',(SELECT version FROM public.organization_revision));
 ASSERT (SELECT reports_to_user_id IS NULL AND reports_to_membership_id IS NULL FROM public.department_members WHERE id=source_id),'Explicit None must clear the unresolved warning';
 PERFORM public.crm_change_organization('assignment',source_id,jsonb_build_object('reports_to_membership_id',boss_id),(SELECT version FROM public.organization_revision));
 ASSERT (SELECT reports_to_user_id=boss AND reports_to_membership_id=boss_id FROM public.department_members WHERE id=source_id),'Selected assignment must synchronize legacy supervisor';
 BEGIN
   PERFORM public.crm_change_organization('assignment',source_id,jsonb_build_object('department_id',department_b,'position_id',position_a,'reports_to_membership_id',NULL),(SELECT version FROM public.organization_revision));
   RAISE EXCEPTION 'TEST FAILURE: duplicate move accepted';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE 'Такое назначение уже есть%' THEN RAISE; END IF; END;
 ASSERT (SELECT department_id=department_a AND is_primary FROM public.department_members WHERE id=source_id),'Failed transfer partially mutated source';
 INSERT INTO public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage) VALUES(department_b,'member','inventory',true,false);
 before_rights:=private.crm_subject_permission(employee,'inventory','view');
 PERFORM public.crm_change_organization('consolidate_assignment',source_id,jsonb_build_object('target_membership_id',target_id),(SELECT version FROM public.organization_revision));
 ASSERT NOT EXISTS(SELECT 1 FROM public.department_members WHERE id=source_id),'Source not removed after explicit consolidation';
 ASSERT (SELECT is_primary AND position_id=position_a FROM public.department_members WHERE id=target_id),'Destination settings/identity lost';
 ASSERT private.crm_subject_permission(employee,'inventory','view')=before_rights AND NOT private.crm_subject_permission(employee,'inventory','manage'),'Destination rights changed';
 ASSERT EXISTS(SELECT 1 FROM public.organization_audit_log WHERE entity_id=source_id AND action='DELETE'),'No removal audit';
 PERFORM public.crm_change_organization('remove_assignment',target_id,'{}',(SELECT version FROM public.organization_revision));
 ASSERT EXISTS(SELECT 1 FROM public.users WHERE id=employee AND is_active),'Removing assignment deleted account';
 ASSERT NOT private.crm_subject_permission(employee,'inventory','view'),'Removed grant still effective';
 PERFORM public.crm_change_organization('profile',employee,'{"email":"new-member-fix@test.local","full_name":"New member name"}',(SELECT version FROM public.organization_revision));
 ASSERT (SELECT desired_email='new-member-fix@test.local' AND synced_at IS NULL FROM public.user_auth_sync WHERE user_id=employee),'Email intent not durably queued';
 BEGIN
   PERFORM public.crm_change_organization('profile',employee,'{"email":"member-fix-boss@test.local"}',(SELECT version FROM public.organization_revision));
   RAISE EXCEPTION 'TEST FAILURE: duplicate email accepted';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%email уже используется%' THEN RAISE; END IF; END;
 ver:=(SELECT version FROM public.organization_revision);
 BEGIN
   PERFORM public.crm_archive_user(employee,ver-1); RAISE EXCEPTION 'TEST FAILURE: stale archive accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM public.crm_archive_user(employee,ver);
 ASSERT (SELECT NOT is_active AND archived_at IS NOT NULL FROM public.users WHERE id=employee),'Archive must close access and retain user';
 ASSERT NOT private.crm_subject_permission(employee,'inventory','view'),'Archived account has access';
 ASSERT (SELECT NOT desired_active AND synced_at IS NULL FROM public.user_auth_sync WHERE user_id=employee),'Archive did not queue Auth ban';
 PERFORM public.crm_change_user_status(employee,true,(SELECT version FROM public.organization_revision));
 ASSERT (SELECT is_active AND archived_at IS NULL FROM public.users WHERE id=employee),'Restoration left active user archived';
 PERFORM public.crm_change_organization('head',department_a,jsonb_build_object('membership_id',boss_id),(SELECT version FROM public.organization_revision));
 BEGIN
   PERFORM public.crm_archive_user(boss,(SELECT version FROM public.organization_revision)); RAISE EXCEPTION 'TEST FAILURE: archived head without handoff';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%передайте%' THEN RAISE; END IF; END;
 ASSERT (SELECT is_active AND archived_at IS NULL FROM public.users WHERE id=boss),'Failed archive changed status';
 BEGIN
   PERFORM public.crm_archive_user(admin_id,(SELECT version FROM public.organization_revision)); RAISE EXCEPTION 'TEST FAILURE: self archive accepted';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%собственный%' AND SQLERRM NOT LIKE '%собственного%' THEN RAISE; END IF; END;
 ASSERT public.crm_user_is_admin(admin_id),'Admin authority lost';
END;
$test$;
ROLLBACK;
