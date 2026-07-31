ALTER TABLE public.machine_outsourcing_transport_orders
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_by uuid
    REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.fn_start_transport_trip_v1(
  p_trip_id uuid,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
  v_first_stop public.transport_trip_stops%ROWTYPE;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;

  SELECT * INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = p_trip_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Рейс не найден'; END IF;
  IF v_trip.status <> 'found' THEN
    RAISE EXCEPTION 'Начать можно только запланированный рейс';
  END IF;
  IF v_trip.date_change_state NOT IN ('not_required', 'approved') THEN
    RAISE EXCEPTION 'Начало рейса заблокировано до согласования переноса дат';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.transport_trip_need_links AS link
    WHERE link.transport_order_id = p_trip_id
      AND link.released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'В рейсе нет активных потребностей';
  END IF;

  SELECT * INTO v_first_stop
  FROM public.transport_trip_stops
  WHERE transport_order_id = p_trip_id
    AND stop_kind <> 'start'
  ORDER BY sequence_no
  LIMIT 1;
  IF NOT FOUND OR v_first_stop.planned_arrival_at IS NULL THEN
    RAISE EXCEPTION 'У рейса не указано время начала';
  END IF;
  IF now() < v_first_stop.planned_arrival_at THEN
    RAISE EXCEPTION 'Запланированное время начала рейса ещё не наступило';
  END IF;

  UPDATE public.machine_outsourcing_transport_orders
  SET status = 'in_transit',
      started_at = now(),
      started_by = p_actor,
      completed_at = NULL,
      completed_by = NULL,
      updated_by = p_actor,
      updated_at = now()
  WHERE id = p_trip_id;

  RETURN 'in_transit';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_complete_transport_trip_v1(
  p_trip_id uuid,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
  v_last_stop public.transport_trip_stops%ROWTYPE;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;

  SELECT * INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = p_trip_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Рейс не найден'; END IF;
  IF v_trip.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Завершить можно только выполняющийся рейс';
  END IF;
  SELECT * INTO v_last_stop
  FROM public.transport_trip_stops
  WHERE transport_order_id = p_trip_id
    AND stop_kind <> 'start'
  ORDER BY sequence_no DESC
  LIMIT 1;
  IF NOT FOUND OR v_last_stop.planned_arrival_at IS NULL THEN
    RAISE EXCEPTION 'У рейса не указано время завершения';
  END IF;
  IF now() < v_last_stop.planned_arrival_at
      + (v_last_stop.service_duration_minutes * interval '1 minute') THEN
    RAISE EXCEPTION 'Запланированное время завершения рейса ещё не наступило';
  END IF;

  -- The explicit trip-level confirmation is authoritative. It also closes
  -- any remaining stop marks so a completed trip cannot keep a partial route.
  UPDATE public.transport_trip_stops
  SET status = 'completed',
      arrived_at = COALESCE(arrived_at, now()),
      completed_at = COALESCE(completed_at, now()),
      updated_at = now()
  WHERE transport_order_id = p_trip_id
    AND stop_kind <> 'start'
    AND status <> 'completed';

  PERFORM public.fn_update_transport_trip(
    v_trip.id,
    'completed',
    v_trip.carrier_supplier_id,
    v_trip.scheduled_date,
    v_trip.price,
    v_trip.route,
    v_trip.comment,
    p_actor
  );

  UPDATE public.machine_outsourcing_transport_orders
  SET completed_at = now(),
      completed_by = p_actor,
      updated_by = p_actor,
      updated_at = now()
  WHERE id = p_trip_id;

  RETURN 'completed';
END;
$$;

-- Stop progress is recorded only inside a manually started trip. Completing
-- the final stop no longer moves the trip to history without confirmation.
CREATE OR REPLACE FUNCTION public.fn_update_transport_trip_stop_status(
  p_stop_id uuid,
  p_status text,
  p_actor uuid
) RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_stop public.transport_trip_stops%ROWTYPE;
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;

  SELECT * INTO v_stop
  FROM public.transport_trip_stops
  WHERE id = p_stop_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Остановка не найдена'; END IF;

  SELECT * INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = v_stop.transport_order_id
  FOR UPDATE;
  IF v_trip.status <> 'in_transit' THEN
    RAISE EXCEPTION 'Сначала подтвердите начало рейса';
  END IF;
  IF v_trip.date_change_state NOT IN ('not_required', 'approved') THEN
    RAISE EXCEPTION 'Выполнение рейса заблокировано до согласования переноса дат';
  END IF;
  IF v_stop.stop_kind = 'start' THEN
    RAISE EXCEPTION 'Точка выезда не требует отметки';
  END IF;
  IF p_status = 'arrived' AND v_stop.status <> 'planned' THEN
    RAISE EXCEPTION 'Остановку уже начали или завершили';
  END IF;
  IF p_status = 'completed' AND v_stop.status <> 'arrived' THEN
    RAISE EXCEPTION 'Сначала отметьте прибытие';
  END IF;
  IF p_status NOT IN ('arrived', 'completed') THEN
    RAISE EXCEPTION 'Некорректный статус остановки';
  END IF;
  IF p_status = 'arrived' AND EXISTS (
    SELECT 1
    FROM public.transport_trip_stops AS previous
    WHERE previous.transport_order_id = v_stop.transport_order_id
      AND previous.stop_kind <> 'start'
      AND previous.sequence_no < v_stop.sequence_no
      AND previous.status <> 'completed'
  ) THEN
    RAISE EXCEPTION 'Сначала завершите предыдущую остановку';
  END IF;

  UPDATE public.transport_trip_stops
  SET status = p_status,
      arrived_at = CASE WHEN p_status = 'arrived' THEN now() ELSE arrived_at END,
      completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_stop_id;

  RETURN p_status;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_start_transport_trip_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_complete_transport_trip_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_update_transport_trip_stop_status(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_start_transport_trip_v1(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_complete_transport_trip_v1(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip_stop_status(uuid, text, uuid)
  TO service_role;
