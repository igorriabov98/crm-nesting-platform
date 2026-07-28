ALTER TYPE public.outsourcing_transport_direction
  ADD VALUE IF NOT EXISTS 'mixed';

CREATE TABLE IF NOT EXISTS public.transport_trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_order_id uuid NOT NULL
    REFERENCES public.machine_outsourcing_transport_orders(id) ON DELETE CASCADE,
  client_key text NOT NULL CHECK (btrim(client_key) <> ''),
  sequence_no integer NOT NULL CHECK (sequence_no >= 0),
  stop_kind text NOT NULL CHECK (stop_kind IN ('start', 'service', 'finish')),
  point_key text NOT NULL CHECK (btrim(point_key) <> ''),
  point_label text NOT NULL CHECK (btrim(point_label) <> ''),
  city text,
  address text,
  planned_arrival_at timestamptz,
  service_duration_minutes integer NOT NULL DEFAULT 30
    CHECK (service_duration_minutes BETWEEN 0 AND 1440),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'arrived', 'completed')),
  arrived_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transport_order_id, client_key),
  UNIQUE (transport_order_id, sequence_no)
);

CREATE INDEX IF NOT EXISTS idx_transport_trip_stops_order
  ON public.transport_trip_stops(transport_order_id, sequence_no);

ALTER TABLE public.transport_trip_need_links
  ADD COLUMN IF NOT EXISTS need_source text,
  ADD COLUMN IF NOT EXISTS pickup_stop_id uuid
    REFERENCES public.transport_trip_stops(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS delivery_stop_id uuid
    REFERENCES public.transport_trip_stops(id) ON DELETE RESTRICT;

UPDATE public.transport_trip_need_links
SET need_source = CASE need_kind
  WHEN 'outsourcing' THEN 'outsourcing'
  WHEN 'detailing' THEN 'detailing_transfer'
  ELSE 'inventory_transfer'
END
WHERE need_source IS NULL;

ALTER TABLE public.transport_trip_need_links
  ALTER COLUMN need_source SET NOT NULL,
  DROP CONSTRAINT IF EXISTS transport_trip_need_links_need_source_check;
ALTER TABLE public.transport_trip_need_links
  ADD CONSTRAINT transport_trip_need_links_need_source_check
    CHECK (need_source IN ('inventory_transfer', 'supply_schedule', 'detailing_transfer', 'outsourcing'));

DROP INDEX IF EXISTS public.idx_transport_trip_need_links_one_active;
CREATE UNIQUE INDEX idx_transport_trip_need_links_one_active
  ON public.transport_trip_need_links(need_source, need_id)
  WHERE released_at IS NULL;

INSERT INTO public.transport_trip_stops (
  transport_order_id,
  client_key,
  sequence_no,
  stop_kind,
  point_key,
  point_label,
  service_duration_minutes,
  status
)
SELECT
  trip.id,
  'legacy:start',
  0,
  'start',
  trip.route_start_key,
  trip.route_start,
  0,
  CASE WHEN trip.status IN ('in_transit', 'completed') THEN 'completed' ELSE 'planned' END
FROM public.machine_outsourcing_transport_orders AS trip
WHERE trip.route_start_key IS NOT NULL
  AND trip.route_start IS NOT NULL
ON CONFLICT (transport_order_id, client_key) DO NOTHING;

WITH destinations AS (
  SELECT
    link.transport_order_id,
    link.destination_point_key,
    min(link.destination_point_label) AS destination_point_label,
    min(link.created_at) AS first_seen
  FROM public.transport_trip_need_links AS link
  GROUP BY link.transport_order_id, link.destination_point_key
), numbered AS (
  SELECT
    destination.*,
    row_number() OVER (
      PARTITION BY destination.transport_order_id
      ORDER BY destination.first_seen, destination.destination_point_key
    ) AS destination_sequence
  FROM destinations AS destination
)
INSERT INTO public.transport_trip_stops (
  transport_order_id,
  client_key,
  sequence_no,
  stop_kind,
  point_key,
  point_label,
  service_duration_minutes,
  status
)
SELECT
  numbered.transport_order_id,
  'legacy:destination:' || md5(numbered.destination_point_key),
  numbered.destination_sequence::integer,
  'service',
  numbered.destination_point_key,
  numbered.destination_point_label,
  30,
  CASE WHEN trip.status = 'completed' THEN 'completed' ELSE 'planned' END
FROM numbered
JOIN public.machine_outsourcing_transport_orders AS trip
  ON trip.id = numbered.transport_order_id
ON CONFLICT (transport_order_id, client_key) DO NOTHING;

UPDATE public.transport_trip_need_links AS link
SET pickup_stop_id = pickup.id,
    delivery_stop_id = delivery.id
FROM public.transport_trip_stops AS pickup,
     public.transport_trip_stops AS delivery
WHERE pickup.transport_order_id = link.transport_order_id
  AND delivery.transport_order_id = link.transport_order_id
  AND pickup.point_key = link.source_point_key
  AND delivery.point_key = link.destination_point_key
  AND pickup.sequence_no < delivery.sequence_no
  AND link.pickup_stop_id IS NULL
  AND link.delivery_stop_id IS NULL;

CREATE OR REPLACE FUNCTION public.validate_transport_trip_need_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_pickup public.transport_trip_stops%ROWTYPE;
  v_delivery public.transport_trip_stops%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.machine_outsourcing_transport_orders AS trip
    WHERE trip.id = NEW.transport_order_id
  ) THEN
    RAISE EXCEPTION 'Transport trip not found';
  END IF;

  IF NEW.pickup_stop_id IS NULL AND NEW.delivery_stop_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.pickup_stop_id IS NULL OR NEW.delivery_stop_id IS NULL THEN
    RAISE EXCEPTION 'Both pickup and delivery stops are required';
  END IF;

  SELECT * INTO v_pickup
  FROM public.transport_trip_stops
  WHERE id = NEW.pickup_stop_id;
  SELECT * INTO v_delivery
  FROM public.transport_trip_stops
  WHERE id = NEW.delivery_stop_id;

  IF v_pickup.transport_order_id IS DISTINCT FROM NEW.transport_order_id
     OR v_delivery.transport_order_id IS DISTINCT FROM NEW.transport_order_id THEN
    RAISE EXCEPTION 'Transport stops must belong to the linked trip';
  END IF;
  IF v_pickup.point_key IS DISTINCT FROM NEW.source_point_key
     OR v_delivery.point_key IS DISTINCT FROM NEW.destination_point_key THEN
    RAISE EXCEPTION 'Transport stops do not match need endpoints';
  END IF;
  IF v_pickup.sequence_no >= v_delivery.sequence_no THEN
    RAISE EXCEPTION 'Delivery stop must be after pickup stop';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transport_trip_need_link_validate
  ON public.transport_trip_need_links;
CREATE TRIGGER transport_trip_need_link_validate
  BEFORE INSERT OR UPDATE OF transport_order_id, source_point_key,
    destination_point_key, pickup_stop_id, delivery_stop_id
  ON public.transport_trip_need_links
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_transport_trip_need_link();

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
    RAISE EXCEPTION 'Добавьте точку выезда и хотя бы одну остановку';
  END IF;
  IF jsonb_typeof(p_links) IS DISTINCT FROM 'array' OR jsonb_array_length(p_links) = 0 THEN
    RAISE EXCEPTION 'Выберите хотя бы одну потребность';
  END IF;

  v_first_stop := p_stops->0;
  IF v_first_stop->>'kind' IS DISTINCT FROM 'start' THEN
    RAISE EXCEPTION 'Первая точка маршрута должна быть точкой выезда';
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
    IF v_stop->>'kind' NOT IN ('start', 'service', 'finish') THEN
      RAISE EXCEPTION 'Некорректный тип остановки';
    END IF;
    IF v_ordinal = 1 AND v_stop->>'kind' <> 'start' THEN
      RAISE EXCEPTION 'Первая точка должна быть точкой выезда';
    END IF;
    IF v_stop->>'kind' = 'start' AND v_ordinal <> 1 THEN
      RAISE EXCEPTION 'Точка выезда может быть только первой';
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
      CASE WHEN v_stop->>'kind' = 'start' THEN 'completed' ELSE 'planned' END,
      CASE WHEN v_stop->>'kind' = 'start' THEN v_eta ELSE NULL END
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
      RAISE EXCEPTION 'Не найдена точка забора или доставки';
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

CREATE OR REPLACE FUNCTION public.fn_update_transport_trip_plan(
  p_trip_id uuid,
  p_stops jsonb,
  p_actor uuid
) RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
  v_stop jsonb;
  v_existing public.transport_trip_stops%ROWTYPE;
  v_eta timestamptz;
  v_previous_eta timestamptz;
  v_route text;
  v_ordinal bigint;
BEGIN
  SELECT * INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Рейс не найден'; END IF;
  IF v_trip.status <> 'found' THEN
    RAISE EXCEPTION 'Порядок остановок можно менять только до начала движения';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;
  IF jsonb_typeof(p_stops) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_stops) <> (
       SELECT count(*) FROM public.transport_trip_stops WHERE transport_order_id = p_trip_id
     ) THEN
    RAISE EXCEPTION 'Состав остановок не совпадает с рейсом';
  END IF;

  UPDATE public.transport_trip_stops
  SET sequence_no = sequence_no + 1000
  WHERE transport_order_id = p_trip_id;

  FOR v_stop, v_ordinal IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_stops) WITH ORDINALITY
  LOOP
    SELECT * INTO v_existing
    FROM public.transport_trip_stops
    WHERE id = (v_stop->>'id')::uuid
      AND transport_order_id = p_trip_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Остановка не принадлежит рейсу'; END IF;
    IF v_existing.stop_kind = 'start' AND v_ordinal <> 1 THEN
      RAISE EXCEPTION 'Точка выезда должна оставаться первой';
    END IF;
    IF v_existing.stop_kind = 'finish' AND v_ordinal <> jsonb_array_length(p_stops) THEN
      RAISE EXCEPTION 'Точка завершения должна оставаться последней';
    END IF;
    v_eta := NULLIF(v_stop->>'plannedArrivalAt', '')::timestamptz;
    IF v_previous_eta IS NOT NULL AND v_eta IS NOT NULL AND v_eta <= v_previous_eta THEN
      RAISE EXCEPTION 'Время остановок должно идти по порядку';
    END IF;
    IF v_eta IS NOT NULL THEN v_previous_eta := v_eta; END IF;
    UPDATE public.transport_trip_stops
    SET sequence_no = (v_ordinal - 1)::integer,
        planned_arrival_at = v_eta,
        service_duration_minutes = COALESCE((v_stop->>'serviceDurationMinutes')::integer, 30),
        updated_at = now()
    WHERE id = v_existing.id;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM public.transport_trip_need_links AS link
    JOIN public.transport_trip_stops AS pickup ON pickup.id = link.pickup_stop_id
    JOIN public.transport_trip_stops AS delivery ON delivery.id = link.delivery_stop_id
    WHERE link.transport_order_id = p_trip_id
      AND link.released_at IS NULL
      AND pickup.sequence_no >= delivery.sequence_no
  ) THEN
    RAISE EXCEPTION 'Доставка не может быть раньше забора';
  END IF;

  SELECT string_agg(point_label, ' → ' ORDER BY sequence_no)
  INTO v_route
  FROM public.transport_trip_stops
  WHERE transport_order_id = p_trip_id;

  UPDATE public.machine_outsourcing_transport_orders
  SET route = v_route,
      route_start_key = (
        SELECT point_key FROM public.transport_trip_stops
        WHERE transport_order_id = p_trip_id ORDER BY sequence_no LIMIT 1
      ),
      route_start = (
        SELECT point_label FROM public.transport_trip_stops
        WHERE transport_order_id = p_trip_id ORDER BY sequence_no LIMIT 1
      ),
      updated_by = p_actor,
      updated_at = now()
  WHERE id = p_trip_id;

  RETURN v_route;
END;
$$;

-- Transport orchestration runs through a server action using the service-role
-- client after requirePermission has resolved the real CRM actor. The shared
-- transfer guards must therefore accept that trusted server context while
-- preserving their original checks for direct authenticated RPC calls.
CREATE OR REPLACE FUNCTION public.detailing_assert_actor(
  p_actor uuid,
  p_roles public.user_role[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Не указан пользователь';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'Действие должно выполняться от имени текущего пользователя';
    END IF;
    IF NOT public.detailing_role_allowed(p_roles) THEN
      RAISE EXCEPTION 'Недостаточно прав для операции с деталировкой';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_assert_actor(
  p_actor uuid,
  p_roles public.user_role[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Не указан пользователь';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'Действие должно выполняться от имени текущего пользователя';
    END IF;
    IF NOT public.inventory_transfer_role_allowed(p_roles) THEN
      RAISE EXCEPTION 'Недостаточно прав для межскладской операции';
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_transport_trip(
  p_trip_id uuid,
  p_status public.outsourcing_transport_order_status,
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_route text,
  p_comment text,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
  v_link public.transport_trip_need_links%ROWTYPE;
  v_need public.machine_outsourcing_transport_needs%ROWTYPE;
  v_fact_field text;
BEGIN
  SELECT * INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Рейс не найден'; END IF;
  IF v_trip.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Завершённый или отменённый рейс нельзя изменить';
  END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь, изменяющий рейс'; END IF;
  IF p_carrier_supplier_id IS NULL THEN RAISE EXCEPTION 'Укажите перевозчика'; END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'Укажите дату рейса'; END IF;
  IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'Укажите корректную цену рейса'; END IF;
  IF NULLIF(btrim(p_route), '') IS NULL
     OR NOT (
       lower(btrim(p_route)) = lower(btrim(v_trip.route_start))
       OR lower(btrim(p_route)) LIKE lower(btrim(v_trip.route_start)) || ' → %'
     ) THEN
    RAISE EXCEPTION 'Маршрут должен начинаться со стартовой точки рейса';
  END IF;

  UPDATE public.machine_outsourcing_transport_orders
  SET status = p_status,
      carrier_supplier_id = p_carrier_supplier_id,
      scheduled_date = p_scheduled_date,
      price = p_price,
      route = btrim(p_route),
      comment = NULLIF(btrim(p_comment), ''),
      updated_by = p_actor,
      updated_at = now()
  WHERE id = p_trip_id;

  FOR v_link IN
    SELECT * FROM public.transport_trip_need_links
    WHERE transport_order_id = p_trip_id AND released_at IS NULL
  LOOP
    IF p_status = 'cancelled' THEN
      IF v_link.need_source = 'outsourcing' THEN
        UPDATE public.machine_outsourcing_transport_needs
        SET status = 'open', transport_order_id = NULL, updated_at = now()
        WHERE id = v_link.need_id
        RETURNING * INTO v_need;
        IF v_need.task_id IS NOT NULL THEN
          UPDATE public.tasks
          SET status = 'pending', completed_at = NULL, updated_at = now()
          WHERE id = v_need.task_id;
        END IF;
      END IF;
      CONTINUE;
    END IF;

    IF v_link.need_source = 'detailing_transfer' THEN
      PERFORM public.fn_set_detailing_transfer_date(v_link.need_id, p_scheduled_date, p_actor);
    ELSIF v_link.need_source = 'inventory_transfer' THEN
      PERFORM public.fn_set_inventory_transfer_date(v_link.need_id, p_scheduled_date, p_actor);
    ELSIF v_link.need_source = 'outsourcing' AND p_status = 'completed' THEN
      UPDATE public.machine_outsourcing_transport_needs
      SET status = 'completed', updated_at = now()
      WHERE id = v_link.need_id
      RETURNING * INTO v_need;
      IF v_need.task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = v_need.task_id;
      END IF;
      v_fact_field := CASE WHEN v_need.direction = 'outbound'
        THEN 'actual_sent_at' ELSE 'actual_returned_at' END;
      EXECUTE format(
        'UPDATE public.machine_outsourcing_operations
         SET %I = $1, updated_by = $2, updated_at = now()
         WHERE id = $3',
        v_fact_field
      ) USING p_scheduled_date, p_actor, v_need.operation_id;
    END IF;
  END LOOP;

  IF p_status = 'cancelled' THEN
    UPDATE public.transport_trip_need_links
    SET released_at = now()
    WHERE transport_order_id = p_trip_id AND released_at IS NULL;
  END IF;
  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_transport_trip_v2(
  p_trip_id uuid,
  p_status public.outsourcing_transport_order_status,
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_route text,
  p_comment text,
  p_stops jsonb,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_route text;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;
  IF p_stops IS NOT NULL THEN
    v_route := public.fn_update_transport_trip_plan(p_trip_id, p_stops, p_actor);
  ELSE
    SELECT string_agg(stop.point_label, ' → ' ORDER BY stop.sequence_no)
    INTO v_route
    FROM public.transport_trip_stops AS stop
    WHERE stop.transport_order_id = p_trip_id;
  END IF;
  v_route := COALESCE(v_route, p_route);

  RETURN public.fn_update_transport_trip(
    p_trip_id,
    p_status,
    p_carrier_supplier_id,
    p_scheduled_date,
    p_price,
    v_route,
    p_comment,
    p_actor
  );
END;
$$;

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
  SELECT * INTO v_stop FROM public.transport_trip_stops WHERE id = p_stop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Остановка не найдена'; END IF;
  SELECT * INTO v_trip FROM public.machine_outsourcing_transport_orders
  WHERE id = v_stop.transport_order_id FOR UPDATE;
  IF v_trip.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Завершённый или отменённый рейс нельзя изменить';
  END IF;
  IF v_stop.stop_kind = 'start' THEN RAISE EXCEPTION 'Точка выезда не требует отметки'; END IF;
  IF p_status = 'arrived' AND v_stop.status <> 'planned' THEN
    RAISE EXCEPTION 'Остановку уже начали или завершили';
  END IF;
  IF p_status = 'completed' AND v_stop.status <> 'arrived' THEN
    RAISE EXCEPTION 'Сначала отметьте прибытие';
  END IF;
  IF p_status NOT IN ('arrived', 'completed') THEN RAISE EXCEPTION 'Некорректный статус остановки'; END IF;
  IF p_status = 'arrived' AND EXISTS (
    SELECT 1 FROM public.transport_trip_stops AS previous
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

  IF v_trip.status = 'found' THEN
    UPDATE public.machine_outsourcing_transport_orders
    SET status = 'in_transit', updated_by = p_actor, updated_at = now()
    WHERE id = v_trip.id;
  END IF;

  IF p_status = 'completed' AND NOT EXISTS (
    SELECT 1 FROM public.transport_trip_stops AS pending
    WHERE pending.transport_order_id = v_stop.transport_order_id
      AND pending.stop_kind <> 'start'
      AND pending.status <> 'completed'
  ) THEN
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
  END IF;

  RETURN p_status;
END;
$$;

ALTER TABLE public.transport_trip_stops ENABLE ROW LEVEL SECURITY;

CREATE POLICY transport_trip_stops_select
  ON public.transport_trip_stops
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_director())
    OR (SELECT public.get_user_role()) IN ('supply_manager', 'procurement_head', 'production_manager')
  );

CREATE POLICY transport_trip_stops_service_role_modify
  ON public.transport_trip_stops
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.transport_trip_stops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trip_stops TO service_role;

REVOKE ALL ON FUNCTION public.fn_create_transport_trip_v2(uuid, date, numeric, text, jsonb, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_transport_trip_v2(uuid, date, numeric, text, jsonb, jsonb, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.fn_update_transport_trip_plan(uuid, jsonb, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip_plan(uuid, jsonb, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.fn_update_transport_trip_v2(
  uuid, public.outsourcing_transport_order_status, uuid, date, numeric, text, text, jsonb, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip_v2(
  uuid, public.outsourcing_transport_order_status, uuid, date, numeric, text, text, jsonb, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.fn_update_transport_trip_stop_status(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip_stop_status(uuid, text, uuid)
  TO service_role;
