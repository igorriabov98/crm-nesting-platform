-- A cancelled historical sheet can still have an old reservation. The
-- orientation migration must leave that immutable row alone during backfill.
do $$
declare
  v_actor uuid := '9f000000-0000-4000-8000-000000000001';
  v_machine uuid := '9f000000-0000-4000-8000-000000000002';
  v_request uuid := '9f000000-0000-4000-8000-000000000003';
  v_material uuid := '9f000000-0000-4000-8000-000000000004';
  v_steel uuid := '9f000000-0000-4000-8000-000000000005';
  v_variant uuid := '9f000000-0000-4000-8000-000000000006';
  v_inventory uuid := '9f000000-0000-4000-8000-000000000007';
  v_item uuid := '9f000000-0000-4000-8000-000000000008';
  v_factory uuid;
begin
  select id into strict v_factory from public.factories order by created_at nulls last limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'sheet-orientation-legacy@test.invalid', 'Sheet orientation legacy', 'technologist', v_factory, true);
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'SHEET-ORIENTATION-LEGACY', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by, status)
  values (v_request, v_machine, v_actor, 'draft');
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Sheet orientation legacy', 'sheet_metal', v_actor);
  insert into public.steel_types(id, name, density_kg_mm3)
  values (v_steel, 'SHEET-ORIENTATION-LEGACY', 0.00000785);
  insert into public.material_variants(id, material_id, category, steel_type_id, sheet_size, thickness_mm, default_unit)
  values (v_variant, v_material, 'sheet_metal', v_steel, '1200x300', 20, 'шт');
  insert into public.inventory(id, factory_id, material_id, material_variant_id, total_quantity, unit, last_updated_by)
  values (v_inventory, v_factory, v_material, v_variant, 3, 'шт', v_actor);
  insert into public.request_sheet_metal(
    id, request_id, material_id, material_name, material_variant_id,
    steel_type_id, sheet_size, thickness_mm, remainder_qty
  ) values (v_item, v_request, v_material, 'Sheet orientation legacy', v_variant,
            v_steel, '1200x300', 20, 3);
  insert into public.inventory_reservations(
    inventory_id, material_id, material_variant_id, machine_id,
    request_item_table, request_item_id, reserved_quantity, reserved_by
  ) values (v_inventory, v_material, v_variant, v_machine,
            'request_sheet_metal', v_item, 1, v_actor);
  update public.request_sheet_metal
  set order_status = 'cancelled', reserved_from_stock_kg = 0
  where id = v_item;
end;
$$;
