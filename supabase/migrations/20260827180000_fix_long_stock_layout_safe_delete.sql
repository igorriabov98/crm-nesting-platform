-- Supabase production enables safe-update protection, which rejects DELETE
-- statements without a WHERE clause even inside security-definer functions.
-- Keep the replace operation atomic while explicitly limiting deletion to the
-- four categories managed by this settings screen.

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

  delete from public.long_stock_layout_lengths
  where category_key in ('circle', 'pipe', 'knife_bevel_1', 'knife_bevel_2');
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

revoke all on function public.fn_update_long_stock_layout_settings(jsonb, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_update_long_stock_layout_settings(jsonb, bigint, uuid)
  to service_role;
