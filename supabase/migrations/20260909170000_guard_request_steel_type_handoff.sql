-- Steel type is part of sheet-metal inventory identity. Enforce it at the
-- database handoff boundary so direct RPC/table calls cannot expose an
-- incomplete sheet position to warehouse or supply users.

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
     or coalesce((v_row->>'is_cutting_plan_draft')::boolean, false) then
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

revoke all on function public.fn_guard_request_item_steel_type_removal_v1()
  from public, anon, authenticated;

-- RPC implementations ultimately write inventory_reservations. Validate the
-- authoritative inventory row there so no client-supplied variant id can bypass
-- the sheet identity check.
create or replace function public.fn_guard_sheet_inventory_reservation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.request_sheet_metal%rowtype;
  v_inventory public.inventory%rowtype;
  v_variant public.material_variants%rowtype;
begin
  if new.request_item_table is distinct from 'request_sheet_metal' then
    return new;
  end if;

  select * into v_sheet
  from public.request_sheet_metal
  where id = new.request_item_id;
  if not found then
    raise exception using errcode = '23503', message = 'Позиция листового металла не найдена';
  end if;

  select * into v_inventory
  from public.inventory
  where id = coalesce(new.source_inventory_id, new.inventory_id)
    and deleted_at is null;
  if not found or v_inventory.material_variant_id is null then
    raise exception using errcode = '23514', message = 'Для листа выберите складской остаток с точной характеристикой';
  end if;

  select * into v_variant
  from public.material_variants
  where id = v_inventory.material_variant_id;
  if not found
     or v_inventory.material_id is distinct from v_sheet.material_id
     or v_sheet.steel_type_id is null
     or v_variant.steel_type_id is distinct from v_sheet.steel_type_id
     or replace(replace(replace(regexp_replace(lower(coalesce(v_variant.sheet_size, '')), '\s+', '', 'g'), 'х', 'x'), '×', 'x'), '*', 'x')
        is distinct from replace(replace(replace(regexp_replace(lower(coalesce(v_sheet.sheet_size, '')), '\s+', '', 'g'), 'х', 'x'), '×', 'x'), '*', 'x')
     or v_variant.thickness_mm is distinct from v_sheet.thickness_mm then
    raise exception using
      errcode = '23514',
      message = 'Выбранный складской остаток не совпадает с типом стали, размером или толщиной листа';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_sheet_inventory_reservation
  on public.inventory_reservations;
create trigger guard_sheet_inventory_reservation
before insert or update of inventory_id, source_inventory_id, request_item_table, request_item_id
on public.inventory_reservations
for each row execute function public.fn_guard_sheet_inventory_reservation_v1();

revoke all on function public.fn_guard_sheet_inventory_reservation_v1()
  from public, anon, authenticated;
