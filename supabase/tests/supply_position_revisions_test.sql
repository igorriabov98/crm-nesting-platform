\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.insert_revision_item(
  p_table text,
  p_request_id uuid,
  p_item_id uuid,
  p_variant text default null
)
returns void
language plpgsql
as $$
begin
  case p_table
    when 'request_sheet_metal' then
      insert into public.request_sheet_metal(
        id, request_id, material_name, steel_type_id, quantity_sheets, weight_order_kg
      ) values (
        p_item_id,
        p_request_id,
        'Лист S235',
        (select id from public.steel_types where name = 'S235' limit 1),
        2,
        100
      );
    when 'request_circle' then
      insert into public.request_circle(
        id, request_id, diameter_mm, steel_grade, remainder_mm
      ) values (p_item_id, p_request_id, 40, 'S355', 1200);
    when 'request_pipe' then
      insert into public.request_pipe(
        id, request_id, pipe_type, size, wall_thickness_mm,
        remainder_length_mm, remainder_qty, remainder_kg
      ) values (
        p_item_id, p_request_id, coalesce(p_variant, 'square')::public.pipe_subtype,
        case when p_variant = 'wire' then 'Ø 6' else '40×20' end,
        case when p_variant = 'wire' then null else 2 end,
        1200, 1, 2
      );
    when 'request_knives' then
      insert into public.request_knives(
        id, request_id, knife_type, order_mm, will_be_used_mm
      ) values (p_item_id, p_request_id, 'Нож 40×8', 1200, 1200);
    when 'request_paint' then
      insert into public.request_paint(
        id, request_id, paint_type, ral_code, area_m2, weight_kg
      ) values (p_item_id, p_request_id, 'Порошковая', 'RAL 9005', 10, 3);
    when 'request_components' then
      insert into public.request_components(
        id, request_id, component_name, quantity_needed, unit
      ) values (p_item_id, p_request_id, 'Подшипник', 2, 'шт');
    when 'request_mesh' then
      insert into public.request_mesh(
        id, request_id, description, length_mm, width_mm, remainder_qty
      ) values (p_item_id, p_request_id, 'Сетка 50×50', 2000, 1000, 2);
    when 'request_chain_cord' then
      insert into public.request_chain_cord(
        id, request_id, item_type, parameters, remainder_meters
      ) values (p_item_id, p_request_id, 'chain', 'Цепь 8 мм', 12);
    else
      raise exception 'Unknown revision table %', p_table;
  end case;
end;
$$;

create or replace function pg_temp.run_revision_case(
  p_table text,
  p_variant text default null
)
returns void
language plpgsql
as $$
declare
  v_supply uuid := gen_random_uuid();
  v_technologist uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_source_request uuid := gen_random_uuid();
  v_source_item uuid := gen_random_uuid();
  v_preview jsonb;
  v_return jsonb;
  v_repeat_return jsonb;
  v_create jsonb;
  v_repeat_create jsonb;
  v_submit jsonb;
  v_repeat_submit jsonb;
  v_revision_id uuid;
  v_department_request_id uuid;
  v_replacement_request_id uuid;
  v_replacement_item_id uuid;
  v_other_table text := case when p_table = 'request_components' then 'request_mesh' else 'request_components' end;
  v_other_item uuid := gen_random_uuid();
  v_row jsonb;
  v_error text;
  v_requires_plan boolean := p_table in ('request_circle', 'request_knives')
    or (p_table = 'request_pipe' and coalesce(p_variant, 'square') <> 'wire');
begin
  select id into strict v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_supply, v_supply || '@revision.test', 'Снабжение', 'supply_manager', v_factory, true),
    (v_technologist, v_technologist || '@revision.test', 'Технолог', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'REVISION-' || p_table || '-' || coalesce(p_variant, 'default'), v_technologist);
  insert into public.technologist_requests(
    id, machine_id, created_by, status, submitted_at
  ) values (v_source_request, v_machine, v_technologist, 'submitted_to_supply', now());
  perform pg_temp.insert_revision_item(p_table, v_source_request, v_source_item, p_variant);

  v_preview := public.fn_preview_supply_position_revision_v1(p_table, v_source_item);
  if not coalesce((v_preview->>'eligible')::boolean, false)
    or v_preview->>'mode' <> 'standard'
    or jsonb_array_length(v_preview->'blockers') <> 0 then
    raise exception 'Unexpected preview for %/%: %', p_table, p_variant, v_preview;
  end if;

  v_return := public.fn_return_supply_position_to_technologist_v1(
    p_table, v_source_item, 'Нужно исправить характеристику позиции', v_supply, false
  );
  v_repeat_return := public.fn_return_supply_position_to_technologist_v1(
    p_table, v_source_item, 'Повторное нажатие', v_supply, false
  );
  if not coalesce((v_repeat_return->>'idempotent')::boolean, false)
    or v_repeat_return->>'revision_id' is distinct from v_return->>'revision_id' then
    raise exception 'Return is not idempotent for %/%', p_table, p_variant;
  end if;

  v_revision_id := (v_return->>'revision_id')::uuid;
  v_department_request_id := (v_return->>'department_request_id')::uuid;
  if (select status from public.supply_position_revisions where id = v_revision_id) <> 'requested'
    or (select status from public.department_requests where id = v_department_request_id) <> 'in_progress'
    or (select count(*) from public.tasks where department_request_id = v_department_request_id and status = 'in_progress') <> 1 then
    raise exception 'Return lifecycle was not created for %/%', p_table, p_variant;
  end if;

  begin
    execute format('update public.%I set sort_order = sort_order + 1 where id = $1', p_table)
      using v_source_item;
    raise exception 'Open source mutation unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[RETURN_ALREADY_OPEN]%' then raise; end if;
  end;

  v_create := public.fn_create_supply_position_revision_request_v1(
    v_department_request_id, v_technologist
  );
  v_repeat_create := public.fn_create_supply_position_revision_request_v1(
    v_department_request_id, v_technologist
  );
  if not coalesce((v_repeat_create->>'idempotent')::boolean, false)
    or v_repeat_create->>'request_id' is distinct from v_create->>'request_id' then
    raise exception 'Correction request is not idempotent for %/%', p_table, p_variant;
  end if;
  v_replacement_request_id := (v_create->>'request_id')::uuid;
  v_replacement_item_id := (v_create->>'request_item_id')::uuid;

  execute format('select to_jsonb(item) from public.%I item where id = $1', p_table)
    into v_row using v_replacement_item_id;
  if v_row is null
    or (v_row->>'request_id')::uuid <> v_replacement_request_id
    or v_row->>'order_status' <> 'pending'
    or (v_row->>'cancelled_at') is not null then
    raise exception 'Replacement copy is invalid for %/%: %', p_table, p_variant, v_row;
  end if;

  begin
    perform pg_temp.insert_revision_item(v_other_table, v_replacement_request_id, v_other_item, null);
    raise exception 'Category change unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[REVISION_CATEGORY_LOCKED]%' then raise; end if;
  end;
  begin
    perform pg_temp.insert_revision_item(p_table, v_replacement_request_id, gen_random_uuid(), p_variant);
    raise exception 'Second row unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[REVISION_STRUCTURE_LOCKED]%' then raise; end if;
  end;

  execute format(
    'update public.%I set %I = $1 where id = $2',
    p_table,
    case p_table
      when 'request_sheet_metal' then 'material_name'
      when 'request_circle' then 'steel_grade'
      when 'request_pipe' then 'size'
      when 'request_knives' then 'knife_type'
      when 'request_paint' then 'ral_code'
      when 'request_components' then 'component_name'
      when 'request_mesh' then 'description'
      else 'parameters'
    end
  ) using 'Исправлено', v_replacement_item_id;

  if v_requires_plan then
    begin
      update public.technologist_requests
      set status = 'pending_stock_check', updated_at = now()
      where id = v_replacement_request_id;
      raise exception 'Long-stock correction entered stock check without a cutting plan';
    exception when sqlstate '55000' then
      get stacked diagnostics v_error = message_text;
      if v_error not like '[CUTTING_PLAN_REQUIRED]%' then raise; end if;
    end;

    v_submit := public.fn_cancel_returned_supply_position_v1(
      p_table, v_source_item, 'Потребность больше не актуальна', v_technologist
    );
    if v_submit->>'status' <> 'cancelled'
      or (select status from public.supply_position_revisions where id = v_revision_id) <> 'cancelled'
      or (select status from public.technologist_requests where id = v_replacement_request_id) <> 'cancelled'
      or (select status from public.department_requests where id = v_department_request_id) <> 'cancelled'
      or (select count(*) from public.tasks where department_request_id = v_department_request_id and status = 'cancelled') <> 1 then
      raise exception 'Cancellation lifecycle is incomplete for %/%', p_table, p_variant;
    end if;
    v_repeat_submit := public.fn_cancel_returned_supply_position_v1(
      p_table, v_source_item, 'Повторная отмена', v_technologist
    );
    if not coalesce((v_repeat_submit->>'idempotent')::boolean, false) then
      raise exception 'Cancellation is not idempotent for %/%', p_table, p_variant;
    end if;
    return;
  end if;

  update public.technologist_requests
  set status = 'pending_stock_check', updated_at = now()
  where id = v_replacement_request_id;
  if (select status from public.supply_position_revisions where id = v_revision_id) <> 'stock_check' then
    raise exception 'Stock-check status was not synchronized for %/%', p_table, p_variant;
  end if;

  v_submit := public.fn_submit_supply_position_revision_v1(v_replacement_request_id, v_technologist);
  v_repeat_submit := public.fn_submit_supply_position_revision_v1(v_replacement_request_id, v_technologist);
  if not coalesce((v_repeat_submit->>'idempotent')::boolean, false)
    or v_repeat_submit->>'revision_id' is distinct from v_submit->>'revision_id' then
    raise exception 'Submit is not idempotent for %/%', p_table, p_variant;
  end if;

  execute format('select to_jsonb(item) from public.%I item where id = $1', p_table)
    into v_row using v_source_item;
  if v_row->>'order_status' <> 'cancelled'
    or v_row->>'cancelled_at' is null
    or (v_row->>'cancelled_by')::uuid <> v_technologist
    or nullif(btrim(v_row->>'cancellation_reason'), '') is null
    or (select status from public.supply_position_revisions where id = v_revision_id) <> 'submitted'
    or (select status from public.technologist_requests where id = v_replacement_request_id) <> 'submitted_to_supply'
    or (select status from public.department_requests where id = v_department_request_id) <> 'done'
    or (select count(*) from public.tasks where department_request_id = v_department_request_id and status = 'completed') <> 1 then
    raise exception 'Submission lifecycle is incomplete for %/%', p_table, p_variant;
  end if;
end;
$$;

do $$
begin
  perform pg_temp.run_revision_case('request_sheet_metal');
  perform pg_temp.run_revision_case('request_circle');
  perform pg_temp.run_revision_case('request_pipe', 'square');
  perform pg_temp.run_revision_case('request_pipe', 'wire');
  perform pg_temp.run_revision_case('request_knives');
  perform pg_temp.run_revision_case('request_paint');
  perform pg_temp.run_revision_case('request_components');
  perform pg_temp.run_revision_case('request_mesh');
  perform pg_temp.run_revision_case('request_chain_cord');
end;
$$;

create or replace function pg_temp.make_component_revision_source(
  p_technologist uuid,
  p_machine uuid,
  p_order_status public.order_item_status default 'pending'
)
returns uuid
language plpgsql
as $$
declare
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
begin
  insert into public.technologist_requests(id, machine_id, created_by, status, submitted_at)
  values (v_request, p_machine, p_technologist, 'submitted_to_supply', now());
  insert into public.request_components(
    id, request_id, component_name, quantity_needed, unit, order_status,
    ordered_at
  ) values (
    v_item, v_request, 'Проверка блокировки', 2, 'шт', p_order_status,
    case when p_order_status = 'ordered' then now() else null end
  );
  return v_item;
end;
$$;

create or replace function pg_temp.assert_revision_blocker(
  p_item uuid,
  p_code text
)
returns void
language plpgsql
as $$
declare
  v_preview jsonb;
begin
  v_preview := public.fn_preview_supply_position_revision_v1('request_components', p_item);
  if coalesce((v_preview->>'eligible')::boolean, true)
    or not (v_preview->'blockers' @> jsonb_build_array(jsonb_build_object('code', p_code))) then
    raise exception 'Expected blocker %, got %', p_code, v_preview;
  end if;
end;
$$;

do $$
declare
  v_supply uuid := gen_random_uuid();
  v_technologist uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_item uuid;
  v_other_item uuid;
  v_schedule uuid;
  v_other_schedule uuid;
  v_trip uuid;
  v_empty_trip uuid;
  v_expense uuid;
  v_material uuid;
  v_inventory uuid;
  v_reservation uuid;
  v_result jsonb;
  v_error text;
begin
  select id into strict v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_supply, v_supply || '@blocker.test', 'Снабжение', 'supply_manager', v_factory, true),
    (v_technologist, v_technologist || '@blocker.test', 'Технолог', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'REVISION-BLOCKERS', v_technologist);

  -- Any receipt fact blocks the whole return, even before the item itself is marked delivered.
  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  insert into public.supply_order_delivery_schedules(
    request_item_table, request_item_id, delivery_date, quantity, unit, status,
    received_quantity, allocated_quantity, delivered_at, received_by, created_by, updated_by
  ) values (
    'request_components', v_item, current_date, 2, 'шт', 'delivered',
    1, 1, now(), v_supply, v_supply, v_supply
  );
  perform pg_temp.assert_revision_blocker(v_item, 'RECEIPT_EXISTS');
  begin
    perform public.fn_return_supply_position_to_technologist_v1(
      'request_components', v_item, 'Нельзя после приёмки', v_supply, false
    );
    raise exception 'Receipt-blocked return unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[RECEIPT_EXISTS]%' then raise; end if;
  end;
  if exists (select 1 from public.supply_position_revisions where source_request_item_id = v_item) then
    raise exception 'Blocked return left a partial revision';
  end if;

  -- A started trip blocks return.
  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  insert into public.supply_order_delivery_schedules(
    request_item_table, request_item_id, delivery_date, quantity, unit, created_by, updated_by
  ) values ('request_components', v_item, current_date, 2, 'шт', v_supply, v_supply)
  returning id into v_schedule;
  insert into public.machine_outsourcing_transport_orders(
    direction, status, created_by, updated_by, started_at, started_by
  ) values ('outbound', 'in_transit', v_supply, v_supply, now(), v_supply)
  returning id into v_trip;
  insert into public.transport_trip_need_links(
    transport_order_id, need_kind, need_source, need_id, direction,
    source_point_key, source_point_label, destination_point_key, destination_point_label,
    need_title
  ) values (
    v_trip, 'materials', 'supply_schedule', v_schedule, 'outbound',
    'supplier:test', 'Поставщик', 'factory:test', 'Завод', 'Поставка'
  );
  perform pg_temp.assert_revision_blocker(v_item, 'TRANSPORT_STARTED');

  -- Financial blockers: partial/full payment, shared expense and ambiguous legacy linkage.
  foreach v_error in array array['partially_paid', 'paid'] loop
    v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
    insert into public.finance_expenses(
      title, amount, amount_uah, category, counterparty, planned_date, original_planned_date,
      status, paid_amount, paid_amount_uah, currency, is_supply_plan, source_type, source_key,
      created_by, updated_by
    ) values (
      'Оплата', 100, 100, 'Прочие расходы', 'Поставщик', current_date, current_date,
      v_error::public.finance_expense_status,
      case when v_error = 'paid' then 100 else 10 end,
      case when v_error = 'paid' then 100 else 10 end,
      'UAH', true, 'supply_order',
      v_supply || ':' || current_date || ':request_components:' || v_item,
      v_supply, v_supply
    );
    perform pg_temp.assert_revision_blocker(v_item, 'FINANCE_PAID');
  end loop;

  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  v_other_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  insert into public.finance_expenses(
    title, amount, amount_uah, category, counterparty, planned_date, original_planned_date,
    currency, is_supply_plan, source_type, source_key, created_by, updated_by
  ) values (
    'Общий расход', 100, 100, 'Прочие расходы', 'Поставщик', current_date, current_date,
    'UAH', true, 'supply_order',
    v_supply || ':' || current_date || ':request_components:' || v_item
      || '|request_components:' || v_other_item,
    v_supply, v_supply
  );
  perform pg_temp.assert_revision_blocker(v_item, 'FINANCE_SHARED');

  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  insert into public.finance_expenses(
    title, amount, amount_uah, category, counterparty, planned_date, original_planned_date,
    currency, is_supply_plan, source_type, source_key, created_by, updated_by
  ) values (
    'Старый расход', 100, 100, 'Прочие расходы', 'Поставщик', current_date, current_date,
    'UAH', true, 'supply_order', 'legacy:request_components:' || v_item, v_supply, v_supply
  );
  perform pg_temp.assert_revision_blocker(v_item, 'FINANCE_AMBIGUOUS');

  -- Ordered items require explicit acknowledgement of cancelling the supplier order.
  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine, 'ordered');
  if not (public.fn_preview_supply_position_revision_v1('request_components', v_item)
    ->>'requires_external_order_confirmation')::boolean then
    raise exception 'Ordered source did not require external confirmation';
  end if;
  begin
    perform public.fn_return_supply_position_to_technologist_v1(
      'request_components', v_item, 'Отменить внешний заказ', v_supply, false
    );
    raise exception 'Ordered return without confirmation unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[EXTERNAL_ORDER_CONFIRMATION_REQUIRED]%' then raise; end if;
  end;
  v_result := public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Отменить внешний заказ', v_supply, true
  );
  if (select external_order_cancellation_confirmed_by from public.supply_position_revisions
      where id = (v_result->>'revision_id')::uuid) <> v_supply then
    raise exception 'External confirmation was not audited';
  end if;

  -- Safe dependencies are detached atomically; a shared trip survives and an empty trip is cancelled.
  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  v_other_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  insert into public.supply_order_delivery_schedules(
    request_item_table, request_item_id, delivery_date, quantity, unit, created_by, updated_by
  ) values ('request_components', v_item, current_date, 2, 'шт', v_supply, v_supply)
  returning id into v_schedule;
  insert into public.supply_order_delivery_schedules(
    request_item_table, request_item_id, delivery_date, quantity, unit, created_by, updated_by
  ) values ('request_components', v_other_item, current_date, 2, 'шт', v_supply, v_supply)
  returning id into v_other_schedule;
  insert into public.tasks(
    machine_id, assigned_to, task_type, title, status, supply_order_schedule_id
  ) values (v_machine, v_supply, 'supply_start', 'Связанная задача', 'in_progress', v_schedule);
  insert into public.machine_outsourcing_transport_orders(direction, status, created_by, updated_by)
  values ('outbound', 'needed', v_supply, v_supply) returning id into v_trip;
  insert into public.transport_trip_need_links(
    transport_order_id, need_kind, need_source, need_id, direction,
    source_point_key, source_point_label, destination_point_key, destination_point_label, need_title
  ) values
    (v_trip, 'materials', 'supply_schedule', v_schedule, 'outbound', 'supplier:test', 'Поставщик', 'factory:test', 'Завод', 'Первая поставка'),
    (v_trip, 'materials', 'supply_schedule', v_other_schedule, 'outbound', 'supplier:test', 'Поставщик', 'factory:test', 'Завод', 'Вторая поставка');
  v_result := public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Отсоединить безопасные связи', v_supply, false
  );
  if (select status from public.supply_order_delivery_schedules where id = v_schedule) <> 'cancelled'
    or (select status from public.tasks where supply_order_schedule_id = v_schedule) <> 'cancelled'
    or not exists (select 1 from public.transport_trip_need_links where need_id = v_schedule and released_at is not null)
    or (select status from public.machine_outsourcing_transport_orders where id = v_trip) <> 'needed'
    or not exists (select 1 from public.transport_trip_need_links where need_id = v_other_schedule and released_at is null) then
    raise exception 'Shared trip cleanup is invalid';
  end if;

  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  insert into public.supply_order_delivery_schedules(
    request_item_table, request_item_id, delivery_date, quantity, unit, created_by, updated_by
  ) values ('request_components', v_item, current_date, 2, 'шт', v_supply, v_supply)
  returning id into v_schedule;
  insert into public.machine_outsourcing_transport_orders(direction, status, created_by, updated_by)
  values ('outbound', 'found', v_supply, v_supply) returning id into v_empty_trip;
  insert into public.transport_trip_need_links(
    transport_order_id, need_kind, need_source, need_id, direction,
    source_point_key, source_point_label, destination_point_key, destination_point_label, need_title
  ) values (
    v_empty_trip, 'materials', 'supply_schedule', v_schedule, 'outbound',
    'supplier:test', 'Поставщик', 'factory:test', 'Завод', 'Единственная поставка'
  );
  perform public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Отменить пустой рейс', v_supply, false
  );
  if (select status from public.machine_outsourcing_transport_orders where id = v_empty_trip) <> 'cancelled' then
    raise exception 'Empty trip was not cancelled';
  end if;

  -- An unused warehouse reservation is released; a consumed reservation is a receipt fact and blocks return.
  v_material := gen_random_uuid();
  v_inventory := gen_random_uuid();
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Материал для резерва', 'components', v_technologist);
  insert into public.inventory(
    id, factory_id, material_id, total_quantity, reserved_quantity, unit, last_updated_by
  ) values (v_inventory, v_factory, v_material, 10, 0, 'шт', v_supply);
  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  update public.request_components set material_id = v_material where id = v_item;
  v_reservation := public.fn_reserve_inventory_for_machine(
    v_material, v_machine, 2, 'request_components', v_item, v_supply
  );
  perform public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Освободить складской резерв', v_supply, false
  );
  if exists (select 1 from public.inventory_reservations where id = v_reservation)
    or (select reserved_quantity from public.inventory where id = v_inventory) <> 0 then
    raise exception 'Unused warehouse reservation was not released';
  end if;

  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  update public.request_components set material_id = v_material where id = v_item;
  v_reservation := public.fn_reserve_inventory_for_machine(
    v_material, v_machine, 1, 'request_components', v_item, v_supply
  );
  update public.inventory_reservations
  set consumed_at = now(), consumed_by = v_supply
  where id = v_reservation;
  perform pg_temp.assert_revision_blocker(v_item, 'RECEIPT_EXISTS');

  -- A standalone unpaid overdue expense is safe and is rejected with an audit event.
  v_item := pg_temp.make_component_revision_source(v_technologist, v_machine);
  insert into public.finance_expenses(
    title, amount, amount_uah, category, counterparty, planned_date, original_planned_date,
    status, currency, is_supply_plan, source_type, source_key, created_by, updated_by
  ) values (
    'Просроченный расход', 100, 100, 'Прочие расходы', 'Поставщик', current_date, current_date,
    'overdue', 'UAH', true, 'supply_order',
    v_supply || ':' || current_date || ':request_components:' || v_item, v_supply, v_supply
  ) returning id into v_expense;
  perform public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Отклонить неоплаченный расход', v_supply, false
  );
  if (select status from public.finance_expenses where id = v_expense) <> 'rejected'
    or not exists (select 1 from public.finance_event_actions where event_id = v_expense and action = 'rejected_for_supply_position_revision') then
    raise exception 'Standalone unpaid expense was not rejected with audit';
  end if;
end;
$$;

-- Cancellation is permission-bound, reasoned, idempotent and transactionally
-- safe both before a replacement exists and during stock checking.
do $$
declare
  v_supply uuid := gen_random_uuid();
  v_assigned uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_item uuid;
  v_return jsonb;
  v_created jsonb;
  v_cancelled jsonb;
  v_revision uuid;
  v_department uuid;
  v_replacement_request uuid;
  v_replacement_item uuid;
  v_material uuid := gen_random_uuid();
  v_inventory uuid := gen_random_uuid();
  v_reservation uuid;
  v_error text;
begin
  select id into strict v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_supply, v_supply || '@cancel.test', 'Снабжение отмены', 'supply_manager', v_factory, true),
    (v_assigned, v_assigned || '@cancel.test', 'Назначенный технолог', 'technologist', v_factory, true),
    (v_other, v_other || '@cancel.test', 'Другой технолог', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'REVISION-CANCELLATION', v_assigned);
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Компонент отменяемой замены', 'components', v_assigned);
  insert into public.inventory(
    id, factory_id, material_id, total_quantity, reserved_quantity, unit, last_updated_by
  ) values (v_inventory, v_factory, v_material, 10, 0, 'шт', v_supply);

  v_item := pg_temp.make_component_revision_source(v_assigned, v_machine);
  v_return := public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Проверить отмену до исправления', v_supply, false
  );
  v_revision := (v_return->>'revision_id')::uuid;
  v_department := (v_return->>'department_request_id')::uuid;
  begin
    perform public.fn_cancel_returned_supply_position_v1(
      'request_components', v_item, '  x ', v_assigned
    );
    raise exception 'Cancellation accepted a reason shorter than three characters';
  exception when sqlstate '22023' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[REASON_REQUIRED]%' then raise; end if;
  end;
  begin
    perform public.fn_cancel_returned_supply_position_v1(
      'request_components', v_item, 'Потребность больше не актуальна', v_other
    );
    raise exception 'An unrelated technologist cancelled the returned position';
  exception when sqlstate '42501' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[REVISION_FORBIDDEN]%' then raise; end if;
  end;
  if (select status from public.supply_position_revisions where id = v_revision) <> 'requested'
    or (select status from public.department_requests where id = v_department) <> 'in_progress' then
    raise exception 'Rejected cancellation left partial state';
  end if;
  v_cancelled := public.fn_cancel_returned_supply_position_v1(
    'request_components', v_item, 'Потребность больше не актуальна', v_assigned
  );
  if v_cancelled->>'status' <> 'cancelled'
    or coalesce((v_cancelled->>'idempotent')::boolean, true)
    or (select order_status from public.request_components where id = v_item) <> 'cancelled'
    or (select status from public.supply_position_revisions where id = v_revision) <> 'cancelled'
    or (select cancellation_reason from public.supply_position_revisions where id = v_revision) <> 'Потребность больше не актуальна'
    or (select status from public.department_requests where id = v_department) <> 'cancelled' then
    raise exception 'Requested-stage cancellation is incomplete: %', v_cancelled;
  end if;
  v_cancelled := public.fn_cancel_returned_supply_position_v1(
    'request_components', v_item, 'Повторная отмена', v_assigned
  );
  if not coalesce((v_cancelled->>'idempotent')::boolean, false) then
    raise exception 'Requested-stage cancellation is not idempotent';
  end if;

  v_item := pg_temp.make_component_revision_source(v_assigned, v_machine);
  v_return := public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Проверить отмену на складе', v_supply, false
  );
  v_created := public.fn_create_supply_position_revision_request_v1(
    (v_return->>'department_request_id')::uuid, v_assigned
  );
  v_replacement_request := (v_created->>'request_id')::uuid;
  v_replacement_item := (v_created->>'request_item_id')::uuid;
  update public.request_components set material_id = v_material where id = v_replacement_item;
  v_reservation := public.fn_reserve_inventory_for_machine(
    v_material, v_machine, 2, 'request_components', v_replacement_item, v_supply
  );
  update public.technologist_requests set status = 'pending_stock_check', updated_at = now()
  where id = v_replacement_request;
  if (select status from public.supply_position_revisions where id = (v_return->>'revision_id')::uuid) <> 'stock_check' then
    raise exception 'Test setup did not enter stock_check';
  end if;
  perform public.fn_cancel_returned_supply_position_v1(
    'request_components', v_item, 'Отмена после повторной проверки склада', v_assigned
  );
  if (select status from public.technologist_requests where id = v_replacement_request) <> 'cancelled'
    or (select order_status from public.request_components where id = v_replacement_item) <> 'cancelled'
    or exists (select 1 from public.inventory_reservations where id = v_reservation)
    or (select reserved_quantity from public.inventory where id = v_inventory) <> 0 then
    raise exception 'Stock-check cancellation did not close the replacement request';
  end if;

  -- A fact that appears after return must reject the entire cancellation.
  v_item := pg_temp.make_component_revision_source(v_assigned, v_machine);
  v_return := public.fn_return_supply_position_to_technologist_v1(
    'request_components', v_item, 'Проверить факт после возврата', v_supply, false
  );
  perform set_config('app.supply_position_revision_lifecycle', '1', true);
  insert into public.supply_order_delivery_schedules(
    request_item_table, request_item_id, delivery_date, quantity, unit, status,
    received_quantity, allocated_quantity, delivered_at, received_by, created_by, updated_by
  ) values (
    'request_components', v_item, current_date, 2, 'шт', 'delivered',
    1, 1, now(), v_supply, v_supply, v_supply
  );
  perform set_config('app.supply_position_revision_lifecycle', '', true);
  begin
    perform public.fn_cancel_returned_supply_position_v1(
      'request_components', v_item, 'Поздняя отмена после приёмки', v_assigned
    );
    raise exception 'Cancellation succeeded after an irreversible receipt fact';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[IRREVERSIBLE_POSITION_FACT]%' then raise; end if;
  end;
  if (select status from public.supply_position_revisions where id = (v_return->>'revision_id')::uuid) <> 'requested'
    or (select order_status from public.request_components where id = v_item) = 'cancelled'
    or (select status from public.department_requests where id = (v_return->>'department_request_id')::uuid) <> 'in_progress' then
    raise exception 'Irreversible-fact rejection did not roll back atomically';
  end if;
end;
$$;

-- Two browser tabs may prepare independent long-stock rows, but only an
-- approved row becomes active. Submission removes every remaining draft and a
-- late tab cannot resurrect it.
do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_variant uuid := gen_random_uuid();
  v_pipe_material uuid := gen_random_uuid();
  v_pipe_variant uuid := gen_random_uuid();
  v_knife_material uuid := gen_random_uuid();
  v_knife_variant uuid := gen_random_uuid();
  v_draft_1 jsonb;
  v_draft_2 jsonb;
  v_pipe_draft jsonb;
  v_knife_draft jsonb;
  v_item_1 uuid;
  v_item_2 uuid;
  v_plan uuid;
  v_plan_item uuid;
  v_version uuid;
  v_settings jsonb;
  v_segments jsonb;
  v_candidates jsonb;
  v_approval jsonb;
  v_pdf jsonb;
  v_error text;
begin
  select id into strict v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, v_actor || '@draft-race.test', 'Технолог черновиков', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'CUTTING-DRAFT-RACE', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by, status)
  values (v_request, v_machine, v_actor, 'draft');
  insert into public.materials(id, name, category, created_by)
  values
    (v_material, 'Круг для гонки вкладок', 'circle', v_actor),
    (v_pipe_material, 'Труба для гонки вкладок', 'pipe', v_actor),
    (v_knife_material, 'Нож для гонки вкладок', 'knives', v_actor);
  insert into public.material_variants(
    id, material_id, category, diameter_mm, material_grade,
    standard_length_mm, weight_per_m_kg, default_unit
  ) values (v_variant, v_material, 'circle', 40, 'S355', 6000, 2, 'шт');
  insert into public.material_variants(
    id, material_id, category, pipe_type, piece_description,
    wall_thickness_mm, material_grade, standard_length_mm, weight_per_m_kg, default_unit
  ) values (v_pipe_variant, v_pipe_material, 'pipe', 'square', '40×20', 2, 'S355', 6000, 2, 'шт');
  insert into public.material_variants(
    id, material_id, category, knife_material, material_grade,
    knife_bevel_count, width_mm, height_mm, weight_per_m_kg, default_unit
  ) values (v_knife_variant, v_knife_material, 'knives', 'Hardox', 'Hardox', 1, 40, 8, 2, 'шт');

  v_draft_1 := public.fn_prepare_long_stock_request_item_draft_v1(
    v_request, 'request_circle', null,
    jsonb_build_object(
      'diameter_mm', 40, 'steel_grade', 'S355', 'is_calibrated', false,
      'remainder_mm', 1200, 'material_id', v_material, 'material_variant_id', v_variant
    ),
    v_actor
  );
  v_draft_2 := public.fn_prepare_long_stock_request_item_draft_v1(
    v_request, 'request_circle', null,
    jsonb_build_object(
      'diameter_mm', 40, 'steel_grade', 'S355', 'is_calibrated', false,
      'remainder_mm', 1200, 'material_id', v_material, 'material_variant_id', v_variant
    ),
    v_actor
  );
  v_item_1 := (v_draft_1->>'id')::uuid;
  v_item_2 := (v_draft_2->>'id')::uuid;
  if v_item_1 = v_item_2
    or (select count(*) from public.request_circle where request_id = v_request and is_cutting_plan_draft) <> 2 then
    raise exception 'Independent tabs did not create two isolated cutting drafts';
  end if;
  v_pipe_draft := public.fn_prepare_long_stock_request_item_draft_v1(
    v_request, 'request_pipe', null,
    jsonb_build_object(
      'pipe_type', 'square', 'size', '40×20', 'wall_thickness_mm', 2,
      'remainder_length_mm', 1200, 'remainder_qty', 1, 'remainder_kg', 2.4,
      'material_id', v_pipe_material, 'material_variant_id', v_pipe_variant
    ),
    v_actor
  );
  v_knife_draft := public.fn_prepare_long_stock_request_item_draft_v1(
    v_request, 'request_knives', null,
    jsonb_build_object(
      'knife_type', 'Нож 40×8', 'steel_grade', 'Hardox', 'width_mm', 40, 'height_mm', 8,
      'knife_bevel_count', 1, 'remainder_meters', 1.2, 'remainder_qty', 1,
      'material_id', v_knife_material, 'material_variant_id', v_knife_variant
    ),
    v_actor
  );
  if not exists (select 1 from public.request_pipe where id = (v_pipe_draft->>'id')::uuid and is_cutting_plan_draft)
    or not exists (select 1 from public.request_knives where id = (v_knife_draft->>'id')::uuid and is_cutting_plan_draft) then
    raise exception 'Pipe or knife cutting draft was not isolated';
  end if;

  v_plan := public.fn_create_long_stock_cutting_plan(
    v_variant,
    jsonb_build_array(jsonb_build_object(
      'request_item_table', 'request_circle', 'request_item_id', v_item_1
    )),
    v_actor
  );
  select id into strict v_plan_item from public.long_stock_cutting_plan_items
  where plan_id = v_plan and request_item_id = v_item_1;
  v_settings := public.fn_get_long_stock_layout_settings_snapshot();
  v_segments := jsonb_build_array(jsonb_build_object(
    'plan_item_id', v_plan_item,
    'segment_number', 1,
    'required_length_mm', 1200,
    'required_weight_kg', 2.4
  ));
  v_candidates := jsonb_build_array(jsonb_build_object(
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
        'cut_number', 1, 'segment_number', 1, 'cut_length_mm', 1200
      ))
    ))
  ));
  v_version := public.fn_get_or_create_long_stock_cutting_plan_version_v2(
    v_plan,
    jsonb_build_object('case', 'draft-race', 'material_id', v_material, 'material_variant_id', v_variant),
    v_settings,
    v_segments,
    v_candidates,
    1,
    v_actor,
    null,
    '{}'::jsonb
  );
  v_pdf := jsonb_build_object(
    'schema_version', 1,
    'bucket_id', 'product-files',
    'object_path', format('long-stock-cutting-plans/%s/%s/%s.pdf', v_plan, v_version, gen_random_uuid()),
    'file_name', 'cutting-plan-' || (select plan_number from public.long_stock_cutting_plans where id = v_plan) || '-v1.pdf',
    'mime_type', 'application/pdf',
    'size_bytes', 512,
    'sha256', repeat('d', 64),
    'generated_by', v_actor,
    'generated_at', now()
  );
  v_approval := public.fn_approve_long_stock_cutting_plan_version_v2(v_version, v_actor, v_pdf);
  if v_approval->>'status' <> 'approved'
    or (select is_cutting_plan_draft from public.request_circle where id = v_item_1)
    or not (select is_cutting_plan_draft from public.request_circle where id = v_item_2) then
    raise exception 'Approval did not activate exactly one prepared row: %', v_approval;
  end if;
  perform public.fn_approve_long_stock_cutting_plan_version_v2(v_version, v_actor, v_pdf);
  if (select count(*) from public.request_circle where id = v_item_1 and not is_cutting_plan_draft) <> 1 then
    raise exception 'Repeated approval duplicated or hid the active row';
  end if;

  update public.technologist_requests
  set status = 'pending_stock_check', updated_at = now()
  where id = v_request;
  if exists (select 1 from public.request_circle where id = v_item_2)
    or exists (select 1 from public.request_pipe where id = (v_pipe_draft->>'id')::uuid)
    or exists (select 1 from public.request_knives where id = (v_knife_draft->>'id')::uuid)
    or not exists (select 1 from public.request_circle where id = v_item_1 and not is_cutting_plan_draft) then
    raise exception 'Request transition did not keep the approved row and delete the stale draft';
  end if;
  begin
    perform public.fn_prepare_long_stock_request_item_draft_v1(
      v_request, 'request_circle', v_item_2,
      jsonb_build_object('remainder_mm', 1200, 'material_id', v_material, 'material_variant_id', v_variant),
      v_actor
    );
    raise exception 'A stale tab recreated a draft after request submission';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[CUTTING_DRAFT_STALE]%' then raise; end if;
  end;
end;
$$;

-- Server-only mutation boundary: browser roles must not execute lifecycle RPCs.
do $$
begin
  if has_function_privilege('authenticated', 'public.fn_preview_supply_position_revision_v1(text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_return_supply_position_to_technologist_v1(text,uuid,text,uuid,boolean)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_create_supply_position_revision_request_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_submit_supply_position_revision_v1(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_prepare_long_stock_request_item_draft_v1(uuid,text,uuid,jsonb,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_discard_long_stock_request_item_drafts_v1(uuid,uuid,text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.fn_cancel_returned_supply_position_v1(text,uuid,text,uuid)', 'EXECUTE') then
    raise exception 'Authenticated role can execute a protected revision RPC';
  end if;
end;
$$;

rollback;
