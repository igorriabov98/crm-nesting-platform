-- Close technologist requests from immutable long-stock cutting facts.
-- Percentage-based waste remains unchanged for metallic positions without a
-- cutting plan. Planned positions never create percentage-derived scrap lots.

create table public.technologist_request_plan_fact_items (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null
    references public.technologist_request_completions(id) on delete restrict,
  request_id uuid not null
    references public.technologist_requests(id) on delete restrict,
  source_table text not null
    check (source_table in ('request_pipe', 'request_circle', 'request_knives')),
  source_id uuid not null,
  plan_id uuid not null
    references public.long_stock_cutting_plans(id) on delete restrict,
  version_id uuid not null
    references public.long_stock_cutting_plan_versions(id) on delete restrict,
  purchased_weight_kg numeric(14,3) not null check (purchased_weight_kg > 0),
  net_weight_kg numeric(14,3) not null check (net_weight_kg >= 0),
  kerf_loss_weight_kg numeric(14,3) not null check (kerf_loss_weight_kg >= 0),
  end_trim_loss_weight_kg numeric(14,3) not null check (end_trim_loss_weight_kg >= 0),
  business_scrap_weight_kg numeric(14,3) not null check (business_scrap_weight_kg >= 0),
  reconciliation_delta_kg numeric(14,3) not null
    check (abs(reconciliation_delta_kg) <= 0.001),
  fact_bar_count integer not null check (fact_bar_count > 0),
  created_at timestamptz not null default now(),
  unique (request_id, source_table, source_id)
);

alter table public.technologist_request_plan_fact_items enable row level security;
revoke all on table public.technologist_request_plan_fact_items
  from public, anon, authenticated;
grant select, insert on table public.technologist_request_plan_fact_items
  to service_role;

comment on table public.technologist_request_plan_fact_items is
  'Immutable completion snapshot of net weight, analytical cutting losses and business remnants from applied facts of the approved long-stock plan version.';
comment on column public.technologist_request_plan_fact_items.purchased_weight_kg is
  'Physical input weight of fact-matched bars. For a warehouse remnant this is its consumed source weight, even though candidate.purchased_weight_kg is zero.';

create or replace function public.fn_get_long_stock_completion_plan_facts_v1(
  p_request_id uuid
)
returns table (
  request_item_table text,
  request_item_id uuid,
  item_name text,
  plan_id uuid,
  plan_status text,
  version_id uuid,
  planned_bar_count integer,
  fact_bar_count integer,
  actual_loss_bar_count integer,
  purchased_weight_kg numeric,
  net_weight_kg numeric,
  kerf_loss_weight_kg numeric,
  end_trim_loss_weight_kg numeric,
  business_scrap_weight_kg numeric,
  reconciliation_delta_kg numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with plan_rows as (
    select
      item.request_item_table,
      item.request_item_id,
      coalesce(
        case when item.request_item_table = 'request_circle' then (
          select concat_ws(' · ', 'Круг Ø' || circle.diameter_mm || ' мм', circle.steel_grade)
          from public.request_circle circle where circle.id = item.request_item_id
        ) end,
        case when item.request_item_table = 'request_pipe' then (
          select concat_ws(' · ', pipe.pipe_type, pipe.size)
          from public.request_pipe pipe where pipe.id = item.request_item_id
        ) end,
        case when item.request_item_table = 'request_knives' then (
          select concat_ws(' · ', knife.knife_type, knife.steel_grade)
          from public.request_knives knife where knife.id = item.request_item_id
        ) end,
        item.request_item_table || ' · ' || item.request_item_id::text
      ) as item_name,
      plan.id as plan_id,
      plan.status as plan_status,
      approved.id as version_id,
      candidate.id as candidate_id,
      coalesce(variant.weight_per_m_kg, 0) as weight_per_m_kg
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan on plan.id = item.plan_id
    left join lateral (
      select version.*
      from public.long_stock_cutting_plan_versions version
      where version.plan_id = plan.id
        and version.status = 'approved'
      order by version.approved_at desc, version.id desc
      limit 1
    ) approved on true
    left join public.long_stock_cutting_candidates candidate
      on candidate.version_id = approved.id
     and candidate.candidate_number = approved.selected_candidate_number
    left join public.material_variants variant
      on variant.id = plan.material_variant_id
    where item.request_id = p_request_id
  ), fact_totals as (
    select
      plan_row.*,
      coalesce(planned.planned_bar_count, 0)::integer as planned_bar_count,
      coalesce(facts.fact_bar_count, 0)::integer as fact_bar_count,
      coalesce(losses.actual_loss_bar_count, 0)::integer as actual_loss_bar_count,
      round(coalesce(facts.purchased_weight_kg, 0), 3) as purchased_weight_kg,
      round(coalesce(net.net_weight_kg, 0), 3) as net_weight_kg,
      round(coalesce(losses.kerf_loss_weight_kg, 0), 3) as kerf_loss_weight_kg,
      round(coalesce(losses.end_trim_loss_weight_kg, 0), 3) as end_trim_loss_weight_kg,
      round(coalesce(scraps.business_scrap_weight_kg, 0), 3) as business_scrap_weight_kg
    from plan_rows plan_row
    left join lateral (
      select count(*)::integer as planned_bar_count
      from public.long_stock_cutting_candidate_bars bar
      where bar.candidate_id = plan_row.candidate_id
        and bar.version_id = plan_row.version_id
        and bar.status <> 'cancelled'
    ) planned on true
    left join lateral (
      select
        count(*)::integer as fact_bar_count,
        sum(bar.stock_length_mm * plan_row.weight_per_m_kg / 1000) as purchased_weight_kg
      from public.long_stock_cutting_fact_bars fact_bar
      join public.long_stock_cutting_candidate_bars bar on bar.id = fact_bar.bar_id
      join public.production_fact_cutting_events event on event.id = fact_bar.event_id
      where fact_bar.version_id = plan_row.version_id
        and bar.candidate_id = plan_row.candidate_id
        and fact_bar.rolled_back_at is null
        and event.status = 'applied'
    ) facts on true
    left join lateral (
      select sum(cut.cut_length_mm * plan_row.weight_per_m_kg / 1000) as net_weight_kg
      from public.long_stock_cutting_fact_bars fact_bar
      join public.long_stock_cutting_candidate_bars bar on bar.id = fact_bar.bar_id
      join public.production_fact_cutting_events event on event.id = fact_bar.event_id
      join public.long_stock_cutting_bar_cuts cut on cut.bar_id = fact_bar.bar_id
      where fact_bar.version_id = plan_row.version_id
        and bar.candidate_id = plan_row.candidate_id
        and fact_bar.rolled_back_at is null
        and event.status = 'applied'
    ) net on true
    left join lateral (
      select
        count(*)::integer as actual_loss_bar_count,
        sum(loss.kerf_loss_weight_kg) as kerf_loss_weight_kg,
        sum(loss.end_trim_loss_weight_kg) as end_trim_loss_weight_kg
      from public.long_stock_cutting_fact_bars fact_bar
      join public.long_stock_cutting_candidate_bars bar on bar.id = fact_bar.bar_id
      join public.production_fact_cutting_events event on event.id = fact_bar.event_id
      join public.long_stock_cutting_actual_losses loss
        on loss.version_id = fact_bar.version_id
       and loss.bar_id = fact_bar.bar_id
      where fact_bar.version_id = plan_row.version_id
        and bar.candidate_id = plan_row.candidate_id
        and fact_bar.rolled_back_at is null
        and event.status = 'applied'
    ) losses on true
    left join lateral (
      select sum(
        result_inventory.piece_length_mm * plan_row.weight_per_m_kg / 1000
      ) as business_scrap_weight_kg
      from public.long_stock_cutting_fact_bars fact_bar
      join public.long_stock_cutting_candidate_bars bar on bar.id = fact_bar.bar_id
      join public.production_fact_cutting_events event on event.id = fact_bar.event_id
      join public.inventory result_inventory on result_inventory.id = fact_bar.result_inventory_id
      where fact_bar.version_id = plan_row.version_id
        and bar.candidate_id = plan_row.candidate_id
        and fact_bar.rolled_back_at is null
        and event.status = 'applied'
    ) scraps on true
  )
  select
    fact.request_item_table,
    fact.request_item_id,
    fact.item_name,
    fact.plan_id,
    fact.plan_status,
    fact.version_id,
    fact.planned_bar_count,
    fact.fact_bar_count,
    fact.actual_loss_bar_count,
    fact.purchased_weight_kg,
    fact.net_weight_kg,
    fact.kerf_loss_weight_kg,
    fact.end_trim_loss_weight_kg,
    fact.business_scrap_weight_kg,
    round(
      fact.purchased_weight_kg
      - fact.net_weight_kg
      - fact.kerf_loss_weight_kg
      - fact.end_trim_loss_weight_kg
      - fact.business_scrap_weight_kg,
      3
    ) as reconciliation_delta_kg
  from fact_totals fact
  order by fact.request_item_table, fact.request_item_id;
$$;

revoke all on function public.fn_get_long_stock_completion_plan_facts_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_get_long_stock_completion_plan_facts_v1(uuid)
  to service_role;

create or replace function public.fn_finalize_technologist_request(
  p_request_id uuid,
  p_actor uuid,
  p_decision text,
  p_entered_plasma_minutes integer,
  p_waste_items jsonb,
  p_future_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.technologist_requests%rowtype;
  v_machine public.machines%rowtype;
  v_completion uuid;
  v_batch uuid;
  v_item jsonb;
  v_weight numeric;
  v_pct numeric;
  v_part uuid;
  v_lot uuid;
  v_now timestamptz := now();
  v_detailing_check jsonb;
  v_plan_fact record;
  v_plan_count integer;
  v_manual_count integer;
  v_payload_count integer;
begin
  if p_actor is null or p_actor <> auth.uid() then raise exception 'Недостаточно прав'; end if;
  if p_decision not in ('has_items', 'none') or p_entered_plasma_minutes < 0 then
    raise exception 'Некорректные данные завершения';
  end if;
  if jsonb_typeof(coalesce(p_waste_items, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_future_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректные данные позиций завершения';
  end if;

  select * into v_request
  from public.technologist_requests
  where id = p_request_id
  for update;
  if not found or v_request.created_by <> p_actor then raise exception 'Заявка недоступна'; end if;
  if v_request.status not in ('pending_stock_check', 'stock_checked') then raise exception 'Заявка уже завершена'; end if;

  select * into v_machine from public.machines where id = v_request.machine_id;
  if v_machine.factory_id is null then raise exception 'У машины не указан завод'; end if;

  v_detailing_check := public.fn_validate_detailing_request_check(p_request_id, p_actor);
  if coalesce((v_detailing_check->>'ready')::boolean, false) = false then
    raise exception '%', coalesce(v_detailing_check->>'message', 'Проверьте бронь деталировки');
  end if;
  if exists (
    select 1 from public.technologist_request_completions where request_id = p_request_id
  ) then
    raise exception 'Заявка уже зафиксирована';
  end if;

  if p_decision = 'has_items' and jsonb_array_length(coalesce(p_future_items, '[]'::jsonb)) = 0 then
    raise exception 'Добавьте будущую деталировку';
  end if;
  if p_decision = 'none' and jsonb_array_length(coalesce(p_future_items, '[]'::jsonb)) > 0 then
    raise exception 'Решение не соответствует деталировке';
  end if;

  -- Lock the exact plan/fact rows used for the completion snapshot. A rollback
  -- or inventory rewrite must wait until this finalization transaction ends.
  perform 1
  from public.long_stock_cutting_plan_items item
  join public.long_stock_cutting_plans plan on plan.id = item.plan_id
  where item.request_id = p_request_id
  for update of item, plan;
  perform 1
  from public.long_stock_cutting_plan_versions version
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
  for update of version;
  perform 1
  from public.long_stock_cutting_candidate_bars bar
  join public.long_stock_cutting_plan_versions version on version.id = bar.version_id
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
  for update of bar;
  perform 1
  from public.long_stock_cutting_fact_bars fact_bar
  join public.long_stock_cutting_plan_versions version on version.id = fact_bar.version_id
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
    and fact_bar.rolled_back_at is null
  for update of fact_bar;
  perform 1
  from public.long_stock_cutting_actual_losses loss
  join public.long_stock_cutting_plan_versions version on version.id = loss.version_id
  join public.long_stock_cutting_plan_items item on item.plan_id = version.plan_id
  where item.request_id = p_request_id
  for update of loss;

  select count(*) into v_plan_count
  from public.long_stock_cutting_plan_items item
  where item.request_id = p_request_id;

  with metallic_items as (
    select 'request_sheet_metal'::text as source_table, sheet.id as source_id
    from public.request_sheet_metal sheet where sheet.request_id = p_request_id
    union all
    select 'request_pipe', pipe.id from public.request_pipe pipe where pipe.request_id = p_request_id
    union all
    select 'request_circle', circle.id from public.request_circle circle where circle.request_id = p_request_id
    union all
    select 'request_knives', knife.id from public.request_knives knife where knife.request_id = p_request_id
  )
  select count(*) into v_manual_count
  from metallic_items item
  where not exists (
    select 1
    from public.long_stock_cutting_plan_items plan_item
    where plan_item.request_id = p_request_id
      and plan_item.request_item_table = item.source_table
      and plan_item.request_item_id = item.source_id
  );

  v_payload_count := jsonb_array_length(coalesce(p_waste_items, '[]'::jsonb));
  if v_payload_count = 0 and v_plan_count = 0 then
    raise exception 'Укажите отходность металлических позиций';
  end if;
  if v_payload_count <> v_manual_count then
    raise exception 'Укажите отходность только для обычных металлических позиций без карты раскроя';
  end if;
  if exists (
    with metallic_items as (
      select 'request_sheet_metal'::text as source_table, sheet.id as source_id
      from public.request_sheet_metal sheet where sheet.request_id = p_request_id
      union all
      select 'request_pipe', pipe.id from public.request_pipe pipe where pipe.request_id = p_request_id
      union all
      select 'request_circle', circle.id from public.request_circle circle where circle.request_id = p_request_id
      union all
      select 'request_knives', knife.id from public.request_knives knife where knife.request_id = p_request_id
    ), expected_items as (
      select item.source_table, item.source_id
      from metallic_items item
      where not exists (
        select 1
        from public.long_stock_cutting_plan_items plan_item
        where plan_item.request_id = p_request_id
          and plan_item.request_item_table = item.source_table
          and plan_item.request_item_id = item.source_id
      )
    ), payload_items as (
      select distinct
        payload->>'sourceTable' as source_table,
        (payload->>'sourceId')::uuid as source_id
      from jsonb_array_elements(coalesce(p_waste_items, '[]'::jsonb)) payload
      where payload->>'sourceTable' in (
        'request_sheet_metal', 'request_pipe', 'request_circle', 'request_knives'
      )
    ), differences as (
      (select * from expected_items except select * from payload_items)
      union all
      (select * from payload_items except select * from expected_items)
    )
    select 1 from differences
  ) then
    raise exception 'Список обычных металлических позиций не соответствует заявке';
  end if;

  -- A plan-linked position is closed only from all applied bar facts of the
  -- currently approved version. Every mismatch names the concrete position.
  for v_plan_fact in
    select * from public.fn_get_long_stock_completion_plan_facts_v1(p_request_id)
  loop
    if v_plan_fact.version_id is null then
      raise exception 'Для позиции «%» нет утверждённой версии карты раскроя', v_plan_fact.item_name;
    end if;
    if v_plan_fact.plan_status <> 'closed'
       or v_plan_fact.planned_bar_count <= 0
       or v_plan_fact.fact_bar_count <> v_plan_fact.planned_bar_count then
      raise exception 'Не все хлысты позиции «%» закрыты фактами утверждённой карты', v_plan_fact.item_name;
    end if;
    if v_plan_fact.actual_loss_bar_count <> v_plan_fact.fact_bar_count then
      raise exception 'Для позиции «%» не записаны потери всех порезанных хлыстов', v_plan_fact.item_name;
    end if;
    if abs(v_plan_fact.reconciliation_delta_kg) > 0.001 then
      raise exception
        'Сверка веса не сошлась для позиции «%»: входной вес % кг, чистый % кг, пропил % кг, торцовка % кг, деловые остатки % кг, расхождение % кг',
        v_plan_fact.item_name,
        v_plan_fact.purchased_weight_kg,
        v_plan_fact.net_weight_kg,
        v_plan_fact.kerf_loss_weight_kg,
        v_plan_fact.end_trim_loss_weight_kg,
        v_plan_fact.business_scrap_weight_kg,
        v_plan_fact.reconciliation_delta_kg;
    end if;
  end loop;

  insert into public.technologist_request_completions(
    request_id, machine_id, factory_id, created_by,
    future_detailing_decision, entered_plasma_minutes,
    added_plasma_minutes, actual_plasma_minutes
  ) values (
    p_request_id, v_request.machine_id, v_machine.factory_id, p_actor,
    p_decision, p_entered_plasma_minutes,
    ceil(p_entered_plasma_minutes * 0.25),
    p_entered_plasma_minutes + ceil(p_entered_plasma_minutes * 0.25)
  ) returning id into v_completion;

  insert into public.technologist_request_plan_fact_items(
    completion_id, request_id, source_table, source_id, plan_id, version_id,
    purchased_weight_kg, net_weight_kg,
    kerf_loss_weight_kg, end_trim_loss_weight_kg,
    business_scrap_weight_kg, reconciliation_delta_kg, fact_bar_count
  )
  select
    v_completion, p_request_id,
    fact.request_item_table, fact.request_item_id,
    fact.plan_id, fact.version_id,
    fact.purchased_weight_kg, fact.net_weight_kg,
    fact.kerf_loss_weight_kg, fact.end_trim_loss_weight_kg,
    fact.business_scrap_weight_kg, fact.reconciliation_delta_kg,
    fact.fact_bar_count
  from public.fn_get_long_stock_completion_plan_facts_v1(p_request_id) fact;

  -- Preserve the old percentage calculation only for ordinary positions.
  for v_item in
    select * from jsonb_array_elements(coalesce(p_waste_items, '[]'::jsonb))
  loop
    if v_item->>'sourceTable' not in (
      'request_sheet_metal', 'request_pipe', 'request_circle', 'request_knives'
    ) then
      raise exception 'Некорректный тип позиции';
    end if;
    if exists (
      select 1
      from public.long_stock_cutting_plan_items plan_item
      where plan_item.request_id = p_request_id
        and plan_item.request_item_table = v_item->>'sourceTable'
        and plan_item.request_item_id = (v_item->>'sourceId')::uuid
    ) then
      raise exception 'Позиция «%» учитывается по фактам карты раскроя; процент отхода передавать нельзя',
        coalesce(v_item->>'itemName', v_item->>'sourceId');
    end if;

    execute format(
      'select calculated_weight_kg from public.%I where id=$1 and request_id=$2',
      v_item->>'sourceTable'
    ) into v_weight using (v_item->>'sourceId')::uuid, p_request_id;
    if v_weight is null or v_weight <= 0 then
      raise exception 'Не рассчитан вес позиции: %', coalesce(v_item->>'itemName', v_item->>'sourceId');
    end if;

    v_pct := nullif(v_item->>'wastePercent', '')::numeric;
    if v_pct is null or v_pct < 0 or v_pct > 100 or v_pct <> round(v_pct, 1) then
      raise exception 'Отходность должна быть 0–100%% с точностью 0,1';
    end if;

    insert into public.technologist_request_waste_items(
      completion_id, request_id, source_table, source_id, item_name,
      material_id, material_variant_id, material_name, material_grade,
      weight_snapshot_kg, waste_percent, scrap_weight_kg, useful_weight_kg
    ) values (
      v_completion, p_request_id,
      v_item->>'sourceTable', (v_item->>'sourceId')::uuid,
      coalesce(nullif(v_item->>'itemName', ''), 'Позиция'),
      nullif(v_item->>'materialId', '')::uuid,
      nullif(v_item->>'materialVariantId', '')::uuid,
      coalesce(nullif(v_item->>'materialName', ''), 'Металл'),
      nullif(v_item->>'materialGrade', ''),
      v_weight, v_pct,
      round(v_weight * v_pct / 100, 3),
      round(v_weight - (v_weight * v_pct / 100), 3)
    ) returning id into v_part;

    insert into public.metal_scrap_lots(
      request_id, waste_item_id, machine_id, factory_id, created_by,
      material_id, material_variant_id, material_name, material_grade,
      expected_weight_kg
    )
    select
      p_request_id, v_part, v_request.machine_id, v_machine.factory_id, p_actor,
      material_id, material_variant_id, material_name, material_grade,
      scrap_weight_kg
    from public.technologist_request_waste_items
    where id = v_part
    returning id into v_lot;

    insert into public.metal_scrap_movements(
      lot_id, movement_type, weight_delta_kg,
      available_after_kg, blocked_after_kg, sold_after_kg, performed_by
    ) values (
      v_lot, 'planned', round(v_weight * v_pct / 100, 3),
      0, 0, 0, p_actor
    );
  end loop;

  insert into public.future_detailing_batches(
    request_id, machine_id, factory_id, created_by, status
  ) values (
    p_request_id, v_request.machine_id, v_machine.factory_id, p_actor,
    case when p_decision = 'none' then 'cancelled' else 'planned' end
  ) returning id into v_batch;

  for v_item in
    select * from jsonb_array_elements(coalesce(p_future_items, '[]'::jsonb))
  loop
    v_part := nullif(v_item->>'partId', '')::uuid;
    if v_part is null then
      insert into public.detailing_parts(
        name, drawing_number, unit_weight_kg, created_by, updated_by
      ) values (
        v_item->>'name', v_item->>'drawingNumber',
        (v_item->>'unitWeightKg')::numeric, p_actor, p_actor
      ) returning id into v_part;

      insert into public.detailing_part_products(
        part_id, product_id, applies_to_all_versions
      )
      select
        v_part, (compatibility->>'productId')::uuid,
        (compatibility->>'allVersions')::boolean
      from jsonb_array_elements(v_item->'compatibilities') compatibility;

      insert into public.detailing_part_product_versions(
        part_product_id, product_version_id
      )
      select product.id, version_id::uuid
      from jsonb_array_elements(v_item->'compatibilities') compatibility
      join public.detailing_part_products product
        on product.part_id = v_part
       and product.product_id = (compatibility->>'productId')::uuid
      cross join lateral jsonb_array_elements_text(
        coalesce(compatibility->'versionIds', '[]'::jsonb)
      ) version_id
      where not product.applies_to_all_versions;
    end if;

    if not exists (
      select 1 from public.detailing_parts where id = v_part and is_active
    ) then
      raise exception 'Карточка деталировки недоступна';
    end if;
    insert into public.future_detailing_items(batch_id, part_id, planned_quantity)
    values (v_batch, v_part, (v_item->>'quantity')::integer);
  end loop;

  update public.technologist_requests
  set status = 'submitted_to_supply', submitted_at = v_now, updated_at = v_now
  where id = p_request_id;
  update public.machines
  set status = 'request_ready', updated_at = v_now
  where id = v_request.machine_id and status = 'planned';

  return v_completion;
end;
$$;

revoke all on function public.fn_finalize_technologist_request(uuid, uuid, text, integer, jsonb, jsonb)
  from public, anon;
grant execute on function public.fn_finalize_technologist_request(uuid, uuid, text, integer, jsonb, jsonb)
  to authenticated;
