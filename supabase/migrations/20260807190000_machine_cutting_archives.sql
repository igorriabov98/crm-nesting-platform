-- Immutable plasma-cutting archives linked to the finalized technologist request.

create table public.machine_cutting_archives (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete restrict,
  request_id uuid not null references public.technologist_requests(id) on delete restrict,
  completion_id uuid not null references public.technologist_request_completions(id) on delete restrict,
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 240),
  storage_path text not null unique check (btrim(storage_path) <> ''),
  mime_type text,
  file_size bigint not null check (file_size > 0 and file_size <= 524288000),
  uploaded_by uuid not null references public.users(id) on delete restrict,
  uploaded_at timestamptz not null default now()
);

create index machine_cutting_archives_machine_uploaded_idx
  on public.machine_cutting_archives (machine_id, uploaded_at desc);

create index machine_cutting_archives_completion_idx
  on public.machine_cutting_archives (completion_id);

alter table public.machine_cutting_archives enable row level security;
revoke all on table public.machine_cutting_archives from public, anon, authenticated;
grant all on table public.machine_cutting_archives to service_role;

create or replace function public.machine_cutting_archives_guard()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_completion public.technologist_request_completions%rowtype;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'Machine cutting archive history is immutable';
  end if;

  select * into v_completion
  from public.technologist_request_completions
  where id = new.completion_id and state = 'finalized';

  if not found then
    raise exception 'Finalized technologist completion was not found';
  end if;
  if v_completion.machine_id is distinct from new.machine_id
    or v_completion.request_id is distinct from new.request_id then
    raise exception 'Machine cutting archive relations do not match completion';
  end if;

  return new;
end;
$$;

revoke all on function public.machine_cutting_archives_guard() from public, anon, authenticated;

create trigger machine_cutting_archives_guard_trigger
before insert or update or delete on public.machine_cutting_archives
for each row execute function public.machine_cutting_archives_guard();

-- Reuse the existing nesting output retention policy. Each row is registered
-- automatically and can later be resolved from Supabase Storage or Google Drive.
create or replace function public.file_archive_register_machine_cutting()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
begin
  select name into v_label from public.machines where id = new.machine_id;
  perform public.file_archive_register_asset(
    'nesting_output',
    'machine_cutting_archive',
    new.id,
    null,
    'nesting-files',
    new.storage_path,
    new.file_name,
    new.mime_type,
    new.file_size,
    new.uploaded_at,
    new.machine_id,
    coalesce(v_label, 'Порезка на плазме')
  );
  return new;
end;
$$;

revoke all on function public.file_archive_register_machine_cutting() from public, anon, authenticated;

create trigger file_archive_machine_cutting_register
after insert on public.machine_cutting_archives
for each row execute function public.file_archive_register_machine_cutting();

-- Include pre-existing cutting archives in the normal preview/confirmation
-- backfill without changing the current archive lifecycle.
create or replace function public.file_archive_build_preview(p_created_by uuid)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid := gen_random_uuid();
begin
  insert into public.file_archive_runs (id, kind, status, cutoff_at, created_by)
  values (v_run_id, 'backfill', 'preview', now(), p_created_by);

  insert into public.file_archive_run_items (
    run_id, policy_key, source_kind, source_record_id, source_attachment_id,
    bucket_id, object_path, file_name, mime_type, size_bytes, source_created_at,
    machine_id, object_label, category, production_month_snapshot, machine_name_snapshot
  )
  select v_run_id, candidate.policy_key, candidate.source_kind, candidate.source_record_id,
    candidate.source_attachment_id, candidate.bucket_id, candidate.object_path,
    candidate.file_name, candidate.mime_type, candidate.size_bytes,
    candidate.source_created_at, candidate.machine_id, candidate.object_label,
    policy.category, machine.production_month, machine.name
  from (
    select 'product_' || file.file_kind as policy_key, 'product_file' as source_kind,
      file.id as source_record_id, null::text as source_attachment_id,
      'product-files' as bucket_id, file.file_path as object_path, file.file_name,
      file.mime_type, coalesce(file.file_size, 0) as size_bytes, file.created_at as source_created_at,
      null::uuid as machine_id, coalesce(product.drawing_number, product.name_uk, product.id::text) as object_label
    from public.product_files file join public.products product on product.id = file.product_id
    union all
    select 'project_' || file.file_kind, 'product_project_file', file.id, null::text,
      'product-files', file.file_path, file.file_name, file.mime_type, coalesce(file.file_size, 0),
      file.created_at, null::uuid, coalesce(project.title, project.id::text)
    from public.product_project_files file join public.product_projects project on project.id = file.project_id
    union all
    select 'production_drawing', 'product_production_drawing', drawing.id, null::text,
      'product-production-drawings', drawing.file_path, drawing.file_name, drawing.mime_type,
      drawing.file_size, drawing.created_at, null::uuid,
      coalesce(version.drawing_number, product.name_uk, product.id::text)
    from public.product_production_drawings drawing
    join public.product_versions version on version.id = drawing.product_version_id
    join public.products product on product.id = version.product_id
    union all
    select 'machine_layout', 'machine_layout', layout.id, null::text,
      'product-files', layout.pdf_file_path, coalesce(layout.pdf_file_name, 'layout.pdf'),
      layout.pdf_mime_type, coalesce(layout.pdf_file_size, 0),
      coalesce(layout.uploaded_at, layout.created_at), layout.machine_id, 'Расстановка машины'
    from public.machine_layout_requests layout where layout.pdf_file_path is not null
    union all
    select 'nesting_output', 'machine_cutting_archive', cutting.id, null::text,
      'nesting-files', cutting.storage_path, cutting.file_name, cutting.mime_type,
      cutting.file_size, cutting.uploaded_at, cutting.machine_id, 'Порезка на плазме'
    from public.machine_cutting_archives cutting
    union all
    select 'department_request_' || attachment.phase, 'department_request_attachment', attachment.id, null::text,
      'department-request-files', attachment.storage_path, attachment.file_name, attachment.mime_type,
      attachment.file_size, attachment.created_at, request.machine_id, coalesce(request.title, request.id::text)
    from public.department_request_attachments attachment
    join public.department_requests request on request.id = attachment.request_id
    union all
    select 'mail_attachment', 'mail_attachment', attachment.id, null::text,
      'mail-project-attachments', attachment.storage_path, attachment.file_name, attachment.mime_type,
      attachment.size_bytes, coalesce(attachment.cached_at, attachment.created_at), null::uuid, attachment.file_name
    from public.mail_attachments attachment where attachment.storage_path is not null
    union all
    select 'machine_chat', 'machine_chat_attachment', message.id, item->>'id',
      'product-files', item->>'path', coalesce(item->>'fileName', 'chat-file'), item->>'mimeType',
      coalesce((item->>'fileSize')::bigint, 0), message.created_at, message.machine_id, 'Чат машины'
    from public.machine_chat_messages message
    cross join lateral jsonb_array_elements(public.file_archive_chat_attachments(message.body)) item
  ) candidate
  join public.file_archive_policies policy on policy.key = candidate.policy_key and policy.enabled
  left join public.machines machine on machine.id = candidate.machine_id
  left join public.file_archive_assets asset
    on asset.bucket_id = candidate.bucket_id and asset.object_path = candidate.object_path
  where (asset.id is null or (asset.state = 'local' and not asset.auto_archive_eligible))
    and candidate.object_path is not null
    and candidate.source_created_at <= now() - make_interval(days => policy.retention_days);

  update public.file_archive_runs run set
    item_count = summary.item_count,
    total_bytes = summary.total_bytes,
    missing_relation_count = summary.missing_relation_count,
    preview_hash = summary.preview_hash,
    machine_count = (
      select count(distinct machine_id)::integer from public.file_archive_run_items where run_id = v_run_id
    ),
    category_summary = (
      select coalesce(jsonb_agg(jsonb_build_object(
        'category', grouped.category, 'count', grouped.item_count, 'bytes', grouped.total_bytes
      ) order by grouped.total_bytes desc), '[]'::jsonb)
      from (
        select category, count(*)::integer as item_count, coalesce(sum(size_bytes), 0)::bigint as total_bytes
        from public.file_archive_run_items where run_id = v_run_id group by category
      ) grouped
    )
  from (
    select count(*)::integer as item_count, coalesce(sum(size_bytes), 0)::bigint as total_bytes,
      count(*) filter (where machine_id is null)::integer as missing_relation_count,
      md5(coalesce(string_agg(bucket_id || '/' || object_path, '|' order by bucket_id, object_path), '')) as preview_hash
    from public.file_archive_run_items where run_id = v_run_id
  ) summary
  where run.id = v_run_id;

  return v_run_id;
end;
$$;

-- Preserve the exact current nesting matrix for each role and each department
-- scope. Later edits to either resource remain independent.
insert into public.role_permissions (role, resource_key, can_view, can_manage)
select role, 'machine_cutting', can_view, can_manage
from public.role_permissions
where resource_key = 'nesting'
on conflict (role, resource_key) do nothing;

with scopes as (
  select department.id as department_id, scope.subject_scope
  from public.departments department
  cross join (values ('head'::text), ('member'::text)) as scope(subject_scope)
), nesting_access as (
  select department_id, subject_scope, can_view, can_manage
  from public.department_access_permissions
  where resource_key = 'nesting'
)
insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage)
select scopes.department_id, scopes.subject_scope, 'machine_cutting',
  coalesce(nesting_access.can_view, false), coalesce(nesting_access.can_manage, false)
from scopes
left join nesting_access using (department_id, subject_scope)
on conflict (department_id, subject_scope, resource_key) do nothing;
