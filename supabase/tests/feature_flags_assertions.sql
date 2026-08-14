\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_actor constant uuid := '00000000-0000-0000-0000-00000000ff01';
  v_audit_before bigint;
  v_audit_after bigint;
  v_last public.feature_flag_audit_log%ROWTYPE;
BEGIN
  INSERT INTO public.users(id, email, full_name, role, is_active)
  VALUES (v_actor, 'feature-flags@example.test', 'Feature Flags Administrator', 'planning_director', true)
  ON CONFLICT (id) DO NOTHING;

  IF (SELECT enabled FROM public.feature_flags WHERE key = 'long_stock_cutting_enabled') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'long_stock_cutting_enabled must default to false';
  END IF;

  SELECT count(*) INTO v_audit_before
  FROM public.feature_flag_audit_log
  WHERE flag_key = 'long_stock_cutting_enabled';

  UPDATE public.feature_flags
  SET enabled = true, updated_by = v_actor
  WHERE key = 'long_stock_cutting_enabled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'long_stock_cutting_enabled row is missing';
  END IF;

  SELECT count(*) INTO v_audit_after
  FROM public.feature_flag_audit_log
  WHERE flag_key = 'long_stock_cutting_enabled';

  IF v_audit_after <> v_audit_before + 1 THEN
    RAISE EXCEPTION 'flag change must create exactly one audit row';
  END IF;

  SELECT * INTO v_last
  FROM public.feature_flag_audit_log
  WHERE flag_key = 'long_stock_cutting_enabled'
  ORDER BY changed_at DESC, id DESC
  LIMIT 1;

  IF v_last.old_enabled IS DISTINCT FROM false
     OR v_last.new_enabled IS DISTINCT FROM true
     OR v_last.changed_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'audit row must contain old value, new value, and actor';
  END IF;

  UPDATE public.feature_flags
  SET enabled = true, updated_by = v_actor
  WHERE key = 'long_stock_cutting_enabled';

  IF (SELECT count(*) FROM public.feature_flag_audit_log WHERE flag_key = 'long_stock_cutting_enabled') <> v_audit_after THEN
    RAISE EXCEPTION 'unchanged value must not create an audit row';
  END IF;
END;
$$;

ROLLBACK;
