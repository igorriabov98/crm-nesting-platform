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
  v_missing_variant_item uuid := gen_random_uuid();
  v_stock_only_item uuid := gen_random_uuid();
  v_source_inventory uuid := gen_random_uuid();
  v_stock_only_inventory uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version_1 uuid;
  v_repeated_version_1 uuid;
  v_version_2 uuid;
  v_repeated_version_2 uuid;
  v_settings jsonb;
  v_segments jsonb;
  v_candidate_v1 jsonb;
  v_candidate_v2 jsonb;
  v_input_v1 jsonb;
  v_input_v2 jsonb;
  v_approval jsonb;
  v_pdf_metadata_1 jsonb;
  v_stock_pdf_metadata jsonb;
  v_snapshot_before jsonb;
  v_count integer;
  v_lengths numeric[];
  v_status text;
  v_reserved numeric;
  v_stock_only_plan uuid;
  v_stock_only_plan_item uuid;
  v_stock_only_version uuid;
  v_cut_bar uuid;
  v_cut_scrap uuid;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then
    raise exception 'Для серверного теста карты раскроя не найден завод';
  end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'long-stock-plan-server@example.test', 'Тест сервера раскроя', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'LONG-STOCK-PLAN-SERVER', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_actor);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Тестовый круг сервера раскроя', 'circle', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (v_variant, v_material, 'circle', 40, 'S355', 6000, 2, 'шт');
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_request_item, v_request, 40, 'S355', 1500,
    v_material, v_variant
  );
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_missing_variant_item, v_request, 40, 'S355', 300,
    v_material, null
  );
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap, business_scrap_state
  ) values (
    v_source_inventory, v_factory, v_material, v_variant, 400,
    400, 0, 'мм', 1, 0, 'шт',
    v_actor, true, 'available'
  );

  begin
    perform public.fn_create_long_stock_cutting_plan(
      v_variant,
      jsonb_build_array(jsonb_build_object(
        'request_item_table', 'request_circle',
        'request_item_id', v_missing_variant_item
      )),
      v_actor
    );
    raise exception 'Позиция без material_variant_id была принята';
  exception when raise_exception then
    if sqlerrm = 'Позиция без material_variant_id была принята'
      or sqlerrm not like '%не выбран точный вариант материала%' then
      raise;
    end if;
  end;

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    v_actor
  );
  select id into v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan and request_item_id = v_request_item;
  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_segments := jsonb_build_array(
    jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', 1,
      'required_length_mm', 300,
      'required_weight_kg', 0.6
    ),
    jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', 2,
      'required_length_mm', 1200,
      'required_weight_kg', 2.4
    )
  );
  v_candidate_v1 := jsonb_build_array(jsonb_build_object(
    'candidate_number', 1,
    'is_complete', true,
    'metrics', jsonb_build_object(
      'purchased_length_mm', 6000,
      'net_parts_length_mm', 1500,
      'kerf_loss_length_mm', 2,
      'end_trim_loss_length_mm', 0,
      'business_scrap_length_mm', 4898,
      'purchased_weight_kg', 12,
      'net_parts_weight_kg', 3,
      'kerf_loss_weight_kg', 0.004,
      'end_trim_loss_weight_kg', 0,
      'business_scrap_weight_kg', 9.796
    ),
    'bars', jsonb_build_array(
      jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', 400,
        'length_group', null,
        'source_type', 'business_remnant',
        'source_inventory_id', v_source_inventory,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 300
        ))
      ),
      jsonb_build_object(
        'bar_number', 2,
        'stock_length_mm', 6000,
        'length_group', 'standard',
        'source_type', 'new_stock',
        'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 2, 'cut_length_mm', 1200
        ))
      )
    )
  ));
  v_input_v1 := jsonb_build_object(
    'case', 'server-v1',
    'material_id', v_material,
    'material_variant_id', v_variant,
    'grade_key', 's355'
  );

  begin
    perform public.fn_get_or_create_long_stock_cutting_plan_version_v2(
      v_plan, v_input_v1, v_settings, v_segments, v_candidate_v1,
      1, v_actor, null, jsonb_build_object('object_path', 'premature.pdf')
    );
    raise exception 'PDF был записан до утверждения версии';
  exception when raise_exception then
    if sqlerrm = 'PDF был записан до утверждения версии'
      or sqlerrm not like '%PDF добавляется только при утверждении версии карты раскроя%' then
      raise;
    end if;
  end;

  v_version_1 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan, v_input_v1, v_settings, v_segments, v_candidate_v1,
    1, v_actor, null, '{}'::jsonb
  );
  v_repeated_version_1 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan, v_input_v1, v_settings, v_segments, v_candidate_v1,
    1, v_actor, null, '{}'::jsonb
  );
  if v_repeated_version_1 is distinct from v_version_1 then
    raise exception 'Повторный вход создал вторую версию';
  end if;
  select input_snapshot into v_snapshot_before
  from public.long_stock_cutting_plan_versions where id = v_version_1;

  v_pdf_metadata_1 := jsonb_build_object(
    'schema_version', 1,
    'bucket_id', 'product-files',
    'object_path', format('long-stock-cutting-plans/%s/%s/%s.pdf', v_plan, v_version_1, gen_random_uuid()),
    'file_name', 'cutting-plan-' || (select plan_number from public.long_stock_cutting_plans where id = v_plan) || '-v1.pdf',
    'mime_type', 'application/pdf',
    'size_bytes', 2048,
    'sha256', repeat('a', 64),
    'generated_by', v_actor,
    'generated_at', now()
  );
  v_approval := public.fn_approve_long_stock_cutting_plan_version_v2(v_version_1, v_actor, v_pdf_metadata_1);
  if v_approval->>'status' <> 'approved'
    or v_approval->>'position_status' <> 'plan_approved'
    or (v_approval->>'purchase_required')::boolean is not true then
    raise exception 'Утверждение вернуло неверное состояние: %', v_approval;
  end if;
  select count(*), array_agg(inventory.piece_length_mm order by inventory.piece_length_mm)
  into v_count, v_lengths
  from public.long_stock_cutting_business_scraps link
  join public.inventory inventory on inventory.id = link.inventory_id
  where link.version_id = v_version_1
    and inventory.business_scrap_state = 'future';
  if v_count <> 2 or v_lengths is distinct from array[99::numeric, 4799::numeric] then
    raise exception 'Созданы неверные будущие остатки: count=%, lengths=%', v_count, v_lengths;
  end if;
  if exists (
    select 1
    from public.long_stock_cutting_business_scraps link
    join public.inventory inventory on inventory.id = link.inventory_id
    where link.version_id = v_version_1
      and (
        inventory.unit is distinct from 'мм'
        or inventory.secondary_unit is distinct from 'шт'
        or inventory.total_quantity is distinct from inventory.piece_length_mm
        or inventory.total_secondary_quantity is distinct from 1::numeric
      )
  ) then
    raise exception 'Будущий мерный остаток сохранился не как мм / шт';
  end if;
  select reserved_quantity into v_reserved
  from public.inventory where id = v_source_inventory;
  if v_reserved <> 400 then
    raise exception 'Выбранный деловой остаток не зарезервирован целиком: %', v_reserved;
  end if;
  select cutting_status into v_status
  from public.long_stock_cutting_plan_items where id = v_plan_item;
  if v_status <> 'plan_approved' then
    raise exception 'Позиция не получила статус plan_approved: %', v_status;
  end if;

  perform public.fn_approve_long_stock_cutting_plan_version_v2(v_version_1, v_actor, v_pdf_metadata_1);
  select count(*) into v_count
  from public.long_stock_cutting_business_scraps where version_id = v_version_1;
  if v_count <> 2 then
    raise exception 'Повторное утверждение размножило остатки: %', v_count;
  end if;
  begin
    perform public.fn_approve_long_stock_cutting_plan_version_v2(
      v_version_1,
      v_actor,
      jsonb_set(v_pdf_metadata_1, '{sha256}', to_jsonb(repeat('b', 64)))
    );
    raise exception 'Повторное утверждение заменило сохранённый PDF';
  exception when raise_exception then
    if sqlerrm = 'Повторное утверждение заменило сохранённый PDF'
      or sqlerrm not like '%уже сформирован и не может быть заменён%' then
      raise;
    end if;
  end;
  select bar.id, link.inventory_id
  into v_cut_bar, v_cut_scrap
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.long_stock_cutting_business_scraps link on link.bar_id = bar.id
  where candidate.version_id = v_version_1
    and candidate.candidate_number = 1
    and bar.bar_number = 1;
  perform public.fn_set_long_stock_cutting_bar_status(v_cut_bar, 'cut', v_actor);

  v_input_v2 := jsonb_build_object(
    'case', 'server-v2',
    'material_id', v_material,
    'material_variant_id', v_variant,
    'grade_key', 's355'
  );
  v_candidate_v2 := jsonb_build_array(jsonb_build_object(
    'candidate_number', 1,
    'is_complete', true,
    'metrics', jsonb_build_object(
      'purchased_length_mm', 6000,
      'net_parts_length_mm', 1500,
      'kerf_loss_length_mm', 2,
      'end_trim_loss_length_mm', 0,
      'business_scrap_length_mm', 4498,
      'purchased_weight_kg', 12,
      'net_parts_weight_kg', 3,
      'kerf_loss_weight_kg', 0.004,
      'end_trim_loss_weight_kg', 0,
      'business_scrap_weight_kg', 8.996
    ),
    'bars', jsonb_build_array(jsonb_build_object(
      'bar_number', 1,
      'stock_length_mm', 6000,
      'length_group', 'standard',
      'source_type', 'new_stock',
      'source_inventory_id', null,
      'cuts', jsonb_build_array(
        jsonb_build_object('cut_number', 1, 'segment_number', 2, 'cut_length_mm', 1200),
        jsonb_build_object('cut_number', 2, 'segment_number', 1, 'cut_length_mm', 300)
      )
    ))
  ));
  v_version_2 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan, v_input_v2, v_settings, v_segments, v_candidate_v2,
    1, v_actor, null, '{}'::jsonb
  );
  v_repeated_version_2 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan, v_input_v2, v_settings, v_segments, v_candidate_v2,
    1, v_actor, null, '{}'::jsonb
  );
  if v_version_2 = v_version_1 or v_repeated_version_2 is distinct from v_version_2 then
    raise exception 'Пересчёт нарушил версионность или идемпотентность';
  end if;
  select count(*) into v_count
  from public.long_stock_cutting_plan_versions where plan_id = v_plan;
  if v_count <> 2 then
    raise exception 'Ожидались ровно версии 1 и 2, получено %', v_count;
  end if;
  if (select version_number from public.long_stock_cutting_plan_versions where id = v_version_2) <> 2 then
    raise exception 'Пересчёт не получил номер версии 2';
  end if;
  if (select input_snapshot from public.long_stock_cutting_plan_versions where id = v_version_1)
    is distinct from v_snapshot_before then
    raise exception 'Пересчёт изменил версию 1';
  end if;
  if (select status from public.long_stock_cutting_candidate_bars where id = v_cut_bar) <> 'cut'
    or not exists (
      select 1 from public.long_stock_cutting_business_scraps
      where version_id = v_version_1 and bar_id = v_cut_bar and inventory_id = v_cut_scrap
    ) then
    raise exception 'Пересчёт затронул уже порезанный хлыст или его остаток';
  end if;

  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_stock_only_item, v_request, 40, 'S355', 300,
    v_material, v_variant
  );
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap, business_scrap_state
  ) values (
    v_stock_only_inventory, v_factory, v_material, v_variant, 400,
    400, 0, 'мм', 1, 0, 'шт',
    v_actor, true, 'available'
  );
  v_stock_only_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_stock_only_item
    )),
    v_actor
  );
  select id into v_stock_only_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_stock_only_plan and request_item_id = v_stock_only_item;
  v_stock_only_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_stock_only_plan,
    jsonb_build_object('case', 'stock-only'),
    v_settings,
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_stock_only_plan_item,
      'segment_number', 1,
      'required_length_mm', 300
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', false,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 0, 'net_parts_length_mm', 300,
        'kerf_loss_length_mm', 1, 'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 99,
        'purchased_weight_kg', 0, 'net_parts_weight_kg', 0.6,
        'kerf_loss_weight_kg', 0.002, 'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 0.198
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1, 'stock_length_mm', 400,
        'length_group', null, 'source_type', 'business_remnant',
        'source_inventory_id', v_stock_only_inventory,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 300
        ))
      ))
    )),
    1, v_actor, null, '{}'::jsonb
  );
  v_stock_pdf_metadata := jsonb_build_object(
    'schema_version', 1,
    'bucket_id', 'product-files',
    'object_path', format('long-stock-cutting-plans/%s/%s/%s.pdf', v_stock_only_plan, v_stock_only_version, gen_random_uuid()),
    'file_name', 'cutting-plan-' || (select plan_number from public.long_stock_cutting_plans where id = v_stock_only_plan) || '-v1.pdf',
    'mime_type', 'application/pdf',
    'size_bytes', 1024,
    'sha256', repeat('c', 64),
    'generated_by', v_actor,
    'generated_at', now()
  );
  v_approval := public.fn_approve_long_stock_cutting_plan_version_v2(v_stock_only_version, v_actor, v_stock_pdf_metadata);
  if v_approval->>'position_status' <> 'accepted'
    or (v_approval->>'purchase_required')::boolean is not false then
    raise exception 'Складской вариант не перевёл позицию в accepted: %', v_approval;
  end if;
  if not exists (
    select 1
    from public.long_stock_cutting_business_scraps link
    join public.inventory inventory on inventory.id = link.inventory_id
    where link.version_id = v_stock_only_version
      and inventory.piece_length_mm = 99
      and inventory.business_scrap_state = 'future'
  ) then
    raise exception 'Складской вариант не создал будущий остаток 99 мм';
  end if;

  begin
    perform public.fn_get_or_create_long_stock_cutting_plan_version_v2(
      v_plan,
      jsonb_build_object('case', 'overflow'),
      v_settings,
      jsonb_build_array(jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 1,
        'required_length_mm', 6000
      )),
      jsonb_build_array(jsonb_build_object(
        'candidate_number', 1,
        'is_complete', true,
        'metrics', jsonb_build_object(
          'purchased_length_mm', 6000, 'net_parts_length_mm', 6000,
          'kerf_loss_length_mm', 1, 'end_trim_loss_length_mm', 0,
          'business_scrap_length_mm', 0,
          'purchased_weight_kg', 0, 'net_parts_weight_kg', 0,
          'kerf_loss_weight_kg', 0, 'end_trim_loss_weight_kg', 0,
          'business_scrap_weight_kg', 0
        ),
        'bars', jsonb_build_array(jsonb_build_object(
          'bar_number', 7, 'stock_length_mm', 6000,
          'length_group', 'standard', 'source_type', 'new_stock',
          'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 6000
          ))
        ))
      )),
      1, v_actor, 'Проверка переполнения', '{}'::jsonb
    );
    raise exception 'Переполненный ручной хлыст был сохранён';
  exception when check_violation then
    if sqlerrm not like '%Переполнение хлыста №7: превышение 1 мм%' then raise; end if;
  end;

  begin
    perform public.fn_get_or_create_long_stock_cutting_plan_version_v2(
      v_plan,
      jsonb_build_object('case', 'missing-segment'),
      v_settings,
      v_segments,
      jsonb_build_array(jsonb_build_object(
        'candidate_number', 1,
        'is_complete', true,
        'metrics', jsonb_build_object(
          'purchased_length_mm', 6000, 'net_parts_length_mm', 300,
          'kerf_loss_length_mm', 1, 'end_trim_loss_length_mm', 0,
          'business_scrap_length_mm', 5699,
          'purchased_weight_kg', 0, 'net_parts_weight_kg', 0,
          'kerf_loss_weight_kg', 0, 'end_trim_loss_weight_kg', 0,
          'business_scrap_weight_kg', 0
        ),
        'bars', jsonb_build_array(jsonb_build_object(
          'bar_number', 1, 'stock_length_mm', 6000,
          'length_group', 'standard', 'source_type', 'new_stock',
          'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 300
          ))
        ))
      )),
      1, v_actor, 'Проверка потери', '{}'::jsonb
    );
    raise exception 'Ручная раскладка с потерей была сохранена';
  exception when check_violation then
    if sqlerrm not like '%Потеряны заготовки №2%' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_technologist uuid := gen_random_uuid();
  v_supply uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_request_item uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version_1 uuid;
  v_version_2 uuid;
  v_department_request uuid;
  v_settings jsonb;
  v_segments jsonb;
  v_candidate jsonb;
  v_pdf_metadata_1 jsonb;
  v_pdf_metadata_2 jsonb;
  v_result jsonb;
  v_status text;
  v_count integer;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_technologist, 'long-stock-return-technologist@example.test', 'Технолог возврата', 'technologist', v_factory, true),
    (v_supply, 'long-stock-return-supply@example.test', 'Снабжение возврата', 'supply_manager', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'LONG-STOCK-SUPPLY-RETURN', v_technologist);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_technologist);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Круг для возврата снабжением', 'circle', v_technologist);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (v_variant, v_material, 'circle', 32, 'S355', 6000, 2, 'мм');
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_request_item, v_request, 32, 'S355', 1200,
    v_material, v_variant
  );

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    v_technologist
  );
  select id into v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan;

  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_segments := jsonb_build_array(jsonb_build_object(
    'plan_item_id', v_plan_item,
    'segment_number', 1,
    'required_length_mm', 1200,
    'required_weight_kg', 2.4
  ));
  v_candidate := jsonb_build_array(jsonb_build_object(
    'candidate_number', 1,
    'is_complete', true,
    'metrics', jsonb_build_object(
      'purchased_length_mm', 6000,
      'net_parts_length_mm', 1200,
      'kerf_loss_length_mm', 1,
      'end_trim_loss_length_mm', 0,
      'business_scrap_length_mm', 4799,
      'purchased_weight_kg', 12,
      'net_parts_weight_kg', 2.4,
      'kerf_loss_weight_kg', 0.002,
      'end_trim_loss_weight_kg', 0,
      'business_scrap_weight_kg', 9.598
    ),
    'bars', jsonb_build_array(jsonb_build_object(
      'bar_number', 1,
      'stock_length_mm', 6000,
      'length_group', 'standard',
      'source_type', 'new_stock',
      'source_inventory_id', null,
      'cuts', jsonb_build_array(jsonb_build_object(
        'cut_number', 1,
        'segment_number', 1,
        'cut_length_mm', 1200
      ))
    ))
  ));

  v_version_1 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'supply-return-v1'),
    v_settings,
    v_segments,
    v_candidate,
    1,
    v_technologist,
    null,
    '{}'::jsonb
  );
  v_pdf_metadata_1 := jsonb_build_object(
    'schema_version', 1,
    'bucket_id', 'product-files',
    'object_path', format('long-stock-cutting-plans/%s/%s/%s.pdf', v_plan, v_version_1, gen_random_uuid()),
    'file_name', 'cutting-plan-' || (select plan_number from public.long_stock_cutting_plans where id = v_plan) || '-v1.pdf',
    'mime_type', 'application/pdf',
    'size_bytes', 1024,
    'sha256', repeat('d', 64),
    'generated_by', v_technologist,
    'generated_at', now()
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v2(
    v_version_1,
    v_technologist,
    v_pdf_metadata_1
  );

  v_result := public.fn_return_long_stock_position_to_technologist_v1(
    'request_circle',
    v_request_item,
    '6000 мм недоступен у выбранного поставщика',
    v_supply
  );
  v_department_request := (v_result->>'department_request_id')::uuid;

  if v_department_request is null then
    raise exception 'Возврат снабжения не создал запрос технологу';
  end if;
  if not exists (
    select 1 from public.department_requests request
    where request.id = v_department_request
      and request.request_kind = 'long_stock_recalculation'
      and request.request_item_table = 'request_circle'
      and request.request_item_id = v_request_item
      and request.technologist_request_id = v_request
      and request.long_stock_plan_id = v_plan
      and request.long_stock_returned_version_id = v_version_1
      and request.created_by = v_supply
      and request.assigned_to = v_technologist
      and request.status = 'in_progress'
  ) then
    raise exception 'Запрос не сохранил точную ссылку на возвращённую позицию';
  end if;
  if not exists (
    select 1 from public.tasks task
    where task.department_request_id = v_department_request
      and task.assigned_to = v_technologist
      and task.status = 'in_progress'
  ) then
    raise exception 'Технологу не создана задача на пересчёт';
  end if;
  if not exists (
    select 1 from public.notifications notification
    where notification.related_department_request_id = v_department_request
      and notification.user_id = v_technologist
  ) then
    raise exception 'Технолог не получил уведомление о возврате';
  end if;
  if (select status from public.long_stock_cutting_plan_versions where id = v_version_1) <> 'invalid'
    or (select invalidation_department_request_id from public.long_stock_cutting_plan_versions where id = v_version_1)
      is distinct from v_department_request then
    raise exception 'Возвращённая версия не стала недействительной со ссылкой на запрос';
  end if;
  if (select cutting_status from public.long_stock_cutting_plan_items where id = v_plan_item)
    <> 'requires_recalculation' then
    raise exception 'Позиция не получила статус requires_recalculation';
  end if;

  begin
    perform public.fn_assert_long_stock_cutting_ready(v_machine);
    raise exception 'Резка позиции, требующей пересчёта, осталась доступна';
  exception when raise_exception then
    if sqlerrm = 'Резка позиции, требующей пересчёта, осталась доступна'
      or sqlerrm not like '%требует пересчёта%' then
      raise;
    end if;
  end;

  select count(*) into v_count
  from public.inventory inventory_row
  join public.long_stock_cutting_business_scraps scrap_link
    on scrap_link.inventory_id = inventory_row.id
  where scrap_link.version_id = v_version_1
    and inventory_row.deleted_at is null;
  if v_count <> 0 then
    raise exception 'Будущие остатки недействительной версии остались активными';
  end if;

  v_version_2 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object(
      'case', 'supply-return-v2',
      'recalculation', jsonb_build_object(
        'source_version_id', v_version_1,
        'source_version_number', 1,
        'accepted_lengths_mm', jsonb_build_array(6000)
      )
    ),
    v_settings,
    v_segments,
    v_candidate,
    1,
    v_technologist,
    null,
    '{}'::jsonb
  );
  v_pdf_metadata_2 := jsonb_build_object(
    'schema_version', 1,
    'bucket_id', 'product-files',
    'object_path', format('long-stock-cutting-plans/%s/%s/%s.pdf', v_plan, v_version_2, gen_random_uuid()),
    'file_name', 'cutting-plan-' || (select plan_number from public.long_stock_cutting_plans where id = v_plan) || '-v2.pdf',
    'mime_type', 'application/pdf',
    'size_bytes', 1024,
    'sha256', repeat('e', 64),
    'generated_by', v_technologist,
    'generated_at', now()
  );
  v_result := public.fn_approve_long_stock_cutting_plan_version_v2(
    v_version_2,
    v_technologist,
    v_pdf_metadata_2
  );

  if (select status from public.long_stock_cutting_plan_versions where id = v_version_1) <> 'invalid'
    or (select status from public.long_stock_cutting_plan_versions where id = v_version_2) <> 'approved'
    or (select version_number from public.long_stock_cutting_plan_versions where id = v_version_2) <> 2 then
    raise exception 'Новое утверждение нарушило историю версий';
  end if;
  if (select cutting_status from public.long_stock_cutting_plan_items where id = v_plan_item)
    <> 'plan_approved' then
    raise exception 'После версии 2 позиция не вернулась в plan_approved';
  end if;
  select status into v_status
  from public.department_requests where id = v_department_request;
  if v_status <> 'done' then
    raise exception 'Новое утверждение не закрыло запрос снабжения: %', v_status;
  end if;
  if not exists (
    select 1 from public.tasks task
    where task.department_request_id = v_department_request
      and task.status = 'completed'
  ) then
    raise exception 'Новое утверждение не закрыло задачу пересчёта';
  end if;
  if not exists (
    select 1 from public.notifications notification
    where notification.related_department_request_id = v_department_request
      and notification.user_id = v_supply
      and notification.type = 'department_request_status_technologist'
  ) then
    raise exception 'Снабжение не получило уведомление об утверждении новой версии';
  end if;
  perform public.fn_assert_long_stock_cutting_ready(v_machine);
end;
$$;

do $$
declare
  v_actor uuid := '78000000-0000-0000-0000-000000000001';
  v_factory uuid := '78000000-0000-0000-0000-000000000002';
  v_material uuid := '78000000-0000-0000-0000-000000000003';
  v_variant uuid := '78000000-0000-0000-0000-000000000004';
  v_inventory uuid := '78000000-0000-0000-0000-000000000005';
  v_steel_type uuid;
  v_density numeric;
  v_weight numeric;
  v_expected numeric;
begin
  select id, density_kg_mm3
  into v_steel_type, v_density
  from public.steel_types
  where density_kg_mm3 > 0
  order by name
  limit 1;

  if v_steel_type is null then
    raise exception 'Для теста веса ножа не найдена плотность стали';
  end if;

  insert into public.factories(id, name)
  values (v_factory, 'Measured knife weight factory');
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'measured-knife-weight@example.test', 'Тест веса ножа', 'technologist', v_factory, true);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Тестовый мерный нож', 'knives', v_actor);
  insert into public.material_variants(
    id, material_id, category, steel_type_id, knife_bevel_count,
    width_mm, height_mm, default_unit
  ) values (
    v_variant, v_material, 'knives', v_steel_type, 1,
    300, 20, 'мм'
  );

  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    calculated_weight_kg, is_business_scrap, business_scrap_state,
    last_updated_by
  ) values (
    v_inventory, v_factory, v_material, v_variant, 95,
    95, 0, 'мм', 1, 0, 'шт',
    1333.8, true, 'future', v_actor
  );

  select calculated_weight_kg into v_weight
  from public.inventory
  where id = v_inventory;
  v_expected := round((95 * 300 * 20 * v_density)::numeric, 2);
  if v_weight is distinct from v_expected then
    raise exception 'Вес остатка 95 мм рассчитан неверно: expected=%, actual=%',
      v_expected, v_weight;
  end if;

  v_weight := public.calc_inventory_weight_kg(
    v_material, v_variant, 2497, 'мм', 2497, 1
  );
  v_expected := round((2497 * 300 * 20 * v_density)::numeric, 2);
  if v_weight is distinct from v_expected then
    raise exception 'Вес остатка 2497 мм рассчитан неверно: expected=%, actual=%',
      v_expected, v_weight;
  end if;
end;
$$;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'orphan-cutting-readiness@example.test', 'Orphan readiness test', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'ORPHAN-CUTTING-READINESS', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_actor);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Orphan readiness circle', 'circle', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (v_variant, v_material, 'circle', 20, 'S355', 6000, 1, 'шт');
  insert into public.long_stock_cutting_plans(
    id, material_variant_id, layout_category_key, created_by
  ) values (v_plan, v_variant, 'circle', v_actor);
  -- Simulate a row created before the request-item identity guard existed.
  alter table public.long_stock_cutting_plan_items
    disable trigger long_stock_cutting_plan_item_guard_trigger;
  insert into public.long_stock_cutting_plan_items(
    plan_id, request_item_table, request_item_id, request_id, linked_by
  ) values (v_plan, 'request_circle', gen_random_uuid(), v_request, v_actor);
  alter table public.long_stock_cutting_plan_items
    enable trigger long_stock_cutting_plan_item_guard_trigger;

  perform public.fn_assert_long_stock_cutting_ready(v_machine);
end;
$$;

rollback;

\echo '[long-stock-cutting-plan-server] all assertions passed'
