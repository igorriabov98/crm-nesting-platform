\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_request_item uuid := gen_random_uuid();
  v_plan uuid;
  v_repeated_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_repeated_version uuid;
  v_bar uuid;
  v_inventory uuid := gen_random_uuid();
  v_mismatched_inventory uuid := gen_random_uuid();
  v_input jsonb;
  v_segments jsonb;
  v_candidates jsonb;
  v_stored_snapshot jsonb;
  v_count integer;
  v_plan_status text;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then
    raise exception 'Для теста не найден завод из полно-схемной миграции';
  end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'long-stock-plan-schema@example.test', 'Тест карты раскроя', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'LONG-STOCK-PLAN-SCHEMA', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_actor);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Тестовый круг карты раскроя', 'circle', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, standard_length_mm, default_unit
  ) values (v_variant, v_material, 'circle', 40, 6000, 'мм');
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_request_item, v_request, 40, 'S355', 5998,
    v_material, v_variant
  );

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    v_actor
  );
  v_repeated_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    v_actor
  );
  if v_repeated_plan is distinct from v_plan then
    raise exception 'Повторное создание сменило стабильный номер карты раскроя';
  end if;
  select id into v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan and request_item_id = v_request_item;

  v_input := jsonb_build_object(
    'material_variant_id', v_variant,
    'request_items', jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item,
      'required_lengths_mm', jsonb_build_array(3000, 2998)
    )),
    'solver_contract_version', 1
  );
  v_segments := jsonb_build_array(
    jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', 1,
      'required_length_mm', 3000,
      'required_weight_kg', 10
    ),
    jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', 2,
      'required_length_mm', 2998,
      'required_weight_kg', 9.9
    )
  );
  v_candidates := jsonb_build_array(jsonb_build_object(
    'candidate_number', 1,
    'is_complete', true,
    'metrics', jsonb_build_object(
      'purchased_length_mm', 7250,
      'net_parts_length_mm', 5998,
      'kerf_loss_length_mm', 2,
      'end_trim_loss_length_mm', 0,
      'business_scrap_length_mm', 1250,
      'purchased_weight_kg', 21.15,
      'net_parts_weight_kg', 19.9,
      'kerf_loss_weight_kg', 0,
      'end_trim_loss_weight_kg', 0,
      'business_scrap_weight_kg', 1.25
    ),
    'bars', jsonb_build_array(jsonb_build_object(
      'bar_number', 1,
      'stock_length_mm', 7250,
      'length_group', 'nonstandard',
      'cuts', jsonb_build_array(
        jsonb_build_object('cut_number', 1, 'segment_number', 1, 'cut_length_mm', 3000),
        jsonb_build_object('cut_number', 2, 'segment_number', 2, 'cut_length_mm', 2998)
      )
    ))
  ));

  v_version := public.fn_get_or_create_long_stock_cutting_plan_version(
    v_plan, v_input, v_segments, v_candidates, 1, v_actor,
    null, jsonb_build_object('storage_bucket', 'long-stock-plans', 'object_path', 'test/plan-v1.pdf')
  );
  v_repeated_version := public.fn_get_or_create_long_stock_cutting_plan_version(
    v_plan, v_input, v_segments, v_candidates, 1, v_actor,
    null, jsonb_build_object('storage_bucket', 'long-stock-plans', 'object_path', 'ignored.pdf')
  );
  if v_repeated_version is distinct from v_version then
    raise exception 'Повторный расчёт создал новую версию';
  end if;
  select count(*) into v_count
  from public.long_stock_cutting_plan_versions where plan_id = v_plan;
  if v_count <> 1 then
    raise exception 'Повторный расчёт размножил версии: %', v_count;
  end if;

  select settings_snapshot into v_stored_snapshot
  from public.long_stock_cutting_plan_versions where id = v_version;
  if (v_stored_snapshot->>'kerf_mm')::numeric <> 1 then
    raise exception 'В версию не скопирован исходный пропил';
  end if;
  update public.long_stock_layout_settings
  set kerf_mm = 3, revision = revision + 1, updated_by = v_actor, updated_at = now()
  where id = true;
  select settings_snapshot into v_stored_snapshot
  from public.long_stock_cutting_plan_versions where id = v_version;
  if (v_stored_snapshot->>'kerf_mm')::numeric <> 1 then
    raise exception 'Изменение настроек изменило snapshot существующей версии';
  end if;

  begin
    perform public.fn_get_or_create_long_stock_cutting_plan_version(
      v_plan,
      jsonb_build_object('overflow_case', true),
      jsonb_build_array(jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 1,
        'required_length_mm', 6000
      )),
      jsonb_build_array(jsonb_build_object(
        'candidate_number', 1,
        'is_complete', true,
        'metrics', jsonb_build_object(
          'purchased_length_mm', 6000,
          'net_parts_length_mm', 6000,
          'kerf_loss_length_mm', 3,
          'end_trim_loss_length_mm', 0,
          'business_scrap_length_mm', 0,
          'purchased_weight_kg', 0,
          'net_parts_weight_kg', 0,
          'kerf_loss_weight_kg', 0,
          'end_trim_loss_weight_kg', 0,
          'business_scrap_weight_kg', 0
        ),
        'bars', jsonb_build_array(jsonb_build_object(
          'bar_number', 1,
          'stock_length_mm', 6000,
          'length_group', 'standard',
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1,
            'segment_number', 1,
            'cut_length_mm', 6000
          ))
        ))
      )),
      1,
      v_actor
    );
    raise exception 'Переполненный хлыст был сохранён';
  exception when check_violation then
    if sqlerrm not like '%Переполнение хлыста%' then raise; end if;
  end;

  begin
    perform public.fn_get_or_create_long_stock_cutting_plan_version(
      v_plan,
      jsonb_build_object('four_lengths_case', true),
      jsonb_build_array(jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 1,
        'required_length_mm', 100
      )),
      jsonb_build_array(jsonb_build_object(
        'candidate_number', 1,
        'is_complete', false,
        'metrics', jsonb_build_object(
          'purchased_length_mm', 27000,
          'net_parts_length_mm', 0,
          'kerf_loss_length_mm', 0,
          'end_trim_loss_length_mm', 0,
          'business_scrap_length_mm', 0,
          'purchased_weight_kg', 0,
          'net_parts_weight_kg', 0,
          'kerf_loss_weight_kg', 0,
          'end_trim_loss_weight_kg', 0,
          'business_scrap_weight_kg', 0
        ),
        'bars', jsonb_build_array(
          jsonb_build_object('bar_number', 1, 'stock_length_mm', 6000, 'length_group', 'standard', 'cuts', '[]'::jsonb),
          jsonb_build_object('bar_number', 2, 'stock_length_mm', 6500, 'length_group', 'nonstandard', 'cuts', '[]'::jsonb),
          jsonb_build_object('bar_number', 3, 'stock_length_mm', 7000, 'length_group', 'nonstandard', 'cuts', '[]'::jsonb),
          jsonb_build_object('bar_number', 4, 'stock_length_mm', 7500, 'length_group', 'nonstandard', 'cuts', '[]'::jsonb)
        )
      )),
      1,
      v_actor
    );
    raise exception 'Кандидат с четырьмя закупаемыми длинами был сохранён';
  exception when check_violation then
    if sqlerrm not like '%максимум три%' then raise; end if;
  end;

  perform public.fn_set_long_stock_cutting_plan_version_status(
    v_version, 'approved', v_actor
  );
  begin
    update public.long_stock_cutting_plan_versions
    set pdf_metadata = jsonb_build_object('changed', true)
    where id = v_version;
    raise exception 'Утверждённая версия была изменена';
  exception when raise_exception then
    if sqlerrm = 'Утверждённая версия была изменена'
      or sqlerrm not like '%неизменяем%' then
      raise;
    end if;
  end;

  select bar.id into v_bar
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  where candidate.version_id = v_version and candidate.candidate_number = 1;
  perform public.fn_set_long_stock_cutting_bar_status(v_bar, 'cut', v_actor);
  select status into v_plan_status from public.long_stock_cutting_plans where id = v_plan;
  if v_plan_status <> 'closed' then
    raise exception 'Закрытие всех хлыстов не закрыло карту: %', v_plan_status;
  end if;

  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap, business_scrap_state
  ) values (
    v_mismatched_inventory, v_factory, v_material, v_variant, 1249,
    1249, 0, 'мм', 1, 0, 'шт',
    v_actor, true, 'future'
  );
  begin
    insert into public.long_stock_cutting_business_scraps(
      inventory_id, version_id, bar_id, linked_by
    ) values (v_mismatched_inventory, v_version, v_bar, v_actor);
    raise exception 'Несовпадающая длина делового остатка была привязана к хлысту';
  exception when check_violation then
    if sqlerrm not like '%Длина делового остатка%не совпадает с расчётной%' then
      raise;
    end if;
  end;

  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap, business_scrap_state
  ) values (
    v_inventory, v_factory, v_material, v_variant, 1250,
    1250, 0, 'мм', 1, 0, 'шт',
    v_actor, true, 'future'
  );
  insert into public.long_stock_cutting_business_scraps(
    inventory_id, version_id, bar_id, linked_by
  ) values (v_inventory, v_version, v_bar, v_actor);
  begin
    update public.inventory
    set piece_length_mm = 1249
    where id = v_inventory;
    raise exception 'Длина уже привязанного делового остатка была изменена';
  exception when check_violation then
    if sqlerrm not like '%Длина делового остатка%не совпадает с расчётной%' then
      raise;
    end if;
  end;
  insert into public.long_stock_cutting_actual_losses(
    version_id, bar_id,
    kerf_loss_length_mm, end_trim_loss_length_mm,
    kerf_loss_weight_kg, end_trim_loss_weight_kg,
    recorded_by
  ) values (v_version, v_bar, 2, 0, 0, 0, v_actor);

  if not exists (
    select 1
    from public.long_stock_cutting_business_scraps link
    join public.inventory inventory on inventory.id = link.inventory_id
    where link.version_id = v_version
      and link.bar_id = v_bar
      and inventory.business_scrap_state = 'future'
  ) then
    raise exception 'Деловой остаток future не связан с версией и хлыстом';
  end if;
end;
$$;

rollback;

\echo '[long-stock-cutting-plan-schema] all assertions passed'
