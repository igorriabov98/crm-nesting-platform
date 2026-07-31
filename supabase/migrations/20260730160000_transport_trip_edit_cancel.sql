ALTER TABLE public.machine_outsourcing_transport_orders
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.machine_outsourcing_transport_orders
  DROP CONSTRAINT IF EXISTS machine_outsourcing_transport_orders_cancellation_reason_check;
ALTER TABLE public.machine_outsourcing_transport_orders
  ADD CONSTRAINT machine_outsourcing_transport_orders_cancellation_reason_check
    CHECK (cancellation_reason IS NULL OR btrim(cancellation_reason) <> '');

ALTER TABLE public.transport_trip_need_links
  ADD COLUMN IF NOT EXISTS released_reason text,
  ADD COLUMN IF NOT EXISTS released_by uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.transport_trip_need_links
  DROP CONSTRAINT IF EXISTS transport_trip_need_links_released_reason_check;
ALTER TABLE public.transport_trip_need_links
  ADD CONSTRAINT transport_trip_need_links_released_reason_check
    CHECK (released_reason IS NULL OR btrim(released_reason) <> '');

-- Before composition editing existed, an active trip could not legitimately
-- contain a released link. Repair those rows, but fail closed if the same need
-- has since been attached to another active trip.
DO $$
DECLARE
  v_conflicts text;
BEGIN
  WITH candidates AS (
    SELECT link.transport_order_id, link.need_source, link.need_id
    FROM public.transport_trip_need_links AS link
    JOIN public.machine_outsourcing_transport_orders AS trip
      ON trip.id = link.transport_order_id
    WHERE trip.status IN ('needed', 'found', 'in_transit')
      AND link.released_at IS NOT NULL
  ), conflicts AS (
    SELECT
      candidate.need_source,
      candidate.need_id,
      string_agg(candidate.transport_order_id::text, '|' ORDER BY candidate.transport_order_id) AS released_trip_ids,
      (
        SELECT string_agg(active.transport_order_id::text, '|' ORDER BY active.transport_order_id)
        FROM public.transport_trip_need_links AS active
        WHERE active.need_source = candidate.need_source
          AND active.need_id = candidate.need_id
          AND active.released_at IS NULL
      ) AS active_trip_ids
    FROM candidates AS candidate
    GROUP BY candidate.need_source, candidate.need_id
    HAVING count(*) > 1 OR EXISTS (
      SELECT 1
      FROM public.transport_trip_need_links AS active
      WHERE active.need_source = candidate.need_source
        AND active.need_id = candidate.need_id
        AND active.released_at IS NULL
    )
  )
  SELECT string_agg(
    'need=' || conflict.need_source || ':' || conflict.need_id::text
      || '; released_trips=' || conflict.released_trip_ids
      || '; active_trips=' || COALESCE(conflict.active_trip_ids, 'нет'),
    ', ' ORDER BY conflict.need_source, conflict.need_id
  )
  INTO v_conflicts
  FROM conflicts AS conflict;

  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Конфликт освобождённых потребностей активных рейсов: %', v_conflicts;
  END IF;

  UPDATE public.transport_trip_need_links AS link
  SET released_at = NULL,
      released_reason = NULL,
      released_by = NULL
  FROM public.machine_outsourcing_transport_orders AS trip
  WHERE trip.id = link.transport_order_id
    AND trip.status IN ('needed', 'found', 'in_transit')
    AND link.released_at IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cancel_transport_trip_v1(
  p_trip_id uuid,
  p_reason text,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Укажите причину отмены рейса'; END IF;

  SELECT * INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = p_trip_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Рейс не найден'; END IF;
  IF v_trip.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Завершённый или отменённый рейс нельзя отменить повторно';
  END IF;

  UPDATE public.tasks AS task
  SET status = 'pending', completed_at = NULL, updated_at = now()
  FROM public.machine_outsourcing_transport_needs AS need
  JOIN public.transport_trip_need_links AS link
    ON link.need_source = 'outsourcing'
   AND link.need_id = need.id
  WHERE link.transport_order_id = p_trip_id
    AND link.released_at IS NULL
    AND task.id = need.task_id;

  UPDATE public.machine_outsourcing_transport_needs AS need
  SET status = 'open', transport_order_id = NULL, updated_at = now()
  FROM public.transport_trip_need_links AS link
  WHERE link.transport_order_id = p_trip_id
    AND link.released_at IS NULL
    AND link.need_source = 'outsourcing'
    AND link.need_id = need.id;

  UPDATE public.tasks AS task
  SET status = 'cancelled', completed_at = now(), updated_at = now()
  FROM public.transport_trip_date_change_requests AS request
  WHERE request.transport_order_id = p_trip_id
    AND request.status = 'pending'
    AND request.task_id = task.id;

  UPDATE public.transport_trip_date_change_items AS item
  SET status = 'rejected', decided_at = now()
  FROM public.transport_trip_date_change_requests AS request
  WHERE request.transport_order_id = p_trip_id
    AND request.status = 'pending'
    AND item.request_id = request.id;

  UPDATE public.transport_trip_date_change_requests
  SET status = 'rejected',
      decided_by = p_actor,
      decided_at = now(),
      decision_comment = 'Рейс отменён: ' || btrim(p_reason),
      updated_at = now()
  WHERE transport_order_id = p_trip_id
    AND status = 'pending';

  UPDATE public.transport_trip_need_links
  SET released_at = now(),
      released_reason = btrim(p_reason),
      released_by = p_actor
  WHERE transport_order_id = p_trip_id
    AND released_at IS NULL;

  UPDATE public.machine_outsourcing_transport_orders
  SET status = 'cancelled',
      cancellation_reason = btrim(p_reason),
      cancelled_at = now(),
      cancelled_by = p_actor,
      date_change_state = CASE
        WHEN date_change_state = 'pending' THEN 'rejected'
        ELSE date_change_state
      END,
      updated_by = p_actor,
      updated_at = now()
  WHERE id = p_trip_id;

  RETURN 'cancelled';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_transport_trip_v4(
  p_trip_id uuid,
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_comment text,
  p_stops jsonb,
  p_links jsonb,
  p_remove_reason text,
  p_date_change_reason text,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
  v_link public.transport_trip_need_links%ROWTYPE;
  v_link_json jsonb;
  v_stop_json jsonb;
  v_existing_stop public.transport_trip_stops%ROWTYPE;
  v_existing_link_id uuid;
  v_pickup_stop_id uuid;
  v_delivery_stop_id uuid;
  v_task_id uuid;
  v_need_source text;
  v_need_kind text;
  v_need_id uuid;
  v_route text;
  v_direction text;
  v_eta timestamptz;
  v_previous_eta timestamptz;
  v_ordinal bigint;
  v_removed_count integer;
  v_composition_changed boolean := false;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;
  IF p_carrier_supplier_id IS NULL THEN RAISE EXCEPTION 'Укажите перевозчика'; END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'Укажите дату рейса'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'Укажите корректную цену рейса'; END IF;
  IF jsonb_typeof(p_stops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_stops) < 2 THEN
    RAISE EXCEPTION 'Добавьте точки забора и доставки';
  END IF;
  IF jsonb_typeof(p_links) IS DISTINCT FROM 'array' OR jsonb_array_length(p_links) = 0 THEN
    RAISE EXCEPTION 'В рейсе должна остаться хотя бы одна потребность';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_links) AS desired(value)
    GROUP BY value->>'needSource', value->>'needId'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Одна потребность указана в составе рейса несколько раз';
  END IF;

  SELECT * INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = p_trip_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Рейс не найден'; END IF;
  IF v_trip.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Завершённый или отменённый рейс нельзя изменить';
  END IF;

  SELECT count(*) INTO v_removed_count
  FROM public.transport_trip_need_links AS current_link
  WHERE current_link.transport_order_id = p_trip_id
    AND current_link.released_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_links) AS desired(value)
      WHERE desired.value->>'needSource' = current_link.need_source
        AND (desired.value->>'needId')::uuid = current_link.need_id
    );
  IF v_removed_count > 0 AND NULLIF(btrim(p_remove_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину исключения потребности';
  END IF;
  v_composition_changed := v_removed_count > 0;

  IF v_trip.status = 'in_transit' AND EXISTS (
    SELECT 1
    FROM public.transport_trip_need_links AS current_link
    JOIN public.transport_trip_stops AS pickup ON pickup.id = current_link.pickup_stop_id
    WHERE current_link.transport_order_id = p_trip_id
      AND current_link.released_at IS NULL
      AND pickup.status <> 'planned'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_links) AS desired(value)
        WHERE desired.value->>'needSource' = current_link.need_source
          AND (desired.value->>'needId')::uuid = current_link.need_id
      )
  ) THEN
    RAISE EXCEPTION 'Нельзя исключить потребность после начала её точки забора';
  END IF;

  -- Every started stop is an immutable prefix of an in-transit route.
  IF v_trip.status = 'in_transit' AND EXISTS (
    SELECT 1
    FROM public.transport_trip_stops AS immutable
    WHERE immutable.transport_order_id = p_trip_id
      AND immutable.status <> 'planned'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_stops) WITH ORDINALITY AS desired(value, ordinality)
        WHERE NULLIF(desired.value->>'id', '')::uuid = immutable.id
          AND desired.ordinality - 1 = immutable.sequence_no
          AND desired.value->>'clientId' = immutable.client_key
          AND desired.value->>'pointKey' = immutable.point_key
          AND desired.value->>'kind' = immutable.stop_kind
          AND desired.value->>'pointLabel' = immutable.point_label
          AND COALESCE(NULLIF(desired.value->>'city', ''), '') = COALESCE(immutable.city, '')
          AND COALESCE(NULLIF(desired.value->>'address', ''), '') = COALESCE(immutable.address, '')
          AND NULLIF(desired.value->>'plannedArrivalAt', '')::timestamptz
              IS NOT DISTINCT FROM immutable.planned_arrival_at
          AND COALESCE((desired.value->>'serviceDurationMinutes')::integer, 30)
              = immutable.service_duration_minutes
      )
  ) THEN
    RAISE EXCEPTION 'Пройденную или начатую часть маршрута нельзя изменить';
  END IF;

  FOR v_link IN
    SELECT *
    FROM public.transport_trip_need_links AS current_link
    WHERE current_link.transport_order_id = p_trip_id
      AND current_link.released_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_links) AS desired(value)
        WHERE desired.value->>'needSource' = current_link.need_source
          AND (desired.value->>'needId')::uuid = current_link.need_id
      )
    FOR UPDATE
  LOOP
    IF v_link.need_source = 'outsourcing' THEN
      UPDATE public.machine_outsourcing_transport_needs
      SET status = 'open', transport_order_id = NULL, updated_at = now()
      WHERE id = v_link.need_id
      RETURNING task_id INTO v_task_id;
      IF v_task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = 'pending', completed_at = NULL, updated_at = now()
        WHERE id = v_task_id;
      END IF;
    END IF;
    UPDATE public.transport_trip_need_links
    SET pickup_stop_id = NULL,
        delivery_stop_id = NULL,
        released_at = now(),
        released_reason = btrim(p_remove_reason),
        released_by = p_actor
    WHERE id = v_link.id;
  END LOOP;

  -- Retained links temporarily release their stop references so the planned
  -- suffix can be rebuilt without weakening the foreign keys.
  UPDATE public.transport_trip_need_links
  SET pickup_stop_id = NULL,
      delivery_stop_id = NULL
  WHERE transport_order_id = p_trip_id
    AND released_at IS NULL;

  UPDATE public.transport_trip_need_links AS released
  SET pickup_stop_id = NULL,
      delivery_stop_id = NULL
  WHERE released.transport_order_id = p_trip_id
    AND EXISTS (
      SELECT 1 FROM public.transport_trip_stops AS planned
      WHERE planned.transport_order_id = p_trip_id
        AND planned.status = 'planned'
        AND planned.id IN (released.pickup_stop_id, released.delivery_stop_id)
    );

  DELETE FROM public.transport_trip_stops
  WHERE transport_order_id = p_trip_id
    AND status = 'planned';

  FOR v_stop_json, v_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_stops) WITH ORDINALITY
  LOOP
    IF v_stop_json->>'kind' NOT IN ('service', 'finish') THEN
      RAISE EXCEPTION 'Некорректный тип остановки';
    END IF;
    IF v_ordinal = 1 AND v_stop_json->>'kind' <> 'service' THEN
      RAISE EXCEPTION 'Маршрут должен начинаться с точки забора';
    END IF;
    IF v_stop_json->>'kind' = 'finish' AND v_ordinal <> jsonb_array_length(p_stops) THEN
      RAISE EXCEPTION 'Точка завершения может быть только последней';
    END IF;
    v_eta := NULLIF(v_stop_json->>'plannedArrivalAt', '')::timestamptz;
    IF v_previous_eta IS NOT NULL AND v_eta IS NOT NULL AND v_eta <= v_previous_eta THEN
      RAISE EXCEPTION 'Время остановок должно идти по порядку';
    END IF;
    IF v_eta IS NOT NULL THEN v_previous_eta := v_eta; END IF;

    IF NULLIF(v_stop_json->>'id', '') IS NOT NULL THEN
      SELECT * INTO v_existing_stop
      FROM public.transport_trip_stops
      WHERE id = (v_stop_json->>'id')::uuid
        AND transport_order_id = p_trip_id;
    ELSE
      v_existing_stop := NULL;
    END IF;

    IF v_existing_stop.id IS NOT NULL THEN
      IF v_existing_stop.status = 'planned' THEN
        RAISE EXCEPTION 'Плановая остановка должна быть пересоздана';
      END IF;
    ELSE
      INSERT INTO public.transport_trip_stops (
        transport_order_id, client_key, sequence_no, stop_kind,
        point_key, point_label, city, address, planned_arrival_at,
        service_duration_minutes, status
      ) VALUES (
        p_trip_id,
        btrim(v_stop_json->>'clientId'),
        (v_ordinal - 1)::integer,
        v_stop_json->>'kind',
        btrim(v_stop_json->>'pointKey'),
        btrim(v_stop_json->>'pointLabel'),
        NULLIF(btrim(v_stop_json->>'city'), ''),
        NULLIF(btrim(v_stop_json->>'address'), ''),
        v_eta,
        COALESCE((v_stop_json->>'serviceDurationMinutes')::integer, 30),
        'planned'
      );
    END IF;
  END LOOP;

  FOR v_link_json IN SELECT value FROM jsonb_array_elements(p_links)
  LOOP
    v_need_kind := v_link_json->>'needKind';
    v_need_source := v_link_json->>'needSource';
    v_need_id := (v_link_json->>'needId')::uuid;
    IF (v_need_source = 'outsourcing' AND v_need_kind <> 'outsourcing')
       OR (v_need_source = 'detailing_transfer' AND v_need_kind <> 'detailing')
       OR (v_need_source IN ('inventory_transfer', 'supply_schedule') AND v_need_kind <> 'materials')
       OR v_need_source NOT IN ('inventory_transfer', 'supply_schedule', 'detailing_transfer', 'outsourcing') THEN
      RAISE EXCEPTION 'Некорректный источник транспортной потребности';
    END IF;

    SELECT id INTO v_pickup_stop_id
    FROM public.transport_trip_stops
    WHERE transport_order_id = p_trip_id
      AND client_key = v_link_json->>'pickupStopClientId';
    SELECT id INTO v_delivery_stop_id
    FROM public.transport_trip_stops
    WHERE transport_order_id = p_trip_id
      AND client_key = v_link_json->>'deliveryStopClientId';
    IF v_pickup_stop_id IS NULL OR v_delivery_stop_id IS NULL THEN
      RAISE EXCEPTION 'Не найдены точки маршрута для потребности';
    END IF;

    SELECT id INTO v_existing_link_id
    FROM public.transport_trip_need_links
    WHERE transport_order_id = p_trip_id
      AND need_source = v_need_source
      AND need_id = v_need_id
      AND released_at IS NULL
    FOR UPDATE;

    IF v_existing_link_id IS NULL THEN
      v_composition_changed := true;
      IF v_need_source = 'supply_schedule' THEN
        PERFORM 1 FROM public.supply_order_delivery_schedules
        WHERE id = v_need_id AND status = 'planned'
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Поставка уже недоступна для рейса'; END IF;
      ELSIF v_need_source = 'detailing_transfer' THEN
        PERFORM 1 FROM public.detailing_transfers
        WHERE id = v_need_id AND status NOT IN ('completed', 'cancelled')
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Перевозка деталировки уже недоступна'; END IF;
      ELSIF v_need_source = 'inventory_transfer' THEN
        PERFORM 1 FROM public.inventory_transfers
        WHERE id = v_need_id AND status NOT IN ('completed', 'cancelled')
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Перевозка материалов уже недоступна'; END IF;
      END IF;

      INSERT INTO public.transport_trip_need_links (
        transport_order_id, need_kind, need_source, need_id, direction,
        source_point_key, source_point_label, destination_point_key,
        destination_point_label, need_title, need_subtitle, needed_date,
        pickup_stop_id, delivery_stop_id
      ) VALUES (
        p_trip_id, v_need_kind, v_need_source, v_need_id, v_link_json->>'direction',
        v_link_json->>'sourcePointKey', v_link_json->>'sourcePointLabel',
        v_link_json->>'destinationPointKey', v_link_json->>'destinationPointLabel',
        v_link_json->>'title', NULLIF(v_link_json->>'subtitle', ''),
        NULLIF(v_link_json->>'neededDate', '')::date,
        v_pickup_stop_id, v_delivery_stop_id
      );

      IF v_need_source = 'outsourcing' THEN
        UPDATE public.machine_outsourcing_transport_needs
        SET status = 'linked', transport_order_id = p_trip_id, updated_at = now()
        WHERE id = v_need_id AND status = 'open' AND plan_state = 'confirmed'
          AND transport_order_id IS NULL
        RETURNING task_id INTO v_task_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Потребность аутсорсинга уже занята или недоступна'; END IF;
        IF v_task_id IS NOT NULL THEN
          UPDATE public.tasks SET status = 'in_progress', updated_at = now()
          WHERE id = v_task_id AND status = 'pending';
        END IF;
      END IF;
    ELSE
      UPDATE public.transport_trip_need_links
      SET need_kind = v_need_kind,
          direction = v_link_json->>'direction',
          source_point_key = v_link_json->>'sourcePointKey',
          source_point_label = v_link_json->>'sourcePointLabel',
          destination_point_key = v_link_json->>'destinationPointKey',
          destination_point_label = v_link_json->>'destinationPointLabel',
          need_title = v_link_json->>'title',
          need_subtitle = NULLIF(v_link_json->>'subtitle', ''),
          needed_date = NULLIF(v_link_json->>'neededDate', '')::date,
          pickup_stop_id = v_pickup_stop_id,
          delivery_stop_id = v_delivery_stop_id
      WHERE id = v_existing_link_id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.transport_trip_need_links AS active_link
    JOIN public.transport_trip_stops AS pickup ON pickup.id = active_link.pickup_stop_id
    JOIN public.transport_trip_stops AS delivery ON delivery.id = active_link.delivery_stop_id
    WHERE active_link.transport_order_id = p_trip_id
      AND active_link.released_at IS NULL
      AND pickup.sequence_no >= delivery.sequence_no
  ) THEN RAISE EXCEPTION 'Доставка не может быть раньше забора'; END IF;

  SELECT string_agg(point_label, ' → ' ORDER BY sequence_no)
  INTO v_route
  FROM public.transport_trip_stops
  WHERE transport_order_id = p_trip_id;
  SELECT CASE WHEN count(DISTINCT direction) > 1 THEN 'mixed' ELSE min(direction) END
  INTO v_direction
  FROM public.transport_trip_need_links
  WHERE transport_order_id = p_trip_id
    AND released_at IS NULL;

  UPDATE public.machine_outsourcing_transport_orders
  SET direction = v_direction::public.outsourcing_transport_direction,
      route_start_key = (
        SELECT point_key FROM public.transport_trip_stops
        WHERE transport_order_id = p_trip_id ORDER BY sequence_no LIMIT 1
      ),
      route_start = (
        SELECT point_label FROM public.transport_trip_stops
        WHERE transport_order_id = p_trip_id ORDER BY sequence_no LIMIT 1
      ),
      route = v_route,
      updated_by = p_actor,
      updated_at = now()
  WHERE id = p_trip_id;

  -- A pending request describes an exact set of linked needs. Composition
  -- changes invalidate that snapshot, so v3 must either create a fresh request
  -- for the new set or clear the approval state when all dates now match.
  IF v_composition_changed AND EXISTS (
    SELECT 1 FROM public.transport_trip_date_change_requests
    WHERE transport_order_id = p_trip_id AND status = 'pending'
  ) THEN
    UPDATE public.tasks AS task
    SET status = 'completed', completed_at = now(), updated_at = now()
    FROM public.transport_trip_date_change_requests AS request
    WHERE request.transport_order_id = p_trip_id
      AND request.status = 'pending'
      AND request.task_id = task.id;
    UPDATE public.transport_trip_date_change_items AS item
    SET status = 'rejected', decided_at = now()
    FROM public.transport_trip_date_change_requests AS request
    WHERE request.transport_order_id = p_trip_id
      AND request.status = 'pending'
      AND item.request_id = request.id;
    UPDATE public.transport_trip_date_change_requests
    SET status = 'rejected',
        decided_by = p_actor,
        decided_at = now(),
        decision_comment = 'Заменён после изменения состава рейса',
        updated_at = now()
    WHERE transport_order_id = p_trip_id
      AND status = 'pending';
    UPDATE public.machine_outsourcing_transport_orders
    SET date_change_state = 'not_required'
    WHERE id = p_trip_id;
  END IF;

  RETURN public.fn_update_transport_trip_v3(
    p_trip_id,
    v_trip.status,
    p_carrier_supplier_id,
    p_scheduled_date,
    p_price,
    v_route,
    p_comment,
    NULL,
    p_date_change_reason,
    p_actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_cancel_transport_trip_v1(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancel_transport_trip_v1(uuid, text, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.fn_update_transport_trip_v4(
  uuid, uuid, date, numeric, text, jsonb, jsonb, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip_v4(
  uuid, uuid, date, numeric, text, jsonb, jsonb, text, text, uuid
) TO service_role;
