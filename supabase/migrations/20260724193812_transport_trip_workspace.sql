ALTER TABLE public.machine_outsourcing_transport_orders
  ADD COLUMN IF NOT EXISTS route_start_key text,
  ADD COLUMN IF NOT EXISTS route_start text,
  ADD COLUMN IF NOT EXISTS route text;

ALTER TABLE public.machine_outsourcing_transport_orders
  DROP CONSTRAINT IF EXISTS machine_outsourcing_transport_orders_route_start_key_check,
  DROP CONSTRAINT IF EXISTS machine_outsourcing_transport_orders_route_start_check,
  DROP CONSTRAINT IF EXISTS machine_outsourcing_transport_orders_route_check,
  DROP CONSTRAINT IF EXISTS machine_outsourcing_transport_orders_route_prefix_check;

ALTER TABLE public.machine_outsourcing_transport_orders
  ADD CONSTRAINT machine_outsourcing_transport_orders_route_start_key_check
    CHECK (route_start_key IS NULL OR btrim(route_start_key) <> ''),
  ADD CONSTRAINT machine_outsourcing_transport_orders_route_start_check
    CHECK (route_start IS NULL OR btrim(route_start) <> ''),
  ADD CONSTRAINT machine_outsourcing_transport_orders_route_check
    CHECK (route IS NULL OR btrim(route) <> ''),
  ADD CONSTRAINT machine_outsourcing_transport_orders_route_prefix_check
    CHECK (
      route IS NULL
      OR route_start IS NULL
      OR lower(btrim(route)) = lower(btrim(route_start))
      OR lower(btrim(route)) LIKE lower(btrim(route_start)) || ' → %'
    );

CREATE TABLE IF NOT EXISTS public.transport_trip_need_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_order_id uuid NOT NULL
    REFERENCES public.machine_outsourcing_transport_orders(id) ON DELETE CASCADE,
  need_kind text NOT NULL
    CHECK (need_kind IN ('materials', 'detailing', 'outsourcing')),
  need_id uuid NOT NULL,
  direction text NOT NULL
    CHECK (direction IN ('outbound', 'return')),
  source_point_key text NOT NULL CHECK (btrim(source_point_key) <> ''),
  source_point_label text NOT NULL CHECK (btrim(source_point_label) <> ''),
  destination_point_key text NOT NULL CHECK (btrim(destination_point_key) <> ''),
  destination_point_label text NOT NULL CHECK (btrim(destination_point_label) <> ''),
  need_title text NOT NULL CHECK (btrim(need_title) <> ''),
  need_subtitle text,
  needed_date date,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transport_trip_need_links_order
  ON public.transport_trip_need_links(transport_order_id, created_at);

CREATE INDEX IF NOT EXISTS idx_transport_trip_need_links_active_start
  ON public.transport_trip_need_links(source_point_key, need_kind)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_trip_need_links_one_active
  ON public.transport_trip_need_links(need_kind, need_id)
  WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION public.validate_transport_trip_need_link()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_direction text;
  v_route_start_key text;
BEGIN
  SELECT trip.direction::text, trip.route_start_key
  INTO v_direction, v_route_start_key
  FROM public.machine_outsourcing_transport_orders AS trip
  WHERE trip.id = NEW.transport_order_id;

  IF v_direction IS NULL THEN
    RAISE EXCEPTION 'Transport trip not found';
  END IF;

  IF v_direction IS DISTINCT FROM NEW.direction THEN
    RAISE EXCEPTION 'Transport trip direction must match the need direction';
  END IF;

  IF v_route_start_key IS NOT NULL
     AND v_route_start_key IS DISTINCT FROM NEW.source_point_key THEN
    RAISE EXCEPTION 'Transport trip start must match the need source point';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transport_trip_need_link_validate
  ON public.transport_trip_need_links;
CREATE TRIGGER transport_trip_need_link_validate
  BEFORE INSERT OR UPDATE OF transport_order_id, direction, source_point_key
  ON public.transport_trip_need_links
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_transport_trip_need_link();

INSERT INTO public.transport_trip_need_links (
  transport_order_id,
  need_kind,
  need_id,
  direction,
  source_point_key,
  source_point_label,
  destination_point_key,
  destination_point_label,
  need_title,
  need_subtitle,
  needed_date,
  released_at
)
SELECT
  need.transport_order_id,
  'outsourcing',
  need.id,
  need.direction::text,
  CASE
    WHEN need.direction = 'outbound' THEN 'factory:' || machine.factory_id::text
    WHEN operation.executor_type = 'factory' THEN 'factory:' || operation.executor_factory_id::text
    ELSE 'supplier:' || operation.supplier_id::text
  END,
  CASE
    WHEN need.direction = 'outbound' THEN source_factory.name
    WHEN operation.executor_type = 'factory' THEN executor_factory.name
    ELSE supplier.name
  END,
  CASE
    WHEN need.direction = 'return' THEN 'factory:' || machine.factory_id::text
    WHEN operation.executor_type = 'factory' THEN 'factory:' || operation.executor_factory_id::text
    ELSE 'supplier:' || operation.supplier_id::text
  END,
  CASE
    WHEN need.direction = 'return' THEN source_factory.name
    WHEN operation.executor_type = 'factory' THEN executor_factory.name
    ELSE supplier.name
  END,
  machine.name,
  COALESCE(work_type.name, 'Аутсорсинг'),
  need.needed_date,
  CASE WHEN trip.status = 'cancelled' THEN COALESCE(trip.updated_at, now()) ELSE NULL END
FROM public.machine_outsourcing_transport_needs AS need
JOIN public.machine_outsourcing_transport_orders AS trip
  ON trip.id = need.transport_order_id
JOIN public.machine_outsourcing_operations AS operation
  ON operation.id = need.operation_id
JOIN public.machines AS machine
  ON machine.id = operation.machine_id
LEFT JOIN public.factories AS source_factory
  ON source_factory.id = machine.factory_id
LEFT JOIN public.factories AS executor_factory
  ON executor_factory.id = operation.executor_factory_id
LEFT JOIN public.suppliers AS supplier
  ON supplier.id = operation.supplier_id
LEFT JOIN public.outsourcing_work_types AS work_type
  ON work_type.id = operation.work_type_id
WHERE need.transport_order_id IS NOT NULL
  AND machine.factory_id IS NOT NULL
  AND (
    operation.executor_factory_id IS NOT NULL
    OR operation.supplier_id IS NOT NULL
  )
ON CONFLICT DO NOTHING;

WITH trip_routes AS (
  SELECT
    link.transport_order_id,
    min(link.source_point_key) AS route_start_key,
    min(link.source_point_label) AS route_start,
    min(link.source_point_label)
      || ' → '
      || string_agg(
        DISTINCT link.destination_point_label,
        ' → ' ORDER BY link.destination_point_label
      ) AS route
  FROM public.transport_trip_need_links AS link
  WHERE link.released_at IS NULL
  GROUP BY link.transport_order_id
  HAVING count(DISTINCT link.source_point_key) = 1
)
UPDATE public.machine_outsourcing_transport_orders AS trip
SET route_start_key = COALESCE(trip.route_start_key, trip_routes.route_start_key),
    route_start = COALESCE(trip.route_start, trip_routes.route_start),
    route = COALESCE(trip.route, trip_routes.route)
FROM trip_routes
WHERE trip.id = trip_routes.transport_order_id;

CREATE OR REPLACE FUNCTION public.fn_create_transport_trip(
  p_direction public.outsourcing_transport_direction,
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_route_start_key text,
  p_route_start text,
  p_route text,
  p_comment text,
  p_links jsonb,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_trip_id uuid;
  v_link jsonb;
  v_need_id uuid;
  v_need_kind text;
  v_task_id uuid;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Не указан автор рейса';
  END IF;
  IF p_carrier_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Укажите перевозчика';
  END IF;
  IF p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Укажите дату рейса';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'Укажите корректную цену рейса';
  END IF;
  IF NULLIF(btrim(p_route_start_key), '') IS NULL
     OR NULLIF(btrim(p_route_start), '') IS NULL THEN
    RAISE EXCEPTION 'Не удалось определить стартовую точку рейса';
  END IF;
  IF NULLIF(btrim(p_route), '') IS NULL
     OR NOT (
       lower(btrim(p_route)) = lower(btrim(p_route_start))
       OR lower(btrim(p_route)) LIKE lower(btrim(p_route_start)) || ' → %'
     ) THEN
    RAISE EXCEPTION 'Маршрут должен начинаться со стартовой точки потребности';
  END IF;
  IF jsonb_typeof(p_links) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_links) = 0 THEN
    RAISE EXCEPTION 'Выберите хотя бы одну потребность';
  END IF;

  INSERT INTO public.machine_outsourcing_transport_orders (
    direction,
    status,
    carrier_supplier_id,
    scheduled_date,
    price,
    route_start_key,
    route_start,
    route,
    comment,
    created_by,
    updated_by
  ) VALUES (
    p_direction,
    'found',
    p_carrier_supplier_id,
    p_scheduled_date,
    p_price,
    btrim(p_route_start_key),
    btrim(p_route_start),
    btrim(p_route),
    NULLIF(btrim(p_comment), ''),
    p_actor,
    p_actor
  )
  RETURNING id INTO v_trip_id;

  FOR v_link IN
    SELECT value FROM jsonb_array_elements(p_links)
  LOOP
    v_need_kind := v_link->>'needKind';
    v_need_id := (v_link->>'needId')::uuid;

    INSERT INTO public.transport_trip_need_links (
      transport_order_id,
      need_kind,
      need_id,
      direction,
      source_point_key,
      source_point_label,
      destination_point_key,
      destination_point_label,
      need_title,
      need_subtitle,
      needed_date
    ) VALUES (
      v_trip_id,
      v_need_kind,
      v_need_id,
      v_link->>'direction',
      v_link->>'sourcePointKey',
      v_link->>'sourcePointLabel',
      v_link->>'destinationPointKey',
      v_link->>'destinationPointLabel',
      v_link->>'title',
      NULLIF(v_link->>'subtitle', ''),
      NULLIF(v_link->>'neededDate', '')::date
    );

    IF v_need_kind = 'outsourcing' THEN
      UPDATE public.machine_outsourcing_transport_needs
      SET status = 'linked',
          transport_order_id = v_trip_id,
          updated_at = now()
      WHERE id = v_need_id
        AND status = 'open'
        AND plan_state = 'confirmed'
        AND transport_order_id IS NULL
      RETURNING task_id INTO v_task_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Потребность аутсорсинга уже занята или недоступна';
      END IF;
      IF v_task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = 'in_progress',
            updated_at = now()
        WHERE id = v_task_id
          AND status = 'pending';
      END IF;
    ELSIF v_need_kind = 'detailing' THEN
      PERFORM public.fn_set_detailing_transfer_date(
        v_need_id,
        p_scheduled_date,
        p_actor
      );
    ELSIF v_need_kind = 'materials' THEN
      PERFORM public.fn_set_inventory_transfer_date(
        v_need_id,
        p_scheduled_date,
        p_actor
      );
    ELSE
      RAISE EXCEPTION 'Неизвестная категория транспортной потребности';
    END IF;
  END LOOP;

  RETURN v_trip_id;
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
  SELECT *
  INTO v_trip
  FROM public.machine_outsourcing_transport_orders
  WHERE id = p_trip_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Рейс не найден';
  END IF;
  IF v_trip.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Завершённый или отменённый рейс нельзя изменить';
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Не указан пользователь, изменяющий рейс';
  END IF;
  IF p_carrier_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Укажите перевозчика';
  END IF;
  IF p_scheduled_date IS NULL THEN
    RAISE EXCEPTION 'Укажите дату рейса';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'Укажите корректную цену рейса';
  END IF;
  IF NULLIF(btrim(p_route), '') IS NULL
     OR NOT (
       lower(btrim(p_route)) = lower(btrim(v_trip.route_start))
       OR lower(btrim(p_route)) LIKE lower(btrim(v_trip.route_start)) || ' → %'
     ) THEN
    RAISE EXCEPTION 'Маршрут должен начинаться со стартовой точки потребности';
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
    SELECT *
    FROM public.transport_trip_need_links
    WHERE transport_order_id = p_trip_id
      AND released_at IS NULL
  LOOP
    IF p_status = 'cancelled' THEN
      IF v_link.need_kind = 'outsourcing' THEN
        UPDATE public.machine_outsourcing_transport_needs
        SET status = 'open',
            transport_order_id = NULL,
            updated_at = now()
        WHERE id = v_link.need_id
        RETURNING * INTO v_need;
        IF v_need.task_id IS NOT NULL THEN
          UPDATE public.tasks
          SET status = 'pending',
              completed_at = NULL,
              updated_at = now()
          WHERE id = v_need.task_id;
        END IF;
      END IF;
      CONTINUE;
    END IF;

    IF v_link.need_kind = 'detailing' THEN
      PERFORM public.fn_set_detailing_transfer_date(
        v_link.need_id,
        p_scheduled_date,
        p_actor
      );
    ELSIF v_link.need_kind = 'materials' THEN
      PERFORM public.fn_set_inventory_transfer_date(
        v_link.need_id,
        p_scheduled_date,
        p_actor
      );
    ELSIF v_link.need_kind = 'outsourcing'
          AND p_status = 'completed' THEN
      UPDATE public.machine_outsourcing_transport_needs
      SET status = 'completed',
          updated_at = now()
      WHERE id = v_link.need_id
      RETURNING * INTO v_need;

      IF v_need.task_id IS NOT NULL THEN
        UPDATE public.tasks
        SET status = 'completed',
            completed_at = now(),
            updated_at = now()
        WHERE id = v_need.task_id;
      END IF;

      v_fact_field := CASE
        WHEN v_need.direction = 'outbound' THEN 'actual_sent_at'
        ELSE 'actual_returned_at'
      END;
      EXECUTE format(
        'UPDATE public.machine_outsourcing_operations
         SET %I = $1, updated_by = $2, updated_at = now()
         WHERE id = $3',
        v_fact_field
      )
      USING p_scheduled_date, p_actor, v_need.operation_id;
    END IF;
  END LOOP;

  IF p_status = 'cancelled' THEN
    UPDATE public.transport_trip_need_links
    SET released_at = now()
    WHERE transport_order_id = p_trip_id
      AND released_at IS NULL;
  END IF;

  RETURN p_status;
END;
$$;

ALTER TABLE public.transport_trip_need_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transport_trip_need_links_select
  ON public.transport_trip_need_links;
CREATE POLICY transport_trip_need_links_select
  ON public.transport_trip_need_links
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_director())
    OR (SELECT public.get_user_role()) IN (
      'supply_manager',
      'procurement_head',
      'production_manager'
    )
  );

DROP POLICY IF EXISTS transport_trip_need_links_service_role_modify
  ON public.transport_trip_need_links;
CREATE POLICY transport_trip_need_links_service_role_modify
  ON public.transport_trip_need_links
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.transport_trip_need_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.transport_trip_need_links TO service_role;

REVOKE ALL ON FUNCTION public.fn_create_transport_trip(
  public.outsourcing_transport_direction,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  text,
  jsonb,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_transport_trip(
  public.outsourcing_transport_direction,
  uuid,
  date,
  numeric,
  text,
  text,
  text,
  text,
  jsonb,
  uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.fn_update_transport_trip(
  uuid,
  public.outsourcing_transport_order_status,
  uuid,
  date,
  numeric,
  text,
  text,
  uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip(
  uuid,
  public.outsourcing_transport_order_status,
  uuid,
  date,
  numeric,
  text,
  text,
  uuid
) TO service_role;
