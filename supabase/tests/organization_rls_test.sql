\set ON_ERROR_STOP on
BEGIN;
GRANT USAGE ON SCHEMA auth,private,storage TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;
INSERT INTO storage.objects(bucket_id,name) VALUES ('product-files','organization-rls-fixture.pdf');
-- Reproduce Supabase default data grants, which the bare PostgreSQL harness omits.
GRANT SELECT,UPDATE ON public.inventory TO authenticated;
GRANT SELECT ON public.users,public.department_members,public.materials,public.material_variants,public.steel_types TO authenticated;
INSERT INTO public.users(id,email,full_name,role,factory_id,is_active)
SELECT 'b0000000-0000-4000-8000-000000000001','finance-rls@test.local','Finance RLS test','engineer',id,true FROM public.factories ORDER BY id LIMIT 1;
INSERT INTO public.department_members(user_id,department_id,is_department_head)
SELECT 'b0000000-0000-4000-8000-000000000001',d.id,true FROM public.departments d WHERE d.name='Финансовый отдел' AND NOT EXISTS (SELECT 1 FROM public.department_members m WHERE m.department_id=d.id AND m.is_department_head) AND EXISTS (SELECT 1 FROM public.department_access_permissions p WHERE p.department_id=d.id AND p.resource_key='inventory' AND p.subject_scope='head' AND p.can_view AND NOT p.can_manage) ORDER BY d.id LIMIT 1;
INSERT INTO public.materials(id,name,category) VALUES ('b0000000-0000-4000-8000-000000000002','Organization RLS material','components');
INSERT INTO public.inventory(id,material_id,factory_id,total_quantity,reserved_quantity,unit)
SELECT 'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002',factory_id,5,0,'шт' FROM public.users WHERE id='b0000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE changed integer;
BEGIN
 ASSERT EXISTS(SELECT 1 FROM public.inventory WHERE id='b0000000-0000-4000-8000-000000000003'),'Finance cannot read inventory';
 UPDATE public.inventory SET total_quantity=7 WHERE id='b0000000-0000-4000-8000-000000000003';
 GET DIAGNOSTICS changed=ROW_COUNT;
 ASSERT changed=0,'Finance directly changed inventory';
 ASSERT NOT private.crm_has_permission('inventory','manage'),'Finance management guard allowed access';
 BEGIN UPDATE public.users SET is_active=false WHERE id='b0000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'TEST FAILURE: direct user write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.department_members SET is_department_head=false WHERE user_id='b0000000-0000-4000-8000-000000000001'; RAISE EXCEPTION 'TEST FAILURE: direct structure write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.user_system_roles(user_id,role) VALUES('b0000000-0000-4000-8000-000000000001','crm_admin'); RAISE EXCEPTION 'TEST FAILURE: direct admin escalation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.crm_access_snapshot('b0000000-0000-4000-8000-000000000099'); RAISE EXCEPTION 'TEST FAILURE: other user access disclosure'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;
RESET ROLE;
-- Trusted fixture transition checks server/RLS denial even with an old JWT.
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true);
UPDATE public.department_members SET is_department_head=false WHERE user_id='b0000000-0000-4000-8000-000000000001';
UPDATE public.users SET is_active=false WHERE id='b0000000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true),set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.inventory WHERE id='b0000000-0000-4000-8000-000000000003'),'Blocked user sees inventory';
 ASSERT NOT private.crm_has_permission('inventory','view'),'Blocked JWT retains access';
 ASSERT NOT EXISTS(SELECT 1 FROM public.users),'Blocked JWT sees profiles';
 ASSERT NOT EXISTS(SELECT 1 FROM storage.objects WHERE name='organization-rls-fixture.pdf'),'Blocked JWT sees files';
 ASSERT NOT EXISTS(SELECT 1 FROM public.department_members),'Blocked JWT sees organization';
 BEGIN PERFORM public.crm_access_snapshot(); RAISE EXCEPTION 'TEST FAILURE: blocked snapshot'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$test$;
RESET ROLE;
-- A protected administrator with no position must pass the real inventory RLS.
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.users(id,email,full_name,role,is_active) VALUES('b0000000-0000-4000-8000-000000000004','protected-admin@test.local','Protected administrator','procurement_head',true);
INSERT INTO public.user_system_roles(user_id,role) VALUES('b0000000-0000-4000-8000-000000000004','crm_admin');
SELECT set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000004',true),set_config('request.jwt.claim.role','authenticated',true);
SET LOCAL ROLE authenticated;
DO $test$
DECLARE changed integer;
BEGIN
 ASSERT public.crm_user_is_admin(auth.uid()),'Protected admin requires a title';
 ASSERT EXISTS(SELECT 1 FROM storage.objects WHERE name='organization-rls-fixture.pdf'),'Protected admin lost file access after role change';
 ASSERT EXISTS(SELECT 1 FROM public.inventory WHERE id='b0000000-0000-4000-8000-000000000003'),'Protected admin lost inventory visibility';
 UPDATE public.inventory SET total_quantity=6 WHERE id='b0000000-0000-4000-8000-000000000003';
 GET DIAGNOSTICS changed=ROW_COUNT;
 ASSERT changed=1,'Protected admin lost inventory management';
END;
$test$;
RESET ROLE;
ROLLBACK;
