create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

create type public.product_fastening_type as enum (
  'metal_plate', 'wp_plate', 'a4_plate', 'white_sticker', 'none_required'
);
create type public.product_completion_type as enum ('mounting_set', 'chain_set');
create type public.task_type as enum ('product_version_incomplete', 'shipping_documents');
create type public.task_status as enum ('pending', 'in_progress', 'completed', 'cancelled');

create table public.users (
  id uuid primary key,
  full_name text
);
create table public.clients (
  id uuid primary key,
  name text not null
);
create table public.products (
  id uuid primary key,
  name_uk text not null,
  drawing_number text
);
create table public.product_versions (
  id uuid primary key,
  product_id uuid not null references public.products(id),
  version_number integer not null,
  status text not null check (status in ('current', 'archived')),
  drawing_number text not null,
  change_summary text,
  fastening_types public.product_fastening_type[] not null default '{}',
  completion_type public.product_completion_type,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create table public.machines (
  id uuid primary key,
  client_id uuid references public.clients(id),
  created_by uuid references public.users(id),
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.machine_items (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id),
  product_version_id uuid references public.product_versions(id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid references public.machines(id),
  product_version_id uuid references public.product_versions(id),
  assigned_to uuid references public.users(id),
  task_type public.task_type not null,
  title text not null,
  description text,
  status public.task_status not null default 'pending',
  start_date date,
  deadline date,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create unique index idx_tasks_product_version_incomplete_active_unique
  on public.tasks(product_version_id, assigned_to)
  where task_type = 'product_version_incomplete'
    and status in ('pending', 'in_progress')
    and product_version_id is not null
    and assigned_to is not null;

create table public.file_archive_policies (
  key text primary key,
  label text not null,
  category text not null
);
create table public.file_archive_assets (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  source_kind text not null,
  source_record_id uuid not null,
  bucket_id text not null,
  object_path text not null unique,
  file_name text not null
);
create function public.file_archive_register_asset(
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
language plpgsql
as $$
declare v_id uuid;
begin
  insert into public.file_archive_assets(
    policy_key, source_kind, source_record_id, bucket_id, object_path, file_name
  ) values (
    p_policy_key, p_source_kind, p_source_record_id, p_bucket_id, p_object_path, p_file_name
  )
  on conflict (object_path) do update set
    policy_key = excluded.policy_key,
    source_record_id = excluded.source_record_id,
    file_name = excluded.file_name
  returning id into v_id;
  return v_id;
end;
$$;

insert into public.users(id, full_name) values
  ('10000000-0000-0000-0000-000000000001', 'Менеджер');
insert into public.clients(id, name) values
  ('20000000-0000-0000-0000-000000000001', 'Альфа'),
  ('20000000-0000-0000-0000-000000000002', 'Бета');
insert into public.products(id, name_uk, drawing_number) values
  ('30000000-0000-0000-0000-000000000001', 'Тестовое изделие', 'TEST-01');
insert into public.product_versions(
  id, product_id, version_number, status, drawing_number,
  fastening_types, completion_type, created_by
) values
  (
    '40000000-0000-0000-0000-000000000001',
    '30000000-0000-0000-0000-000000000001',
    1, 'current', 'TEST-01',
    array['metal_plate', 'wp_plate', 'a4_plate']::public.product_fastening_type[],
    'mounting_set', '10000000-0000-0000-0000-000000000001'
  ),
  (
    '40000000-0000-0000-0000-000000000002',
    '30000000-0000-0000-0000-000000000001',
    0, 'archived', 'TEST-00',
    array['white_sticker', 'wp_plate']::public.product_fastening_type[],
    'mounting_set', '10000000-0000-0000-0000-000000000001'
  );
insert into public.machines(id, client_id, created_by, created_at) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now() - interval '2 hours'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', now() - interval '1 hour');
insert into public.machine_items(machine_id, product_version_id) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001');
insert into public.tasks(
  machine_id, product_version_id, assigned_to, task_type, title, status
) values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'product_version_incomplete', 'Старая общая задача', 'pending'
);
