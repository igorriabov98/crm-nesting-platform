-- A quarter turn does not change the identity of a rectangular sheet/profile.
create or replace function public.fn_same_rectangular_dimensions_v1(p_left text, p_right text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  a text[];
  b text[];
begin
  a := string_to_array(replace(replace(replace(replace(regexp_replace(lower(coalesce(p_left, '')), '\s+', '', 'g'), 'х', 'x'), '×', 'x'), '*', 'x'), ',', '.'), 'x');
  b := string_to_array(replace(replace(replace(replace(regexp_replace(lower(coalesce(p_right, '')), '\s+', '', 'g'), 'х', 'x'), '×', 'x'), '*', 'x'), ',', '.'), 'x');
  if cardinality(a) <> 2 or cardinality(b) <> 2
     or a[1] !~ '^[0-9]+(\.[0-9]+)?$' or a[2] !~ '^[0-9]+(\.[0-9]+)?$'
     or b[1] !~ '^[0-9]+(\.[0-9]+)?$' or b[2] !~ '^[0-9]+(\.[0-9]+)?$' then
    return false;
  end if;
  if a[1]::numeric <= 0 or a[2]::numeric <= 0 or b[1]::numeric <= 0 or b[2]::numeric <= 0 then
    return false;
  end if;
  return (a[1]::numeric = b[1]::numeric and a[2]::numeric = b[2]::numeric)
      or (a[1]::numeric = b[2]::numeric and a[2]::numeric = b[1]::numeric);
end;
$$;

revoke all on function public.fn_same_rectangular_dimensions_v1(text, text) from public, anon, authenticated;

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
  if new.request_item_table is distinct from 'request_sheet_metal' then return new; end if;

  select * into v_sheet from public.request_sheet_metal where id = new.request_item_id;
  if not found then
    raise exception using errcode = '23503', message = 'Позиция листового металла не найдена';
  end if;
  select * into v_inventory from public.inventory
  where id = coalesce(new.source_inventory_id, new.inventory_id) and deleted_at is null;
  if not found or v_inventory.material_variant_id is null then
    raise exception using errcode = '23514', message = 'Для листа выберите складской остаток с точной характеристикой';
  end if;
  select * into v_variant from public.material_variants where id = v_inventory.material_variant_id;
  if not found
     or v_variant.category is distinct from 'sheet_metal'
     or v_variant.material_id is distinct from v_inventory.material_id
     or (v_inventory.is_business_scrap is true
       and coalesce(v_inventory.business_scrap_state, 'available') <> 'available')
     or v_sheet.steel_type_id is null
     or v_variant.steel_type_id is distinct from v_sheet.steel_type_id
     or v_sheet.thickness_mm is null or v_sheet.thickness_mm <= 0
     or v_variant.thickness_mm is distinct from v_sheet.thickness_mm
     or (v_inventory.is_business_scrap is distinct from true and (
       v_inventory.material_id is distinct from v_sheet.material_id
       or not public.fn_same_rectangular_dimensions_v1(v_variant.sheet_size, v_sheet.sheet_size)
     )) then
    raise exception using errcode = '23514',
      message = 'Выбранный листовой остаток не совпадает с типом стали и толщиной позиции заявки';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_guard_sheet_inventory_reservation_v1() from public, anon, authenticated;

-- Physical business-scrap reservations remain tied to the request, but never
-- count as full sheet coverage. Transfers refer to their original source row.
create or replace function public.fn_set_request_reserved_quantity(
  p_table text, p_id uuid, p_quantity numeric default null, p_secondary_quantity numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity numeric;
  v_secondary_quantity numeric;
begin
  select coalesce(sum(coalesce(logical_reserved_quantity, reserved_quantity)), 0),
         coalesce(sum(coalesce(reserved_secondary_quantity, 0)), 0)
    into v_quantity, v_secondary_quantity
  from public.inventory_reservations
  where request_item_table = p_table and request_item_id = p_id
    and reservation_source in ('stock', 'whole_bar_stock');

  if p_table = 'request_sheet_metal' then
    select coalesce(sum(coalesce(reservation.logical_reserved_quantity, reservation.reserved_quantity)), 0)
      into v_quantity
    from public.inventory_reservations reservation
    left join public.inventory source_stock
      on source_stock.id = coalesce(reservation.source_inventory_id, reservation.inventory_id)
    where reservation.request_item_table = p_table
      and reservation.request_item_id = p_id
      and reservation.reservation_source in ('stock', 'whole_bar_stock')
      and source_stock.is_business_scrap is distinct from true;
    update public.request_sheet_metal set reserved_from_stock_kg = v_quantity where id = p_id;
  elsif p_table = 'request_round_tube' then
    update public.request_round_tube set reserved_from_stock_kg = v_quantity,
      reserved_from_stock_m = v_secondary_quantity where id = p_id;
  elsif p_table = 'request_circle' then
    update public.request_circle set reserved_from_stock_mm = v_quantity where id = p_id;
  elsif p_table = 'request_pipe' then
    update public.request_pipe set
      reserved_from_stock_length_mm = case when pipe_type = 'wire' then reserved_from_stock_length_mm else v_quantity end,
      reserved_from_stock_qty = case when pipe_type = 'wire' then reserved_from_stock_qty else v_secondary_quantity end,
      reserved_from_stock_kg = case when pipe_type = 'wire' then v_quantity else reserved_from_stock_kg end
    where id = p_id;
  elsif p_table = 'request_knives' then
    update public.request_knives set reserved_from_stock_mm = v_quantity,
      reserved_from_stock_qty = v_secondary_quantity where id = p_id;
  elsif p_table = 'request_components' then
    update public.request_components set reserved_from_stock = v_quantity where id = p_id;
  elsif p_table = 'request_paint' then
    update public.request_paint set reserved_from_stock_kg = v_quantity where id = p_id;
  elsif p_table = 'request_mesh' then
    update public.request_mesh set reserved_from_stock_qty = v_quantity where id = p_id;
  elsif p_table = 'request_chain_cord' then
    update public.request_chain_cord set reserved_from_stock_meters = v_quantity / 1000 where id = p_id;
  else
    raise exception 'Некорректная таблица позиции: %', p_table;
  end if;
end;
$$;

do $$
declare v_row record;
begin
  for v_row in
    select sheet.id from public.request_sheet_metal sheet
    join public.technologist_requests request on request.id = sheet.request_id
    where request.status in ('draft', 'pending_stock_check', 'stock_checked',
      'pending_financial_approval', 'submitted_to_supply')
      and sheet.order_status is distinct from 'cancelled'
      and exists (
        select 1 from public.inventory_reservations reservation
        where reservation.request_item_table = 'request_sheet_metal'
          and reservation.request_item_id = sheet.id
      )
  loop
    perform public.fn_set_request_reserved_quantity('request_sheet_metal', v_row.id);
  end loop;
end;
$$;
