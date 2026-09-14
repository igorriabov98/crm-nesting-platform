\set ON_ERROR_STOP on

begin;

do $$
declare
  v_factory uuid := gen_random_uuid();
  v_technologist uuid := gen_random_uuid();
  v_finance_one uuid := gen_random_uuid();
  v_finance_two uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_department uuid := gen_random_uuid();
  v_admin_position uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_second_machine uuid := gen_random_uuid();
  v_second_request uuid := gen_random_uuid();
  v_version uuid;
  v_second_version uuid;
  v_completion uuid;
  v_error text;
begin
  insert into public.factories(id, name) values (v_factory, 'FINANCIAL-APPROVAL-TEST');
  insert into public.users(id, email, full_name, role, factory_id, is_active) values
    (v_technologist, v_technologist || '@approval.test', 'Технолог теста', 'technologist', v_factory, true),
    (v_finance_one, v_finance_one || '@approval.test', 'Финансовый директор 1', 'financial_director', v_factory, true),
    (v_finance_two, v_finance_two || '@approval.test', 'Финансовый директор 2', 'financial_director', v_factory, true),
    (v_admin, v_admin || '@approval.test', 'Администратор теста', 'technologist', v_factory, true);
  select id into v_admin_position from public.positions where name = 'Администратор CRM';
  if v_admin_position is null then
    insert into public.positions(name, is_active) values ('Администратор CRM', true) returning id into v_admin_position;
  end if;
  insert into public.departments(id, name, factory_id) values (v_department, 'APPROVAL TEST', v_factory);
  insert into public.department_members(user_id, department_id, position_id) values (v_admin, v_department, v_admin_position);
  insert into public.machines(id, factory_id, name, created_by, status, material_type) values
    (v_machine, v_factory, 'APPROVAL ORDER 1', v_technologist, 'planned', 'standard'),
    (v_second_machine, v_factory, 'APPROVAL ORDER 2', v_technologist, 'planned', 'non_standard');
  insert into public.technologist_requests(id, machine_id, created_by, status) values
    (v_request, v_machine, v_technologist, 'stock_checked'),
    (v_second_request, v_second_machine, v_technologist, 'stock_checked');

  select public.fn_submit_technologist_request_for_approval(
    v_request, v_technologist,
    jsonb_build_object('decision', 'none', 'enteredPlasmaMinutes', 0, 'wasteItems', '[]'::jsonb, 'futureItems', '[]'::jsonb, 'archives', '[]'::jsonb),
    jsonb_build_object('schemaVersion', 1, 'requestId', v_request, 'machineId', v_machine, 'items', '[]'::jsonb),
    '[]'::jsonb
  ) into v_version;

  if (select status from public.technologist_requests where id = v_request) <> 'pending_financial_approval' then
    raise exception 'request did not enter pending financial approval';
  end if;
  if (select count(*) from public.tasks where technologist_request_approval_id = v_version) <> 2 then
    raise exception 'approval task was not created for every active financial director';
  end if;
  if exists (select 1 from public.tasks where technologist_request_approval_id = v_version and deadline <> (now() at time zone 'Europe/Uzhgorod')::date) then
    raise exception 'approval task deadline is not the submission date';
  end if;
  if exists (select 1 from public.technologist_request_completions where request_id = v_request) then
    raise exception 'completion side effects were created before approval';
  end if;

  begin
    perform public.fn_submit_technologist_request_for_approval(v_request, v_technologist, '{}'::jsonb, '{}'::jsonb, '[]'::jsonb);
    raise exception 'duplicate submission unexpectedly succeeded';
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error not like '%не готова к согласованию%' then raise; end if;
  end;

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
  select public.fn_submit_technologist_request_for_approval(
    v_request, v_technologist,
    jsonb_build_object('decision', 'none', 'enteredPlasmaMinutes', 0, 'wasteItems', '[]'::jsonb, 'futureItems', '[]'::jsonb, 'archives', '[]'::jsonb),
    jsonb_build_object('schemaVersion', 1, 'requestId', v_request, 'machineId', v_machine, 'items', '[]'::jsonb),
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
  select public.fn_submit_technologist_request_for_approval(
    v_second_request, v_technologist,
    jsonb_build_object('decision', 'none', 'enteredPlasmaMinutes', 0, 'wasteItems', '[]'::jsonb, 'futureItems', '[]'::jsonb, 'archives', '[]'::jsonb),
    jsonb_build_object('schemaVersion', 1, 'requestId', v_second_request, 'machineId', v_second_machine, 'items', '[]'::jsonb),
    '[]'::jsonb
  ) into v_second_version;
  if not exists (
    select 1 from public.tasks where technologist_request_approval_id = v_second_version and assigned_to = v_admin
  ) then raise exception 'CRM administrator fallback task was not created'; end if;

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
end;
$$;

rollback;
