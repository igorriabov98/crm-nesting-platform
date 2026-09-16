-- Keep the pre-cutover matrix writer compatible with every resource that
-- already exposes the own/all factory selector in the application.
--
-- This migration intentionally precedes the atomic RLS cutover. The
-- application release can therefore save the expanded matrix through its
-- compatibility path without tripping the older two-resource constraints.
BEGIN;

ALTER TABLE public.department_access_permissions
  DROP CONSTRAINT IF EXISTS department_access_permissions_factory_scope_check;

ALTER TABLE public.department_access_permissions
  ADD CONSTRAINT department_access_permissions_factory_scope_check
  CHECK (
    factory_scope IN ('own', 'all')
    AND (
      factory_scope = 'own'
      OR resource_key IN (
        'production_reports',
        'customs_clearance',
        'production_fact',
        'production_cutting_area'
      )
    )
  );

ALTER TABLE public.department_access_audit_log
  DROP CONSTRAINT IF EXISTS department_access_audit_log_old_factory_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_audit_log_new_factory_scope_check;

ALTER TABLE public.department_access_audit_log
  ADD CONSTRAINT department_access_audit_log_old_factory_scope_check
    CHECK (
      old_factory_scope IS NULL
      OR (
        old_factory_scope IN ('own', 'all')
        AND (
          old_factory_scope = 'own'
          OR resource_key IN (
            'production_reports',
            'customs_clearance',
            'production_fact',
            'production_cutting_area'
          )
        )
      )
    ),
  ADD CONSTRAINT department_access_audit_log_new_factory_scope_check
    CHECK (
      new_factory_scope IN ('own', 'all')
      AND (
        new_factory_scope = 'own'
        OR resource_key IN (
          'production_reports',
          'customs_clearance',
          'production_fact',
          'production_cutting_area'
        )
      )
    );

COMMIT;
