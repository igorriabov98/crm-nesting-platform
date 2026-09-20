\set ON_ERROR_STOP on
BEGIN;
GRANT UPDATE ON public.machines TO authenticated;
GRANT SELECT ON public.machines,public.technologist_requests,public.notifications TO authenticated;
INSERT INTO auth.users(id,email) VALUES
 ('c2000000-0000-4000-8000-000000000001','technical-access@test.local'),
 ('c2000000-0000-4000-8000-000000000002','technical-recipient@test.local');
INSERT INTO public.users(id,email,full_name,role,is_active) VALUES
 ('c2000000-0000-4000-8000-000000000001','technical-access@test.local','Technical operator','engineer',true),
 ('c2000000-0000-4000-8000-000000000002','technical-recipient@test.local','Task recipient','engineer',true);
INSERT INTO public.departments(id,name) VALUES ('c2000000-0000-4000-8000-000000000010','Technical regression');
INSERT INTO public.department_members(user_id,department_id) VALUES
 ('c2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000010'),
 ('c2000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000010');
INSERT INTO public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage) VALUES
 ('c2000000-0000-4000-8000-000000000010','member','sales_plan',true,false),
 ('c2000000-0000-4000-8000-000000000010','member','technologist_requests',true,true),
 ('c2000000-0000-4000-8000-000000000010','member','tasks',true,true),
 ('c2000000-0000-4000-8000-000000000010','member','notifications',true,true);
INSERT INTO public.machines(id,factory_id,name,created_by) VALUES
 ('c2000000-0000-4000-8000-000000000020',(SELECT id FROM public.factories LIMIT 1),'Material permission regression','c2000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','c2000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE changed integer;
BEGIN
 PERFORM public.crm_set_machine_material_type('c2000000-0000-4000-8000-000000000020','standard');
 ASSERT (SELECT material_type='standard' FROM public.machines WHERE id='c2000000-0000-4000-8000-000000000020'),'Technical matrix permission did not allow standard';
 PERFORM public.crm_set_machine_material_type('c2000000-0000-4000-8000-000000000020','non_standard');
 ASSERT (SELECT material_type='non_standard' FROM public.machines WHERE id='c2000000-0000-4000-8000-000000000020'),'Technical matrix permission did not allow nonstandard';
 UPDATE public.machines SET name='Unauthorized' WHERE id='c2000000-0000-4000-8000-000000000020';
 GET DIAGNOSTICS changed=ROW_COUNT;
 ASSERT changed=0,'Narrow material action expanded general order update';
 BEGIN
   PERFORM public.crm_set_machine_material_type('c2000000-0000-4000-8000-000000000020',NULL);
   RAISE EXCEPTION 'TEST FAILURE: NULL accepted';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%Выберите тип%' THEN RAISE; END IF; END;
END;
$test$;
RESET ROLE;
UPDATE public.department_access_permissions SET can_manage=false WHERE department_id='c2000000-0000-4000-8000-000000000010' AND resource_key='technologist_requests';
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
 BEGIN
  PERFORM public.crm_set_machine_material_type('c2000000-0000-4000-8000-000000000020','standard');
  RAISE EXCEPTION 'TEST FAILURE: revoked permission accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;
RESET ROLE;
UPDATE public.department_access_permissions SET can_manage=true WHERE department_id='c2000000-0000-4000-8000-000000000010' AND resource_key='technologist_requests';
UPDATE public.machines SET is_archived=true WHERE id='c2000000-0000-4000-8000-000000000020';
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
 BEGIN
  PERFORM public.crm_set_machine_material_type('c2000000-0000-4000-8000-000000000020','standard');
  RAISE EXCEPTION 'TEST FAILURE: archived order changed';
 EXCEPTION WHEN others THEN IF SQLERRM NOT LIKE '%архиве%' THEN RAISE; END IF; END;
END;
$test$;
RESET ROLE;
-- All task sources enter through the same INSERT/UPDATE trigger, including SQL automation.
INSERT INTO public.tasks(id,assigned_to,task_type,title,status) VALUES
 ('c2000000-0000-4000-8000-000000000030','c2000000-0000-4000-8000-000000000001','agenda_pool_distribution','Notification regression','pending');
DO $test$
BEGIN
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE related_task_id='c2000000-0000-4000-8000-000000000030' AND user_id='c2000000-0000-4000-8000-000000000001' AND type='task_assigned' AND NOT is_read),'New task must create exactly one unread CRM notification';
 UPDATE public.tasks SET status='in_progress',title='Changed title' WHERE id='c2000000-0000-4000-8000-000000000030';
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE related_task_id='c2000000-0000-4000-8000-000000000030'),'Routine changes must not duplicate assignment notification';
 UPDATE public.tasks SET assigned_to='c2000000-0000-4000-8000-000000000002' WHERE id='c2000000-0000-4000-8000-000000000030';
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE related_task_id='c2000000-0000-4000-8000-000000000030' AND user_id='c2000000-0000-4000-8000-000000000002'),'New assignee not notified';
 UPDATE public.tasks SET status='completed' WHERE id='c2000000-0000-4000-8000-000000000030';
 ASSERT (SELECT count(*)=2 FROM public.notifications WHERE related_task_id='c2000000-0000-4000-8000-000000000030'),'Completion duplicated assignment event';
 UPDATE public.tasks SET status='pending' WHERE id='c2000000-0000-4000-8000-000000000030';
 ASSERT (SELECT count(*)=3 FROM public.notifications WHERE related_task_id='c2000000-0000-4000-8000-000000000030'),'Reopened task not notified';
 BEGIN
  INSERT INTO public.tasks(id,assigned_to,task_type,title,status) VALUES('c2000000-0000-4000-8000-000000000031','c2000000-0000-4000-8000-000000000001','agenda_pool_distribution','Rolled back','pending');
  RAISE EXCEPTION 'rollback fixture';
 EXCEPTION WHEN raise_exception THEN NULL; END;
 ASSERT NOT EXISTS(SELECT 1 FROM public.notifications WHERE related_task_id='c2000000-0000-4000-8000-000000000031'),'Notification escaped rolled-back task';
 ASSERT NOT has_function_privilege('anon','public.crm_set_machine_material_type(uuid,public.material_type)','EXECUTE'),'Anonymous material mutation exposed';
END;
$test$;
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
 ASSERT (SELECT count(*)=1 FROM public.notifications WHERE related_task_id='c2000000-0000-4000-8000-000000000030'),'RLS must restrict notifications to their recipient';
END;
$test$;
RESET ROLE;
ROLLBACK;
