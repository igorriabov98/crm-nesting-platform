-- Steel type is part of the inventory identity for every metal request except wire.
-- Enforce it at the database handoff boundary so direct RPC/table calls cannot
-- expose an incomplete position to warehouse or supply users.

create or replace function public.fn_guard_request_steel_type_handoff_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_position record;
begin
  if new.status not in ('pending_stock_check', 'stock_checked', 'submitted_to_supply')
     or new.status is not distinct from old.status then
    return new;
  end if;

  for v_position in
    select 'request_sheet_metal'::text as source_table, sheet.id, sheet.sort_order
    from public.request_sheet_metal sheet
    where sheet.request_id = new.id
      and sheet.order_status <> 'cancelled'
      and sheet.steel_type_id is null
    union all
    select 'request_circle', circle.id, circle.sort_order
    from public.request_circle circle
    where circle.request_id = new.id
      and circle.order_status <> 'cancelled'
      and not circle.is_cutting_plan_draft
      and circle.steel_type_id is null
    union all
    select 'request_pipe', pipe.id, pipe.sort_order
    from public.request_pipe pipe
    where pipe.request_id = new.id
      and pipe.order_status <> 'cancelled'
      and not pipe.is_cutting_plan_draft
      and pipe.pipe_type <> 'wire'
      and pipe.steel_type_id is null
    union all
    select 'request_knives', knife.id, knife.sort_order
    from public.request_knives knife
    where knife.request_id = new.id
      and knife.order_status <> 'cancelled'
      and not knife.is_cutting_plan_draft
      and knife.steel_type_id is null
    order by sort_order, id
    limit 1
  loop
    raise exception using
      errcode = '23502',
      message = format(
        'Нельзя передать заявку: у позиции %s (%s) не выбран тип стали',
        v_position.source_table,
        v_position.id
      );
  end loop;

  return new;
end;
$$;

drop trigger if exists guard_request_steel_type_handoff
  on public.technologist_requests;
create trigger guard_request_steel_type_handoff
before update of status on public.technologist_requests
for each row execute function public.fn_guard_request_steel_type_handoff_v1();

revoke all on function public.fn_guard_request_steel_type_handoff_v1()
  from public, anon, authenticated;

-- Once a request has left its draft, do not let a later row edit silently erase
-- the steel identity. Blank rows may still be built progressively; the handoff
-- guard above rejects them until they are complete.
create or replace function public.fn_guard_request_item_steel_type_removal_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_status text;
begin
  if old.steel_type_id is null or new.steel_type_id is not null then
    return new;
  end if;
  if coalesce(v_row->>'order_status', '') = 'cancelled'
     or coalesce((v_row->>'is_cutting_plan_draft')::boolean, false)
     or (tg_table_name = 'request_pipe' and v_row->>'pipe_type' = 'wire') then
    return new;
  end if;

  select request.status::text into v_status
  from public.technologist_requests request
  where request.id = new.request_id;
  if v_status in ('pending_stock_check', 'stock_checked', 'submitted_to_supply') then
    raise exception using
      errcode = '23502',
      message = 'Нельзя удалить тип стали из позиции переданной заявки';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_request_sheet_metal_steel_type_removal
  on public.request_sheet_metal;
create trigger guard_request_sheet_metal_steel_type_removal
before update of steel_type_id on public.request_sheet_metal
for each row execute function public.fn_guard_request_item_steel_type_removal_v1();

drop trigger if exists guard_request_circle_steel_type_removal
  on public.request_circle;
create trigger guard_request_circle_steel_type_removal
before update of steel_type_id on public.request_circle
for each row execute function public.fn_guard_request_item_steel_type_removal_v1();

drop trigger if exists guard_request_pipe_steel_type_removal
  on public.request_pipe;
create trigger guard_request_pipe_steel_type_removal
before update of steel_type_id on public.request_pipe
for each row execute function public.fn_guard_request_item_steel_type_removal_v1();

drop trigger if exists guard_request_knives_steel_type_removal
  on public.request_knives;
create trigger guard_request_knives_steel_type_removal
before update of steel_type_id on public.request_knives
for each row execute function public.fn_guard_request_item_steel_type_removal_v1();

revoke all on function public.fn_guard_request_item_steel_type_removal_v1()
  from public, anon, authenticated;
