-- A received knife bar stays physically reserved in full until cutting starts.
-- The part not requested by the technologist is represented as future business
-- scrap and becomes available only when the cutting fact consumes the source
-- reservation.

ALTER TABLE public.production_fact_cutting_event_reservations
  ADD COLUMN IF NOT EXISTS consumed_quantity numeric,
  ADD COLUMN IF NOT EXISTS consumed_secondary_quantity numeric,
  ADD COLUMN IF NOT EXISTS business_scrap_inventory_id uuid
    REFERENCES public.inventory(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS business_scrap_quantity numeric,
  ADD COLUMN IF NOT EXISTS business_scrap_secondary_quantity numeric;

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_stages_machine_stage_unique
  ON public.production_stages(machine_id, stage_type);

CREATE OR REPLACE FUNCTION public.fn_prepare_supply_knife_future_scrap(
  p_reservation_id uuid,
  p_performed_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_source public.inventory%ROWTYPE;
  v_stage public.production_stages%ROWTYPE;
  v_logical_quantity numeric;
  v_scrap_quantity numeric;
  v_scrap_inventory_id uuid;
BEGIN
  SELECT *
  INTO v_reservation
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Бронь принятого ножа не найдена';
  END IF;

  IF v_reservation.reservation_source IS DISTINCT FROM 'supply_receipt'
    OR v_reservation.request_item_table IS DISTINCT FROM 'request_knives'
    OR v_reservation.supply_order_schedule_id IS NULL
    OR v_reservation.consumed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_reservation.business_scrap_inventory_id IS NOT NULL THEN
    RETURN v_reservation.business_scrap_inventory_id;
  END IF;

  SELECT *
  INTO v_schedule
  FROM public.supply_order_delivery_schedules
  WHERE id = v_reservation.supply_order_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'График принятой поставки ножа не найден';
  END IF;

  SELECT *
  INTO v_source
  FROM public.inventory
  WHERE id = v_reservation.inventory_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Складская строка принятого ножа не найдена';
  END IF;

  v_logical_quantity := LEAST(
    v_reservation.reserved_quantity,
    COALESCE(
      v_schedule.allocated_quantity,
      v_schedule.received_quantity,
      v_schedule.quantity,
      v_reservation.reserved_quantity
    )
  );
  v_scrap_quantity := v_reservation.reserved_quantity - v_logical_quantity;

  IF v_scrap_quantity <= 0.000001 THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_reservation.original_piece_length_mm, 0) <= 0 THEN
    RAISE EXCEPTION 'Для принятого ножа не указана длина исходного бруска';
  END IF;

  IF v_scrap_quantity >= v_reservation.original_piece_length_mm - 0.000001 THEN
    RAISE EXCEPTION 'Остаток ножа должен быть меньше длины исходного бруска';
  END IF;

  SELECT *
  INTO v_stage
  FROM public.production_stages
  WHERE machine_id = v_reservation.machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.production_stages AS existing (
      machine_id,
      stage_type,
      workshop,
      updated_by
    )
    VALUES (
      v_reservation.machine_id,
      'cutting'::public.stage_type,
      1,
      p_performed_by
    )
    ON CONFLICT (machine_id, stage_type) DO UPDATE
    SET updated_by = COALESCE(existing.updated_by, EXCLUDED.updated_by)
    RETURNING * INTO v_stage;
  END IF;

  INSERT INTO public.inventory (
    factory_id,
    material_id,
    material_variant_id,
    piece_length_mm,
    total_quantity,
    reserved_quantity,
    unit,
    total_secondary_quantity,
    reserved_secondary_quantity,
    secondary_unit,
    is_business_scrap,
    business_scrap_state,
    available_from_date,
    available_from_stage_id,
    source_inventory_id,
    source_reservation_id,
    source_machine_id,
    source_piece_length_mm,
    last_updated_by
  )
  VALUES (
    v_source.factory_id,
    v_reservation.material_id,
    v_reservation.material_variant_id,
    v_scrap_quantity,
    v_scrap_quantity,
    0,
    v_source.unit,
    1,
    0,
    COALESCE(v_source.secondary_unit, 'шт'),
    true,
    'future',
    v_stage.date_start,
    v_stage.id,
    v_source.id,
    v_reservation.id,
    v_reservation.machine_id,
    v_reservation.original_piece_length_mm,
    p_performed_by
  )
  RETURNING id INTO v_scrap_inventory_id;

  UPDATE public.inventory_reservations
  SET source_inventory_id = COALESCE(source_inventory_id, v_source.id),
      business_scrap_inventory_id = v_scrap_inventory_id,
      business_scrap_quantity = v_scrap_quantity
  WHERE id = v_reservation.id;

  RETURN v_scrap_inventory_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_prepare_supply_knife_future_scrap(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prepare_supply_knife_future_scrap(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_prepare_supply_knife_future_scrap(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_prepare_supply_knife_future_scrap_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.fn_prepare_supply_knife_future_scrap(NEW.id, NEW.reserved_by);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_prepare_supply_knife_future_scrap_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_prepare_supply_knife_future_scrap_trigger() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_prepare_supply_knife_future_scrap
  ON public.inventory_reservations;

CREATE TRIGGER trg_prepare_supply_knife_future_scrap
AFTER INSERT ON public.inventory_reservations
FOR EACH ROW
WHEN (
  NEW.reservation_source = 'supply_receipt'
  AND NEW.request_item_table = 'request_knives'
  AND NEW.supply_order_schedule_id IS NOT NULL
)
EXECUTE FUNCTION public.fn_prepare_supply_knife_future_scrap_trigger();

CREATE OR REPLACE FUNCTION public.fn_promote_due_future_business_scrap(
  p_today date DEFAULT current_date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH promoted AS (
    UPDATE public.inventory AS inventory
    SET business_scrap_state = 'available',
        updated_at = now()
    FROM public.production_stages AS stage
    WHERE inventory.is_business_scrap = true
      AND inventory.business_scrap_state = 'future'
      AND inventory.deleted_at IS NULL
      AND inventory.available_from_stage_id = stage.id
      AND stage.stage_type = 'cutting'::public.stage_type
      AND stage.date_start IS NOT NULL
      AND stage.date_start <= p_today
      AND (
        inventory.source_reservation_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.inventory_reservations AS reservation
          WHERE reservation.id = inventory.source_reservation_id
            AND reservation.consumed_at IS NOT NULL
        )
      )
    RETURNING inventory.id
  )
  SELECT count(*) INTO v_count FROM promoted;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_promote_due_future_business_scrap(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_promote_due_future_business_scrap(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_promote_due_future_business_scrap(date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_apply_production_fact_cutting(
  p_fact_id uuid,
  p_performed_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fact record;
  v_effective_stage public.stage_type;
  v_stage public.production_stages%ROWTYPE;
  v_event_id uuid;
  v_existing_event_status text;
  v_applied_stage_date date;
  v_reservation_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT fact.*, machine.factory_id AS machine_factory_id
  INTO v_fact
  FROM public.production_machine_facts AS fact
  JOIN public.machines AS machine ON machine.id = fact.machine_id
  WHERE fact.id = p_fact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Факт производства не найден';
  END IF;

  SELECT COALESCE(section.production_stage_type, parent.production_stage_type)
  INTO v_effective_stage
  FROM public.production_fact_sections AS section
  LEFT JOIN public.production_fact_sections AS parent ON parent.id = section.parent_id
  WHERE section.id = v_fact.section_id;

  IF v_effective_stage IS DISTINCT FROM 'cutting'::public.stage_type THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_stage
  FROM public.production_stages
  WHERE machine_id = v_fact.machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.production_stages AS existing (machine_id, stage_type, workshop, updated_by)
    VALUES (v_fact.machine_id, 'cutting'::public.stage_type, 1, p_performed_by)
    ON CONFLICT (machine_id, stage_type) DO UPDATE
    SET updated_by = COALESCE(existing.updated_by, EXCLUDED.updated_by)
    RETURNING * INTO v_stage;
  END IF;

  SELECT id, status
  INTO v_event_id, v_existing_event_status
  FROM public.production_fact_cutting_events
  WHERE fact_id = p_fact_id
  LIMIT 1;

  IF v_event_id IS NULL THEN
    v_applied_stage_date := COALESCE(v_stage.date_start, v_fact.fact_date);

    INSERT INTO public.production_fact_cutting_events (
      machine_id,
      factory_id,
      fact_id,
      section_id,
      fact_date,
      stage_id,
      previous_stage_date_start,
      applied_stage_date_start,
      created_by
    )
    VALUES (
      v_fact.machine_id,
      v_fact.machine_factory_id,
      v_fact.id,
      v_fact.section_id,
      v_fact.fact_date,
      v_stage.id,
      v_stage.date_start,
      v_applied_stage_date,
      p_performed_by
    )
    RETURNING id INTO v_event_id;

    IF v_stage.date_start IS NULL THEN
      UPDATE public.production_stages
      SET date_start = v_fact.fact_date,
          updated_by = p_performed_by
      WHERE id = v_stage.id;
    END IF;
  ELSIF v_existing_event_status IS DISTINCT FROM 'applied' THEN
    RETURN v_event_id;
  END IF;

  PERFORM public.fn_reserve_delivered_supply_for_cutting(v_fact.machine_id, p_performed_by);

  SELECT COALESCE(array_agg(reservation.id ORDER BY reservation.created_at, reservation.id), ARRAY[]::uuid[])
  INTO v_reservation_ids
  FROM public.inventory_reservations AS reservation
  WHERE reservation.machine_id = v_fact.machine_id
    AND reservation.consumed_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.production_fact_cutting_event_reservations AS event_reservation
      WHERE event_reservation.event_id = v_event_id
        AND event_reservation.reservation_id = reservation.id
    );

  IF COALESCE(array_length(v_reservation_ids, 1), 0) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM public.inventory_reservations AS reservation
      LEFT JOIN public.inventory AS scrap
        ON scrap.id = reservation.business_scrap_inventory_id
      WHERE reservation.id = ANY(v_reservation_ids)
        AND reservation.reservation_source = 'supply_receipt'
        AND reservation.request_item_table = 'request_knives'
        AND COALESCE(reservation.is_cut_reservation, false) = false
        AND COALESCE(reservation.business_scrap_quantity, 0) > 0
        AND (
          scrap.id IS NULL
          OR scrap.deleted_at IS NOT NULL
          OR scrap.business_scrap_state IS DISTINCT FROM 'future'
        )
    ) THEN
      RAISE EXCEPTION 'Будущий деловой отход принятого ножа поврежден или уже доступен';
    END IF;

    INSERT INTO public.production_fact_cutting_event_reservations (
      event_id,
      reservation_id,
      inventory_id,
      material_id,
      material_variant_id,
      request_item_table,
      request_item_id,
      reserved_quantity,
      reserved_secondary_quantity,
      is_cut_reservation,
      consumed_quantity,
      consumed_secondary_quantity,
      business_scrap_inventory_id,
      business_scrap_quantity,
      business_scrap_secondary_quantity
    )
    SELECT
      v_event_id,
      reservation.id,
      reservation.inventory_id,
      reservation.material_id,
      reservation.material_variant_id,
      reservation.request_item_table,
      reservation.request_item_id,
      reservation.reserved_quantity,
      reservation.reserved_secondary_quantity,
      COALESCE(reservation.is_cut_reservation, false),
      CASE
        WHEN reservation.reservation_source = 'supply_receipt'
          AND reservation.request_item_table = 'request_knives'
          AND COALESCE(reservation.is_cut_reservation, false) = false
          AND COALESCE(reservation.business_scrap_quantity, 0) > 0
          THEN reservation.reserved_quantity - reservation.business_scrap_quantity
        ELSE reservation.reserved_quantity
      END,
      CASE
        WHEN reservation.reservation_source = 'supply_receipt'
          AND reservation.request_item_table = 'request_knives'
          AND COALESCE(reservation.is_cut_reservation, false) = false
          AND COALESCE(reservation.business_scrap_quantity, 0) > 0 THEN
          NULLIF(
            GREATEST(
              COALESCE(reservation.reserved_secondary_quantity, 0)
                - COALESCE(scrap.total_secondary_quantity, 0),
              0
            ),
            0
          )
        ELSE reservation.reserved_secondary_quantity
      END,
      reservation.business_scrap_inventory_id,
      reservation.business_scrap_quantity,
      scrap.total_secondary_quantity
    FROM public.inventory_reservations AS reservation
    LEFT JOIN public.inventory AS scrap ON scrap.id = reservation.business_scrap_inventory_id
    WHERE reservation.id = ANY(v_reservation_ids);

    WITH normal_reservations AS (
      SELECT
        reservation.inventory_id,
        sum(reservation.reserved_quantity) AS reserved_quantity,
        sum(COALESCE(reservation.reserved_secondary_quantity, 0)) AS reserved_secondary_quantity
      FROM public.inventory_reservations AS reservation
      WHERE reservation.id = ANY(v_reservation_ids)
        AND COALESCE(reservation.is_cut_reservation, false) = false
      GROUP BY reservation.inventory_id
    )
    UPDATE public.inventory AS inventory
    SET total_quantity = GREATEST(inventory.total_quantity - normal.reserved_quantity, 0),
        reserved_quantity = GREATEST(inventory.reserved_quantity - normal.reserved_quantity, 0),
        total_secondary_quantity = CASE
          WHEN inventory.total_secondary_quantity IS NULL THEN NULL
          ELSE GREATEST(COALESCE(inventory.total_secondary_quantity, 0) - normal.reserved_secondary_quantity, 0)
        END,
        reserved_secondary_quantity = CASE
          WHEN inventory.reserved_secondary_quantity IS NULL AND normal.reserved_secondary_quantity = 0
            THEN inventory.reserved_secondary_quantity
          ELSE GREATEST(COALESCE(inventory.reserved_secondary_quantity, 0) - normal.reserved_secondary_quantity, 0)
        END,
        last_updated_by = p_performed_by,
        updated_at = now()
    FROM normal_reservations AS normal
    WHERE inventory.id = normal.inventory_id;

    INSERT INTO public.inventory_transactions (
      factory_id,
      inventory_id,
      material_id,
      material_variant_id,
      transaction_type,
      quantity,
      secondary_quantity,
      machine_id,
      request_item_table,
      request_item_id,
      performed_by,
      comment
    )
    SELECT
      inventory.factory_id,
      event_reservation.inventory_id,
      event_reservation.material_id,
      event_reservation.material_variant_id,
      'write_off'::public.inventory_transaction_type,
      -COALESCE(event_reservation.consumed_quantity, event_reservation.reserved_quantity),
      CASE
        WHEN event_reservation.consumed_secondary_quantity IS NULL THEN NULL
        ELSE -event_reservation.consumed_secondary_quantity
      END,
      v_fact.machine_id,
      event_reservation.request_item_table,
      event_reservation.request_item_id,
      p_performed_by,
      'Автоматическое списание потребности по факту заготовки'
    FROM public.production_fact_cutting_event_reservations AS event_reservation
    JOIN public.inventory AS inventory ON inventory.id = event_reservation.inventory_id
    WHERE event_reservation.event_id = v_event_id
      AND event_reservation.reservation_id = ANY(v_reservation_ids)
      AND event_reservation.is_cut_reservation = false
      AND COALESCE(event_reservation.consumed_quantity, event_reservation.reserved_quantity) > 0;

    INSERT INTO public.inventory_transactions (
      factory_id,
      inventory_id,
      material_id,
      material_variant_id,
      transaction_type,
      quantity,
      secondary_quantity,
      machine_id,
      request_item_table,
      request_item_id,
      performed_by,
      comment
    )
    SELECT
      source.factory_id,
      event_reservation.inventory_id,
      event_reservation.material_id,
      event_reservation.material_variant_id,
      'adjustment'::public.inventory_transaction_type,
      -event_reservation.business_scrap_quantity,
      CASE
        WHEN event_reservation.business_scrap_secondary_quantity IS NULL THEN NULL
        ELSE -event_reservation.business_scrap_secondary_quantity
      END,
      v_fact.machine_id,
      event_reservation.request_item_table,
      event_reservation.request_item_id,
      p_performed_by,
      'Передача остатка принятого бруска в деловой отход'
    FROM public.production_fact_cutting_event_reservations AS event_reservation
    JOIN public.inventory AS source ON source.id = event_reservation.inventory_id
    WHERE event_reservation.event_id = v_event_id
      AND event_reservation.reservation_id = ANY(v_reservation_ids)
      AND event_reservation.is_cut_reservation = false
      AND event_reservation.business_scrap_inventory_id IS NOT NULL
      AND COALESCE(event_reservation.business_scrap_quantity, 0) > 0
    UNION ALL
    SELECT
      scrap.factory_id,
      event_reservation.business_scrap_inventory_id,
      event_reservation.material_id,
      event_reservation.material_variant_id,
      'adjustment'::public.inventory_transaction_type,
      event_reservation.business_scrap_quantity,
      event_reservation.business_scrap_secondary_quantity,
      v_fact.machine_id,
      event_reservation.request_item_table,
      event_reservation.request_item_id,
      p_performed_by,
      'Будущий остаток принятого бруска стал деловым отходом'
    FROM public.production_fact_cutting_event_reservations AS event_reservation
    JOIN public.inventory AS scrap ON scrap.id = event_reservation.business_scrap_inventory_id
    WHERE event_reservation.event_id = v_event_id
      AND event_reservation.reservation_id = ANY(v_reservation_ids)
      AND event_reservation.is_cut_reservation = false
      AND event_reservation.business_scrap_inventory_id IS NOT NULL
      AND COALESCE(event_reservation.business_scrap_quantity, 0) > 0;

    UPDATE public.inventory_reservations AS reservation
    SET consumed_at = now(),
        consumed_by = p_performed_by,
        consumed_cutting_event_id = v_event_id
    WHERE reservation.id = ANY(v_reservation_ids)
      AND reservation.consumed_at IS NULL;

    PERFORM public.fn_set_request_reserved_quantity(
      event_reservation.request_item_table,
      event_reservation.request_item_id
    )
    FROM (
      SELECT DISTINCT request_item_table, request_item_id
      FROM public.production_fact_cutting_event_reservations
      WHERE event_id = v_event_id
        AND reservation_id = ANY(v_reservation_ids)
    ) AS event_reservation;
  END IF;

  INSERT INTO public.production_fact_cutting_event_scrap_promotions (
    event_id,
    inventory_id,
    previous_business_scrap_state
  )
  SELECT
    v_event_id,
    inventory.id,
    inventory.business_scrap_state
  FROM public.inventory AS inventory
  WHERE inventory.is_business_scrap = true
    AND inventory.business_scrap_state = 'future'
    AND inventory.deleted_at IS NULL
    AND inventory.available_from_stage_id = v_stage.id
  ON CONFLICT (event_id, inventory_id) DO NOTHING;

  UPDATE public.inventory AS inventory
  SET business_scrap_state = 'available',
      updated_at = now(),
      last_updated_by = p_performed_by
  FROM public.production_fact_cutting_event_scrap_promotions AS promotion
  WHERE promotion.event_id = v_event_id
    AND promotion.inventory_id = inventory.id
    AND inventory.business_scrap_state = 'future';

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_apply_production_fact_cutting(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_apply_production_fact_cutting(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_apply_production_fact_cutting(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_apply_production_cutting_rollback(
  p_machine_id uuid,
  p_task_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_preview jsonb;
  v_can_rollback boolean;
  v_stage public.production_stages%ROWTYPE;
  v_after_date date;
  v_event_ids uuid[];
  v_restored_reservations integer := 0;
  v_restored_scrap integer := 0;
BEGIN
  v_preview := public.fn_get_production_cutting_rollback_preview(p_machine_id);
  v_can_rollback := COALESCE((v_preview ->> 'canRollback')::boolean, false);

  IF NOT v_can_rollback THEN
    RAISE EXCEPTION 'Откат заблокирован: %', COALESCE(v_preview -> 'blockers', '[]'::jsonb)::text;
  END IF;

  SELECT array_agg(id ORDER BY created_at)
  INTO v_event_ids
  FROM public.production_fact_cutting_events
  WHERE machine_id = p_machine_id
    AND status = 'applied';

  SELECT *
  INTO v_stage
  FROM public.production_stages
  WHERE machine_id = p_machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  SELECT previous_stage_date_start
  INTO v_after_date
  FROM public.production_fact_cutting_events
  WHERE id = v_event_ids[1];

  WITH normal_reservations AS (
    SELECT
      event_reservation.inventory_id,
      sum(event_reservation.reserved_quantity) AS reserved_quantity,
      sum(COALESCE(event_reservation.reserved_secondary_quantity, 0)) AS reserved_secondary_quantity
    FROM public.production_fact_cutting_event_reservations AS event_reservation
    WHERE event_reservation.event_id = ANY(v_event_ids)
      AND event_reservation.is_cut_reservation = false
    GROUP BY event_reservation.inventory_id
  )
  UPDATE public.inventory AS inventory
  SET total_quantity = inventory.total_quantity + normal.reserved_quantity,
      reserved_quantity = inventory.reserved_quantity + normal.reserved_quantity,
      total_secondary_quantity = CASE
        WHEN inventory.total_secondary_quantity IS NULL AND normal.reserved_secondary_quantity = 0
          THEN inventory.total_secondary_quantity
        ELSE COALESCE(inventory.total_secondary_quantity, 0) + normal.reserved_secondary_quantity
      END,
      reserved_secondary_quantity = CASE
        WHEN inventory.reserved_secondary_quantity IS NULL AND normal.reserved_secondary_quantity = 0
          THEN inventory.reserved_secondary_quantity
        ELSE COALESCE(inventory.reserved_secondary_quantity, 0) + normal.reserved_secondary_quantity
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  FROM normal_reservations AS normal
  WHERE inventory.id = normal.inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  SELECT
    inventory.factory_id,
    event_reservation.inventory_id,
    event_reservation.material_id,
    event_reservation.material_variant_id,
    'receipt'::public.inventory_transaction_type,
    COALESCE(event_reservation.consumed_quantity, event_reservation.reserved_quantity),
    event_reservation.consumed_secondary_quantity,
    p_machine_id,
    event_reservation.request_item_table,
    event_reservation.request_item_id,
    p_performed_by,
    'Автоматический откат расхода по факту заготовки'
  FROM public.production_fact_cutting_event_reservations AS event_reservation
  JOIN public.inventory AS inventory ON inventory.id = event_reservation.inventory_id
  WHERE event_reservation.event_id = ANY(v_event_ids)
    AND event_reservation.is_cut_reservation = false;

  INSERT INTO public.inventory_transactions (
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  SELECT
    source.factory_id,
    event_reservation.inventory_id,
    event_reservation.material_id,
    event_reservation.material_variant_id,
    'adjustment'::public.inventory_transaction_type,
    event_reservation.business_scrap_quantity,
    event_reservation.business_scrap_secondary_quantity,
    p_machine_id,
    event_reservation.request_item_table,
    event_reservation.request_item_id,
    p_performed_by,
    'Откат передачи остатка бруска в деловой отход'
  FROM public.production_fact_cutting_event_reservations AS event_reservation
  JOIN public.inventory AS source ON source.id = event_reservation.inventory_id
  WHERE event_reservation.event_id = ANY(v_event_ids)
    AND event_reservation.is_cut_reservation = false
    AND event_reservation.business_scrap_inventory_id IS NOT NULL
    AND COALESCE(event_reservation.business_scrap_quantity, 0) > 0
  UNION ALL
  SELECT
    scrap.factory_id,
    event_reservation.business_scrap_inventory_id,
    event_reservation.material_id,
    event_reservation.material_variant_id,
    'adjustment'::public.inventory_transaction_type,
    -event_reservation.business_scrap_quantity,
    CASE
      WHEN event_reservation.business_scrap_secondary_quantity IS NULL THEN NULL
      ELSE -event_reservation.business_scrap_secondary_quantity
    END,
    p_machine_id,
    event_reservation.request_item_table,
    event_reservation.request_item_id,
    p_performed_by,
    'Возврат делового отхода в будущий остаток при откате'
  FROM public.production_fact_cutting_event_reservations AS event_reservation
  JOIN public.inventory AS scrap ON scrap.id = event_reservation.business_scrap_inventory_id
  WHERE event_reservation.event_id = ANY(v_event_ids)
    AND event_reservation.is_cut_reservation = false
    AND event_reservation.business_scrap_inventory_id IS NOT NULL
    AND COALESCE(event_reservation.business_scrap_quantity, 0) > 0;

  UPDATE public.inventory_reservations AS reservation
  SET consumed_at = NULL,
      consumed_by = NULL,
      consumed_cutting_event_id = NULL
  FROM public.production_fact_cutting_event_reservations AS event_reservation
  WHERE event_reservation.event_id = ANY(v_event_ids)
    AND event_reservation.reservation_id = reservation.id;

  GET DIAGNOSTICS v_restored_reservations = ROW_COUNT;

  PERFORM public.fn_set_request_reserved_quantity(
    event_reservation.request_item_table,
    event_reservation.request_item_id
  )
  FROM (
    SELECT DISTINCT request_item_table, request_item_id
    FROM public.production_fact_cutting_event_reservations
    WHERE event_id = ANY(v_event_ids)
  ) AS event_reservation;

  UPDATE public.inventory AS inventory
  SET business_scrap_state = promotion.previous_business_scrap_state,
      updated_at = now(),
      last_updated_by = p_performed_by
  FROM public.production_fact_cutting_event_scrap_promotions AS promotion
  WHERE promotion.event_id = ANY(v_event_ids)
    AND promotion.inventory_id = inventory.id;

  GET DIAGNOSTICS v_restored_scrap = ROW_COUNT;

  UPDATE public.production_stages
  SET date_start = v_after_date,
      updated_by = p_performed_by
  WHERE id = v_stage.id;

  UPDATE public.production_fact_cutting_events
  SET status = 'rolled_back',
      rolled_back_by = p_performed_by,
      rolled_back_at = now(),
      rollback_comment = p_comment
  WHERE id = ANY(v_event_ids);

  IF p_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET status = 'completed',
        completed_at = now(),
        updated_at = now()
    WHERE id = p_task_id;
  END IF;

  RETURN jsonb_build_object(
    'restoredReservations', v_restored_reservations,
    'restoredScrap', v_restored_scrap,
    'stageDateStart', v_after_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)
  TO authenticated, service_role;

DO $$
DECLARE
  v_reservation record;
BEGIN
  FOR v_reservation IN
    SELECT reservation.id, reservation.reserved_by
    FROM public.inventory_reservations AS reservation
    JOIN public.supply_order_delivery_schedules AS schedule
      ON schedule.id = reservation.supply_order_schedule_id
    WHERE reservation.reservation_source = 'supply_receipt'
      AND reservation.request_item_table = 'request_knives'
      AND reservation.consumed_at IS NULL
      AND reservation.business_scrap_inventory_id IS NULL
      AND reservation.reserved_quantity
        > COALESCE(schedule.allocated_quantity, schedule.received_quantity, schedule.quantity, 0) + 0.000001
    ORDER BY reservation.created_at, reservation.id
  LOOP
    PERFORM public.fn_prepare_supply_knife_future_scrap(
      v_reservation.id,
      v_reservation.reserved_by
    );
  END LOOP;
END;
$$;
