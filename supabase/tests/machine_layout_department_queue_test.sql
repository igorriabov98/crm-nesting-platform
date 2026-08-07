\set ON_ERROR_STOP on

begin;

do $$
declare
  v_factory_id uuid := gen_random_uuid();
  v_creator_id uuid := gen_random_uuid();
  v_technologist_id uuid := gen_random_uuid();
  v_engineer_id uuid := gen_random_uuid();
  v_director_id uuid := gen_random_uuid();
  v_structural_technologist_id uuid := gen_random_uuid();
  v_department_id uuid := gen_random_uuid();
  v_position_id uuid := gen_random_uuid();
  v_machine_id uuid := gen_random_uuid();
  v_department_request_id uuid;
  v_layout_request_id uuid;
  v_first_task_id uuid;
  v_replacement_layout_id uuid;
  v_task_count integer;
  v_open_count integer;
  v_layout_version integer;
  v_snapshot jsonb := jsonb_build_array(jsonb_build_object(
    'itemId', gen_random_uuid(),
    'name', 'QUEUE TEST ITEM',
    'quantity', 1
  ));
begin
  if public.machine_layout_next_workday(date '2026-08-06') <> date '2026-08-07'
    or public.machine_layout_next_workday(date '2026-08-07') <> date '2026-08-10'
    or public.machine_layout_next_workday(date '2026-08-08') <> date '2026-08-10'
    or public.machine_layout_next_workday(date '2026-08-09') <> date '2026-08-10' then
    raise exception 'machine_layout_next_workday returned an unexpected date';
  end if;

  insert into public.factories(id, name)
  values (v_factory_id, 'MACHINE-LAYOUT-QUEUE-TEST');

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values
    (v_creator_id, 'layout-creator@example.test', 'Layout Creator', 'sales_manager', v_factory_id, true),
    (v_technologist_id, 'layout-technologist@example.test', 'Layout Technologist', 'technologist', v_factory_id, true),
    (v_engineer_id, 'layout-engineer@example.test', 'Layout Engineer', 'engineer', v_factory_id, true),
    (v_director_id, 'layout-director@example.test', 'Layout Director', 'planning_director', v_factory_id, true),
    (v_structural_technologist_id, 'layout-structural@example.test', 'Layout Structural Technologist', 'sales_manager', v_factory_id, true);

  insert into public.positions(id, name)
  values (v_position_id, 'Технолог MACHINE-LAYOUT-QUEUE-TEST');
  insert into public.departments(id, name, factory_id, is_active)
  values (v_department_id, 'Конструкторский отдел MACHINE-LAYOUT-QUEUE-TEST', v_factory_id, true);
  insert into public.department_members(user_id, department_id, position_id)
  values (v_structural_technologist_id, v_department_id, v_position_id);

  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine_id, v_factory_id, 'MACHINE-LAYOUT-QUEUE-TEST', v_creator_id);

  select created.department_request_id, created.layout_request_id
    into v_department_request_id, v_layout_request_id
  from public.create_machine_layout_department_request(v_machine_id, v_creator_id, v_snapshot) created;

  if not exists (
    select 1
    from public.department_requests request
    where request.id = v_department_request_id
      and request.request_kind = 'machine_layout'
      and request.status = 'new'
      and request.assigned_to is null
      and request.due_date is null
  ) then
    raise exception 'new queue request was not created unassigned';
  end if;

  if not exists (
    select 1
    from public.machine_layout_requests layout_request
    where layout_request.id = v_layout_request_id
      and layout_request.department_request_id = v_department_request_id
      and layout_request.assigned_to is null
      and layout_request.task_id is null
  ) then
    raise exception 'new layout version was not linked to the queue request';
  end if;

  if exists (
    select 1 from public.tasks task where task.department_request_id = v_department_request_id
  ) then
    raise exception 'task was created before the queue request was claimed';
  end if;

  perform set_config('request.jwt.claim.sub', v_director_id::text, true);
  begin
    perform public.claim_department_request(v_department_request_id);
    raise exception 'director claimed a machine-layout request using director role only';
  exception when others then
    if sqlerrm not like '%только технолог или инженер%' then
      raise;
    end if;
  end;

  perform set_config('request.jwt.claim.sub', v_technologist_id::text, true);
  perform public.claim_department_request(v_department_request_id);

  select task.id
    into v_first_task_id
  from public.tasks task
  where task.department_request_id = v_department_request_id;

  if v_first_task_id is null or not exists (
    select 1
    from public.tasks task
    where task.id = v_first_task_id
      and task.task_type = 'machine_layout'
      and task.machine_id = v_machine_id
      and task.assigned_to = v_technologist_id
      and task.status = 'in_progress'
      and task.deadline = public.machine_layout_next_workday(
        (now() at time zone 'Europe/Uzhgorod')::date
      )
  ) then
    raise exception 'claim did not create the expected machine-layout task';
  end if;

  if not exists (
    select 1
    from public.department_requests request
    where request.id = v_department_request_id
      and request.status = 'in_progress'
      and request.assigned_to = v_technologist_id
      and request.due_date = public.machine_layout_next_workday(
        (now() at time zone 'Europe/Uzhgorod')::date
      )
  ) then
    raise exception 'claim did not assign the queue request and its due date';
  end if;

  if not exists (
    select 1
    from public.machine_layout_requests layout_request
    where layout_request.id = v_layout_request_id
      and layout_request.assigned_to = v_technologist_id
      and layout_request.task_id = v_first_task_id
  ) then
    raise exception 'claim did not update the active layout version';
  end if;

  perform set_config('request.jwt.claim.sub', v_engineer_id::text, true);
  begin
    perform public.claim_department_request(v_department_request_id);
    raise exception 'a second claimant acquired the same queue request';
  exception when others then
    if sqlerrm not like '%уже взял другой сотрудник%' then
      raise;
    end if;
  end;

  select count(*) into v_task_count
  from public.tasks task
  where task.department_request_id = v_department_request_id;
  if v_task_count <> 1 then
    raise exception 'claim created % tasks instead of one', v_task_count;
  end if;

  select public.sync_machine_layout_request_version(
    v_machine_id,
    v_snapshot || jsonb_build_array(jsonb_build_object(
      'itemId', gen_random_uuid(),
      'name', 'QUEUE TEST ITEM 2',
      'quantity', 2
    ))
  ) into v_replacement_layout_id;

  select count(*), max(version_no)
    into v_open_count, v_layout_version
  from public.machine_layout_requests layout_request
  where layout_request.machine_id = v_machine_id
    and layout_request.status = 'requested';

  if v_open_count <> 1 or v_replacement_layout_id is null or not exists (
    select 1
    from public.machine_layout_requests layout_request
    where layout_request.id = v_replacement_layout_id
      and layout_request.department_request_id = v_department_request_id
      and layout_request.task_id = v_first_task_id
      and layout_request.assigned_to = v_technologist_id
      and layout_request.version_no = v_layout_version
  ) then
    raise exception 'v_snapshot refresh did not preserve queue ownership and task';
  end if;

  perform set_config('request.jwt.claim.sub', v_technologist_id::text, true);
  begin
    perform public.complete_department_request(v_department_request_id, 'Manual completion', '[]'::jsonb);
    raise exception 'machine-layout request was completed through the generic dialog';
  exception when others then
    if sqlerrm not like '%завершается автоматически после загрузки PDF%' then
      raise;
    end if;
  end;

  perform public.complete_machine_layout_request(
    v_replacement_layout_id,
    v_technologist_id,
    'layout.pdf',
    'machine-layouts/test/layout.pdf',
    'application/pdf',
    1024
  );

  if not exists (
    select 1 from public.department_requests request
    where request.id = v_department_request_id and request.status = 'done'
  ) or not exists (
    select 1 from public.tasks task
    where task.id = v_first_task_id and task.status = 'completed'
  ) or not exists (
    select 1 from public.machine_layout_requests layout_request
    where layout_request.id = v_replacement_layout_id
      and layout_request.status = 'completed'
      and layout_request.pdf_file_path = 'machine-layouts/test/layout.pdf'
  ) then
    raise exception 'PDF completion did not close all three linked records';
  end if;

  select created.department_request_id
    into v_department_request_id
  from public.create_machine_layout_department_request(v_machine_id, v_creator_id, v_snapshot) created;

  perform set_config('request.jwt.claim.sub', v_creator_id::text, true);
  perform public.cancel_department_request(v_department_request_id);

  if exists (
    select 1 from public.machine_layout_requests layout_request
    where layout_request.department_request_id = v_department_request_id
      and layout_request.status = 'requested'
  ) then
    raise exception 'cancellation left an open layout version';
  end if;

  select created.department_request_id
    into v_department_request_id
  from public.create_machine_layout_department_request(v_machine_id, v_creator_id, v_snapshot) created;

  perform set_config('request.jwt.claim.sub', v_engineer_id::text, true);
  perform public.claim_department_request(v_department_request_id);
  perform public.reject_department_request(v_department_request_id, 'Regression rejection');

  if exists (
    select 1 from public.tasks task
    where task.department_request_id = v_department_request_id
      and task.status not in ('completed', 'cancelled')
  ) or exists (
    select 1 from public.machine_layout_requests layout_request
    where layout_request.department_request_id = v_department_request_id
      and layout_request.status = 'requested'
  ) then
    raise exception 'rejection left active task or layout state';
  end if;

  select created.department_request_id
    into v_department_request_id
  from public.create_machine_layout_department_request(v_machine_id, v_creator_id, v_snapshot) created;

  perform set_config('request.jwt.claim.sub', v_structural_technologist_id::text, true);
  perform public.claim_department_request(v_department_request_id);

  if not exists (
    select 1
    from public.department_requests request
    where request.id = v_department_request_id
      and request.assigned_to = v_structural_technologist_id
      and request.status = 'in_progress'
  ) then
    raise exception 'active structural technologist could not claim the layout request';
  end if;

  perform public.reject_department_request(v_department_request_id, 'Structural technologist rejection');

  begin
    insert into public.department_requests(
      request_kind,
      target_department,
      title,
      description,
      created_by,
      factory_id,
      machine_id
    ) values (
      'invalid-kind',
      'technologist',
      'Invalid request kind',
      'Constraint regression check',
      v_creator_id,
      v_factory_id,
      v_machine_id
    );
    raise exception 'department request accepted an invalid request_kind';
  exception when check_violation then
    null;
  end;
end;
$$;

rollback;
