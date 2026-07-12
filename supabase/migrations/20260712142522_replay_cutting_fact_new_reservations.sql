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
