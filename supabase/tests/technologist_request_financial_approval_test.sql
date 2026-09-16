\set ON_ERROR_STOP on

begin;

-- Match Supabase's authenticated table grants in the minimal local bootstrap.
grant select on all tables in schema public to authenticated;

do $$
declare
  v_factory uuid := gen_random_uuid();
  v_technologist uuid := gen_random_uuid();
  v_finance_one uuid := gen_random_uuid();
  v_finance_two uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_supply uuid := gen_random_uuid();
  v_department uuid := gen_random_uuid();
  v_finance_department uuid := gen_random_uuid();
  v_admin_position uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_second_machine uuid := gen_random_uuid();
  v_second_request uuid := gen_random_uuid();
  v_second_sheet uuid := gen_random_uuid();
  v_second_component uuid := gen_random_uuid();
  v_steel_type uuid := gen_random_uuid();
  v_version uuid;
  v_second_version uuid;
  v_completion uuid;
  v_error text;
begin
  update public.users set is_active = false where role = 'financial_director';
  insert into public.factories(id, name) values (v_factory, 'FINANCIAL-APPROVAL-TEST');
  insert into public.users(id, email, full_name, role, factory_id, is_active) values
    (v_technologist, v_technologist || '@approval.test', 'Технолог теста', 'technologist', v_factory, true),
    (v_finance_one, v_finance_one || '@approval.test', 'Финансовый директор 1', 'financial_director', v_factory, true),
    (v_finance_two, v_finance_two || '@approval.test', 'Финансовый директор 2', 'financial_director', v_factory, true),
    (v_admin, v_admin || '@approval.test', 'Администратор теста', 'technologist', v_factory, true),
    (v_supply, v_supply || '@approval.test', 'Снабжение теста', 'supply_manager', v_factory, true);
  select id into v_admin_position from public.positions where name = 'Администратор CRM';
  if v_admin_position is null then
    insert into public.positions(name, is_active) values ('Администратор CRM', true) returning id into v_admin_position;
  end if;
  insert into public.departments(id, name, factory_id) values
    (v_department, 'APPROVAL TEST TECHNOLOGY', v_factory),
    (v_finance_department, 'APPROVAL TEST FINANCE', v_factory);
  insert into public.department_members(user_id, department_id, position_id) values (v_admin, v_department, v_admin_position);
  insert into public.department_members(user_id, department_id, is_department_head) values
    (v_technologist, v_department, false),
    (v_finance_one, v_finance_department, false),
    (v_finance_two, v_finance_department, false);
  insert into public.department_access_permissions(
    department_id, subject_scope, resource_key, can_view, can_manage
  ) values
    (v_department, 'member', 'technologist_requests', true, true),
    (v_department, 'member', 'inventory_detailing', true, true),
    (v_finance_department, 'member', 'technologist_request_results', true, true);
  insert into public.machines(id, factory_id, name, created_by, status, material_type) values
    (v_machine, v_factory, 'APPROVAL ORDER 1', v_technologist, 'planned', 'standard'),
    (v_second_machine, v_factory, 'APPROVAL ORDER 2', v_technologist, 'planned', 'non_standard');
  insert into public.technologist_requests(id, machine_id, created_by, status) values
    (v_request, v_machine, v_technologist, 'stock_checked'),
    (v_second_request, v_second_machine, v_technologist, 'stock_checked');
  insert into public.steel_types(id, name, density_kg_mm3)
  values (v_steel_type, 'APPROVAL-TEST-STEEL', 0.00000785);
  insert into public.request_sheet_metal(
    id, request_id, material_name, material_grade, quantity_sheets,
    weight_order_kg, calculated_weight_kg, steel_type_id, remainder_qty
  ) values (
    v_second_sheet, v_second_request, 'Тестовый лист', 'S235', 1,
    100, 100, v_steel_type, 1
  );
  update public.request_sheet_metal set thickness_mm = 10, sheet_size = '1000x1000' where id = v_second_sheet;
  insert into public.request_components(id,request_id,component_name,quantity_needed)
    values (v_second_component,v_second_request,'Комплектующая согласования',2);
  begin
    update public.technologist_requests set status = 'completed' where id = v_second_request;
    raise exception 'direct completed status bypass unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%операцию финансового согласования%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  select public.fn_submit_technologist_request_for_approval(
    v_request, v_technologist,
    jsonb_build_object('decision', 'none', 'enteredPlasmaMinutes', 0, 'wasteItems', '[]'::jsonb, 'futureItems', '[]'::jsonb, 'archives', '[]'::jsonb),
    jsonb_build_object('schemaVersion', 1, 'requestId', v_request, 'machineId', v_machine, 'items', '[]'::jsonb, 'sourceData', public.fn_technologist_approval_source(v_request)),
    '[]'::jsonb
  ) into v_version;

  if (select status from public.technologist_requests where id = v_request) <> 'pending_financial_approval' then
    raise exception 'request did not enter pending financial approval';
  end if;
  begin
    update public.technologist_requests set machine_id = v_second_machine where id = v_request;
    raise exception 'pending request moved to another order';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%реквизиты отправленной заявки%' then raise; end if;
  end;
  if (select count(*) from public.tasks where technologist_request_approval_id = v_version) <> 2 then
    raise exception 'approval task was not created for every active financial director';
  end if;
  if exists (select 1 from public.tasks where technologist_request_approval_id = v_version and deadline <> (now() at time zone 'Europe/Kyiv')::date) then
    raise exception 'approval task deadline is not the submission date';
  end if;
  if exists (select 1 from public.technologist_request_completions where request_id = v_request) then
    raise exception 'completion side effects were created before approval';
  end if;

  begin
    update public.technologist_request_approval_versions set summary_snapshot = '{}'::jsonb where id = v_version;
    raise exception 'immutable snapshot update unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%неизменяем%' then raise; end if;
  end;
  begin
    update public.tasks set status = 'completed' where technologist_request_approval_id = v_version;
    raise exception 'approval task bypass unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%решением по версии%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  begin
    perform public.fn_approve_technologist_request(v_version, v_technologist);
    raise exception 'author approved own request without approval permission';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%Недостаточно прав%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub', v_finance_one::text, true);
  begin
    perform public.fn_approve_technologist_request(v_version, v_finance_one);
    raise exception 'invalid empty request approval unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%металлич%' then raise; end if;
  end;
  if (select status from public.technologist_requests where id = v_request) <> 'pending_financial_approval'
    or (select state from public.technologist_request_approval_versions where id = v_version) <> 'pending'
    or exists (select 1 from public.technologist_request_completions where request_id = v_request) then
    raise exception 'failed approval did not roll back all side effects';
  end if;

  perform set_config('request.jwt.claim.sub', v_supply::text, true);
  execute 'set local role authenticated';
  if exists (select 1 from public.technologist_requests where id in (v_request, v_second_request))
    or exists (select 1 from public.request_sheet_metal where request_id = v_second_request) then
    raise exception 'supply can read unapproved requests via RLS';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  begin
    insert into public.supply_order_delivery_schedules(request_item_table, request_item_id, delivery_date, quantity, unit)
    values ('request_sheet_metal', v_second_sheet, current_date, 1, 'шт');
    raise exception 'purchase operation before approval unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%не передана в снабжение%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  begin
    perform public.fn_submit_technologist_request_for_approval(v_request, v_technologist, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);
    raise exception 'duplicate submission unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%не готова к согласованию%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_finance_one::text, true);
  begin
    perform public.fn_return_technologist_request_for_revision(v_version, v_finance_one, '  ');
    raise exception 'return without reason unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%причину возврата%' then raise; end if;
  end;
  perform public.fn_return_technologist_request_for_revision(v_version, v_finance_one, 'Уточнить количество материала');
  if not exists (
    select 1 from public.technologist_request_approval_versions
    where id = v_version and state = 'returned' and return_reason = 'Уточнить количество материала'
  ) then raise exception 'returned version and reason were not preserved'; end if;
  if exists (select 1 from public.tasks where technologist_request_approval_id = v_version and status in ('pending', 'in_progress')) then
    raise exception 'return did not close all approval tasks';
  end if;

  update public.technologist_requests set status = 'stock_checked' where id = v_request;
  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  select public.fn_submit_technologist_request_for_approval(
    v_request, v_technologist,
    jsonb_build_object('decision', 'none', 'enteredPlasmaMinutes', 0, 'wasteItems', '[]'::jsonb, 'futureItems', '[]'::jsonb, 'archives', '[]'::jsonb),
    jsonb_build_object('schemaVersion', 1, 'requestId', v_request, 'machineId', v_machine, 'items', '[]'::jsonb, 'sourceData', public.fn_technologist_approval_source(v_request)),
    '[]'::jsonb
  ) into v_version;
  if (select revision_number from public.technologist_request_approval_versions where id = v_version) <> 1 then
    raise exception 'second version is not revision 1.1';
  end if;
  perform public.fn_begin_technologist_request_revision(v_request, v_technologist);
  if (select state from public.technologist_request_approval_versions where id = v_version) <> 'superseded' then
    raise exception 'self-edit did not preserve the previous version as superseded';
  end if;

  update public.users set is_active = false where id in (v_finance_one, v_finance_two);
  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  select public.fn_submit_technologist_request_for_approval(
    v_second_request, v_technologist,
    jsonb_build_object(
      'decision', 'none', 'enteredPlasmaMinutes', 0,
      'wasteItems', jsonb_build_array(jsonb_build_object(
        'sourceTable', 'request_sheet_metal', 'sourceId', v_second_sheet,
        'itemName', 'Тестовый лист', 'materialId', null, 'materialVariantId', null,
        'materialName', 'Тестовый лист', 'materialGrade', 'S235', 'wastePercent', 10
      )),
      'futureItems', '[]'::jsonb, 'archives', '[]'::jsonb
    ),
    jsonb_build_object('schemaVersion', 1, 'requestId', v_second_request, 'machineId', v_second_machine, 'items', '[]'::jsonb, 'sourceData', public.fn_technologist_approval_source(v_second_request)),
    '[]'::jsonb
  ) into v_second_version;
  if not exists (
    select 1 from public.tasks where technologist_request_approval_id = v_second_version and assigned_to = v_admin
  ) then raise exception 'CRM administrator fallback task was not created'; end if;

  begin
    update public.request_sheet_metal set quantity_sheets = 2 where id = v_second_sheet;
    raise exception 'pending request material mutation unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%верните заявку на редактирование%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select public.fn_approve_technologist_request(v_second_version, v_admin) into v_completion;
  if v_completion is null
     or (select status from public.technologist_requests where id = v_second_request) <> 'submitted_to_supply'
     or (select state from public.technologist_request_approval_versions where id = v_second_version) <> 'approved' then
    raise exception 'atomic approval did not finalize the approved version';
  end if;
  begin
    perform public.fn_approve_technologist_request(v_second_version, v_admin);
    raise exception 'concurrent/repeated approval unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%уже принято%' then raise; end if;
  end;
  begin
    update public.request_sheet_metal set quantity_sheets = 2 where id = v_second_sheet;
    raise exception 'approved request material mutation unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%нельзя редактировать%' then raise; end if;
  end;
  if not exists (select 1 from public.notifications where user_id = v_supply and related_machine_id = v_second_machine and title = 'Заявка одобрена и готова для снабжения') then
    raise exception 'supply was not notified after the decision';
  end if;
  -- Stock/supply accounting may evolve; the approved demand and snapshot may not.
  begin
    update public.technologist_requests set notes = 'changed after approval' where id = v_second_request;
    raise exception 'approved request notes unexpectedly changed';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%реквизиты отправленной заявки%' then raise; end if;
  end;
  update public.request_components set reserved_from_stock = 1 where id = v_second_component;
  if (select quantity_needed from public.request_components where id = v_second_component) <> 2 then raise exception 'stock accounting changed approved demand'; end if;
  insert into public.request_components(request_id,component_name,quantity_needed)
    values (v_request,'Заявка без металлических позиций',1);

  update public.users set is_active = false where id in (
    select dm.user_id from public.department_members dm join public.positions p on p.id = dm.position_id where p.name = 'Администратор CRM'
  );
  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  update public.technologist_requests set status = 'stock_checked' where id = v_request;
  begin
    perform public.fn_submit_technologist_request_for_approval(v_request,v_technologist,
      jsonb_build_object('decision','none','enteredPlasmaMinutes',0,'wasteItems','[]'::jsonb,'futureItems','[]'::jsonb,'archives','[]'::jsonb),
      jsonb_build_object('sourceData',public.fn_technologist_approval_source(v_request)));
    raise exception 'submission without any reviewers unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%Нет активного финансового директора%' then raise; end if;
  end;
  update public.users set is_active = true where id = v_finance_one;
  perform set_config('request.jwt.claim.sub', v_technologist::text, true);
  select public.fn_submit_technologist_request_for_approval(v_request,v_technologist,
    jsonb_build_object('decision','none','enteredPlasmaMinutes',0,'wasteItems','[]'::jsonb,'futureItems','[]'::jsonb,'archives','[]'::jsonb),
    jsonb_build_object('sourceData',public.fn_technologist_approval_source(v_request))) into v_version;
  if (select revision_number from public.technologist_request_approval_versions where id = v_version) <> 2 then
    raise exception 'third submission is not version 1.2';
  end if;
  perform set_config('request.jwt.claim.sub', v_finance_one::text, true);
  v_completion := public.fn_approve_technologist_request(v_version,v_finance_one);
  if v_completion is null or exists (select 1 from public.technologist_request_waste_items where completion_id = v_completion) then
    raise exception 'non-metal request failed approval or invented waste';
  end if;

  if exists (select 1 from public.technologist_requests where id = '94000000-0000-4000-8000-000000000001') then
    if not exists (select 1 from public.technologist_request_approval_versions where request_id = '94000000-0000-4000-8000-000000000001'
      and state = 'approved' and is_legacy and decided_by is null
      and summary_snapshot->'sourceData'->'request_components'->0->>'component_name' = 'Старая комплектация') then
      raise exception 'legacy migration lost the source summary or invented an approver';
    end if;
    if exists (select 1 from public.technologist_request_completions where request_id = '94000000-0000-4000-8000-000000000001') then
      raise exception 'legacy migration replayed production side effects';
    end if;
  end if;
end;
$$;

rollback;
