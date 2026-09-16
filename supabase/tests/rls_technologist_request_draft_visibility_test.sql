\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory uuid;
  v_admin constant uuid := '98100000-0000-4000-8000-000000000001';
  v_supply constant uuid := '98100000-0000-4000-8000-000000000002';
  v_admin_department constant uuid := '98100000-0000-4000-8000-000000000003';
  v_supply_department constant uuid := '98100000-0000-4000-8000-000000000004';
  v_machine constant uuid := '98100000-0000-4000-8000-000000000005';
  v_draft constant uuid := '98100000-0000-4000-8000-000000000006';
  v_submitted constant uuid := '98100000-0000-4000-8000-000000000007';
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY name LIMIT 1;
  IF v_factory IS NULL THEN
    RAISE EXCEPTION 'Draft visibility test requires a factory';
  END IF;

  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active) VALUES
    (v_admin, 'matrix-admin-draft@rls.test', 'RLS matrix admin', 'technologist', v_factory, true),
    (v_supply, 'matrix-supply-draft@rls.test', 'RLS supply only', 'supply_manager', v_factory, true);
  INSERT INTO public.departments(id, name, head_user_id, factory_id, is_active, created_by) VALUES
    (v_admin_department, 'RLS draft admin', v_admin, v_factory, true, v_admin),
    (v_supply_department, 'RLS draft supply', v_supply, v_factory, true, v_supply);
  INSERT INTO public.department_members(user_id, department_id, is_department_head, created_by) VALUES
    (v_admin, v_admin_department, true, v_admin),
    (v_supply, v_supply_department, true, v_supply);
  INSERT INTO public.department_access_permissions(
    department_id, subject_scope, resource_key, can_view, can_manage, updated_by
  ) VALUES
    (v_admin_department, 'head', 'technologist_requests', true, true, v_admin),
    (v_admin_department, 'head', 'supply_material_requests', true, true, v_admin),
    (v_supply_department, 'head', 'supply_orders', true, false, v_supply),
    (v_supply_department, 'head', 'supply_material_requests', true, false, v_supply);
  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_machine, v_factory, 'RLS-DRAFT-VISIBILITY', v_admin);
  INSERT INTO public.technologist_requests(id, machine_id, created_by, status, submitted_at) VALUES
    (v_draft, v_machine, v_admin, 'draft', null),
    (v_submitted, v_machine, v_admin, 'submitted_to_supply', now());
END;
$$;

GRANT SELECT, INSERT ON public.technologist_requests TO authenticated;
GRANT SELECT ON public.machines TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_inserted uuid;
  v_count integer;
BEGIN
  INSERT INTO public.technologist_requests(id, machine_id, created_by, status)
  VALUES (
    '98100000-0000-4000-8000-000000000008'::uuid,
    '98100000-0000-4000-8000-000000000005'::uuid,
    '98100000-0000-4000-8000-000000000001'::uuid,
    'draft'
  )
  RETURNING id INTO v_inserted;
  IF v_inserted IS NULL THEN
    RAISE EXCEPTION 'Matrix admin cannot INSERT draft with RETURNING';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.technologist_requests
  WHERE id = '98100000-0000-4000-8000-000000000006'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Matrix admin cannot read pre-approval draft';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '98100000-0000-4000-8000-000000000002', true);

DO $$
DECLARE
  v_draft_count integer;
  v_submitted_count integer;
BEGIN
  SELECT count(*) INTO v_draft_count
  FROM public.technologist_requests
  WHERE id = '98100000-0000-4000-8000-000000000006'::uuid;
  SELECT count(*) INTO v_submitted_count
  FROM public.technologist_requests
  WHERE id = '98100000-0000-4000-8000-000000000007'::uuid;
  IF v_draft_count <> 0 THEN
    RAISE EXCEPTION 'Supply-only user can see pre-approval draft';
  END IF;
  IF v_submitted_count <> 1 THEN
    RAISE EXCEPTION 'Supply-only user cannot see submitted request';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
