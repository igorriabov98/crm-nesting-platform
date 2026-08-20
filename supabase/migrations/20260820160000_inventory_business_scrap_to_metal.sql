-- Manual, irreversible conversion of available business remnants into metal scrap.
-- A batch is processed by one database function and therefore either succeeds
-- completely or is rolled back completely.

alter table public.metal_scrap_lots
  add column if not exists source_type text not null default 'request_completion',
  add column if not exists source_inventory_id uuid references public.inventory(id) on delete restrict;

alter table public.metal_scrap_lots
  alter column request_id drop not null,
  alter column waste_item_id drop not null,
  alter column machine_id drop not null;

alter table public.metal_scrap_lots
  drop constraint if exists metal_scrap_lots_source_type_check,
  drop constraint if exists metal_scrap_lots_source_links_check;

alter table public.metal_scrap_lots
  add constraint metal_scrap_lots_source_type_check
    check (source_type in ('request_completion', 'inventory_conversion')),
  add constraint metal_scrap_lots_source_links_check
    check (
      (
        source_type = 'request_completion'
        and request_id is not null
        and waste_item_id is not null
        and machine_id is not null
        and source_inventory_id is null
      )
      or
      (
        source_type = 'inventory_conversion'
        and request_id is null
        and waste_item_id is null
        and machine_id is null
        and source_inventory_id is not null
      )
    );

create unique index if not exists metal_scrap_lots_source_inventory_unique_idx
  on public.metal_scrap_lots(source_inventory_id)
  where source_inventory_id is not null;

alter table public.metal_scrap_movements
  drop constraint if exists metal_scrap_movements_movement_type_check;

alter table public.metal_scrap_movements
  add constraint metal_scrap_movements_movement_type_check
  check (movement_type in (
    'planned', 'available', 'correction', 'blocked', 'reviewed',
    'sale', 'sale_cancelled', 'inventory_conversion'
  ));

-- The minimum useful length is now a display-only classification. Every
-- positive calculated remainder must still receive its own inventory row.
do $migration$
declare
  v_definition text;
  v_old_condition constant text := 'if v_remainder > 0 and v_remainder >= v_minimum_useful_length then';
begin
  v_definition := pg_get_functiondef(
    'public.fn_approve_long_stock_cutting_plan_version_v1(uuid,uuid)'::regprocedure
  );
  if position(v_old_condition in v_definition) = 0 then
    raise exception 'Не найдено условие порога делового остатка в функции утверждения карты';
  end if;
  execute replace(v_definition, v_old_condition, 'if v_remainder > 0 then');
end;
$migration$;

create or replace function public.fn_convert_business_scrap_to_metal_v1(
  p_inventory_ids uuid[],
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inventory public.inventory%rowtype;
  v_variant public.material_variants%rowtype;
  v_material public.materials%rowtype;
  v_lot_id uuid;
  v_weight_kg numeric;
  v_piece_count numeric;
  v_expected_total_length numeric;
  v_locked_count integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_total_weight_kg numeric := 0;
begin
  if p_actor is null
    or (coalesce(auth.role(), '') <> 'service_role' and p_actor <> auth.uid()) then
    raise exception 'Недостаточно прав';
  end if;
  if p_inventory_ids is null or cardinality(p_inventory_ids) = 0 then
    raise exception 'Выберите хотя бы один деловой остаток';
  end if;
  if array_position(p_inventory_ids, null) is not null then
    raise exception 'Список деловых остатков содержит пустой идентификатор';
  end if;
  if (
    select count(*) from unnest(p_inventory_ids) inventory_id
  ) <> (
    select count(distinct inventory_id) from unnest(p_inventory_ids) inventory_id
  ) then
    raise exception 'Один деловой остаток выбран несколько раз';
  end if;

  -- Lock in a stable order. Validation happens for the full set before the
  -- first write; any later exception still rolls the whole function back.
  for v_inventory in
    select inventory.*
    from public.inventory inventory
    where inventory.id = any(p_inventory_ids)
    order by inventory.id
    for update
  loop
    v_locked_count := v_locked_count + 1;

    if v_inventory.deleted_at is not null then
      raise exception 'Деловой остаток % уже списан', v_inventory.id;
    end if;
    if not v_inventory.is_business_scrap then
      raise exception 'Складская строка % не является деловым остатком', v_inventory.id;
    end if;
    if v_inventory.business_scrap_state is distinct from 'available' then
      raise exception 'Деловой остаток % ещё не доступен', v_inventory.id;
    end if;
    if coalesce(v_inventory.total_quantity, 0) <= 0
      or coalesce(v_inventory.available_quantity, 0) <= 0 then
      raise exception 'Деловой остаток % уже израсходован', v_inventory.id;
    end if;
    if coalesce(v_inventory.reserved_quantity, 0) > 0
      or coalesce(v_inventory.reserved_secondary_quantity, 0) > 0 then
      raise exception 'Деловой остаток % забронирован', v_inventory.id;
    end if;
    if exists (
      select 1
      from public.inventory_reservations reservation
      where reservation.consumed_at is null
        and (
          reservation.inventory_id = v_inventory.id
          or reservation.source_inventory_id = v_inventory.id
          or reservation.business_scrap_inventory_id = v_inventory.id
        )
    ) then
      raise exception 'Деловой остаток % имеет активную бронь', v_inventory.id;
    end if;
    if exists (
      select 1
      from public.metal_scrap_lots lot
      where lot.source_inventory_id = v_inventory.id
    ) then
      raise exception 'Деловой остаток % уже переведён в металлолом', v_inventory.id;
    end if;
    if v_inventory.piece_length_mm is null or v_inventory.piece_length_mm <= 0 then
      raise exception 'У делового остатка % не указана фактическая длина', v_inventory.id;
    end if;
    if v_inventory.material_variant_id is null then
      raise exception 'У делового остатка % не указан вариант материала', v_inventory.id;
    end if;

    select * into v_variant
    from public.material_variants variant
    where variant.id = v_inventory.material_variant_id;
    if not found or v_variant.material_id is distinct from v_inventory.material_id then
      raise exception 'Вариант материала делового остатка % не найден', v_inventory.id;
    end if;
    if v_variant.weight_per_m_kg is null or v_variant.weight_per_m_kg <= 0 then
      raise exception 'Для делового остатка % не настроен вес погонного метра', v_inventory.id;
    end if;

    v_piece_count := coalesce(v_inventory.total_secondary_quantity, 1);
    if v_piece_count <= 0 or v_piece_count <> trunc(v_piece_count) then
      raise exception 'У делового остатка % некорректное количество кусков', v_inventory.id;
    end if;
    v_expected_total_length := v_inventory.piece_length_mm * v_piece_count;
    if abs(v_inventory.total_quantity - v_expected_total_length) > 0.001 then
      raise exception 'Длина делового остатка % не согласована с количеством кусков', v_inventory.id;
    end if;
  end loop;

  if v_locked_count <> cardinality(p_inventory_ids) then
    raise exception 'Один или несколько деловых остатков не найдены';
  end if;

  for v_inventory in
    select inventory.*
    from public.inventory inventory
    where inventory.id = any(p_inventory_ids)
    order by inventory.id
  loop
    select * into v_variant
    from public.material_variants variant
    where variant.id = v_inventory.material_variant_id;
    select * into v_material
    from public.materials material
    where material.id = v_inventory.material_id;

    v_piece_count := coalesce(v_inventory.total_secondary_quantity, 1);
    v_weight_kg := round(
      v_inventory.piece_length_mm * v_piece_count * v_variant.weight_per_m_kg / 1000,
      3
    );
    if v_weight_kg <= 0 then
      raise exception 'Рассчитанный вес делового остатка % должен быть больше нуля', v_inventory.id;
    end if;

    insert into public.metal_scrap_lots(
      source_type, source_inventory_id,
      request_id, waste_item_id, machine_id,
      factory_id, created_by,
      material_id, material_variant_id, material_name, material_grade,
      expected_weight_kg, available_weight_kg, status
    ) values (
      'inventory_conversion', v_inventory.id,
      null, null, null,
      v_inventory.factory_id, p_actor,
      v_inventory.material_id, v_inventory.material_variant_id,
      coalesce(v_material.name, 'Металл'), v_variant.material_grade,
      v_weight_kg, v_weight_kg, 'available'
    ) returning id into v_lot_id;

    insert into public.metal_scrap_movements(
      lot_id, movement_type, weight_delta_kg,
      available_after_kg, blocked_after_kg, sold_after_kg,
      reason, performed_by
    ) values (
      v_lot_id, 'inventory_conversion', v_weight_kg,
      v_weight_kg, 0, 0,
      'Перевод делового остатка со склада', p_actor
    );

    update public.inventory
    set total_quantity = 0,
        total_secondary_quantity = case when secondary_unit is null then null else 0 end,
        reserved_quantity = 0,
        reserved_secondary_quantity = case when secondary_unit is null then null else 0 end,
        deleted_at = now(),
        deleted_by = p_actor,
        delete_comment = 'Переведено в металлолом, лот ' || v_lot_id,
        last_updated_by = p_actor,
        updated_at = now()
    where id = v_inventory.id;

    insert into public.inventory_transactions(
      factory_id, inventory_id, material_id, material_variant_id,
      transaction_type, quantity, secondary_quantity,
      performed_by, comment
    ) values (
      v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
      'write_off', -v_inventory.total_quantity,
      case when v_inventory.secondary_unit is null then null else -v_piece_count end,
      p_actor, 'Перевод делового остатка в металлолом, лот ' || v_lot_id
    );

    v_total_weight_kg := v_total_weight_kg + v_weight_kg;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'inventory_id', v_inventory.id,
      'lot_id', v_lot_id,
      'weight_kg', v_weight_kg
    ));
  end loop;

  return jsonb_build_object(
    'count', cardinality(p_inventory_ids),
    'total_weight_kg', round(v_total_weight_kg, 3),
    'items', v_items
  );
end;
$$;

revoke all on function public.fn_convert_business_scrap_to_metal_v1(uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.fn_convert_business_scrap_to_metal_v1(uuid[], uuid)
  to service_role;

comment on function public.fn_convert_business_scrap_to_metal_v1(uuid[], uuid) is
  'Atomically archives complete available business-remnant inventory rows and creates available metal-scrap lots. There is no reverse operation.';
