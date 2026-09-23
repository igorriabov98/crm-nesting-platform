-- Existing catalog rows may have separate IDs for 100x50 and 50x100.
-- Keep their history and physical inventory IDs, but permit the same profile
-- in the cutting plan's source and reservation integrity checks.
create or replace function public.fn_rotated_pipe_variants_equal_v1(p_left uuid, p_right uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.material_variants%rowtype;
  b public.material_variants%rowtype;
begin
  if p_left is null or p_right is null then return false; end if;
  if p_left = p_right then return true; end if;
  select * into a from public.material_variants where id = p_left;
  if not found then return false; end if;
  select * into b from public.material_variants where id = p_right;
  if not found then return false; end if;
  return a.category = 'pipe' and b.category = 'pipe'
    and a.pipe_type in ('square', 'rectangular')
    and a.pipe_type = b.pipe_type
    and a.material_id = b.material_id
    and a.steel_type_id is not distinct from b.steel_type_id
    and lower(trim(coalesce(a.material_grade, ''))) = lower(trim(coalesce(b.material_grade, '')))
    and a.wall_thickness_mm > 0 and b.wall_thickness_mm > 0
    and a.wall_thickness_mm is not distinct from b.wall_thickness_mm
    and coalesce(a.diameter_mm, 0) = coalesce(b.diameter_mm, 0)
    and public.fn_same_rectangular_dimensions_v1(a.piece_description, b.piece_description);
end;
$$;

revoke all on function public.fn_rotated_pipe_variants_equal_v1(uuid, uuid) from public, anon, authenticated;

-- Patch only the exact variant-ID gates. Other material, subtype, length,
-- factory, state and availability guards inside these functions stay intact.
do $$
declare
  v_patch record;
  v_function regprocedure;
  v_definition text;
begin
  for v_patch in
    select * from (values
      ('public.fn_long_stock_cutting_scrap_link_guard()'::text,
       'v_inventory.material_variant_id is distinct from v_plan_variant_id'::text,
       'not public.fn_rotated_pipe_variants_equal_v1(v_inventory.material_variant_id, v_plan_variant_id)'::text),
      ('public.fn_approve_long_stock_cutting_plan_before_source_selection_v1(uuid,uuid)',
       'v_source.material_variant_id is distinct from v_plan.material_variant_id',
       'not public.fn_rotated_pipe_variants_equal_v1(v_source.material_variant_id, v_plan.material_variant_id)'),
      ('public.fn_reserve_long_stock_selected_sources_v1(uuid,uuid)',
       'v_source.material_variant_id is distinct from v_plan.material_variant_id',
       'not public.fn_rotated_pipe_variants_equal_v1(v_source.material_variant_id, v_plan.material_variant_id)'),
      ('public.fn_reserve_long_stock_plan_inventory_v1(uuid,uuid,text,uuid,uuid,boolean)',
       'v_anchor.material_variant_id is distinct from v_material_variant_id',
       'not public.fn_rotated_pipe_variants_equal_v1(v_anchor.material_variant_id, v_material_variant_id)'),
      ('public.fn_reserve_long_stock_plan_inventory_v1(uuid,uuid,text,uuid,uuid,boolean)',
       'material_variant_id = v_material_variant_id',
       'public.fn_rotated_pipe_variants_equal_v1(material_variant_id, v_material_variant_id)'),
      ('public.fn_reserve_long_stock_plan_inventory_v1(uuid,uuid,text,uuid,uuid,boolean)',
       'reservation.material_variant_id is not distinct from v_material_variant_id',
       'public.fn_rotated_pipe_variants_equal_v1(reservation.material_variant_id, v_material_variant_id)'),
      ('public.fn_apply_long_stock_cutting_fact_v1(uuid,uuid)',
       'plan_item.material_variant_id is not distinct from event_reservation.material_variant_id',
       'public.fn_rotated_pipe_variants_equal_v1(plan_item.material_variant_id, event_reservation.material_variant_id)')
    ) as patch(signature, old_text, new_text)
  loop
    v_function := to_regprocedure(v_patch.signature);
    if v_function is null then
      raise exception 'Не найдена функция %', v_patch.signature;
    end if;
    v_definition := pg_get_functiondef(v_function);
    if position(v_patch.old_text in v_definition) = 0 then
      raise exception 'Не найден проверяемый фрагмент в %: %', v_patch.signature, v_patch.old_text;
    end if;
    execute replace(v_definition, v_patch.old_text, v_patch.new_text);
  end loop;
end;
$$;
