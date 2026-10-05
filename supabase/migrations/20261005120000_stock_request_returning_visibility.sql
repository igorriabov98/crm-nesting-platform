-- INSERT ... RETURNING checks SELECT policies before the new row can be found
-- by a same-table lookup. Evaluate the proposed row's fields directly.
CREATE FUNCTION private.stock_request_row_visible(
  p_request_id uuid,
  p_request_kind text,
  p_factory_id uuid,
  p_created_by uuid,
  p_status text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_request_kind <> 'stock'
    OR public.crm_user_is_admin(auth.uid())
    OR (
      private.crm_has_permission('technologist_requests', 'view')
      AND private.crm_has_factory_permission('technologist_requests', 'view', p_factory_id)
      AND (p_created_by = auth.uid() OR EXISTS (
        SELECT 1 FROM public.tasks task
        JOIN public.technologist_request_approval_versions version
          ON version.id = task.technologist_request_approval_id
        WHERE version.request_id = p_request_id
          AND task.task_type = 'technologist_request_revision'
          AND task.assigned_to = auth.uid()
          AND task.status IN ('pending', 'in_progress')
      ))
    )
    OR (
      p_status = 'pending_financial_approval'
      AND private.crm_has_permission('technologist_request_results', 'view')
      AND auth.uid() = public.fn_technologist_approval_department_head('Финансовый отдел')
    )
    OR (
      p_status IN ('submitted_to_supply', 'completed')
      AND private.crm_has_permission('supply_orders', 'view')
      AND private.crm_has_factory_permission('supply_orders', 'view', p_factory_id)
    );
$$;
REVOKE ALL ON FUNCTION private.stock_request_row_visible(uuid,text,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.stock_request_row_visible(uuid,text,uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.stock_request_visible(p_request_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT private.stock_request_row_visible(
      request.id, request.request_kind, request.factory_id,
      request.created_by, request.status::text
    )
    FROM public.technologist_requests request WHERE request.id = p_request_id
  ), false);
$$;

DROP POLICY stock_request_select_visibility ON public.technologist_requests;
CREATE POLICY stock_request_select_visibility ON public.technologist_requests
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (private.stock_request_row_visible(
    id, request_kind, factory_id, created_by, status::text
  ));
