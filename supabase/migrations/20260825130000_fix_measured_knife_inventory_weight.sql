-- Migration 83 hardened pipe geometry but accidentally restored the legacy
-- knife formula. A measured knife inventory row already stores total length in
-- millimetres, so multiplying it by standard_length_mm inflates the weight.

create or replace function public.calc_inventory_weight_kg(
  p_material_id uuid,
  p_material_variant_id uuid,
  p_total_quantity numeric,
  p_unit text,
  p_piece_length_mm numeric,
  p_total_secondary_quantity numeric default null
)
returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  v_category public.material_category;
  v_variant public.material_variants%rowtype;
  v_density numeric;
  v_dims numeric[];
  v_a numeric;
  v_b numeric;
  v_cross_section numeric;
  v_total_length numeric;
begin
  if p_total_quantity is null then
    return null;
  end if;

  if lower(coalesce(p_unit, '')) in ('кг', 'kg') then
    return round(p_total_quantity::numeric, 2);
  end if;

  select category into v_category
  from public.materials
  where id = p_material_id;

  if p_material_variant_id is null then
    return null;
  end if;

  select * into v_variant
  from public.material_variants
  where id = p_material_variant_id;

  if v_variant.id is null then
    return null;
  end if;

  if v_variant.steel_type_id is not null then
    select density_kg_mm3 into v_density
    from public.steel_types
    where id = v_variant.steel_type_id;
  end if;

  if v_density is null and v_variant.material_grade is not null then
    select density_kg_mm3 into v_density
    from public.steel_types
    where lower(name) = lower(trim(v_variant.material_grade))
    limit 1;
  end if;

  if v_category = 'sheet_metal' then
    if v_density is null or v_variant.sheet_size is null or v_variant.thickness_mm is null then
      return null;
    end if;

    v_dims := public.parse_size_dimensions(v_variant.sheet_size);
    if v_dims is null then
      return null;
    end if;

    return round((v_dims[1] * v_dims[2] * v_variant.thickness_mm
      * v_density * p_total_quantity)::numeric, 2);
  end if;

  if v_category = 'circle' then
    if v_density is null or v_variant.diameter_mm is null then
      return null;
    end if;

    return round((pi() * power(v_variant.diameter_mm / 2, 2)
      * p_total_quantity * v_density)::numeric, 2);
  end if;

  if v_category = 'pipe' then
    if v_variant.pipe_type = 'wire' then
      return round(p_total_quantity::numeric, 2);
    end if;

    if v_density is null or v_variant.wall_thickness_mm is null
       or v_variant.wall_thickness_mm <= 0 then
      return null;
    end if;

    v_total_length := coalesce(
      p_piece_length_mm * nullif(p_total_secondary_quantity, 0),
      p_total_quantity
    );

    if v_variant.pipe_type = 'round' then
      if v_variant.diameter_mm is null
         or v_variant.wall_thickness_mm * 2 >= v_variant.diameter_mm then
        return null;
      end if;

      v_cross_section := pi() * (
        power(v_variant.diameter_mm / 2, 2)
        - power((v_variant.diameter_mm - 2 * v_variant.wall_thickness_mm) / 2, 2)
      );
    else
      v_dims := public.parse_size_dimensions(v_variant.piece_description);
      if v_dims is null then
        return null;
      end if;

      v_a := v_dims[1];
      v_b := case when v_variant.pipe_type = 'square' then v_dims[1] else v_dims[2] end;
      if v_variant.wall_thickness_mm * 2 >= least(v_a, v_b) then
        return null;
      end if;
      v_cross_section := (v_a * v_b)
        - ((v_a - 2 * v_variant.wall_thickness_mm)
          * (v_b - 2 * v_variant.wall_thickness_mm));
    end if;

    if v_cross_section is null or v_cross_section <= 0 then
      return null;
    end if;

    return round((v_cross_section * v_total_length * v_density)::numeric, 2);
  end if;

  if v_category = 'knives' then
    v_total_length := coalesce(
      p_piece_length_mm * nullif(p_total_secondary_quantity, 0),
      case
        when lower(coalesce(p_unit, '')) in ('м', 'm') then p_total_quantity * 1000
        else p_total_quantity
      end
    );

    if v_variant.weight_per_m_kg is not null and v_variant.weight_per_m_kg > 0 then
      return round((v_total_length * v_variant.weight_per_m_kg / 1000)::numeric, 2);
    end if;

    if v_density is null or v_variant.width_mm is null or v_variant.height_mm is null then
      return null;
    end if;

    return round((v_total_length * v_variant.width_mm * v_variant.height_mm
      * v_density)::numeric, 2);
  end if;

  if v_variant.unit_weight_kg is not null then
    return round((v_variant.unit_weight_kg * p_total_quantity)::numeric, 2);
  end if;

  return null;
end;
$$;

create table if not exists public._migration_backup_inventory_weights_20260825 (
  inventory_id uuid primary key,
  original_calculated_weight_kg numeric,
  captured_at timestamptz not null
);

revoke all on table public._migration_backup_inventory_weights_20260825
  from public, anon, authenticated;
grant select on table public._migration_backup_inventory_weights_20260825
  to service_role;

insert into public._migration_backup_inventory_weights_20260825 (
  inventory_id,
  original_calculated_weight_kg,
  captured_at
)
select inventory_row.id, inventory_row.calculated_weight_kg, statement_timestamp()
from public.inventory inventory_row
join public.materials material on material.id = inventory_row.material_id
where material.category = 'knives'
  and inventory_row.piece_length_mm is not null
  and inventory_row.deleted_at is null
on conflict (inventory_id) do nothing;

do $$
declare
  v_rows bigint;
  v_captured_at timestamptz;
begin
  select count(*), min(captured_at)
  into v_rows, v_captured_at
  from public._migration_backup_inventory_weights_20260825;

  raise notice
    'inventory weight rollback snapshot: table=public._migration_backup_inventory_weights_20260825 rows=% captured_at=%',
    v_rows,
    v_captured_at;
end;
$$;

-- total_quantity is part of trg_inventory_weight's UPDATE OF list, so this
-- recomputes every active measured knife row through the corrected function.
update public.inventory inventory_row
set total_quantity = inventory_row.total_quantity
where inventory_row.piece_length_mm is not null
  and inventory_row.deleted_at is null
  and exists (
    select 1
    from public.materials material
    where material.id = inventory_row.material_id
      and material.category = 'knives'
  );
