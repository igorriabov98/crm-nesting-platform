-- Harden internal detailing helpers after the production advisor audit.
ALTER FUNCTION public.detailing_touch_updated_at()
  SET search_path = public;

ALTER FUNCTION public.detailing_validate_product_version()
  SET search_path = public;

ALTER FUNCTION public.detailing_reject_movement_changes()
  SET search_path = public;

ALTER FUNCTION public.detailing_previous_workday(date)
  SET search_path = public;

REVOKE ALL ON FUNCTION public.detailing_role_allowed(public.user_role[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.detailing_role_allowed(public.user_role[])
  TO service_role;
