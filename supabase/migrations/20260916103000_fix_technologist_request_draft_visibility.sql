BEGIN;

-- A user can legitimately combine technologist and supply permissions (for
-- example, CRM administrators). Supply visibility must not cancel the user's
-- own technologist access to pre-approval drafts. Supply-only users still see
-- requests only after the financial approval lifecycle reaches supply.
CREATE OR REPLACE FUNCTION public.fn_financial_supply_visibility(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.technologist_requests AS request
      WHERE request.id = p_request_id
        AND request.status IN ('submitted_to_supply', 'completed')
    )
    OR EXISTS (
      SELECT 1
      FROM public.technologist_requests AS request
      WHERE request.id = p_request_id
        AND request.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.technologist_requests AS request
      JOIN public.tasks AS task ON task.machine_id = request.machine_id
      WHERE request.id = p_request_id
        AND task.assigned_to = auth.uid()
        AND task.task_type = 'technologist_request'
        AND task.status IN ('pending', 'in_progress', 'completed')
    )
    OR private.crm_has_permission('technologist_requests', 'manage');
$function$;

REVOKE ALL ON FUNCTION public.fn_financial_supply_visibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_financial_supply_visibility(uuid) TO authenticated, service_role;

COMMIT;
