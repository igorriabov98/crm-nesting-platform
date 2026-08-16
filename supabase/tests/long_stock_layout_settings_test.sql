\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_snapshot jsonb;
  v_payload jsonb;
  v_updated jsonb;
  v_lengths integer[];
  v_count integer;
  v_bevel smallint;
  v_bevel_one_variant uuid;
begin
  if not exists (
    select 1
    from public.long_stock_layout_settings
    where id = true
      and kerf_mm = 1
      and end_trim_mm = 0
      and optimization_hint_threshold_percent = 25
      and revision = 1
  ) then
    raise exception 'Дефолты общих настроек не установлены';
  end if;

  select array_agg(length_mm order by length_mm)
  into v_lengths
  from public.long_stock_layout_lengths
  where category_key = 'circle' and length_group = 'standard';
  if v_lengths is distinct from array[6000, 12000] then
    raise exception 'Стандартные длины круга неверны: %', v_lengths;
  end if;

  select array_agg(length_mm order by length_mm)
  into v_lengths
  from public.long_stock_layout_lengths
  where category_key = 'circle' and length_group = 'nonstandard';
  if v_lengths is distinct from array[6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 10500, 11000, 11500] then
    raise exception 'Нестандартные длины круга неверны: %', v_lengths;
  end if;

  select array_agg(length_mm order by length_mm)
  into v_lengths
  from public.long_stock_layout_lengths
  where category_key = 'pipe' and length_group = 'standard';
  if v_lengths is distinct from array[6000, 12000] then
    raise exception 'Стандартные длины трубы неверны: %', v_lengths;
  end if;

  select array_agg(length_mm order by length_mm)
  into v_lengths
  from public.long_stock_layout_lengths
  where category_key = 'knife_bevel_1' and length_group = 'standard';
  if v_lengths is distinct from array[6000] then
    raise exception 'Стандартные длины ножа с одним скосом неверны: %', v_lengths;
  end if;

  select array_agg(length_mm order by length_mm)
  into v_lengths
  from public.long_stock_layout_lengths
  where category_key = 'knife_bevel_1' and length_group = 'nonstandard';
  if v_lengths is distinct from array[6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 10500, 11000, 11500, 12000] then
    raise exception 'Нестандартные длины ножа с одним скосом неверны: %', v_lengths;
  end if;

  select array_agg(length_mm order by length_mm)
  into v_lengths
  from public.long_stock_layout_lengths
  where category_key = 'knife_bevel_2' and length_group = 'standard';
  if v_lengths is distinct from array[6000, 6500] then
    raise exception 'Стандартные длины ножа с двумя скосами неверны: %', v_lengths;
  end if;

  select array_agg(length_mm order by length_mm)
  into v_lengths
  from public.long_stock_layout_lengths
  where category_key = 'knife_bevel_2' and length_group = 'nonstandard';
  if v_lengths is distinct from array[7000, 7500, 8000, 8500, 9000, 9500, 10000, 10500, 11000, 11500, 12000] then
    raise exception 'Нестандартные длины ножа с двумя скосами неверны: %', v_lengths;
  end if;

  insert into public.users(id, email, full_name, role, is_active)
  values (v_actor, 'long-stock-layout-admin@example.test', 'Администратор раскладки', 'planning_director', true);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Тестовый нож со скосом', 'knives', v_actor);

  begin
    insert into public.material_variants(material_id, category, knife_dimensions)
    values (v_material, 'knives', '6000x100x10');
    raise exception 'Вариант ножа без явно выбранного скоса был сохранён';
  exception when check_violation then
    null;
  end;

  insert into public.material_variants(material_id, category, knife_dimensions, knife_bevel_count)
  values (v_material, 'knives', '6000x100x10', 1)
  returning id, knife_bevel_count into v_bevel_one_variant, v_bevel;
  if v_bevel <> 1 then
    raise exception 'Вариант ножа со скосом 1 не сохранён';
  end if;

  insert into public.material_variants(material_id, category, knife_dimensions, knife_bevel_count)
  values (v_material, 'knives', '6000x100x10', 2)
  returning knife_bevel_count into v_bevel;
  if v_bevel <> 2 then
    raise exception 'Вариант ножа со скосом 2 не сохранён';
  end if;

  begin
    update public.material_variants
    set knife_bevel_count = null
    where id = v_bevel_one_variant;
    raise exception 'Скос был удалён при редактировании варианта ножа';
  exception when check_violation then
    null;
  end;

  select count(*) into v_count
  from public.material_variants
  where material_id = v_material
    and knife_dimensions = '6000x100x10'
    and knife_bevel_count in (1, 2);
  if v_count <> 2 then
    raise exception 'Скос не разделяет идентичные по размерам варианты ножа';
  end if;

  begin
    insert into public.material_variants(material_id, category, diameter_mm, knife_bevel_count)
    values (v_material, 'circle', 40, 1);
    raise exception 'Скос ошибочно разрешён для круга';
  exception when check_violation then
    null;
  end;

  v_snapshot := public.fn_get_long_stock_layout_settings_snapshot();
  if (v_snapshot->>'schema_version')::integer <> 1
    or jsonb_array_length(v_snapshot->'categories') <> 4 then
    raise exception 'Snapshot настроек имеет неверную структуру: %', v_snapshot;
  end if;
  v_payload := v_snapshot - 'revision' - 'schema_version';

  begin
    perform public.fn_update_long_stock_layout_settings(
      jsonb_set(v_payload, '{kerf_mm}', '-1'::jsonb),
      1,
      v_actor
    );
    raise exception 'Отрицательный пропил был принят';
  exception when raise_exception then
    if sqlerrm = 'Отрицательный пропил был принят' or sqlerrm not like '%не могут быть отрицательными%' then
      raise;
    end if;
  end;

  begin
    perform public.fn_update_long_stock_layout_settings(
      jsonb_set(v_payload, '{categories,0,minimum_useful_length_mm}', '-1'::jsonb),
      1,
      v_actor
    );
    raise exception 'Отрицательная полезная длина была принята';
  exception when raise_exception then
    if sqlerrm = 'Отрицательная полезная длина была принята' or sqlerrm not like '%не может быть отрицательной%' then
      raise;
    end if;
  end;

  begin
    perform public.fn_update_long_stock_layout_settings(
      jsonb_set(
        v_payload,
        '{categories,0,nonstandard_lengths}',
        (v_payload#>'{categories,0,nonstandard_lengths}') || '6000'::jsonb
      ),
      1,
      v_actor
    );
    raise exception 'Дубль длины между группами был принят';
  exception when raise_exception then
    if sqlerrm = 'Дубль длины между группами был принят' or sqlerrm not like '%не должны повторяться%' then
      raise;
    end if;
  end;

  begin
    delete from public.long_stock_layout_lengths
    where category_key = 'knife_bevel_1' and length_group = 'standard';
    set constraints long_stock_layout_has_standard_length_trigger immediate;
    raise exception 'Последняя стандартная длина была удалена';
  exception when raise_exception then
    if sqlerrm = 'Последняя стандартная длина была удалена' or sqlerrm not like '%нужна минимум одна стандартная длина%' then
      raise;
    end if;
  end;
  set constraints long_stock_layout_has_standard_length_trigger deferred;

  v_updated := public.fn_update_long_stock_layout_settings(
    jsonb_set(v_payload, '{kerf_mm}', '2'::jsonb),
    1,
    v_actor
  );
  if (v_updated->>'revision')::integer <> 2 or (v_updated->>'kerf_mm')::numeric <> 2 then
    raise exception 'Настройки не обновились: %', v_updated;
  end if;

  select count(*)
  into v_count
  from public.long_stock_layout_settings_audit
  where changed_by = v_actor
    and revision_from = 1
    and revision_to = 2
    and changed_fields @> array['kerf_mm']
    and (previous_value->>'kerf_mm')::numeric = 1
    and (new_value->>'kerf_mm')::numeric = 2;
  if v_count <> 1 then
    raise exception 'Аудит изменения не создан или неполон';
  end if;

  if has_table_privilege('authenticated', 'public.long_stock_layout_settings', 'SELECT')
    or has_table_privilege('authenticated', 'public.long_stock_layout_settings_audit', 'SELECT') then
    raise exception 'Authenticated не должен читать административные настройки напрямую';
  end if;
end;
$$;

rollback;
