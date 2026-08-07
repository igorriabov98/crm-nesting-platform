begin;

do $$
declare
  v_definition text;
begin
  if to_regclass('public.machine_cutting_archives') is null then
    raise exception 'machine_cutting_archives table is missing';
  end if;

  if (select count(*) from pg_constraint
      where conrelid = 'public.machine_cutting_archives'::regclass and contype = 'f') < 5 then
    raise exception 'machine_cutting_archives foreign keys are incomplete';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.machine_cutting_archives'::regclass
      and tgname = 'machine_cutting_archives_guard_trigger' and not tgisinternal
  ) then
    raise exception 'immutable history trigger is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.machine_cutting_archives'::regclass
      and tgname = 'file_archive_machine_cutting_register' and not tgisinternal
  ) then
    raise exception 'file archive registration trigger is missing';
  end if;

  select pg_get_functiondef('public.file_archive_build_preview(uuid)'::regprocedure) into v_definition;
  if v_definition not like '%machine_cutting_archive%' or v_definition not like '%nesting_output%' then
    raise exception 'cutting archive is missing from backfill preview';
  end if;

  if has_table_privilege('authenticated', 'public.machine_cutting_archives', 'SELECT')
    or has_table_privilege('authenticated', 'public.machine_cutting_archives', 'INSERT') then
    raise exception 'authenticated must not access cutting archives directly';
  end if;

  if exists (
    select 1 from public.role_permissions nesting
    left join public.role_permissions cutting
      on cutting.role = nesting.role and cutting.resource_key = 'machine_cutting'
    where nesting.resource_key = 'nesting'
      and (cutting.role is null or cutting.can_view is distinct from nesting.can_view
        or cutting.can_manage is distinct from nesting.can_manage)
  ) then
    raise exception 'role permission inheritance from nesting is incomplete';
  end if;

  if exists (
    select 1 from public.department_access_permissions nesting
    left join public.department_access_permissions cutting
      on cutting.department_id = nesting.department_id
      and cutting.subject_scope = nesting.subject_scope
      and cutting.resource_key = 'machine_cutting'
    where nesting.resource_key = 'nesting'
      and (cutting.id is null or cutting.can_view is distinct from nesting.can_view
        or cutting.can_manage is distinct from nesting.can_manage)
  ) then
    raise exception 'department scope inheritance from nesting is incomplete';
  end if;
end;
$$;

rollback;
