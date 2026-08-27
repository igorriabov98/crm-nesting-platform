\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.run_replacement_case(
  p_category text,
  p_source_kind text
)
returns void
language plpgsql
as $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_source_factory uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_other_item uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version_1 uuid;
  v_version_2 uuid;
  v_settings jsonb;
  v_category_key text;
  v_allowed_lengths numeric[];
  v_stock_length numeric;
  v_replacement jsonb;
  v_replacement_id uuid;
  v_replacement_request uuid;
  v_replacement_item uuid;
  v_approval jsonb;
  v_pdf jsonb;
  v_schedule uuid := gen_random_uuid();
  v_parent_schedule uuid := gen_random_uuid();
  v_transfer uuid := gen_random_uuid();
  v_transfer_item uuid := gen_random_uuid();
  v_inventory uuid := gen_random_uuid();
  v_reservation uuid := gen_random_uuid();
  v_consumed_reservation uuid := gen_random_uuid();
  v_count integer;
  v_error text;
begin
  if p_category not in ('circle', 'pipe', 'knives')
    or p_source_kind not in ('supply_return', 'supply_receipt', 'inventory_transfer') then
    raise exception 'Некорректная матрица теста: % / %', p_category, p_source_kind;
  end if;

  select id into v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    format('replacement-%s-%s-%s@example.test', p_category, p_source_kind, v_actor),
    format('Технолог %s %s', p_category, p_source_kind),
    'technologist',
    v_factory,
    true
  );
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, format('REPLACEMENT-%s-%s', p_category, p_source_kind), v_actor);
  insert into public.technologist_requests(
    id, machine_id, created_by, status, submitted_at
  ) values (v_request, v_machine, v_actor, 'submitted_to_supply', now());
  insert into public.materials(id, name, category, created_by)
  values (v_material, format('Материал %s %s', p_category, p_source_kind), p_category::public.material_category, v_actor);
  insert into public.request_components(
    id, request_id, component_name, quantity_needed, unit, order_status
  ) values (
    v_other_item, v_request, 'Контрольная неизменяемая позиция', 2, 'шт', 'ordered'
  );

  if p_category = 'circle' then
    insert into public.material_variants(
      id, material_id, category, diameter_mm, material_grade,
      standard_length_mm, weight_per_m_kg, default_unit
    ) values (v_variant, v_material, 'circle', 40, 'S355', 6000, 1, 'мм');
    insert into public.request_circle(
      id, request_id, diameter_mm, steel_grade, remainder_mm,
      material_id, material_variant_id, order_status
    ) values (v_item, v_request, 40, 'S355', 1000, v_material, v_variant, 'ordered');
  elsif p_category = 'pipe' then
    insert into public.material_variants(
      id, material_id, category, pipe_type, piece_description,
      wall_thickness_mm, material_grade, standard_length_mm,
      weight_per_m_kg, default_unit
    ) values (
      v_variant, v_material, 'pipe', 'round', 'Ø 40', 2, 'S355', 6000, 1, 'мм'
    );
    insert into public.request_pipe(
      id, request_id, pipe_type, diameter_mm, wall_thickness_mm,
      remainder_length_mm, remainder_qty, remainder_kg,
      material_id, material_variant_id, order_status
    ) values (
      v_item, v_request, 'round', 40, 2, 1000, 1, 1,
      v_material, v_variant, 'ordered'
    );
  else
    insert into public.material_variants(
      id, material_id, category, knife_material, material_grade,
      knife_bevel_count, width_mm, height_mm,
      weight_per_m_kg, default_unit
    ) values (
      v_variant, v_material, 'knives', 'S355', 'S355', 1, 40, 8, 1, 'мм'
    );
    insert into public.request_knives(
      id, request_id, knife_type, order_mm, will_be_used_mm,
      material_id, material_variant_id, steel_grade, width_mm, height_mm,
      remainder_meters, remainder_qty, knife_bevel_count, order_status
    ) values (
      v_item, v_request, 'Нож 40×8', 1000, 1000,
      v_material, v_variant, 'S355', 40, 8, 1, 1, 1, 'ordered'
    );
  end if;

  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_' || p_category,
      'request_item_id', v_item
    )),
    v_actor
  );
  select id into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan;
  select layout_category_key into strict v_category_key
  from public.long_stock_cutting_plans where id = v_plan;

  v_version_1 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', p_category || '-' || p_source_kind || '-original'),
    v_settings,
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', 1,
      'required_length_mm', 1000
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 6000,
        'net_parts_length_mm', 1000,
        'kerf_loss_length_mm', 1,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 4999,
        'purchased_weight_kg', 6,
        'net_parts_weight_kg', 1,
        'kerf_loss_weight_kg', 0.001,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 4.999
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
          'cut_length_mm', 1000
        ))
      ))
    )),
    1, v_actor, null, '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version_1, v_actor);

  if p_source_kind = 'supply_return' then
    perform public.fn_return_long_stock_position_to_technologist_v1(
      'request_' || p_category, v_item, 'Тестовый возврат на пересчёт', v_actor
    );
    select array_agg(length_mm order by length_mm)
    into v_allowed_lengths
    from (
      select distinct length_json::numeric as length_mm
      from jsonb_array_elements(v_settings->'categories') categories(category_json)
      cross join lateral jsonb_array_elements(
        coalesce(category_json->'standard_lengths', '[]'::jsonb)
        || coalesce(category_json->'nonstandard_lengths', '[]'::jsonb)
      ) lengths(length_json)
      where category_json->>'key' = v_category_key
    ) lengths;
  elsif p_source_kind = 'supply_receipt' then
    insert into public.supply_order_delivery_schedules(
      id, request_item_table, request_item_id, delivery_date, quantity, unit,
      status, created_by, updated_by
    ) values (
      v_parent_schedule, 'request_' || p_category, v_item,
      current_date, 8000, 'мм', 'planned', v_actor, v_actor
    );
    insert into public.supply_order_delivery_schedules(
      id, request_item_table, request_item_id, delivery_date, quantity, unit,
      status, received_quantity, allocated_quantity, allocated_physical_quantity,
      received_piece_length_mm, allocated_piece_count,
      delivered_at, received_by, created_by, updated_by, receipt_parent_schedule_id
    ) values (
      v_schedule, 'request_' || p_category, v_item,
      current_date, 1000, 'мм', 'delivered', 0, 1000, 8000,
      8000, 1, now(), v_actor, v_actor, v_actor, v_parent_schedule
    );
    set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;
    v_allowed_lengths := array[8000::numeric];
  else
    insert into public.factories(id, name) values (v_source_factory, 'Завод-источник ' || v_actor);
    insert into public.inventory(
      id, factory_id, material_id, material_variant_id, piece_length_mm,
      total_quantity, reserved_quantity, unit,
      total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
      last_updated_by
    ) values (
      v_inventory, v_source_factory, v_material, v_variant, 8000,
      8000, 0, 'мм', 1, 0, 'шт', v_actor
    );
    insert into public.inventory_transfers(
      id, machine_id, source_factory_id, destination_factory_id,
      status, expected_arrival_date, created_by, updated_by
    ) values (
      v_transfer, v_machine, v_source_factory, v_factory,
      'scheduled', current_date, v_actor, v_actor
    );
    insert into public.inventory_transfer_items(
      id, transfer_id, source_inventory_id, material_id, material_variant_id,
      request_item_table, request_item_id, requested_quantity, received_quantity,
      requested_secondary_quantity, received_secondary_quantity,
      unit, secondary_unit, piece_length_mm
    ) values (
      v_transfer_item, v_transfer, v_inventory, v_material, v_variant,
      'request_' || p_category, v_item, 8000, 0, 1, 0, 'мм', 'шт', 8000
    );
    update public.inventory_transfer_items
    set received_quantity = 8000, received_secondary_quantity = 1
    where id = v_transfer_item;
    v_allowed_lengths := array[8000::numeric];
  end if;

  if (select status from public.long_stock_cutting_plan_versions where id = v_version_1) <> 'invalid'
    or (select cutting_status from public.long_stock_cutting_plan_items where id = v_plan_item)
      <> 'requires_recalculation' then
    raise exception 'Источник % не перевёл % в пересчёт', p_source_kind, p_category;
  end if;

  -- Both physical sources carry an unconsumed whole-bar reservation and a
  -- consumed cut reservation. Only the former may move to the replacement.
  if p_source_kind <> 'supply_return' then
    if p_source_kind = 'supply_receipt' then
      insert into public.inventory(
        id, factory_id, material_id, material_variant_id, piece_length_mm,
        total_quantity, reserved_quantity, unit,
        total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
        last_updated_by
      ) values (
        v_inventory, v_factory, v_material, v_variant, 8000,
        16000, 0, 'мм', 2, 0, 'шт', v_actor
      );
    end if;
    insert into public.inventory_reservations(
      id, inventory_id, material_id, material_variant_id, machine_id,
      request_item_table, request_item_id, reserved_quantity,
      reserved_secondary_quantity, reserved_by, original_piece_length_mm,
      is_cut_reservation
    ) values (
      v_reservation, v_inventory, v_material, v_variant, v_machine,
      'request_' || p_category, v_item, 8000, 1, v_actor, 8000, false
    );
    insert into public.inventory_reservations(
      id, inventory_id, material_id, material_variant_id, machine_id,
      request_item_table, request_item_id, reserved_quantity,
      reserved_secondary_quantity, reserved_by, original_piece_length_mm,
      is_cut_reservation, consumed_at, consumed_by
    ) values (
      v_consumed_reservation, v_inventory, v_material, v_variant, v_machine,
      'request_' || p_category, v_item, 1000, 1, v_actor, 1000, true, now(), v_actor
    );
  end if;

  v_replacement := public.fn_prepare_long_stock_recalculation_replacement_v1(
    'request_' || p_category,
    v_item,
    v_version_1,
    p_source_kind,
    v_allowed_lengths,
    v_actor
  );
  if public.fn_prepare_long_stock_recalculation_replacement_v1(
    'request_' || p_category, v_item, v_version_1,
    p_source_kind, v_allowed_lengths, v_actor
  )->>'replacement_id' is distinct from v_replacement->>'replacement_id' then
    raise exception 'Подготовка замены неидемпотентна';
  end if;
  v_replacement_id := (v_replacement->>'replacement_id')::uuid;
  v_replacement_request := (v_replacement->>'replacement_request_id')::uuid;
  v_replacement_item := (v_replacement->>'replacement_request_item_id')::uuid;
  v_stock_length := v_allowed_lengths[1];

  if exists (
    select 1 from public.technologist_requests
    where id = v_replacement_request
      and (status <> 'draft' or not is_recalculation_staging)
  ) then
    raise exception 'Замена стала видимой до утверждения';
  end if;

  v_version_2 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object(
      'case', p_category || '-' || p_source_kind || '-replacement',
      'mode', case when p_source_kind = 'supply_return' then 'with_nonstandard' else 'mixed' end,
      'recalculation', jsonb_build_object(
        'source_version_id', v_version_1,
        'source_version_number', 1,
        'source_kind', p_source_kind,
        'source_request_id', v_request,
        'source_request_item', jsonb_build_object('table', 'request_' || p_category, 'id', v_item),
        'replacement_id', v_replacement_id,
        'replacement_request_id', v_replacement_request,
        'replacement_request_item', jsonb_build_object('table', 'request_' || p_category, 'id', v_replacement_item),
        'allowed_lengths_mm', to_jsonb(v_allowed_lengths),
        'accepted_lengths_mm', to_jsonb(v_allowed_lengths)
      )
    ),
    v_settings,
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_plan_item,
      'segment_number', 1,
      'required_length_mm', 1000
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', v_stock_length,
        'net_parts_length_mm', 1000,
        'kerf_loss_length_mm', 1,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', v_stock_length - 1001,
        'purchased_weight_kg', v_stock_length / 1000,
        'net_parts_weight_kg', 1,
        'kerf_loss_weight_kg', 0.001,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', (v_stock_length - 1001) / 1000
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', v_stock_length,
        'length_group', 'standard',
        'source_type', 'new_stock',
        'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 1000
        ))
      ))
    )),
    1, v_actor, null, '{}'::jsonb
  );
  v_pdf := jsonb_build_object(
    'schema_version', 1,
    'bucket_id', 'product-files',
    'object_path', format('long-stock-cutting-plans/%s/%s/%s.pdf', v_plan, v_version_2, gen_random_uuid()),
    'file_name', 'cutting-plan-' || (select plan_number from public.long_stock_cutting_plans where id = v_plan) || '-v2.pdf',
    'mime_type', 'application/pdf',
    'size_bytes', 2048,
    'sha256', repeat('a', 64),
    'generated_by', v_actor,
    'generated_at', now()
  );

  if p_category = 'circle' and p_source_kind = 'supply_receipt' then
    execute $ddl$
      create or replace function pg_temp.fail_replacement_cancel()
      returns trigger language plpgsql as $body$
      begin
        if new.cancellation_reason = 'Пересчёт' then
          raise exception 'forced replacement rollback';
        end if;
        return new;
      end;
      $body$;
      create trigger test_fail_replacement_cancel
      before update on public.request_circle
      for each row execute function pg_temp.fail_replacement_cancel()
    $ddl$;
    begin
      perform public.fn_approve_long_stock_recalculation_replacement_v1(
        v_version_2, v_actor, v_pdf
      );
      raise exception 'Принудительная ошибка не откатила утверждение';
    exception when others then
      get stacked diagnostics v_error = message_text;
      if v_error not like '%forced replacement rollback%' then raise; end if;
    end;
    execute 'drop trigger test_fail_replacement_cancel on public.request_circle';
    if (select status from public.long_stock_cutting_plan_versions where id = v_version_2) <> 'draft'
      or (select order_status from public.request_circle where id = v_item) = 'cancelled'
      or exists (
        select 1 from public.technologist_requests
        where id = v_replacement_request and not is_recalculation_staging
      ) then
      raise exception 'Ошибка в середине операции оставила частичные изменения';
    end if;
  end if;

  v_approval := public.fn_approve_long_stock_recalculation_replacement_v1(
    v_version_2, v_actor, v_pdf
  );
  if v_approval->>'replacement_request_id' is distinct from v_replacement_request::text
    or (select status from public.technologist_requests where id = v_replacement_request)
      <> 'pending_stock_check'
    or (select is_recalculation_staging from public.technologist_requests where id = v_replacement_request)
    or (select created_by from public.technologist_requests where id = v_replacement_request)
      is distinct from v_actor then
    raise exception 'Новая заявка не активирована на проверке склада: %', v_approval;
  end if;

  select count(*) into v_count
  from (
    select request_id from public.request_circle where request_id = v_replacement_request
    union all select request_id from public.request_pipe where request_id = v_replacement_request
    union all select request_id from public.request_knives where request_id = v_replacement_request
  ) positions;
  if v_count <> 1 then raise exception 'Новая заявка содержит не одну позицию: %', v_count; end if;
  if (select status from public.technologist_requests where id = v_request) <> 'submitted_to_supply' then
    raise exception 'Общий статус старой заявки изменился';
  end if;
  if (select order_status from public.request_components where id = v_other_item) <> 'ordered' then
    raise exception 'Пересчёт изменил другую позицию старой заявки';
  end if;
  execute format(
    'select count(*) from public.%I where id = $1 and order_status = $2 and cancellation_reason = $3 and cancelled_by = $4',
    'request_' || p_category
  ) into v_count using v_item, 'cancelled'::public.order_item_status, 'Пересчёт', v_actor;
  if v_count <> 1 then raise exception 'Старая позиция не отменена по причине пересчёта'; end if;
  begin
    execute format(
      'update public.%I set supplier_id = $1 where id = $2',
      'request_' || p_category
    ) using gen_random_uuid(), v_item;
    raise exception 'Отменённую позицию удалось изменить после пересчёта';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%сохранена как неизменяемая история%' then raise; end if;
  end;
  if not exists (
    select 1 from public.long_stock_cutting_plan_items
    where id = v_plan_item
      and request_item_id = v_replacement_item
      and request_id = v_replacement_request
      and link_state = 'active'
  ) or not exists (
    select 1 from public.long_stock_recalculation_replacements
    where id = v_replacement_id
      and status = 'superseded'
      and replacement_version_id = v_version_2
  ) then
    raise exception 'Связь карты не переключена на заменяющую позицию';
  end if;
  if p_source_kind <> 'supply_return' and (
    not exists (
      select 1 from public.inventory_reservations
      where id = v_reservation and request_item_id = v_replacement_item
    )
    or not exists (
      select 1 from public.inventory_reservations
      where id = v_consumed_reservation and request_item_id = v_item and consumed_at is not null
    )
  ) then
    raise exception 'Физические резервы перенесены с нарушением истории';
  end if;
  if exists (
    select 1 from public.supply_order_delivery_schedules
    where request_item_table = 'request_' || p_category
      and request_item_id = v_item and status = 'planned'
  ) then
    raise exception 'Открытые графики старой позиции не отменены';
  end if;
  if p_source_kind = 'supply_receipt' and not exists (
    select 1 from public.supply_order_delivery_schedules
    where id = v_schedule and status = 'delivered'
  ) then
    raise exception 'Принятая дочерняя поставка не сохранена в истории';
  end if;

  begin
    insert into public.supply_order_delivery_schedules(
      request_item_table, request_item_id, delivery_date, quantity, unit,
      status, created_by, updated_by
    ) values (
      'request_' || p_category, v_item, current_date, 1000, 'мм',
      'planned', v_actor, v_actor
    );
    raise exception 'Для отменённой позиции удалось создать новый график';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%Отменённая по пересчёту позиция недоступна%' then raise; end if;
  end;
  if p_source_kind <> 'supply_return' then
    begin
      insert into public.inventory_reservations(
        inventory_id, material_id, material_variant_id, machine_id,
        request_item_table, request_item_id, reserved_quantity,
        reserved_secondary_quantity, reserved_by, original_piece_length_mm,
        is_cut_reservation
      ) values (
        v_inventory, v_material, v_variant, v_machine,
        'request_' || p_category, v_item, 1, 0, v_actor, 8000, false
      );
      raise exception 'Для отменённой позиции удалось создать новую бронь';
    exception when others then
      get stacked diagnostics v_error = message_text;
      if v_error not like '%Отменённая по пересчёту позиция недоступна%' then raise; end if;
    end;
  end if;

  perform public.fn_approve_long_stock_recalculation_replacement_v1(
    v_version_2, v_actor, v_pdf
  );
  if (select count(*) from public.long_stock_recalculation_replacements where source_version_id = v_version_1) <> 1
    or (select count(*) from public.technologist_requests where id = v_replacement_request) <> 1 then
    raise exception 'Повторное утверждение создало дубль';
  end if;
end;
$$;

do $$
declare
  v_category text;
  v_source text;
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_wire uuid := gen_random_uuid();
  v_error text;
begin
  foreach v_category in array array['circle', 'pipe', 'knives'] loop
    foreach v_source in array array['supply_return', 'supply_receipt', 'inventory_transfer'] loop
      perform pg_temp.run_replacement_case(v_category, v_source);
    end loop;
  end loop;

  select id into v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'replacement-wire@example.test', 'Технолог проволоки', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'REPLACEMENT-WIRE', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_actor);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Проволока вне раскроя', 'pipe', v_actor);
  insert into public.material_variants(
    id, material_id, category, pipe_type, piece_description,
    material_grade, weight_per_m_kg, default_unit
  ) values (v_variant, v_material, 'pipe', 'wire', 'Ø 4', 'S355', 0.1, 'кг');
  insert into public.request_pipe(
    id, request_id, pipe_type, diameter_mm, remainder_kg,
    material_id, material_variant_id
  ) values (v_wire, v_request, 'wire', 4, 10, v_material, v_variant);
  begin
    perform public.fn_create_long_stock_cutting_plan(
      v_variant,
      jsonb_build_array(jsonb_build_object(
        'request_item_table', 'request_pipe', 'request_item_id', v_wire
      )),
      v_actor
    );
    raise exception 'Проволока попала в новый сценарий раскроя';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%Проволока не входит в раскрой длинномера%'
      and v_error not like '%не относится к длинномеру раскроя%' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.fn_approve_long_stock_cutting_plan_version_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_approve_long_stock_cutting_plan_version_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.fn_approve_long_stock_cutting_plan_version_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'public.fn_approve_long_stock_cutting_plan_version_core_v1(uuid,uuid)', 'EXECUTE') then
    raise exception 'Старая обходная сигнатура утверждения осталась открыта';
  end if;
  if has_function_privilege('anon', 'public.fn_approve_long_stock_recalculation_replacement_v1(uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_approve_long_stock_recalculation_replacement_v1(uuid,uuid,jsonb)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.fn_approve_long_stock_recalculation_replacement_v1(uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'Права финального RPC замены настроены неверно';
  end if;
  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'fn_approve_long_stock%'
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
        or has_function_privilege('service_role', procedure.oid, 'EXECUTE') is distinct from (
          procedure.proname in (
            'fn_approve_long_stock_cutting_plan_version_v2',
            'fn_approve_long_stock_recalculation_replacement_v1'
          )
        )
      )
  ) then
    raise exception 'Найдена открытая обходная перегрузка RPC утверждения';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in ('technologist_requests', 'request_circle', 'request_pipe', 'request_knives')
      and roles @> array['authenticated']::name[]
      and coalesce(qual, '') || coalesce(with_check, '') not like '%is_recalculation_staging%'
  ) then
    raise exception 'RLS допускает чтение или изменение скрытой заменяющей заявки';
  end if;
end;
$$;

rollback;
