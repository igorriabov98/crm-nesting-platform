\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_factory uuid;
  v_other_factory uuid;
  v_actor constant uuid := '99000000-0000-4000-8000-000000000001';
  v_same_factory constant uuid := '99000000-0000-4000-8000-000000000002';
  v_other_factory_user constant uuid := '99000000-0000-4000-8000-000000000003';
BEGIN
  SELECT id INTO v_factory FROM public.factories ORDER BY name LIMIT 1;
  SELECT id INTO v_other_factory
  FROM public.factories
  WHERE id <> v_factory
  ORDER BY name
  LIMIT 1;
  IF v_factory IS NULL OR v_other_factory IS NULL THEN
    RAISE EXCEPTION 'Users self-visibility test requires two factories';
  END IF;

  INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
  VALUES
    (v_actor, 'self-visibility@rls.test', 'RLS self visibility', 'supply_manager', v_factory, true),
    (v_same_factory, 'same-factory-visibility@rls.test', 'RLS same factory visibility', 'sales_manager', v_factory, true),
    (v_other_factory_user, 'other-factory-visibility@rls.test', 'RLS other factory visibility', 'sales_manager', v_other_factory, true);
END;
$$;

GRANT SELECT ON public.users TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '99000000-0000-4000-8000-000000000001', true);

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.users
  WHERE id = '99000000-0000-4000-8000-000000000001'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Authenticated user cannot read own CRM profile';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.users
  WHERE id = '99000000-0000-4000-8000-000000000002'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Authenticated user cannot read same-factory directory row';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.users
  WHERE id = '99000000-0000-4000-8000-000000000003'::uuid;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Authenticated user without directory permission can read another factory';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
