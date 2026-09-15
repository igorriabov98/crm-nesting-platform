-- The receiving page is governed by the department access matrix, but the
-- inventory-transfer RPC still used the legacy users.role allow-list. Keep the
-- shared assertion strict for reservation and transport calls, and add the
-- matrix permission only for the exact role-set used by receipt.

CREATE OR REPLACE FUNCTION public.inventory_transfer_assert_actor(
  p_actor uuid,
  p_roles public.user_role[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_receiving_roles constant public.user_role[] := ARRAY[
    'technologist', 'planning_director',
    'financial_director', 'commercial_director'
  ]::public.user_role[];
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Не указан пользователь';
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Действие должно выполняться от имени текущего пользователя';
  END IF;

  IF public.inventory_transfer_role_allowed(p_roles) THEN
    RETURN;
  END IF;

  IF p_roles = v_receiving_roles
     AND public.crm_user_has_resource_permission(
       p_actor,
       'inventory_detailing_receiving',
       true
     ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Недостаточно прав для межскладской операции';
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_transfer_assert_actor(uuid, public.user_role[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_transfer_assert_actor(uuid, public.user_role[])
  TO service_role;
