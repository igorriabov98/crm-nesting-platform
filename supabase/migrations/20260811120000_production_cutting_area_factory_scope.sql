-- Configurable factory coverage for department access rows.
-- Existing rows deliberately remain limited to the user's own factory.

alter table public.department_access_permissions
  add column if not exists factory_scope text not null default 'own';

alter table public.department_access_permissions
  drop constraint if exists department_access_permissions_factory_scope_check;

alter table public.department_access_permissions
  add constraint department_access_permissions_factory_scope_check
  check (
    factory_scope in ('own', 'all')
    and (factory_scope = 'own' or resource_key = 'production_cutting_area')
  );

alter table public.department_access_audit_log
  add column if not exists old_factory_scope text,
  add column if not exists new_factory_scope text not null default 'own';

alter table public.department_access_audit_log
  drop constraint if exists department_access_audit_log_old_factory_scope_check,
  drop constraint if exists department_access_audit_log_new_factory_scope_check;

alter table public.department_access_audit_log
  add constraint department_access_audit_log_old_factory_scope_check
    check (
      old_factory_scope is null
      or (
        old_factory_scope in ('own', 'all')
        and (old_factory_scope = 'own' or resource_key = 'production_cutting_area')
      )
    ),
  add constraint department_access_audit_log_new_factory_scope_check
    check (
      new_factory_scope in ('own', 'all')
      and (new_factory_scope = 'own' or resource_key = 'production_cutting_area')
    );

comment on column public.department_access_permissions.factory_scope is
  'Factory coverage for resources that support it: own factory or all factories.';

comment on column public.department_access_audit_log.old_factory_scope is
  'Factory coverage before the audited access change.';

comment on column public.department_access_audit_log.new_factory_scope is
  'Factory coverage after the audited access change.';
