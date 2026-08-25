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
  -- The bevel constraint was introduced NOT VALID, so production may still
  -- contain legacy knife variants without a bevel. Updating any column on
  -- such a row would re-check that constraint and abort the whole migration.
  -- Leave those rows untouched: the inventory trigger above remains the
  -- authoritative unit boundary for their existing and future stock rows.
  and (
    (category = 'knives' and knife_bevel_count in (1, 2))
    or (category in ('circle', 'pipe') and knife_bevel_count is null)
  )
  and default_unit is distinct from 'мм';

-- Keep a narrow, durable rollback snapshot of every row this data repair will
-- mutate. The table is intentionally service-role-only and records one stable
-- statement timestamp for the operator report.
create table if not exists public._migration_backup_inventory_units_20260825 (
  inventory_id uuid primary key,
  original_unit text not null,
  original_secondary_unit text,
  original_calculated_weight_kg numeric,
  original_updated_at timestamptz,
  captured_at timestamptz not null
);

revoke all on table public._migration_backup_inventory_units_20260825
  from public, anon, authenticated;
grant select on table public._migration_backup_inventory_units_20260825
  to service_role;

insert into public._migration_backup_inventory_units_20260825 (
  inventory_id,
  original_unit,
  original_secondary_unit,
  original_calculated_weight_kg,
  original_updated_at,
  captured_at
)
select
  id,
  unit,
  secondary_unit,
  calculated_weight_kg,
  updated_at,
  statement_timestamp()
from public.inventory
where piece_length_mm is not null
  and (
    unit is distinct from 'мм'
    or secondary_unit is distinct from 'шт'
  )
on conflict (inventory_id) do nothing;

do $$
declare
  v_rows bigint;
  v_captured_at timestamptz;
begin
  select count(*), min(captured_at)
  into v_rows, v_captured_at
  from public._migration_backup_inventory_units_20260825;

  raise notice
    'inventory unit rollback snapshot: table=public._migration_backup_inventory_units_20260825 rows=% captured_at=%',
    v_rows,
    v_captured_at;
end;
$$;

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
