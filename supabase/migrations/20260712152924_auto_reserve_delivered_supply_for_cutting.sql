-- Link delivered supply schedules to their machine before cutting consumes stock.
-- A schedule is reserved at most once, so repeating a cutting fact only consumes
-- material received since the previous run.

ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS reservation_source text NOT NULL DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS supply_order_schedule_id uuid
    REFERENCES public.supply_order_delivery_schedules(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_reservations
  DROP CONSTRAINT IF EXISTS inventory_reservations_reservation_source_check;

ALTER TABLE public.inventory_reservations
  ADD CONSTRAINT inventory_reservations_reservation_source_check
  CHECK (reservation_source IN ('stock', 'supply_receipt'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_reservations_supply_schedule
  ON public.inventory_reservations(supply_order_schedule_id)
  WHERE supply_order_schedule_id IS NOT NULL;

-- Reconcile legacy deliveries that were already consumed before schedule-level
-- provenance existed. Exact machine, request item, quantity and order are used
-- so the migration replay cannot write the same physical stock off twice.
WITH request_items AS (
  SELECT 'request_sheet_metal'::text AS request_item_table, id, request_id FROM public.request_sheet_metal
  UNION ALL SELECT 'request_round_tube', id, request_id FROM public.request_round_tube
  UNION ALL SELECT 'request_circle', id, request_id FROM public.request_circle
  UNION ALL SELECT 'request_pipe', id, request_id FROM public.request_pipe
  UNION ALL SELECT 'request_knives', id, request_id FROM public.request_knives
  UNION ALL SELECT 'request_components', id, request_id FROM public.request_components
  UNION ALL SELECT 'request_paint', id, request_id FROM public.request_paint
  UNION ALL SELECT 'request_mesh', id, request_id FROM public.request_mesh
  UNION ALL SELECT 'request_chain_cord', id, request_id FROM public.request_chain_cord
), delivered AS (
  SELECT
    schedule.id AS schedule_id,
    schedule.request_item_table,
    schedule.request_item_id,
    request.machine_id,
    schedule.received_quantity,
    schedule.delivered_at,
    row_number() OVER (
      PARTITION BY request.machine_id, schedule.request_item_table,
        schedule.request_item_id, schedule.received_quantity
      ORDER BY schedule.delivered_at, schedule.created_at, schedule.id
    ) AS match_rank
  FROM public.supply_order_delivery_schedules schedule
  JOIN request_items item
    ON item.request_item_table = schedule.request_item_table
   AND item.id = schedule.request_item_id
  JOIN public.technologist_requests request ON request.id = item.request_id
  WHERE schedule.status = 'delivered'
    AND COALESCE(schedule.received_quantity, 0) > 0
), consumed AS (
  SELECT
    reservation.id AS reservation_id,
    reservation.request_item_table,
    reservation.request_item_id,
    reservation.machine_id,
    reservation.reserved_quantity,
    reservation.consumed_at,
    row_number() OVER (
      PARTITION BY reservation.machine_id, reservation.request_item_table,
        reservation.request_item_id, reservation.reserved_quantity
      ORDER BY reservation.consumed_at, reservation.created_at, reservation.id
    ) AS match_rank
  FROM public.inventory_reservations reservation
  WHERE reservation.consumed_at IS NOT NULL
    AND reservation.supply_order_schedule_id IS NULL
), matched AS (
  SELECT consumed.reservation_id, delivered.schedule_id
  FROM consumed
  JOIN delivered
    ON delivered.machine_id = consumed.machine_id
   AND delivered.request_item_table = consumed.request_item_table
   AND delivered.request_item_id = consumed.request_item_id
   AND delivered.received_quantity = consumed.reserved_quantity
   AND delivered.match_rank = consumed.match_rank
   AND delivered.delivered_at <= consumed.consumed_at
)
UPDATE public.inventory_reservations reservation
SET reservation_source = 'supply_receipt',
    supply_order_schedule_id = matched.schedule_id
FROM matched
WHERE reservation.id = matched.reservation_id;

CREATE OR REPLACE FUNCTION public.fn_set_request_reserved_quantity(
  p_table text,
  p_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quantity numeric;
  v_secondary_quantity numeric;
BEGIN
  SELECT
    COALESCE(SUM(reserved_quantity), 0),
    COALESCE(SUM(COALESCE(reserved_secondary_quantity, 0)), 0)
  INTO v_quantity, v_secondary_quantity
  FROM public.inventory_reservations
  WHERE request_item_table = p_table
    AND request_item_id = p_id
    AND reservation_source = 'stock';

  IF p_table = 'request_sheet_metal' THEN
    UPDATE public.request_sheet_metal SET reserved_from_stock_kg = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_round_tube' THEN
    UPDATE public.request_round_tube
    SET reserved_from_stock_kg = v_quantity,
        reserved_from_stock_m = v_secondary_quantity
    WHERE id = p_id;
  ELSIF p_table = 'request_circle' THEN
    UPDATE public.request_circle SET reserved_from_stock_mm = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_pipe' THEN
    UPDATE public.request_pipe
    SET reserved_from_stock_length_mm = CASE WHEN pipe_type = 'wire' THEN reserved_from_stock_length_mm ELSE v_quantity END,
        reserved_from_stock_qty = CASE WHEN pipe_type = 'wire' THEN reserved_from_stock_qty ELSE v_secondary_quantity END,
        reserved_from_stock_kg = CASE WHEN pipe_type = 'wire' THEN v_quantity ELSE reserved_from_stock_kg END
    WHERE id = p_id;
  ELSIF p_table = 'request_knives' THEN
    UPDATE public.request_knives
    SET reserved_from_stock_mm = v_quantity,
        reserved_from_stock_qty = v_secondary_quantity
    WHERE id = p_id;
  ELSIF p_table = 'request_components' THEN
    UPDATE public.request_components SET reserved_from_stock = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_paint' THEN
    UPDATE public.request_paint SET reserved_from_stock_kg = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_mesh' THEN
    UPDATE public.request_mesh SET reserved_from_stock_qty = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_chain_cord' THEN
    UPDATE public.request_chain_cord
    SET reserved_from_stock_meters = v_quantity / 1000
    WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Некорректная таблица позиции: %', p_table;
  END IF;
END;
$$;

DO $$
DECLARE
  v_item record;
BEGIN
  FOR v_item IN
    SELECT DISTINCT request_item_table, request_item_id
    FROM public.inventory_reservations
    WHERE reservation_source = 'supply_receipt'
  LOOP
    PERFORM public.fn_set_request_reserved_quantity(v_item.request_item_table, v_item.request_item_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reserve_delivered_supply_for_cutting(
  p_machine_id uuid,
  p_performed_by uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_item jsonb;
  v_request_id uuid;
  v_material_id uuid;
  v_material_variant_id uuid;
  v_factory_id uuid;
  v_piece_length_mm numeric;
  v_secondary_quantity numeric;
  v_inventory public.inventory%ROWTYPE;
  v_reserved_count integer := 0;
BEGIN
  SELECT factory_id
  INTO v_factory_id
  FROM public.machines
  WHERE id = p_machine_id;

  IF v_factory_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_schedule IN
    SELECT schedule.*
    FROM public.supply_order_delivery_schedules schedule
    WHERE schedule.status = 'delivered'
      AND COALESCE(schedule.received_quantity, 0) > 0
      AND schedule.request_item_table IN (
        'request_sheet_metal',
        'request_round_tube',
        'request_circle',
        'request_pipe',
        'request_knives',
        'request_components',
        'request_paint',
        'request_mesh',
        'request_chain_cord'
      )
      AND (
        (schedule.request_item_table = 'request_sheet_metal' AND EXISTS (
          SELECT 1 FROM public.request_sheet_metal item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_round_tube' AND EXISTS (
          SELECT 1 FROM public.request_round_tube item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_circle' AND EXISTS (
          SELECT 1 FROM public.request_circle item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_pipe' AND EXISTS (
          SELECT 1 FROM public.request_pipe item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_knives' AND EXISTS (
          SELECT 1 FROM public.request_knives item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_components' AND EXISTS (
          SELECT 1 FROM public.request_components item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_paint' AND EXISTS (
          SELECT 1 FROM public.request_paint item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_mesh' AND EXISTS (
          SELECT 1 FROM public.request_mesh item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
        OR (schedule.request_item_table = 'request_chain_cord' AND EXISTS (
          SELECT 1 FROM public.request_chain_cord item
          JOIN public.technologist_requests request ON request.id = item.request_id
          WHERE item.id = schedule.request_item_id AND request.machine_id = p_machine_id
        ))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_reservations reservation
        WHERE reservation.supply_order_schedule_id = schedule.id
      )
    ORDER BY schedule.delivered_at, schedule.created_at, schedule.id
    FOR UPDATE OF schedule SKIP LOCKED
  LOOP
    EXECUTE format(
      'SELECT to_jsonb(item) FROM public.%I item WHERE item.id = $1',
      v_schedule.request_item_table
    )
    INTO v_item
    USING v_schedule.request_item_id;

    IF v_item IS NULL THEN
      CONTINUE;
    END IF;

    v_request_id := NULLIF(v_item->>'request_id', '')::uuid;
    v_material_id := NULLIF(v_item->>'material_id', '')::uuid;
    v_material_variant_id := NULLIF(v_item->>'material_variant_id', '')::uuid;

    IF v_request_id IS NULL OR v_material_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.technologist_requests request
      WHERE request.id = v_request_id
        AND request.machine_id = p_machine_id
    ) THEN
      CONTINUE;
    END IF;

    IF v_schedule.request_item_table = 'request_knives' THEN
      v_piece_length_mm := NULLIF(v_item->>'length_mm', '')::numeric;
      IF v_piece_length_mm IS NULL OR v_piece_length_mm <= 0 THEN
        CONTINUE;
      END IF;
      v_secondary_quantity := v_schedule.received_quantity / v_piece_length_mm;
    ELSE
      v_piece_length_mm := NULL;
      v_secondary_quantity := NULL;
    END IF;

    v_inventory := NULL;
    SELECT inventory.*
    INTO v_inventory
    FROM public.inventory inventory
    WHERE inventory.factory_id = v_factory_id
      AND inventory.material_id = v_material_id
      AND inventory.material_variant_id IS NOT DISTINCT FROM v_material_variant_id
      AND inventory.piece_length_mm IS NOT DISTINCT FROM v_piece_length_mm
      AND inventory.is_business_scrap = false
      AND inventory.deleted_at IS NULL
      AND inventory.available_quantity >= v_schedule.received_quantity
      AND (
        v_secondary_quantity IS NULL
        OR COALESCE(inventory.available_secondary_quantity, 0) >= v_secondary_quantity
      )
    ORDER BY inventory.created_at, inventory.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_inventory.id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.inventory_reservations (
      inventory_id,
      material_id,
      material_variant_id,
      machine_id,
      request_item_table,
      request_item_id,
      reserved_quantity,
      reserved_secondary_quantity,
      reserved_by,
      original_piece_length_mm,
      is_cut_reservation,
      reservation_source,
      supply_order_schedule_id
    )
    VALUES (
      v_inventory.id,
      v_material_id,
      v_material_variant_id,
      p_machine_id,
      v_schedule.request_item_table,
      v_schedule.request_item_id,
      v_schedule.received_quantity,
      v_secondary_quantity,
      p_performed_by,
      v_piece_length_mm,
      false,
      'supply_receipt',
      v_schedule.id
    )
    ON CONFLICT (supply_order_schedule_id) WHERE supply_order_schedule_id IS NOT NULL DO NOTHING;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE public.inventory
    SET reserved_quantity = reserved_quantity + v_schedule.received_quantity,
        reserved_secondary_quantity = CASE
          WHEN v_secondary_quantity IS NULL THEN reserved_secondary_quantity
          ELSE COALESCE(reserved_secondary_quantity, 0) + v_secondary_quantity
        END,
        last_updated_by = p_performed_by,
        updated_at = now()
    WHERE id = v_inventory.id;

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
    VALUES (
      v_factory_id,
      v_inventory.id,
      v_material_id,
      v_material_variant_id,
      'reserve'::public.inventory_transaction_type,
      v_schedule.received_quantity,
      v_secondary_quantity,
      p_machine_id,
      v_schedule.request_item_table,
      v_schedule.request_item_id,
      p_performed_by,
      'Автоматическая бронь принятой поставки перед списанием в заготовке'
    );

    v_reserved_count := v_reserved_count + 1;
  END LOOP;

  RETURN v_reserved_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_reserve_delivered_supply_for_cutting(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_reserve_delivered_supply_for_cutting(uuid, uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_apply_production_fact_cutting(
  p_fact_id uuid,
  p_performed_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  SELECT pmf.*, m.factory_id AS machine_factory_id
  INTO v_fact
  FROM public.production_machine_facts pmf
  JOIN public.machines m ON m.id = pmf.machine_id
  WHERE pmf.id = p_fact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Факт производства не найден';
  END IF;

  SELECT COALESCE(section.production_stage_type, parent.production_stage_type)
  INTO v_effective_stage
  FROM public.production_fact_sections section
  LEFT JOIN public.production_fact_sections parent ON parent.id = section.parent_id
  WHERE section.id = v_fact.section_id;

  IF v_effective_stage IS DISTINCT FROM 'cutting'::public.stage_type THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_stage
  FROM public.production_stages
  WHERE machine_id = v_fact.machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.production_stages (machine_id, stage_type, workshop, updated_by)
    VALUES (v_fact.machine_id, 'cutting'::public.stage_type, 1, p_performed_by)
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

  SELECT COALESCE(array_agg(r.id ORDER BY r.created_at, r.id), ARRAY[]::uuid[])
  INTO v_reservation_ids
  FROM public.inventory_reservations r
  WHERE r.machine_id = v_fact.machine_id
    AND r.consumed_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.production_fact_cutting_event_reservations er
      WHERE er.event_id = v_event_id
        AND er.reservation_id = r.id
    );

  IF COALESCE(array_length(v_reservation_ids, 1), 0) > 0 THEN
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
      is_cut_reservation
    )
    SELECT
      v_event_id,
      r.id,
      r.inventory_id,
      r.material_id,
      r.material_variant_id,
      r.request_item_table,
      r.request_item_id,
      r.reserved_quantity,
      r.reserved_secondary_quantity,
      COALESCE(r.is_cut_reservation, false)
    FROM public.inventory_reservations r
    WHERE r.id = ANY(v_reservation_ids);

    WITH normal_reservations AS (
      SELECT
        r.inventory_id,
        SUM(r.reserved_quantity) AS reserved_quantity,
        SUM(COALESCE(r.reserved_secondary_quantity, 0)) AS reserved_secondary_quantity
      FROM public.inventory_reservations r
      WHERE r.id = ANY(v_reservation_ids)
        AND COALESCE(r.is_cut_reservation, false) = false
      GROUP BY r.inventory_id
    )
    UPDATE public.inventory i
    SET total_quantity = GREATEST(i.total_quantity - n.reserved_quantity, 0),
        reserved_quantity = GREATEST(i.reserved_quantity - n.reserved_quantity, 0),
        total_secondary_quantity = CASE
          WHEN i.total_secondary_quantity IS NULL THEN NULL
          ELSE GREATEST(COALESCE(i.total_secondary_quantity, 0) - n.reserved_secondary_quantity, 0)
        END,
        reserved_secondary_quantity = CASE
          WHEN i.reserved_secondary_quantity IS NULL AND n.reserved_secondary_quantity = 0 THEN i.reserved_secondary_quantity
          ELSE GREATEST(COALESCE(i.reserved_secondary_quantity, 0) - n.reserved_secondary_quantity, 0)
        END,
        last_updated_by = p_performed_by,
        updated_at = now()
    FROM normal_reservations n
    WHERE i.id = n.inventory_id;

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
      i.factory_id,
      r.inventory_id,
      r.material_id,
      r.material_variant_id,
      'write_off'::public.inventory_transaction_type,
      -r.reserved_quantity,
      CASE WHEN r.reserved_secondary_quantity IS NULL THEN NULL ELSE -r.reserved_secondary_quantity END,
      r.machine_id,
      r.request_item_table,
      r.request_item_id,
      p_performed_by,
      'Автоматическое списание по факту заготовки'
    FROM public.inventory_reservations r
    JOIN public.inventory i ON i.id = r.inventory_id
    WHERE r.id = ANY(v_reservation_ids)
      AND COALESCE(r.is_cut_reservation, false) = false;

    UPDATE public.inventory_reservations r
    SET consumed_at = now(),
        consumed_by = p_performed_by,
        consumed_cutting_event_id = v_event_id
    WHERE r.id = ANY(v_reservation_ids)
      AND r.consumed_at IS NULL;

    PERFORM public.fn_set_request_reserved_quantity(er.request_item_table, er.request_item_id)
    FROM (
      SELECT DISTINCT request_item_table, request_item_id
      FROM public.production_fact_cutting_event_reservations
      WHERE event_id = v_event_id
        AND reservation_id = ANY(v_reservation_ids)
    ) er;
  END IF;

  INSERT INTO public.production_fact_cutting_event_scrap_promotions (
    event_id,
    inventory_id,
    previous_business_scrap_state
  )
  SELECT
    v_event_id,
    i.id,
    i.business_scrap_state
  FROM public.inventory i
  WHERE i.is_business_scrap = true
    AND i.business_scrap_state = 'future'
    AND i.deleted_at IS NULL
    AND i.available_from_stage_id = v_stage.id
  ON CONFLICT (event_id, inventory_id) DO NOTHING;

  UPDATE public.inventory i
  SET business_scrap_state = 'available',
      updated_at = now(),
      last_updated_by = p_performed_by
  FROM public.production_fact_cutting_event_scrap_promotions s
  WHERE s.event_id = v_event_id
    AND s.inventory_id = i.id
    AND i.business_scrap_state = 'future';

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_apply_production_fact_cutting(uuid, uuid) TO authenticated;

DO $$
DECLARE
  v_fact record;
BEGIN
  FOR v_fact IN
    SELECT fact.id, COALESCE(event.created_by, fact.updated_by, fact.created_by) AS performed_by
    FROM public.production_fact_cutting_events event
    JOIN public.production_machine_facts fact ON fact.id = event.fact_id
    WHERE event.status = 'applied'
      AND COALESCE(event.created_by, fact.updated_by, fact.created_by) IS NOT NULL
    ORDER BY event.created_at, event.id
  LOOP
    PERFORM public.fn_apply_production_fact_cutting(v_fact.id, v_fact.performed_by);
  END LOOP;
END;
$$;
