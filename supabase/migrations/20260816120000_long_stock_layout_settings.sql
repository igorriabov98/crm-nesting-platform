-- Settings for long-stock layout calculation. The snapshot function is intentionally
-- independent from plan tables so a future approval flow can copy the full payload.

alter table public.material_variants
  add column if not exists knife_bevel_count smallint;

update public.material_variants
set knife_bevel_count = 1
where category = 'knives'
  and knife_bevel_count is null;

create or replace function public.material_variants_normalize_knife_bevel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.category = 'knives' and new.knife_bevel_count is null then
    new.knife_bevel_count := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists material_variants_normalize_knife_bevel_trigger
  on public.material_variants;
create trigger material_variants_normalize_knife_bevel_trigger
before insert or update of category, knife_bevel_count
on public.material_variants
for each row execute function public.material_variants_normalize_knife_bevel();

alter table public.material_variants
  drop constraint if exists material_variants_knife_bevel_count_check;
alter table public.material_variants
  add constraint material_variants_knife_bevel_count_check
  check (
    (category = 'knives' and knife_bevel_count in (1, 2))
    or (category <> 'knives' and knife_bevel_count is null)
  );

create table public.long_stock_layout_settings (
  id boolean primary key default true check (id),
  kerf_mm numeric not null default 1 check (kerf_mm >= 0),
  end_trim_mm numeric not null default 0 check (end_trim_mm >= 0),
  optimization_hint_threshold_percent numeric not null default 25
    check (optimization_hint_threshold_percent between 0 and 100),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references public.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table public.long_stock_layout_categories (
  key text primary key check (key in ('circle', 'pipe', 'knife_bevel_1', 'knife_bevel_2')),
  material_category public.material_category not null,
  knife_bevel_count smallint,
  minimum_useful_length_mm numeric not null default 0 check (minimum_useful_length_mm >= 0),
  sort_order smallint not null,
  constraint long_stock_layout_category_mapping_check check (
    (key = 'circle' and material_category = 'circle' and knife_bevel_count is null)
    or (key = 'pipe' and material_category = 'pipe' and knife_bevel_count is null)
    or (key = 'knife_bevel_1' and material_category = 'knives' and knife_bevel_count = 1)
    or (key = 'knife_bevel_2' and material_category = 'knives' and knife_bevel_count = 2)
  )
);

create table public.long_stock_layout_lengths (
  category_key text not null references public.long_stock_layout_categories(key) on delete restrict,
  length_group text not null check (length_group in ('standard', 'nonstandard')),
  length_mm integer not null check (length_mm > 0),
  primary key (category_key, length_mm)
);

create index long_stock_layout_lengths_group_idx
  on public.long_stock_layout_lengths(category_key, length_group, length_mm);

create table public.long_stock_layout_settings_audit (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid not null references public.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  revision_from bigint not null,
  revision_to bigint not null,
  changed_fields text[] not null,
  previous_value jsonb not null,
  new_value jsonb not null,
  check (revision_to = revision_from + 1),
  check (cardinality(changed_fields) > 0)
);

create index long_stock_layout_settings_audit_changed_at_idx
  on public.long_stock_layout_settings_audit(changed_at desc);

insert into public.long_stock_layout_settings(id)
values (true)
on conflict (id) do nothing;

insert into public.long_stock_layout_categories(
  key,
  material_category,
  knife_bevel_count,
  minimum_useful_length_mm,
  sort_order
)
values
  ('circle', 'circle', null, 0, 10),
  ('pipe', 'pipe', null, 0, 20),
  ('knife_bevel_1', 'knives', 1, 0, 30),
  ('knife_bevel_2', 'knives', 2, 0, 40)
on conflict (key) do nothing;

insert into public.long_stock_layout_lengths(category_key, length_group, length_mm)
values
  ('circle', 'standard', 6000),
  ('circle', 'standard', 12000),
  ('pipe', 'standard', 6000),
  ('pipe', 'standard', 12000),
  ('knife_bevel_1', 'standard', 6000),
  ('knife_bevel_2', 'standard', 6000),
  ('knife_bevel_2', 'standard', 6500)
on conflict (category_key, length_mm) do nothing;

insert into public.long_stock_layout_lengths(category_key, length_group, length_mm)
select category_key, 'nonstandard', length_mm
from (
  select 'circle'::text as category_key, generate_series(6500, 11500, 500) as length_mm
  union all
  select 'pipe', generate_series(6500, 11500, 500)
  union all
  select 'knife_bevel_1', generate_series(6500, 12000, 500)
  union all
  select 'knife_bevel_2', generate_series(7000, 12000, 500)
) defaults
on conflict (category_key, length_mm) do nothing;

create or replace function public.fn_assert_long_stock_layout_has_standard_length()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_missing_key text;
begin
  select category.key
  into v_missing_key
  from public.long_stock_layout_categories category
  where not exists (
    select 1
    from public.long_stock_layout_lengths length
    where length.category_key = category.key
      and length.length_group = 'standard'
  )
  order by category.sort_order
  limit 1;

  if v_missing_key is not null then
    raise exception 'Для категории % нужна минимум одна стандартная длина', v_missing_key;
  end if;

  return null;
end;
$$;

create constraint trigger long_stock_layout_has_standard_length_trigger
after insert or update or delete on public.long_stock_layout_lengths
deferrable initially deferred
for each row execute function public.fn_assert_long_stock_layout_has_standard_length();

create or replace function public.fn_long_stock_layout_audit_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Аудит настроек раскладки хлыстов неизменяем';
end;
$$;

create trigger long_stock_layout_settings_audit_immutable_trigger
before update or delete on public.long_stock_layout_settings_audit
for each row execute function public.fn_long_stock_layout_audit_immutable();

create or replace function public.fn_get_long_stock_layout_settings_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'revision', settings.revision,
    'kerf_mm', settings.kerf_mm,
    'end_trim_mm', settings.end_trim_mm,
    'optimization_hint_threshold_percent', settings.optimization_hint_threshold_percent,
    'categories', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', category.key,
          'material_category', category.material_category,
          'knife_bevel_count', category.knife_bevel_count,
          'minimum_useful_length_mm', category.minimum_useful_length_mm,
          'standard_lengths', coalesce((
            select jsonb_agg(length.length_mm order by length.length_mm)
            from public.long_stock_layout_lengths length
            where length.category_key = category.key
              and length.length_group = 'standard'
          ), '[]'::jsonb),
          'nonstandard_lengths', coalesce((
            select jsonb_agg(length.length_mm order by length.length_mm)
            from public.long_stock_layout_lengths length
            where length.category_key = category.key
              and length.length_group = 'nonstandard'
          ), '[]'::jsonb)
        )
        order by category.sort_order
      )
      from public.long_stock_layout_categories category
    ), '[]'::jsonb)
  )
  from public.long_stock_layout_settings settings
  where settings.id = true
$$;

create or replace function public.fn_update_long_stock_layout_settings(
  p_configuration jsonb,
  p_expected_revision bigint,
  p_changed_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_revision bigint;
  v_kerf_mm numeric;
  v_end_trim_mm numeric;
  v_threshold numeric;
  v_categories jsonb;
  v_category jsonb;
  v_key text;
  v_minimum_useful_length_mm numeric;
  v_standard jsonb;
  v_nonstandard jsonb;
  v_length_count integer;
  v_distinct_length_count integer;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_old_configuration jsonb;
  v_new_configuration jsonb;
  v_old_category jsonb;
  v_new_category jsonb;
  v_changed_fields text[] := array[]::text[];
begin
  if jsonb_typeof(p_configuration) is distinct from 'object' then
    raise exception 'Настройки должны быть JSON-объектом';
  end if;
  if jsonb_typeof(p_configuration->'kerf_mm') is distinct from 'number'
    or jsonb_typeof(p_configuration->'end_trim_mm') is distinct from 'number'
    or jsonb_typeof(p_configuration->'optimization_hint_threshold_percent') is distinct from 'number' then
    raise exception 'Общие параметры должны быть числами';
  end if;

  v_kerf_mm := (p_configuration->>'kerf_mm')::numeric;
  v_end_trim_mm := (p_configuration->>'end_trim_mm')::numeric;
  v_threshold := (p_configuration->>'optimization_hint_threshold_percent')::numeric;
  if v_kerf_mm < 0 or v_end_trim_mm < 0 then
    raise exception 'Пропил и торцовка не могут быть отрицательными';
  end if;
  if v_threshold < 0 or v_threshold > 100 then
    raise exception 'Порог подсказки должен быть от 0 до 100 процентов';
  end if;

  v_categories := p_configuration->'categories';
  if jsonb_typeof(v_categories) is distinct from 'array'
    or jsonb_array_length(v_categories) <> 4 then
    raise exception 'Нужны настройки четырёх категорий длинномера';
  end if;
  if (
    select count(distinct category->>'key')
    from jsonb_array_elements(v_categories) category
  ) <> 4 or exists (
    select 1
    from jsonb_array_elements(v_categories) category
    where category->>'key' not in ('circle', 'pipe', 'knife_bevel_1', 'knife_bevel_2')
  ) then
    raise exception 'Категории длинномера заданы неверно или повторяются';
  end if;

  select settings.revision
  into v_current_revision
  from public.long_stock_layout_settings settings
  where settings.id = true
  for update;
  if v_current_revision is null then
    raise exception 'Настройки раскладки хлыстов не найдены';
  end if;
  if v_current_revision <> p_expected_revision then
    raise exception 'Настройки уже изменены другим пользователем. Обновите страницу';
  end if;
  if not exists (select 1 from public.users where id = p_changed_by and is_active = true) then
    raise exception 'Активный пользователь аудита не найден';
  end if;

  v_old_snapshot := public.fn_get_long_stock_layout_settings_snapshot();
  v_old_configuration := v_old_snapshot - 'revision';

  delete from public.long_stock_layout_lengths;
  for v_category in
    select value from jsonb_array_elements(v_categories)
  loop
    v_key := v_category->>'key';
    if jsonb_typeof(v_category->'minimum_useful_length_mm') is distinct from 'number' then
      raise exception 'Минимальная полезная длина для % должна быть числом', v_key;
    end if;
    v_minimum_useful_length_mm := (v_category->>'minimum_useful_length_mm')::numeric;
    if v_minimum_useful_length_mm < 0 then
      raise exception 'Минимальная полезная длина для % не может быть отрицательной', v_key;
    end if;

    v_standard := v_category->'standard_lengths';
    v_nonstandard := v_category->'nonstandard_lengths';
    if jsonb_typeof(v_standard) is distinct from 'array'
      or jsonb_array_length(v_standard) = 0 then
      raise exception 'Для категории % нужна минимум одна стандартная длина', v_key;
    end if;
    if jsonb_typeof(v_nonstandard) is distinct from 'array' then
      raise exception 'Нестандартные длины категории % должны быть списком', v_key;
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_standard || v_nonstandard) item(value)
      where jsonb_typeof(value) is distinct from 'number'
    ) then
      raise exception 'Длины категории % должны быть числами', v_key;
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_standard || v_nonstandard) item(value)
      where (value::text)::numeric <= 0
        or (value::text)::numeric <> trunc((value::text)::numeric)
        or (value::text)::numeric > 2147483647
    ) then
      raise exception 'Длины категории % должны быть положительными целыми числами', v_key;
    end if;

    select count(*), count(distinct (value::text)::integer)
    into v_length_count, v_distinct_length_count
    from jsonb_array_elements(v_standard || v_nonstandard) item(value);
    if v_length_count <> v_distinct_length_count then
      raise exception 'Длины категории % не должны повторяться внутри или между группами', v_key;
    end if;

    update public.long_stock_layout_categories
    set minimum_useful_length_mm = v_minimum_useful_length_mm
    where key = v_key;

    insert into public.long_stock_layout_lengths(category_key, length_group, length_mm)
    select v_key, 'standard', (value::text)::integer
    from jsonb_array_elements(v_standard) item(value);

    insert into public.long_stock_layout_lengths(category_key, length_group, length_mm)
    select v_key, 'nonstandard', (value::text)::integer
    from jsonb_array_elements(v_nonstandard) item(value);
  end loop;

  update public.long_stock_layout_settings
  set kerf_mm = v_kerf_mm,
      end_trim_mm = v_end_trim_mm,
      optimization_hint_threshold_percent = v_threshold
  where id = true;

  v_new_configuration := public.fn_get_long_stock_layout_settings_snapshot() - 'revision';
  if v_new_configuration = v_old_configuration then
    return v_old_snapshot;
  end if;

  if v_old_configuration->'kerf_mm' is distinct from v_new_configuration->'kerf_mm' then
    v_changed_fields := array_append(v_changed_fields, 'kerf_mm');
  end if;
  if v_old_configuration->'end_trim_mm' is distinct from v_new_configuration->'end_trim_mm' then
    v_changed_fields := array_append(v_changed_fields, 'end_trim_mm');
  end if;
  if v_old_configuration->'optimization_hint_threshold_percent'
    is distinct from v_new_configuration->'optimization_hint_threshold_percent' then
    v_changed_fields := array_append(v_changed_fields, 'optimization_hint_threshold_percent');
  end if;

  foreach v_key in array array['circle', 'pipe', 'knife_bevel_1', 'knife_bevel_2']
  loop
    select category into v_old_category
    from jsonb_array_elements(v_old_configuration->'categories') category
    where category->>'key' = v_key;
    select category into v_new_category
    from jsonb_array_elements(v_new_configuration->'categories') category
    where category->>'key' = v_key;
    if v_old_category is distinct from v_new_category then
      v_changed_fields := array_append(v_changed_fields, v_key);
    end if;
  end loop;

  update public.long_stock_layout_settings
  set revision = revision + 1,
      updated_by = p_changed_by,
      updated_at = now()
  where id = true;

  v_new_snapshot := public.fn_get_long_stock_layout_settings_snapshot();
  insert into public.long_stock_layout_settings_audit(
    changed_by,
    revision_from,
    revision_to,
    changed_fields,
    previous_value,
    new_value
  ) values (
    p_changed_by,
    v_current_revision,
    v_current_revision + 1,
    v_changed_fields,
    v_old_snapshot,
    v_new_snapshot
  );

  return v_new_snapshot;
end;
$$;

alter table public.long_stock_layout_settings enable row level security;
alter table public.long_stock_layout_categories enable row level security;
alter table public.long_stock_layout_lengths enable row level security;
alter table public.long_stock_layout_settings_audit enable row level security;

revoke all on table public.long_stock_layout_settings from public, anon, authenticated;
revoke all on table public.long_stock_layout_categories from public, anon, authenticated;
revoke all on table public.long_stock_layout_lengths from public, anon, authenticated;
revoke all on table public.long_stock_layout_settings_audit from public, anon, authenticated;
grant select on table public.long_stock_layout_settings to service_role;
grant select on table public.long_stock_layout_categories to service_role;
grant select on table public.long_stock_layout_lengths to service_role;
grant select on table public.long_stock_layout_settings_audit to service_role;

revoke all on function public.material_variants_normalize_knife_bevel() from public, anon, authenticated;
revoke all on function public.fn_assert_long_stock_layout_has_standard_length() from public, anon, authenticated;
revoke all on function public.fn_long_stock_layout_audit_immutable() from public, anon, authenticated;
revoke all on function public.fn_get_long_stock_layout_settings_snapshot() from public, anon, authenticated;
revoke all on function public.fn_update_long_stock_layout_settings(jsonb, bigint, uuid) from public, anon, authenticated;
grant execute on function public.fn_get_long_stock_layout_settings_snapshot() to service_role;
grant execute on function public.fn_update_long_stock_layout_settings(jsonb, bigint, uuid) to service_role;
