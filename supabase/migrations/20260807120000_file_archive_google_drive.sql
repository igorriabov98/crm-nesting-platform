-- Provider-aware file registry and Google Drive archive control plane.
-- All policies start disabled. Historical objects are discovered only by an
-- explicit preview and become movable only after a separate confirmation.

create table public.file_archive_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'google_drive' check (provider = 'google_drive'),
  email text not null,
  display_name text,
  status text not null default 'active' check (status in ('active', 'read_only', 'error')),
  access_token_vault_id uuid,
  refresh_token_vault_id uuid not null,
  token_expires_at timestamptz,
  root_folder_id text,
  root_folder_name text not null default 'CRM Archive',
  last_verified_at timestamptz,
  last_error text,
  connected_by uuid references public.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index file_archive_one_active_connection
  on public.file_archive_connections ((status)) where status = 'active';

create table public.file_archive_policies (
  key text primary key,
  label text not null,
  category text not null,
  enabled boolean not null default false,
  enabled_at timestamptz,
  retention_days integer not null default 60 check (retention_days between 1 and 3650),
  local_grace_days integer not null default 7 check (local_grace_days between 1 and 90),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint file_archive_policy_enabled_at check (not enabled or enabled_at is not null)
);

insert into public.file_archive_policies (key, label, category) values
  ('product_drawing', 'Продуктовые чертежи', 'Чертежи продукции'),
  ('product_step', 'Продуктовые STEP', 'STEP продукции'),
  ('product_pdf', 'Продуктовые PDF', 'PDF продукции'),
  ('product_photo', 'Фото продукции', 'Фото продукции'),
  ('product_other', 'Другие файлы продукции', 'Другие файлы продукции'),
  ('project_drawing', 'Чертежи проектов изделий', 'Чертежи проектов'),
  ('project_step', 'STEP проектов изделий', 'STEP проектов'),
  ('project_pdf', 'PDF проектов изделий', 'PDF проектов'),
  ('project_photo', 'Фото проектов изделий', 'Фото проектов'),
  ('project_other', 'Другие файлы проектов', 'Другие файлы проектов'),
  ('production_drawing', 'Производственные чертежи', 'Производственные чертежи'),
  ('machine_layout', 'Расстановки машин', 'Расстановка машин'),
  ('machine_chat', 'Вложения чата машин', 'Чат'),
  ('department_request_source', 'Исходные файлы заявок', 'Заявки'),
  ('department_request_resolution', 'Результаты заявок', 'Результаты заявок'),
  ('mail_attachment', 'Вложения почты', 'Почта'),
  ('nesting_input', 'Входные файлы раскладки', 'Входные файлы раскладки'),
  ('nesting_output', 'DXF, PDF и ZIP раскладки', 'Программы под порезку')
on conflict (key) do nothing;

create table public.file_archive_settings (
  id boolean primary key default true check (id),
  global_enabled boolean not null default false,
  enabled_at timestamptz,
  disabled_at timestamptz,
  changed_by uuid references public.users(id) on delete set null,
  last_test_status text check (last_test_status is null or last_test_status in ('passed', 'failed')),
  last_test_at timestamptz,
  last_test_duration_ms integer check (last_test_duration_ms is null or last_test_duration_ms >= 0),
  last_test_connection_email text,
  last_test_error text,
  last_tested_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.file_archive_settings (id, global_enabled)
values (true, false)
on conflict (id) do nothing;

create table public.file_archive_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('automatic', 'backfill')),
  status text not null check (status in ('preview', 'queued', 'running', 'completed', 'failed')),
  cutoff_at timestamptz not null,
  item_count integer not null default 0,
  total_bytes bigint not null default 0,
  missing_relation_count integer not null default 0,
  machine_count integer not null default 0,
  category_summary jsonb not null default '[]'::jsonb,
  preview_hash text,
  error text,
  created_by uuid references public.users(id) on delete set null,
  confirmed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz
);

create table public.file_archive_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.file_archive_runs(id) on delete restrict,
  policy_key text not null references public.file_archive_policies(key) on delete restrict,
  source_kind text not null,
  source_record_id uuid,
  source_attachment_id text,
  bucket_id text not null,
  object_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  source_created_at timestamptz not null,
  machine_id uuid references public.machines(id) on delete set null,
  object_label text,
  category text not null,
  production_month_snapshot date,
  machine_name_snapshot text,
  unique (run_id, bucket_id, object_path)
);

create table public.file_archive_assets (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null references public.file_archive_policies(key) on delete restrict,
  source_kind text not null,
  source_record_id uuid,
  source_attachment_id text,
  bucket_id text not null,
  object_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  checksum text,
  source_created_at timestamptz not null,
  machine_id uuid references public.machines(id) on delete set null,
  object_label text,
  category text not null,
  auto_archive_eligible boolean not null default false,
  state text not null default 'local'
    check (state in ('local', 'queued', 'copying', 'pending_delete', 'archived', 'failed')),
  archive_run_id uuid references public.file_archive_runs(id) on delete set null,
  drive_connection_id uuid references public.file_archive_connections(id) on delete restrict,
  drive_file_id text,
  drive_folder_id text,
  drive_md5_checksum text,
  drive_size_bytes bigint,
  archived_path text,
  copied_at timestamptz,
  delete_after timestamptz,
  source_deleted_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path),
  constraint file_archive_drive_location_complete check (
    state in ('local', 'queued', 'copying', 'failed')
    or (drive_connection_id is not null and drive_file_id is not null)
  ),
  constraint file_archive_delete_schedule check (
    state not in ('pending_delete', 'archived') or copied_at is not null
  )
);

create index file_archive_assets_scan_idx
  on public.file_archive_assets (state, auto_archive_eligible, source_created_at);
create index file_archive_assets_delete_idx
  on public.file_archive_assets (delete_after) where state = 'pending_delete';
create index file_archive_assets_source_idx
  on public.file_archive_assets (source_kind, source_record_id, source_attachment_id);
create index file_archive_assets_connection_idx
  on public.file_archive_assets (drive_connection_id) where drive_connection_id is not null;

create table public.file_archive_folders (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.file_archive_connections(id) on delete restrict,
  parent_folder_id text,
  folder_key text not null,
  folder_name text not null,
  drive_folder_id text not null,
  created_at timestamptz not null default now(),
  unique (connection_id, folder_key),
  unique (connection_id, drive_folder_id)
);

alter table public.file_archive_connections enable row level security;
alter table public.file_archive_policies enable row level security;
alter table public.file_archive_settings enable row level security;
alter table public.file_archive_runs enable row level security;
alter table public.file_archive_run_items enable row level security;
alter table public.file_archive_assets enable row level security;
alter table public.file_archive_folders enable row level security;

revoke all on table public.file_archive_connections from public, anon, authenticated;
revoke all on table public.file_archive_policies from public, anon, authenticated;
revoke all on table public.file_archive_settings from public, anon, authenticated;
revoke all on table public.file_archive_runs from public, anon, authenticated;
revoke all on table public.file_archive_run_items from public, anon, authenticated;
revoke all on table public.file_archive_assets from public, anon, authenticated;
revoke all on table public.file_archive_folders from public, anon, authenticated;
grant all on table public.file_archive_connections to service_role;
grant all on table public.file_archive_policies to service_role;
grant all on table public.file_archive_settings to service_role;
grant all on table public.file_archive_runs to service_role;
grant all on table public.file_archive_run_items to service_role;
grant all on table public.file_archive_assets to service_role;
grant all on table public.file_archive_folders to service_role;

create or replace function public.file_archive_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger file_archive_connections_touch
before update on public.file_archive_connections for each row
execute function public.file_archive_touch_updated_at();
create trigger file_archive_policies_touch
before update on public.file_archive_policies for each row
execute function public.file_archive_touch_updated_at();
create trigger file_archive_settings_touch
before update on public.file_archive_settings for each row
execute function public.file_archive_touch_updated_at();
create trigger file_archive_assets_touch
before update on public.file_archive_assets for each row
execute function public.file_archive_touch_updated_at();

create or replace function public.file_archive_register_asset(
  p_policy_key text,
  p_source_kind text,
  p_source_record_id uuid,
  p_source_attachment_id text,
  p_bucket_id text,
  p_object_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_source_created_at timestamptz,
  p_machine_id uuid,
  p_object_label text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_policy public.file_archive_policies%rowtype;
  v_id uuid;
begin
  if p_object_path is null or btrim(p_object_path) = '' then return null; end if;
  select * into strict v_policy from public.file_archive_policies where key = p_policy_key;
  insert into public.file_archive_assets (
    policy_key, source_kind, source_record_id, source_attachment_id,
    bucket_id, object_path, file_name, mime_type, size_bytes,
    source_created_at, machine_id, object_label, category, auto_archive_eligible
  ) values (
    p_policy_key, p_source_kind, p_source_record_id, p_source_attachment_id,
    p_bucket_id, p_object_path, coalesce(nullif(btrim(p_file_name), ''), 'file'),
    p_mime_type, greatest(coalesce(p_size_bytes, 0), 0), p_source_created_at,
    p_machine_id, p_object_label, v_policy.category,
    v_policy.enabled and p_source_created_at >= v_policy.enabled_at
  )
  on conflict (bucket_id, object_path) do update set
    source_record_id = excluded.source_record_id,
    source_attachment_id = excluded.source_attachment_id,
    file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    machine_id = excluded.machine_id,
    object_label = excluded.object_label
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.file_archive_register_row()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_policy text;
  v_machine_id uuid;
  v_label text;
  v_item jsonb;
  v_payload text;
begin
  if tg_table_name = 'product_files' then
    v_policy := 'product_' || new.file_kind;
    select coalesce(drawing_number, name_uk, id::text) into v_label from public.products where id = new.product_id;
    perform public.file_archive_register_asset(v_policy, 'product_file', new.id, null,
      'product-files', new.file_path, new.file_name, new.mime_type, new.file_size,
      new.created_at, null, v_label);
  elsif tg_table_name = 'product_project_files' then
    v_policy := 'project_' || new.file_kind;
    select coalesce(title, id::text) into v_label from public.product_projects where id = new.project_id;
    perform public.file_archive_register_asset(v_policy, 'product_project_file', new.id, null,
      'product-files', new.file_path, new.file_name, new.mime_type, new.file_size,
      new.created_at, null, v_label);
  elsif tg_table_name = 'product_production_drawings' then
    select coalesce(pv.drawing_number, p.name_uk, p.id::text) into v_label
      from public.product_versions pv join public.products p on p.id = pv.product_id
      where pv.id = new.product_version_id;
    perform public.file_archive_register_asset('production_drawing', 'product_production_drawing', new.id, null,
      'product-production-drawings', new.file_path, new.file_name, new.mime_type, new.file_size,
      new.created_at, null, v_label);
  elsif tg_table_name = 'department_request_attachments' then
    select machine_id, coalesce(title, id::text) into v_machine_id, v_label
      from public.department_requests where id = new.request_id;
    perform public.file_archive_register_asset('department_request_' || new.phase, 'department_request_attachment', new.id, null,
      'department-request-files', new.storage_path, new.file_name, new.mime_type, new.file_size,
      new.created_at, v_machine_id, v_label);
  elsif tg_table_name = 'machine_layout_requests' then
    if new.pdf_file_path is not null and (tg_op = 'INSERT' or old.pdf_file_path is distinct from new.pdf_file_path) then
      select name into v_label from public.machines where id = new.machine_id;
      perform public.file_archive_register_asset('machine_layout', 'machine_layout', new.id, null,
        'product-files', new.pdf_file_path, coalesce(new.pdf_file_name, 'layout.pdf'), new.pdf_mime_type,
        new.pdf_file_size, coalesce(new.uploaded_at, new.created_at), new.machine_id, v_label);
    end if;
  elsif tg_table_name = 'mail_attachments' then
    if new.storage_path is not null and (tg_op = 'INSERT' or old.storage_path is distinct from new.storage_path) then
      perform public.file_archive_register_asset('mail_attachment', 'mail_attachment', new.id, null,
        'mail-project-attachments', new.storage_path, new.file_name, new.mime_type, new.size_bytes,
        coalesce(new.cached_at, new.created_at), null, new.file_name);
    end if;
  elsif tg_table_name = 'machine_chat_messages' then
    v_payload := substring(new.body from E'\\[\\[machine-chat-attachments:(.*)\\]\\]$');
    if v_payload is not null then
      begin
        for v_item in select * from jsonb_array_elements(v_payload::jsonb) loop
          perform public.file_archive_register_asset('machine_chat', 'machine_chat_attachment', new.id,
            v_item->>'id', 'product-files', v_item->>'path', v_item->>'fileName',
            v_item->>'mimeType', coalesce((v_item->>'fileSize')::bigint, 0), new.created_at,
            new.machine_id, 'Чат машины');
        end loop;
      exception when others then
        null;
      end;
    end if;
  end if;
  return new;
end;
$$;

create trigger file_archive_product_files_register
after insert on public.product_files for each row execute function public.file_archive_register_row();
create trigger file_archive_product_project_files_register
after insert on public.product_project_files for each row execute function public.file_archive_register_row();
create trigger file_archive_production_drawings_register
after insert on public.product_production_drawings for each row execute function public.file_archive_register_row();
create trigger file_archive_department_attachments_register
after insert on public.department_request_attachments for each row execute function public.file_archive_register_row();
create trigger file_archive_machine_layout_register
after insert or update of pdf_file_path on public.machine_layout_requests for each row execute function public.file_archive_register_row();
create trigger file_archive_mail_attachments_register
after insert or update of storage_path on public.mail_attachments for each row execute function public.file_archive_register_row();
create trigger file_archive_machine_chat_register
after insert on public.machine_chat_messages for each row execute function public.file_archive_register_row();

-- Freeze a snapshot of production metadata when the Drive path is chosen.
create or replace function public.file_archive_claim_copy_jobs(
  p_limit integer default 25,
  p_run_id uuid default null
)
returns setof public.file_archive_assets
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select asset.id
    from public.file_archive_assets asset
    join public.file_archive_policies policy on policy.key = asset.policy_key
    where asset.state in ('local', 'queued', 'failed')
      and asset.auto_archive_eligible
      and (policy.enabled or asset.archive_run_id is not null)
      and asset.source_created_at <= now() - make_interval(days => policy.retention_days)
      and (asset.state <> 'failed' or asset.attempt_count < 8)
    order by asset.source_created_at
    for update of asset skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.file_archive_assets asset
  set state = 'copying', attempt_count = attempt_count + 1, last_attempt_at = now(), last_error = null,
    archive_run_id = coalesce(asset.archive_run_id, p_run_id)
  from candidates where asset.id = candidates.id
  returning asset.*;
end;
$$;

create or replace function public.file_archive_claim_delete_jobs(p_limit integer default 100)
returns setof public.file_archive_assets
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select id from public.file_archive_assets
    where state = 'pending_delete' and delete_after <= now()
    order by delete_after for update skip locked
    limit least(greatest(p_limit, 1), 500)
  )
  update public.file_archive_assets asset
  set last_attempt_at = now(), attempt_count = attempt_count + 1
  from candidates where asset.id = candidates.id
  returning asset.*;
end;
$$;

create or replace function public.file_archive_chat_attachments(p_body text)
returns jsonb language plpgsql immutable
as $$
declare
  v_payload text;
begin
  v_payload := substring(p_body from E'\\[\\[machine-chat-attachments:(.*)\\]\\]$');
  if v_payload is null then return '[]'::jsonb; end if;
  return v_payload::jsonb;
exception when others then
  return '[]'::jsonb;
end;
$$;

create or replace function public.file_archive_activate_connection(
  p_id uuid,
  p_email text,
  p_display_name text,
  p_access_token_vault_id uuid,
  p_refresh_token_vault_id uuid,
  p_token_expires_at timestamptz,
  p_connected_by uuid
) returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if p_refresh_token_vault_id is null then raise exception 'Refresh token is required'; end if;
  update public.file_archive_connections set status = 'read_only', updated_at = now()
  where status = 'active';
  insert into public.file_archive_connections (
    id, email, display_name, status, access_token_vault_id, refresh_token_vault_id,
    token_expires_at, connected_by, last_verified_at
  ) values (
    p_id, p_email, p_display_name, 'active', p_access_token_vault_id,
    p_refresh_token_vault_id, p_token_expires_at, p_connected_by, now()
  );
  return p_id;
end;
$$;

create or replace function public.file_archive_manager_user_ids()
returns setof uuid language sql stable security definer
set search_path = public, pg_temp
as $$
  select app_user.id
  from public.users app_user
  where coalesce(app_user.is_active, true)
    and (
      exists (
        select 1 from public.department_members member
        join public.positions position on position.id = member.position_id
        where member.user_id = app_user.id and position.name = 'Администратор CRM'
      )
      or exists (
        select 1 from public.department_members member
        join public.department_access_permissions permission
          on permission.department_id = member.department_id
         and permission.subject_scope = case when member.is_department_head then 'head' else 'member' end
        where member.user_id = app_user.id
          and permission.resource_key = 'file_archive_settings'
          and permission.can_manage
      )
      or (
        not exists (
          select 1 from public.department_members member
          join public.department_access_permissions permission
            on permission.department_id = member.department_id
           and permission.subject_scope = case when member.is_department_head then 'head' else 'member' end
          where member.user_id = app_user.id
        )
        and exists (
          select 1 from public.role_permissions permission
          where permission.role = app_user.role
            and permission.resource_key = 'file_archive_settings'
            and permission.can_manage
        )
      )
    );
$$;

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

create or replace function public.file_archive_confirm_preview(p_run_id uuid, p_confirmed_by uuid)
returns integer language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.file_archive_runs
    where id = p_run_id and kind = 'backfill' and status = 'preview' and confirmed_at is null
  ) then
    raise exception 'Preview is not available for confirmation';
  end if;

  insert into public.file_archive_assets (
    policy_key, source_kind, source_record_id, source_attachment_id,
    bucket_id, object_path, file_name, mime_type, size_bytes, source_created_at,
    machine_id, object_label, category, auto_archive_eligible, state, archive_run_id
  )
  select item.policy_key, item.source_kind, item.source_record_id, item.source_attachment_id,
    item.bucket_id, item.object_path, item.file_name, item.mime_type, item.size_bytes,
    item.source_created_at, item.machine_id, item.object_label, item.category,
    true, 'queued', item.run_id
  from public.file_archive_run_items item where item.run_id = p_run_id
  on conflict (bucket_id, object_path) do update set
    auto_archive_eligible = true,
    archive_run_id = excluded.archive_run_id,
    state = case
      when public.file_archive_assets.state in ('local', 'failed') then 'queued'
      else public.file_archive_assets.state
    end,
    last_error = case
      when public.file_archive_assets.state in ('local', 'failed') then null
      else public.file_archive_assets.last_error
    end;
  get diagnostics v_count = row_count;

  update public.file_archive_runs set status = 'queued', confirmed_by = p_confirmed_by,
    confirmed_at = now() where id = p_run_id;
  return v_count;
end;
$$;

insert into public.role_permissions (role, resource_key, can_view, can_manage)
select role, 'file_archive_settings', true, true
from unnest(array[
  'financial_director'::public.user_role,
  'commercial_director'::public.user_role,
  'planning_director'::public.user_role
]) as roles(role)
on conflict (role, resource_key) do nothing;

with scopes as (
  select department.id as department_id, subject_scope
  from public.departments department
  cross join (values ('head'::text), ('member'::text)) as scope(subject_scope)
), effective as (
  select member.department_id,
    case when member.is_department_head then 'head' else 'member' end as subject_scope,
    bool_or(app_user.role in ('financial_director', 'commercial_director', 'planning_director')) as allowed
  from public.department_members member
  join public.users app_user on app_user.id = member.user_id and coalesce(app_user.is_active, true)
  group by member.department_id, case when member.is_department_head then 'head' else 'member' end
)
insert into public.department_access_permissions
  (department_id, subject_scope, resource_key, can_view, can_manage)
select scopes.department_id, scopes.subject_scope, 'file_archive_settings',
  coalesce(effective.allowed, false), coalesce(effective.allowed, false)
from scopes left join effective using (department_id, subject_scope)
on conflict (department_id, subject_scope, resource_key) do nothing;

revoke all on function public.file_archive_touch_updated_at() from public, anon, authenticated;
revoke all on function public.file_archive_register_asset(text,text,uuid,text,text,text,text,text,bigint,timestamptz,uuid,text) from public, anon, authenticated;
revoke all on function public.file_archive_register_row() from public, anon, authenticated;
revoke all on function public.file_archive_claim_copy_jobs(integer,uuid) from public, anon, authenticated;
revoke all on function public.file_archive_claim_delete_jobs(integer) from public, anon, authenticated;
revoke all on function public.file_archive_chat_attachments(text) from public, anon, authenticated;
revoke all on function public.file_archive_activate_connection(uuid,text,text,uuid,uuid,timestamptz,uuid) from public, anon, authenticated;
revoke all on function public.file_archive_manager_user_ids() from public, anon, authenticated;
revoke all on function public.file_archive_build_preview(uuid) from public, anon, authenticated;
revoke all on function public.file_archive_confirm_preview(uuid,uuid) from public, anon, authenticated;
grant execute on function public.file_archive_register_asset(text,text,uuid,text,text,text,text,text,bigint,timestamptz,uuid,text) to service_role;
grant execute on function public.file_archive_claim_copy_jobs(integer,uuid) to service_role;
grant execute on function public.file_archive_claim_delete_jobs(integer) to service_role;
grant execute on function public.file_archive_build_preview(uuid) to service_role;
grant execute on function public.file_archive_confirm_preview(uuid,uuid) to service_role;
grant execute on function public.file_archive_activate_connection(uuid,text,text,uuid,uuid,timestamptz,uuid) to service_role;
grant execute on function public.file_archive_manager_user_ids() to service_role;

select pg_notify('pgrst', 'reload schema');
