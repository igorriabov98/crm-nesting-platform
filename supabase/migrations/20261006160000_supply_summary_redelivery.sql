-- Read categories under exactly the same view permissions as their supplier.
-- INSERT/UPDATE/DELETE policies remain unchanged.
drop policy if exists "Supplier categories read supply roles" on public.supplier_material_categories;
create policy "Supplier categories read supply roles" on public.supplier_material_categories
for select to authenticated using (
  private.crm_has_permission('suppliers', 'view')
  or private.crm_has_permission('supply_orders', 'view')
  or private.crm_has_permission('inventory', 'view')
);

-- This is procurement provenance, independent of physical receipt allocation.
alter table public.supply_order_delivery_schedules
  add column redelivery_of_schedule_id uuid references public.supply_order_delivery_schedules(id) on delete restrict,
  add constraint supply_schedule_redelivery_not_self check (redelivery_of_schedule_id is distinct from id),
  add constraint supply_schedule_redelivery_not_allocation check (redelivery_of_schedule_id is null or receipt_parent_schedule_id is null);
create index supply_schedule_redelivery_origin_idx
  on public.supply_order_delivery_schedules(redelivery_of_schedule_id)
  where redelivery_of_schedule_id is not null;
comment on column public.supply_order_delivery_schedules.redelivery_of_schedule_id
  is 'Confirmed short physical receipt that this procurement schedule replenishes; never an allocation parent.';

create or replace function public.fn_guard_supply_redelivery_origin()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_source public.supply_order_delivery_schedules%rowtype;
  v_item jsonb; v_source_item jsonb; v_factory uuid; v_source_factory uuid;
  v_committed numeric; v_remaining numeric; v_covered numeric; v_required numeric;
begin
  if tg_op='UPDATE' and exists (
    select 1 from public.supply_order_delivery_schedules child
    where child.redelivery_of_schedule_id=old.id and child.status<>'cancelled'
  ) and (new.status is distinct from old.status or new.quantity is distinct from old.quantity
    or new.received_quantity is distinct from old.received_quantity
    or new.request_item_table is distinct from old.request_item_table
    or new.request_item_id is distinct from old.request_item_id) then
    if new.status<>'delivered' or greatest(new.quantity-coalesce(new.received_quantity,new.quantity),0)
      < (select coalesce(sum(child.quantity),0) from public.supply_order_delivery_schedules child
         where child.redelivery_of_schedule_id=old.id and child.status<>'cancelled')-0.000001 then
      raise exception 'Нельзя изменить исходную поставку: на её остаток уже назначен довоз' using errcode='23514';
    end if;
  end if;
  if tg_op='UPDATE' and old.status='delivered' and new.redelivery_of_schedule_id is distinct from old.redelivery_of_schedule_id then
    raise exception 'Нельзя переписывать источник принятой поставки' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.redelivery_of_schedule_id is not null and new.redelivery_of_schedule_id is null then
    raise exception 'Нельзя удалять связь довоза с исходной поставкой' using errcode='23514';
  end if;
  if new.redelivery_of_schedule_id is null then return new; end if;
  if tg_op='UPDATE' and new.status is distinct from 'planned' and new.redelivery_of_schedule_id is not distinct from old.redelivery_of_schedule_id then
    return new; -- Existing receiving/cancellation authority is unchanged.
  end if;
  if auth.uid() is null or not private.crm_has_permission('supply_orders','manage') then
    raise exception 'Недостаточно прав для назначения довоза' using errcode='42501';
  end if;
  select * into v_source from public.supply_order_delivery_schedules
    where id=new.redelivery_of_schedule_id for update;
  if not found or v_source.status<>'delivered' or v_source.receipt_parent_schedule_id is not null
    or new.receipt_parent_schedule_id is not null or new.status<>'planned' then
    raise exception 'Источником довоза может быть только подтверждённая складом поставка' using errcode='23514';
  end if;
  if new.request_item_table is distinct from v_source.request_item_table
    or new.unit is distinct from v_source.unit
    or new.planned_piece_length_mm is distinct from v_source.planned_piece_length_mm then
    raise exception 'Довоз относится к другому материалу, единице или длине хлыста' using errcode='23514';
  end if;
  if new.request_item_id <> v_source.request_item_id and not exists (
    select 1 from public.supply_order_delivery_schedules child
    where child.receipt_parent_schedule_id=v_source.id and child.request_item_table=new.request_item_table
      and child.request_item_id=new.request_item_id and child.status='delivered'
  ) then
    raise exception 'Исходная поставка не относится к этой потребности' using errcode='23514';
  end if;
  execute format('select to_jsonb(i) from public.%I i where id=$1 for update',new.request_item_table) into v_item using new.request_item_id;
  execute format('select to_jsonb(i) from public.%I i where id=$1',v_source.request_item_table) into v_source_item using v_source.request_item_id;
  if v_item is null or v_source_item is null or public.fn_receiving_material_identity_v1(new.request_item_table,v_item)
    is distinct from public.fn_receiving_material_identity_v1(v_source.request_item_table,v_source_item) then
    raise exception 'Материал или закупочные характеристики довоза не совпадают' using errcode='23514';
  end if;
  select coalesce(r.factory_id,m.factory_id) into v_factory from public.technologist_requests r
    left join public.machines m on m.id=r.machine_id where r.id=(v_item->>'request_id')::uuid;
  select coalesce(r.factory_id,m.factory_id) into v_source_factory from public.technologist_requests r
    left join public.machines m on m.id=r.machine_id where r.id=(v_source_item->>'request_id')::uuid;
  if v_factory is null or v_factory is distinct from v_source_factory then
    raise exception 'Нельзя назначить довоз на другой завод' using errcode='23514';
  end if;
  if coalesce(v_item->>'order_status','') not in ('pending','ordered') then
    raise exception 'Потребность уже закрыта или недоступна для довоза' using errcode='23514';
  end if;
  select coalesce(sum(s.quantity),0) into v_committed from public.supply_order_delivery_schedules s
    where s.redelivery_of_schedule_id=v_source.id and s.status<>'cancelled' and s.id is distinct from new.id;
  v_remaining := greatest(v_source.quantity-coalesce(v_source.received_quantity,v_source.quantity)-v_committed,0);
  if new.quantity > v_remaining+0.000001 then
    raise exception 'Количество довоза превышает незакрытый остаток исходной поставки. Обновите данные' using errcode='23514';
  end if;
  select coalesce(sum(case when s.status='planned' then s.quantity else coalesce(s.allocated_quantity,s.received_quantity,s.quantity) end),0)
    into v_covered from public.supply_order_delivery_schedules s
    where s.request_item_table=new.request_item_table and s.request_item_id=new.request_item_id and s.id is distinct from new.id and s.status in ('planned','delivered');
  v_required := public.fn_supply_item_required_quantity(new.request_item_table,v_item);
  -- Whole-bar procurement includes cutting losses; the immutable source plan's
  -- shortage caps its physical volume, while the item must still need material.
  if new.planned_piece_length_mm is null and new.quantity > greatest(v_required-v_covered,0)+0.000001 then
    raise exception 'Довоз превышает текущую потребность заявки' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.fn_guard_supply_redelivery_origin() from public,anon,authenticated;
create trigger supply_redelivery_origin_guard before insert or update on public.supply_order_delivery_schedules
  for each row execute function public.fn_guard_supply_redelivery_origin();

-- Keep the established snapshot-checked v2 entry point. v1 now carries the
-- provenance in the same transaction as schedule replacement and source status.
CREATE OR REPLACE FUNCTION public.fn_replace_supply_order_delivery_schedules_v1(p_delete_ids uuid[], p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_delete_count integer := 0;
  v_existing_count integer := 0;
  v_ref record;
begin
  if v_actor is null or not private.crm_has_permission('supply_orders', 'manage') then
    raise exception 'Недостаточно прав для изменения графика поставки';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Некорректный состав графика поставки';
  end if;

  -- Lock parent requests before their rows, in one stable order across mutations.
  for v_ref in
    select distinct r.request_item_table,r.request_item_id from (
      select x.request_item_table,x.request_item_id from jsonb_to_recordset(coalesce(p_rows,'[]')) x(request_item_table text,request_item_id uuid)
      union select d.request_item_table,d.request_item_id from public.supply_order_delivery_schedules d where d.id=any(coalesce(p_delete_ids,'{}'))
      union select s.request_item_table,s.request_item_id from public.supply_order_delivery_schedules s
        join jsonb_to_recordset(coalesce(p_rows,'[]')) x(redelivery_of_schedule_id uuid) on x.redelivery_of_schedule_id=s.id
    ) r order by r.request_item_table,r.request_item_id
  loop
    if public.supply_position_category(v_ref.request_item_table) is null and v_ref.request_item_table <> 'request_round_tube' then raise exception 'Недопустимая категория'; end if;
    execute format('select 1 from public.technologist_requests where id=(select request_id from public.%I where id=$1) for update',v_ref.request_item_table) using v_ref.request_item_id;
  end loop;

  perform 1 from public.supply_order_delivery_schedules s
  where s.id in (select x.redelivery_of_schedule_id from jsonb_to_recordset(coalesce(p_rows,'[]')) x(redelivery_of_schedule_id uuid))
  order by s.id for update;

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

  -- Statement-level check: BEFORE triggers must not depend on the order in
  -- which PostgreSQL visits multiple new rows for one confirmed shortage.
  for v_ref in
    select x.redelivery_of_schedule_id as source_id, sum(x.quantity) as incoming
    from jsonb_to_recordset(coalesce(p_rows,'[]'::jsonb)) x(redelivery_of_schedule_id uuid,quantity numeric)
    where x.redelivery_of_schedule_id is not null
    group by x.redelivery_of_schedule_id order by x.redelivery_of_schedule_id
  loop
    if not exists (
      select 1 from public.supply_order_delivery_schedules origin
      where origin.id=v_ref.source_id and origin.status='delivered'
        and origin.receipt_parent_schedule_id is null
        and coalesce((select sum(child.quantity) from public.supply_order_delivery_schedules child
          where child.redelivery_of_schedule_id=origin.id and child.status<>'cancelled'),0)
          +v_ref.incoming <= greatest(origin.quantity-coalesce(origin.received_quantity,origin.quantity),0)+0.000001
    ) then
      raise exception 'Количество довоза превышает незакрытый остаток исходной поставки' using errcode='23514';
    end if;
  end loop;

  insert into public.supply_order_delivery_schedules (
    request_item_table,
    request_item_id,
    delivery_date,
    quantity,
    unit,
    supplier_id,
    redelivery_of_schedule_id,
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
    row.redelivery_of_schedule_id,
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
      redelivery_of_schedule_id uuid,
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
    redelivery_of_schedule_id uuid,
      planned_piece_length_mm numeric,
      planned_piece_count numeric
    ) where row.request_item_table in (
      'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
      'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord'
    )) then
    raise exception 'Некорректная таблица позиции графика поставки';
  end if;
end;
$function$;


-- No historical receipt is rewritten. Legacy provenance is resolved by the
-- application only when unique, and persisted on the next explicit schedule save.
