\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.long_stock_pdf(p_version_id uuid, p_actor uuid)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'bucket_id', 'product-files',
    'object_path', format(
      'long-stock-cutting-plans/%s/%s/%s.pdf',
      version.plan_id,
      version.id,
      gen_random_uuid()
    ),
    'file_name', format('cutting-plan-%s-v%s.pdf', plan.plan_number, version.version_number),
    'mime_type', 'application/pdf',
    'size_bytes', 1024,
    'sha256', repeat('d', 64),
    'generated_by', p_actor,
    'generated_at', now()
  )
  from public.long_stock_cutting_plan_versions version
  join public.long_stock_cutting_plans plan on plan.id = version.plan_id
  where version.id = p_version_id;
$$;

create or replace function pg_temp.create_single_source_version(
  p_variant_id uuid,
  p_request_item_id uuid,
  p_actor uuid,
  p_source_inventory_id uuid,
  p_source_type text,
  p_stock_length numeric,
  p_cut_length numeric,
  p_case text
)
returns uuid
language plpgsql
as $$
declare
  v_plan_id uuid;
  v_plan_item_id uuid;
  v_version_id uuid;
  v_remainder numeric := p_stock_length - p_cut_length - 1;
begin
  v_plan_id := public.fn_create_long_stock_cutting_plan(
    p_variant_id,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', p_request_item_id
    )),
    p_actor
  );
  select id into strict v_plan_item_id
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan_id and request_item_id = p_request_item_id;

  v_version_id := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan_id,
    jsonb_build_object('case', p_case),
    public.fn_get_long_stock_layout_settings_snapshot(),
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_plan_item_id,
      'segment_number', 1,
      'required_length_mm', p_cut_length,
      'required_weight_kg', 0
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 0,
        'net_parts_length_mm', p_cut_length,
        'kerf_loss_length_mm', 1,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', v_remainder,
        'purchased_weight_kg', 0,
        'net_parts_weight_kg', 0,
        'kerf_loss_weight_kg', 0,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 0
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', p_stock_length,
        'length_group', null,
        'source_type', p_source_type,
        'source_inventory_id', p_source_inventory_id,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1,
          'segment_number', 1,
          'cut_length_mm', p_cut_length
        ))
      ))
    )),
    1,
    p_actor,
    null,
    '{}'::jsonb
  );
  return v_version_id;
end;
$$;

create or replace function pg_temp.create_purchase_version(
  p_variant_id uuid,
  p_request_item_id uuid,
  p_actor uuid,
  p_stock_length numeric,
  p_cut_length numeric,
  p_case text
)
returns uuid
language plpgsql
as $$
declare
  v_plan_id uuid;
  v_plan_item_id uuid;
begin
  v_plan_id := public.fn_create_long_stock_cutting_plan(
    p_variant_id,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', p_request_item_id
    )),
    p_actor
  );
  select id into strict v_plan_item_id
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan_id and request_item_id = p_request_item_id;
  return public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan_id,
    jsonb_build_object('case', p_case),
    public.fn_get_long_stock_layout_settings_snapshot(),
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_plan_item_id,
      'segment_number', 1,
      'required_length_mm', p_cut_length,
      'required_weight_kg', 0
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', p_stock_length,
        'net_parts_length_mm', p_cut_length,
        'kerf_loss_length_mm', 1,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', p_stock_length - p_cut_length - 1,
        'purchased_weight_kg', 0,
        'net_parts_weight_kg', 0,
        'kerf_loss_weight_kg', 0,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 0
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', p_stock_length,
        'length_group', 'standard',
        'source_type', 'new_stock',
        'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1,
          'segment_number', 1,
          'cut_length_mm', p_cut_length
        ))
      ))
    )),
    1, p_actor, null, '{}'::jsonb
  );
end;
$$;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_supply_actor uuid := gen_random_uuid();
  v_factory_a uuid;
  v_factory_b uuid := gen_random_uuid();
  v_machine_a uuid := gen_random_uuid();
  v_machine_b uuid := gen_random_uuid();
  v_machine_c uuid := gen_random_uuid();
  v_machine_d uuid := gen_random_uuid();
  v_request_a uuid := gen_random_uuid();
  v_request_b uuid := gen_random_uuid();
  v_request_conflict uuid := gen_random_uuid();
  v_request_c uuid := gen_random_uuid();
  v_request_d uuid := gen_random_uuid();
  v_item_a uuid := gen_random_uuid();
  v_item_b uuid := gen_random_uuid();
  v_item_conflict uuid := gen_random_uuid();
  v_item_c uuid := gen_random_uuid();
  v_item_d uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_inventory uuid := gen_random_uuid();
  v_mismatch_inventory uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_future_version uuid;
  v_chain_version uuid;
  v_conflict_version uuid;
  v_mismatch_version uuid;
  v_mismatch_version_2 uuid;
  v_mismatch_plan uuid;
  v_mismatch_plan_item uuid;
  v_mismatch_replacement_request uuid;
  v_mismatch_replacement_item uuid;
  v_future_inventory uuid;
  v_chain_inventory uuid;
  v_transfer_id uuid;
  v_transfer_item_id uuid;
  v_count integer;
  v_lengths numeric[];
  v_replacement jsonb;
  v_reconciliation jsonb;
  v_approval jsonb;
begin
  select id into v_factory_a from public.factories order by created_at nulls last limit 1;
  if v_factory_a is null then raise exception 'Не найден тестовый завод'; end if;
  insert into public.factories(id, name, city)
  values (v_factory_b, 'SELECTED-SOURCE-FACTORY-B', 'Тестовый город');
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_actor, 'selected-source@example.test', 'Технолог источников', 'technologist', v_factory_a, true),
    (v_supply_actor, 'selected-source-supply@example.test', 'Снабжение источников', 'supply_manager', v_factory_b, true);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.machines(id, factory_id, name, created_by)
  values
    (v_machine_a, v_factory_a, 'SELECTED-SOURCE-A', v_actor),
    (v_machine_b, v_factory_b, 'SELECTED-SOURCE-B', v_actor),
    (v_machine_c, v_factory_b, 'SELECTED-SOURCE-C', v_actor),
    (v_machine_d, v_factory_a, 'SELECTED-SOURCE-D', v_actor);
  update public.production_stages
  set date_start = case machine_id
        when v_machine_a then '2026-09-10'::date
        when v_machine_b then '2026-09-20'::date
        else '2026-09-30'::date
      end,
      updated_by = v_actor
  where machine_id in (v_machine_a, v_machine_b, v_machine_c, v_machine_d)
    and stage_type = 'cutting';
  insert into public.technologist_requests(id, machine_id, created_by)
  values
    (v_request_a, v_machine_a, v_actor),
    (v_request_b, v_machine_b, v_actor),
    (v_request_conflict, v_machine_a, v_actor),
    (v_request_c, v_machine_c, v_actor),
    (v_request_d, v_machine_d, v_actor);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Круг выбора складских хлыстов', 'circle', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (v_variant, v_material, 'circle', 40, 'S355', 8500, 2, 'мм');
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values
    (v_item_a, v_request_a, 40, 'S355', 12000, v_material, v_variant),
    (v_item_b, v_request_b, 40, 'S355', 2000, v_material, v_variant),
    (v_item_conflict, v_request_conflict, 40, 'S355', 6000, v_material, v_variant),
    (v_item_c, v_request_c, 40, 'S355', 300, v_material, v_variant),
    (v_item_d, v_request_d, 40, 'S355', 6000, v_material, v_variant);
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap, business_scrap_state
  ) values (
    v_inventory, v_factory_a, v_material, v_variant, 8500,
    17000, 0, 'мм', 2, 0, 'шт',
    v_actor, false, 'available'
  );

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_item_a
    )),
    v_actor
  );
  select id into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan and request_item_id = v_item_a;
  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'two-bars-one-row'),
    public.fn_get_long_stock_layout_settings_snapshot(),
    jsonb_build_array(
      jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', 1, 'required_length_mm', 6000, 'required_weight_kg', 12),
      jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', 2, 'required_length_mm', 6000, 'required_weight_kg', 12)
    ),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 0,
        'net_parts_length_mm', 12000,
        'kerf_loss_length_mm', 2,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 4998,
        'purchased_weight_kg', 0,
        'net_parts_weight_kg', 24,
        'kerf_loss_weight_kg', 0.004,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 9.996
      ),
      'bars', jsonb_build_array(
        jsonb_build_object(
          'bar_number', 1, 'stock_length_mm', 8500,
          'length_group', null, 'source_type', 'warehouse_stock',
          'source_inventory_id', v_inventory,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 6000
          ))
        ),
        jsonb_build_object(
          'bar_number', 2, 'stock_length_mm', 8500,
          'length_group', null, 'source_type', 'warehouse_stock',
          'source_inventory_id', v_inventory,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 2, 'cut_length_mm', 6000
          ))
        )
      )
    )),
    1, v_actor, null, '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v2(
    v_version, v_actor, pg_temp.long_stock_pdf(v_version, v_actor)
  );

  select count(*) into v_count
  from public.inventory_reservations reservation
  where reservation.source_inventory_id = v_inventory
    and reservation.request_item_id = v_item_a
    and reservation.consumed_at is null
    and reservation.reserved_quantity = 8500
    and reservation.reserved_secondary_quantity = 1
    and reservation.logical_reserved_quantity = 6001;
  if v_count <> 2 then raise exception 'Ожидались два точных физических резерва, получено %', v_count; end if;
  if (select reserved_quantity from public.inventory where id = v_inventory) <> 17000
    or (select reserved_secondary_quantity from public.inventory where id = v_inventory) <> 2 then
    raise exception 'Агрегированная складская строка зарезервирована не полностью';
  end if;
  select count(*), array_agg(inventory_row.piece_length_mm order by inventory_row.id)
  into v_count, v_lengths
  from public.long_stock_cutting_business_scraps scrap_link
  join public.inventory inventory_row on inventory_row.id = scrap_link.inventory_id
  where scrap_link.version_id = v_version;
  if v_count <> 2 or v_lengths is distinct from array[2499::numeric, 2499::numeric] then
    raise exception 'Будущие остатки должны быть 2499 + 2499 мм, получено %', v_lengths;
  end if;
  if exists (
    select 1
    from public.long_stock_cutting_business_scraps scrap_link
    join public.inventory inventory_row on inventory_row.id = scrap_link.inventory_id
    where scrap_link.version_id = v_version
      and (
        inventory_row.source_inventory_id is distinct from v_inventory
        or inventory_row.source_reservation_id is null
        or inventory_row.total_quantity is distinct from 2499::numeric
        or inventory_row.total_secondary_quantity is distinct from 1::numeric
      )
  ) then
    raise exception 'Будущий остаток потерял происхождение или физические величины';
  end if;

  -- A second approval sees the row after the first transaction has reserved
  -- both pieces. Its subtransaction rolls back without partial effects.
  v_conflict_version := pg_temp.create_single_source_version(
    v_variant, v_item_conflict, v_actor, v_inventory,
    'warehouse_stock', 8500, 6000, 'conflict'
  );
  v_approval := public.fn_approve_long_stock_cutting_plan_version_v2(
    v_conflict_version, v_actor, pg_temp.long_stock_pdf(v_conflict_version, v_actor)
  );
  if v_approval->>'status' is distinct from 'conflict'
    or v_approval->>'message' not like '%уже занят другим технологом%' then
    raise exception 'Конфликт источника не вернул контролируемый результат: %', v_approval;
  end if;
  if exists (select 1 from public.long_stock_cutting_plan_versions where id = v_conflict_version)
    or exists (select 1 from public.inventory_reservations where request_item_id = v_item_conflict)
    or exists (select 1 from public.long_stock_cutting_business_scraps where version_id = v_conflict_version) then
    raise exception 'Конфликт оставил частичную версию, резерв или будущий остаток';
  end if;

  select scrap_link.inventory_id into strict v_future_inventory
  from public.long_stock_cutting_business_scraps scrap_link
  join public.inventory inventory_row on inventory_row.id = scrap_link.inventory_id
  where scrap_link.version_id = v_version
    and inventory_row.piece_length_mm = 2499
  order by scrap_link.inventory_id
  limit 1;
  v_future_version := pg_temp.create_single_source_version(
    v_variant, v_item_b, v_actor, v_future_inventory,
    'future_business_remnant', 2499, 2000, 'future-cross-factory'
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v2(
    v_future_version, v_actor, pg_temp.long_stock_pdf(v_future_version, v_actor)
  );
  select transfer_item.transfer_id, transfer_item.id
  into strict v_transfer_id, v_transfer_item_id
  from public.long_stock_cutting_source_dependencies dependency
  join public.inventory_transfer_items transfer_item on transfer_item.id = dependency.transfer_item_id
  where dependency.consumer_version_id = v_future_version
    and dependency.producer_version_id = v_version
    and dependency.producer_cutting_date = '2026-09-10'
    and dependency.consumer_cutting_date = '2026-09-20'
    and dependency.status = 'waiting_for_source';

  begin
    perform public.fn_receive_inventory_transfer(
      v_transfer_id,
      jsonb_build_array(jsonb_build_object('item_id', v_transfer_item_id, 'quantity', 2499)),
      v_actor
    );
    raise exception 'Будущий перевод был принят до исходной порезки';
  exception when raise_exception then
    if sqlerrm = 'Будущий перевод был принят до исходной порезки'
      or sqlerrm not like '%будущий остаток ещё не подтверждён%' then
      raise;
    end if;
  end;
  begin
    perform public.fn_assert_long_stock_cutting_ready(v_machine_b);
    raise exception 'Потребляющая порезка разрешена до появления будущего остатка';
  exception when raise_exception then
    if sqlerrm = 'Потребляющая порезка разрешена до появления будущего остатка'
      or sqlerrm not like '%будущий остаток не появился%' then
      raise;
    end if;
  end;

  update public.inventory
  set business_scrap_state = 'available', updated_at = now()
  where id = v_future_inventory;
  if (select status from public.long_stock_cutting_source_dependencies where consumer_version_id = v_future_version)
    <> 'ready_for_transfer' then
    raise exception 'Факт исходной порезки не открыл зависимость для перевода';
  end if;
  perform public.fn_receive_inventory_transfer(
    v_transfer_id,
    jsonb_build_array(jsonb_build_object('item_id', v_transfer_item_id, 'quantity', 2499)),
    v_actor
  );
  if (select received_quantity from public.inventory_transfer_items where id = v_transfer_item_id) <> 2499 then
    raise exception 'Перевод будущего остатка не принят после исходного факта';
  end if;

  select scrap_link.inventory_id into strict v_chain_inventory
  from public.long_stock_cutting_business_scraps scrap_link
  join public.inventory inventory_row on inventory_row.id = scrap_link.inventory_id
  where scrap_link.version_id = v_future_version
    and inventory_row.piece_length_mm = 498;
  v_chain_version := pg_temp.create_single_source_version(
    v_variant, v_item_c, v_actor, v_chain_inventory,
    'future_business_remnant', 498, 300, 'future-chain-level-2'
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v2(
    v_chain_version, v_actor, pg_temp.long_stock_pdf(v_chain_version, v_actor)
  );

  -- Moving the middle cutting date ahead of its producer invalidates the
  -- middle plan and recursively the still-uncut third level.
  update public.production_stages
  set date_start = '2026-09-05', updated_by = v_actor
  where machine_id = v_machine_b and stage_type = 'cutting';
  if (select status from public.long_stock_cutting_plan_versions where id = v_future_version) <> 'invalid'
    or (select status from public.long_stock_cutting_plan_versions where id = v_chain_version) <> 'invalid' then
    raise exception 'Изменение даты не выполнило многоуровневый каскад';
  end if;
  if exists (
    select 1
    from public.long_stock_cutting_source_dependencies dependency
    where dependency.consumer_version_id in (v_future_version, v_chain_version)
      and dependency.status <> 'invalidated'
  ) then
    raise exception 'Каскад оставил активную зависимость';
  end if;
  if exists (
    select 1 from public.inventory_reservations
    where request_item_id in (v_item_b, v_item_c) and consumed_at is null
  ) then
    raise exception 'Каскад оставил физические резервы зависимых планов';
  end if;
  if (
    select count(*)
    from public.tasks
    where long_stock_cutting_plan_version_id in (v_future_version, v_chain_version)
      and task_type = 'long_stock_cutting_recalculation'
      and status in ('pending', 'in_progress')
  ) <> 2 then
    raise exception 'Каскад не создал две задачи пересчёта';
  end if;
  if (
    select count(*)
    from public.department_requests
    where long_stock_returned_version_id in (v_future_version, v_chain_version)
      and request_kind = 'long_stock_recalculation'
      and status = 'in_progress'
  ) <> 2 then
    raise exception 'Каскад не открыл две штатные заявки пересчёта';
  end if;
  if (select available_from_date from public.inventory where id = v_chain_inventory)
    is distinct from '2026-09-05'::date then
    raise exception 'Плановая дата будущего остатка не синхронизирована с исходной порезкой';
  end if;

  v_replacement := public.fn_prepare_long_stock_recalculation_replacement_v1(
    'request_circle', v_item_c, v_chain_version,
    'supply_return', array[8500::numeric], v_actor
  );
  if v_replacement->>'status' is distinct from 'replacement_staging'
    or (select status from public.long_stock_cutting_plan_versions where id = v_chain_version) <> 'invalid'
    or (select version_number from public.long_stock_cutting_plan_versions where id = v_chain_version) <> 1 then
    raise exception 'Пересчёт зависимости не сохранил версию №1 и staging для версии №2';
  end if;

  -- A legacy approved purchase layout may later receive a different physical
  -- reservation. Reconciliation preserves that reservation, invalidates only
  -- the unstarted version 1 and opens planning recovery for version 2.
  v_mismatch_version := pg_temp.create_purchase_version(
    v_variant, v_item_d, v_actor, 8500, 6000, 'legacy-mismatched-source'
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v2(
    v_mismatch_version, v_actor, pg_temp.long_stock_pdf(v_mismatch_version, v_actor)
  );
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap, business_scrap_state
  ) values (
    v_mismatch_inventory, v_factory_a, v_material, v_variant, 7000,
    7000, 7000, 'мм', 1, 1, 'шт',
    v_actor, false, 'available'
  );
  insert into public.inventory_reservations(
    inventory_id, source_inventory_id, material_id, material_variant_id,
    machine_id, request_item_table, request_item_id,
    reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity,
    reserved_by, original_piece_length_mm, is_cut_reservation, reservation_source
  ) values (
    v_mismatch_inventory, v_mismatch_inventory, v_material, v_variant,
    v_machine_d, 'request_circle', v_item_d,
    7000, 6001, 1, v_actor, 7000, false, 'stock'
  );

  if has_function_privilege('anon', 'public.fn_reserve_long_stock_selected_sources_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_reserve_long_stock_selected_sources_v1(uuid,uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.fn_reserve_long_stock_selected_sources_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.fn_reserve_future_business_scrap_for_machine(uuid,uuid,numeric,text,uuid,uuid,numeric)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_reserve_future_business_scrap_for_machine(uuid,uuid,numeric,text,uuid,uuid,numeric)', 'EXECUTE') then
    raise exception 'ACL новых и связанных RPC допускает прямой браузерный вызов';
  end if;
  if has_table_privilege('anon', 'public.long_stock_cutting_source_dependencies', 'SELECT')
    or has_table_privilege('authenticated', 'public.long_stock_cutting_source_dependencies', 'SELECT') then
    raise exception 'Таблица зависимостей доступна браузерной роли';
  end if;
  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'fn_reserve_long_stock_selected_sources_v1',
        'fn_invalidate_long_stock_dependency_v1',
        'fn_invalidate_long_stock_dependency_consumers_v1'
      )
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      )
  ) then
    raise exception 'Одна из сигнатур новых RPC доступна не только серверной роли';
  end if;

  v_reconciliation := public.fn_reconcile_approved_long_stock_sources_v1(false);
  if (v_reconciliation->>'matched')::integer <> 1
    or (v_reconciliation->>'manual_review_required')::integer <> 1
    or (v_reconciliation->>'invalidated')::integer <> 0 then
    raise exception 'Предварительная сверка старой версии дала неверный результат: %', v_reconciliation;
  end if;
  if exists (select 1 from public.long_stock_cutting_source_reconciliations) then
    raise exception 'Предварительная сверка создала записи';
  end if;

  v_reconciliation := public.fn_reconcile_approved_long_stock_sources_v1(true);
  if (v_reconciliation->>'matched')::integer <> 1
    or (v_reconciliation->>'invalidated')::integer <> 1
    or (select status from public.long_stock_cutting_plan_versions where id = v_version) <> 'approved'
    or (select count(*) from public.long_stock_cutting_reconciled_source_bars where version_id = v_version) <> 2 then
    raise exception 'Совпавшая старая версия не получила две дополнительные физические связи: %', v_reconciliation;
  end if;
  if (select status from public.long_stock_cutting_plan_versions where id = v_mismatch_version) <> 'invalid'
    or (select version_number from public.long_stock_cutting_plan_versions where id = v_mismatch_version) <> 1
    or not exists (
      select 1 from public.long_stock_cutting_plan_items
      where plan_id = (select plan_id from public.long_stock_cutting_plan_versions where id = v_mismatch_version)
        and cutting_status = 'requires_recalculation'
    )
    or not exists (
      select 1 from public.inventory_reservations
      where request_item_id = v_item_d and consumed_at is null and original_piece_length_mm = 7000
  ) then
    raise exception 'Несовпавшая версия не сохранила версию №1 и физический резерв для восстановления';
  end if;

  select version.plan_id, item.id
  into strict v_mismatch_plan, v_mismatch_plan_item
  from public.long_stock_cutting_plan_versions version
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where version.id = v_mismatch_version;
  v_replacement := public.fn_prepare_long_stock_recalculation_replacement_v1(
    'request_circle', v_item_d, v_mismatch_version,
    'inventory_reconciliation', array[7000::numeric], v_actor
  );
  v_mismatch_replacement_request := (v_replacement->>'replacement_request_id')::uuid;
  v_mismatch_replacement_item := (v_replacement->>'replacement_request_item_id')::uuid;
  v_mismatch_version_2 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_mismatch_plan,
    jsonb_build_object(
      'case', 'legacy-mismatch-version-2',
      'mode', 'mixed',
      'available_stock_sources', '[]'::jsonb,
      'recalculation', jsonb_build_object(
        'source_version_id', v_mismatch_version,
        'source_version_number', 1,
        'source_kind', 'inventory_reconciliation',
        'source_request_id', v_request_d,
        'source_request_item', jsonb_build_object('table', 'request_circle', 'id', v_item_d),
        'replacement_id', (v_replacement->>'replacement_id')::uuid,
        'replacement_request_id', v_mismatch_replacement_request,
        'replacement_request_item', jsonb_build_object(
          'table', 'request_circle', 'id', v_mismatch_replacement_item
        ),
        'allowed_lengths_mm', jsonb_build_array(7000),
        'accepted_lengths_mm', jsonb_build_array(7000)
      )
    ),
    public.fn_get_long_stock_layout_settings_snapshot(),
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_mismatch_plan_item,
      'segment_number', 1,
      'required_length_mm', 6000,
      'required_weight_kg', 0
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 7000,
        'net_parts_length_mm', 6000,
        'kerf_loss_length_mm', 1,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 999,
        'purchased_weight_kg', 0,
        'net_parts_weight_kg', 0,
        'kerf_loss_weight_kg', 0,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 0
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', 7000,
        'length_group', 'standard',
        'source_type', 'new_stock',
        'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 6000
        ))
      ))
    )),
    1, v_actor, null, '{}'::jsonb
  );
  perform public.fn_approve_long_stock_recalculation_replacement_v1(
    v_mismatch_version_2, v_actor,
    pg_temp.long_stock_pdf(v_mismatch_version_2, v_actor)
  );
  if (select version_number from public.long_stock_cutting_plan_versions where id = v_mismatch_version_2) <> 2
    or (select status from public.long_stock_cutting_plan_versions where id = v_mismatch_version_2) <> 'approved'
    or (select status from public.long_stock_cutting_plan_versions where id = v_mismatch_version) <> 'invalid'
    or not exists (
      select 1 from public.inventory_reservations
      where request_item_id = v_mismatch_replacement_item
        and original_piece_length_mm = 7000
        and consumed_at is null
    ) then
    raise exception 'Версия №2 не восстановила фактический источник при сохранённой версии №1';
  end if;
  if (public.fn_reconcile_approved_long_stock_sources_v1(true)->'details') <> '[]'::jsonb then
    raise exception 'Повторная сверка старых версий неидемпотентна';
  end if;
  if has_function_privilege('anon', 'public.fn_reconcile_approved_long_stock_sources_v1(boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_reconcile_approved_long_stock_sources_v1(boolean)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.fn_reconcile_approved_long_stock_sources_v1(boolean)', 'EXECUTE') then
    raise exception 'RPC сверки старых версий доступен не только серверной роли';
  end if;
end;
$$;

rollback;
