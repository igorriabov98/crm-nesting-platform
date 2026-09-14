-- Applied only by the localhost test runner, before the approval migration.
do $$
declare v_factory uuid := gen_random_uuid(); v_author uuid := gen_random_uuid(); v_machine uuid := gen_random_uuid();
begin
  insert into factories(id,name,city) values (v_factory,'APPROVAL-LEGACY-TEST','Ужгород');
  insert into users(id,email,full_name,role,factory_id,is_active)
    values (v_author,v_author || '@approval.test','Автор старой заявки','technologist',v_factory,true);
  insert into machines(id,name,factory_id,created_by,status,material_type)
    values (v_machine,'APPROVAL LEGACY',v_factory,v_author,'planned','standard');
  insert into technologist_requests(id,machine_id,created_by,status)
    values ('94000000-0000-4000-8000-000000000001',v_machine,v_author,'submitted_to_supply');
  insert into request_components(request_id,component_name,quantity_needed)
    values ('94000000-0000-4000-8000-000000000001','Старая комплектация',3);
end $$;
