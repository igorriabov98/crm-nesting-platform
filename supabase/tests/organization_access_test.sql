\set ON_ERROR_STOP on
BEGIN;
-- Fixtures are synthetic and this entire suite rolls back.
DO $test$
DECLARE
 admin_id uuid:=gen_random_uuid(); second_admin uuid:=gen_random_uuid(); employee uuid:=gen_random_uuid(); successor uuid:=gen_random_uuid();
 dept uuid:=gen_random_uuid(); finance uuid; position_id uuid:=gen_random_uuid(); membership uuid:=gen_random_uuid(); next_membership uuid:=gen_random_uuid(); extra_membership uuid:=gen_random_uuid();
 task_id uuid:=gen_random_uuid(); test_operation_id uuid:=gen_random_uuid(); ver bigint; snapshot jsonb; item jsonb; result jsonb; revoked boolean;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(admin_id,'org-admin@test.local'),(second_admin,'org-admin2@test.local'),(employee,'org-employee@test.local'),(successor,'org-successor@test.local');
 INSERT INTO public.users(id,email,full_name,role,is_active) VALUES(admin_id,'org-admin@test.local','Organization admin','engineer',true),(second_admin,'org-admin2@test.local','Second admin','engineer',true),(employee,'org-employee@test.local','Employee','engineer',true),(successor,'org-successor@test.local','Successor','engineer',true);
 INSERT INTO public.user_system_roles(user_id,role) VALUES(admin_id,'crm_admin');
 DELETE FROM public.user_system_roles WHERE user_id<>admin_id; -- isolate last-admin invariant inside rollback
 PERFORM set_config('request.jwt.claim.sub',admin_id::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 ASSERT public.crm_user_is_admin(admin_id),'Administrator must not need a position';
 BEGIN
   DELETE FROM public.user_system_roles WHERE user_id=admin_id;
   RAISE EXCEPTION 'TEST FAILURE: deleted last admin';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%последнего активного администратора%' THEN RAISE; END IF; END;
 BEGIN
   UPDATE public.users SET is_active=false WHERE id=admin_id;
   RAISE EXCEPTION 'TEST FAILURE: disabled last/self admin';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%последнего активного администратора%' AND SQLERRM NOT LIKE '%собственного аккаунта%' THEN RAISE; END IF; END;
 SELECT version INTO ver FROM public.organization_revision;
 PERFORM public.crm_set_administrator(second_admin,true,ver);
 ASSERT public.crm_user_is_admin(second_admin),'Explicit grant failed';
 BEGIN
   PERFORM public.crm_set_administrator(admin_id,false,(SELECT version FROM public.organization_revision));
   RAISE EXCEPTION 'TEST FAILURE: self demotion';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO public.departments(id,name,is_active) VALUES(dept,'Organization test department',true);
 BEGIN
   INSERT INTO public.departments(id,name,parent_id) VALUES(position_id,'Self cycle',position_id);
   RAISE EXCEPTION 'TEST FAILURE: self-parent department accepted';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%Цикл отделов%' THEN RAISE; END IF; END;
 INSERT INTO public.positions(id,name,is_active) VALUES(position_id,'Organization test position',true);
 PERFORM public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',employee,'department_id',dept,'position_id',position_id,'is_primary',true,'is_department_head',true),(SELECT version FROM public.organization_revision));
 SELECT id INTO membership FROM public.department_members WHERE user_id=employee;
 ASSERT (SELECT head_user_id=employee FROM public.departments WHERE id=dept),'Head mirror not synchronized';
 PERFORM public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',successor,'department_id',dept,'position_id',position_id,'is_primary',true),(SELECT version FROM public.organization_revision));
 SELECT id INTO next_membership FROM public.department_members WHERE user_id=successor;
 PERFORM public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',employee,'department_id',dept,'is_primary',false,'is_department_head',false),(SELECT version FROM public.organization_revision));
 SELECT id INTO extra_membership FROM public.department_members WHERE user_id=employee AND id<>membership;
 INSERT INTO public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage,factory_scope) VALUES
 (dept,'head','inventory',true,false,'own'),(dept,'member','tasks',true,true,'own'),(dept,'member','meetings',true,true,'own');
 ASSERT private.crm_subject_permission(employee,'inventory','view'),'Head grant lost';
 ASSERT private.crm_subject_permission(employee,'tasks','manage'),'Additional member grant lost';
 ASSERT NOT private.crm_subject_permission(employee,'inventory','manage'),'View escalated to manage';
 snapshot:=public.crm_access_snapshot(employee);
 ASSERT jsonb_array_length(snapshot->'memberships')=2,'Snapshot must include all memberships';
 PERFORM public.crm_change_organization('assignment',extra_membership,'{"is_primary":true}',(SELECT version FROM public.organization_revision));
 ASSERT private.crm_subject_permission(employee,'inventory','view') AND private.crm_subject_permission(employee,'tasks','manage'),'Primary changes must preserve union';
 BEGIN
   PERFORM public.crm_change_organization('profile',employee,'{"full_name":"Stale write"}',0);
   RAISE EXCEPTION 'TEST FAILURE: accepted stale structure version';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
   PERFORM public.crm_change_organization('assignment',next_membership,jsonb_build_object('reports_to_membership_id',membership),(SELECT version FROM public.organization_revision));
   PERFORM public.crm_change_organization('assignment',membership,jsonb_build_object('reports_to_membership_id',next_membership),(SELECT version FROM public.organization_revision));
   RAISE EXCEPTION 'TEST FAILURE: cycle accepted';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%Цикл подчинения%' THEN RAISE; END IF; END;
 BEGIN
   PERFORM public.crm_change_organization('department',dept,'{"is_active":false}',(SELECT version FROM public.organization_revision));
   RAISE EXCEPTION 'TEST FAILURE: archived occupied department';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%Перед архивированием%' THEN RAISE; END IF; END;
 -- A title which used to grant full authority must now be harmless.
 UPDATE public.department_members SET position_id=(SELECT id FROM public.positions WHERE name='Администратор CRM' LIMIT 1) WHERE id=next_membership;
 ASSERT NOT public.crm_user_is_admin(successor),'Position title escalated authority';
 -- Matrix saves are deltas with row CAS, even for direct RPC clients.
 SELECT revision INTO ver FROM public.department_access_permissions WHERE department_id=dept AND subject_scope='member' AND resource_key='tasks';
 item:=jsonb_build_object('departmentId',dept,'subjectScope','member','resourceKey','tasks','canView',true,'canManage',true,'factoryScope','own','companyViewScope','own','companyManageScope','own','expectedRevision',ver::text);
 result:=public.crm_save_matrix(jsonb_build_array(item));
 ASSERT jsonb_array_length(result)=1,'Matrix result must contain saved delta';
 BEGIN
   PERFORM public.crm_save_matrix(jsonb_build_array(item)); RAISE EXCEPTION 'TEST FAILURE: stale matrix accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
   PERFORM public.crm_save_matrix(jsonb_build_array(item || '{"expectedRevision":null}')); RAISE EXCEPTION 'TEST FAILURE: null revision accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 -- A head and an unfinished task must both prevent blocking.
 INSERT INTO public.tasks(id,assigned_to,task_type,title,status) VALUES(task_id,employee,'agenda_pool_distribution','Organization handoff task','pending');
 BEGIN
   PERFORM public.crm_change_user_status(employee,false,(SELECT version FROM public.organization_revision)); RAISE EXCEPTION 'TEST FAILURE: duty ignored';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%передайте все действующие обязанности%' THEN RAISE; END IF; END;
 snapshot:=public.crm_preview_offboarding(employee);
 SELECT value INTO item FROM jsonb_array_elements(snapshot->'obligations') WHERE value->>'source'='tasks';
 PERFORM public.crm_handoff_obligation(test_operation_id,employee,successor,item->>'key',item->>'fingerprint',null);
 PERFORM public.crm_handoff_obligation(test_operation_id,employee,successor,item->>'key',item->>'fingerprint',null);
 ASSERT (SELECT assigned_to=successor FROM public.tasks WHERE id=task_id),'Task not transferred';
 ASSERT (SELECT count(*)=1 FROM public.organization_handoffs WHERE organization_handoffs.operation_id=test_operation_id),'Retry duplicated transfer';
 SELECT value INTO item FROM jsonb_array_elements(public.crm_preview_offboarding(employee)->'obligations') WHERE value->>'source'='head';
 PERFORM public.crm_handoff_obligation(gen_random_uuid(),employee,successor,item->>'key',item->>'fingerprint',next_membership);
 ASSERT (SELECT head_user_id=successor FROM public.departments WHERE id=dept),'Head handoff failed';
 PERFORM public.crm_change_user_status(employee,false,(SELECT version FROM public.organization_revision));
 ASSERT NOT private.crm_subject_permission(employee,'tasks','manage'),'Blocked account retained rights';
 ASSERT EXISTS(SELECT 1 FROM public.user_auth_sync WHERE user_id=employee AND NOT desired_active AND synced_at IS NULL),'No Auth outbox';
 BEGIN
   INSERT INTO public.tasks(assigned_to,task_type,title,status) VALUES(employee,'agenda_pool_distribution','Late duty','pending');
   RAISE EXCEPTION 'TEST FAILURE: duty assigned to blocked user';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%заблокированному пользователю%' THEN RAISE; END IF; END;
 PERFORM public.crm_change_user_status(employee,true,(SELECT version FROM public.organization_revision));
 ASSERT private.crm_subject_permission(employee,'tasks','manage'),'Restore failed';
 SELECT d.id INTO finance FROM public.departments d WHERE d.name='Финансовый отдел' AND d.is_active AND EXISTS(SELECT 1 FROM public.department_access_permissions p WHERE p.department_id=d.id AND p.resource_key='inventory' AND p.subject_scope='head' AND p.can_view AND NOT p.can_manage) ORDER BY d.id LIMIT 1;
 PERFORM public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',second_admin,'department_id',finance,'is_department_head',true),(SELECT version FROM public.organization_revision));
 PERFORM public.crm_set_administrator(second_admin,false,(SELECT version FROM public.organization_revision));
 ASSERT private.crm_subject_permission(second_admin,'inventory','view') AND NOT private.crm_subject_permission(second_admin,'inventory','manage'),'Finance head is not view-only';
 PERFORM public.crm_change_organization('assignment',NULL,jsonb_build_object('user_id',successor,'department_id',finance),(SELECT version FROM public.organization_revision));
 ASSERT private.crm_subject_permission(successor,'inventory','view') AND NOT private.crm_subject_permission(successor,'inventory','manage'),'Finance member is not view-only';
 RAISE NOTICE 'Organization commands, union, primary, title safety, matrix CAS, handoff, blocking, Auth outbox and Finance checks passed';
END;
$test$;
ROLLBACK;
