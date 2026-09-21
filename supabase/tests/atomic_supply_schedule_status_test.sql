\set ON_ERROR_STOP on
begin;
do $$
declare
 actor uuid:=gen_random_uuid(); factory uuid; dept uuid:=gen_random_uuid(); machine uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); item uuid:=gen_random_uuid();
 supplier uuid:=gen_random_uuid(); wrong_supplier uuid:=gen_random_uuid(); material uuid:=gen_random_uuid(); schedule uuid; expected jsonb; payload jsonb; refs jsonb; got text;
begin
 select id into factory from public.factories order by id limit 1;
 insert into public.users(id,email,full_name,role,factory_id,is_active) values(actor,actor||'@schedule.test','Schedule operator','engineer',factory,true);
 insert into public.departments(id,name,factory_id) values(dept,'Schedule test',factory);
 insert into public.department_members(user_id,department_id,is_department_head) values(actor,dept,false);
 insert into public.department_access_permissions(department_id,subject_scope,resource_key,can_view,can_manage) values(dept,'member','supply_orders',true,true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 insert into public.machines(id,factory_id,name,created_by) values(machine,factory,'Atomic schedule test',actor);
 insert into public.technologist_requests(id,machine_id,created_by,status) values(req,machine,actor,'submitted_to_supply');
 insert into public.materials(id,name,category,created_by) values(material,'Component test','components',actor);
 insert into public.request_components(id,request_id,component_name,quantity_needed,unit,material_id) values(item,req,'Component',10,'шт',material);
 insert into public.suppliers(id,name,is_active) values(supplier,'Components supplier',true),(wrong_supplier,'Paint supplier',true);
 insert into public.supplier_material_categories(supplier_id,category) values(supplier,'components'),(wrong_supplier,'paint');
 refs:=jsonb_build_array(jsonb_build_object('table','request_components','id',item));
 payload:=jsonb_build_array(jsonb_build_object('request_item_table','request_components','request_item_id',item,'delivery_date',current_date,'quantity',5,'unit','шт','supplier_id',wrong_supplier));
 begin
 perform public.fn_replace_supply_order_delivery_schedules_v2('{}',payload,refs,'[]');
 raise exception 'wrong supplier accepted';
 exception when check_violation then null; end;
 if exists(select 1 from public.supply_order_delivery_schedules where request_item_id=item) or (select order_status from public.request_components where id=item)<>'pending' then raise exception 'Failed schedule partially committed'; end if;
 begin
 perform public.fn_replace_supply_order_delivery_schedules_v2('{}',jsonb_set(payload,'{0,supplier_id}','null'),refs,'[]');
 raise exception 'missing supplier accepted as placed order';
 exception when check_violation then null; end;
 payload:=jsonb_set(payload,'{0,supplier_id}',to_jsonb(supplier));
 perform public.fn_replace_supply_order_delivery_schedules_v2('{}',payload,refs,'[]');
 if (select order_status from public.request_components where id=item)<>'ordered' then raise exception 'Schedule and ordered status diverged'; end if;
 if (select ordered_at from public.request_components where id=item) is null then raise exception 'Missing ordered timestamp'; end if;
 begin
 perform public.fn_replace_supply_order_delivery_schedules_v2('{}',payload,refs,'[]');
 raise exception 'stale graph accepted';
 exception when serialization_failure then null; end;
 if (select count(*) from public.supply_order_delivery_schedules where request_item_id=item)<>1 then raise exception 'Stale save duplicated schedule'; end if;
 select id into schedule from public.supply_order_delivery_schedules where request_item_id=item;
 select jsonb_agg(jsonb_build_object('id',id,'status',status,'updated_at',updated_at)) into expected from public.supply_order_delivery_schedules where request_item_id=item;
 perform public.fn_replace_supply_order_delivery_schedules_v2(array[schedule],'[]',refs,expected);
 if (select order_status from public.request_components where id=item)<>'pending' then raise exception 'Clearing schedule left ordered status'; end if;
 update public.department_access_permissions set can_manage=false where department_id=dept;
 begin
 perform public.fn_replace_supply_order_delivery_schedules_v2('{}',payload,refs,'[]');
 raise exception 'revoked permissions accepted';
 exception when others then get stacked diagnostics got=message_text; if got not like '%Недостаточно прав%' then raise; end if; end;
end $$;
rollback;
