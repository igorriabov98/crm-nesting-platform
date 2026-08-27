-- A removed request position must not leave an invisible cutting-plan item
-- blocking every future cutting fact for the machine.
create or replace function public.fn_assert_long_stock_cutting_ready(p_machine_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.long_stock_cutting_plan_items item
    join public.technologist_requests request on request.id = item.request_id
    where request.machine_id = p_machine_id
      and item.cutting_status = 'requires_recalculation'
      and (
        (item.request_item_table = 'request_circle' and exists (
          select 1 from public.request_circle request_item where request_item.id = item.request_item_id
        ))
        or (item.request_item_table = 'request_pipe' and exists (
          select 1 from public.request_pipe request_item where request_item.id = item.request_item_id
        ))
        or (item.request_item_table = 'request_knives' and exists (
          select 1 from public.request_knives request_item where request_item.id = item.request_item_id
        ))
      )
  ) then
    raise exception 'Резка заблокирована: позиция длинномера требует пересчёта';
  end if;

  if exists (
    select 1
    from public.long_stock_cutting_plan_items item
    join public.long_stock_cutting_plans plan on plan.id = item.plan_id
    join public.technologist_requests request on request.id = item.request_id
    where request.machine_id = p_machine_id
      and plan.status = 'open'
      and (
        (item.request_item_table = 'request_circle' and exists (
          select 1 from public.request_circle request_item where request_item.id = item.request_item_id
        ))
        or (item.request_item_table = 'request_pipe' and exists (
          select 1 from public.request_pipe request_item where request_item.id = item.request_item_id
        ))
        or (item.request_item_table = 'request_knives' and exists (
          select 1 from public.request_knives request_item where request_item.id = item.request_item_id
        ))
      )
      and (
        item.cutting_status = 'planning'
        or not exists (
          select 1
          from public.long_stock_cutting_plan_versions version
          join public.long_stock_cutting_candidates candidate
            on candidate.version_id = version.id
           and candidate.candidate_number = version.selected_candidate_number
          where version.plan_id = plan.id
            and version.status = 'approved'
        )
      )
  ) then
    raise exception 'Резка заблокирована: для позиции длинномера нет утверждённой версии карты раскроя';
  end if;
end;
$$;

revoke all on function public.fn_assert_long_stock_cutting_ready(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_assert_long_stock_cutting_ready(uuid)
  to service_role;
