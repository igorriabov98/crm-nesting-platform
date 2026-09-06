\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.run_long_stock_supplier_schedule_guard_case(
  p_category text
)
returns void
language plpgsql
as $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_inventory uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_schedule uuid := gen_random_uuid();
  v_settings jsonb;
  v_count integer;
  v_quantity numeric;
begin
  if p_category not in ('circle', 'pipe', 'knives') then
    raise exception 'Некорректная категория теста: %', p_category;
  end if;

  select id into v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    format('supplier-schedule-guard-%s-%s@example.test', p_category, v_actor),
    format('Снабжение теста %s', p_category),
    'supply_manager',
    v_factory,
    true
  );
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, format('SUPPLIER-SCHEDULE-GUARD-%s', p_category), v_actor);
  insert into public.technologist_requests(id, machine_id, created_by, status, submitted_at)
  values (v_request, v_machine, v_actor, 'submitted_to_supply', now());
  insert into public.materials(id, name, category, created_by)
  values (v_material, format('Материал теста графика %s', p_category), p_category::public.material_category, v_actor);

  if p_category = 'circle' then
    insert into public.material_variants(
      id, material_id, category, diameter_mm, material_grade,
      standard_length_mm, weight_per_m_kg, default_unit
    ) values (v_variant, v_material, 'circle', 40, 'S355', 6000, 1, 'мм');
    insert into public.request_circle(
      id, request_id, diameter_mm, steel_grade, remainder_mm,
      material_id, material_variant_id, order_status
    ) values (v_item, v_request, 40, 'S355', 3000, v_material, v_variant, 'ordered');
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
      v_item, v_request, 'round', 40, 2, 3000, 3, 3,
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
      v_item, v_request, 'Нож 40×8', 3000, 3000,
      v_material, v_variant, 'S355', 40, 8, 3, 3, 1, 'ordered'
    );
  end if;

  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by, is_business_scrap
  ) values (
    v_inventory, v_factory, v_material, v_variant, 6000,
    6000, 0, 'мм', 1, 0, 'шт', v_actor, false
  );

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
  v_settings := public.fn_get_long_stock_layout_settings_snapshot();

  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'supplier-schedule-guard-' || p_category),
    v_settings,
    jsonb_build_array(
      jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', 1, 'required_length_mm', 1000),
      jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', 2, 'required_length_mm', 1000),
      jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', 3, 'required_length_mm', 1000)
    ),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 12000,
        'net_parts_length_mm', 3000,
        'kerf_loss_length_mm', 3,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 14997,
        'purchased_weight_kg', 12,
        'net_parts_weight_kg', 3,
        'kerf_loss_weight_kg', 0.003,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 14.997
      ),
      'bars', jsonb_build_array(
        jsonb_build_object(
          'bar_number', 1,
          'stock_length_mm', 6000,
          'length_group', null,
          'source_type', 'warehouse_stock',
          'source_inventory_id', v_inventory,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 1000
          ))
        ),
        jsonb_build_object(
          'bar_number', 2,
          'stock_length_mm', 6000,
          'length_group', 'standard',
          'source_type', 'new_stock',
          'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 2, 'cut_length_mm', 1000
          ))
        ),
        jsonb_build_object(
          'bar_number', 3,
          'stock_length_mm', 6000,
          'length_group', 'standard',
          'source_type', 'new_stock',
          'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 3, 'cut_length_mm', 1000
          ))
        )
      )
    )),
    1,
    v_actor,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version, v_actor);

  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    planned_piece_length_mm, planned_piece_count, created_by, updated_by
  ) values (
    v_schedule, 'request_' || p_category, v_item, current_date, 12000, 'мм',
    6000, 2, v_actor, v_actor
  );

  begin
    insert into public.supply_order_delivery_schedules(
      request_item_table, request_item_id, delivery_date, quantity, unit,
      planned_piece_length_mm, planned_piece_count, created_by, updated_by
    ) values (
      'request_' || p_category, v_item, current_date, 6000, 'мм',
      6000, 1, v_actor, v_actor
    );
    raise exception 'Складской третий хлыст попал в закупочный график %', p_category;
  exception when raise_exception then
    if sqlerrm = format('Складской третий хлыст попал в закупочный график %s', p_category)
      or sqlerrm not like '%превышает закупочную часть утверждённой карты%' then
      raise;
    end if;
  end;

  if p_category = 'circle' then
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    begin
      perform public.fn_replace_supply_order_delivery_schedules_v1(
        array[v_schedule],
        jsonb_build_array(jsonb_build_object(
          'request_item_table', 'request_circle',
          'request_item_id', v_item,
          'delivery_date', current_date,
          'quantity', 18000,
          'unit', 'мм',
          'planned_piece_length_mm', 6000,
          'planned_piece_count', 3
        ))
      );
      raise exception 'Атомарная замена приняла три закупочных хлыста';
    exception when raise_exception then
      if sqlerrm = 'Атомарная замена приняла три закупочных хлыста'
        or sqlerrm not like '%превышает закупочную часть утверждённой карты%' then
        raise;
      end if;
    end;

    if not exists (select 1 from public.supply_order_delivery_schedules where id = v_schedule) then
      raise exception 'Ошибка замены удалила исходный график вместо полного отката';
    end if;

    perform public.fn_replace_supply_order_delivery_schedules_v1(
      array[v_schedule],
      jsonb_build_array(
        jsonb_build_object(
          'request_item_table', 'request_circle', 'request_item_id', v_item,
          'delivery_date', current_date, 'quantity', 6000, 'unit', 'мм',
          'planned_piece_length_mm', 6000, 'planned_piece_count', 1
        ),
        jsonb_build_object(
          'request_item_table', 'request_circle', 'request_item_id', v_item,
          'delivery_date', current_date + 1, 'quantity', 6000, 'unit', 'мм',
          'planned_piece_length_mm', 6000, 'planned_piece_count', 1
        )
      )
    );
    select count(*), sum(quantity)
    into v_count, v_quantity
    from public.supply_order_delivery_schedules
    where request_item_table = 'request_circle'
      and request_item_id = v_item
      and status = 'planned';
    if v_count <> 2 or v_quantity <> 12000 then
      raise exception 'Допустимая атомарная замена сохранилась неверно: rows=%, quantity=%',
        v_count, v_quantity;
    end if;
  end if;
end;
$$;

do $$
declare
  v_category text;
begin
  foreach v_category in array array['circle', 'pipe', 'knives'] loop
    perform pg_temp.run_long_stock_supplier_schedule_guard_case(v_category);
  end loop;
end;
$$;

rollback;

\echo '[long-stock-supplier-schedule-guard] all assertions passed'
