DO $$
BEGIN
  CREATE TYPE public.transport_trip_date_change_state AS ENUM
    ('not_required', 'pending', 'approved', 'rejected', 'conflicted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.factories
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address text;
UPDATE public.factories SET city = name WHERE NULLIF(btrim(city), '') IS NULL;
ALTER TABLE public.factories ALTER COLUMN city SET NOT NULL;
ALTER TABLE public.factories
  DROP CONSTRAINT IF EXISTS factories_city_not_blank,
  ADD CONSTRAINT factories_city_not_blank CHECK (btrim(city) <> '');

COMMENT ON COLUMN public.factories.city IS 'Required city for transport routing';
COMMENT ON COLUMN public.factories.address IS 'Optional street address for transport routing';

ALTER TABLE public.machine_outsourcing_transport_orders
  ADD COLUMN IF NOT EXISTS date_change_state public.transport_trip_date_change_state NOT NULL DEFAULT 'not_required';

CREATE TABLE IF NOT EXISTS public.transport_trip_date_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transport_order_id uuid NOT NULL REFERENCES public.machine_outsourcing_transport_orders(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  status public.transport_trip_date_change_state NOT NULL DEFAULT 'pending'
    CHECK (status <> 'not_required'),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decision_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT transport_trip_date_request_decision_check CHECK (
    status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_trip_date_one_pending
  ON public.transport_trip_date_change_requests(transport_order_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_transport_trip_date_request_task
  ON public.transport_trip_date_change_requests(task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.transport_trip_date_change_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.transport_trip_date_change_requests(id) ON DELETE CASCADE,
  transport_need_link_id uuid NOT NULL REFERENCES public.transport_trip_need_links(id) ON DELETE CASCADE,
  need_source text NOT NULL CHECK (need_source IN ('inventory_transfer', 'supply_schedule', 'detailing_transfer', 'outsourcing')),
  need_id uuid NOT NULL,
  old_date date NOT NULL,
  new_date date NOT NULL,
  status public.transport_trip_date_change_state NOT NULL DEFAULT 'pending' CHECK (status <> 'not_required'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_transport_trip_date_items_request
  ON public.transport_trip_date_change_items(request_id, sort_order);

CREATE OR REPLACE FUNCTION public.transport_need_current_date(p_source text, p_need_id uuid)
RETURNS date LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_date date;
BEGIN
  IF p_source = 'outsourcing' THEN
    SELECT needed_date INTO v_date FROM public.machine_outsourcing_transport_needs WHERE id = p_need_id;
  ELSIF p_source = 'detailing_transfer' THEN
    SELECT expected_arrival_date INTO v_date FROM public.detailing_transfers WHERE id = p_need_id;
  ELSIF p_source = 'inventory_transfer' THEN
    SELECT expected_arrival_date INTO v_date FROM public.inventory_transfers WHERE id = p_need_id;
  ELSIF p_source = 'supply_schedule' THEN
    SELECT delivery_date INTO v_date FROM public.supply_order_delivery_schedules WHERE id = p_need_id;
  ELSE
    RAISE EXCEPTION 'Неизвестный источник транспортной потребности';
  END IF;
  RETURN v_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_transport_trip_v3(
  p_trip_id uuid,
  p_status public.outsourcing_transport_order_status,
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_route text,
  p_comment text,
  p_stops jsonb,
  p_date_change_reason text,
  p_actor uuid
) RETURNS public.outsourcing_transport_order_status LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
  v_request_id uuid;
  v_task_id uuid;
  v_approver uuid;
  v_link record;
  v_has_changes boolean;
  v_keep_pending boolean := false;
  v_sort integer := 0;
BEGIN
  SELECT * INTO v_trip FROM public.machine_outsourcing_transport_orders WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Рейс не найден'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.transport_update_date_snapshot (
    need_source text, need_id uuid, link_id uuid, old_date date, PRIMARY KEY (need_source, need_id)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.transport_update_date_snapshot;
  INSERT INTO pg_temp.transport_update_date_snapshot(need_source, need_id, link_id, old_date)
  SELECT l.need_source, l.need_id, l.id, public.transport_need_current_date(l.need_source, l.need_id)
  FROM public.transport_trip_need_links l WHERE l.transport_order_id = p_trip_id AND l.released_at IS NULL;
  v_has_changes := EXISTS (SELECT 1 FROM pg_temp.transport_update_date_snapshot WHERE old_date IS DISTINCT FROM p_scheduled_date);
  v_keep_pending := v_trip.date_change_state = 'pending' AND v_trip.scheduled_date = p_scheduled_date;

  IF p_status NOT IN ('cancelled', 'completed') AND v_has_changes AND NOT v_keep_pending
     AND NULLIF(btrim(p_date_change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину переноса даты рейса';
  END IF;
  PERFORM public.fn_update_transport_trip_v2(
    p_trip_id, p_status, p_carrier_supplier_id, p_scheduled_date, p_price, p_route, p_comment, p_stops, p_actor
  );
  IF p_status = 'cancelled' THEN
    UPDATE public.tasks t SET status = 'cancelled', completed_at = now(), updated_at = now()
    FROM public.transport_trip_date_change_requests r
    WHERE r.transport_order_id = p_trip_id AND r.status = 'pending' AND r.task_id = t.id;
    UPDATE public.transport_trip_date_change_items i SET status = 'rejected', decided_at = now()
    FROM public.transport_trip_date_change_requests r
    WHERE r.transport_order_id = p_trip_id AND r.status = 'pending' AND i.request_id = r.id;
    UPDATE public.transport_trip_date_change_requests SET status = 'rejected', decided_by = p_actor,
      decided_at = now(), decision_comment = 'Рейс отменён', updated_at = now()
    WHERE transport_order_id = p_trip_id AND status = 'pending';
    RETURN p_status;
  END IF;
  IF p_status = 'completed' THEN RETURN p_status; END IF;

  IF NOT v_has_changes THEN
    UPDATE public.machine_outsourcing_transport_orders SET date_change_state = 'not_required' WHERE id = p_trip_id;
    RETURN p_status;
  END IF;

  UPDATE public.detailing_transfers d SET expected_arrival_date = s.old_date, updated_at = now()
  FROM pg_temp.transport_update_date_snapshot s WHERE s.need_source = 'detailing_transfer' AND d.id = s.need_id;
  UPDATE public.inventory_transfers i SET expected_arrival_date = s.old_date, updated_at = now()
  FROM pg_temp.transport_update_date_snapshot s WHERE s.need_source = 'inventory_transfer' AND i.id = s.need_id;
  UPDATE public.tasks t SET start_date = s.old_date, deadline = s.old_date, updated_at = now()
  FROM pg_temp.transport_update_date_snapshot s
  WHERE (s.need_source = 'detailing_transfer' AND t.detailing_transfer_id = s.need_id)
     OR (s.need_source = 'inventory_transfer' AND t.inventory_transfer_id = s.need_id);
  IF v_keep_pending THEN RETURN p_status; END IF;

  -- Editing a pending proposal replaces it while retaining the old request in history.
  UPDATE public.transport_trip_date_change_requests SET status = 'rejected', decided_by = p_actor,
    decided_at = now(), decision_comment = 'Заменён новой редакцией рейса', updated_at = now()
  WHERE transport_order_id = p_trip_id AND status = 'pending';
  UPDATE public.transport_trip_date_change_items i SET status = 'rejected', decided_at = now()
  FROM public.transport_trip_date_change_requests r
  WHERE i.request_id = r.id AND r.transport_order_id = p_trip_id AND r.decision_comment = 'Заменён новой редакцией рейса';
  UPDATE public.tasks t SET status = 'completed', completed_at = now(), updated_at = now()
  FROM public.transport_trip_date_change_requests r
  WHERE r.task_id = t.id AND r.transport_order_id = p_trip_id AND r.decision_comment = 'Заменён новой редакцией рейса';

  SELECT d.head_user_id INTO v_approver FROM public.departments d
  JOIN public.users u ON u.id = d.head_user_id AND u.is_active = true
  WHERE d.is_active = true AND (lower(d.name) LIKE '%планирован%' OR lower(d.name) LIKE '%planning%')
  ORDER BY d.sort_order NULLS LAST LIMIT 1;
  IF v_approver IS NULL THEN SELECT id INTO v_approver FROM public.users WHERE role = 'planning_director' AND is_active = true ORDER BY created_at LIMIT 1; END IF;
  IF v_approver IS NULL THEN RAISE EXCEPTION 'Не найден руководитель планирования'; END IF;

  INSERT INTO public.transport_trip_date_change_requests(transport_order_id, reason, requested_by)
  VALUES (p_trip_id, btrim(p_date_change_reason), p_actor) RETURNING id INTO v_request_id;
  FOR v_link IN SELECT * FROM pg_temp.transport_update_date_snapshot WHERE old_date IS DISTINCT FROM p_scheduled_date
  LOOP
    INSERT INTO public.transport_trip_date_change_items(request_id, transport_need_link_id, need_source, need_id, old_date, new_date, sort_order)
    VALUES (v_request_id, v_link.link_id, v_link.need_source, v_link.need_id, v_link.old_date, p_scheduled_date, v_sort);
    v_sort := v_sort + 1;
  END LOOP;
  INSERT INTO public.tasks(assigned_to, task_type, title, description, status, start_date, deadline)
  VALUES (v_approver, 'transport_trip_date_approval', 'Согласовать даты транспортного рейса',
    'Изменена дата рейса. Проверьте причину и переносы.', 'pending', CURRENT_DATE, CURRENT_DATE)
  RETURNING id INTO v_task_id;
  UPDATE public.transport_trip_date_change_requests SET task_id = v_task_id WHERE id = v_request_id;
  UPDATE public.machine_outsourcing_transport_orders SET date_change_state = 'pending', updated_by = p_actor, updated_at = now() WHERE id = p_trip_id;
  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_create_transport_trip_v3(
  p_carrier_supplier_id uuid,
  p_scheduled_date date,
  p_price numeric,
  p_comment text,
  p_stops jsonb,
  p_links jsonb,
  p_date_change_reason text,
  p_actor uuid
) RETURNS uuid LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_trip_id uuid;
  v_request_id uuid;
  v_task_id uuid;
  v_approver uuid;
  v_link record;
  v_old_date date;
  v_has_changes boolean := false;
  v_sort integer := 0;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан автор рейса'; END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'Укажите дату рейса'; END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.transport_date_snapshot (
    need_source text, need_id uuid, old_date date, PRIMARY KEY (need_source, need_id)
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.transport_date_snapshot;
  INSERT INTO pg_temp.transport_date_snapshot(need_source, need_id, old_date)
  SELECT value->>'needSource', (value->>'needId')::uuid,
    public.transport_need_current_date(value->>'needSource', (value->>'needId')::uuid)
  FROM jsonb_array_elements(p_links);

  IF EXISTS (SELECT 1 FROM pg_temp.transport_date_snapshot WHERE old_date IS NULL) THEN
    RAISE EXCEPTION 'У одной из потребностей не указана дата перевозки';
  END IF;
  v_has_changes := EXISTS (
    SELECT 1 FROM pg_temp.transport_date_snapshot WHERE old_date IS DISTINCT FROM p_scheduled_date
  );
  IF v_has_changes AND NULLIF(btrim(p_date_change_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину объединения потребностей с разными датами';
  END IF;

  v_trip_id := public.fn_create_transport_trip_v2(
    p_carrier_supplier_id, p_scheduled_date, p_price, p_comment, p_stops, p_links, p_actor
  );

  IF NOT v_has_changes THEN RETURN v_trip_id; END IF;

  -- v2 schedules internal transfers immediately; restore snapshots until approval.
  UPDATE public.detailing_transfers d SET expected_arrival_date = s.old_date, updated_at = now()
  FROM pg_temp.transport_date_snapshot s
  WHERE s.need_source = 'detailing_transfer' AND d.id = s.need_id;
  UPDATE public.inventory_transfers i SET expected_arrival_date = s.old_date, updated_at = now()
  FROM pg_temp.transport_date_snapshot s
  WHERE s.need_source = 'inventory_transfer' AND i.id = s.need_id;
  UPDATE public.tasks t SET deadline = s.old_date, start_date = s.old_date, updated_at = now()
  FROM pg_temp.transport_date_snapshot s
  WHERE (s.need_source = 'detailing_transfer' AND t.detailing_transfer_id = s.need_id)
     OR (s.need_source = 'inventory_transfer' AND t.inventory_transfer_id = s.need_id);

  SELECT d.head_user_id INTO v_approver
  FROM public.departments d
  JOIN public.users u ON u.id = d.head_user_id AND u.is_active = true
  WHERE d.is_active = true
    AND (lower(d.name) LIKE '%планирован%' OR lower(d.name) LIKE '%planning%')
  ORDER BY d.sort_order NULLS LAST LIMIT 1;
  IF v_approver IS NULL THEN
    SELECT id INTO v_approver FROM public.users
    WHERE role = 'planning_director' AND is_active = true ORDER BY created_at LIMIT 1;
  END IF;
  IF v_approver IS NULL THEN RAISE EXCEPTION 'Не найден руководитель планирования'; END IF;

  INSERT INTO public.transport_trip_date_change_requests(
    transport_order_id, reason, requested_by
  ) VALUES (v_trip_id, btrim(p_date_change_reason), p_actor)
  RETURNING id INTO v_request_id;

  FOR v_link IN
    SELECT l.id, l.need_source, l.need_id, s.old_date
    FROM public.transport_trip_need_links l
    JOIN pg_temp.transport_date_snapshot s ON s.need_source = l.need_source AND s.need_id = l.need_id
    WHERE l.transport_order_id = v_trip_id AND s.old_date IS DISTINCT FROM p_scheduled_date
    ORDER BY l.created_at
  LOOP
    INSERT INTO public.transport_trip_date_change_items(
      request_id, transport_need_link_id, need_source, need_id, old_date, new_date, sort_order
    ) VALUES (v_request_id, v_link.id, v_link.need_source, v_link.need_id, v_link.old_date, p_scheduled_date, v_sort);
    v_sort := v_sort + 1;
  END LOOP;

  INSERT INTO public.tasks(assigned_to, task_type, title, description, status, start_date, deadline)
  VALUES (
    v_approver, 'transport_trip_date_approval', 'Согласовать даты транспортного рейса',
    'Потребности с разными датами объединены в один рейс. Проверьте причину и переносы.',
    'pending', CURRENT_DATE, CURRENT_DATE
  ) RETURNING id INTO v_task_id;
  UPDATE public.transport_trip_date_change_requests SET task_id = v_task_id WHERE id = v_request_id;
  UPDATE public.machine_outsourcing_transport_orders
  SET date_change_state = 'pending', updated_by = p_actor, updated_at = now()
  WHERE id = v_trip_id;
  RETURN v_trip_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_decide_transport_trip_date_change(
  p_request_id uuid,
  p_decision text,
  p_comment text,
  p_actor uuid
) RETURNS public.transport_trip_date_change_state
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_request public.transport_trip_date_change_requests%ROWTYPE;
  v_item public.transport_trip_date_change_items%ROWTYPE;
  v_need public.machine_outsourcing_transport_needs%ROWTYPE;
  v_state public.transport_trip_date_change_state;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;
  SELECT * INTO v_request FROM public.transport_trip_date_change_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Запрос согласования не найден'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Запрос уже обработан'; END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Некорректное решение'; END IF;

  IF p_decision = 'rejected' THEN
    v_state := 'rejected';
  ELSIF EXISTS (
    SELECT 1 FROM public.transport_trip_date_change_items i
    WHERE i.request_id = v_request.id
      AND public.transport_need_current_date(i.need_source, i.need_id) IS DISTINCT FROM i.old_date
  ) THEN
    v_state := 'conflicted';
  ELSE
    v_state := 'approved';
    FOR v_item IN SELECT * FROM public.transport_trip_date_change_items
      WHERE request_id = v_request.id ORDER BY sort_order FOR UPDATE
    LOOP
      IF v_item.need_source = 'outsourcing' THEN
        SELECT * INTO v_need FROM public.machine_outsourcing_transport_needs WHERE id = v_item.need_id FOR UPDATE;
        UPDATE public.machine_outsourcing_operations
        SET planned_send_date = CASE WHEN v_need.direction = 'outbound' THEN v_item.new_date ELSE planned_send_date END,
            planned_return_date = CASE WHEN v_need.direction = 'return' THEN v_item.new_date ELSE planned_return_date END,
            supply_terms_confirmed_at = CASE WHEN v_need.direction = 'return' THEN NULL ELSE supply_terms_confirmed_at END,
            supply_terms_confirmed_by = CASE WHEN v_need.direction = 'return' THEN NULL ELSE supply_terms_confirmed_by END,
            updated_at = now()
        WHERE id = v_need.operation_id;
        UPDATE public.machine_outsourcing_transport_needs
        SET needed_date = v_item.new_date, updated_at = now() WHERE id = v_item.need_id;
        UPDATE public.tasks SET start_date = v_item.new_date, deadline = v_item.new_date, updated_at = now()
        WHERE id = v_need.task_id;
      ELSIF v_item.need_source = 'detailing_transfer' THEN
        UPDATE public.detailing_transfers SET expected_arrival_date = v_item.new_date, updated_at = now() WHERE id = v_item.need_id;
        UPDATE public.tasks SET start_date = v_item.new_date, deadline = v_item.new_date, updated_at = now()
        WHERE detailing_transfer_id = v_item.need_id AND status IN ('pending', 'in_progress');
      ELSIF v_item.need_source = 'inventory_transfer' THEN
        UPDATE public.inventory_transfers SET expected_arrival_date = v_item.new_date, updated_at = now() WHERE id = v_item.need_id;
        UPDATE public.tasks SET start_date = v_item.new_date, deadline = v_item.new_date, updated_at = now()
        WHERE inventory_transfer_id = v_item.need_id AND status IN ('pending', 'in_progress');
      ELSIF v_item.need_source = 'supply_schedule' THEN
        UPDATE public.supply_order_delivery_schedules
        SET delivery_date = v_item.new_date,
            change_reason = concat_ws(E'\n', NULLIF(change_reason, ''), 'Транспортный рейс: ' || v_request.reason),
            updated_at = now()
        WHERE id = v_item.need_id;
        UPDATE public.tasks SET start_date = v_item.new_date, deadline = v_item.new_date, updated_at = now()
        WHERE supply_order_schedule_id = v_item.need_id AND status IN ('pending', 'in_progress');
      END IF;
    END LOOP;
  END IF;

  UPDATE public.transport_trip_date_change_requests SET
    status = v_state, decided_by = p_actor, decided_at = now(),
    decision_comment = NULLIF(btrim(p_comment), ''), updated_at = now()
  WHERE id = v_request.id;
  UPDATE public.transport_trip_date_change_items SET status = v_state, decided_at = now()
  WHERE request_id = v_request.id;
  UPDATE public.machine_outsourcing_transport_orders SET date_change_state = v_state, updated_by = p_actor, updated_at = now()
  WHERE id = v_request.transport_order_id;
  UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE id = v_request.task_id;
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_update_transport_trip_stop_status(
  p_stop_id uuid, p_status text, p_actor uuid
) RETURNS text LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_stop public.transport_trip_stops%ROWTYPE;
  v_trip public.machine_outsourcing_transport_orders%ROWTYPE;
BEGIN
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не указан пользователь'; END IF;
  SELECT * INTO v_stop FROM public.transport_trip_stops WHERE id = p_stop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Остановка не найдена'; END IF;
  SELECT * INTO v_trip FROM public.machine_outsourcing_transport_orders WHERE id = v_stop.transport_order_id FOR UPDATE;
  IF v_trip.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'Завершённый или отменённый рейс нельзя изменить'; END IF;
  IF v_trip.date_change_state NOT IN ('not_required', 'approved') THEN
    RAISE EXCEPTION 'Начало рейса заблокировано до согласования переноса дат';
  END IF;
  IF v_stop.stop_kind = 'start' THEN RAISE EXCEPTION 'Точка выезда не требует отметки'; END IF;
  IF p_status = 'arrived' AND v_stop.status <> 'planned' THEN RAISE EXCEPTION 'Остановку уже начали или завершили'; END IF;
  IF p_status = 'completed' AND v_stop.status <> 'arrived' THEN RAISE EXCEPTION 'Сначала отметьте прибытие'; END IF;
  IF p_status NOT IN ('arrived', 'completed') THEN RAISE EXCEPTION 'Некорректный статус остановки'; END IF;
  IF p_status = 'arrived' AND EXISTS (
    SELECT 1 FROM public.transport_trip_stops previous
    WHERE previous.transport_order_id = v_stop.transport_order_id AND previous.stop_kind <> 'start'
      AND previous.sequence_no < v_stop.sequence_no AND previous.status <> 'completed'
  ) THEN RAISE EXCEPTION 'Сначала завершите предыдущую остановку'; END IF;

  UPDATE public.transport_trip_stops SET status = p_status,
    arrived_at = CASE WHEN p_status = 'arrived' THEN now() ELSE arrived_at END,
    completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
    updated_at = now() WHERE id = p_stop_id;
  IF v_trip.status = 'found' THEN
    UPDATE public.machine_outsourcing_transport_orders SET status = 'in_transit', updated_by = p_actor, updated_at = now() WHERE id = v_trip.id;
  END IF;
  IF p_status = 'completed' AND NOT EXISTS (
    SELECT 1 FROM public.transport_trip_stops pending
    WHERE pending.transport_order_id = v_stop.transport_order_id AND pending.stop_kind <> 'start' AND pending.status <> 'completed'
  ) THEN
    PERFORM public.fn_update_transport_trip(v_trip.id, 'completed', v_trip.carrier_supplier_id, v_trip.scheduled_date, v_trip.price, v_trip.route, v_trip.comment, p_actor);
  END IF;
  RETURN p_status;
END;
$$;

ALTER TABLE public.transport_trip_date_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_trip_date_change_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY transport_trip_date_requests_select ON public.transport_trip_date_change_requests
  FOR SELECT TO authenticated USING (requested_by = auth.uid() OR public.is_director() OR EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_id AND t.assigned_to = auth.uid()
  ));
CREATE POLICY transport_trip_date_items_select ON public.transport_trip_date_change_items
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.transport_trip_date_change_requests r WHERE r.id = request_id
      AND (r.requested_by = auth.uid() OR public.is_director() OR EXISTS (
        SELECT 1 FROM public.tasks t WHERE t.id = r.task_id AND t.assigned_to = auth.uid()
      ))
  ));
CREATE POLICY transport_trip_date_requests_service_modify ON public.transport_trip_date_change_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY transport_trip_date_items_service_modify ON public.transport_trip_date_change_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.transport_trip_date_change_requests, public.transport_trip_date_change_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transport_trip_date_change_requests, public.transport_trip_date_change_items TO service_role;
REVOKE ALL ON FUNCTION public.transport_need_current_date(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_create_transport_trip_v3(uuid, date, numeric, text, jsonb, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_update_transport_trip_v3(uuid, public.outsourcing_transport_order_status, uuid, date, numeric, text, text, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_decide_transport_trip_date_change(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transport_need_current_date(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_transport_trip_v3(uuid, date, numeric, text, jsonb, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_update_transport_trip_v3(uuid, public.outsourcing_transport_order_status, uuid, date, numeric, text, text, jsonb, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_decide_transport_trip_date_change(uuid, text, text, uuid) TO service_role;
