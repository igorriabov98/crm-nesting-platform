-- Hired transport starts work at the first pickup. New trips therefore no
-- longer create a separate, already-completed departure stop before it.
CREATE OR REPLACE FUNCTION public.fn_create_transport_trip_v2(
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_comment text,
  p_stops jsonb,
  p_links jsonb,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip_id uuid;
  v_stop jsonb;
  v_link jsonb;
  v_stop_id uuid;
  v_pickup_stop_id uuid;
  v_delivery_stop_id uuid;
  v_need_id uuid;
  v_need_kind text;
  v_need_source text;
  v_task_id uuid;
  v_direction_text text;
  v_route text;
  v_first_stop jsonb;
  v_eta timestamptz;
  v_previous_eta timestamptz;
  v_ordinal bigint;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан автор рейса'; END IF;
  IF p_carrier_supplier_id IS NULL THEN RAISE EXCEPTION 'Укажите перевозчика'; END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'Укажите дату рейса'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'Укажите корректную цену рейса'; END IF;
  IF jsonb_typeof(p_stops) IS DISTINCT FROM 'array' OR jsonb_array_length(p_stops) < 2 THEN
    RAISE EXCEPTION 'Добавьте точки забора и доставки';
  END IF;
  IF jsonb_typeof(p_links) IS DISTINCT FROM 'array' OR jsonb_array_length(p_links) = 0 THEN
    RAISE EXCEPTION 'Выберите хотя бы одну потребность';
  END IF;

  v_first_stop := p_stops->0;
  IF v_first_stop->>'kind' IS DISTINCT FROM 'service' THEN
    RAISE EXCEPTION 'Маршрут должен начинаться с точки забора';
  END IF;

  SELECT CASE WHEN count(DISTINCT value->>'direction') > 1
      THEN 'mixed' ELSE min(value->>'direction') END
  INTO v_direction_text
  FROM jsonb_array_elements(p_links);

  SELECT string_agg(value->>'pointLabel', ' → ' ORDER BY ordinality)
  INTO v_route
  FROM jsonb_array_elements(p_stops) WITH ORDINALITY AS stop(value, ordinality);

  INSERT INTO public.machine_outsourcing_transport_orders (
    direction, status, carrier_supplier_id, scheduled_date, price,
    route_start_key, route_start, route, comment, created_by, updated_by
  ) VALUES (
    v_direction_text::public.outsourcing_transport_direction,
    'found', p_carrier_supplier_id, p_scheduled_date, p_price,
    btrim(v_first_stop->>'pointKey'), btrim(v_first_stop->>'pointLabel'),
    v_route, NULLIF(btrim(p_comment), ''), p_actor, p_actor
  ) RETURNING id INTO v_trip_id;

  FOR v_stop, v_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_stops) WITH ORDINALITY
  LOOP
    IF v_stop->>'kind' NOT IN ('service', 'finish') THEN
      RAISE EXCEPTION 'Отдельная точка выезда больше не используется';
    END IF;
    IF v_ordinal = 1 AND v_stop->>'kind' <> 'service' THEN
      RAISE EXCEPTION 'Первая точка должна быть точкой забора';
    END IF;
    IF v_stop->>'kind' = 'finish' AND v_ordinal <> jsonb_array_length(p_stops) THEN
      RAISE EXCEPTION 'Точка завершения может быть только последней';
    END IF;
    IF (v_stop->>'pointKey') LIKE 'supplier:%'
       AND NULLIF(btrim(v_stop->>'city'), '') IS NULL THEN
      RAISE EXCEPTION 'Для компании в маршруте должен быть указан город';
    END IF;
    v_eta := (v_stop->>'plannedArrivalAt')::timestamptz;
    IF v_previous_eta IS NOT NULL AND v_eta <= v_previous_eta THEN
      RAISE EXCEPTION 'Время остановок должно идти по порядку';
    END IF;
    v_previous_eta := v_eta;

    INSERT INTO public.transport_trip_stops (
      transport_order_id, client_key, sequence_no, stop_kind,
      point_key, point_label, city, address, planned_arrival_at,
      service_duration_minutes, status, completed_at
    ) VALUES (
      v_trip_id, v_stop->>'clientId', (v_ordinal - 1)::integer, v_stop->>'kind',
      btrim(v_stop->>'pointKey'), btrim(v_stop->>'pointLabel'),
      NULLIF(btrim(v_stop->>'city'), ''), NULLIF(btrim(v_stop->>'address'), ''),
      v_eta, COALESCE((v_stop->>'serviceDurationMinutes')::integer, 30),
      'planned', NULL
    ) RETURNING id INTO v_stop_id;
  END LOOP;

  FOR v_link IN SELECT value FROM jsonb_array_elements(p_links)
  LOOP
    v_need_kind := v_link->>'needKind';
    v_need_source := v_link->>'needSource';
    v_need_id := (v_link->>'needId')::uuid;
    IF (v_need_source = 'outsourcing' AND v_need_kind <> 'outsourcing')
       OR (v_need_source = 'detailing_transfer' AND v_need_kind <> 'detailing')
       OR (v_need_source IN ('inventory_transfer', 'supply_schedule') AND v_need_kind <> 'materials')
       OR v_need_source NOT IN ('inventory_transfer', 'supply_schedule', 'detailing_transfer', 'outsourcing') THEN
      RAISE EXCEPTION 'Некорректный источник транспортной потребности';
    END IF;
    SELECT id INTO v_pickup_stop_id
    FROM public.transport_trip_stops
    WHERE transport_order_id = v_trip_id
      AND client_key = v_link->>'pickupStopClientId';
    SELECT id INTO v_delivery_stop_id
    FROM public.transport_trip_stops
    WHERE transport_order_id = v_trip_id
      AND client_key = v_link->>'deliveryStopClientId';
    IF v_pickup_stop_id IS NULL OR v_delivery_stop_id IS NULL THEN
      RAISE EXCEPTION 'Не найдены точки маршрута для потребности';
    END IF;

    INSERT INTO public.transport_trip_need_links (
      transport_order_id, need_kind, need_source, need_id, direction,
      source_point_key, source_point_label, destination_point_key,
      destination_point_label, need_title, need_subtitle, needed_date,
      pickup_stop_id, delivery_stop_id
    ) VALUES (
      v_trip_id, v_need_kind, v_need_source, v_need_id, v_link->>'direction',
      v_link->>'sourcePointKey', v_link->>'sourcePointLabel',
      v_link->>'destinationPointKey', v_link->>'destinationPointLabel',
      v_link->>'title', NULLIF(v_link->>'subtitle', ''),
      NULLIF(v_link->>'neededDate', '')::date,
      v_pickup_stop_id, v_delivery_stop_id
    );

    IF v_need_source = 'outsourcing' THEN
      UPDATE public.machine_outsourcing_transport_needs
      SET status = 'linked', transport_order_id = v_trip_id, updated_at = now()
      WHERE id = v_need_id AND status = 'open' AND plan_state = 'confirmed'
        AND transport_order_id IS NULL
      RETURNING task_id INTO v_task_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Потребность аутсорсинга уже занята или недоступна'; END IF;
      IF v_task_id IS NOT NULL THEN
        UPDATE public.tasks SET status = 'in_progress', updated_at = now()
        WHERE id = v_task_id AND status = 'pending';
      END IF;
    ELSIF v_need_source = 'detailing_transfer' THEN
      PERFORM public.fn_set_detailing_transfer_date(v_need_id, p_scheduled_date, p_actor);
    ELSIF v_need_source = 'inventory_transfer' THEN
      PERFORM public.fn_set_inventory_transfer_date(v_need_id, p_scheduled_date, p_actor);
    ELSIF v_need_source = 'supply_schedule' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Неизвестная категория транспортной потребности';
    END IF;
  END LOOP;

  RETURN v_trip_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_transport_trip_v2(uuid, date, numeric, text, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_transport_trip_v2(uuid, date, numeric, text, jsonb, jsonb, uuid)
  TO service_role;
