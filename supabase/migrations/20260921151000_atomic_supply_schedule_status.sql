-- Category contract applies to direct RPC and all schedule writers.
create or replace function public.fn_supplier_supports_request_table(p_supplier uuid,p_table text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.suppliers s join public.supplier_material_categories c on c.supplier_id=s.id
 where s.id=p_supplier and s.is_active and not coalesce(s.can_transport,false) and not coalesce(s.can_outsource,false)
 and (c.category::text=replace(p_table,'request_','') or (c.category::text='round_tube' and p_table in ('request_circle','request_pipe'))));
$$;
revoke all on function public.fn_supplier_supports_request_table(uuid,text) from public,anon;
grant execute on function public.fn_supplier_supports_request_table(uuid,text) to authenticated,service_role;
create or replace function public.fn_guard_schedule_supplier_category() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='planned' and new.supplier_id is not null and (tg_op='INSERT' or new.supplier_id is distinct from old.supplier_id
    or new.quantity is distinct from old.quantity or new.delivery_date is distinct from old.delivery_date)
 and not public.fn_supplier_supports_request_table(new.supplier_id,new.request_item_table) then
 raise exception 'Поставщик отключён или не поставляет выбранную категорию материала' using errcode='23514';
 end if;
 return new;
end $$;
create trigger schedule_supplier_category before insert or update on public.supply_order_delivery_schedules
 for each row execute function public.fn_guard_schedule_supplier_category();

-- Source status and schedules commit or roll back together. Preserves received/cancelled rows.
create or replace function public.fn_sync_schedule_source_status() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_table text; v_id uuid; v_covered boolean; v_supplier uuid; v_suppliers integer;
begin
 v_table := case when tg_op='DELETE' then old.request_item_table else new.request_item_table end;
 v_id := case when tg_op='DELETE' then old.request_item_id else new.request_item_id end;
 if public.supply_position_category(v_table) is null and v_table <> 'request_round_tube' then raise exception 'Недопустимая категория'; end if;
 execute format('select 1 from public.%I where id=$1 for update',v_table) using v_id;
 select count(*)>0,count(distinct supplier_id),(array_agg(distinct supplier_id))[1]
 into v_covered,v_suppliers,v_supplier from public.supply_order_delivery_schedules
 where request_item_table=v_table and request_item_id=v_id and (status='delivered' or (status='planned' and supplier_id is not null)) and quantity>0;
 execute format('update public.%I set order_status=$2::public.order_item_status, ordered_at=case when $3 then coalesce(ordered_at,now()) else null end, supplier_id=case when $4=1 then $5 else supplier_id end where id=$1 and order_status not in (''delivered'',''cancelled'')',v_table)
 using v_id,case when v_covered then 'ordered' else 'pending' end,v_covered,v_suppliers,v_supplier;
 return null;
end $$;
create trigger sync_schedule_source_status after insert or update of status,quantity,supplier_id or delete on public.supply_order_delivery_schedules
 for each row execute function public.fn_sync_schedule_source_status();
revoke all on function public.fn_guard_schedule_supplier_category(),public.fn_sync_schedule_source_status() from public,anon,authenticated;

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
    ) r order by r.request_item_table,r.request_item_id
  loop
    if public.supply_position_category(v_ref.request_item_table) is null and v_ref.request_item_table <> 'request_round_tube' then raise exception 'Недопустимая категория'; end if;
    execute format('select 1 from public.technologist_requests where id=(select request_id from public.%I where id=$1) for update',v_ref.request_item_table) using v_ref.request_item_id;
  end loop;

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
$function$;

create or replace function public.fn_replace_supply_order_delivery_schedules_v2(p_delete_ids uuid[],p_rows jsonb,p_items jsonb,p_expected jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_ref record; v_current jsonb; v_request uuid;
begin
 if auth.uid() is null or not private.crm_has_permission('supply_orders','manage') then raise exception 'Недостаточно прав'; end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_rows,'[]')) x(supplier_id uuid) where x.supplier_id is null) then
    raise exception 'Выберите поставщика для каждой строки графика' using errcode='23514';
  end if;

 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_typeof(p_expected)<>'array' then raise exception 'Не передана версия графика'; end if;
 for v_ref in select * from jsonb_to_recordset(p_items) x("table" text,id uuid) order by "table",id loop
   if public.supply_position_category(v_ref."table") is null and v_ref."table" <> 'request_round_tube' then raise exception 'Недопустимая категория'; end if;
   execute format('select request_id from public.%I where id=$1',v_ref."table") into v_request using v_ref.id;
   if v_request is null then raise exception 'Позиция не найдена'; end if;
   perform 1 from public.technologist_requests where id=v_request for update;
 end loop;
 if exists(select 1 from jsonb_to_recordset(p_rows) x(request_item_table text,request_item_id uuid)
   where not exists(select 1 from jsonb_to_recordset(p_items) i("table" text,id uuid) where i."table"=x.request_item_table and i.id=x.request_item_id))
 or exists(select 1 from public.supply_order_delivery_schedules s where s.id=any(p_delete_ids)
   and not exists(select 1 from jsonb_to_recordset(p_items) i("table" text,id uuid) where i."table"=s.request_item_table and i.id=s.request_item_id)) then raise exception 'График относится к другой позиции'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'updated_at',s.updated_at,'status',s.status) order by s.id),'[]') into v_current
 from public.supply_order_delivery_schedules s where s.status <> 'cancelled'
 and exists(select 1 from jsonb_to_recordset(p_items) i("table" text,id uuid) where i."table"=s.request_item_table and i.id=s.request_item_id);
 if v_current is distinct from (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'updated_at',x.updated_at,'status',x.status) order by x.id),'[]')
 from jsonb_to_recordset(p_expected) x(id uuid,updated_at timestamptz,status text)) then
 raise exception 'График изменён другим пользователем. Обновите данные и повторите сохранение' using errcode='40001'; end if;
 perform public.fn_replace_supply_order_delivery_schedules_v1(p_delete_ids,p_rows);
end $$;
revoke all on function public.fn_replace_supply_order_delivery_schedules_v2(uuid[],jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.fn_replace_supply_order_delivery_schedules_v2(uuid[],jsonb,jsonb,jsonb) to authenticated;
