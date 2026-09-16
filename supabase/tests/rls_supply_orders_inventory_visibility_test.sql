\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory uuid;
  v_actor constant uuid := '98000000-0000-4000-8000-000000000001';
  v_department constant uuid := '98000000-0000-4000-8000-000000000002';
  v_machine constant uuid := '98000000-0000-4000-8000-000000000003';
  v_request constant uuid := '98000000-0000-4000-8000-000000000004';
  v_item constant uuid := '98000000-0000-4000-8000-000000000005';
  v_material constant uuid := '98000000-0000-4000-8000-000000000006';
  v_inventory constant uuid := '98000000-0000-4000-8000-000000000007';
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY name LIMIT 1;
  IF v_factory IS NULL THEN
    RAISE EXCEPTION 'Supply visibility test requires a factory';
  END IF;

  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
  VALUES (v_actor, 'supply-matrix@rls.test', 'RLS supply matrix', 'supply_manager', v_factory, true);

  INSERT INTO public.departments(id, name, head_user_id, factory_id, is_active, created_by)
  VALUES (v_department, 'RLS supply visibility', v_actor, v_factory, true, v_actor);

  INSERT INTO public.department_members(user_id, department_id, is_department_head, created_by)
  VALUES (v_actor, v_department, true, v_actor);

  INSERT INTO public.department_access_permissions(
    department_id, subject_scope, resource_key, can_view, can_manage, updated_by
  ) VALUES
    (v_department, 'head', 'supply_orders', true, false, v_actor),
    (v_department, 'head', 'inventory', true, false, v_actor);

  INSERT INTO public.materials(id, name, category, created_by)
  VALUES (v_material, 'RLS supply visibility material', 'components', v_actor);

  INSERT INTO public.machines(id, factory_id, name, created_by)
  VALUES (v_machine, v_factory, 'RLS-SUPPLY-VISIBILITY', v_actor);

  INSERT INTO public.technologist_requests(id, machine_id, created_by, status, submitted_at)
  VALUES (v_request, v_machine, v_actor, 'submitted_to_supply', now());

  INSERT INTO public.request_components(
    id, request_id, component_name, quantity_needed, unit, material_id, order_status, ordered_at
  ) VALUES (
    v_item, v_request, 'RLS ordered component', 2, 'шт', v_material, 'ordered', now()
  );

  INSERT INTO public.inventory(
    id, factory_id, material_id, total_quantity, reserved_quantity, unit, last_updated_by
  ) VALUES (v_inventory, v_factory, v_material, 5, 0, 'шт', v_actor);
END;
$$;

-- The reconstructed full-schema test database intentionally omits Supabase's
-- platform-level table grants. Grant only the capabilities exercised here so
-- the assertions test RLS rather than fixture ACLs; the transaction rolls
-- these grants back.
GRANT SELECT ON public.technologist_requests TO authenticated;
GRANT SELECT ON public.request_components TO authenticated;
GRANT SELECT ON public.machines TO authenticated;
GRANT SELECT, UPDATE ON public.inventory TO authenticated;
GRANT SELECT ON public.materials TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_count integer;
  v_updated integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.technologist_requests
  WHERE id = '98000000-0000-4000-8000-000000000004'::uuid
    AND status = 'submitted_to_supply';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'supply_orders/view cannot see submitted request';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.request_components
  WHERE id = '98000000-0000-4000-8000-000000000005'::uuid
    AND order_status = 'ordered';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'supply_orders/view cannot see ordered request item';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.machines
  WHERE id = '98000000-0000-4000-8000-000000000003'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'supply_orders/view cannot see request machine';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.inventory
  WHERE id = '98000000-0000-4000-8000-000000000007'::uuid
    AND available_quantity = 5;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'inventory/view cannot see warehouse row';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.materials
  WHERE id = '98000000-0000-4000-8000-000000000006'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'supply/inventory view cannot hydrate material metadata';
  END IF;

  UPDATE public.inventory
  SET total_quantity = 99
  WHERE id = '98000000-0000-4000-8000-000000000007'::uuid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'view-only inventory permission unexpectedly allowed UPDATE';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
