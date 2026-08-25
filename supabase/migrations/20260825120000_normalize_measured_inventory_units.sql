-- A measured stock row stores logical length in millimetres and physical
-- quantity in pieces. Keep that invariant at the inventory boundary so every
-- legitimate mutation path (receipt, cutting plan, transfer, correction) gets
-- the same units even when a legacy material variant has default_unit = 'шт'.

create or replace function public.trg_normalize_measured_inventory_units()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.piece_length_mm is not null then
    new.unit := 'мм';
    new.secondary_unit := 'шт';
  end if;

  return new;
end;
$$;

revoke all on function public.trg_normalize_measured_inventory_units()
  from public, anon, authenticated;
grant execute on function public.trg_normalize_measured_inventory_units()
  to service_role;

drop trigger if exists trg_inventory_normalize_measured_units on public.inventory;
create trigger trg_inventory_normalize_measured_units
before insert or update of material_id, material_variant_id, piece_length_mm, unit, secondary_unit
on public.inventory
for each row
execute function public.trg_normalize_measured_inventory_units();

-- Long-stock variants use millimetres as their logical unit. Wire remains
-- kilogram-based and has no measured-piece inventory lifecycle.
update public.material_variants
set default_unit = 'мм'
where (
    category in ('knives', 'circle')
    or (category = 'pipe' and pipe_type is distinct from 'wire')
  )
  and default_unit is distinct from 'мм';

-- Repair already-created measured rows. Including unit in the SET list also
-- invokes trg_inventory_weight after this alphabetically earlier normalization
-- trigger, recalculating weights that were multiplied as piece quantities.
update public.inventory
set unit = 'мм',
    secondary_unit = 'шт',
    updated_at = now()
where piece_length_mm is not null
  and (
    unit is distinct from 'мм'
    or secondary_unit is distinct from 'шт'
  );
