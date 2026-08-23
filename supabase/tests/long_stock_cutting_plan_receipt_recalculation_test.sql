\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.create_receipt_guard_plan(
  p_actor uuid,
  p_factory uuid,
  p_material uuid,
  p_variant uuid,
  p_machine_name text
)
returns jsonb
language plpgsql
as $$
declare
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_settings jsonb;
begin
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, p_factory, p_machine_name, p_actor);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_request, v_machine, p_actor);
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  )
  select
    v_item, v_request, variant.diameter_mm,
    coalesce(variant.material_grade, 'S355'), 1000,
    p_material, p_variant
  from public.material_variants variant
  where variant.id = p_variant;

  v_plan := public.fn_create_long_stock_cutting_plan(
    p_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_item
    )),
    p_actor
  );
  select id into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan and request_item_id = v_item;
  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', p_machine_name, 'material_variant_id', p_variant),
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
        'purchased_weight_kg', 12,
        'net_parts_weight_kg', 2,
        'kerf_loss_weight_kg', 0.002,
        'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 9.998
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
    1,
    p_actor,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version, p_actor);
  return jsonb_build_object(
    'machine_id', v_machine,
    'request_id', v_request,
    'request_item_id', v_item,
    'plan_id', v_plan,
    'version_id', v_version
  );
end;
$$;

do $$
declare
  v_technologist uuid := gen_random_uuid();
  v_receiver uuid := gen_random_uuid();
  v_factory uuid;
  v_transfer_factory uuid := gen_random_uuid();
  v_machine uuid := gen_random_uuid();
  v_matching_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_matching_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_matching_item uuid := gen_random_uuid();
  v_plan uuid;
  v_plan_item uuid;
  v_version_1 uuid;
  v_version_2 uuid;
  v_matching_plan uuid;
  v_matching_plan_item uuid;
  v_matching_version uuid;
  v_matching_version_2 uuid;
  v_settings jsonb;
  v_segments jsonb;
  v_candidate jsonb;
  v_schedule uuid := gen_random_uuid();
  v_matching_schedule uuid := gen_random_uuid();
  v_transfer uuid := gen_random_uuid();
  v_transfer_item uuid := gen_random_uuid();
  v_source_inventory uuid := gen_random_uuid();
  v_cut_bar uuid;
  v_cut_scrap uuid;
  v_planned_scrap uuid;
  v_version_1_definition jsonb;
  v_task public.tasks%rowtype;
  v_error text;
  v_approval_race_machine uuid := gen_random_uuid();
  v_approval_race_request uuid := gen_random_uuid();
  v_approval_race_item uuid := gen_random_uuid();
  v_approval_race_plan uuid;
  v_approval_race_plan_item uuid;
  v_approval_race_version uuid;
  v_approval_race_schedule uuid := gen_random_uuid();
  v_approval_race_result jsonb;
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then raise exception 'Для теста пересчёта не найден завод'; end if;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_technologist, 'cutting-recalculation-tech@example.test', 'Технолог пересчёта', 'technologist', v_factory, true),
    (v_receiver, 'cutting-recalculation-receiver@example.test', 'Кладовщик пересчёта', 'supply_manager', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values
    (v_machine, v_factory, 'RECALC-MISMATCH', v_technologist),
    (v_matching_machine, v_factory, 'RECALC-MATCH', v_technologist);
  insert into public.technologist_requests(id, machine_id, created_by)
  values
    (v_request, v_machine, v_technologist),
    (v_matching_request, v_matching_machine, v_technologist);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Круг для теста пересчёта', 'circle', v_technologist);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (v_variant, v_material, 'circle', 40, 'S355', 6000, 2, 'мм');
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values
    (v_item, v_request, 40, 'S355', 2400, v_material, v_variant),
    (v_matching_item, v_matching_request, 40, 'S355', 10000, v_material, v_variant);

  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle', 'request_item_id', v_item
    )),
    v_technologist
  );
  select id into strict v_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_plan and request_item_id = v_item;
  v_segments := jsonb_build_array(
    jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', 1, 'required_length_mm', 1200),
    jsonb_build_object('plan_item_id', v_plan_item, 'segment_number', 2, 'required_length_mm', 1200)
  );
  v_candidate := jsonb_build_array(jsonb_build_object(
    'candidate_number', 1,
    'is_complete', true,
    'metrics', jsonb_build_object(
      'purchased_length_mm', 12000, 'net_parts_length_mm', 2400,
      'kerf_loss_length_mm', 2, 'end_trim_loss_length_mm', 0,
      'business_scrap_length_mm', 9598,
      'purchased_weight_kg', 24, 'net_parts_weight_kg', 4.8,
      'kerf_loss_weight_kg', 0.004, 'end_trim_loss_weight_kg', 0,
      'business_scrap_weight_kg', 19.196
    ),
    'bars', jsonb_build_array(
      jsonb_build_object(
        'bar_number', 1, 'stock_length_mm', 6000, 'length_group', 'standard',
        'source_type', 'new_stock', 'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 1200
        ))
      ),
      jsonb_build_object(
        'bar_number', 2, 'stock_length_mm', 6000, 'length_group', 'standard',
        'source_type', 'new_stock', 'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 2, 'cut_length_mm', 1200
        ))
      )
    )
  ));

  -- A divergent receipt can commit before approval and therefore cannot see an
  -- approved version in the receipt trigger. Approval must re-read it while it
  -- owns the common plan lock and invalidate the version it just approved.
  insert into public.machines(id, factory_id, name, created_by)
  values (v_approval_race_machine, v_factory, 'RECALC-APPROVAL-RACE', v_technologist);
  insert into public.technologist_requests(id, machine_id, created_by)
  values (v_approval_race_request, v_approval_race_machine, v_technologist);
  insert into public.request_circle(
    id, request_id, diameter_mm, steel_grade, remainder_mm,
    material_id, material_variant_id
  ) values (
    v_approval_race_item, v_approval_race_request, 40, 'S355', 2400,
    v_material, v_variant
  );

  v_approval_race_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle',
      'request_item_id', v_approval_race_item
    )),
    v_technologist
  );
  select id into strict v_approval_race_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_approval_race_plan;

  v_approval_race_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_approval_race_plan,
    jsonb_build_object('case', 'receipt-before-approval-race'),
    v_settings,
    jsonb_build_array(
      jsonb_build_object(
        'plan_item_id', v_approval_race_plan_item,
        'segment_number', 1,
        'required_length_mm', 1200
      ),
      jsonb_build_object(
        'plan_item_id', v_approval_race_plan_item,
        'segment_number', 2,
        'required_length_mm', 1200
      )
    ),
    v_candidate,
    1,
    v_technologist,
    null,
    '{}'::jsonb
  );

  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, planned_piece_length_mm, planned_piece_count,
    received_quantity, received_piece_length_mm, received_piece_count,
    delivered_at, received_by, created_by, updated_by
  ) values (
    v_approval_race_schedule,
    'request_circle',
    v_approval_race_item,
    current_date,
    12000,
    'мм',
    'delivered',
    6000,
    2,
    16000,
    8000,
    2,
    now(),
    v_receiver,
    v_receiver,
    v_receiver
  );
  set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;

  if (select status from public.long_stock_cutting_plan_versions where id = v_approval_race_version)
    <> 'draft' then
    raise exception 'Приёмка до утверждения преждевременно изменила черновик карты';
  end if;

  v_approval_race_result := public.fn_approve_long_stock_cutting_plan_version_v1(
    v_approval_race_version,
    v_technologist
  );
  if (select status from public.long_stock_cutting_plan_versions where id = v_approval_race_version)
      <> 'invalid'
    or v_approval_race_result->>'status' <> 'invalid'
    or (select cutting_status from public.long_stock_cutting_plan_items where id = v_approval_race_plan_item)
      <> 'requires_recalculation'
    or not exists (
      select 1
      from public.long_stock_cutting_plan_versions
      where id = v_approval_race_version
        and invalidation_receipt_schedule_id = v_approval_race_schedule
    ) then
    raise exception 'Утверждение не инвалидировало уже расходящуюся приёмку: %', v_approval_race_result;
  end if;

  v_version_1 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'receipt-recalculation-v1'),
    v_settings,
    v_segments,
    v_candidate,
    1,
    v_technologist,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version_1, v_technologist);

  select bar.id, link.inventory_id
  into strict v_cut_bar, v_cut_scrap
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.long_stock_cutting_business_scraps link on link.bar_id = bar.id
  where candidate.version_id = v_version_1 and bar.bar_number = 1;
  select link.inventory_id into strict v_planned_scrap
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_candidates candidate on candidate.id = bar.candidate_id
  join public.long_stock_cutting_business_scraps link on link.bar_id = bar.id
  where candidate.version_id = v_version_1 and bar.bar_number = 2;
  perform public.fn_set_long_stock_cutting_bar_status(v_cut_bar, 'cut', v_technologist);

  select jsonb_build_object(
    'input_snapshot', input_snapshot,
    'settings_snapshot', settings_snapshot,
    'selected_candidate_number', selected_candidate_number,
    'created_by', created_by,
    'created_at', created_at
  ) into v_version_1_definition
  from public.long_stock_cutting_plan_versions where id = v_version_1;

  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, planned_piece_length_mm, planned_piece_count,
    received_quantity, received_piece_length_mm, received_piece_count,
    delivered_at, received_by, created_by, updated_by
  ) values (
    v_schedule, 'request_circle', v_item, current_date, 12000, 'мм',
    'delivered', 6000, 2,
    16000, 8000, 2,
    now(), v_receiver, v_receiver, v_receiver
  );
  set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;

  if (select status from public.long_stock_cutting_plan_versions where id = v_version_1) <> 'invalid' then
    raise exception 'Расхождение 6000 -> 8000 не сделало версию недействительной';
  end if;
  if (select cutting_status from public.long_stock_cutting_plan_items where id = v_plan_item)
    <> 'requires_recalculation' then
    raise exception 'Позиция не получила статус requires_recalculation';
  end if;
  if not exists (
    select 1 from public.long_stock_cutting_plan_versions
    where id = v_version_1
      and invalidation_receipt_schedule_id = v_schedule
      and invalidated_by = v_receiver
      and invalidation_reason like '%6000 мм × 2, принято 8000 мм × 2%'
  ) then
    raise exception 'Версия не сохранила причину и документ приёмки';
  end if;

  select * into strict v_task
  from public.tasks
  where long_stock_cutting_plan_id = v_plan
    and task_type = 'long_stock_cutting_recalculation';
  if v_task.assigned_to is distinct from v_technologist or v_task.status <> 'pending' then
    raise exception 'Задача пересчёта создана не технологу карты: %', row_to_json(v_task);
  end if;
  if not exists (
    select 1 from public.notifications
    where user_id = v_technologist
      and type = 'long_stock_cutting_recalculation'
      and related_machine_id = v_machine
  ) then
    raise exception 'Технолог не получил уведомление о пересчёте';
  end if;

  begin
    perform public.fn_assert_no_invalid_long_stock_cutting_plan(v_machine);
    raise exception 'Заготовка не была заблокирована';
  exception when raise_exception then
    get stacked diagnostics v_error = message_text;
    if v_error = 'Заготовка не была заблокирована'
      or v_error not like '%карта раскроя требует пересчёта%' then
      raise;
    end if;
  end;
  begin
    insert into public.production_fact_cutting_events(
      machine_id, factory_id, fact_date, created_by
    ) values (v_machine, v_factory, current_date, v_receiver);
    raise exception 'Событие резки было записано при недействительной карте';
  exception when raise_exception then
    get stacked diagnostics v_error = message_text;
    if v_error = 'Событие резки было записано при недействительной карте'
      or v_error not like '%карта раскроя требует пересчёта%' then
      raise;
    end if;
  end;

  if (select status from public.long_stock_cutting_candidate_bars where id = v_cut_bar) <> 'cut'
    or (select deleted_at from public.inventory where id = v_cut_scrap) is not null then
    raise exception 'Инвалидация затронула порезанный хлыст или его остаток';
  end if;
  if (select deleted_at from public.inventory where id = v_planned_scrap) is null then
    raise exception 'Будущий остаток непорезанного хлыста старой версии остался активным';
  end if;

  v_version_2 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object(
      'case', 'receipt-recalculation-v2',
      'recalculation', jsonb_build_object(
        'source_version_id', v_version_1,
        'source_version_number', 1,
        'accepted_lengths_mm', jsonb_build_array(8000)
      )
    ),
    v_settings,
    jsonb_build_array(jsonb_build_object(
      'plan_item_id', v_plan_item, 'segment_number', 1, 'required_length_mm', 1200
    )),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 8000, 'net_parts_length_mm', 1200,
        'kerf_loss_length_mm', 1, 'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 6799,
        'purchased_weight_kg', 16, 'net_parts_weight_kg', 2.4,
        'kerf_loss_weight_kg', 0.002, 'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 13.598
      ),
      'bars', jsonb_build_array(jsonb_build_object(
        'bar_number', 1, 'stock_length_mm', 8000, 'length_group', 'standard',
        'source_type', 'new_stock', 'source_inventory_id', null,
        'cuts', jsonb_build_array(jsonb_build_object(
          'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 1200
        ))
      ))
    )),
    1,
    v_technologist,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_version_2, v_technologist);

  if (select version_number from public.long_stock_cutting_plan_versions where id = v_version_2) <> 2
    or (select status from public.long_stock_cutting_plan_versions where id = v_version_1) <> 'invalid'
    or (select status from public.long_stock_cutting_plan_versions where id = v_version_2) <> 'approved' then
    raise exception 'Пересчёт не создал утверждённую версию 2 с сохранением версии 1';
  end if;
  if (
    select jsonb_build_object(
      'input_snapshot', input_snapshot,
      'settings_snapshot', settings_snapshot,
      'selected_candidate_number', selected_candidate_number,
      'created_by', created_by,
      'created_at', created_at
    )
    from public.long_stock_cutting_plan_versions where id = v_version_1
  ) is distinct from v_version_1_definition then
    raise exception 'Пересчёт изменил определение версии 1';
  end if;
  if (select status from public.long_stock_cutting_candidate_bars where id = v_cut_bar) <> 'cut'
    or (select deleted_at from public.inventory where id = v_cut_scrap) is not null then
    raise exception 'Версия 2 затронула порезанный хлыст версии 1';
  end if;
  if (select status from public.tasks where id = v_task.id) <> 'completed' then
    raise exception 'Утверждение версии 2 не завершило задачу пересчёта';
  end if;
  if exists (
    select 1 from public.tasks
    where long_stock_cutting_plan_version_id = v_version_2
      and task_type = 'long_stock_cutting_supply_shortage'
  ) then
    raise exception 'Достаточная фактическая приёмка ошибочно создала дозаказ';
  end if;
  perform public.fn_assert_no_invalid_long_stock_cutting_plan(v_machine);

  -- A second plan proves that identical plan and fact do not invalidate it.
  v_matching_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle', 'request_item_id', v_matching_item
    )),
    v_technologist
  );
  select id into strict v_matching_plan_item
  from public.long_stock_cutting_plan_items
  where plan_id = v_matching_plan and request_item_id = v_matching_item;
  v_matching_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_matching_plan,
    jsonb_build_object('case', 'matching-receipt'),
    v_settings,
    jsonb_build_array(
      jsonb_build_object(
        'plan_item_id', v_matching_plan_item, 'segment_number', 1, 'required_length_mm', 5000
      ),
      jsonb_build_object(
        'plan_item_id', v_matching_plan_item, 'segment_number', 2, 'required_length_mm', 5000
      )
    ),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1, 'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 12000, 'net_parts_length_mm', 10000,
        'kerf_loss_length_mm', 2, 'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 1998,
        'purchased_weight_kg', 24, 'net_parts_weight_kg', 20,
        'kerf_loss_weight_kg', 0.004, 'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 3.996
      ),
      'bars', jsonb_build_array(
        jsonb_build_object(
          'bar_number', 1, 'stock_length_mm', 6000, 'length_group', 'standard',
          'source_type', 'new_stock', 'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 5000
          ))
        ),
        jsonb_build_object(
          'bar_number', 2, 'stock_length_mm', 6000, 'length_group', 'standard',
          'source_type', 'new_stock', 'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 2, 'cut_length_mm', 5000
          ))
        )
      )
    )),
    1,
    v_technologist,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(v_matching_version, v_technologist);
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, planned_piece_length_mm, planned_piece_count,
    received_quantity, received_piece_length_mm, received_piece_count,
    delivered_at, received_by, created_by, updated_by
  ) values (
    v_matching_schedule, 'request_circle', v_matching_item, current_date, 12000, 'мм',
    'delivered', 6000, 2,
    12000, 6000, 2,
    now(), v_receiver, v_receiver, v_receiver
  );
  set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;
  if (select status from public.long_stock_cutting_plan_versions where id = v_matching_version) <> 'approved'
    or exists (
      select 1 from public.tasks
      where long_stock_cutting_plan_id = v_matching_plan
        and task_type = 'long_stock_cutting_recalculation'
  ) then
    raise exception 'Совпадающая приёмка создала инвалидацию или задачу';
  end if;

  -- Interfactory receiving carries the physical source-bar length. An 8000 mm
  -- bar against the approved 6000 mm composition must invalidate the plan too.
  insert into public.factories(id, name, city)
  values (v_transfer_factory, 'Завод-источник пересчёта', 'Тестовый город');
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, piece_length_mm,
    total_quantity, reserved_quantity, unit,
    total_secondary_quantity, reserved_secondary_quantity, secondary_unit,
    last_updated_by
  ) values (
    v_source_inventory, v_transfer_factory, v_material, v_variant, 8000,
    8000, 0, 'мм', 1, 0, 'шт', v_receiver
  );
  insert into public.inventory_transfers(
    id, machine_id, source_factory_id, destination_factory_id,
    status, expected_arrival_date, created_by, updated_by
  ) values (
    v_transfer, v_matching_machine, v_transfer_factory, v_factory,
    'scheduled', current_date, v_receiver, v_receiver
  );
  insert into public.inventory_transfer_items(
    id, transfer_id, source_inventory_id, material_id, material_variant_id,
    request_item_table, request_item_id,
    requested_quantity, received_quantity,
    requested_secondary_quantity, received_secondary_quantity,
    unit, secondary_unit, piece_length_mm
  ) values (
    v_transfer_item, v_transfer, v_source_inventory, v_material, v_variant,
    'request_circle', v_matching_item,
    8000, 0, 1, 0, 'мм', 'шт', 8000
  );
  update public.inventory_transfer_items
  set received_quantity = 8000,
      received_secondary_quantity = 1
  where id = v_transfer_item;

  if not exists (
    select 1
    from public.long_stock_cutting_plan_versions
    where id = v_matching_version
      and status = 'invalid'
      and invalidation_inventory_transfer_id = v_transfer
      and invalidation_receipt_schedule_id is null
      and invalidated_by = v_receiver
      and invalidation_reason like '%6000 мм × 2%принято 8000 мм × 1%'
  ) then
    raise exception 'Межзаводская приёмка 6000 -> 8000 не сохранила инвалидацию и документ';
  end if;
  if not exists (
    select 1
    from public.tasks
    where long_stock_cutting_plan_id = v_matching_plan
      and task_type = 'long_stock_cutting_recalculation'
      and status = 'pending'
      and assigned_to = v_technologist
  ) then
    raise exception 'Межзаводская приёмка не создала задачу пересчёта';
  end if;

  v_matching_version_2 := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_matching_plan,
    jsonb_build_object(
      'case', 'transfer-recalculation-with-shortage',
      'recalculation', jsonb_build_object(
        'source_version_id', v_matching_version,
        'source_version_number', 1,
        'accepted_lengths_mm', jsonb_build_array(6000, 8000)
      )
    ),
    v_settings,
    jsonb_build_array(
      jsonb_build_object(
        'plan_item_id', v_matching_plan_item, 'segment_number', 1, 'required_length_mm', 5000
      ),
      jsonb_build_object(
        'plan_item_id', v_matching_plan_item, 'segment_number', 2, 'required_length_mm', 5000
      )
    ),
    jsonb_build_array(jsonb_build_object(
      'candidate_number', 1,
      'is_complete', true,
      'metrics', jsonb_build_object(
        'purchased_length_mm', 16000, 'net_parts_length_mm', 10000,
        'kerf_loss_length_mm', 2, 'end_trim_loss_length_mm', 0,
        'business_scrap_length_mm', 5998,
        'purchased_weight_kg', 32, 'net_parts_weight_kg', 20,
        'kerf_loss_weight_kg', 0.004, 'end_trim_loss_weight_kg', 0,
        'business_scrap_weight_kg', 11.996
      ),
      'bars', jsonb_build_array(
        jsonb_build_object(
          'bar_number', 1, 'stock_length_mm', 8000, 'length_group', 'standard',
          'source_type', 'new_stock', 'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 5000
          ))
        ),
        jsonb_build_object(
          'bar_number', 2, 'stock_length_mm', 8000, 'length_group', 'standard',
          'source_type', 'new_stock', 'source_inventory_id', null,
          'cuts', jsonb_build_array(jsonb_build_object(
            'cut_number', 1, 'segment_number', 2, 'cut_length_mm', 5000
          ))
        )
      )
    )),
    1,
    v_technologist,
    null,
    '{}'::jsonb
  );
  perform public.fn_approve_long_stock_cutting_plan_version_v1(
    v_matching_version_2,
    v_technologist
  );

  if not exists (
    select 1
    from public.tasks
    where long_stock_cutting_plan_version_id = v_matching_version_2
      and task_type = 'long_stock_cutting_supply_shortage'
      and status = 'pending'
      and assigned_to = v_receiver
      and description like '%8000 мм × 1%'
  ) then
    raise exception 'Недостающий после пересчёта хлыст не ушёл задачей в снабжение';
  end if;
  if not exists (
    select 1
    from public.notifications
    where user_id = v_receiver
      and type = 'long_stock_cutting_supply_shortage'
      and related_machine_id = v_matching_machine
  ) then
    raise exception 'Снабжение не получило уведомление о дозаказе';
  end if;
end;
$$;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_no_schedule jsonb;
  v_child jsonb;
  v_no_schedule_id uuid := gen_random_uuid();
  v_parent_schedule_id uuid := gen_random_uuid();
  v_child_schedule_id uuid := gen_random_uuid();
begin
  select id into v_factory from public.factories order by created_at nulls last limit 1;
  if v_factory is null then
    raise exception 'Для теста fallback-инвалидации не найден завод';
  end if;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    'cutting-recalculation-fallback@example.test',
    'Тест fallback-инвалидации',
    'technologist',
    v_factory,
    true
  );
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Круг fallback-инвалидации', 'circle', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (
    v_variant, v_material, 'circle', 55, 'S355', 6000, 2, 'мм'
  );

  -- Receiving without a pre-created schedule has no planned piece fields. The
  -- approved candidate is therefore the source of the expected composition.
  v_no_schedule := pg_temp.create_receipt_guard_plan(
    v_actor, v_factory, v_material, v_variant, 'RECALC-NO-SCHEDULE'
  );
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, received_quantity, received_piece_length_mm, received_piece_count,
    delivered_at, received_by, created_by, updated_by
  ) values (
    v_no_schedule_id,
    'request_circle',
    (v_no_schedule->>'request_item_id')::uuid,
    current_date,
    1000,
    'мм',
    'delivered',
    8000,
    8000,
    1,
    now(),
    v_actor,
    v_actor,
    v_actor
  );
  set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;
  if not exists (
    select 1
    from public.long_stock_cutting_plan_versions
    where id = (v_no_schedule->>'version_id')::uuid
      and status = 'invalid'
      and invalidation_receipt_schedule_id = v_no_schedule_id
      and invalidation_reason like '%утверждённой карте 6000 мм × 1, принято 8000 мм × 1%'
  ) then
    raise exception 'Приёмка без графика не инвалидировала карту по утверждённому составу';
  end if;

  -- A child schedule created while one receipt is distributed to another
  -- machine carries only actual length and allocated_piece_count.
  v_child := pg_temp.create_receipt_guard_plan(
    v_actor, v_factory, v_material, v_variant, 'RECALC-CHILD-SCHEDULE'
  );
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, created_by, updated_by
  ) values (
    v_parent_schedule_id,
    'request_circle',
    (v_no_schedule->>'request_item_id')::uuid,
    current_date,
    8000,
    'мм',
    'planned',
    v_actor,
    v_actor
  );
  insert into public.supply_order_delivery_schedules(
    id, request_item_table, request_item_id, delivery_date, quantity, unit,
    status, received_quantity, allocated_quantity, allocated_physical_quantity,
    received_piece_length_mm, allocated_piece_count,
    delivered_at, received_by, created_by, updated_by,
    receipt_parent_schedule_id
  ) values (
    v_child_schedule_id,
    'request_circle',
    (v_child->>'request_item_id')::uuid,
    current_date,
    1000,
    'мм',
    'delivered',
    0,
    1000,
    8000,
    8000,
    1,
    now(),
    v_actor,
    v_actor,
    v_actor,
    v_parent_schedule_id
  );
  set constraints supply_order_delivery_piece_fact_constraint_trigger immediate;
  if not exists (
    select 1
    from public.long_stock_cutting_plan_versions
    where id = (v_child->>'version_id')::uuid
      and status = 'invalid'
      and invalidation_receipt_schedule_id = v_child_schedule_id
      and invalidation_reason like '%утверждённой карте 6000 мм × 1, принято 8000 мм × 1%'
  ) then
    raise exception 'Дочерняя строка распределения не инвалидировала карту целевой машины';
  end if;
end;
$$;

rollback;

\echo '[long-stock-cutting-plan-receipt-recalculation] all assertions passed'
