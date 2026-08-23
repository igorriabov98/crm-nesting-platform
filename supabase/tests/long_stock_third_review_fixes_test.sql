\set ON_ERROR_STOP on

begin;

-- Measured rows can only change by whole pieces; non-measured rows keep the
-- existing free-quantity adjustment contract.
do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_material uuid := gen_random_uuid();
  v_unmeasured_material uuid := gen_random_uuid();
  v_measured uuid := gen_random_uuid();
  v_unmeasured uuid := gen_random_uuid();
begin
  select id into strict v_factory
  from public.factories
  order by created_at nulls last
  limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    'long-stock-third-review-adjustment@example.test',
    'Тест корректировки мерных строк',
    'technologist',
    v_factory,
    true
  );
  insert into public.materials(id, name, category, created_by)
  values
    (v_material, 'Материал теста корректировки хлыстов', 'components', v_actor),
    (v_unmeasured_material, 'Материал обычной корректировки', 'components', v_actor);
  insert into public.inventory(
    id, factory_id, material_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_measured, v_factory, v_material, 6000,
    12000, 0, 'мм', 2, 0, 'шт', v_actor
  );
  insert into public.inventory(
    id, factory_id, material_id, total_quantity, reserved_quantity, unit,
    last_updated_by
  ) values (
    v_unmeasured, v_factory, v_unmeasured_material, 10, 0, 'кг', v_actor
  );

  begin
    perform public.fn_adjust_inventory_record(
      v_measured, 11000, v_actor, 'Ошибочная инвентаризация 11000 × 2', 2
    );
    raise exception 'Корректировка 11000 × 2 была принята';
  exception when raise_exception then
    if sqlerrm = 'Корректировка 11000 × 2 была принята'
      or sqlerrm not like '%11000%12000%' then
      raise;
    end if;
  end;

  begin
    perform public.fn_adjust_inventory_record(
      v_measured, 12000, v_actor, 'Ошибочная инвентаризация 12000 × 1', 1
    );
    raise exception 'Корректировка 12000 × 1 была принята';
  exception when raise_exception then
    if sqlerrm = 'Корректировка 12000 × 1 была принята'
      or sqlerrm not like '%12000%6000%' then
      raise;
    end if;
  end;

  perform public.fn_adjust_inventory_record(
    v_measured, 6000, v_actor, 'Корректное уменьшение до одного хлыста', 1
  );
  if not exists (
    select 1
    from public.inventory
    where id = v_measured
      and total_quantity = 6000
      and total_secondary_quantity = 1
  ) then
    raise exception 'Корректировка 2 → 1 не дала один хлыст длиной 6000';
  end if;

  perform public.fn_adjust_inventory_record(
    v_unmeasured, 7.5, v_actor, 'Обычная весовая корректировка', null
  );
  if (select total_quantity from public.inventory where id = v_unmeasured) <> 7.5 then
    raise exception 'Строка без piece_length_mm перестала корректироваться как раньше';
  end if;
end;
$$;

-- Knife stock is reserved as whole physical bars. The only future scrap is
-- the 96 mm row calculated from 5900 mm of parts and four 1 mm kerfs.
do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_remote_factory uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_other_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_request_item uuid := gen_random_uuid();
  v_inventory uuid := gen_random_uuid();
  v_wrong_inventory uuid := gen_random_uuid();
  v_remote_inventory uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_settings jsonb;
  v_reservation uuid;
  v_scrap_id uuid;
  v_scrap_count_before integer;
  v_scrap_count_after integer;
begin
  select id into strict v_factory
  from public.factories
  order by created_at nulls last
  limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    'long-stock-third-review-knife@example.test',
    'Тест ножа с пропилом',
    'technologist',
    v_factory,
    true
  );
  insert into public.factories(id, name)
  values (v_remote_factory, 'LONG-STOCK-THIRD-REVIEW-REMOTE-' || v_remote_factory::text);
  insert into public.machines(id, factory_id, name, created_by)
  values
    (v_machine, v_factory, 'LONG-STOCK-THIRD-REVIEW-KNIFE', v_actor),
    (v_other_machine, v_factory, 'LONG-STOCK-THIRD-REVIEW-OTHER-MACHINE', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_actor);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Нож теста пропила 1 мм', 'knives', v_actor);
  insert into public.material_variants(
    id, material_id, category, knife_dimensions, knife_bevel_count,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (
    v_variant, v_material, 'knives', '6000×40×10', 1,
    6000, 2, 'мм'
  );
  insert into public.request_knives(
    id, request_id, knife_type, order_mm, will_be_used_mm,
    material_id, material_variant_id, length_mm, width_mm, height_mm,
    knife_bevel_count
  ) values (
    v_request_item, v_request, 'Нож с четырьмя резами', 5900, 5900,
    v_material, v_variant, 6000, 40, 10, 1
  );
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values
    (
      v_inventory, v_factory, v_material, v_variant, 6000,
      6000, 0, 'мм', 1, 0, 'шт', v_actor
    ),
    (
      v_wrong_inventory, v_factory, v_material, v_variant, 12000,
      12000, 0, 'мм', 1, 0, 'шт', v_actor
    ),
    (
      v_remote_inventory, v_remote_factory, v_material, v_variant, 6000,
      6000, 0, 'мм', 1, 0, 'шт', v_actor
    );

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_knives',
      'request_item_id', v_request_item
    )),
    v_actor
  );
  select id into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan;
  v_settings := public.fn_get_long_stock_layout_settings_snapshot();

  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'knife-5900-four-kerfs'),
    v_settings,
    jsonb_build_array(
      jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 1,
        'required_length_mm', 2300
      ),
      jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 2,
        'required_length_mm', 1200
      ),
      jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 3,
        'required_length_mm', 1200
      ),
      jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 4,
        'required_length_mm', 1200
      )
    ),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 6000,
        'net_parts_length_mm', 5900,
        'kerf_loss_length_mm', 4,
        'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 96,
        'purchased_weight_kg', 12,
        'net_parts_weight_kg', 11.8,
        'kerf_loss_weight_kg', 0.008,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 0.192
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1,
        'stock_length_mm', 6000,
        'length_group', 'standard',
        'source_type', 'new_stock',
        'source_inventory_id', null,
        'cuts', jsonb_build_array(
          jsonb_build_object('cut_number', 1, 'segment_number', 1, 'cut_length_mm', 2300),
          jsonb_build_object('cut_number', 2, 'segment_number', 2, 'cut_length_mm', 1200),
          jsonb_build_object('cut_number', 3, 'segment_number', 3, 'cut_length_mm', 1200),
          jsonb_build_object('cut_number', 4, 'segment_number', 4, 'cut_length_mm', 1200)
        )
      ))
    )),
    1,
    v_actor,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version, v_actor);

  select link.inventory_id
  into strict v_scrap_id
  from public.long_stock_cutting_business_scraps link
  where link.version_id = v_version;
  if (select piece_length_mm from public.inventory where id = v_scrap_id) <> 96 then
    raise exception 'Карта создала остаток, отличный от 96 мм';
  end if;
  select count(*) into v_scrap_count_before
  from public.inventory
  where material_variant_id = v_variant
    and is_business_scrap
    and deleted_at is null;

  begin
    perform public.fn_reserve_inventory_for_machine(
      v_material,
      v_machine,
      5900,
      'request_knives',
      v_request_item,
      v_actor,
      null,
      null,
      null
    );
    raise exception 'Материальный RPC принял длинномер с NULL длиной и вариантом';
  exception when raise_exception then
    if sqlerrm = 'Материальный RPC принял длинномер с NULL длиной и вариантом'
      or sqlerrm not like '%только из конкретной складской строки%' then
      raise;
    end if;
  end;

  begin
    perform public.fn_reserve_inventory_row_for_machine(
      v_wrong_inventory,
      v_machine,
      5900,
      'request_knives',
      v_request_item,
      v_actor,
      null,
      false
    );
    raise exception 'Карта 6000 мм приняла складской хлыст 12000 мм';
  exception when raise_exception then
    if sqlerrm = 'Карта 6000 мм приняла складской хлыст 12000 мм'
      or sqlerrm not like '%12000%отсутствует%утверждённой карты%' then
      raise;
    end if;
  end;

  begin
    perform set_config('request.jwt.claim.sub', v_actor::text, true);
    perform public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
      v_remote_inventory,
      v_other_machine,
      5900,
      'request_knives',
      v_request_item,
      v_actor
    );
    raise exception 'Межзаводской RPC связал позицию заявки с чужой машиной';
  exception when raise_exception then
    if sqlerrm = 'Межзаводской RPC связал позицию заявки с чужой машиной'
      or sqlerrm not like '%нет действующей утверждённой карты%' then
      raise;
    end if;
  end;
  if exists (
    select 1
    from public.inventory_reservations
    where inventory_id = v_remote_inventory
  ) then
    raise exception 'Отказ межзаводского RPC оставил бронь на удалённом заводе';
  end if;

  v_reservation := public.fn_reserve_inventory_row_for_machine(
    v_inventory,
    v_machine,
    5900,
    'request_knives',
    v_request_item,
    v_actor,
    null,
    true
  );

  if not exists (
    select 1
    from public.inventory_reservations
    where id = v_reservation
      and reserved_quantity = 6000
      and logical_reserved_quantity = 5900
      and reserved_secondary_quantity = 1
      and is_cut_reservation = false
      and reservation_source = 'whole_bar_stock'
      and business_scrap_inventory_id is null
  ) then
    raise exception 'Нож не был переведён на физическое резервирование целого хлыста';
  end if;
  select count(*) into v_scrap_count_after
  from public.inventory
  where material_variant_id = v_variant
    and is_business_scrap
    and deleted_at is null;
  if v_scrap_count_after <> v_scrap_count_before then
    raise exception 'Резервирование создало второй агрегированный остаток';
  end if;
  if exists (
    select 1
    from public.inventory
    where material_variant_id = v_variant
      and is_business_scrap
      and deleted_at is null
      and piece_length_mm = 100
  ) then
    raise exception 'Рабочий складской путь вернул kerf-blind остаток 100 мм';
  end if;
end;
$$;

-- One click reserves every new-stock component of an approved multi-length
-- map, not a ceil-derived quantity from the selected anchor row.
do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_request_item uuid := gen_random_uuid();
  v_inventory_6000 uuid := gen_random_uuid();
  v_inventory_12000 uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_settings jsonb;
  v_kerf numeric;
  v_end_trim numeric;
  v_business_scrap numeric;
begin
  select id into strict v_factory
  from public.factories
  order by created_at nulls last
  limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    'long-stock-third-review-multi-length@example.test',
    'Тест многодлинной карты',
    'technologist',
    v_factory,
    true
  );
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'LONG-STOCK-THIRD-REVIEW-MULTI-LENGTH', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, v_actor);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Круг теста многодлинной карты', 'circle', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (
    v_variant, v_material, 'circle', 42, 'S355', 12000, 2, 'мм'
  );
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_request_item, v_request, 42, 'S355', 3000,
    v_material, v_variant
  );
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values
    (
      v_inventory_6000, v_factory, v_material, v_variant, 6000,
      6000, 0, 'мм', 1, 0, 'шт', v_actor
    ),
    (
      v_inventory_12000, v_factory, v_material, v_variant, 12000,
      12000, 0, 'мм', 1, 0, 'шт', v_actor
    );

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_request_item
    )),
    v_actor
  );
  select id into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan;
  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_kerf := (v_settings->>'kerf_mm')::numeric;
  v_end_trim := (v_settings->>'end_trim_mm')::numeric;
  v_business_scrap := 15000 - 2 * v_kerf - 2 * v_end_trim;

  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'multi-length-stock-reservation'),
    v_settings,
    jsonb_build_array(
      jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 1,
        'required_length_mm', 1000
      ),
      jsonb_build_object(
        'plan_item_id', v_plan_item,
        'segment_number', 2,
        'required_length_mm', 2000
      )
    ),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 18000,
        'net_parts_length_mm', 3000,
        'kerf_loss_length_mm', 2 * v_kerf,
        'end_trim_loss_length_mm', 2 * v_end_trim,
        'business_scrap_length_mm', v_business_scrap,
        'purchased_weight_kg', 36,
        'net_parts_weight_kg', 6,
        'kerf_loss_weight_kg', 2 * v_kerf * 2 / 1000,
        'end_trim_loss_weight_kg', 2 * v_end_trim * 2 / 1000,
        'business_scrap_weight_kg', v_business_scrap * 2 / 1000
      ),
      'bars', jsonb_build_array(
        jsonb_build_object(
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
        ),
        jsonb_build_object(
          'bar_number', 2,
          'stock_length_mm', 12000,
          'length_group', 'nonstandard',
          'source_type', 'new_stock',
          'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1,
            'segment_number', 2,
            'cut_length_mm', 2000
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

  perform public.fn_reserve_inventory_row_for_machine(
    v_inventory_6000,
    v_machine,
    3000,
    'request_circle',
    v_request_item,
    v_actor,
    null,
    false
  );

  if (select count(*) from public.inventory_reservations
      where request_item_table = 'request_circle'
        and request_item_id = v_request_item
        and consumed_at is null) <> 2
    or not exists (
      select 1 from public.inventory_reservations
      where request_item_id = v_request_item
        and original_piece_length_mm = 6000
        and reserved_quantity = 6000
        and logical_reserved_quantity = 1000
        and reserved_secondary_quantity = 1
    )
    or not exists (
      select 1 from public.inventory_reservations
      where request_item_id = v_request_item
        and original_piece_length_mm = 12000
        and reserved_quantity = 12000
        and logical_reserved_quantity = 2000
        and reserved_secondary_quantity = 1
    ) then
    raise exception 'Многодлинная карта не создала точный физический состав 6000 × 1 + 12000 × 1';
  end if;
end;
$$;

-- Force the last statement of atomic fact deletion to fail. The fact and any
-- task/event changes must remain untouched.
create or replace function public.test_fail_cutting_delete_notification_v1()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'task_created' then
    raise exception 'Тестовый отказ уведомления удаления факта';
  end if;
  return new;
end;
$$;

create trigger test_fail_cutting_delete_notification_trigger
before insert on public.notifications
for each row
execute function public.test_fail_cutting_delete_notification_v1();

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_section uuid := gen_random_uuid();
  v_fact uuid := gen_random_uuid();
  v_failed boolean := false;
begin
  select id into strict v_factory
  from public.factories
  order by created_at nulls last
  limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    'long-stock-third-review-delete@example.test',
    'Тест атомарного удаления факта',
    'technologist',
    v_factory,
    true
  );
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'LONG-STOCK-THIRD-REVIEW-DELETE', v_actor);
  insert into public.production_fact_sections(
    id, factory_id, name, production_stage_type, created_by, updated_by
  ) values (
    v_section, v_factory, 'Заготовка · отказ удаления', 'cutting', v_actor, v_actor
  );
  insert into public.production_machine_facts(
    id, factory_id, fact_date, shift, machine_id, section_id, created_by, updated_by
  ) values (
    v_fact, v_factory, current_date, 'day', v_machine, v_section, v_actor, v_actor
  );

  begin
    perform public.fn_delete_production_machine_fact_atomic_v1(v_fact, v_actor);
  exception when raise_exception then
    if sqlerrm not like '%Тестовый отказ уведомления удаления факта%' then
      raise;
    end if;
    v_failed := true;
  end;

  if not v_failed or not exists (
    select 1 from public.production_machine_facts where id = v_fact
  ) then
    raise exception 'Сбой атомарного удаления оставил факт удалённым';
  end if;
  if exists (
    select 1
    from public.tasks
    where machine_id = v_machine
      and task_type = 'production_cutting_rollback_review'
  ) then
    raise exception 'Сбой атомарного удаления оставил задачу отката';
  end if;
end;
$$;

rollback;

\echo '[long-stock-third-review-fixes] all SQL assertions passed'
