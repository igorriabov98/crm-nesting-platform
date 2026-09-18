-- Financial approval changes the request status before the legacy finalizer
-- runs. During that transition, cleanup must act as the technologist who owns
-- the request; the finance head may have a non-director application role.
create or replace function public.fn_cleanup_cutting_drafts_and_guard_revision_stock_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := case
    when current_setting('app.financial_approval_request', true) = new.id::text
      then new.created_by
    else coalesce(auth.uid(), new.created_by)
  end;
  v_revision record;
begin
  if new.status in ('pending_stock_check', 'stock_checked')
    and new.status is distinct from old.status then
    select * into v_revision from public.supply_position_revisions
    where replacement_request_id = new.id and status in ('editing', 'stock_check')
    limit 1;
    if found and v_revision.replacement_request_item_table in ('request_circle', 'request_pipe', 'request_knives')
      and (
        v_revision.replacement_request_item_table <> 'request_pipe'
        or exists (
          select 1 from public.request_pipe pipe
          where pipe.id = v_revision.replacement_request_item_id and pipe.pipe_type <> 'wire'
        )
      )
      and not exists (
        select 1 from public.long_stock_cutting_plan_items item
        where item.request_item_table = v_revision.replacement_request_item_table
          and item.request_item_id = v_revision.replacement_request_item_id
          and item.cutting_status in ('plan_approved', 'accepted')
          and item.link_state = 'active'
      ) then
      raise exception using errcode = '55000', message = '[CUTTING_PLAN_REQUIRED] Сначала подготовьте и утвердите карту раскроя';
    end if;
    perform public.fn_discard_long_stock_request_item_drafts_v1(new.id, v_actor, null, null);
  end if;
  return new;
end;
$$;

revoke all on function public.fn_cleanup_cutting_drafts_and_guard_revision_stock_check()
  from public, anon, authenticated, service_role;
