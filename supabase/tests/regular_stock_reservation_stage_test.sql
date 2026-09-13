\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_error text;
begin
  select id into strict v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, v_actor || '@regular-stock-stage.test', 'Тест двух складов', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'REGULAR-STOCK-STAGE', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by, status)
  values (v_request, v_machine, v_actor, 'pending_stock_check');
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  begin
    update public.technologist_requests set status = 'submitted_to_supply' where id = v_request;
    raise exception 'Direct pending_stock_check handoff unexpectedly succeeded';
  exception when sqlstate '55000' then
    get stacked diagnostics v_error = message_text;
    if v_error not like '[REGULAR_STOCK_CHECK_REQUIRED]%' then raise; end if;
  end;

  if (select status from public.technologist_requests where id = v_request) <> 'pending_stock_check' then
    raise exception 'Rejected transition changed the request status';
  end if;

  perform public.fn_complete_business_scrap_stage_v1(v_request, v_actor);
  if (select status from public.technologist_requests where id = v_request) <> 'stock_checked' then
    raise exception 'Business-scrap completion did not open regular-stock stage';
  end if;
  update public.technologist_requests set status = 'submitted_to_supply' where id = v_request;
  if (select status from public.technologist_requests where id = v_request) <> 'submitted_to_supply' then
    raise exception 'stock_checked handoff did not succeed';
  end if;
end;
$$;

rollback;
