BEGIN;

SELECT pg_advisory_xact_lock(hashtextextended('crm-users-self-visibility', 0));
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

-- The matrix cutover accidentally wrapped every users SELECT path in the
-- departments/admin_users permission gate. Keep the matrix-controlled full
-- directory access, while preserving the legacy self and same-factory paths
-- required to hydrate an authenticated user's own CRM profile.
DROP POLICY IF EXISTS "users_select" ON public.users;
CREATE POLICY "users_select" ON public.users
FOR SELECT TO authenticated
USING (
  private.crm_has_permission('departments', 'view')
  OR private.crm_has_permission('admin_users', 'view')
  OR id = auth.uid()
  OR (
    factory_id IS NOT NULL
    AND factory_id = public.get_user_factory_id()
  )
);

COMMIT;
