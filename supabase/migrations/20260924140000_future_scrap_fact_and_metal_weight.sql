-- A future remnant is produced by the source consumed in this cutting event,
-- never by a stage date or an earlier event for the same machine.
-- The existing request field source_nesting_sheet_id is a grouped material
-- key, whereas inventory stores the actual nesting sheet ID. Persist the IDs
-- on new request rows so one consumed group can be matched without guessing.
ALTER TABLE public.request_sheet_metal
  ADD COLUMN source_nesting_sheet_ids text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX production_cutting_event_sheet_source_idx
  ON public.production_fact_cutting_event_reservations(request_item_id,event_id)
  WHERE request_item_table = 'request_sheet_metal';

DO $migration$
DECLARE
  v_function oid;
  v_definition text;
  v_matches integer;
  v_anchor constant text := 'AND inventory.available_from_stage_id = v_stage.id';
BEGIN
  SELECT count(*) INTO v_matches
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'fn_apply_production_fact_cutting%'
    AND pg_get_functiondef(p.oid) LIKE '%' || v_anchor || '%';
  IF v_matches <> 1 THEN RAISE EXCEPTION 'Expected one cutting promotion function, found %', v_matches; END IF;
  SELECT p.oid, pg_get_functiondef(p.oid)
  INTO v_function, v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname LIKE 'fn_apply_production_fact_cutting%'
    AND pg_get_functiondef(p.oid) LIKE '%' || v_anchor || '%';

  IF v_function IS NULL OR length(v_definition) - length(replace(v_definition, v_anchor, '')) <> length(v_anchor) THEN
    RAISE EXCEPTION 'Unexpected cutting fact promotion function definition';
  END IF;

  EXECUTE replace(v_definition, v_anchor, v_anchor || $guard$
    AND NOT EXISTS (
      SELECT 1 FROM public.long_stock_cutting_business_scraps plan_scrap
      WHERE plan_scrap.inventory_id = inventory.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.technologist_sheet_scrap_plans sheet_plan
      WHERE sheet_plan.inventory_id = inventory.id
    )
    AND EXISTS (
      SELECT 1 FROM public.materials material
      LEFT JOIN public.material_variants variant ON variant.id = inventory.material_variant_id
      WHERE material.id = inventory.material_id
        AND variant.material_id = material.id
        AND variant.category = material.category
        AND (
          material.category IN ('sheet_metal','circle','knives')
          OR (material.category = 'pipe' AND variant.pipe_type <> 'wire')
        )
    )
    AND EXISTS (
      SELECT 1 FROM public.production_fact_cutting_event_reservations source
      JOIN public.inventory_reservations reservation ON reservation.id = source.reservation_id
      WHERE source.event_id = v_event_id
        AND reservation.consumed_cutting_event_id = v_event_id
        AND reservation.reservation_source IN ('stock','supply_receipt','whole_bar_stock')
        AND COALESCE(source.consumed_quantity, source.reserved_quantity, 0) > 0
        AND (
          (source.reservation_id = inventory.source_reservation_id
            AND source.material_id = inventory.material_id)
          OR (source.business_scrap_inventory_id = inventory.id
            AND source.material_id = inventory.material_id)
          OR (
            inventory.source_nesting_project_id IS NOT NULL
            AND inventory.source_nesting_sheet_id IS NOT NULL
            AND source.request_item_table = 'request_sheet_metal'
            AND EXISTS (
              SELECT 1 FROM public.request_sheet_metal sheet
              WHERE sheet.id = source.request_item_id
                AND sheet.source_nesting_project_id = inventory.source_nesting_project_id
                AND array_position(sheet.source_nesting_sheet_ids, inventory.source_nesting_sheet_id)
                  -- The fact stores a sheet count, not individual sheet IDs.
                  -- Release that many sheets in the stable nesting-result order.
                  <= floor((
                    SELECT COALESCE(sum(COALESCE(prior.consumed_quantity, prior.reserved_quantity)), 0)
                    FROM public.production_fact_cutting_event_reservations prior
                    JOIN public.production_fact_cutting_events prior_event ON prior_event.id = prior.event_id
                    JOIN public.inventory_reservations prior_reservation ON prior_reservation.id = prior.reservation_id
                    WHERE prior.request_item_table = 'request_sheet_metal'
                      AND prior.request_item_id = sheet.id
                      AND prior_event.status IN ('applied','kept')
                      AND prior_event.created_at >= inventory.created_at
                      AND prior_event.created_at <= (
                        SELECT current_event.created_at FROM public.production_fact_cutting_events current_event
                        WHERE current_event.id = v_event_id
                      )
                      AND prior_reservation.consumed_cutting_event_id = prior_event.id
                      AND prior_reservation.reservation_source IN ('stock','supply_receipt')
                  ))
            )
          )
        )
    )$guard$);
END;
$migration$;

-- Finishing a request may occur after an earlier machine cutting fact. Such a
-- fact cannot produce a remnant declared by the newly finished request.
DO $migration$
DECLARE
  v_definition text;
  v_old constant text := $fragment$
  select id into v_existing_event from public.production_fact_cutting_events
  where machine_id=v_request.machine_id and status in ('applied','kept')
  order by created_at,id limit 1;
  if v_existing_event is not null then
    perform public.fn_promote_sheet_scrap_for_cutting_event_v1(v_existing_event,null);
  end if;$fragment$;
BEGIN
  v_definition := pg_get_functiondef('public.fn_finalize_technologist_request(uuid,uuid,text,integer,jsonb,jsonb)'::regprocedure);
  IF position(v_old IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected technologist completion fact lookup';
  END IF;
  EXECUTE replace(v_definition, v_old, '');
END;
$migration$;

-- The sheet event trigger runs when the event is inserted, before its consumed
-- reservation snapshots exist. Promotion therefore belongs after the fact RPC.
CREATE OR REPLACE FUNCTION public.fn_sheet_scrap_on_cutting_event_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF tg_op = 'UPDATE' AND new.status = 'rolled_back' AND old.status IN ('applied','kept') THEN
    UPDATE public.technologist_sheet_scrap_plans SET promoted_event_id = NULL
    WHERE promoted_event_id = new.id;
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_sheet_scrap_on_cutting_event_v1() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_promote_sheet_scrap_for_cutting_event_v1(
  p_event_id uuid, p_plan_id uuid DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_event public.production_fact_cutting_events%rowtype;
  v_plan public.technologist_sheet_scrap_plans%rowtype;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_event FROM public.production_fact_cutting_events
  WHERE id = p_event_id AND status IN ('applied','kept') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Подтверждённый факт заготовки не найден'; END IF;

  FOR v_plan IN
    SELECT plan.* FROM public.technologist_sheet_scrap_plans plan
    JOIN public.technologist_request_completions completion ON completion.id = plan.completion_id
    WHERE completion.machine_id = v_event.machine_id
      AND plan.promoted_event_id IS NULL
      AND plan.created_at <= v_event.created_at
      AND (p_plan_id IS NULL OR plan.id = p_plan_id)
      AND EXISTS (
        SELECT 1 FROM public.production_fact_cutting_event_reservations source
        JOIN public.inventory_reservations reservation ON reservation.id = source.reservation_id
        WHERE source.event_id = v_event.id
          AND source.request_item_table = 'request_sheet_metal'
          AND source.request_item_id = plan.source_item_id
          AND COALESCE(source.consumed_quantity, source.reserved_quantity, 0) > 0
          AND reservation.consumed_cutting_event_id = v_event.id
          AND reservation.reservation_source IN ('stock','supply_receipt')
      )
    ORDER BY plan.created_at, plan.id FOR UPDATE OF plan
  LOOP
    INSERT INTO public.production_fact_cutting_event_scrap_promotions(
      event_id, inventory_id, previous_business_scrap_state
    ) VALUES (v_event.id, v_plan.inventory_id, 'future') ON CONFLICT DO NOTHING;
    UPDATE public.inventory SET business_scrap_state = 'available', updated_at = now(),
      last_updated_by = COALESCE(v_event.created_by, last_updated_by)
    WHERE id = v_plan.inventory_id AND business_scrap_state = 'future' AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Будущий листовой остаток уже изменён или недоступен'; END IF;
    UPDATE public.technologist_sheet_scrap_plans SET promoted_event_id = v_event.id WHERE id = v_plan.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_promote_sheet_scrap_for_cutting_event_v1(uuid,uuid) FROM public, anon, authenticated;

-- Keep all existing locking and long-stock work in the outer RPC. The sheet
-- step is added only after those functions have saved the source snapshots.
CREATE OR REPLACE FUNCTION public.fn_apply_production_fact_cutting(
  p_fact_id uuid, p_performed_by uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_machine_id uuid;
  v_effective_stage public.stage_type;
  v_event_id uuid;
BEGIN
  SELECT fact.machine_id, COALESCE(section.production_stage_type, parent.production_stage_type)
  INTO v_machine_id, v_effective_stage
  FROM public.production_machine_facts fact
  JOIN public.production_fact_sections section ON section.id = fact.section_id
  LEFT JOIN public.production_fact_sections parent ON parent.id = section.parent_id
  WHERE fact.id = p_fact_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Факт производства не найден'; END IF;

  IF v_effective_stage = 'cutting'::public.stage_type THEN
    PERFORM public.fn_try_lock_production_cutting_machine_v1(v_machine_id);
    PERFORM public.fn_lock_long_stock_cutting_plans_for_machine_v1(v_machine_id);
  END IF;

  v_event_id := public.fn_apply_production_fact_cutting_before_race_serialization(p_fact_id, p_performed_by);
  IF v_event_id IS NOT NULL AND v_effective_stage = 'cutting'::public.stage_type THEN
    PERFORM public.fn_promote_sheet_scrap_for_cutting_event_v1(v_event_id, NULL);
  END IF;
  RETURN v_event_id;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_apply_production_fact_cutting(uuid,uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_production_fact_cutting(uuid,uuid) TO service_role;

-- Opening the warehouse must not turn an uncut plan into available stock.
CREATE OR REPLACE FUNCTION public.fn_promote_due_future_business_scrap(p_today date DEFAULT current_date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_promote_due_future_business_scrap(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_promote_due_future_business_scrap(date) TO service_role;
-- Convert using the locked row's own mass. Length and weight-per-metre are
-- neither required nor used to create the metal-scrap lot.
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
    if coalesce(v_inventory.calculated_weight_kg, 0) <= 0 then
      raise exception 'У делового остатка % не рассчитан вес позиции', v_inventory.id;
    end if;
    v_piece_count := coalesce(v_inventory.total_secondary_quantity, 1);
    if v_piece_count <= 0 or v_piece_count <> trunc(v_piece_count) then
      raise exception 'У делового остатка % некорректное количество кусков', v_inventory.id;
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
    v_weight_kg := round(v_inventory.calculated_weight_kg, 3);
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
