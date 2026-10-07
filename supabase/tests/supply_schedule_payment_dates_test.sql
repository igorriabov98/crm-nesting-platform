\set ON_ERROR_STOP on
begin;
do $$
declare
  actor uuid := gen_random_uuid();
  factory uuid; dept uuid := gen_random_uuid(); machine uuid := gen_random_uuid();
  req uuid := gen_random_uuid(); item uuid := gen_random_uuid();
  supplier uuid := gen_random_uuid(); material uuid := gen_random_uuid();
  item2 uuid := gen_random_uuid(); item3 uuid := gen_random_uuid(); req2 uuid := gen_random_uuid();
  old_schedule uuid; first_schedule uuid; old_expense uuid; second_expense uuid;
  refs jsonb; rows jsonb; payments jsonb; expected jsonb; ids uuid[];
  base_date date := current_date + 1;
  first_key text; second_key text;
begin
  select id into factory from public.factories order by id limit 1;
  insert into public.users(id,email,full_name,role,factory_id,is_active)
    values(actor,actor || '@payment-date.test','Payment date operator','engineer',factory,true);
  insert into public.departments(id,name,factory_id) values(dept,'Payment date test',factory);
  insert into public.department_members(user_id,department_id,is_department_head) values(actor,dept,false);
  insert into public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage)
    values(dept,'member','supply_orders',true,true),(dept,'member','supply_finance',true,true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  insert into public.machines(id,factory_id,name,created_by) values(machine,factory,'Payment date test',actor);
  insert into public.technologist_requests(id,machine_id,created_by,status)
    values(req,machine,actor,'submitted_to_supply');
  insert into public.materials(id,name,category,created_by)
    values(material,'Payment date component','components',actor);
  insert into public.request_components(id,request_id,component_name,quantity_needed,unit,material_id)
    values(item,req,'Payment date component',5,'шт',material);
  insert into public.suppliers(id,name,is_active) values(supplier,'Payment date supplier',true);
  insert into public.supplier_material_categories(supplier_id,category) values(supplier,'components');
  refs := jsonb_build_array(jsonb_build_object('table','request_components','id',item));
  rows := jsonb_build_array(jsonb_build_object('request_item_table','request_components',
    'request_item_id',item,'delivery_date',base_date,'quantity',5,'unit','шт','supplier_id',supplier));
  first_key := supplier::text || ':' || base_date::text || ':request_components:' || item::text
    || '#delivery:' || base_date::text;
  payments := jsonb_build_array(jsonb_build_object('source_key',first_key,'supplier_id',supplier,
    'planned_date',base_date,'amount',100,'amount_uah',100,'exchange_rate',null,
    'currency','UAH','item_keys',jsonb_build_array('request_components:' || item::text),
    'delivery_allocations',jsonb_build_array(jsonb_build_object('delivery_date',base_date,'amount',100))));
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2('{}',rows,refs,'[]',payments);
  select id into old_schedule from public.supply_order_delivery_schedules where request_item_id=item;
  select id into old_expense from public.finance_expenses where source_key=first_key;
  if old_schedule is null or old_expense is null
    or (select allocated_amount from public.finance_expense_supply_dates where expense_id=old_expense)<>100 then
    raise exception 'initial schedule and payment date were not linked';
  end if;
  if (public.fn_get_supply_schedule_payments_v1(array[old_schedule])->'payments'->0->>'id')::uuid<>old_expense then
    raise exception 'payment preview did not find the schedule payment';
  end if;
  select jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at))
    into expected from public.supply_order_delivery_schedules where request_item_id=item;
  rows := jsonb_build_array(
    jsonb_build_object('request_item_table','request_components','request_item_id',item,
      'delivery_date',base_date + 1,'quantity',2,'unit','шт','supplier_id',supplier),
    jsonb_build_object('request_item_table','request_components','request_item_id',item,
      'delivery_date',base_date + 2,'quantity',3,'unit','шт','supplier_id',supplier));
  first_key := supplier::text || ':' || (base_date+1)::text || ':request_components:' || item::text
    || '#delivery:' || (base_date+1)::text;
  second_key := supplier::text || ':' || (base_date+2)::text || ':request_components:' || item::text
    || '#delivery:' || (base_date+2)::text;
  payments := jsonb_build_array(
    jsonb_build_object('source_key',first_key,'supplier_id',supplier,'planned_date',base_date+1,
      'amount',40,'amount_uah',40,'exchange_rate',null,'currency','UAH',
      'item_keys',jsonb_build_array('request_components:' || item::text),
      'transfer_from_expense_id',old_expense,
      'delivery_allocations',jsonb_build_array(jsonb_build_object('delivery_date',base_date+1,'amount',40))),
    jsonb_build_object('source_key',second_key,'supplier_id',supplier,'planned_date',base_date+2,
      'amount',60,'amount_uah',60,'exchange_rate',null,'currency','UAH',
      'item_keys',jsonb_build_array('request_components:' || item::text),
      'transfer_from_expense_id',old_expense,
      'delivery_allocations',jsonb_build_array(jsonb_build_object('delivery_date',base_date+2,'amount',60))));
  update public.department_access_permissions set can_manage=false
    where department_id=dept and resource_key='supply_finance';
  if (public.fn_get_supply_schedule_payments_v1(array[old_schedule])->>'requires_finance_permission')::boolean is distinct from true then
    raise exception 'supply-only user could inspect an existing payment';
  end if;
  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
      array[old_schedule],rows,refs,expected,payments);
    raise exception 'finance permission bypassed during transfer';
  exception when insufficient_privilege then null; end;
  if (select id from public.supply_order_delivery_schedules where request_item_id=item)<>old_schedule then
    raise exception 'unauthorized transfer changed the schedule';
  end if;
  update public.department_access_permissions set can_manage=true
    where department_id=dept and resource_key='supply_finance';
  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
      array[old_schedule],rows,refs,expected,
      jsonb_set(payments,'{1,amount_uah}','1'::jsonb));
    raise exception 'invalid second payment was committed';
  exception when others then
    if sqlerrm <> 'Некорректный пересчёт валюты платежа' then raise; end if;
  end;
  if (select id from public.supply_order_delivery_schedules where request_item_id=item)<>old_schedule
    or (select amount from public.finance_expenses where id=old_expense)<>100
    or exists(select 1 from public.finance_expenses where source_key=second_key) then
    raise exception 'second payment failure left half of a transaction';
  end if;
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
    array[old_schedule],rows,refs,expected,payments);
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item)<>2
    or (select count(*) from public.finance_expenses where source_key in (first_key,second_key))<>2
    or (select sum(allocated_amount) from public.finance_expense_supply_dates d
      join public.finance_expenses e on e.id=d.expense_id
      where e.source_key in (first_key,second_key))<>100
    or (select count(*) from public.finance_expense_supply_items l
      join public.finance_expenses e on e.id=l.expense_id
      where e.source_key in (first_key,second_key)
        and l.request_item_table='request_components' and l.request_item_id=item)<>2 then
    raise exception 'split schedule or payment allocation diverged';
  end if;
  select id into second_expense from public.finance_expenses where source_key=second_key;
  select array_agg(id order by id),
    jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at) order by id)
    into ids,expected from public.supply_order_delivery_schedules where request_item_id=item;
  payments := jsonb_set(payments,'{1,transfer_from_expense_id}',to_jsonb(second_expense));
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(ids,rows,refs,expected,payments);
  if (select count(*) from public.finance_expenses where source_key in (first_key,second_key))<>2
    or (select count(*) from public.finance_expense_supply_dates d
      join public.finance_expenses e on e.id=d.expense_id
      where e.source_key in (first_key,second_key))<>2 then
    raise exception 'repeated schedule save duplicated payments';
  end if;
  select id into first_schedule from public.supply_order_delivery_schedules
    where request_item_id=item and delivery_date=base_date+1;
  select jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at))
    into expected from public.supply_order_delivery_schedules where request_item_id=item;
  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
      array[first_schedule],'[]',refs,expected,'[]');
    raise exception 'date with active payment was cleared';
  exception when others then
    if sqlerrm <> 'Суммы перенесённых платежей должны совпадать с прежним платежом в той же валюте' then raise; end if;
  end;
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item)<>2 then
    raise exception 'blocked deletion changed the graph';
  end if;
  begin
    delete from public.supply_order_delivery_schedules where id=first_schedule;
    raise exception 'direct deletion bypassed payment guard';
  exception when others then
    if sqlerrm <> 'У даты есть платёж. Измените график вместе с платежом' then raise; end if;
  end;
  perform set_config('app.supply_schedule_finance_tx','on',true);
  begin
    delete from public.supply_order_delivery_schedules where id=first_schedule;
    raise exception 'client-controlled session flag bypassed payment guard';
  exception when others then
    if sqlerrm <> 'У даты есть платёж. Измените график вместе с платежом' then raise; end if;
  end;
  perform set_config('app.supply_schedule_finance_tx','',true);
  begin
    update public.supply_order_delivery_schedules set delivery_date=base_date+7 where id=first_schedule;
    raise exception 'direct rescheduling bypassed payment guard';
  exception when others then
    if sqlerrm <> 'У даты есть платёж. Измените график вместе с платежом' then raise; end if;
  end;
  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
      array[first_schedule],rows,refs,'[]',jsonb_build_array(payments->0));
    raise exception 'stale graph version was accepted';
  exception when serialization_failure then null; end;
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item)<>2 then
    raise exception 'stale retry changed schedules';
  end if;
  update public.finance_expenses set status='paid',paid_amount=40,paid_amount_uah=40
    where id=old_expense;
  begin
    perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
      array[first_schedule],rows,refs,expected,payments);
    raise exception 'paid expense was transferred';
  exception when others then
    if sqlerrm <> 'Оплаченный или частично оплаченный платёж нельзя перенести автоматически' then raise; end if;
  end;
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item)<>2 then
    raise exception 'paid payment failure changed schedules';
  end if;
  insert into public.finance_expenses(
    title,amount,amount_uah,paid_amount,paid_amount_uah,category,counterparty,
    currency,is_supply_plan,responsible_user_id,planned_date,original_planned_date,
    status,source_type,source_key,created_by,updated_by
  ) values (
    'Legacy ambiguous payment',50,50,0,0,'Прочие расходы','Payment date supplier',
    'UAH',true,actor,base_date+3,base_date+3,'planned','supply_order',
    supplier::text || ':' || (base_date+3)::text || ':request_components:' || item::text,actor,actor
  );
  begin
    perform public.fn_get_supply_schedule_payments_v1(array[first_schedule]);
    raise exception 'ambiguous legacy payment was assigned to a date';
  exception when others then
    if sqlerrm <> 'Источник платежа требует уточнения в финансах перед изменением графика' then raise; end if;
  end;
  insert into public.request_components(id,request_id,component_name,quantity_needed,unit,material_id)
    values(item2,req,'Unpaid schedule component',5,'шт',material);
  refs := jsonb_build_array(jsonb_build_object('table','request_components','id',item2));
  rows := jsonb_build_array(jsonb_build_object('request_item_table','request_components',
    'request_item_id',item2,'delivery_date',base_date+4,'quantity',5,'unit','шт','supplier_id',supplier));
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2('{}',rows,refs,'[]','[]');
  select id into first_schedule from public.supply_order_delivery_schedules where request_item_id=item2;
  select jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at))
    into expected from public.supply_order_delivery_schedules where request_item_id=item2;
  rows := jsonb_build_array(
    jsonb_build_object('request_item_table','request_components','request_item_id',item2,
      'delivery_date',base_date+4,'quantity',2,'unit','шт','supplier_id',supplier),
    jsonb_build_object('request_item_table','request_components','request_item_id',item2,
      'delivery_date',base_date+5,'quantity',3,'unit','шт','supplier_id',supplier));
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
    array[first_schedule],rows,refs,expected,'[]');
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item2)<>2
    or (select sum(quantity) from public.supply_order_delivery_schedules where request_item_id=item2)<>5 then
    raise exception 'unpaid schedule did not split 5 into 2 and 3';
  end if;
  select id into first_schedule from public.supply_order_delivery_schedules
    where request_item_id=item2 and delivery_date=base_date+4;
  select jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at))
    into expected from public.supply_order_delivery_schedules where request_item_id=item2;
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2(
    array[first_schedule],'[]',refs,expected,'[]');
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item2)<>1
    or (select sum(quantity) from public.supply_order_delivery_schedules where request_item_id=item2)<>3 then
    raise exception 'deleting one date did not retain the other 3 units';
  end if;
  insert into public.technologist_requests(id,machine_id,needed_by,created_by,status)
    values(req2,machine,base_date+5,actor,'submitted_to_supply');
  insert into public.request_components(id,request_id,component_name,quantity_needed,unit,material_id)
    values(item3,req2,'Unpaid schedule component',5,'шт',material);
  refs := jsonb_build_array(
    jsonb_build_object('table','request_components','id',item2),
    jsonb_build_object('table','request_components','id',item3));
  select jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at))
    into expected from public.supply_order_delivery_schedules where request_item_id in (item2,item3);
  rows := jsonb_build_array(jsonb_build_object('request_item_table','request_components',
    'request_item_id',item3,'delivery_date',base_date+6,'quantity',1,'unit','шт','supplier_id',supplier));
  perform public.fn_replace_supply_order_delivery_schedules_with_finance_v2('{}',rows,refs,expected,'[]');
  if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item3)<>1 then
    raise exception 'same material from different Mat.plan dates could not share a schedule operation';
  end if;
end $$;
rollback;
