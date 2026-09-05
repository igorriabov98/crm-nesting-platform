-- Keep detailing transfer items valid when a reservation is fully released.
-- A transfer item cannot have requested_quantity = 0, so remove a completely
-- unreceived line instead of updating it to zero. Partially received lines stay
-- as history with requested_quantity reduced to the amount already received.

CREATE OR REPLACE FUNCTION public.detailing_release_reservation_internal(
  p_reservation_id uuid,
  p_actor uuid,
  p_reason text,
  p_cancelled boolean DEFAULT false
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation public.detailing_reservations%ROWTYPE;
  v_allocation public.detailing_reservation_allocations%ROWTYPE;
  v_transfer_item record;
  v_release integer;
  v_total_released integer := 0;
  v_active_quantity integer;
  v_transfer_ids uuid[] := '{}'::uuid[];
  v_transfer_id uuid;
BEGIN
  SELECT * INTO v_reservation
  FROM public.detailing_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Бронь деталировки не найдена'; END IF;

  FOR v_allocation IN
    SELECT *
    FROM public.detailing_reservation_allocations
    WHERE reservation_id = p_reservation_id AND quantity > 0
    ORDER BY factory_id
    FOR UPDATE
  LOOP
    v_release := v_allocation.quantity;

    PERFORM 1
    FROM public.detailing_balances
    WHERE part_id = v_reservation.part_id
      AND factory_id = v_allocation.factory_id
    FOR UPDATE;

    UPDATE public.detailing_balances
    SET reserved_quantity = reserved_quantity - v_release,
        updated_by = p_actor
    WHERE part_id = v_reservation.part_id
      AND factory_id = v_allocation.factory_id;

    UPDATE public.detailing_reservation_allocations
    SET quantity = 0,
        released_quantity = released_quantity + v_release
    WHERE id = v_allocation.id;

    PERFORM public.detailing_record_movement(
      v_reservation.part_id,
      v_allocation.factory_id,
      'unreserve',
      0,
      -v_release,
      p_actor,
      v_reservation.machine_id,
      v_reservation.id,
      NULL,
      NULL,
      COALESCE(NULLIF(btrim(p_reason), ''), 'Бронь освобождена')
    );

    FOR v_transfer_item IN
      SELECT dti.id,
             dti.transfer_id,
             dti.requested_quantity,
             dti.received_quantity,
             dti.requested_quantity - dti.received_quantity AS unreceived_quantity
      FROM public.detailing_transfer_items dti
      JOIN public.detailing_transfers dt ON dt.id = dti.transfer_id
      WHERE dti.reservation_id = p_reservation_id
        AND dt.source_factory_id = v_allocation.factory_id
        AND dt.status IN ('needs_date', 'scheduled', 'partially_received')
      FOR UPDATE OF dti, dt
    LOOP
      IF v_transfer_item.received_quantity = 0
         AND v_transfer_item.requested_quantity <= v_release THEN
        DELETE FROM public.detailing_transfer_items
        WHERE id = v_transfer_item.id;
      ELSE
        UPDATE public.detailing_transfer_items
        SET requested_quantity = requested_quantity
          - LEAST(v_release, v_transfer_item.unreceived_quantity)
        WHERE id = v_transfer_item.id;
      END IF;

      v_transfer_ids := array_append(v_transfer_ids, v_transfer_item.transfer_id);
    END LOOP;

    v_total_released := v_total_released + v_release;
  END LOOP;

  SELECT COALESCE(sum(quantity), 0)::integer
  INTO v_active_quantity
  FROM public.detailing_reservation_allocations
  WHERE reservation_id = p_reservation_id;

  UPDATE public.detailing_reservations
  SET released_quantity = released_quantity + v_total_released,
      status = CASE
        WHEN v_active_quantity > 0 AND consumed_quantity > 0 THEN 'partially_consumed'::public.detailing_reservation_status
        WHEN v_active_quantity > 0 THEN 'active'::public.detailing_reservation_status
        WHEN p_cancelled THEN 'cancelled'::public.detailing_reservation_status
        ELSE 'released'::public.detailing_reservation_status
      END
  WHERE id = p_reservation_id;

  FOREACH v_transfer_id IN ARRAY v_transfer_ids
  LOOP
    PERFORM public.detailing_refresh_transfer_status(v_transfer_id, p_actor);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.detailing_reservations dr
    JOIN public.detailing_reservation_allocations dra ON dra.reservation_id = dr.id
    WHERE dr.request_id = v_reservation.request_id
      AND dr.status IN ('active', 'partially_consumed')
      AND dra.quantity > 0
  ) THEN
    DELETE FROM public.detailing_request_checks
    WHERE request_id = v_reservation.request_id
      AND decision = 'reserved';
  END IF;

  RETURN v_total_released;
END;
$$;

REVOKE ALL ON FUNCTION public.detailing_release_reservation_internal(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
