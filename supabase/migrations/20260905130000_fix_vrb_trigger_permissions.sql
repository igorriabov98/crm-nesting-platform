-- VRB synchronization is intentionally not executable by authenticated users.
-- Run the trigger-only wrappers with the migration owner's privileges so normal
-- RLS-authorized table writes can invoke the protected synchronization routine.

ALTER FUNCTION public.vrb_machine_change_trigger()
  SECURITY DEFINER;
ALTER FUNCTION public.vrb_machine_change_trigger()
  SET search_path = '';

ALTER FUNCTION public.vrb_operation_dispatch_trigger()
  SECURITY DEFINER;
ALTER FUNCTION public.vrb_operation_dispatch_trigger()
  SET search_path = '';

ALTER FUNCTION public.vrb_transport_trip_status_trigger()
  SECURITY DEFINER;
ALTER FUNCTION public.vrb_transport_trip_status_trigger()
  SET search_path = '';

-- Keep the wrappers trigger-only and the underlying sync service-role-only.
REVOKE ALL ON FUNCTION public.vrb_machine_change_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vrb_operation_dispatch_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vrb_transport_trip_status_trigger()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_vrb_mesh_for_machine(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_vrb_mesh_for_machine(uuid)
  TO service_role;
