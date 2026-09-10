-- Client-specific product fastening settings and per-version plate files.

create table public.product_version_client_fastening_settings (
  id uuid primary key default gen_random_uuid(),
  product_version_id uuid not null references public.product_versions(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  fastening_types public.product_fastening_type[] not null default '{}'::public.product_fastening_type[],
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_version_client_fastening_unique unique (product_version_id, client_id),
  constraint product_version_client_fastening_allowed_types check (
    fastening_types <@ array[
      'metal_plate'::public.product_fastening_type,
      'a4_plate'::public.product_fastening_type,
      'white_sticker'::public.product_fastening_type,
      'none_required'::public.product_fastening_type
    ]
  )
);

create index product_version_client_fastening_client_idx
  on public.product_version_client_fastening_settings(client_id, product_version_id);

create table public.product_version_client_fastening_files (
  id uuid primary key default gen_random_uuid(),
  setting_id uuid not null references public.product_version_client_fastening_settings(id) on delete cascade,
  fastening_type public.product_fastening_type not null,
  file_name text not null,
  file_path text not null,
  mime_type text,
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  uploaded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint product_version_client_fastening_file_type check (
    fastening_type in (
      'metal_plate'::public.product_fastening_type,
      'a4_plate'::public.product_fastening_type
    )
  ),
  constraint product_version_client_fastening_file_unique unique (setting_id, fastening_type),
  constraint product_version_client_fastening_file_path_unique unique (file_path)
);

create index product_version_client_fastening_files_setting_idx
  on public.product_version_client_fastening_files(setting_id);

create or replace function public.touch_product_version_client_fastening_setting()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger product_version_client_fastening_settings_touch
before update on public.product_version_client_fastening_settings
for each row execute function public.touch_product_version_client_fastening_setting();

alter table public.product_version_client_fastening_settings enable row level security;
alter table public.product_version_client_fastening_files enable row level security;

revoke all on table public.product_version_client_fastening_settings from public, anon, authenticated;
revoke all on table public.product_version_client_fastening_files from public, anon, authenticated;
grant all on table public.product_version_client_fastening_settings to service_role;
grant all on table public.product_version_client_fastening_files to service_role;
revoke all on function public.touch_product_version_client_fastening_setting() from public, anon, authenticated;

create or replace function public.fn_copy_product_version_client_fastening_settings(
  p_source_version_id uuid,
  p_target_version_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source public.product_versions%rowtype;
  v_target public.product_versions%rowtype;
  v_count integer := 0;
  v_legacy_types public.product_fastening_type[];
begin
  select * into v_source from public.product_versions where id = p_source_version_id;
  select * into v_target from public.product_versions where id = p_target_version_id;
  if v_source.id is null or v_target.id is null or v_source.product_id <> v_target.product_id then
    raise exception 'Product version copy scope is invalid';
  end if;
  if exists (
    select 1 from public.product_version_client_fastening_settings
    where product_version_id = p_target_version_id
  ) then
    return 0;
  end if;

  if p_source_version_id <> p_target_version_id then
    insert into public.product_version_client_fastening_settings (
      product_version_id, client_id, fastening_types, created_by, updated_by
    )
    select p_target_version_id, client_id, fastening_types, p_user_id, p_user_id
    from public.product_version_client_fastening_settings
    where product_version_id = p_source_version_id;
    get diagnostics v_count = row_count;
  end if;

  if v_count = 0 then
    v_legacy_types := array_remove(
      coalesce(v_source.fastening_types, '{}'::public.product_fastening_type[]),
      'wp_plate'::public.product_fastening_type
    );
    if cardinality(v_legacy_types) > 0 then
      insert into public.product_version_client_fastening_settings (
        product_version_id, client_id, fastening_types, created_by, updated_by
      )
      select p_target_version_id, client.id, v_legacy_types, p_user_id, p_user_id
      from public.clients client;
      get diagnostics v_count = row_count;
    end if;
  end if;
  return v_count;
end;
$$;

revoke all on function public.fn_copy_product_version_client_fastening_settings(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.fn_copy_product_version_client_fastening_settings(uuid,uuid,uuid)
  to service_role;

-- Keep the enum value for compatibility, but remove WP from every legacy array.
update public.product_versions
set fastening_types = array_remove(
  fastening_types,
  'wp_plate'::public.product_fastening_type
)
where fastening_types @> array['wp_plate'::public.product_fastening_type];

-- Seed the current version for every existing client from the old shared value.
insert into public.product_version_client_fastening_settings (
  product_version_id,
  client_id,
  fastening_types,
  created_by,
  updated_by,
  created_at,
  updated_at
)
select
  version.id,
  client.id,
  version.fastening_types,
  version.created_by,
  version.created_by,
  now(),
  now()
from public.product_versions version
cross join public.clients client
where version.status = 'current'
  and cardinality(version.fastening_types) > 0
on conflict (product_version_id, client_id) do nothing;

alter table public.tasks
  add column if not exists client_id uuid references public.clients(id) on delete set null;

create index if not exists idx_tasks_client
  on public.tasks(client_id)
  where client_id is not null;

update public.tasks task
set client_id = machine.client_id
from public.machines machine
where task.task_type = 'product_version_incomplete'
  and task.machine_id = machine.id
  and task.client_id is null;

drop index if exists public.idx_tasks_product_version_incomplete_active_unique;

create unique index idx_tasks_product_version_client_incomplete_active_unique
  on public.tasks(product_version_id, client_id, assigned_to)
  where task_type = 'product_version_incomplete'
    and status in ('pending', 'in_progress')
    and product_version_id is not null
    and client_id is not null
    and assigned_to is not null;

-- Existing active orders must receive a client-scoped completion task when the
-- new file-aware rule makes their product version incomplete.
insert into public.tasks (
  machine_id,
  client_id,
  product_version_id,
  assigned_to,
  task_type,
  title,
  description,
  status,
  start_date,
  deadline
)
select distinct on (item.product_version_id, machine.client_id, machine.created_by)
  machine.id,
  machine.client_id,
  item.product_version_id,
  machine.created_by,
  'product_version_incomplete'::public.task_type,
  'Дозаполнить карточку товара: ' || product.name_uk || ' v' || version.version_number::text || ' · ' || client.name,
  'Для клиента "' || client.name || '" в версии v' || version.version_number::text ||
    ' товара "' || product.name_uk || '" не заполнены крепление, обязательный файл таблички или общая комплектация.',
  'pending'::public.task_status,
  current_date,
  current_date + 1
from public.machine_items item
join public.machines machine on machine.id = item.machine_id
join public.clients client on client.id = machine.client_id
join public.product_versions version on version.id = item.product_version_id
join public.products product on product.id = version.product_id
left join public.product_version_client_fastening_settings setting
  on setting.product_version_id = version.id
 and setting.client_id = machine.client_id
where coalesce(machine.is_archived, false) = false
  and machine.created_by is not null
  and item.product_version_id is not null
  and (
    version.completion_type is null
    or setting.id is null
    or cardinality(setting.fastening_types) = 0
    or (
      setting.fastening_types @> array['metal_plate'::public.product_fastening_type]
      and not exists (
        select 1 from public.product_version_client_fastening_files file
        where file.setting_id = setting.id
          and file.fastening_type = 'metal_plate'::public.product_fastening_type
      )
    )
    or (
      setting.fastening_types @> array['a4_plate'::public.product_fastening_type]
      and not exists (
        select 1 from public.product_version_client_fastening_files file
        where file.setting_id = setting.id
          and file.fastening_type = 'a4_plate'::public.product_fastening_type
      )
    )
  )
order by item.product_version_id, machine.client_id, machine.created_by, machine.created_at, machine.id
on conflict do nothing;

insert into public.file_archive_policies(key, label, category) values
  ('product_client_metal_plate', 'Металлические таблички клиентов', 'Таблички клиентов'),
  ('product_client_a4_plate', 'Таблички А4 клиентов', 'Таблички клиентов')
on conflict (key) do nothing;

create or replace function public.file_archive_register_client_fastening_file()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy text;
  v_label text;
begin
  v_policy := case new.fastening_type
    when 'metal_plate'::public.product_fastening_type then 'product_client_metal_plate'
    when 'a4_plate'::public.product_fastening_type then 'product_client_a4_plate'
    else null
  end;
  if v_policy is null then
    raise exception 'Unsupported client fastening file type';
  end if;

  select coalesce(product.drawing_number, product.name_uk, product.id::text) || ' · ' || client.name
    into v_label
  from public.product_version_client_fastening_settings setting
  join public.product_versions version on version.id = setting.product_version_id
  join public.products product on product.id = version.product_id
  join public.clients client on client.id = setting.client_id
  where setting.id = new.setting_id;

  perform public.file_archive_register_asset(
    v_policy,
    'product_version_client_fastening_file',
    new.id,
    null,
    'product-files',
    new.file_path,
    new.file_name,
    new.mime_type,
    new.file_size,
    new.created_at,
    null,
    v_label
  );
  return new;
end;
$$;

create trigger product_version_client_fastening_file_archive_register
after insert or update of file_path on public.product_version_client_fastening_files
for each row execute function public.file_archive_register_client_fastening_file();

revoke all on function public.file_archive_register_client_fastening_file() from public, anon, authenticated;
grant execute on function public.file_archive_register_client_fastening_file() to service_role;
