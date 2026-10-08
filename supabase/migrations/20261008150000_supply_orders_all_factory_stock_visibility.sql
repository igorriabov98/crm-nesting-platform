-- Submitted stock demand is part of the supply queue, regardless of the
-- requester's factory. Keep draft/approval visibility and write permissions
-- under their existing, narrower checks.
BEGIN;

CREATE OR REPLACE FUNCTION private.stock_request_row_visible(
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
    );
$$;

-- The supply department needs view rights for both its head and members.
-- Existing manage rights and factory restrictions on writes stay intact.
WITH target AS (
  SELECT department.id AS department_id, scope.subject_scope
  FROM public.departments AS department
  CROSS JOIN (VALUES ('head'), ('member')) AS scope(subject_scope)
  WHERE department.name = 'Снабжение' AND department.is_active IS TRUE
), previous AS (
  SELECT target.department_id, target.subject_scope,
    permission.id, permission.can_view, permission.can_manage,
    permission.factory_scope, permission.company_view_scope,
    permission.company_manage_scope
  FROM target
  LEFT JOIN public.department_access_permissions AS permission
    ON permission.department_id = target.department_id
   AND permission.subject_scope = target.subject_scope
   AND permission.resource_key = 'supply_orders'
)
INSERT INTO public.department_access_audit_log (
  department_id, subject_scope, resource_key,
  old_can_view, old_can_manage, new_can_view, new_can_manage,
  old_factory_scope, new_factory_scope,
  old_company_view_scope, new_company_view_scope,
  old_company_manage_scope, new_company_manage_scope
)
SELECT department_id, subject_scope, 'supply_orders',
  COALESCE(can_view, false), COALESCE(can_manage, false), true, COALESCE(can_manage, false),
  COALESCE(factory_scope, 'own'), COALESCE(factory_scope, 'own'),
  COALESCE(company_view_scope, 'own'), COALESCE(company_view_scope, 'own'),
  COALESCE(company_manage_scope, 'own'), COALESCE(company_manage_scope, 'own')
FROM previous
WHERE id IS NULL OR can_view IS DISTINCT FROM true;

INSERT INTO public.department_access_permissions (
  department_id, subject_scope, resource_key, can_view, can_manage
)
SELECT department.id, scope.subject_scope, 'supply_orders', true, false
FROM public.departments AS department
CROSS JOIN (VALUES ('head'), ('member')) AS scope(subject_scope)
WHERE department.name = 'Снабжение' AND department.is_active IS TRUE
ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE SET
  can_view = true
WHERE public.department_access_permissions.can_view IS DISTINCT FROM true;

COMMIT;
