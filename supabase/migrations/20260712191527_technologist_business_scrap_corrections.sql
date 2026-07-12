-- Technologist workspace for business-scrap reservations and an approval flow
-- for corrections after a request has already been handed to supply.

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'business_scrap_correction_approval';

ALTER TABLE public.supply_order_delivery_schedules
  DROP CONSTRAINT IF EXISTS supply_order_delivery_schedules_status_check;
ALTER TABLE public.supply_order_delivery_schedules
  ADD CONSTRAINT supply_order_delivery_schedules_status_check
  CHECK (status IN ('planned', 'delivered', 'cancelled'));

CREATE TABLE public.business_scrap_correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technologist_request_id uuid NOT NULL REFERENCES public.technologist_requests(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  approver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'conflicted', 'cancelled')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  decision_comment text,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_scrap_correction_decision_check CHECK (
    status = 'pending'
    OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX business_scrap_correction_one_pending
  ON public.business_scrap_correction_requests(technologist_request_id)
  WHERE status = 'pending';
CREATE INDEX business_scrap_correction_machine_created
  ON public.business_scrap_correction_requests(machine_id, created_at DESC);
CREATE INDEX business_scrap_correction_approver_status
  ON public.business_scrap_correction_requests(approver_id, status, created_at);

CREATE TABLE public.business_scrap_correction_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_request_id uuid NOT NULL REFERENCES public.business_scrap_correction_requests(id) ON DELETE CASCADE,
  request_item_table text NOT NULL CHECK (request_item_table IN (
    'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
    'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord'
  )),
  request_item_id uuid NOT NULL,
  remove_reservation_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  old_reserved_quantity numeric NOT NULL DEFAULT 0 CHECK (old_reserved_quantity >= 0),
  proposed_reserved_quantity numeric NOT NULL DEFAULT 0 CHECK (proposed_reserved_quantity >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'conflicted', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(correction_request_id, request_item_table, request_item_id)
);

CREATE INDEX business_scrap_correction_items_target
  ON public.business_scrap_correction_items(request_item_table, request_item_id);

CREATE TABLE public.business_scrap_correction_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_request_id uuid NOT NULL REFERENCES public.business_scrap_correction_requests(id) ON DELETE CASCADE,
  correction_item_id uuid NOT NULL REFERENCES public.business_scrap_correction_items(id) ON DELETE CASCADE,
  inventory_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
  requested_quantity numeric NOT NULL CHECK (requested_quantity > 0),
  held_quantity numeric NOT NULL CHECK (held_quantity > 0),
  held_secondary_quantity numeric,
  is_cut_reservation boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'applied', 'released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

CREATE INDEX business_scrap_correction_holds_active_inventory
  ON public.business_scrap_correction_holds(inventory_id)
  WHERE status = 'active';
CREATE INDEX business_scrap_correction_holds_request
  ON public.business_scrap_correction_holds(correction_request_id, status);

CREATE OR REPLACE FUNCTION public.touch_business_scrap_correction_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER business_scrap_correction_touch_updated_at
  BEFORE UPDATE ON public.business_scrap_correction_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_business_scrap_correction_updated_at();

ALTER TABLE public.business_scrap_correction_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_scrap_correction_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_scrap_correction_holds ENABLE ROW LEVEL SECURITY;

CREATE POLICY business_scrap_correction_requests_select
  ON public.business_scrap_correction_requests
  FOR SELECT TO authenticated
  USING (
    (select auth.uid()) = requested_by
    OR (select auth.uid()) = approver_id
    OR public.is_director()
  );

CREATE POLICY business_scrap_correction_items_select
  ON public.business_scrap_correction_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.business_scrap_correction_requests request
    WHERE request.id = business_scrap_correction_items.correction_request_id
      AND (
        request.requested_by = (select auth.uid())
        OR request.approver_id = (select auth.uid())
        OR public.is_director()
      )
  ));

CREATE POLICY business_scrap_correction_holds_select
  ON public.business_scrap_correction_holds
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.business_scrap_correction_requests request
    WHERE request.id = business_scrap_correction_holds.correction_request_id
      AND (
        request.requested_by = (select auth.uid())
        OR request.approver_id = (select auth.uid())
        OR public.is_director()
      )
  ));

GRANT SELECT ON public.business_scrap_correction_requests TO authenticated;
GRANT SELECT ON public.business_scrap_correction_items TO authenticated;
GRANT SELECT ON public.business_scrap_correction_holds TO authenticated;
GRANT ALL ON public.business_scrap_correction_requests TO service_role;
GRANT ALL ON public.business_scrap_correction_items TO service_role;
GRANT ALL ON public.business_scrap_correction_holds TO service_role;

WITH all_roles(role) AS (
  VALUES
    ('financial_director'::public.user_role),
    ('commercial_director'::public.user_role),
    ('planning_director'::public.user_role),
    ('sales_manager'::public.user_role),
    ('engineer'::public.user_role),
    ('technologist'::public.user_role),
    ('supply_manager'::public.user_role),
    ('production_manager'::public.user_role),
    ('procurement_head'::public.user_role),
    ('painting_head'::public.user_role)
)
INSERT INTO public.role_permissions (role, resource_key, can_view, can_manage)
SELECT
  role,
  'business_scrap_reservations',
  role IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'technologist'::public.user_role
  ),
  role IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'technologist'::public.user_role
  )
FROM all_roles
ON CONFLICT (role, resource_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_business_scrap_request_item_needed(
  p_table text,
  p_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_value numeric;
BEGIN
  IF p_table = 'request_sheet_metal' THEN
    SELECT COALESCE(remainder_qty, to_order_kg, 0) INTO v_value FROM public.request_sheet_metal WHERE id = p_id;
  ELSIF p_table = 'request_round_tube' THEN
    SELECT COALESCE(order_kg, 0) INTO v_value FROM public.request_round_tube WHERE id = p_id;
  ELSIF p_table = 'request_circle' THEN
    SELECT COALESCE(remainder_mm, 0) INTO v_value FROM public.request_circle WHERE id = p_id;
  ELSIF p_table = 'request_pipe' THEN
    SELECT CASE WHEN pipe_type = 'wire' THEN COALESCE(remainder_kg, 0) ELSE COALESCE(remainder_length_mm, 0) END
      INTO v_value FROM public.request_pipe WHERE id = p_id;
  ELSIF p_table = 'request_knives' THEN
    SELECT CASE WHEN COALESCE(remainder_meters, 0) > 0 THEN remainder_meters * 1000 ELSE COALESCE(to_order_mm, 0) END
      INTO v_value FROM public.request_knives WHERE id = p_id;
  ELSIF p_table = 'request_components' THEN
    SELECT GREATEST(COALESCE(quantity_needed, 0) - COALESCE(stock_remainder, 0), 0)
      INTO v_value FROM public.request_components WHERE id = p_id;
  ELSIF p_table = 'request_paint' THEN
    SELECT COALESCE(remainder_kg, to_order_kg, 0) INTO v_value FROM public.request_paint WHERE id = p_id;
  ELSIF p_table = 'request_mesh' THEN
    SELECT COALESCE(remainder_qty, 0) INTO v_value FROM public.request_mesh WHERE id = p_id;
  ELSIF p_table = 'request_chain_cord' THEN
    SELECT COALESCE(remainder_meters, 0) * 1000 INTO v_value FROM public.request_chain_cord WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Некорректная таблица позиции: %', p_table;
  END IF;

  IF v_value IS NULL THEN
    RAISE EXCEPTION 'Позиция заявки не найдена';
  END IF;
  RETURN v_value;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_release_business_scrap_correction_holds(
  p_correction_request_id uuid,
  p_performed_by uuid,
  p_target_status text DEFAULT 'released'
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_hold public.business_scrap_correction_holds%ROWTYPE;
  v_inventory public.inventory%ROWTYPE;
BEGIN
  IF p_target_status NOT IN ('released', 'applied') THEN
    RAISE EXCEPTION 'Некорректный статус удержания';
  END IF;

  FOR v_hold IN
    SELECT *
    FROM public.business_scrap_correction_holds
    WHERE correction_request_id = p_correction_request_id
      AND status = 'active'
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    SELECT * INTO v_inventory
    FROM public.inventory
    WHERE id = v_hold.inventory_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Складская строка временного удержания не найдена';
    END IF;

    UPDATE public.inventory
    SET reserved_quantity = GREATEST(reserved_quantity - v_hold.held_quantity, 0),
        reserved_secondary_quantity = CASE
          WHEN v_hold.held_secondary_quantity IS NULL THEN reserved_secondary_quantity
          ELSE GREATEST(COALESCE(reserved_secondary_quantity, 0) - v_hold.held_secondary_quantity, 0)
        END,
        last_updated_by = p_performed_by,
        updated_at = now()
    WHERE id = v_hold.inventory_id;

    INSERT INTO public.inventory_transactions (
      factory_id, inventory_id, material_id, material_variant_id, transaction_type,
      quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
      performed_by, comment
    )
    SELECT
      inventory.factory_id,
      inventory.id,
      inventory.material_id,
      inventory.material_variant_id,
      'unreserve'::public.inventory_transaction_type,
      v_hold.held_quantity,
      v_hold.held_secondary_quantity,
      request.machine_id,
      item.request_item_table,
      item.request_item_id,
      p_performed_by,
      CASE WHEN p_target_status = 'applied'
        THEN 'Временное удержание снято перед применением корректировки'
        ELSE 'Временное удержание снято после решения по корректировке'
      END
    FROM public.inventory inventory
    JOIN public.business_scrap_correction_items item ON item.id = v_hold.correction_item_id
    JOIN public.business_scrap_correction_requests request ON request.id = item.correction_request_id
    WHERE inventory.id = v_hold.inventory_id;

    UPDATE public.business_scrap_correction_holds
    SET status = p_target_status,
        released_at = now()
    WHERE id = v_hold.id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_submit_business_scrap_correction(
  p_correction_request_id uuid,
  p_task_id uuid,
  p_technologist_request_id uuid,
  p_requested_by uuid,
  p_approver_id uuid,
  p_reason text,
  p_changes jsonb
)
RETURNS TABLE(correction_request_id uuid, task_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request public.technologist_requests%ROWTYPE;
  v_machine public.machines%ROWTYPE;
  v_change jsonb;
  v_addition jsonb;
  v_table text;
  v_item_id uuid;
  v_item_request_id uuid;
  v_remove_ids uuid[];
  v_remove_count integer;
  v_old_reserved numeric;
  v_removed numeric;
  v_added numeric;
  v_needed numeric;
  v_item_change_id uuid;
  v_inventory public.inventory%ROWTYPE;
  v_requested_quantity numeric;
  v_held_quantity numeric;
  v_held_secondary numeric;
  v_is_cut boolean;
  v_change_count integer := 0;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Укажите причину корректировки';
  END IF;
  IF jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) = 0 THEN
    RAISE EXCEPTION 'Нет изменений для согласования';
  END IF;

  SELECT * INTO v_request
  FROM public.technologist_requests
  WHERE id = p_technologist_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  IF v_request.status NOT IN ('submitted_to_supply', 'completed') THEN
    RAISE EXCEPTION 'Корректировка доступна только после передачи заявки снабжению';
  END IF;

  SELECT * INTO v_machine
  FROM public.machines
  WHERE id = v_request.machine_id
    AND COALESCE(is_archived, false) = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Машина не найдена'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_scrap_correction_requests
    WHERE technologist_request_id = v_request.id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'По этой заявке уже ожидается согласование корректировки';
  END IF;

  INSERT INTO public.business_scrap_correction_requests (
    id, technologist_request_id, machine_id, requested_by, approver_id, reason
  ) VALUES (
    p_correction_request_id, v_request.id, v_request.machine_id, p_requested_by, p_approver_id, btrim(p_reason)
  );

  INSERT INTO public.tasks (
    id, machine_id, assigned_to, task_type, title, description, status, start_date, deadline
  ) VALUES (
    p_task_id,
    v_request.machine_id,
    p_approver_id,
    'business_scrap_correction_approval'::public.task_type,
    'Согласовать корректировку делового остатка: ' || v_machine.name,
    'Технолог запросил корректировку брони делового остатка. Проверьте изменения «было / станет».',
    'pending'::public.task_status,
    current_date,
    current_date
  );

  UPDATE public.business_scrap_correction_requests
  SET task_id = p_task_id
  WHERE id = p_correction_request_id;

  FOR v_change IN SELECT value FROM jsonb_array_elements(p_changes)
  LOOP
    v_table := v_change->>'request_item_table';
    v_item_id := (v_change->>'request_item_id')::uuid;
    IF v_table NOT IN (
      'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
      'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord'
    ) THEN
      RAISE EXCEPTION 'Некорректная таблица позиции';
    END IF;

    EXECUTE format('SELECT request_id FROM public.%I WHERE id = $1', v_table)
      INTO v_item_request_id USING v_item_id;
    IF v_item_request_id IS DISTINCT FROM v_request.id THEN
      RAISE EXCEPTION 'Позиция не относится к выбранной заявке';
    END IF;

    SELECT COALESCE(array_agg(value::uuid), '{}'::uuid[])
      INTO v_remove_ids
    FROM jsonb_array_elements_text(COALESCE(v_change->'remove_reservation_ids', '[]'::jsonb));

    SELECT COUNT(*), COALESCE(SUM(reservation.reserved_quantity), 0)
      INTO v_remove_count, v_removed
    FROM public.inventory_reservations reservation
    JOIN public.inventory inventory
      ON inventory.id = COALESCE(reservation.source_inventory_id, reservation.inventory_id)
    WHERE reservation.id = ANY(v_remove_ids)
      AND reservation.request_item_table = v_table
      AND reservation.request_item_id = v_item_id
      AND reservation.machine_id = v_request.machine_id
      AND reservation.consumed_at IS NULL
      AND reservation.reservation_source = 'stock'
      AND inventory.is_business_scrap = true;

    IF v_remove_count <> COALESCE(cardinality(v_remove_ids), 0) THEN
      RAISE EXCEPTION 'Одна из снимаемых броней уже изменилась или была списана';
    END IF;

    SELECT COALESCE(SUM(reservation.reserved_quantity), 0)
      INTO v_old_reserved
    FROM public.inventory_reservations reservation
    JOIN public.inventory inventory
      ON inventory.id = COALESCE(reservation.source_inventory_id, reservation.inventory_id)
    WHERE reservation.request_item_table = v_table
      AND reservation.request_item_id = v_item_id
      AND reservation.machine_id = v_request.machine_id
      AND reservation.reservation_source = 'stock'
      AND inventory.is_business_scrap = true;

    v_added := 0;
    v_needed := public.fn_business_scrap_request_item_needed(v_table, v_item_id);

    INSERT INTO public.business_scrap_correction_items (
      correction_request_id, request_item_table, request_item_id,
      remove_reservation_ids, old_reserved_quantity, proposed_reserved_quantity
    ) VALUES (
      p_correction_request_id, v_table, v_item_id,
      v_remove_ids, v_old_reserved, 0
    ) RETURNING id INTO v_item_change_id;

    FOR v_addition IN
      SELECT value FROM jsonb_array_elements(COALESCE(v_change->'additions', '[]'::jsonb))
    LOOP
      v_requested_quantity := COALESCE((v_addition->>'quantity')::numeric, 0);
      v_is_cut := COALESCE((v_addition->>'is_cut_reservation')::boolean, false);
      IF v_requested_quantity <= 0 THEN RAISE EXCEPTION 'Количество добавляемой брони должно быть больше нуля'; END IF;

      SELECT * INTO v_inventory
      FROM public.inventory
      WHERE id = (v_addition->>'inventory_id')::uuid
        AND deleted_at IS NULL
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Выбранный деловой остаток не найден'; END IF;
      IF v_inventory.factory_id IS DISTINCT FROM v_machine.factory_id THEN
        RAISE EXCEPTION 'Деловой остаток относится к другому заводу';
      END IF;
      IF v_inventory.is_business_scrap IS DISTINCT FROM true
        OR COALESCE(v_inventory.business_scrap_state, 'available') <> 'available' THEN
        RAISE EXCEPTION 'Можно удерживать только доступный деловой остаток';
      END IF;

      IF v_is_cut THEN
        IF COALESCE(v_inventory.piece_length_mm, 0) <= 0 THEN
          RAISE EXCEPTION 'Для мерной брони не указана длина куска';
        END IF;
        v_held_secondary := CEIL(v_requested_quantity / v_inventory.piece_length_mm);
        v_held_quantity := v_held_secondary * v_inventory.piece_length_mm;
        IF COALESCE(v_inventory.available_secondary_quantity, 0) < v_held_secondary
          OR v_inventory.available_quantity < v_held_quantity THEN
          RAISE EXCEPTION 'Выбранного делового остатка уже недостаточно';
        END IF;
      ELSE
        v_held_secondary := NULL;
        v_held_quantity := v_requested_quantity;
        IF v_inventory.available_quantity < v_held_quantity THEN
          RAISE EXCEPTION 'Выбранного делового остатка уже недостаточно';
        END IF;
      END IF;

      UPDATE public.inventory
      SET reserved_quantity = reserved_quantity + v_held_quantity,
          reserved_secondary_quantity = CASE
            WHEN v_held_secondary IS NULL THEN reserved_secondary_quantity
            ELSE COALESCE(reserved_secondary_quantity, 0) + v_held_secondary
          END,
          last_updated_by = p_requested_by,
          updated_at = now()
      WHERE id = v_inventory.id;

      INSERT INTO public.business_scrap_correction_holds (
        correction_request_id, correction_item_id, inventory_id,
        requested_quantity, held_quantity, held_secondary_quantity, is_cut_reservation
      ) VALUES (
        p_correction_request_id, v_item_change_id, v_inventory.id,
        v_requested_quantity, v_held_quantity, v_held_secondary, v_is_cut
      );

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type,
        quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
        performed_by, comment
      ) VALUES (
        v_inventory.factory_id, v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
        'reserve'::public.inventory_transaction_type, -v_held_quantity,
        CASE WHEN v_held_secondary IS NULL THEN NULL ELSE -v_held_secondary END,
        v_request.machine_id, v_table, v_item_id, p_requested_by,
        'Временное удержание для согласования корректировки делового остатка'
      );

      v_added := v_added + v_requested_quantity;
    END LOOP;

    IF COALESCE(cardinality(v_remove_ids), 0) = 0 AND v_added = 0 THEN
      RAISE EXCEPTION 'Позиция не содержит изменений';
    END IF;
    IF GREATEST(v_old_reserved - v_removed + v_added, 0) > v_needed THEN
      RAISE EXCEPTION 'Предлагаемая бронь превышает потребность позиции';
    END IF;

    UPDATE public.business_scrap_correction_items
    SET proposed_reserved_quantity = GREATEST(v_old_reserved - v_removed + v_added, 0)
    WHERE id = v_item_change_id;
    v_change_count := v_change_count + 1;
  END LOOP;

  IF v_change_count = 0 THEN RAISE EXCEPTION 'Нет изменений для согласования'; END IF;
  RETURN QUERY SELECT p_correction_request_id, p_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_decide_business_scrap_correction(
  p_correction_request_id uuid,
  p_decided_by uuid,
  p_decision text,
  p_comment text DEFAULT NULL
)
RETURNS TABLE(outcome text, error_message text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_request public.business_scrap_correction_requests%ROWTYPE;
  v_item public.business_scrap_correction_items%ROWTYPE;
  v_hold public.business_scrap_correction_holds%ROWTYPE;
  v_reservation record;
  v_remove_count integer;
  v_needed numeric;
  v_reserved numeric;
  v_conflict text;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Некорректное решение';
  END IF;
  IF p_decision = 'rejected' AND length(btrim(COALESCE(p_comment, ''))) < 3 THEN
    RAISE EXCEPTION 'Укажите причину отклонения';
  END IF;

  SELECT * INTO v_request
  FROM public.business_scrap_correction_requests
  WHERE id = p_correction_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Запрос корректировки не найден'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'Запрос уже обработан'; END IF;
  IF v_request.approver_id IS DISTINCT FROM p_decided_by AND NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_decided_by
      AND role IN ('financial_director', 'commercial_director', 'planning_director')
      AND COALESCE(is_active, true)
  ) THEN
    RAISE EXCEPTION 'Недостаточно прав для решения';
  END IF;

  IF p_decision = 'rejected' THEN
    PERFORM public.fn_release_business_scrap_correction_holds(v_request.id, p_decided_by, 'released');
    UPDATE public.business_scrap_correction_requests
    SET status = 'rejected', decision_comment = btrim(p_comment), decided_by = p_decided_by, decided_at = now()
    WHERE id = v_request.id;
    UPDATE public.business_scrap_correction_items SET status = 'rejected' WHERE correction_request_id = v_request.id;
    UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_request.task_id;
    RETURN QUERY SELECT 'rejected'::text, NULL::text;
    RETURN;
  END IF;

  BEGIN
    FOR v_item IN
      SELECT * FROM public.business_scrap_correction_items
      WHERE correction_request_id = v_request.id
      ORDER BY created_at, id
      FOR UPDATE
    LOOP
      SELECT COUNT(*) INTO v_remove_count
      FROM public.inventory_reservations reservation
      JOIN public.inventory inventory
        ON inventory.id = COALESCE(reservation.source_inventory_id, reservation.inventory_id)
      WHERE reservation.id = ANY(v_item.remove_reservation_ids)
        AND reservation.request_item_table = v_item.request_item_table
        AND reservation.request_item_id = v_item.request_item_id
        AND reservation.machine_id = v_request.machine_id
        AND reservation.consumed_at IS NULL
        AND reservation.reservation_source = 'stock'
        AND inventory.is_business_scrap = true;
      IF v_remove_count <> COALESCE(cardinality(v_item.remove_reservation_ids), 0) THEN
        RAISE EXCEPTION 'Одна из броней уже изменилась или была списана';
      END IF;

      FOR v_reservation IN
        SELECT reservation.id
        FROM public.inventory_reservations reservation
        JOIN public.inventory inventory
          ON inventory.id = COALESCE(reservation.source_inventory_id, reservation.inventory_id)
        WHERE reservation.request_item_table = v_item.request_item_table
          AND reservation.request_item_id = v_item.request_item_id
          AND reservation.machine_id = v_request.machine_id
          AND reservation.consumed_at IS NULL
          AND inventory.is_business_scrap = false
        ORDER BY reservation.created_at, reservation.id
        FOR UPDATE OF reservation
      LOOP
        PERFORM public.fn_unreserve_inventory_reservation(
          v_reservation.id, p_decided_by, 'Пересчёт снабжения после корректировки делового остатка'
        );
      END LOOP;

      FOR v_reservation IN
        SELECT id
        FROM public.inventory_reservations
        WHERE id = ANY(v_item.remove_reservation_ids)
        ORDER BY created_at, id
        FOR UPDATE
      LOOP
        PERFORM public.fn_unreserve_inventory_reservation(
          v_reservation.id, p_decided_by, 'Одобренное снятие брони делового остатка'
        );
      END LOOP;

      FOR v_hold IN
        SELECT * FROM public.business_scrap_correction_holds
        WHERE correction_item_id = v_item.id AND status = 'active'
        ORDER BY created_at, id
        FOR UPDATE
      LOOP
        UPDATE public.inventory
        SET reserved_quantity = GREATEST(reserved_quantity - v_hold.held_quantity, 0),
            reserved_secondary_quantity = CASE
              WHEN v_hold.held_secondary_quantity IS NULL THEN reserved_secondary_quantity
              ELSE GREATEST(COALESCE(reserved_secondary_quantity, 0) - v_hold.held_secondary_quantity, 0)
            END,
            last_updated_by = p_decided_by,
            updated_at = now()
        WHERE id = v_hold.inventory_id;

        INSERT INTO public.inventory_transactions (
          factory_id, inventory_id, material_id, material_variant_id, transaction_type,
          quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
          performed_by, comment
        )
        SELECT
          inventory.factory_id, inventory.id, inventory.material_id, inventory.material_variant_id,
          'unreserve'::public.inventory_transaction_type, v_hold.held_quantity,
          v_hold.held_secondary_quantity, v_request.machine_id,
          v_item.request_item_table, v_item.request_item_id, p_decided_by,
          'Временное удержание снято перед применением корректировки'
        FROM public.inventory inventory WHERE inventory.id = v_hold.inventory_id;

        PERFORM public.fn_reserve_inventory_row_for_machine(
          v_hold.inventory_id,
          v_request.machine_id,
          v_hold.requested_quantity,
          v_item.request_item_table,
          v_item.request_item_id,
          p_decided_by,
          NULL,
          v_hold.is_cut_reservation
        );

        UPDATE public.business_scrap_correction_holds
        SET status = 'applied', released_at = now()
        WHERE id = v_hold.id;
      END LOOP;

      UPDATE public.supply_order_delivery_schedules
      SET status = 'cancelled',
          change_reason = concat_ws(' ', NULLIF(change_reason, ''), 'Отменено после корректировки делового остатка.'),
          updated_by = p_decided_by,
          updated_at = now()
      WHERE request_item_table = v_item.request_item_table
        AND request_item_id = v_item.request_item_id
        AND status = 'planned';

      PERFORM public.fn_set_request_reserved_quantity(v_item.request_item_table, v_item.request_item_id);
      v_needed := public.fn_business_scrap_request_item_needed(v_item.request_item_table, v_item.request_item_id);
      SELECT COALESCE(SUM(reserved_quantity), 0) INTO v_reserved
      FROM public.inventory_reservations
      WHERE request_item_table = v_item.request_item_table
        AND request_item_id = v_item.request_item_id
        AND reservation_source = 'stock';

      IF v_needed > v_reserved THEN
        EXECUTE format(
          'UPDATE public.%I SET order_status = ''pending'', ordered_at = NULL, delivered_at = NULL WHERE id = $1',
          v_item.request_item_table
        ) USING v_item.request_item_id;
      END IF;
    END LOOP;

    UPDATE public.business_scrap_correction_requests
    SET status = 'approved', decision_comment = NULLIF(btrim(COALESCE(p_comment, '')), ''),
        decided_by = p_decided_by, decided_at = now()
    WHERE id = v_request.id;
    UPDATE public.business_scrap_correction_items SET status = 'approved' WHERE correction_request_id = v_request.id;
    UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_request.task_id;
  EXCEPTION WHEN OTHERS THEN
    v_conflict := SQLERRM;
  END;

  IF v_conflict IS NOT NULL THEN
    PERFORM public.fn_release_business_scrap_correction_holds(v_request.id, p_decided_by, 'released');
    UPDATE public.business_scrap_correction_requests
    SET status = 'conflicted', decision_comment = v_conflict,
        decided_by = p_decided_by, decided_at = now()
    WHERE id = v_request.id;
    UPDATE public.business_scrap_correction_items SET status = 'conflicted' WHERE correction_request_id = v_request.id;
    UPDATE public.tasks SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_request.task_id;
    RETURN QUERY SELECT 'conflicted'::text, v_conflict;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'approved'::text, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_business_scrap_request_item_needed(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_release_business_scrap_correction_holds(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_submit_business_scrap_correction(uuid, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_decide_business_scrap_correction(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_business_scrap_request_item_needed(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_release_business_scrap_correction_holds(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_submit_business_scrap_correction(uuid, uuid, uuid, uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_decide_business_scrap_correction(uuid, uuid, text, text) TO service_role;
