\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory uuid;
  v_author constant uuid := '98200000-0000-4000-8000-000000000001';
  v_supply constant uuid := '98200000-0000-4000-8000-000000000002';
  v_author_department constant uuid := '98200000-0000-4000-8000-000000000003';
  v_supply_department constant uuid := '98200000-0000-4000-8000-000000000004';
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY id LIMIT 1;
  IF v_factory IS NULL THEN RAISE EXCEPTION 'Test requires a factory'; END IF;
  PERFORM set_config('request_returning.factory',v_factory::text,true);

  INSERT INTO public.users(id,email,full_name,role,factory_id,is_active) VALUES
    (v_author,'request-returning-author@rls.test','Request returning author','technologist',v_factory,true),
    (v_supply,'request-returning-supply@rls.test','Request returning supply','supply_manager',v_factory,true);
  INSERT INTO public.departments(id,name,factory_id,is_active,created_by) VALUES
    (v_author_department,'Request returning author',v_factory,true,v_author),
    (v_supply_department,'Request returning supply',v_factory,true,v_supply);
  INSERT INTO public.department_members(user_id,department_id,is_department_head,created_by) VALUES
    (v_author,v_author_department,false,v_author),
    (v_supply,v_supply_department,false,v_supply);
  INSERT INTO public.department_access_permissions(
    department_id,subject_scope,resource_key,can_view,can_manage,updated_by
  ) VALUES
    (v_author_department,'member','technologist_requests',true,true,v_author),
    (v_supply_department,'member','supply_orders',true,false,v_supply);
  INSERT INTO public.machines(id,factory_id,name,created_by)
  VALUES ('98200000-0000-4000-8000-000000000005',v_factory,'RLS-RETURNING-MACHINE',v_author);
END;
$$;

GRANT SELECT, INSERT ON public.technologist_requests TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','98200000-0000-4000-8000-000000000001',true);

DO $$
DECLARE
  v_factory uuid := current_setting('request_returning.factory')::uuid;
  v_machine_request uuid;
  v_stock_request uuid;
BEGIN
  INSERT INTO public.technologist_requests(machine_id,created_by,status)
  VALUES ('98200000-0000-4000-8000-000000000005',
          '98200000-0000-4000-8000-000000000001','draft')
  RETURNING id INTO v_machine_request;
  IF v_machine_request IS NULL THEN RAISE EXCEPTION 'Machine request was not returned'; END IF;

  INSERT INTO public.technologist_requests(request_kind,machine_id,factory_id,title,created_by,status)
  VALUES ('stock',NULL,v_factory,'Request returning stock',
          '98200000-0000-4000-8000-000000000001','draft')
  RETURNING id INTO v_stock_request;
  IF v_stock_request IS NULL THEN RAISE EXCEPTION 'Stock request was not returned'; END IF;

  IF NOT private.stock_request_visible(v_machine_request)
     OR NOT private.stock_request_visible(v_stock_request) THEN
    RAISE EXCEPTION 'Author cannot read new requests';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub','98200000-0000-4000-8000-000000000002',true);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.technologist_requests
    WHERE request_kind = 'stock' AND title = 'Request returning stock'
  ) THEN
    RAISE EXCEPTION 'Supply user can read an unapproved stock draft';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
