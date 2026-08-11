begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'department_access_permissions'
      and column_name = 'factory_scope'
      and column_default like '%own%'
      and is_nullable = 'NO'
  ) then
    raise exception 'department factory scope with own default is missing';
  end if;

  if exists (
    select 1
    from public.department_access_permissions
    where factory_scope not in ('own', 'all')
  ) then
    raise exception 'unknown department factory scope is stored';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'department_access_audit_log'
      and column_name = 'old_factory_scope'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'department_access_audit_log'
      and column_name = 'new_factory_scope'
  ) then
    raise exception 'factory scope audit columns are missing';
  end if;
end;
$$;

rollback;
