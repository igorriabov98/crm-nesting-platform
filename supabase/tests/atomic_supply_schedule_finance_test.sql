\set ON_ERROR_STOP on
begin;
do $$
declare
  actor uuid := gen_random_uuid();
  factory uuid; dept uuid := gen_random_uuid(); machine uuid := gen_random_uuid();
  req uuid := gen_random_uuid(); item uuid := gen_random_uuid();
  supplier uuid := gen_random_uuid(); material uuid := gen_random_uuid();
  item2 uuid := gen_random_uuid(); supplier2 uuid := gen_random_uuid();
  schedule uuid; v_source_key text; refs jsonb; payload jsonb; payment jsonb; expected jsonb;
begin
  select id into factory from public.factories order by id limit 1;
  insert into public.users(id,email,full_name,role,factory_id,is_active)
    values(actor,actor || '@schedule-finance.test','Schedule finance operator','engineer',factory,true);
  insert into public.departments(id,name,factory_id) values(dept,'Schedule finance test',factory);
  insert into public.department_members(user_id,department_id,is_department_head) values(actor,dept,false);
  insert into public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage)
    values(dept,'member','supply_orders',true,true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.machines(id,factory_id,name,created_by) values(machine,factory,'Schedule finance test',actor);
  insert into public.technologist_requests(id,machine_id,created_by,status)
    values(req,machine,actor,'submitted_to_supply');
  insert into public.materials(id,name,category,created_by)
    values(material,'Atomic finance component','components',actor);
  insert into public.request_components(id,request_id,component_name,quantity_needed,unit,material_id)
    values(item,req,'Atomic finance component',10,'шт',material);
  insert into public.suppliers(id,name,is_active) values(supplier,'Atomic finance supplier',true);
  insert into public.supplier_material_categories(supplier_id,category) values(supplier,'components');
  refs := jsonb_build_array(jsonb_build_object('table','request_components','id',item));
  payload := jsonb_build_array(jsonb_build_object('request_item_table','request_components',
    'request_item_id',item,'delivery_date',current_date,'quantity',5,'unit','шт','supplier_id',supplier));
  v_source_key := supplier::text || ':' || current_date::text || ':request_components:' || item::text;
  payment := jsonb_build_array(jsonb_build_object('source_key',v_source_key,'supplier_id',supplier,
    'planned_date',current_date,'amount',100,'amount_uah',100,'exchange_rate',null,
    'currency','UAH','item_keys',jsonb_build_array('request_components:' || item::text)));

  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1('{}',payload,refs,'[]',payment);
    raise exception 'finance permission bypassed';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.supply_order_delivery_schedules where request_item_id=item) then
    raise exception 'unauthorized attempt changed schedule';
  end if;
  insert into public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage)
    values(dept,'member','supply_finance',true,true);

  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1(
      '{}',payload,refs || refs,'[]',payment);
    raise exception 'duplicate source accepted';
  exception when others then
    if sqlerrm <> 'Позиции графика повторяются или не указаны' then raise; end if;
  end;

  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1('{}',payload,refs,'[]',
      jsonb_set(payment,'{0,amount_uah}','1'::jsonb));
    raise exception 'invalid currency conversion accepted';
  exception when others then
    if sqlerrm <> 'Некорректный пересчёт валюты платежа' then raise; end if;
  end;
  if exists(select 1 from public.supply_order_delivery_schedules where request_item_id=item)
    or exists(select 1 from public.finance_expenses where source_key=v_source_key) then
    raise exception 'failed payment left half of transaction';
  end if;

  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1(
      '{}',payload,refs,'[]',payment || jsonb_set(payment,'{0,amount_uah}','1'::jsonb));
    raise exception 'second invalid payment accepted';
  exception when others then
    if sqlerrm <> 'Некорректный пересчёт валюты платежа' then raise; end if;
  end;
  if exists(select 1 from public.supply_order_delivery_schedules where request_item_id=item)
    or exists(select 1 from public.finance_expenses where source_key=v_source_key) then
    raise exception 'second invalid payment left part of the first payment or schedule';
  end if;

  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1(
      '{}',payload,refs,'[]',payment || payment);
    raise exception 'duplicate payment accepted';
  exception when others then
    if sqlerrm <> 'Платёж повторяется в одном сохранении' then raise; end if;
  end;
  if exists(select 1 from public.supply_order_delivery_schedules where request_item_id=item)
    or exists(select 1 from public.finance_expenses where source_key=v_source_key) then
    raise exception 'duplicate payment left half of transaction';
  end if;

  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1('{}',payload,refs,'[]',payment);
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item) <> 1
    or (select count(*) from public.finance_expenses e where e.source_key=v_source_key) <> 1
    or (select count(*) from public.finance_expense_supply_items link
      join public.finance_expenses e on e.id=link.expense_id where e.source_key=v_source_key
      and link.request_item_table='request_components' and link.request_item_id=item) <> 1 then
    raise exception 'schedule, payment and position link diverged';
  end if;
  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1('{}',payload,refs,'[]',payment);
    raise exception 'stale retry accepted';
  exception when serialization_failure then null; end;

  select id into schedule from public.supply_order_delivery_schedules where request_item_id=item;
  select jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at))
    into expected from public.supply_order_delivery_schedules where request_item_id=item;
  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1(array[schedule],payload,refs,expected,
      jsonb_set(jsonb_set(payment,'{0,amount}','101'::jsonb),'{0,amount_uah}','101'::jsonb));
    raise exception 'conflicting payment accepted';
  exception when others then
    if sqlerrm <> 'У даты есть платёж. Измените график вместе с платежом' then raise; end if;
  end;
  if (select id from public.supply_order_delivery_schedules where request_item_id=item) <> schedule
    or (select count(*) from public.finance_expenses e where e.source_key=v_source_key) <> 1 then
    raise exception 'payment conflict changed saved schedule';
  end if;

  insert into public.request_components(id,request_id,component_name,quantity_needed,unit,material_id)
    values(item2,req,'Atomic finance component',10,'шт',material);
  insert into public.suppliers(id,name,is_active) values(supplier2,'Atomic finance supplier 2',true);
  insert into public.supplier_material_categories(supplier_id,category) values(supplier2,'components');
  refs := jsonb_build_array(jsonb_build_object('table','request_components','id',item2));
  payload := jsonb_build_array(
    jsonb_build_object('request_item_table','request_components','request_item_id',item2,
      'delivery_date',current_date,'quantity',5,'unit','шт','supplier_id',supplier),
    jsonb_build_object('request_item_table','request_components','request_item_id',item2,
      'delivery_date',current_date + 1,'quantity',5,'unit','шт','supplier_id',supplier2));
  payment := jsonb_build_array(
    jsonb_build_object('source_key',supplier::text || ':' || current_date::text || ':request_components:' || item2::text,
      'supplier_id',supplier,'planned_date',current_date,'amount',100,'amount_uah',100,
      'currency','UAH','item_keys',jsonb_build_array('request_components:' || item2::text)),
    jsonb_build_object('source_key',supplier2::text || ':' || (current_date + 1)::text || ':request_components:' || item2::text,
      'supplier_id',supplier2,'planned_date',current_date + 1,'amount',200,'amount_uah',200,
      'currency','UAH','item_keys',jsonb_build_array('request_components:' || item2::text)));
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v1('{}',payload,refs,'[]',payment);
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item2) <> 2
    or (select count(*) from public.finance_expenses e
      join public.finance_expense_supply_items link on link.expense_id=e.id
      where link.request_item_table='request_components' and link.request_item_id=item2) <> 2 then
    raise exception 'multiple suppliers did not retain their own schedule and payment';
  end if;
end $$;
rollback;
