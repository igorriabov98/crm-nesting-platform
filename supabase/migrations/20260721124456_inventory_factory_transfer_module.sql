DO $$
BEGIN
  CREATE TYPE public.inventory_transfer_status AS ENUM (
    'needs_date',
    'scheduled',
    'partially_received',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Legacy inventory helpers are invoked by the transfer SECURITY DEFINER RPCs.
-- Give them an explicit, non-writable-by-clients schema path so their existing
-- unqualified table/function references remain resolvable.
ALTER FUNCTION public.calc_inventory_weight_kg(uuid, uuid, numeric, text, numeric, numeric)
  SET search_path = public;
ALTER FUNCTION public.trg_calc_inventory_weight()
  SET search_path = public;
ALTER FUNCTION public.fn_archive_empty_business_scrap_after_unreserve()
  SET search_path = public;
ALTER FUNCTION public.fn_insert_cut_reservation(
  uuid, uuid, uuid, uuid, text, uuid, numeric, numeric, uuid, numeric, uuid, numeric
) SET search_path = public;
ALTER FUNCTION public.fn_upsert_inventory_stock(
  uuid, uuid, numeric, numeric, text, numeric, text, uuid,
  boolean, uuid, uuid, uuid, numeric, uuid
) SET search_path = public;

CREATE TABLE public.inventory_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  source_factory_id uuid NOT NULL REFERENCES public.factories(id),
  destination_factory_id uuid NOT NULL REFERENCES public.factories(id),
  status public.inventory_transfer_status NOT NULL DEFAULT 'needs_date',
  expected_arrival_date date,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT inventory_transfer_factories_differ CHECK (source_factory_id <> destination_factory_id)
);

CREATE UNIQUE INDEX inventory_transfers_one_active_direction_idx
  ON public.inventory_transfers(machine_id, source_factory_id, destination_factory_id)
  WHERE status IN ('needs_date', 'scheduled', 'partially_received');
CREATE INDEX inventory_transfers_destination_status_idx
  ON public.inventory_transfers(destination_factory_id, status, expected_arrival_date);
CREATE INDEX inventory_transfers_machine_idx
  ON public.inventory_transfers(machine_id, created_at DESC);

CREATE TABLE public.inventory_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.inventory_transfers(id) ON DELETE CASCADE,
  source_inventory_id uuid NOT NULL REFERENCES public.inventory(id),
  destination_inventory_id uuid REFERENCES public.inventory(id),
  material_id uuid NOT NULL REFERENCES public.materials(id),
  material_variant_id uuid REFERENCES public.material_variants(id),
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  requested_quantity numeric NOT NULL CHECK (requested_quantity >= 0),
  received_quantity numeric NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  requested_secondary_quantity numeric,
  received_secondary_quantity numeric,
  unit text NOT NULL,
  secondary_unit text,
  piece_length_mm numeric,
  is_cut_reservation boolean NOT NULL DEFAULT false,
  is_business_scrap boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_transfer_item_received_limit CHECK (received_quantity <= requested_quantity),
  CONSTRAINT inventory_transfer_item_secondary_nonnegative CHECK (
    requested_secondary_quantity IS NULL OR requested_secondary_quantity >= 0
  ),
  CONSTRAINT inventory_transfer_item_secondary_received_nonnegative CHECK (
    received_secondary_quantity IS NULL OR received_secondary_quantity >= 0
  ),
  CONSTRAINT inventory_transfer_item_secondary_received_limit CHECK (
    requested_secondary_quantity IS NULL
    OR COALESCE(received_secondary_quantity, 0) <= requested_secondary_quantity
  )
);

CREATE INDEX inventory_transfer_items_transfer_idx
  ON public.inventory_transfer_items(transfer_id, created_at);
CREATE INDEX inventory_transfer_items_request_idx
  ON public.inventory_transfer_items(request_item_table, request_item_id);

ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS inventory_transfer_item_id uuid
  REFERENCES public.inventory_transfer_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inventory_reservations_transfer_item_idx
  ON public.inventory_reservations(inventory_transfer_item_id)
  WHERE inventory_transfer_item_id IS NOT NULL AND consumed_at IS NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS inventory_transfer_id uuid
  REFERENCES public.inventory_transfers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX tasks_active_inventory_transfer_idx
  ON public.tasks(inventory_transfer_id)
  WHERE inventory_transfer_id IS NOT NULL
    AND task_type = 'inventory_transfer'
    AND status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.inventory_transfer_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_transfers_touch_updated_at
  BEFORE UPDATE ON public.inventory_transfers
  FOR EACH ROW EXECUTE FUNCTION public.inventory_transfer_touch_updated_at();
CREATE TRIGGER inventory_transfer_items_touch_updated_at
  BEFORE UPDATE ON public.inventory_transfer_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_transfer_touch_updated_at();

CREATE OR REPLACE FUNCTION public.inventory_transfer_role_allowed(p_roles public.user_role[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS app_user
    WHERE app_user.id = auth.uid()
      AND app_user.role = ANY(p_roles)
      AND COALESCE(app_user.is_active, true)
  );
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
  IF auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Действие должно выполняться от имени текущего пользователя';
  END IF;
  IF NOT public.inventory_transfer_role_allowed(p_roles) THEN
    RAISE EXCEPTION 'Недостаточно прав для межскладской операции';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_previous_workday(p_date date)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_result date := p_date - 1;
BEGIN
  WHILE extract(isodow FROM v_result) IN (6, 7) LOOP
    v_result := v_result - 1;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_inventory_transfer_task(
  p_transfer_id uuid,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transfer record;
  v_cutting_date date;
  v_deadline date;
  v_task public.tasks%ROWTYPE;
  v_task_id uuid;
  v_assignee uuid;
  v_description text;
BEGIN
  PERFORM set_config('app.inventory_transfer_task_sync', 'true', true);

  SELECT
    transfer.*,
    machine.name AS machine_name,
    source_factory.name AS source_factory_name,
    destination_factory.name AS destination_factory_name
  INTO v_transfer
  FROM public.inventory_transfers AS transfer
  JOIN public.machines AS machine ON machine.id = transfer.machine_id
  JOIN public.factories AS source_factory ON source_factory.id = transfer.source_factory_id
  JOIN public.factories AS destination_factory ON destination_factory.id = transfer.destination_factory_id
  WHERE transfer.id = p_transfer_id
  FOR UPDATE OF transfer;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Перевозка материалов не найдена';
  END IF;

  SELECT stage.date_start
  INTO v_cutting_date
  FROM public.production_stages AS stage
  WHERE stage.machine_id = v_transfer.machine_id
    AND stage.stage_type = 'cutting'::public.stage_type
    AND COALESCE(stage.is_skipped, false) = false
  ORDER BY stage.created_at
  LIMIT 1;

  v_deadline := CASE
    WHEN v_cutting_date IS NULL THEN NULL
    ELSE public.inventory_transfer_previous_workday(v_cutting_date)
  END;

  SELECT concat_ws(E'\n',
    'Заказ: ' || v_transfer.machine_name,
    'Направление: ' || v_transfer.source_factory_name || ' → ' || v_transfer.destination_factory_name,
    COALESCE((
      SELECT 'Материалы: ' || string_agg(
        material.name || ' — ' || trim(to_char(item.requested_quantity, 'FM9999999990.###')) || ' ' || item.unit,
        '; ' ORDER BY material.name, item.id
      )
      FROM public.inventory_transfer_items AS item
      JOIN public.materials AS material ON material.id = item.material_id
      WHERE item.transfer_id = v_transfer.id
        AND item.requested_quantity > 0
    ), 'Материалы будут добавлены после бронирования'),
    CASE
      WHEN v_transfer.expected_arrival_date IS NULL THEN 'Дата доставки снабжением ещё не указана.'
      ELSE 'Ожидаемая доставка: ' || to_char(v_transfer.expected_arrival_date, 'DD.MM.YYYY')
    END,
    CASE
      WHEN v_deadline IS NOT NULL
        AND v_transfer.expected_arrival_date IS NOT NULL
        AND v_transfer.expected_arrival_date > v_deadline
      THEN 'РИСК ОПОЗДАНИЯ: ожидаемая доставка позже дедлайна перемещения.'
      ELSE NULL
    END
  ) INTO v_description;

  SELECT task.*
  INTO v_task
  FROM public.tasks AS task
  WHERE task.inventory_transfer_id = v_transfer.id
    AND task.task_type = 'inventory_transfer'::public.task_type
    AND task.status IN ('pending', 'in_progress')
  ORDER BY task.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_transfer.status IN ('completed', 'cancelled') THEN
    IF v_task.id IS NOT NULL THEN
      UPDATE public.tasks
      SET status = CASE
            WHEN v_transfer.status = 'completed' THEN 'completed'::public.task_status
            ELSE 'cancelled'::public.task_status
          END,
          completed_at = CASE WHEN v_transfer.status = 'completed' THEN now() ELSE NULL END,
          description = v_description,
          updated_at = now()
      WHERE id = v_task.id;
    END IF;
    RETURN v_task.id;
  END IF;

  v_assignee := public.resolve_machine_supply_task_assignee(v_transfer.destination_factory_id);
  IF v_assignee IS NULL THEN
    RAISE EXCEPTION 'Не найден ответственный снабжения для завода назначения';
  END IF;

  IF v_task.id IS NOT NULL AND v_task.deadline IS NULL AND v_deadline IS NOT NULL THEN
    UPDATE public.tasks
    SET status = 'cancelled', updated_at = now()
    WHERE id = v_task.id;
    v_task := NULL;
  END IF;

  IF v_task.id IS NULL THEN
    INSERT INTO public.tasks (
      machine_id, assigned_to, task_type, title, description, status,
      start_date, deadline, inventory_transfer_id
    ) VALUES (
      v_transfer.machine_id,
      v_assignee,
      'inventory_transfer'::public.task_type,
      format(
        'Переместить материалы со склада %s в %s',
        v_transfer.source_factory_name,
        v_transfer.destination_factory_name
      ),
      v_description,
      'pending',
      current_date,
      v_deadline,
      v_transfer.id
    ) RETURNING id INTO v_task_id;
  ELSE
    UPDATE public.tasks
    SET assigned_to = v_assignee,
        title = format(
          'Переместить материалы со склада %s в %s',
          v_transfer.source_factory_name,
          v_transfer.destination_factory_name
        ),
        description = v_description,
        deadline = v_deadline,
        updated_at = now()
    WHERE id = v_task.id
    RETURNING id INTO v_task_id;
  END IF;

  RETURN v_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_refresh_status(
  p_transfer_id uuid,
  p_actor uuid
) RETURNS public.inventory_transfer_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transfer public.inventory_transfers%ROWTYPE;
  v_requested numeric;
  v_received numeric;
  v_status public.inventory_transfer_status;
BEGIN
  SELECT * INTO v_transfer
  FROM public.inventory_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Перевозка материалов не найдена';
  END IF;

  IF v_transfer.status = 'cancelled' THEN
    PERFORM public.fn_sync_inventory_transfer_task(p_transfer_id, p_actor);
    RETURN v_transfer.status;
  END IF;

  SELECT
    COALESCE(sum(item.requested_quantity), 0),
    COALESCE(sum(item.received_quantity), 0)
  INTO v_requested, v_received
  FROM public.inventory_transfer_items AS item
  WHERE item.transfer_id = p_transfer_id;

  v_status := CASE
    WHEN v_requested = 0 AND v_received = 0 THEN 'cancelled'::public.inventory_transfer_status
    WHEN v_received >= v_requested THEN 'completed'::public.inventory_transfer_status
    WHEN v_received > 0 THEN 'partially_received'::public.inventory_transfer_status
    WHEN v_transfer.expected_arrival_date IS NULL THEN 'needs_date'::public.inventory_transfer_status
    ELSE 'scheduled'::public.inventory_transfer_status
  END;

  UPDATE public.inventory_transfers
  SET status = v_status,
      completed_at = CASE WHEN v_status = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
      cancelled_at = CASE WHEN v_status = 'cancelled' THEN COALESCE(cancelled_at, now()) ELSE NULL END,
      updated_by = p_actor
  WHERE id = p_transfer_id;

  PERFORM public.fn_sync_inventory_transfer_task(p_transfer_id, p_actor);
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_attach_reservation_to_transfer(
  p_reservation_id uuid,
  p_destination_factory_id uuid,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_inventory public.inventory%ROWTYPE;
  v_transfer_id uuid;
  v_item_id uuid;
  v_piece_length numeric;
BEGIN
  SELECT * INTO v_reservation
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
    AND consumed_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Бронь материала не найдена';
  END IF;

  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = CASE
    WHEN COALESCE(v_reservation.is_cut_reservation, false)
      THEN COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id)
    ELSE v_reservation.inventory_id
  END
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Исходный складской остаток не найден';
  END IF;

  IF v_inventory.factory_id = p_destination_factory_id THEN
    UPDATE public.inventory_reservations
    SET inventory_transfer_item_id = NULL
    WHERE id = v_reservation.id;
    RETURN NULL;
  END IF;

  SELECT id INTO v_transfer_id
  FROM public.inventory_transfers
  WHERE machine_id = v_reservation.machine_id
    AND source_factory_id = v_inventory.factory_id
    AND destination_factory_id = p_destination_factory_id
    AND status IN ('needs_date', 'scheduled', 'partially_received')
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF v_transfer_id IS NULL THEN
    INSERT INTO public.inventory_transfers (
      machine_id, source_factory_id, destination_factory_id, created_by, updated_by
    ) VALUES (
      v_reservation.machine_id, v_inventory.factory_id, p_destination_factory_id, p_actor, p_actor
    ) RETURNING id INTO v_transfer_id;
  END IF;

  v_piece_length := CASE
    WHEN COALESCE(v_reservation.reserved_secondary_quantity, 0) > 0
      THEN v_reservation.reserved_quantity / v_reservation.reserved_secondary_quantity
    ELSE v_inventory.piece_length_mm
  END;

  INSERT INTO public.inventory_transfer_items (
    transfer_id, source_inventory_id, material_id, material_variant_id,
    request_item_table, request_item_id,
    requested_quantity, requested_secondary_quantity,
    unit, secondary_unit, piece_length_mm,
    is_cut_reservation, is_business_scrap
  ) VALUES (
    v_transfer_id,
    v_inventory.id,
    v_reservation.material_id,
    v_reservation.material_variant_id,
    v_reservation.request_item_table,
    v_reservation.request_item_id,
    v_reservation.reserved_quantity,
    v_reservation.reserved_secondary_quantity,
    v_inventory.unit,
    v_inventory.secondary_unit,
    v_piece_length,
    COALESCE(v_reservation.is_cut_reservation, false),
    COALESCE(v_inventory.is_business_scrap, false)
  ) RETURNING id INTO v_item_id;

  UPDATE public.inventory_reservations
  SET inventory_transfer_item_id = v_item_id
  WHERE id = v_reservation.id;

  PERFORM public.inventory_transfer_refresh_status(v_transfer_id, p_actor);
  RETURN v_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reserve_inventory_row_for_machine_transfer(
  p_inventory_id uuid,
  p_machine_id uuid,
  p_quantity numeric,
  p_request_item_table text,
  p_request_item_id uuid,
  p_reserved_by uuid,
  p_secondary_quantity numeric DEFAULT NULL,
  p_is_cut_reservation boolean DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inventory public.inventory%ROWTYPE;
  v_machine_factory_id uuid;
  v_reservation_id uuid;
  v_last_reservation_id uuid;
  v_remaining numeric := p_quantity;
  v_available_pieces numeric;
  v_full_pieces numeric;
  v_full_quantity numeric;
  v_cut_quantity numeric;
  v_scrap_quantity numeric;
  v_scrap_inventory_id uuid;
  v_possible numeric;
  v_is_cut_table boolean;
BEGIN
  PERFORM public.inventory_transfer_assert_actor(
    p_reserved_by,
    ARRAY[
      'technologist', 'supply_manager', 'procurement_head',
      'planning_director', 'financial_director', 'commercial_director'
    ]::public.user_role[]
  );

  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество бронирования должно быть больше 0';
  END IF;

  SELECT machine.factory_id
  INTO v_machine_factory_id
  FROM public.machines AS machine
  WHERE machine.id = p_machine_id
  FOR UPDATE;

  IF v_machine_factory_id IS NULL THEN
    RAISE EXCEPTION 'Для бронирования не определен завод машины';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.production_machine_facts AS fact
    JOIN public.production_fact_sections AS section ON section.id = fact.section_id
    LEFT JOIN public.production_fact_sections AS parent ON parent.id = section.parent_id
    WHERE fact.machine_id = p_machine_id
      AND COALESCE(section.production_stage_type, parent.production_stage_type)
        = 'cutting'::public.stage_type
  ) THEN
    RAISE EXCEPTION 'Нельзя создать межзаводскую перевозку: по машине уже зафиксирован факт заготовки';
  END IF;

  SELECT * INTO v_inventory
  FROM public.inventory
  WHERE id = p_inventory_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Выбранный складской остаток не найден';
  END IF;

  IF v_inventory.factory_id IS NOT DISTINCT FROM v_machine_factory_id THEN
    RAISE EXCEPTION 'Для склада завода машины используйте обычное бронирование';
  END IF;

  IF v_inventory.business_scrap_state = 'future' THEN
    RAISE EXCEPTION 'Будущий деловой остаток ещё нельзя перевозить';
  END IF;

  v_is_cut_table := COALESCE(
    p_is_cut_reservation,
    p_request_item_table IN ('request_pipe', 'request_knives')
      AND v_inventory.piece_length_mm IS NOT NULL
  );

  IF v_is_cut_table THEN
    IF v_inventory.piece_length_mm IS NULL OR v_inventory.piece_length_mm <= 0 THEN
      RAISE EXCEPTION 'Выбранный складской остаток не является мерным куском';
    END IF;

    v_available_pieces := floor(COALESCE(v_inventory.available_secondary_quantity, 0));
    v_possible := v_available_pieces * v_inventory.piece_length_mm;

    IF v_possible < p_quantity THEN
      RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Доступно: % мм', v_possible;
    END IF;
    IF v_available_pieces <= 0 THEN
      RAISE EXCEPTION 'В выбранной складской строке нет доступных кусков';
    END IF;

    v_full_pieces := LEAST(floor(v_remaining / v_inventory.piece_length_mm), v_available_pieces);
    IF v_full_pieces > 0 THEN
      v_full_quantity := v_full_pieces * v_inventory.piece_length_mm;

      UPDATE public.inventory
      SET total_quantity = total_quantity - v_full_quantity,
          total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - v_full_pieces,
          last_updated_by = p_reserved_by,
          updated_at = now()
      WHERE id = v_inventory.id;

      v_reservation_id := public.fn_insert_cut_reservation(
        v_inventory.id,
        v_inventory.material_id,
        v_inventory.material_variant_id,
        p_machine_id,
        p_request_item_table,
        p_request_item_id,
        v_full_quantity,
        v_full_pieces,
        p_reserved_by,
        v_inventory.piece_length_mm,
        NULL,
        NULL
      );
      v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);
      PERFORM public.inventory_attach_reservation_to_transfer(
        v_reservation_id, v_machine_factory_id, p_reserved_by
      );

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type,
        quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
        performed_by, comment
      ) VALUES (
        v_inventory.factory_id, v_inventory.id, v_inventory.material_id,
        v_inventory.material_variant_id, 'reserve', -v_full_quantity, -v_full_pieces,
        p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by,
        'Бронирование целых кусков для межзаводской перевозки'
      );

      v_remaining := v_remaining - v_full_quantity;
      v_available_pieces := v_available_pieces - v_full_pieces;
    END IF;

    IF v_remaining > 0 AND v_available_pieces > 0 THEN
      v_cut_quantity := v_remaining;
      v_scrap_quantity := v_inventory.piece_length_mm - v_cut_quantity;
      IF v_scrap_quantity < 0 THEN
        RAISE EXCEPTION 'Некорректный раскрой: остаток меньше 0';
      END IF;

      UPDATE public.inventory
      SET total_quantity = total_quantity - v_inventory.piece_length_mm,
          total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - 1,
          last_updated_by = p_reserved_by,
          updated_at = now()
      WHERE id = v_inventory.id;

      IF v_scrap_quantity > 0 THEN
        v_scrap_inventory_id := public.fn_upsert_inventory_stock(
          v_inventory.material_id,
          v_inventory.material_variant_id,
          v_scrap_quantity,
          v_scrap_quantity,
          v_inventory.unit,
          1,
          COALESCE(v_inventory.secondary_unit, 'шт'),
          p_reserved_by,
          true,
          v_inventory.id,
          NULL,
          p_machine_id,
          v_inventory.piece_length_mm,
          v_inventory.factory_id
        );
      ELSE
        v_scrap_inventory_id := NULL;
      END IF;

      v_reservation_id := public.fn_insert_cut_reservation(
        v_inventory.id,
        v_inventory.material_id,
        v_inventory.material_variant_id,
        p_machine_id,
        p_request_item_table,
        p_request_item_id,
        v_cut_quantity,
        1,
        p_reserved_by,
        v_inventory.piece_length_mm,
        v_scrap_inventory_id,
        NULLIF(v_scrap_quantity, 0)
      );
      v_last_reservation_id := COALESCE(v_last_reservation_id, v_reservation_id);
      PERFORM public.inventory_attach_reservation_to_transfer(
        v_reservation_id, v_machine_factory_id, p_reserved_by
      );

      IF v_scrap_inventory_id IS NOT NULL THEN
        UPDATE public.inventory
        SET source_reservation_id = v_reservation_id
        WHERE id = v_scrap_inventory_id
          AND source_reservation_id IS NULL;
      END IF;

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type,
        quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
        performed_by, comment
      ) VALUES (
        v_inventory.factory_id, v_inventory.id, v_inventory.material_id,
        v_inventory.material_variant_id, 'reserve', -v_cut_quantity, -1,
        p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by,
        'Раскрой и бронирование куска для межзаводской перевозки'
      );

      IF v_scrap_inventory_id IS NOT NULL THEN
        INSERT INTO public.inventory_transactions (
          factory_id, inventory_id, material_id, material_variant_id, transaction_type,
          quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
          performed_by, comment
        ) VALUES (
          v_inventory.factory_id, v_scrap_inventory_id, v_inventory.material_id,
          v_inventory.material_variant_id, 'receipt', v_scrap_quantity, 1,
          p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by,
          'Деловой отход после раскроя для межзаводской перевозки'
        );
      END IF;

      v_remaining := 0;
    END IF;

    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Не хватает: %', v_remaining;
    END IF;

    PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
    RETURN v_last_reservation_id;
  END IF;

  IF v_inventory.available_quantity < p_quantity THEN
    RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Доступно: % %',
      v_inventory.available_quantity, v_inventory.unit;
  END IF;
  IF p_secondary_quantity IS NOT NULL
    AND COALESCE(v_inventory.available_secondary_quantity, 0) < p_secondary_quantity THEN
    RAISE EXCEPTION 'Недостаточно на выбранной складской строке. Доступно: % %',
      COALESCE(v_inventory.available_secondary_quantity, 0), COALESCE(v_inventory.secondary_unit, '');
  END IF;

  INSERT INTO public.inventory_reservations (
    inventory_id, material_id, material_variant_id, machine_id,
    request_item_table, request_item_id, reserved_quantity,
    reserved_secondary_quantity, reserved_by
  ) VALUES (
    v_inventory.id, v_inventory.material_id, v_inventory.material_variant_id,
    p_machine_id, p_request_item_table, p_request_item_id, p_quantity,
    p_secondary_quantity, p_reserved_by
  ) RETURNING id INTO v_reservation_id;

  UPDATE public.inventory
  SET reserved_quantity = reserved_quantity + p_quantity,
      reserved_secondary_quantity = CASE
        WHEN p_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0) + p_secondary_quantity
      END,
      last_updated_by = p_reserved_by,
      updated_at = now()
  WHERE id = v_inventory.id;

  PERFORM public.inventory_attach_reservation_to_transfer(
    v_reservation_id, v_machine_factory_id, p_reserved_by
  );

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type,
    quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
    performed_by, comment
  ) VALUES (
    v_inventory.factory_id, v_inventory.id, v_inventory.material_id,
    v_inventory.material_variant_id, 'reserve', -p_quantity,
    CASE WHEN p_secondary_quantity IS NULL THEN NULL ELSE -p_secondary_quantity END,
    p_machine_id, p_request_item_table, p_request_item_id, p_reserved_by,
    'Бронирование для межзаводской перевозки'
  );

  PERFORM public.fn_set_request_reserved_quantity(p_request_item_table, p_request_item_id);
  RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_transfer_receive_to_destination(
  p_item_id uuid,
  p_destination_factory_id uuid,
  p_quantity numeric,
  p_secondary_quantity numeric,
  p_piece_length_mm numeric,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item public.inventory_transfer_items%ROWTYPE;
  v_inventory_id uuid;
  v_source public.inventory%ROWTYPE;
BEGIN
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'Количество перемещения должно быть больше 0';
  END IF;

  SELECT * INTO v_item
  FROM public.inventory_transfer_items
  WHERE id = p_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Позиция перевозки не найдена';
  END IF;

  SELECT * INTO v_source
  FROM public.inventory
  WHERE id = v_item.source_inventory_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Исходный складской остаток не найден';
  END IF;

  v_inventory_id := public.fn_upsert_inventory_stock(
    v_item.material_id,
    v_item.material_variant_id,
    p_piece_length_mm,
    p_quantity,
    v_item.unit,
    p_secondary_quantity,
    v_item.secondary_unit,
    p_actor,
    v_item.is_business_scrap,
    v_item.source_inventory_id,
    NULL,
    v_source.source_machine_id,
    v_source.piece_length_mm,
    p_destination_factory_id
  );

  UPDATE public.inventory
  SET reserved_quantity = reserved_quantity + p_quantity,
      reserved_secondary_quantity = CASE
        WHEN p_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE COALESCE(reserved_secondary_quantity, 0) + p_secondary_quantity
      END,
      last_updated_by = p_actor,
      updated_at = now()
  WHERE id = v_inventory_id;

  INSERT INTO public.inventory_reservations (
    inventory_id, material_id, material_variant_id, source_inventory_id,
    machine_id, request_item_table, request_item_id,
    reserved_quantity, reserved_secondary_quantity,
    reserved_by, is_cut_reservation, reservation_source
  ) VALUES (
    v_inventory_id,
    v_item.material_id,
    v_item.material_variant_id,
    v_item.source_inventory_id,
    (SELECT transfer.machine_id FROM public.inventory_transfers AS transfer WHERE transfer.id = v_item.transfer_id),
    v_item.request_item_table,
    v_item.request_item_id,
    p_quantity,
    p_secondary_quantity,
    p_actor,
    false,
    'stock'
  );

  UPDATE public.inventory_transfer_items
  SET destination_inventory_id = COALESCE(destination_inventory_id, v_inventory_id)
  WHERE id = p_item_id;

  RETURN v_inventory_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_inventory_transfer_date(
  p_transfer_id uuid,
  p_expected_arrival_date date,
  p_actor uuid
) RETURNS public.inventory_transfer_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.inventory_transfer_assert_actor(
    p_actor,
    ARRAY[
      'supply_manager', 'procurement_head',
      'planning_director', 'financial_director', 'commercial_director'
    ]::public.user_role[]
  );

  IF p_expected_arrival_date IS NULL THEN
    RAISE EXCEPTION 'Укажите ожидаемую дату доставки';
  END IF;

  UPDATE public.inventory_transfers
  SET expected_arrival_date = p_expected_arrival_date,
      updated_by = p_actor
  WHERE id = p_transfer_id
    AND status IN ('needs_date', 'scheduled', 'partially_received');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Активная перевозка материалов не найдена';
  END IF;

  RETURN public.inventory_transfer_refresh_status(p_transfer_id, p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_receive_inventory_transfer(
  p_transfer_id uuid,
  p_items jsonb,
  p_actor uuid
) RETURNS public.inventory_transfer_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transfer public.inventory_transfers%ROWTYPE;
  v_payload jsonb;
  v_item public.inventory_transfer_items%ROWTYPE;
  v_source public.inventory%ROWTYPE;
  v_source_reservation public.inventory_reservations%ROWTYPE;
  v_machine_id uuid;
  v_actual numeric;
  v_remaining numeric;
  v_planned numeric;
  v_extra numeric;
  v_planned_secondary numeric;
  v_extra_secondary numeric;
  v_total_secondary numeric;
  v_destination_inventory_id uuid;
  v_extra_destination_inventory_id uuid;
  v_extra_piece_count numeric;
  v_processed numeric := 0;
BEGIN
  PERFORM public.inventory_transfer_assert_actor(
    p_actor,
    ARRAY[
      'technologist', 'planning_director',
      'financial_director', 'commercial_director'
    ]::public.user_role[]
  );

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Укажите фактически принятое количество';
  END IF;

  SELECT transfer.machine_id
  INTO v_machine_id
  FROM public.inventory_transfers AS transfer
  WHERE transfer.id = p_transfer_id;
  IF v_machine_id IS NULL THEN
    RAISE EXCEPTION 'Перевозка материалов не найдена';
  END IF;

  PERFORM 1 FROM public.machines WHERE id = v_machine_id FOR UPDATE;

  SELECT * INTO v_transfer
  FROM public.inventory_transfers
  WHERE id = p_transfer_id
    AND status IN ('needs_date', 'scheduled', 'partially_received')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Активная перевозка материалов не найдена';
  END IF;

  FOR v_payload IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_actual := (v_payload ->> 'quantity')::numeric;
      SELECT * INTO v_item
      FROM public.inventory_transfer_items
      WHERE id = (v_payload ->> 'item_id')::uuid
        AND transfer_id = p_transfer_id
      FOR UPDATE;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Некорректная строка приёмки материалов';
    END;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Позиция перевозки не найдена';
    END IF;
    IF v_actual < 0 THEN
      RAISE EXCEPTION 'Фактическое количество не может быть отрицательным';
    END IF;
    IF v_actual = 0 THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_source
    FROM public.inventory
    WHERE id = v_item.source_inventory_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Исходный складской остаток не найден';
    END IF;

    SELECT * INTO v_source_reservation
    FROM public.inventory_reservations
    WHERE inventory_transfer_item_id = v_item.id
      AND consumed_at IS NULL
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE;

    v_remaining := GREATEST(v_item.requested_quantity - v_item.received_quantity, 0);
    v_planned := LEAST(v_actual, v_remaining);
    v_extra := GREATEST(v_actual - v_remaining, 0);
    v_planned_secondary := NULL;
    v_extra_secondary := NULL;

    IF v_planned > 0 THEN
      IF v_source_reservation.id IS NULL THEN
        RAISE EXCEPTION 'Бронь на складе-источнике не найдена';
      END IF;
      IF v_source_reservation.reserved_quantity < v_planned THEN
        RAISE EXCEPTION 'В источнике недостаточно забронированного материала для приёмки';
      END IF;

      IF v_item.requested_secondary_quantity IS NOT NULL THEN
        IF COALESCE(v_item.piece_length_mm, 0) > 0 THEN
          v_planned_secondary := v_planned / v_item.piece_length_mm;
          IF v_planned_secondary <> trunc(v_planned_secondary) THEN
            RAISE EXCEPTION 'Мерные куски можно принимать только целиком';
          END IF;
        ELSE
          v_planned_secondary := v_planned
            * v_item.requested_secondary_quantity
            / NULLIF(v_item.requested_quantity, 0);
        END IF;
        IF COALESCE(v_source_reservation.reserved_secondary_quantity, 0) < v_planned_secondary THEN
          RAISE EXCEPTION 'В источнике недостаточно забронированного количества во второй единице';
        END IF;
      END IF;

      IF NOT COALESCE(v_source_reservation.is_cut_reservation, false) THEN
        UPDATE public.inventory
        SET total_quantity = total_quantity - v_planned,
            reserved_quantity = reserved_quantity - v_planned,
            total_secondary_quantity = CASE
              WHEN total_secondary_quantity IS NULL OR v_planned_secondary IS NULL
                THEN total_secondary_quantity
              ELSE total_secondary_quantity - v_planned_secondary
            END,
            reserved_secondary_quantity = CASE
              WHEN reserved_secondary_quantity IS NULL OR v_planned_secondary IS NULL
                THEN reserved_secondary_quantity
              ELSE reserved_secondary_quantity - v_planned_secondary
            END,
            last_updated_by = p_actor,
            updated_at = now()
        WHERE id = v_source_reservation.inventory_id;
      END IF;

      v_destination_inventory_id := public.inventory_transfer_receive_to_destination(
        v_item.id,
        v_transfer.destination_factory_id,
        v_planned,
        v_planned_secondary,
        v_item.piece_length_mm,
        p_actor
      );

      IF v_source_reservation.reserved_quantity = v_planned THEN
        DELETE FROM public.inventory_reservations
        WHERE id = v_source_reservation.id;
      ELSE
        UPDATE public.inventory_reservations
        SET reserved_quantity = reserved_quantity - v_planned,
            reserved_secondary_quantity = CASE
              WHEN reserved_secondary_quantity IS NULL OR v_planned_secondary IS NULL
                THEN reserved_secondary_quantity
              ELSE reserved_secondary_quantity - v_planned_secondary
            END
        WHERE id = v_source_reservation.id;
      END IF;

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type,
        quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
        performed_by, comment
      ) VALUES
      (
        v_transfer.source_factory_id, v_item.source_inventory_id,
        v_item.material_id, v_item.material_variant_id, 'transfer_out',
        -v_planned,
        CASE WHEN v_planned_secondary IS NULL THEN NULL ELSE -v_planned_secondary END,
        v_transfer.machine_id, v_item.request_item_table, v_item.request_item_id,
        p_actor, 'Межскладская приёмка: списано со склада-источника'
      ),
      (
        v_transfer.destination_factory_id, v_destination_inventory_id,
        v_item.material_id, v_item.material_variant_id, 'transfer_in',
        v_planned, v_planned_secondary,
        v_transfer.machine_id, v_item.request_item_table, v_item.request_item_id,
        p_actor, 'Межскладская приёмка: принято на склад назначения'
      );
    END IF;

    IF v_extra > 0 THEN
      IF v_item.is_cut_reservation THEN
        IF COALESCE(v_source.piece_length_mm, 0) <= 0 THEN
          RAISE EXCEPTION 'Для сверхплановой приёмки не определена длина исходного куска';
        END IF;
        v_extra_piece_count := v_extra / v_source.piece_length_mm;
        IF v_extra_piece_count <> trunc(v_extra_piece_count) THEN
          RAISE EXCEPTION 'Сверх плана можно принять только целые исходные мерные куски';
        END IF;
        IF floor(COALESCE(v_source.available_secondary_quantity, 0)) < v_extra_piece_count THEN
          RAISE EXCEPTION 'Для сверхплановой приёмки недостаточно свободных мерных кусков';
        END IF;
        v_extra_secondary := v_extra_piece_count;
      ELSIF v_source.available_quantity < v_extra THEN
        RAISE EXCEPTION 'Сверхплановая приёмка невозможна: свободно только % %',
          v_source.available_quantity, v_source.unit;
      ELSIF v_item.requested_secondary_quantity IS NOT NULL THEN
        v_extra_secondary := v_extra
          * v_item.requested_secondary_quantity
          / NULLIF(v_item.requested_quantity, 0);
        IF COALESCE(v_source.available_secondary_quantity, 0) < v_extra_secondary THEN
          RAISE EXCEPTION 'Для сверхплановой приёмки недостаточно количества во второй единице';
        END IF;
      END IF;

      UPDATE public.inventory
      SET total_quantity = total_quantity - CASE
            WHEN v_item.is_cut_reservation THEN v_extra_piece_count * v_source.piece_length_mm
            ELSE v_extra
          END,
          total_secondary_quantity = CASE
            WHEN total_secondary_quantity IS NULL OR v_extra_secondary IS NULL
              THEN total_secondary_quantity
            ELSE total_secondary_quantity - v_extra_secondary
          END,
          last_updated_by = p_actor,
          updated_at = now()
      WHERE id = v_source.id;

      v_extra_destination_inventory_id := public.inventory_transfer_receive_to_destination(
        v_item.id,
        v_transfer.destination_factory_id,
        v_extra,
        v_extra_secondary,
        CASE WHEN v_item.is_cut_reservation THEN v_source.piece_length_mm ELSE v_item.piece_length_mm END,
        p_actor
      );

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type,
        quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
        performed_by, comment
      ) VALUES
      (
        v_transfer.source_factory_id, v_item.source_inventory_id,
        v_item.material_id, v_item.material_variant_id, 'transfer_out',
        -v_extra,
        CASE WHEN v_extra_secondary IS NULL THEN NULL ELSE -v_extra_secondary END,
        v_transfer.machine_id, v_item.request_item_table, v_item.request_item_id,
        p_actor, 'Сверхплановая межскладская приёмка: списано со склада-источника'
      ),
      (
        v_transfer.destination_factory_id, v_extra_destination_inventory_id,
        v_item.material_id, v_item.material_variant_id, 'transfer_in',
        v_extra, v_extra_secondary,
        v_transfer.machine_id, v_item.request_item_table, v_item.request_item_id,
        p_actor, 'Сверхплановая межскладская приёмка: принято на склад назначения'
      );
    END IF;

    v_total_secondary := COALESCE(v_planned_secondary, 0) + COALESCE(v_extra_secondary, 0);
    UPDATE public.inventory_transfer_items
    SET requested_quantity = requested_quantity + v_extra,
        received_quantity = received_quantity + v_actual,
        requested_secondary_quantity = CASE
          WHEN requested_secondary_quantity IS NULL AND v_total_secondary = 0 THEN NULL
          ELSE COALESCE(requested_secondary_quantity, 0) + COALESCE(v_extra_secondary, 0)
        END,
        received_secondary_quantity = CASE
          WHEN requested_secondary_quantity IS NULL AND v_total_secondary = 0 THEN NULL
          ELSE COALESCE(received_secondary_quantity, 0) + v_total_secondary
        END
    WHERE id = v_item.id;

    PERFORM public.fn_set_request_reserved_quantity(v_item.request_item_table, v_item.request_item_id);
    v_processed := v_processed + v_actual;
  END LOOP;

  IF v_processed = 0 THEN
    RAISE EXCEPTION 'Укажите количество больше 0 хотя бы для одной позиции';
  END IF;

  RETURN public.inventory_transfer_refresh_status(p_transfer_id, p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_release_transfer_reservation(
  p_reservation_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_item public.inventory_transfer_items%ROWTYPE;
BEGIN
  SELECT * INTO v_reservation
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;
  IF NOT FOUND OR v_reservation.inventory_transfer_item_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_item
  FROM public.inventory_transfer_items
  WHERE id = v_reservation.inventory_transfer_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.inventory_transfer_items
  SET requested_quantity = GREATEST(requested_quantity - v_reservation.reserved_quantity, received_quantity),
      requested_secondary_quantity = CASE
        WHEN requested_secondary_quantity IS NULL THEN NULL
        ELSE GREATEST(
          requested_secondary_quantity - COALESCE(v_reservation.reserved_secondary_quantity, 0),
          COALESCE(received_secondary_quantity, 0)
        )
      END
  WHERE id = v_item.id;

  UPDATE public.inventory_reservations
  SET inventory_transfer_item_id = NULL
  WHERE id = v_reservation.id;

  PERFORM public.inventory_transfer_refresh_status(v_item.transfer_id, p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_unreserve_inventory_reservation(
  p_reservation_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reservation public.inventory_reservations%ROWTYPE;
  v_scrap public.inventory%ROWTYPE;
  v_source_inventory public.inventory%ROWTYPE;
  v_current_inventory public.inventory%ROWTYPE;
  v_can_rejoin boolean := false;
  v_return_inventory_id uuid;
  v_return_quantity numeric;
BEGIN
  SELECT * INTO v_reservation
  FROM public.inventory_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_reservation.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Бронь уже списана по факту заготовки';
  END IF;

  SELECT * INTO v_current_inventory
  FROM public.inventory
  WHERE id = v_reservation.inventory_id
  FOR UPDATE;

  SELECT * INTO v_source_inventory
  FROM public.inventory
  WHERE id = COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id)
  FOR UPDATE;

  PERFORM public.inventory_release_transfer_reservation(p_reservation_id, p_performed_by);

  IF v_reservation.is_cut_reservation THEN
    IF v_reservation.business_scrap_inventory_id IS NOT NULL
      AND COALESCE(v_reservation.business_scrap_quantity, 0) > 0 THEN
      SELECT * INTO v_scrap
      FROM public.inventory
      WHERE id = v_reservation.business_scrap_inventory_id
      FOR UPDATE;

      v_can_rejoin := FOUND
        AND COALESCE(v_scrap.available_quantity, 0) >= COALESCE(v_reservation.business_scrap_quantity, 0)
        AND COALESCE(v_scrap.available_secondary_quantity, 0) >= 1
        AND v_scrap.deleted_at IS NULL;
    ELSE
      v_can_rejoin := true;
    END IF;

    IF v_can_rejoin THEN
      IF v_reservation.business_scrap_inventory_id IS NOT NULL
        AND COALESCE(v_reservation.business_scrap_quantity, 0) > 0 THEN
        UPDATE public.inventory
        SET total_quantity = total_quantity - v_reservation.business_scrap_quantity,
            total_secondary_quantity = COALESCE(total_secondary_quantity, 0) - 1,
            last_updated_by = p_performed_by,
            updated_at = now()
        WHERE id = v_reservation.business_scrap_inventory_id;
      END IF;

      UPDATE public.inventory
      SET total_quantity = total_quantity
            + COALESCE(v_reservation.original_piece_length_mm, 0)
              * COALESCE(v_reservation.consumed_piece_count, 1),
          total_secondary_quantity = COALESCE(total_secondary_quantity, 0)
            + COALESCE(v_reservation.consumed_piece_count, 1),
          last_updated_by = p_performed_by,
          updated_at = now()
      WHERE id = COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id);

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type,
        quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
        performed_by, comment
      ) VALUES (
        v_source_inventory.factory_id,
        COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id),
        v_reservation.material_id,
        v_reservation.material_variant_id,
        'unreserve',
        v_reservation.reserved_quantity,
        v_reservation.reserved_secondary_quantity,
        v_reservation.machine_id,
        v_reservation.request_item_table,
        v_reservation.request_item_id,
        p_performed_by,
        COALESCE(p_comment, 'Снятие брони с восстановлением куска')
      );
    ELSE
      v_return_quantity := v_reservation.reserved_quantity;
      v_return_inventory_id := public.fn_upsert_inventory_stock(
        v_reservation.material_id,
        v_reservation.material_variant_id,
        v_return_quantity,
        v_return_quantity,
        'мм',
        1,
        'шт',
        p_performed_by,
        true,
        COALESCE(v_reservation.source_inventory_id, v_reservation.inventory_id),
        NULL,
        v_reservation.machine_id,
        v_reservation.original_piece_length_mm,
        v_source_inventory.factory_id
      );

      INSERT INTO public.inventory_transactions (
        factory_id, inventory_id, material_id, material_variant_id, transaction_type,
        quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
        performed_by, comment
      ) VALUES (
        v_source_inventory.factory_id,
        v_return_inventory_id,
        v_reservation.material_id,
        v_reservation.material_variant_id,
        'unreserve',
        v_return_quantity,
        1,
        v_reservation.machine_id,
        v_reservation.request_item_table,
        v_reservation.request_item_id,
        p_performed_by,
        COALESCE(p_comment, 'Снятие брони, возврат забронированного куска')
      );
    END IF;

    UPDATE public.inventory
    SET source_reservation_id = NULL
    WHERE source_reservation_id = p_reservation_id;

    DELETE FROM public.inventory_reservations WHERE id = p_reservation_id;
    PERFORM public.fn_set_request_reserved_quantity(
      v_reservation.request_item_table, v_reservation.request_item_id
    );
    RETURN;
  END IF;

  UPDATE public.inventory
  SET reserved_quantity = GREATEST(reserved_quantity - v_reservation.reserved_quantity, 0),
      reserved_secondary_quantity = CASE
        WHEN v_reservation.reserved_secondary_quantity IS NULL THEN reserved_secondary_quantity
        ELSE GREATEST(
          COALESCE(reserved_secondary_quantity, 0) - v_reservation.reserved_secondary_quantity,
          0
        )
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  WHERE id = v_reservation.inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id, inventory_id, material_id, material_variant_id, transaction_type,
    quantity, secondary_quantity, machine_id, request_item_table, request_item_id,
    performed_by, comment
  ) VALUES (
    v_current_inventory.factory_id,
    v_reservation.inventory_id,
    v_reservation.material_id,
    v_reservation.material_variant_id,
    'unreserve',
    v_reservation.reserved_quantity,
    v_reservation.reserved_secondary_quantity,
    v_reservation.machine_id,
    v_reservation.request_item_table,
    v_reservation.request_item_id,
    p_performed_by,
    p_comment
  );

  UPDATE public.inventory
  SET source_reservation_id = NULL
  WHERE source_reservation_id = p_reservation_id;

  DELETE FROM public.inventory_reservations WHERE id = p_reservation_id;
  PERFORM public.fn_set_request_reserved_quantity(
    v_reservation.request_item_table, v_reservation.request_item_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_assert_machine_transfers_received(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.machines
  WHERE id = p_machine_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_transfers AS transfer
    JOIN public.inventory_transfer_items AS item ON item.transfer_id = transfer.id
    WHERE transfer.machine_id = p_machine_id
      AND transfer.status IN ('needs_date', 'scheduled', 'partially_received')
      AND item.received_quantity < item.requested_quantity
  ) THEN
    RAISE EXCEPTION 'Нельзя зафиксировать заготовку: не весь межзаводской материал принят на склад назначения';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_guard_cutting_fact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage public.stage_type;
BEGIN
  SELECT COALESCE(section.production_stage_type, parent.production_stage_type)
  INTO v_stage
  FROM public.production_fact_sections AS section
  LEFT JOIN public.production_fact_sections AS parent ON parent.id = section.parent_id
  WHERE section.id = NEW.section_id;

  IF v_stage = 'cutting'::public.stage_type THEN
    PERFORM public.inventory_assert_machine_transfers_received(NEW.machine_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_guard_cutting_fact
  BEFORE INSERT OR UPDATE OF machine_id, section_id ON public.production_machine_facts
  FOR EACH ROW EXECUTE FUNCTION public.inventory_guard_cutting_fact();

CREATE OR REPLACE FUNCTION public.inventory_guard_cutting_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.inventory_assert_machine_transfers_received(NEW.machine_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_guard_cutting_event
  BEFORE INSERT ON public.production_fact_cutting_events
  FOR EACH ROW EXECUTE FUNCTION public.inventory_guard_cutting_event();

CREATE OR REPLACE FUNCTION public.inventory_rebuild_machine_transfers(
  p_machine_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_machine public.machines%ROWTYPE;
  v_transfer record;
  v_reservation record;
BEGIN
  SELECT * INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Не определён пользователь для перестроения перевозки материалов';
  END IF;

  FOR v_transfer IN
    SELECT id
    FROM public.inventory_transfers
    WHERE machine_id = p_machine_id
      AND status IN ('needs_date', 'scheduled', 'partially_received')
    FOR UPDATE
  LOOP
    UPDATE public.inventory_reservations AS reservation
    SET inventory_transfer_item_id = NULL
    FROM public.inventory_transfer_items AS item
    WHERE item.transfer_id = v_transfer.id
      AND reservation.inventory_transfer_item_id = item.id
      AND reservation.consumed_at IS NULL;

    UPDATE public.inventory_transfers
    SET status = 'cancelled', cancelled_at = now(), updated_by = p_actor
    WHERE id = v_transfer.id;
    PERFORM public.fn_sync_inventory_transfer_task(v_transfer.id, p_actor);
  END LOOP;

  IF v_machine.factory_id IS NULL OR COALESCE(v_machine.is_archived, false) THEN
    RETURN;
  END IF;

  FOR v_reservation IN
    SELECT reservation.id
    FROM public.inventory_reservations AS reservation
    JOIN public.inventory AS inventory ON inventory.id = reservation.inventory_id
    WHERE reservation.machine_id = p_machine_id
      AND reservation.consumed_at IS NULL
      AND inventory.factory_id <> v_machine.factory_id
    ORDER BY reservation.created_at, reservation.id
    FOR UPDATE OF reservation
  LOOP
    PERFORM public.inventory_attach_reservation_to_transfer(
      v_reservation.id, v_machine.factory_id, p_actor
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_machine_factory_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF NEW.factory_id IS NOT DISTINCT FROM OLD.factory_id THEN
    RETURN NEW;
  END IF;

  v_actor := COALESCE(auth.uid(), NEW.archived_by, NEW.created_by);
  PERFORM public.inventory_rebuild_machine_transfers(NEW.id, v_actor);
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_machine_factory_change
  AFTER UPDATE OF factory_id ON public.machines
  FOR EACH ROW EXECUTE FUNCTION public.inventory_machine_factory_change_trigger();

CREATE OR REPLACE FUNCTION public.inventory_cutting_stage_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_machine_id uuid := COALESCE(NEW.machine_id, OLD.machine_id);
  v_actor uuid;
  v_transfer record;
BEGIN
  IF COALESCE(NEW.stage_type, OLD.stage_type) <> 'cutting'::public.stage_type THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(NEW.updated_by, OLD.updated_by, auth.uid(), machine.created_by)
  INTO v_actor
  FROM public.machines AS machine
  WHERE machine.id = v_machine_id;

  FOR v_transfer IN
    SELECT id
    FROM public.inventory_transfers
    WHERE machine_id = v_machine_id
      AND status IN ('needs_date', 'scheduled', 'partially_received')
  LOOP
    PERFORM public.fn_sync_inventory_transfer_task(v_transfer.id, v_actor);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER inventory_cutting_stage_change
  AFTER INSERT OR UPDATE OF date_start, is_skipped OR DELETE ON public.production_stages
  FOR EACH ROW EXECUTE FUNCTION public.inventory_cutting_stage_change_trigger();

CREATE OR REPLACE FUNCTION public.inventory_protect_system_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.task_type = 'inventory_transfer'::public.task_type
    AND NEW.status IN ('completed', 'cancelled')
    AND NEW.status IS DISTINCT FROM OLD.status
    AND COALESCE(current_setting('app.inventory_transfer_task_sync', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Задача перемещения материалов закрывается только при полной приёмке или отмене перевозки';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_inventory_transfer_task
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.inventory_protect_system_task();

ALTER TABLE public.inventory_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY inventory_transfers_read
  ON public.inventory_transfers
  FOR SELECT TO authenticated
  USING (public.inventory_transfer_role_allowed(
    ARRAY[
      'technologist', 'supply_manager', 'procurement_head',
      'planning_director', 'financial_director', 'commercial_director'
    ]::public.user_role[]
  ));

CREATE POLICY inventory_transfer_items_read
  ON public.inventory_transfer_items
  FOR SELECT TO authenticated
  USING (public.inventory_transfer_role_allowed(
    ARRAY[
      'technologist', 'supply_manager', 'procurement_head',
      'planning_director', 'financial_director', 'commercial_director'
    ]::public.user_role[]
  ));

GRANT SELECT ON TABLE public.inventory_transfers TO authenticated, service_role;
GRANT SELECT ON TABLE public.inventory_transfer_items TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.inventory_transfer_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_transfer_role_allowed(public.user_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_transfer_assert_actor(uuid, public.user_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_transfer_previous_workday(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_inventory_transfer_task(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_transfer_refresh_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_attach_reservation_to_transfer(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_transfer_receive_to_destination(uuid, uuid, numeric, numeric, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_release_transfer_reservation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_assert_machine_transfers_received(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_guard_cutting_fact() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_guard_cutting_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_rebuild_machine_transfers(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_machine_factory_change_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_cutting_stage_change_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_protect_system_task() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.fn_reserve_inventory_row_for_machine_transfer(uuid, uuid, numeric, text, uuid, uuid, numeric, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_set_inventory_transfer_date(uuid, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_receive_inventory_transfer(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_unreserve_inventory_reservation(uuid, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.inventory_transfer_role_allowed(public.user_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_reserve_inventory_row_for_machine_transfer(uuid, uuid, numeric, text, uuid, uuid, numeric, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_inventory_transfer_date(uuid, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_receive_inventory_transfer(uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_unreserve_inventory_reservation(uuid, uuid, text) TO authenticated, service_role;
