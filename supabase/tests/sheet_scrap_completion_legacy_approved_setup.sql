-- Existing approved completions are protected against updates. The schema
-- migration still needs to fill their newly added waste basis.
do $$
declare
  v_actor uuid := '9f000000-0000-4000-8000-000000000011';
  v_machine uuid := '9f000000-0000-4000-8000-000000000012';
  v_request uuid := '9f000000-0000-4000-8000-000000000013';
  v_source uuid := '9f000000-0000-4000-8000-000000000014';
  v_completion uuid := '9f000000-0000-4000-8000-000000000015';
  v_factory uuid;
begin
  select id into strict v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'sheet-approved-legacy@test.invalid', 'Sheet approved legacy', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'SHEET-APPROVED-LEGACY', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by, status)
  values (v_request, v_machine, v_actor, 'draft');
  insert into public.request_sheet_metal(id, request_id, material_name, sheet_size, quantity_sheets)
  values (v_source, v_request, 'Sheet approved legacy', '1200x300', 1);
  insert into public.technologist_request_completions(
    id, request_id, machine_id, factory_id, created_by, future_detailing_decision,
    entered_plasma_minutes, added_plasma_minutes, actual_plasma_minutes
  ) values (v_completion, v_request, v_machine, v_factory, v_actor, 'none', 0, 0, 0);
  insert into public.technologist_request_waste_items(
    completion_id, request_id, source_table, source_id, item_name,
    material_name, weight_snapshot_kg, waste_percent, scrap_weight_kg, useful_weight_kg
  ) values (v_completion, v_request, 'request_sheet_metal', v_source,
            'Sheet approved legacy', 'Sheet approved legacy', 100, 10, 10, 90);
  insert into public.technologist_request_approval_versions(
    request_id, revision_number, state, completion_payload, summary_snapshot,
    submitted_by, decided_by, decided_at
  ) values (v_request, 1, 'approved', '{}'::jsonb, '{}'::jsonb,
            v_actor, v_actor, now());
end;
$$;
