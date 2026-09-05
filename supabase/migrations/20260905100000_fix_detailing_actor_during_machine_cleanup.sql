-- Keep the authenticated actor available while machine_items are deleted by a
-- cascading machines delete. At that point the parent machine row is no longer
-- visible to a SELECT, so a top-level FROM machines made auth.uid() disappear
-- together with the missing row and detailing_balances.updated_by became NULL.
CREATE OR REPLACE FUNCTION public.detailing_system_actor(p_machine_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.uid(),
    (
      SELECT COALESCE(machine.archived_by, machine.created_by)
      FROM public.machines machine
      WHERE machine.id = p_machine_id
    )
  );
$$;

REVOKE ALL ON FUNCTION public.detailing_system_actor(uuid) FROM PUBLIC, anon, authenticated;
