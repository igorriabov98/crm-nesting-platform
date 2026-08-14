-- General-purpose server-side feature flags.
-- Missing rows and failed reads are interpreted by the application as disabled.

CREATE TABLE public.feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_key_format CHECK (key ~ '^[a-z][a-z0-9_]*$')
);

CREATE TABLE public.feature_flag_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flag_key text NOT NULL REFERENCES public.feature_flags(key) ON DELETE RESTRICT,
  old_enabled boolean,
  new_enabled boolean NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feature_flag_audit_log_flag_changed
  ON public.feature_flag_audit_log(flag_key, changed_at DESC);

CREATE OR REPLACE FUNCTION public.feature_flags_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.feature_flags_write_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.enabled IS DISTINCT FROM NEW.enabled THEN
    INSERT INTO public.feature_flag_audit_log(
      flag_key,
      old_enabled,
      new_enabled,
      changed_by
    )
    VALUES (
      NEW.key,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.enabled END,
      NEW.enabled,
      NEW.updated_by
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feature_flags_touch_updated_at
BEFORE UPDATE ON public.feature_flags
FOR EACH ROW EXECUTE FUNCTION public.feature_flags_touch_updated_at();

CREATE TRIGGER feature_flags_write_audit
AFTER INSERT OR UPDATE OF enabled ON public.feature_flags
FOR EACH ROW EXECUTE FUNCTION public.feature_flags_write_audit();

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flag_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.feature_flags FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.feature_flag_audit_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.feature_flags TO service_role;
GRANT ALL ON TABLE public.feature_flag_audit_log TO service_role;

REVOKE ALL ON FUNCTION public.feature_flags_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.feature_flags_write_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.feature_flags_touch_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION public.feature_flags_write_audit() TO service_role;

INSERT INTO public.feature_flags(key, enabled)
VALUES ('long_stock_cutting_enabled', false)
ON CONFLICT (key) DO NOTHING;
