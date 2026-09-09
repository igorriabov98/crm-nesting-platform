\set ON_ERROR_STOP on

begin;

do $$
declare
  v_actor uuid := gen_random_uuid();
  v_factory uuid;
  v_machine uuid := gen_random_uuid();
  v_request uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_steel_type uuid := gen_random_uuid();
  v_other_steel_type uuid := gen_random_uuid();
  v_material uuid := gen_random_uuid();
  v_matching_variant uuid := gen_random_uuid();
  v_mismatching_variant uuid := gen_random_uuid();
  v_matching_inventory uuid := gen_random_uuid();
  v_mismatching_inventory uuid := gen_random_uuid();
  v_error text;
begin
  select id into strict v_factory
  from public.factories
  order by created_at nulls last
  limit 1;

  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (
    v_actor,
    v_actor || '@request-steel-guard.test',
    'Тест защиты типа стали',
    'technologist',
    v_factory,
    true
  );
  insert into public.machines(id, factory_id, name, created_by)
  values (v_machine, v_factory, 'REQUEST-STEEL-TYPE-GUARD', v_actor);
  insert into public.technologist_requests(id, machine_id, created_by, status)
  values (v_request, v_machine, v_actor, 'draft');
  insert into public.materials(id, name, category, created_by)
  values (v_material, 'Лист теста защиты', 'sheet_metal', v_actor);
  insert into public.request_sheet_metal(
    id, request_id, material_id, material_name, sheet_size, thickness_mm, remainder_qty
  ) values (v_item, v_request, v_material, 'Лист', '1200x1200', 30, 3);

  begin
    update public.technologist_requests
    set status = 'pending_stock_check'
    where id = v_request;
    raise exception 'Handoff without a sheet steel type unexpectedly succeeded';
  exception when not_null_violation then
    get stacked diagnostics v_error = message_text;
    if v_error not like 'Нельзя передать заявку:%' then
      raise;
    end if;
  end;

  insert into public.steel_types(id, name, density_kg_mm3)
  values
    (v_steel_type, 'S235-GUARD-TEST', 0.00000785),
    (v_other_steel_type, 'S355-GUARD-TEST', 0.00000785);
  insert into public.material_variants(
    id, material_id, category, steel_type_id, sheet_size, thickness_mm, default_unit
  ) values
    (v_matching_variant, v_material, 'sheet_metal', v_steel_type, '1200 × 1200', 30, 'шт'),
    (v_mismatching_variant, v_material, 'sheet_metal', v_other_steel_type, '1200x1200', 30, 'шт');
  insert into public.inventory(
    id, factory_id, material_id, material_variant_id, total_quantity, unit, last_updated_by
  ) values
    (v_matching_inventory, v_factory, v_material, v_matching_variant, 3, 'шт', v_actor),
    (v_mismatching_inventory, v_factory, v_material, v_mismatching_variant, 3, 'шт', v_actor);
  update public.request_sheet_metal
  set steel_type_id = v_steel_type
  where id = v_item;
  update public.technologist_requests
  set status = 'pending_stock_check'
  where id = v_request;

  begin
    update public.request_sheet_metal
    set steel_type_id = null
    where id = v_item;
    raise exception 'Removing a steel type after handoff unexpectedly succeeded';
  exception when not_null_violation then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'Нельзя удалить тип стали из позиции переданной заявки' then
      raise;
    end if;
  end;

  if (select steel_type_id from public.request_sheet_metal where id = v_item)
     is distinct from v_steel_type then
    raise exception 'The rejected update changed the protected steel type';
  end if;

  begin
    insert into public.inventory_reservations(
      inventory_id, material_id, material_variant_id, machine_id,
      request_item_table, request_item_id, reserved_quantity, reserved_by
    ) values (
      v_mismatching_inventory, v_material, v_mismatching_variant, v_machine,
      'request_sheet_metal', v_item, 1, v_actor
    );
    raise exception 'Mismatching sheet reservation unexpectedly succeeded';
  exception when check_violation then
    get stacked diagnostics v_error = message_text;
    if v_error <> 'Выбранный складской остаток не совпадает с типом стали, размером или толщиной листа' then
      raise;
    end if;
  end;

  insert into public.inventory_reservations(
    inventory_id, material_id, material_variant_id, machine_id,
    request_item_table, request_item_id, reserved_quantity, reserved_by
  ) values (
    v_matching_inventory, v_material, v_matching_variant, v_machine,
    'request_sheet_metal', v_item, 1, v_actor
  );
end;
$$;

rollback;
