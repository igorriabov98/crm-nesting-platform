-- Fill the single resource that was added to the application registry after the
-- department matrix was first seeded. Existing department decisions are never
-- overwritten. Legacy role tables and users.role remain unchanged.
WITH subject_scopes(subject_scope) AS (
  VALUES ('head'::text), ('member'::text)
),
department_scopes AS (
  SELECT department.id AS department_id, scope.subject_scope
  FROM public.departments AS department
  CROSS JOIN subject_scopes AS scope
),
current_effective_access AS (
  SELECT
    member.department_id,
    CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END AS subject_scope,
    bool_or(
      app_user.role IN (
        'technologist'::public.user_role,
        'financial_director'::public.user_role,
        'commercial_director'::public.user_role,
        'planning_director'::public.user_role
      )
    ) AS allowed
  FROM public.department_members AS member
  JOIN public.users AS app_user
    ON app_user.id = member.user_id
   AND COALESCE(app_user.is_active, true) = true
  GROUP BY
    member.department_id,
    CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END
)
INSERT INTO public.department_access_permissions (
  department_id,
  subject_scope,
  resource_key,
  can_view,
  can_manage
)
SELECT
  scope.department_id,
  scope.subject_scope,
  'business_scrap_reservations',
  COALESCE(effective.allowed, false),
  COALESCE(effective.allowed, false)
FROM department_scopes AS scope
LEFT JOIN current_effective_access AS effective
  ON effective.department_id = scope.department_id
 AND effective.subject_scope = scope.subject_scope
ON CONFLICT (department_id, subject_scope, resource_key) DO NOTHING;
