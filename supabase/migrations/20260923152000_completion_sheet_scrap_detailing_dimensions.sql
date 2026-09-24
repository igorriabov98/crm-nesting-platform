-- Future sheet remnants are tied to the approved completion and the first
-- physical cutting fact. Their quantity is pieces, matching sheet inventory.
alter table public.detailing_parts
  add column width_mm numeric(12,1) check (width_mm > 0),
  add column height_mm numeric(12,1) check (height_mm > 0),
  add column thickness_mm numeric(12,1) check (thickness_mm > 0);

alter table public.technologist_request_waste_items
  add column waste_basis_kg numeric(14,3),
  add column business_scrap_weight_kg numeric(14,3) not null default 0;
-- Approved completion rows are immutable to application writes. Hold the
-- table lock and suspend only that guard while filling this new legacy column;
-- the migration runner wraps the change and re-enable in one transaction.
alter table public.technologist_request_waste_items
  disable trigger financial_approval_waste_guard;
update public.technologist_request_waste_items
set waste_basis_kg = weight_snapshot_kg where waste_basis_kg is null;
alter table public.technologist_request_waste_items
  enable trigger financial_approval_waste_guard;
alter table public.technologist_request_waste_items
  alter column waste_basis_kg set not null;
alter table public.technologist_request_waste_items
  add constraint technologist_waste_weight_balance check (
    abs(weight_snapshot_kg - business_scrap_weight_kg - scrap_weight_kg - useful_weight_kg) <= 0.001
    and waste_basis_kg >= 0 and business_scrap_weight_kg >= 0
  );

-- Historical callers that do not plan sheet remnants still write the old
-- four-weight payload. Their waste basis is the entire source weight.
create function public.fn_default_technologist_waste_basis_v1()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.waste_basis_kg is null then
    new.waste_basis_kg := new.weight_snapshot_kg;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_default_technologist_waste_basis_v1() from public,anon,authenticated;
create trigger technologist_waste_basis_default
before insert on public.technologist_request_waste_items
for each row execute function public.fn_default_technologist_waste_basis_v1();

create table public.technologist_sheet_scrap_plans (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null references public.technologist_request_completions(id) on delete restrict,
  request_id uuid not null references public.technologist_requests(id) on delete restrict,
  source_item_id uuid not null references public.request_sheet_metal(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  inventory_id uuid not null unique references public.inventory(id) on delete restrict,
  length_mm numeric(12,1) not null check (length_mm > 0),
  width_mm numeric(12,1) not null check (width_mm > 0),
  quantity integer not null check (quantity > 0),
  weight_kg numeric(14,3) not null check (weight_kg > 0),
  promoted_event_id uuid references public.production_fact_cutting_events(id) on delete restrict,
  created_at timestamptz not null default now()
);
create unique index technologist_sheet_scrap_plan_line_unique
  on public.technologist_sheet_scrap_plans(source_item_id,line_number);
create index technologist_sheet_scrap_plans_request_idx on public.technologist_sheet_scrap_plans(request_id, source_item_id);
revoke all on public.technologist_sheet_scrap_plans from public, anon, authenticated;
alter table public.technologist_sheet_scrap_plans enable row level security;
grant select on public.technologist_sheet_scrap_plans to service_role;

create or replace function public.fn_calculate_sheet_scrap_plan_v1(
  p_sheet_size text, p_sheet_quantity integer, p_weight_kg numeric,
  p_scraps jsonb, p_waste_percent numeric
) returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_sides numeric[];
  v_source_area numeric;
  v_total_area numeric;
  v_area numeric := 0;
  v_length numeric;
  v_width numeric;
  v_qty integer;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_remnant numeric := 0;
  v_row_weight numeric;
  v_basis numeric;
  v_scrap numeric;
begin
  v_sides := public.parse_size_dimensions(p_sheet_size);
  if v_sides is null or cardinality(v_sides) <> 2 or v_sides[1] <= 0 or v_sides[2] <= 0
     or p_sheet_quantity is null or p_sheet_quantity <= 0 or p_weight_kg is null or p_weight_kg <= 0 then
    raise exception 'Не рассчитаны размер, количество или вес исходных листов';
  end if;
  if jsonb_typeof(coalesce(p_scraps, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный список деловых остатков';
  end if;
  if p_waste_percent is null or p_waste_percent < 0 or p_waste_percent > 100
     or p_waste_percent <> round(p_waste_percent, 1) then
    raise exception 'Отходность должна быть 0–100%% с точностью 0,1';
  end if;
  v_source_area := v_sides[1] * v_sides[2];
  v_total_area := v_source_area * p_sheet_quantity;
  for v_row in select value from jsonb_array_elements(coalesce(p_scraps, '[]'::jsonb)) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'Некорректная строка делового остатка'; end if;
    v_length := (v_row->>'lengthMm')::numeric;
    v_width := (v_row->>'widthMm')::numeric;
    if coalesce(v_row->>'quantity','') !~ '^[0-9]+$' then
      raise exception 'Количество деловых остатков должно быть целым';
    end if;
    v_qty := (v_row->>'quantity')::integer;
    if v_length is null or v_width is null or v_length <= 0 or v_width <= 0
       or v_length <> round(v_length, 1) or v_width <> round(v_width, 1)
       or v_qty is null or v_qty <= 0 or v_qty > p_sheet_quantity
       or v_length * v_width >= v_source_area
       or not ((v_length <= v_sides[1] and v_width <= v_sides[2])
            or (v_length <= v_sides[2] and v_width <= v_sides[1])) then
      raise exception 'Деловой остаток не помещается в исходный лист';
    end if;
    v_area := v_area + v_length * v_width * v_qty;
    v_row_weight := round(p_weight_kg * v_length * v_width * v_qty / v_total_area, 3);
    if v_row_weight <= 0 then raise exception 'Вес делового остатка слишком мал'; end if;
    v_remnant := v_remnant + v_row_weight;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'lengthMm', v_length, 'widthMm', v_width, 'quantity', v_qty, 'weightKg', v_row_weight
    ));
  end loop;
  if v_area > v_total_area then raise exception 'Суммарная площадь остатков превышает площадь листов'; end if;
  v_basis := p_weight_kg - v_remnant;
  if v_basis < 0 then raise exception 'Вес деловых остатков превышает вес исходных листов'; end if;
  v_scrap := round(v_basis * p_waste_percent / 100, 3);
  return jsonb_build_object('rows', v_rows, 'scrapWeightKg', v_remnant,
    'wasteBasisKg', v_basis, 'metalScrapKg', v_scrap,
    'usefulKg', p_weight_kg - v_remnant - v_scrap);
end;
$$;
revoke all on function public.fn_calculate_sheet_scrap_plan_v1(text,integer,numeric,jsonb,numeric) from public, anon, authenticated;

-- Keep the existing create RPC signature for old clients; new clients use this
-- atomic wrapper to attach optional physical dimensions.
create function public.fn_create_detailing_part_with_dimensions(
  p_name text, p_drawing_number text, p_unit_weight_kg numeric,
  p_factory_id uuid, p_initial_quantity integer, p_compatibilities jsonb,
  p_actor uuid, p_width_mm numeric, p_height_mm numeric, p_thickness_mm numeric
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if p_actor is null or p_actor <> auth.uid() then raise exception 'Недостаточно прав'; end if;
  if (p_width_mm is not null and p_width_mm <= 0)
     or (p_height_mm is not null and p_height_mm <= 0)
     or (p_thickness_mm is not null and p_thickness_mm <= 0) then
    raise exception 'Габариты должны быть больше нуля';
  end if;
  v_id := public.fn_create_detailing_part(p_name,p_drawing_number,p_unit_weight_kg,
    p_factory_id,p_initial_quantity,p_compatibilities,p_actor);
  update public.detailing_parts set width_mm=p_width_mm,height_mm=p_height_mm,
    thickness_mm=p_thickness_mm where id=v_id;
  return v_id;
end;
$$;
revoke all on function public.fn_create_detailing_part_with_dimensions(text,text,numeric,uuid,integer,jsonb,uuid,numeric,numeric,numeric) from public, anon;
grant execute on function public.fn_create_detailing_part_with_dimensions(text,text,numeric,uuid,integer,jsonb,uuid,numeric,numeric,numeric) to authenticated,service_role;

create function public.fn_update_detailing_part_dimensions(
  p_part_id uuid, p_width_mm numeric, p_height_mm numeric, p_thickness_mm numeric, p_actor uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_actor is null or p_actor <> auth.uid() then raise exception 'Недостаточно прав'; end if;
  perform public.detailing_assert_actor(p_actor,
    array['technologist','procurement_head','planning_director','financial_director','commercial_director']::public.user_role[]);
  update public.detailing_parts set width_mm=p_width_mm,height_mm=p_height_mm,
    thickness_mm=p_thickness_mm,updated_by=p_actor,updated_at=now()
  where id=p_part_id and is_active=true;
  if not found then raise exception 'Карточка деталировки недоступна'; end if;
end;
$$;
revoke all on function public.fn_update_detailing_part_dimensions(uuid,numeric,numeric,numeric,uuid) from public, anon;
grant execute on function public.fn_update_detailing_part_dimensions(uuid,numeric,numeric,numeric,uuid) to authenticated,service_role;

create function public.fn_promote_sheet_scrap_for_cutting_event_v1(
  p_event_id uuid, p_plan_id uuid default null
) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event public.production_fact_cutting_events%rowtype;
  v_plan public.technologist_sheet_scrap_plans%rowtype;
  v_count integer := 0;
begin
  select * into v_event from public.production_fact_cutting_events
  where id=p_event_id and status in ('applied','kept') for update;
  if not found then raise exception 'Подтверждённый факт заготовки не найден'; end if;
  for v_plan in
    select plan.* from public.technologist_sheet_scrap_plans plan
    join public.technologist_request_completions completion on completion.id=plan.completion_id
    where completion.machine_id=v_event.machine_id and plan.promoted_event_id is null
      and (p_plan_id is null or plan.id=p_plan_id)
    order by plan.created_at,plan.id for update of plan
  loop
    insert into public.production_fact_cutting_event_scrap_promotions(
      event_id,inventory_id,previous_business_scrap_state
    ) values (v_event.id,v_plan.inventory_id,'future') on conflict do nothing;
    update public.inventory set business_scrap_state='available',updated_at=now(),
      last_updated_by=coalesce(v_event.created_by,last_updated_by)
    where id=v_plan.inventory_id and business_scrap_state='future' and deleted_at is null;
    if not found then raise exception 'Будущий листовой остаток уже изменён или недоступен'; end if;
    update public.technologist_sheet_scrap_plans
      set promoted_event_id=v_event.id where id=v_plan.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.fn_promote_sheet_scrap_for_cutting_event_v1(uuid,uuid) from public,anon,authenticated;

create function public.fn_sheet_scrap_on_cutting_event_v1()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('applied','kept') and
     (tg_op='INSERT' or old.status is distinct from new.status) then
    perform public.fn_promote_sheet_scrap_for_cutting_event_v1(new.id,null);
  elsif tg_op='UPDATE' and new.status='rolled_back' and old.status in ('applied','kept') then
    update public.technologist_sheet_scrap_plans set promoted_event_id=null
    where promoted_event_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_sheet_scrap_on_cutting_event_v1() from public,anon,authenticated;
create trigger sheet_scrap_cutting_event
after insert or update of status on public.production_fact_cutting_events
for each row execute function public.fn_sheet_scrap_on_cutting_event_v1();

-- The date-only promoter must never unlock an approved sheet remnant.
create or replace function public.fn_promote_due_future_business_scrap(p_today date default current_date)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0;
begin
  with promoted as (
    update public.inventory as inventory set business_scrap_state='available',updated_at=now()
    from public.production_stages as stage
    where inventory.is_business_scrap=true and inventory.business_scrap_state='future'
      and inventory.deleted_at is null and inventory.available_from_stage_id=stage.id
      and stage.stage_type='cutting'::public.stage_type
      and stage.date_start is not null and stage.date_start<=p_today
      and not exists (select 1 from public.long_stock_cutting_business_scraps ls where ls.inventory_id=inventory.id)
      and not exists (select 1 from public.technologist_sheet_scrap_plans ss where ss.inventory_id=inventory.id)
      and (inventory.source_reservation_id is null or exists (
        select 1 from public.inventory_reservations r where r.id=inventory.source_reservation_id and r.consumed_at is not null
      ))
    returning inventory.id
  ) select count(*) into v_count from promoted;
  return v_count;
end;
$$;
revoke all on function public.fn_promote_due_future_business_scrap(date) from public,anon,authenticated;
grant execute on function public.fn_promote_due_future_business_scrap(date) to service_role;

-- Finalize approved sheet plans in the same transaction as waste and future detailing.
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
  v_sheet public.request_sheet_metal%rowtype;
  v_sheet_result jsonb;
  v_sheet_scrap jsonb;
  v_scrap_weight numeric;
  v_waste_basis numeric;
  v_metal_scrap numeric;
  v_useful numeric;
  v_variant uuid;
  v_inventory uuid;
  v_existing_event uuid;
  v_scrap_ordinal integer;
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

  perform public.fn_lock_production_cutting_machine_v1(v_request.machine_id);
  select * into v_machine from public.machines where id = v_request.machine_id;
  if v_machine.factory_id is null then raise exception 'У машины не указан завод'; end if;

  if p_entered_plasma_minutes > 0 and not exists (
    select 1
    from public.request_sheet_metal sheet
    where sheet.request_id = p_request_id
  ) then
    raise exception 'Время плазмы доступно только для заявок с листовым металлом';
  end if;

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
  if v_payload_count = 0 and v_plan_count = 0 and (v_manual_count > 0 or not exists (
      select id from public.request_components where request_id = p_request_id
      union all select id from public.request_paint where request_id = p_request_id
      union all select id from public.request_mesh where request_id = p_request_id
      union all select id from public.request_chain_cord where request_id = p_request_id
    )) then
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

  -- Supply handoff belongs to the planning stage. Require a concrete approved
  -- cutting map, but do not wait for production facts that can only exist after
  -- supply and physical cutting. If legacy data already contains facts, keep
  -- the strict reconciliation guard for that completed fact set.
  for v_plan_fact in
    select * from public.fn_get_long_stock_completion_plan_facts_v1(p_request_id)
  loop
    if v_plan_fact.version_id is null
       or v_plan_fact.plan_status not in ('open', 'closed')
       or v_plan_fact.planned_bar_count <= 0 then
      raise exception 'Для позиции «%» нет утверждённой карты раскроя с запланированными хлыстами',
        v_plan_fact.item_name;
    end if;

    if v_plan_fact.fact_bar_count > 0 then
      if v_plan_fact.plan_status <> 'closed'
         or v_plan_fact.fact_bar_count <> v_plan_fact.planned_bar_count then
        raise exception 'Не все хлысты позиции «%» закрыты начатыми производственными фактами',
          v_plan_fact.item_name;
      end if;
      if v_plan_fact.actual_loss_bar_count <> v_plan_fact.fact_bar_count then
        raise exception 'Для позиции «%» не записаны потери всех порезанных хлыстов',
          v_plan_fact.item_name;
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
  from public.fn_get_long_stock_completion_plan_facts_v1(p_request_id) fact
  where fact.fact_bar_count > 0
    and fact.plan_status = 'closed'
    and fact.fact_bar_count = fact.planned_bar_count
    and fact.actual_loss_bar_count = fact.fact_bar_count
    and abs(fact.reconciliation_delta_kg) <= 0.001;

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
    v_scrap_weight := 0;
    v_waste_basis := v_weight;
    v_metal_scrap := round(v_weight * v_pct / 100, 3);
    v_useful := v_weight - v_metal_scrap;
    v_sheet_result := null;
    if v_item->>'sourceTable' = 'request_sheet_metal' then
      select * into v_sheet from public.request_sheet_metal
      where id=(v_item->>'sourceId')::uuid and request_id=p_request_id for update;
      if not found then raise exception 'Исходная листовая позиция не найдена'; end if;
      if jsonb_array_length(coalesce(v_item->'futureScraps','[]'::jsonb)) > 0
         and (v_sheet.material_id is null or v_sheet.steel_type_id is null
              or v_sheet.thickness_mm is null or v_sheet.thickness_mm <= 0) then
        raise exception 'У исходного листа не указаны карточка материала, тип стали или толщина';
      end if;
      v_sheet_result := public.fn_calculate_sheet_scrap_plan_v1(
        v_sheet.sheet_size,v_sheet.quantity_sheets,v_weight,
        coalesce(v_item->'futureScraps','[]'::jsonb),v_pct
      );
      v_scrap_weight := (v_sheet_result->>'scrapWeightKg')::numeric;
      v_waste_basis := (v_sheet_result->>'wasteBasisKg')::numeric;
      v_metal_scrap := (v_sheet_result->>'metalScrapKg')::numeric;
      v_useful := (v_sheet_result->>'usefulKg')::numeric;
    elsif jsonb_array_length(coalesce(v_item->'futureScraps','[]'::jsonb)) > 0 then
      raise exception 'Деловой остаток в этом мастере доступен только для листового металла';
    end if;

    insert into public.technologist_request_waste_items(
      completion_id, request_id, source_table, source_id, item_name,
      material_id, material_variant_id, material_name, material_grade,
      weight_snapshot_kg, waste_basis_kg, business_scrap_weight_kg,
      waste_percent, scrap_weight_kg, useful_weight_kg
    ) values (
      v_completion, p_request_id,
      v_item->>'sourceTable', (v_item->>'sourceId')::uuid,
      coalesce(nullif(v_item->>'itemName', ''), 'Позиция'),
      case when v_item->>'sourceTable'='request_sheet_metal' then v_sheet.material_id else nullif(v_item->>'materialId', '')::uuid end,
      case when v_item->>'sourceTable'='request_sheet_metal' then v_sheet.material_variant_id else nullif(v_item->>'materialVariantId', '')::uuid end,
      case when v_item->>'sourceTable'='request_sheet_metal' then v_sheet.material_name else coalesce(nullif(v_item->>'materialName', ''), 'Металл') end,
      case when v_item->>'sourceTable'='request_sheet_metal' then v_sheet.material_grade else nullif(v_item->>'materialGrade', '') end,
      v_weight, v_waste_basis, v_scrap_weight,
      v_pct, v_metal_scrap, v_useful
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
      v_lot, 'planned', v_metal_scrap,
      0, 0, 0, p_actor
    );

    if v_sheet_result is not null then
      v_scrap_ordinal := 0;
      for v_sheet_scrap in select value from jsonb_array_elements(v_sheet_result->'rows') loop
        v_scrap_ordinal := v_scrap_ordinal + 1;
        select variant.id into v_variant from public.material_variants variant
        where variant.material_id=v_sheet.material_id and variant.category='sheet_metal'
          and variant.steel_type_id=v_sheet.steel_type_id
          and variant.thickness_mm=v_sheet.thickness_mm
          and variant.material_grade is not distinct from v_sheet.material_grade
          and public.fn_same_rectangular_dimensions_v1(
            variant.sheet_size,(v_sheet_scrap->>'lengthMm') || 'x' || (v_sheet_scrap->>'widthMm'))
        order by variant.id limit 1;
        if v_variant is null then
          insert into public.material_variants(
            material_id,category,steel_type_id,material_grade,thickness_mm,sheet_size,default_unit
          ) values (
            v_sheet.material_id,'sheet_metal',v_sheet.steel_type_id,v_sheet.material_grade,
            v_sheet.thickness_mm,(v_sheet_scrap->>'lengthMm') || 'x' || (v_sheet_scrap->>'widthMm'),'шт'
          ) returning id into v_variant;
        end if;
        insert into public.inventory(
          factory_id,material_id,material_variant_id,total_quantity,reserved_quantity,
          unit,is_business_scrap,business_scrap_state,source_machine_id,last_updated_by
        ) values (
          v_machine.factory_id,v_sheet.material_id,v_variant,
          (v_sheet_scrap->>'quantity')::integer,0,'шт',true,'future',
          v_request.machine_id,p_actor
        ) returning id into v_inventory;
        insert into public.technologist_sheet_scrap_plans(
          completion_id,request_id,source_item_id,line_number,inventory_id,length_mm,width_mm,quantity,weight_kg
        ) values (
          v_completion,p_request_id,v_sheet.id,v_scrap_ordinal,v_inventory,
          (v_sheet_scrap->>'lengthMm')::numeric,(v_sheet_scrap->>'widthMm')::numeric,
          (v_sheet_scrap->>'quantity')::integer,(v_sheet_scrap->>'weightKg')::numeric
        );
      end loop;
    end if;
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
        name, drawing_number, unit_weight_kg,
        width_mm, height_mm, thickness_mm, created_by, updated_by
      ) values (
        v_item->>'name', v_item->>'drawingNumber',
        (v_item->>'unitWeightKg')::numeric,
        nullif(v_item->>'widthMm','')::numeric,
        nullif(v_item->>'heightMm','')::numeric,
        nullif(v_item->>'thicknessMm','')::numeric,
        p_actor, p_actor
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

  select id into v_existing_event from public.production_fact_cutting_events
  where machine_id=v_request.machine_id and status in ('applied','kept')
  order by created_at,id limit 1;
  if v_existing_event is not null then
    perform public.fn_promote_sheet_scrap_for_cutting_event_v1(v_existing_event,null);
  end if;
  return v_completion;
end;
$$;

revoke all on function public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb) to service_role;

create or replace function public.fn_correct_technologist_completion(
  p_request_id uuid,p_entered_plasma_minutes integer,p_waste_items jsonb,p_reason text,p_actor uuid
) returns void language plpgsql security definer set search_path=public as $$
declare
  v_completion public.technologist_request_completions%rowtype;
  v_item jsonb;
  v_waste public.technologist_request_waste_items%rowtype;
  v_lot public.metal_scrap_lots%rowtype;
  v_new_expected numeric;
  v_old jsonb;
begin
  if p_actor is null or p_actor<>auth.uid() or btrim(coalesce(p_reason,''))='' then
    raise exception 'Для корректировки обязательна причина';
  end if;
  if exists (select 1 from public.technologist_request_approval_versions
    where request_id=p_request_id and state='approved') then
    raise exception 'Одобренную заявку нельзя редактировать';
  end if;
  select * into v_completion from public.technologist_request_completions
  where request_id=p_request_id for update;
  if not found or v_completion.created_by<>p_actor or p_entered_plasma_minutes<0 then
    raise exception 'Корректировка недоступна';
  end if;
  v_old:=jsonb_build_object('enteredPlasmaMinutes',v_completion.entered_plasma_minutes,
    'actualPlasmaMinutes',v_completion.actual_plasma_minutes,
    'wasteItems',(select jsonb_agg(to_jsonb(w)) from public.technologist_request_waste_items w where w.request_id=p_request_id));
  for v_item in select value from jsonb_array_elements(p_waste_items) loop
    select * into v_waste from public.technologist_request_waste_items
    where id=(v_item->>'wasteItemId')::uuid and request_id=p_request_id for update;
    if not found or (v_item->>'wastePercent')::numeric not between 0 and 100
       or (v_item->>'wastePercent')::numeric<>round((v_item->>'wastePercent')::numeric,1) then
      raise exception 'Некорректная отходность';
    end if;
    v_new_expected:=round(v_waste.waste_basis_kg*(v_item->>'wastePercent')::numeric/100,3);
    select * into v_lot from public.metal_scrap_lots where waste_item_id=v_waste.id for update;
    if v_new_expected<v_lot.sold_weight_kg then raise exception 'Металлолом нельзя уменьшить ниже уже сданного веса'; end if;
    update public.technologist_request_waste_items
    set waste_percent=(v_item->>'wastePercent')::numeric,scrap_weight_kg=v_new_expected,
      useful_weight_kg=waste_basis_kg-v_new_expected where id=v_waste.id;
    update public.metal_scrap_lots set expected_weight_kg=v_new_expected,
      available_weight_kg=case when status='available' then v_new_expected-sold_weight_kg else available_weight_kg end,
      blocked_weight_kg=case when status='review_required' then v_new_expected-sold_weight_kg else blocked_weight_kg end,
      updated_at=now() where id=v_lot.id returning * into v_lot;
    insert into public.metal_scrap_movements(lot_id,movement_type,weight_delta_kg,
      available_after_kg,blocked_after_kg,sold_after_kg,reason,performed_by)
    values(v_lot.id,'correction',v_new_expected-v_waste.scrap_weight_kg,
      v_lot.available_weight_kg,v_lot.blocked_weight_kg,v_lot.sold_weight_kg,p_reason,p_actor);
  end loop;
  update public.technologist_request_completions
  set entered_plasma_minutes=p_entered_plasma_minutes,
    added_plasma_minutes=ceil(p_entered_plasma_minutes*0.25),
    actual_plasma_minutes=p_entered_plasma_minutes+ceil(p_entered_plasma_minutes*0.25),updated_at=now()
  where id=v_completion.id;
  insert into public.technologist_completion_changes(request_id,change_type,old_value,new_value,reason,changed_by)
  values(p_request_id,'waste',v_old,jsonb_build_object(
    'enteredPlasmaMinutes',p_entered_plasma_minutes,'wasteItems',p_waste_items),p_reason,p_actor);
end;
$$;
revoke all on function public.fn_correct_technologist_completion(uuid,integer,jsonb,text,uuid) from public,anon;
grant execute on function public.fn_correct_technologist_completion(uuid,integer,jsonb,text,uuid) to authenticated;

-- The existing rollback preview checks reserved and deleted future inventory.
-- Also block a sheet remnant that was partially consumed without a live reserve.
alter function public.fn_get_production_cutting_rollback_preview(uuid)
  rename to fn_cutting_rollback_preview_pre_sheet_v1;
create function public.fn_get_production_cutting_rollback_preview(p_machine_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_preview jsonb;
  v_changed integer;
  v_blockers jsonb;
begin
  v_preview := public.fn_cutting_rollback_preview_pre_sheet_v1(p_machine_id);
  select count(*) into v_changed
  from public.technologist_sheet_scrap_plans plan
  join public.production_fact_cutting_events event on event.id=plan.promoted_event_id
  join public.inventory stock on stock.id=plan.inventory_id
  where event.machine_id=p_machine_id and event.status='applied'
    and (stock.total_quantity<>plan.quantity or stock.deleted_at is not null
      or exists (select 1 from public.inventory_transactions movement
        where movement.inventory_id=stock.id and movement.created_at>=plan.created_at));
  if v_changed=0 then return v_preview; end if;
  v_blockers := coalesce(v_preview->'blockers','[]'::jsonb)
    || jsonb_build_array('Будущий листовой остаток уже использован или перемещён');
  return jsonb_set(jsonb_set(v_preview,'{blockers}',v_blockers),'{canRollback}','false'::jsonb);
end;
$$;
revoke all on function public.fn_get_production_cutting_rollback_preview(uuid) from public,anon,authenticated;
grant execute on function public.fn_get_production_cutting_rollback_preview(uuid) to service_role;

notify pgrst, 'reload schema';
