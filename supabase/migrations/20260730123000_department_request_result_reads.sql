alter table public.department_requests
  add column if not exists result_viewed_at timestamptz;

comment on column public.department_requests.result_viewed_at is
  'When the request author last acknowledged a completed or rejected result';

-- Existing terminal requests predate result-read tracking and must not appear as new.
update public.department_requests
set result_viewed_at = coalesce(completed_at, updated_at, created_at, now())
where status in ('done', 'rejected')
  and result_viewed_at is null;

create index if not exists department_requests_unread_result_idx
  on public.department_requests (created_by, status)
  where status in ('done', 'rejected')
    and result_viewed_at is null;

create or replace function public.reset_department_request_result_read()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.result_viewed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.reset_department_request_result_read()
  from public, anon, authenticated;

drop trigger if exists reset_department_request_result_read_before_status
  on public.department_requests;

create trigger reset_department_request_result_read_before_status
before update of status on public.department_requests
for each row execute function public.reset_department_request_result_read();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'department_requests'
  ) then
    alter publication supabase_realtime add table public.department_requests;
  end if;
end;
$$;
