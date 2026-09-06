-- Keep supplier schedules aligned with the new-stock bars of the approved
-- cutting map. Warehouse remnants belong to inventory reservations and must
-- never become supplier purchase or transport rows.

create or replace function public.fn_guard_long_stock_supplier_schedule_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pipe_type text;
  v_plan_id uuid;
  v_cutting_status text;
  v_version_id uuid;
  v_candidate_id uuid;
  v_expected_piece_count numeric := 0;
  v_scheduled_piece_count numeric := 0;
begin
  if new.request_item_table not in ('request_circle', 'request_pipe', 'request_knives')
    or new.status <> 'planned'
    or new.receipt_parent_schedule_id is not null then
    return new;
  end if;

  if new.request_item_table = 'request_pipe' then
    select pipe_type into v_pipe_type
    from public.request_pipe
    where id = new.request_item_id;
    if v_pipe_type = 'wire' then
      return new;
    end if;
  end if;

  if new.planned_piece_length_mm is null
    or new.planned_piece_count is null
    or new.planned_piece_count <= 0
    or trunc(new.planned_piece_count) <> new.planned_piece_count then
    raise exception 'График длинномера требует длину хлыста и целое количество штук';
  end if;

  select item.plan_id, item.cutting_status
  into v_plan_id, v_cutting_status
  from public.long_stock_cutting_plan_items item
  where item.request_item_table = new.request_item_table
    and item.request_item_id = new.request_item_id
    and item.link_state = 'active'
  limit 1
  for update;

  if v_plan_id is null or v_cutting_status not in ('plan_approved', 'accepted') then
    raise exception 'Для закупки длинномера нужна актуальная утверждённая карта раскроя';
  end if;

  select version.id
  into v_version_id
  from public.long_stock_cutting_plan_versions version
  where version.plan_id = v_plan_id
    and version.status = 'approved'
  order by version.version_number desc
  limit 1;

  select candidate.id
  into v_candidate_id
  from public.long_stock_cutting_candidates candidate
  join public.long_stock_cutting_plan_versions version
    on version.id = candidate.version_id
  where candidate.version_id = v_version_id
    and candidate.candidate_number = version.selected_candidate_number
  limit 1;

  if v_candidate_id is null then
    raise exception 'В утверждённой карте раскроя не найден выбранный вариант';
  end if;

  select count(*)::numeric
  into v_expected_piece_count
  from public.long_stock_cutting_candidate_bars bar
  where bar.candidate_id = v_candidate_id
    and bar.source_type = 'new_stock'
    and bar.stock_length_mm = new.planned_piece_length_mm;

  select coalesce(sum(schedule.planned_piece_count), 0)
  into v_scheduled_piece_count
  from public.supply_order_delivery_schedules schedule
  where schedule.request_item_table = new.request_item_table
    and schedule.request_item_id = new.request_item_id
    and schedule.receipt_parent_schedule_id is null
    and schedule.status in ('planned', 'delivered')
    and schedule.planned_piece_length_mm = new.planned_piece_length_mm
    and schedule.id <> new.id;

  if v_expected_piece_count = 0
    or v_scheduled_piece_count + new.planned_piece_count > v_expected_piece_count then
    raise exception 'Количество хлыстов превышает закупочную часть утверждённой карты раскроя';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_guard_long_stock_supplier_schedule_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_long_stock_supplier_schedule_v1
  on public.supply_order_delivery_schedules;
drop trigger if exists validate_long_stock_supplier_schedule_v1
  on public.supply_order_delivery_schedules;
create trigger validate_long_stock_supplier_schedule_v1
before insert or update of
  request_item_table,
  request_item_id,
  status,
  quantity,
  planned_piece_length_mm,
  planned_piece_count,
  receipt_parent_schedule_id
on public.supply_order_delivery_schedules
for each row execute function public.fn_guard_long_stock_supplier_schedule_v1();

create or replace function public.fn_replace_supply_order_delivery_schedules_v1(
  p_delete_ids uuid[],
  p_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_delete_count integer := 0;
  v_existing_count integer := 0;
begin
  if v_actor is null or not public.security_can_manage_supply() then
    raise exception 'Недостаточно прав для изменения графика поставки';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный состав графика поставки';
  end if;

  select count(*) into v_delete_count
  from (select distinct value from unnest(coalesce(p_delete_ids, '{}'::uuid[])) value) ids;
  if v_delete_count <> cardinality(coalesce(p_delete_ids, '{}'::uuid[])) then
    raise exception 'Строки графика для замены не должны повторяться';
  end if;

  perform 1
  from public.supply_order_delivery_schedules schedule
  where schedule.id = any(coalesce(p_delete_ids, '{}'::uuid[]))
  for update;

  select count(*) into v_existing_count
  from public.supply_order_delivery_schedules schedule
  where schedule.id = any(coalesce(p_delete_ids, '{}'::uuid[]))
    and schedule.status = 'planned';
  if v_existing_count <> v_delete_count then
    raise exception 'Заменять можно только существующие плановые строки графика';
  end if;

  delete from public.supply_order_delivery_schedules schedule
  where schedule.id = any(coalesce(p_delete_ids, '{}'::uuid[]));

  insert into public.supply_order_delivery_schedules (
    request_item_table,
    request_item_id,
    delivery_date,
    quantity,
    unit,
    supplier_id,
    planned_piece_length_mm,
    planned_piece_count,
    created_by,
    updated_by
  )
  select
    row.request_item_table,
    row.request_item_id,
    row.delivery_date,
    row.quantity,
    row.unit,
    row.supplier_id,
    row.planned_piece_length_mm,
    row.planned_piece_count,
    v_actor,
    v_actor
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row(
    request_item_table text,
    request_item_id uuid,
    delivery_date date,
    quantity numeric,
    unit text,
    supplier_id uuid,
    planned_piece_length_mm numeric,
    planned_piece_count numeric
  )
  where row.request_item_table in (
    'request_sheet_metal',
    'request_round_tube',
    'request_circle',
    'request_pipe',
    'request_knives',
    'request_components',
    'request_paint',
    'request_mesh',
    'request_chain_cord'
  );

  if (select count(*) from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)))
    <> (select count(*) from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as row(
      request_item_table text,
      request_item_id uuid,
      delivery_date date,
      quantity numeric,
      unit text,
      supplier_id uuid,
      planned_piece_length_mm numeric,
      planned_piece_count numeric
    ) where row.request_item_table in (
      'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
      'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord'
    )) then
    raise exception 'Некорректная таблица позиции графика поставки';
  end if;
end;
$$;

revoke all on function public.fn_replace_supply_order_delivery_schedules_v1(uuid[], jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_replace_supply_order_delivery_schedules_v1(uuid[], jsonb)
  to authenticated;

notify pgrst, 'reload schema';
