-- Global detailing catalogue, per-factory stock, reservations and transfers.

ALTER TABLE public.tasks
  ALTER COLUMN deadline DROP NOT NULL;

-- Historical tasks must not block recreation of a system task. Existing task
-- automation still keeps one active task per machine, assignee and type.
DROP INDEX IF EXISTS public.idx_tasks_machine_assigned_type_unique;
CREATE UNIQUE INDEX idx_tasks_machine_assigned_type_unique
  ON public.tasks(machine_id, assigned_to, task_type)
  WHERE machine_id IS NOT NULL AND status IN ('pending', 'in_progress');

DO $$
BEGIN
  CREATE TYPE public.detailing_check_decision AS ENUM ('auto_no_matches', 'reserved', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.detailing_reservation_status AS ENUM (
    'active',
    'partially_consumed',
    'consumed',
    'released',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.detailing_transfer_status AS ENUM (
    'needs_date',
    'scheduled',
    'partially_received',
    'completed',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.detailing_movement_type AS ENUM (
    'initial_receipt',
    'receipt',
    'adjustment',
    'reserve',
    'unreserve',
    'transfer_out',
    'transfer_in',
    'write_off',
    'rollback'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.normalize_detailing_drawing_number(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(regexp_replace(btrim(COALESCE(p_value, '')), '\s+', ' ', 'g'));
$$;

CREATE TABLE public.detailing_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  drawing_number text NOT NULL CHECK (btrim(drawing_number) <> ''),
  drawing_number_normalized text GENERATED ALWAYS AS (
    public.normalize_detailing_drawing_number(drawing_number)
  ) STORED,
  unit_weight_kg numeric(12,3) NOT NULL CHECK (unit_weight_kg > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  archived_by uuid REFERENCES public.users(id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX detailing_parts_active_drawing_unique
  ON public.detailing_parts(drawing_number_normalized)
  WHERE is_active = true;

CREATE TABLE public.detailing_part_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.detailing_parts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  applies_to_all_versions boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(part_id, product_id)
);

CREATE TABLE public.detailing_part_product_versions (
  part_product_id uuid NOT NULL REFERENCES public.detailing_part_products(id) ON DELETE CASCADE,
  product_version_id uuid NOT NULL REFERENCES public.product_versions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(part_product_id, product_version_id)
);

CREATE TABLE public.detailing_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.detailing_parts(id) ON DELETE RESTRICT,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  on_hand_quantity integer NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  available_quantity integer GENERATED ALWAYS AS (on_hand_quantity - reserved_quantity) STORED,
  updated_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detailing_balances_reserved_not_over_stock CHECK (reserved_quantity <= on_hand_quantity),
  UNIQUE(part_id, factory_id)
);

CREATE TABLE public.detailing_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.technologist_requests(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  machine_item_id uuid REFERENCES public.machine_items(id) ON DELETE SET NULL,
  part_id uuid NOT NULL REFERENCES public.detailing_parts(id) ON DELETE RESTRICT,
  requested_quantity integer NOT NULL CHECK (requested_quantity >= 0),
  consumed_quantity integer NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  released_quantity integer NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  status public.detailing_reservation_status NOT NULL DEFAULT 'active',
  reserved_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detailing_reservation_accounting CHECK (
    consumed_quantity + released_quantity <= requested_quantity
  )
);

CREATE INDEX detailing_reservations_machine_active_idx
  ON public.detailing_reservations(machine_id, status)
  WHERE status IN ('active', 'partially_consumed');

CREATE INDEX detailing_reservations_request_idx
  ON public.detailing_reservations(request_id, created_at);

CREATE TABLE public.detailing_reservation_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL REFERENCES public.detailing_reservations(id) ON DELETE CASCADE,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  consumed_quantity integer NOT NULL DEFAULT 0 CHECK (consumed_quantity >= 0),
  released_quantity integer NOT NULL DEFAULT 0 CHECK (released_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(reservation_id, factory_id)
);

CREATE INDEX detailing_allocations_factory_active_idx
  ON public.detailing_reservation_allocations(factory_id, reservation_id)
  WHERE quantity > 0;

CREATE TABLE public.detailing_request_checks (
  request_id uuid PRIMARY KEY REFERENCES public.technologist_requests(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  machine_item_signature text NOT NULL,
  decision public.detailing_check_decision NOT NULL,
  decided_by uuid NOT NULL REFERENCES public.users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.detailing_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  source_factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  destination_factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  status public.detailing_transfer_status NOT NULL DEFAULT 'needs_date',
  expected_arrival_date date,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detailing_transfer_factories_differ CHECK (source_factory_id <> destination_factory_id)
);

CREATE UNIQUE INDEX detailing_transfers_one_active_direction_idx
  ON public.detailing_transfers(machine_id, source_factory_id, destination_factory_id)
  WHERE status IN ('needs_date', 'scheduled', 'partially_received');

CREATE TABLE public.detailing_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.detailing_transfers(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.detailing_reservations(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.detailing_parts(id) ON DELETE RESTRICT,
  requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
  received_quantity integer NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT detailing_transfer_item_received_limit CHECK (received_quantity <= requested_quantity),
  UNIQUE(transfer_id, reservation_id)
);

CREATE TABLE public.detailing_consumption_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cutting_event_id uuid NOT NULL UNIQUE REFERENCES public.production_fact_cutting_events(id) ON DELETE CASCADE,
  production_fact_id uuid NOT NULL UNIQUE REFERENCES public.production_machine_facts(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'rolled_back')),
  performed_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  rolled_back_by uuid REFERENCES public.users(id)
);

CREATE TABLE public.detailing_consumption_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.detailing_consumption_events(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.detailing_reservations(id) ON DELETE RESTRICT,
  allocation_id uuid NOT NULL REFERENCES public.detailing_reservation_allocations(id) ON DELETE RESTRICT,
  part_id uuid NOT NULL REFERENCES public.detailing_parts(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'rolled_back')),
  created_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_at timestamptz,
  UNIQUE(event_id, allocation_id)
);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS detailing_transfer_id uuid
  REFERENCES public.detailing_transfers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX tasks_active_detailing_transfer_idx
  ON public.tasks(detailing_transfer_id)
  WHERE detailing_transfer_id IS NOT NULL
    AND task_type = 'detailing_transfer'
    AND status IN ('pending', 'in_progress');

CREATE TABLE public.detailing_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.detailing_parts(id) ON DELETE RESTRICT,
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  movement_type public.detailing_movement_type NOT NULL,
  quantity_delta integer NOT NULL DEFAULT 0,
  reserved_delta integer NOT NULL DEFAULT 0,
  on_hand_after integer NOT NULL CHECK (on_hand_after >= 0),
  reserved_after integer NOT NULL CHECK (reserved_after >= 0),
  machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES public.detailing_reservations(id) ON DELETE SET NULL,
  transfer_id uuid REFERENCES public.detailing_transfers(id) ON DELETE SET NULL,
  production_fact_id uuid REFERENCES public.production_machine_facts(id) ON DELETE SET NULL,
  performed_by uuid NOT NULL REFERENCES public.users(id),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX detailing_movements_part_factory_idx
  ON public.detailing_movements(part_id, factory_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.detailing_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'detailing_parts',
    'detailing_balances',
    'detailing_reservations',
    'detailing_reservation_allocations',
    'detailing_request_checks',
    'detailing_transfers',
    'detailing_transfer_items'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_table || '_touch_updated_at', v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.detailing_touch_updated_at()',
      v_table || '_touch_updated_at',
      v_table
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.detailing_validate_product_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_expected_product_id uuid;
  v_actual_product_id uuid;
  v_all_versions boolean;
BEGIN
  SELECT product_id, applies_to_all_versions
  INTO v_expected_product_id, v_all_versions
  FROM public.detailing_part_products
  WHERE id = NEW.part_product_id;

  SELECT product_id
  INTO v_actual_product_id
  FROM public.product_versions
  WHERE id = NEW.product_version_id;

  IF v_all_versions THEN
    RAISE EXCEPTION 'Для совместимости со всеми версиями нельзя выбирать отдельные версии';
  END IF;
  IF v_actual_product_id IS DISTINCT FROM v_expected_product_id THEN
    RAISE EXCEPTION 'Версия не относится к выбранному изделию';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER detailing_part_product_versions_validate
  BEFORE INSERT OR UPDATE ON public.detailing_part_product_versions
  FOR EACH ROW EXECUTE FUNCTION public.detailing_validate_product_version();

CREATE OR REPLACE FUNCTION public.detailing_reject_movement_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'История движений деталировки неизменяема';
END;
$$;

CREATE TRIGGER detailing_movements_immutable
  BEFORE UPDATE OR DELETE ON public.detailing_movements
  FOR EACH ROW EXECUTE FUNCTION public.detailing_reject_movement_changes();

CREATE OR REPLACE FUNCTION public.detailing_role_allowed(p_roles public.user_role[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(public.get_user_role() = ANY(p_roles), false);
$$;

CREATE OR REPLACE FUNCTION public.detailing_assert_actor(
  p_actor uuid,
  p_roles public.user_role[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'Действие должно выполняться от имени текущего пользователя';
  END IF;
  IF NOT public.detailing_role_allowed(p_roles) THEN
    RAISE EXCEPTION 'Недостаточно прав для операции с деталировкой';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.detailing_machine_item_signature(p_machine_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT md5(COALESCE(string_agg(
    concat_ws(':', mi.id, mi.product_id, mi.product_version_id, mi.quantity),
    '|' ORDER BY mi.id
  ), 'empty'))
  FROM public.machine_items mi
  WHERE mi.machine_id = p_machine_id
    AND COALESCE(mi.is_sample, false) = false;
$$;

CREATE OR REPLACE FUNCTION public.detailing_part_matches_machine_item(
  p_part_id uuid,
  p_machine_item_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.machine_items mi
    JOIN public.detailing_part_products dpp
      ON dpp.part_id = p_part_id
     AND dpp.product_id = mi.product_id
    WHERE mi.id = p_machine_item_id
      AND COALESCE(mi.is_sample, false) = false
      AND (
        dpp.applies_to_all_versions
        OR EXISTS (
          SELECT 1
          FROM public.detailing_part_product_versions dppv
          WHERE dppv.part_product_id = dpp.id
            AND dppv.product_version_id = mi.product_version_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.detailing_request_has_available_matches(p_request_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.technologist_requests tr
    JOIN public.machine_items mi ON mi.machine_id = tr.machine_id
    JOIN public.detailing_part_products dpp ON dpp.product_id = mi.product_id
    JOIN public.detailing_parts dp ON dp.id = dpp.part_id AND dp.is_active = true
    JOIN public.detailing_balances db ON db.part_id = dp.id AND db.available_quantity > 0
    WHERE tr.id = p_request_id
      AND COALESCE(mi.is_sample, false) = false
      AND (
        dpp.applies_to_all_versions
        OR EXISTS (
          SELECT 1
          FROM public.detailing_part_product_versions dppv
          WHERE dppv.part_product_id = dpp.id
            AND dppv.product_version_id = mi.product_version_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.detailing_record_movement(
  p_part_id uuid,
  p_factory_id uuid,
  p_type public.detailing_movement_type,
  p_quantity_delta integer,
  p_reserved_delta integer,
  p_actor uuid,
  p_machine_id uuid DEFAULT NULL,
  p_reservation_id uuid DEFAULT NULL,
  p_transfer_id uuid DEFAULT NULL,
  p_production_fact_id uuid DEFAULT NULL,
  p_comment text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance public.detailing_balances%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_balance
  FROM public.detailing_balances
  WHERE part_id = p_part_id AND factory_id = p_factory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Остаток деталировки не найден';
  END IF;

  INSERT INTO public.detailing_movements (
    part_id, factory_id, movement_type, quantity_delta, reserved_delta,
    on_hand_after, reserved_after, machine_id, reservation_id, transfer_id,
    production_fact_id, performed_by, comment
  ) VALUES (
    p_part_id, p_factory_id, p_type, p_quantity_delta, p_reserved_delta,
    v_balance.on_hand_quantity, v_balance.reserved_quantity, p_machine_id,
    p_reservation_id, p_transfer_id, p_production_fact_id, p_actor, NULLIF(btrim(p_comment), '')
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_create_detailing_part(
  p_name text,
  p_drawing_number text,
  p_unit_weight_kg numeric,
  p_factory_id uuid,
  p_initial_quantity integer,
  p_compatibilities jsonb,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part_id uuid;
  v_part_product_id uuid;
  v_compatibility jsonb;
  v_product_id uuid;
  v_version_id uuid;
  v_all_versions boolean;
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );

  IF btrim(COALESCE(p_name, '')) = '' THEN RAISE EXCEPTION 'Укажите название детали'; END IF;
  IF btrim(COALESCE(p_drawing_number, '')) = '' THEN RAISE EXCEPTION 'Укажите номер чертежа'; END IF;
  IF COALESCE(p_unit_weight_kg, 0) <= 0 THEN RAISE EXCEPTION 'Вес детали должен быть больше 0'; END IF;
  IF COALESCE(p_initial_quantity, 0) <= 0 THEN RAISE EXCEPTION 'Начальное количество должно быть больше 0'; END IF;
  IF p_compatibilities IS NULL OR jsonb_typeof(p_compatibilities) <> 'array' OR jsonb_array_length(p_compatibilities) = 0 THEN
    RAISE EXCEPTION 'Выберите хотя бы одно совместимое изделие';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.factories WHERE id = p_factory_id) THEN
    RAISE EXCEPTION 'Завод не найден';
  END IF;

  INSERT INTO public.detailing_parts (
    name, drawing_number, unit_weight_kg, created_by, updated_by
  ) VALUES (
    btrim(p_name), btrim(p_drawing_number), p_unit_weight_kg, p_actor, p_actor
  ) RETURNING id INTO v_part_id;

  FOR v_compatibility IN SELECT value FROM jsonb_array_elements(p_compatibilities)
  LOOP
    BEGIN
      v_product_id := (v_compatibility ->> 'product_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Некорректное изделие в совместимости';
    END;
    v_all_versions := COALESCE((v_compatibility ->> 'all_versions')::boolean, true);

    IF NOT EXISTS (
      SELECT 1 FROM public.products
      WHERE id = v_product_id AND status <> 'archived'
    ) THEN
      RAISE EXCEPTION 'Изделие для совместимости не найдено или архивировано';
    END IF;

    INSERT INTO public.detailing_part_products(part_id, product_id, applies_to_all_versions)
    VALUES (v_part_id, v_product_id, v_all_versions)
    RETURNING id INTO v_part_product_id;

    IF NOT v_all_versions THEN
      IF jsonb_typeof(v_compatibility -> 'version_ids') <> 'array'
         OR jsonb_array_length(v_compatibility -> 'version_ids') = 0 THEN
        RAISE EXCEPTION 'Выберите версии изделия или включите все версии';
      END IF;

      FOR v_version_id IN
        SELECT value::uuid FROM jsonb_array_elements_text(v_compatibility -> 'version_ids')
      LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.product_versions
          WHERE id = v_version_id AND product_id = v_product_id
        ) THEN
          RAISE EXCEPTION 'Выбранная версия не относится к изделию';
        END IF;
        INSERT INTO public.detailing_part_product_versions(part_product_id, product_version_id)
        VALUES (v_part_product_id, v_version_id);
      END LOOP;
    END IF;
  END LOOP;

  INSERT INTO public.detailing_balances(
    part_id, factory_id, on_hand_quantity, reserved_quantity, updated_by
  ) VALUES (
    v_part_id, p_factory_id, p_initial_quantity, 0, p_actor
  );

  PERFORM public.detailing_record_movement(
    v_part_id, p_factory_id, 'initial_receipt', p_initial_quantity, 0, p_actor,
    NULL, NULL, NULL, NULL, 'Начальное поступление при создании карточки'
  );

  RETURN v_part_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_receive_detailing_stock(
  p_part_id uuid,
  p_factory_id uuid,
  p_quantity integer,
  p_comment text,
  p_actor uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  IF COALESCE(p_quantity, 0) <= 0 THEN RAISE EXCEPTION 'Количество поступления должно быть больше 0'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.detailing_parts WHERE id = p_part_id AND is_active = true) THEN
    RAISE EXCEPTION 'Активная карточка детали не найдена';
  END IF;

  INSERT INTO public.detailing_balances(part_id, factory_id, on_hand_quantity, reserved_quantity, updated_by)
  VALUES (p_part_id, p_factory_id, p_quantity, 0, p_actor)
  ON CONFLICT (part_id, factory_id) DO UPDATE
  SET on_hand_quantity = public.detailing_balances.on_hand_quantity + EXCLUDED.on_hand_quantity,
      updated_by = p_actor
  RETURNING on_hand_quantity INTO v_total;

  PERFORM public.detailing_record_movement(
    p_part_id, p_factory_id, 'receipt', p_quantity, 0, p_actor,
    NULL, NULL, NULL, NULL, COALESCE(NULLIF(btrim(p_comment), ''), 'Ручное поступление')
  );
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_adjust_detailing_stock(
  p_part_id uuid,
  p_factory_id uuid,
  p_on_hand_quantity integer,
  p_comment text,
  p_actor uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance public.detailing_balances%ROWTYPE;
  v_delta integer;
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  IF p_on_hand_quantity < 0 THEN RAISE EXCEPTION 'Остаток не может быть отрицательным'; END IF;
  IF btrim(COALESCE(p_comment, '')) = '' THEN RAISE EXCEPTION 'Укажите причину корректировки'; END IF;

  SELECT * INTO v_balance
  FROM public.detailing_balances
  WHERE part_id = p_part_id AND factory_id = p_factory_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Остаток деталировки не найден'; END IF;
  IF p_on_hand_quantity < v_balance.reserved_quantity THEN
    RAISE EXCEPTION 'Новый остаток меньше уже забронированного количества';
  END IF;

  v_delta := p_on_hand_quantity - v_balance.on_hand_quantity;
  UPDATE public.detailing_balances
  SET on_hand_quantity = p_on_hand_quantity, updated_by = p_actor
  WHERE id = v_balance.id;

  PERFORM public.detailing_record_movement(
    p_part_id, p_factory_id, 'adjustment', v_delta, 0, p_actor,
    NULL, NULL, NULL, NULL, p_comment
  );
  RETURN p_on_hand_quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.detailing_previous_workday(p_date date)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
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

CREATE OR REPLACE FUNCTION public.fn_sync_detailing_transfer_task(
  p_transfer_id uuid,
  p_actor uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer record;
  v_cutting_date date;
  v_deadline date;
  v_task public.tasks%ROWTYPE;
  v_task_id uuid;
  v_assignee uuid;
  v_title text;
  v_description text;
BEGIN
  PERFORM set_config('app.detailing_task_sync', 'true', true);

  SELECT
    dt.*,
    m.name AS machine_name,
    sf.name AS source_factory_name,
    df.name AS destination_factory_name
  INTO v_transfer
  FROM public.detailing_transfers dt
  JOIN public.machines m ON m.id = dt.machine_id
  JOIN public.factories sf ON sf.id = dt.source_factory_id
  JOIN public.factories df ON df.id = dt.destination_factory_id
  WHERE dt.id = p_transfer_id
  FOR UPDATE OF dt;

  IF NOT FOUND THEN RAISE EXCEPTION 'Перевозка деталировки не найдена'; END IF;

  SELECT ps.date_start
  INTO v_cutting_date
  FROM public.production_stages ps
  WHERE ps.machine_id = v_transfer.machine_id
    AND ps.stage_type = 'cutting'::public.stage_type
    AND COALESCE(ps.is_skipped, false) = false
  ORDER BY ps.created_at
  LIMIT 1;

  v_deadline := CASE
    WHEN v_cutting_date IS NULL THEN NULL
    ELSE public.detailing_previous_workday(v_cutting_date)
  END;
  v_title := format(
    'Переместить деталировку со склада %s в %s',
    v_transfer.source_factory_name,
    v_transfer.destination_factory_name
  );

  SELECT concat_ws(E'\n',
    'Заказ: ' || v_transfer.machine_name,
    'Направление: ' || v_transfer.source_factory_name || ' → ' || v_transfer.destination_factory_name,
    COALESCE((
      SELECT 'Детали: ' || string_agg(
        dp.name || ' (' || dp.drawing_number || ') — ' || dti.requested_quantity || ' шт.',
        '; ' ORDER BY dp.name, dp.drawing_number
      )
      FROM public.detailing_transfer_items dti
      JOIN public.detailing_parts dp ON dp.id = dti.part_id
      WHERE dti.transfer_id = v_transfer.id
    ), 'Детали будут добавлены после бронирования'),
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

  SELECT t.*
  INTO v_task
  FROM public.tasks t
  WHERE t.detailing_transfer_id = v_transfer.id
    AND t.task_type = 'detailing_transfer'::public.task_type
    AND t.status IN ('pending', 'in_progress')
  ORDER BY t.created_at DESC
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
      start_date, deadline, detailing_transfer_id
    ) VALUES (
      v_transfer.machine_id,
      v_assignee,
      'detailing_transfer'::public.task_type,
      v_title,
      v_description,
      'pending',
      current_date,
      v_deadline,
      v_transfer.id
    ) RETURNING id INTO v_task_id;
  ELSE
    UPDATE public.tasks
    SET assigned_to = v_assignee,
        title = v_title,
        description = v_description,
        deadline = v_deadline,
        updated_at = now()
    WHERE id = v_task.id
    RETURNING id INTO v_task_id;
  END IF;

  RETURN v_task_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_detailing_request_check(
  p_request_id uuid,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid;
  v_signature text;
  v_check public.detailing_request_checks%ROWTYPE;
  v_has_matches boolean;
  v_has_active_reservations boolean;
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );

  SELECT machine_id INTO v_machine_id
  FROM public.technologist_requests
  WHERE id = p_request_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Заявка технолога не найдена'; END IF;

  v_signature := public.detailing_machine_item_signature(v_machine_id);
  SELECT * INTO v_check
  FROM public.detailing_request_checks
  WHERE request_id = p_request_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.detailing_reservations dr
    JOIN public.detailing_reservation_allocations dra ON dra.reservation_id = dr.id
    WHERE dr.request_id = p_request_id
      AND dr.status IN ('active', 'partially_consumed')
      AND dra.quantity > 0
  ) INTO v_has_active_reservations;

  v_has_matches := public.detailing_request_has_available_matches(p_request_id)
    OR v_has_active_reservations;

  IF NOT v_has_matches THEN
    INSERT INTO public.detailing_request_checks(
      request_id, machine_id, machine_item_signature, decision, decided_by, decided_at
    ) VALUES (
      p_request_id, v_machine_id, v_signature, 'auto_no_matches', p_actor, now()
    )
    ON CONFLICT (request_id) DO UPDATE
    SET machine_id = EXCLUDED.machine_id,
        machine_item_signature = EXCLUDED.machine_item_signature,
        decision = 'auto_no_matches',
        decided_by = EXCLUDED.decided_by,
        decided_at = now();

    RETURN jsonb_build_object(
      'ready', true,
      'has_matches', false,
      'decision', 'auto_no_matches'
    );
  END IF;

  IF v_check.request_id IS NOT NULL
     AND v_check.machine_item_signature = v_signature
     AND (
       v_check.decision = 'declined'
       OR (v_check.decision = 'reserved' AND v_has_active_reservations)
     ) THEN
    RETURN jsonb_build_object(
      'ready', true,
      'has_matches', true,
      'decision', v_check.decision::text
    );
  END IF;

  RETURN jsonb_build_object(
    'ready', false,
    'has_matches', true,
    'decision', NULL,
    'message', 'Проверьте подходящую деталировку: забронируйте детали или выберите «Не использовать деталировку».'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_decline_detailing_for_request(
  p_request_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid;
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  SELECT machine_id INTO v_machine_id
  FROM public.technologist_requests
  WHERE id = p_request_id;
  IF v_machine_id IS NULL THEN RAISE EXCEPTION 'Заявка технолога не найдена'; END IF;

  INSERT INTO public.detailing_request_checks(
    request_id, machine_id, machine_item_signature, decision, decided_by, decided_at
  ) VALUES (
    p_request_id,
    v_machine_id,
    public.detailing_machine_item_signature(v_machine_id),
    'declined',
    p_actor,
    now()
  )
  ON CONFLICT (request_id) DO UPDATE
  SET machine_id = EXCLUDED.machine_id,
      machine_item_signature = EXCLUDED.machine_item_signature,
      decision = 'declined',
      decided_by = EXCLUDED.decided_by,
      decided_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_reserve_detailing(
  p_request_id uuid,
  p_machine_item_id uuid,
  p_part_id uuid,
  p_source_factory_id uuid,
  p_quantity integer,
  p_actor uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request record;
  v_balance public.detailing_balances%ROWTYPE;
  v_reservation_id uuid;
  v_transfer_id uuid;
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  IF COALESCE(p_quantity, 0) <= 0 THEN RAISE EXCEPTION 'Количество брони должно быть больше 0'; END IF;

  SELECT
    tr.id,
    tr.machine_id,
    tr.status,
    m.factory_id AS destination_factory_id
  INTO v_request
  FROM public.technologist_requests tr
  JOIN public.machines m ON m.id = tr.machine_id
  WHERE tr.id = p_request_id
    AND COALESCE(m.is_archived, false) = false
  FOR UPDATE OF tr;
  IF NOT FOUND THEN RAISE EXCEPTION 'Активная заявка технолога не найдена'; END IF;
  IF v_request.status NOT IN ('pending_stock_check', 'stock_checked') THEN
    RAISE EXCEPTION 'Деталировку можно бронировать только во время проверки склада';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.machine_items
    WHERE id = p_machine_item_id AND machine_id = v_request.machine_id
  ) THEN
    RAISE EXCEPTION 'Строка изделия не относится к заказу';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.detailing_parts WHERE id = p_part_id AND is_active = true) THEN
    RAISE EXCEPTION 'Карточка детали не найдена или архивирована';
  END IF;
  IF NOT public.detailing_part_matches_machine_item(p_part_id, p_machine_item_id) THEN
    RAISE EXCEPTION 'Деталь не подходит к выбранному изделию или его версии';
  END IF;

  SELECT * INTO v_balance
  FROM public.detailing_balances
  WHERE part_id = p_part_id AND factory_id = p_source_factory_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Остаток детали на выбранном складе не найден'; END IF;
  IF v_balance.available_quantity < p_quantity THEN
    RAISE EXCEPTION 'Недостаточно доступной деталировки: доступно % шт.', v_balance.available_quantity;
  END IF;

  INSERT INTO public.detailing_reservations(
    request_id, machine_id, machine_item_id, part_id, requested_quantity, reserved_by
  ) VALUES (
    p_request_id, v_request.machine_id, p_machine_item_id, p_part_id, p_quantity, p_actor
  ) RETURNING id INTO v_reservation_id;

  INSERT INTO public.detailing_reservation_allocations(reservation_id, factory_id, quantity)
  VALUES (v_reservation_id, p_source_factory_id, p_quantity);

  UPDATE public.detailing_balances
  SET reserved_quantity = reserved_quantity + p_quantity,
      updated_by = p_actor
  WHERE id = v_balance.id;

  PERFORM public.detailing_record_movement(
    p_part_id, p_source_factory_id, 'reserve', 0, p_quantity, p_actor,
    v_request.machine_id, v_reservation_id, NULL, NULL, 'Бронь под заказ'
  );

  IF v_request.destination_factory_id IS NOT NULL
     AND v_request.destination_factory_id <> p_source_factory_id THEN
    SELECT id INTO v_transfer_id
    FROM public.detailing_transfers
    WHERE machine_id = v_request.machine_id
      AND source_factory_id = p_source_factory_id
      AND destination_factory_id = v_request.destination_factory_id
      AND status IN ('needs_date', 'scheduled', 'partially_received')
    LIMIT 1
    FOR UPDATE;

    IF v_transfer_id IS NULL THEN
      INSERT INTO public.detailing_transfers(
        machine_id, source_factory_id, destination_factory_id, created_by, updated_by
      ) VALUES (
        v_request.machine_id, p_source_factory_id, v_request.destination_factory_id, p_actor, p_actor
      ) RETURNING id INTO v_transfer_id;
    END IF;

    INSERT INTO public.detailing_transfer_items(
      transfer_id, reservation_id, part_id, requested_quantity
    ) VALUES (
      v_transfer_id, v_reservation_id, p_part_id, p_quantity
    );

    PERFORM public.fn_sync_detailing_transfer_task(v_transfer_id, p_actor);
  END IF;

  INSERT INTO public.detailing_request_checks(
    request_id, machine_id, machine_item_signature, decision, decided_by, decided_at
  ) VALUES (
    p_request_id,
    v_request.machine_id,
    public.detailing_machine_item_signature(v_request.machine_id),
    'reserved',
    p_actor,
    now()
  )
  ON CONFLICT (request_id) DO UPDATE
  SET machine_id = EXCLUDED.machine_id,
      machine_item_signature = EXCLUDED.machine_item_signature,
      decision = 'reserved',
      decided_by = EXCLUDED.decided_by,
      decided_at = now();

  RETURN jsonb_build_object(
    'reservation_id', v_reservation_id,
    'transfer_id', v_transfer_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.detailing_refresh_transfer_status(
  p_transfer_id uuid,
  p_actor uuid
) RETURNS public.detailing_transfer_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer public.detailing_transfers%ROWTYPE;
  v_requested integer;
  v_received integer;
  v_status public.detailing_transfer_status;
BEGIN
  SELECT * INTO v_transfer
  FROM public.detailing_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Перевозка деталировки не найдена'; END IF;

  IF v_transfer.status = 'cancelled' THEN
    PERFORM public.fn_sync_detailing_transfer_task(p_transfer_id, p_actor);
    RETURN v_transfer.status;
  END IF;

  SELECT
    COALESCE(sum(requested_quantity), 0)::integer,
    COALESCE(sum(received_quantity), 0)::integer
  INTO v_requested, v_received
  FROM public.detailing_transfer_items
  WHERE transfer_id = p_transfer_id;

  v_status := CASE
    WHEN v_requested = 0 OR v_received >= v_requested THEN 'completed'::public.detailing_transfer_status
    WHEN v_received > 0 THEN 'partially_received'::public.detailing_transfer_status
    WHEN v_transfer.expected_arrival_date IS NULL THEN 'needs_date'::public.detailing_transfer_status
    ELSE 'scheduled'::public.detailing_transfer_status
  END;

  UPDATE public.detailing_transfers
  SET status = v_status,
      completed_at = CASE WHEN v_status = 'completed' THEN COALESCE(completed_at, now()) ELSE NULL END,
      updated_by = p_actor
  WHERE id = p_transfer_id;

  PERFORM public.fn_sync_detailing_transfer_task(p_transfer_id, p_actor);
  RETURN v_status;
END;
$$;

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
      SELECT dti.id, dti.transfer_id,
             dti.requested_quantity - dti.received_quantity AS unreceived_quantity
      FROM public.detailing_transfer_items dti
      JOIN public.detailing_transfers dt ON dt.id = dti.transfer_id
      WHERE dti.reservation_id = p_reservation_id
        AND dt.source_factory_id = v_allocation.factory_id
        AND dt.status IN ('needs_date', 'scheduled', 'partially_received')
      FOR UPDATE OF dti, dt
    LOOP
      UPDATE public.detailing_transfer_items
      SET requested_quantity = requested_quantity - LEAST(v_release, v_transfer_item.unreceived_quantity)
      WHERE id = v_transfer_item.id;
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

CREATE OR REPLACE FUNCTION public.fn_release_detailing_reservation(
  p_reservation_id uuid,
  p_reason text,
  p_actor uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  RETURN public.detailing_release_reservation_internal(
    p_reservation_id,
    p_actor,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Бронь сокращена или отменена технологом'),
    false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_set_detailing_transfer_date(
  p_transfer_id uuid,
  p_expected_arrival_date date,
  p_actor uuid
) RETURNS public.detailing_transfer_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['supply_manager', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  IF p_expected_arrival_date IS NULL THEN
    RAISE EXCEPTION 'Укажите ожидаемую дату доставки';
  END IF;

  UPDATE public.detailing_transfers
  SET expected_arrival_date = p_expected_arrival_date,
      updated_by = p_actor
  WHERE id = p_transfer_id
    AND status IN ('needs_date', 'scheduled', 'partially_received');
  IF NOT FOUND THEN RAISE EXCEPTION 'Активная перевозка деталировки не найдена'; END IF;

  RETURN public.detailing_refresh_transfer_status(p_transfer_id, p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_receive_detailing_transfer(
  p_transfer_id uuid,
  p_items jsonb,
  p_actor uuid
) RETURNS public.detailing_transfer_status
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer public.detailing_transfers%ROWTYPE;
  v_payload jsonb;
  v_item public.detailing_transfer_items%ROWTYPE;
  v_reservation public.detailing_reservations%ROWTYPE;
  v_source_allocation public.detailing_reservation_allocations%ROWTYPE;
  v_source_balance public.detailing_balances%ROWTYPE;
  v_actual integer;
  v_remaining integer;
  v_extra integer;
  v_processed integer := 0;
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Укажите фактически принятое количество';
  END IF;

  SELECT * INTO v_transfer
  FROM public.detailing_transfers
  WHERE id = p_transfer_id
    AND status IN ('needs_date', 'scheduled', 'partially_received')
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Активная перевозка деталировки не найдена'; END IF;

  FOR v_payload IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_actual := (v_payload ->> 'quantity')::integer;
      SELECT * INTO v_item
      FROM public.detailing_transfer_items
      WHERE id = (v_payload ->> 'item_id')::uuid
        AND transfer_id = p_transfer_id
      FOR UPDATE;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Некорректная строка приёмки деталировки';
    END;
    IF NOT FOUND THEN RAISE EXCEPTION 'Позиция перевозки не найдена'; END IF;
    IF v_actual < 0 THEN RAISE EXCEPTION 'Фактическое количество не может быть отрицательным'; END IF;
    IF v_actual = 0 THEN CONTINUE; END IF;

    SELECT * INTO v_reservation
    FROM public.detailing_reservations
    WHERE id = v_item.reservation_id
    FOR UPDATE;

    SELECT * INTO v_source_allocation
    FROM public.detailing_reservation_allocations
    WHERE reservation_id = v_item.reservation_id
      AND factory_id = v_transfer.source_factory_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Бронь на складе-источнике не найдена'; END IF;

    SELECT * INTO v_source_balance
    FROM public.detailing_balances
    WHERE part_id = v_item.part_id
      AND factory_id = v_transfer.source_factory_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Остаток на складе-источнике не найден'; END IF;

    v_remaining := v_item.requested_quantity - v_item.received_quantity;
    v_extra := GREATEST(v_actual - v_remaining, 0);
    IF v_extra > v_source_balance.available_quantity THEN
      RAISE EXCEPTION 'Сверхплановая приёмка невозможна: свободно только % шт.', v_source_balance.available_quantity;
    END IF;

    IF v_extra > 0 THEN
      UPDATE public.detailing_balances
      SET reserved_quantity = reserved_quantity + v_extra,
          updated_by = p_actor
      WHERE id = v_source_balance.id;

      UPDATE public.detailing_reservation_allocations
      SET quantity = quantity + v_extra
      WHERE id = v_source_allocation.id;

      UPDATE public.detailing_reservations
      SET requested_quantity = requested_quantity + v_extra
      WHERE id = v_reservation.id;

      UPDATE public.detailing_transfer_items
      SET requested_quantity = requested_quantity + v_extra
      WHERE id = v_item.id;

      PERFORM public.detailing_record_movement(
        v_item.part_id, v_transfer.source_factory_id, 'reserve', 0, v_extra, p_actor,
        v_transfer.machine_id, v_reservation.id, v_transfer.id, NULL,
        'Дополнительная бронь при сверхплановой приёмке'
      );
    END IF;

    IF v_source_allocation.quantity + v_extra < v_actual THEN
      RAISE EXCEPTION 'В источнике недостаточно забронированных деталей для приёмки';
    END IF;

    UPDATE public.detailing_balances
    SET on_hand_quantity = on_hand_quantity - v_actual,
        reserved_quantity = reserved_quantity - v_actual,
        updated_by = p_actor
    WHERE id = v_source_balance.id;

    INSERT INTO public.detailing_balances(
      part_id, factory_id, on_hand_quantity, reserved_quantity, updated_by
    ) VALUES (
      v_item.part_id, v_transfer.destination_factory_id, v_actual, v_actual, p_actor
    )
    ON CONFLICT (part_id, factory_id) DO UPDATE
    SET on_hand_quantity = public.detailing_balances.on_hand_quantity + EXCLUDED.on_hand_quantity,
        reserved_quantity = public.detailing_balances.reserved_quantity + EXCLUDED.reserved_quantity,
        updated_by = p_actor;

    UPDATE public.detailing_reservation_allocations
    SET quantity = quantity - v_actual
    WHERE id = v_source_allocation.id;

    INSERT INTO public.detailing_reservation_allocations(reservation_id, factory_id, quantity)
    VALUES (v_reservation.id, v_transfer.destination_factory_id, v_actual)
    ON CONFLICT (reservation_id, factory_id) DO UPDATE
    SET quantity = public.detailing_reservation_allocations.quantity + EXCLUDED.quantity;

    UPDATE public.detailing_transfer_items
    SET received_quantity = received_quantity + v_actual
    WHERE id = v_item.id;

    PERFORM public.detailing_record_movement(
      v_item.part_id, v_transfer.source_factory_id, 'transfer_out', -v_actual, -v_actual, p_actor,
      v_transfer.machine_id, v_reservation.id, v_transfer.id, NULL,
      'Межскладская приёмка: списано со склада-источника'
    );
    PERFORM public.detailing_record_movement(
      v_item.part_id, v_transfer.destination_factory_id, 'transfer_in', v_actual, v_actual, p_actor,
      v_transfer.machine_id, v_reservation.id, v_transfer.id, NULL,
      'Межскладская приёмка: принято на склад назначения'
    );

    v_processed := v_processed + v_actual;
  END LOOP;

  IF v_processed = 0 THEN RAISE EXCEPTION 'Укажите количество больше 0 хотя бы для одной позиции'; END IF;
  RETURN public.detailing_refresh_transfer_status(p_transfer_id, p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public.detailing_consume_cutting_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fact public.production_machine_facts%ROWTYPE;
  v_event_id uuid;
  v_allocation record;
  v_balance public.detailing_balances%ROWTYPE;
  v_actor uuid;
  v_remaining integer;
BEGIN
  IF NEW.status <> 'applied' OR NEW.fact_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_fact
  FROM public.production_machine_facts
  WHERE id = NEW.fact_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_actor := COALESCE(NEW.created_by, v_fact.created_by);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Для списания деталировки не определён пользователь, сохранивший факт';
  END IF;

  INSERT INTO public.detailing_consumption_events(
    cutting_event_id, production_fact_id, machine_id, factory_id, performed_by
  ) VALUES (
    NEW.id, v_fact.id, NEW.machine_id, v_fact.factory_id, v_actor
  )
  ON CONFLICT (cutting_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN NEW; END IF;

  FOR v_allocation IN
    SELECT
      dra.*,
      dr.part_id,
      dr.machine_id,
      dr.requested_quantity,
      dr.consumed_quantity,
      dr.released_quantity
    FROM public.detailing_reservation_allocations dra
    JOIN public.detailing_reservations dr ON dr.id = dra.reservation_id
    WHERE dr.machine_id = NEW.machine_id
      AND dr.status IN ('active', 'partially_consumed')
      AND dra.factory_id = v_fact.factory_id
      AND dra.quantity > 0
    ORDER BY dra.id
    FOR UPDATE OF dra, dr
  LOOP
    SELECT * INTO v_balance
    FROM public.detailing_balances
    WHERE part_id = v_allocation.part_id
      AND factory_id = v_fact.factory_id
    FOR UPDATE;
    IF NOT FOUND OR v_balance.reserved_quantity < v_allocation.quantity THEN
      RAISE EXCEPTION 'Нарушен баланс забронированной деталировки при списании';
    END IF;

    UPDATE public.detailing_balances
    SET on_hand_quantity = on_hand_quantity - v_allocation.quantity,
        reserved_quantity = reserved_quantity - v_allocation.quantity,
        updated_by = v_actor
    WHERE id = v_balance.id;

    UPDATE public.detailing_reservation_allocations
    SET quantity = 0,
        consumed_quantity = consumed_quantity + v_allocation.quantity
    WHERE id = v_allocation.id;

    SELECT COALESCE(sum(quantity), 0)::integer
    INTO v_remaining
    FROM public.detailing_reservation_allocations
    WHERE reservation_id = v_allocation.reservation_id;

    UPDATE public.detailing_reservations
    SET consumed_quantity = consumed_quantity + v_allocation.quantity,
        status = CASE
          WHEN v_remaining = 0
               AND consumed_quantity + v_allocation.quantity = requested_quantity
            THEN 'consumed'::public.detailing_reservation_status
          ELSE 'partially_consumed'::public.detailing_reservation_status
        END
    WHERE id = v_allocation.reservation_id;

    INSERT INTO public.detailing_consumption_items(
      event_id, reservation_id, allocation_id, part_id, quantity
    ) VALUES (
      v_event_id,
      v_allocation.reservation_id,
      v_allocation.id,
      v_allocation.part_id,
      v_allocation.quantity
    );

    PERFORM public.detailing_record_movement(
      v_allocation.part_id,
      v_fact.factory_id,
      'write_off',
      -v_allocation.quantity,
      -v_allocation.quantity,
      v_actor,
      NEW.machine_id,
      v_allocation.reservation_id,
      NULL,
      v_fact.id,
      'Списание при сохранении факта этапа «Заготовка»'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER detailing_consume_after_cutting_fact
  AFTER INSERT ON public.production_fact_cutting_events
  FOR EACH ROW EXECUTE FUNCTION public.detailing_consume_cutting_event();

CREATE OR REPLACE FUNCTION public.detailing_rollback_cutting_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.detailing_consumption_events%ROWTYPE;
  v_item record;
  v_restore_reserved boolean;
  v_actor uuid;
  v_active_quantity integer;
BEGIN
  IF OLD.status <> 'applied' OR NEW.status <> 'rolled_back' THEN RETURN NEW; END IF;

  SELECT * INTO v_event
  FROM public.detailing_consumption_events
  WHERE cutting_event_id = NEW.id AND status = 'applied'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  v_actor := COALESCE(NEW.rolled_back_by, v_event.performed_by);

  FOR v_item IN
    SELECT
      dci.*,
      dr.machine_item_id,
      dr.machine_id,
      m.factory_id AS current_factory_id,
      COALESCE(m.is_archived, false) AS machine_is_archived
    FROM public.detailing_consumption_items dci
    JOIN public.detailing_reservations dr ON dr.id = dci.reservation_id
    JOIN public.machines m ON m.id = dr.machine_id
    WHERE dci.event_id = v_event.id AND dci.status = 'applied'
    ORDER BY dci.id
    FOR UPDATE OF dci, dr
  LOOP
    v_restore_reserved := NOT v_item.machine_is_archived
      AND v_item.current_factory_id = v_event.factory_id
      AND v_item.machine_item_id IS NOT NULL
      AND public.detailing_part_matches_machine_item(v_item.part_id, v_item.machine_item_id);

    PERFORM 1
    FROM public.detailing_balances
    WHERE part_id = v_item.part_id AND factory_id = v_event.factory_id
    FOR UPDATE;

    UPDATE public.detailing_balances
    SET on_hand_quantity = on_hand_quantity + v_item.quantity,
        reserved_quantity = reserved_quantity + CASE WHEN v_restore_reserved THEN v_item.quantity ELSE 0 END,
        updated_by = v_actor
    WHERE part_id = v_item.part_id AND factory_id = v_event.factory_id;

    IF v_restore_reserved THEN
      UPDATE public.detailing_reservation_allocations
      SET quantity = quantity + v_item.quantity,
          consumed_quantity = consumed_quantity - v_item.quantity
      WHERE id = v_item.allocation_id;
    ELSE
      UPDATE public.detailing_reservation_allocations
      SET consumed_quantity = consumed_quantity - v_item.quantity,
          released_quantity = released_quantity + v_item.quantity
      WHERE id = v_item.allocation_id;
    END IF;

    SELECT COALESCE(sum(quantity), 0)::integer
    INTO v_active_quantity
    FROM public.detailing_reservation_allocations
    WHERE reservation_id = v_item.reservation_id;

    UPDATE public.detailing_reservations
    SET consumed_quantity = consumed_quantity - v_item.quantity,
        released_quantity = released_quantity + CASE WHEN v_restore_reserved THEN 0 ELSE v_item.quantity END,
        status = CASE
          WHEN v_restore_reserved AND consumed_quantity - v_item.quantity > 0
            THEN 'partially_consumed'::public.detailing_reservation_status
          WHEN v_restore_reserved
            THEN 'active'::public.detailing_reservation_status
          WHEN v_active_quantity > 0
            THEN 'partially_consumed'::public.detailing_reservation_status
          ELSE 'released'::public.detailing_reservation_status
        END
    WHERE id = v_item.reservation_id;

    UPDATE public.detailing_consumption_items
    SET status = 'rolled_back', rolled_back_at = now()
    WHERE id = v_item.id;

    PERFORM public.detailing_record_movement(
      v_item.part_id,
      v_event.factory_id,
      'rollback',
      v_item.quantity,
      CASE WHEN v_restore_reserved THEN v_item.quantity ELSE 0 END,
      v_actor,
      v_item.machine_id,
      v_item.reservation_id,
      NULL,
      v_event.production_fact_id,
      CASE
        WHEN v_restore_reserved THEN 'Откат факта: количество восстановлено в бронь'
        ELSE 'Откат факта: заказ неактивен или изменён, количество возвращено в свободный остаток'
      END
    );
  END LOOP;

  UPDATE public.detailing_consumption_events
  SET status = 'rolled_back', rolled_back_at = now(), rolled_back_by = v_actor
  WHERE id = v_event.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER detailing_rollback_after_cutting_event
  AFTER UPDATE OF status ON public.production_fact_cutting_events
  FOR EACH ROW EXECUTE FUNCTION public.detailing_rollback_cutting_event();

CREATE OR REPLACE FUNCTION public.detailing_system_actor(p_machine_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(auth.uid(), m.archived_by, m.created_by)
  FROM public.machines m
  WHERE m.id = p_machine_id;
$$;

CREATE OR REPLACE FUNCTION public.detailing_rebuild_machine_transfers(
  p_machine_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine public.machines%ROWTYPE;
  v_transfer record;
  v_source record;
  v_transfer_id uuid;
BEGIN
  SELECT * INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF p_actor IS NULL THEN RAISE EXCEPTION 'Не определён пользователь для перестроения перевозки деталировки'; END IF;

  FOR v_transfer IN
    SELECT id
    FROM public.detailing_transfers
    WHERE machine_id = p_machine_id
      AND status IN ('needs_date', 'scheduled', 'partially_received')
    FOR UPDATE
  LOOP
    UPDATE public.detailing_transfers
    SET status = 'cancelled', cancelled_at = now(), updated_by = p_actor
    WHERE id = v_transfer.id;
    PERFORM public.fn_sync_detailing_transfer_task(v_transfer.id, p_actor);
  END LOOP;

  IF v_machine.factory_id IS NULL OR COALESCE(v_machine.is_archived, false) THEN RETURN; END IF;

  FOR v_source IN
    SELECT DISTINCT dra.factory_id
    FROM public.detailing_reservation_allocations dra
    JOIN public.detailing_reservations dr ON dr.id = dra.reservation_id
    WHERE dr.machine_id = p_machine_id
      AND dr.status IN ('active', 'partially_consumed')
      AND dra.quantity > 0
      AND dra.factory_id <> v_machine.factory_id
  LOOP
    INSERT INTO public.detailing_transfers(
      machine_id, source_factory_id, destination_factory_id, created_by, updated_by
    ) VALUES (
      p_machine_id, v_source.factory_id, v_machine.factory_id, p_actor, p_actor
    ) RETURNING id INTO v_transfer_id;

    INSERT INTO public.detailing_transfer_items(
      transfer_id, reservation_id, part_id, requested_quantity
    )
    SELECT v_transfer_id, dr.id, dr.part_id, dra.quantity
    FROM public.detailing_reservation_allocations dra
    JOIN public.detailing_reservations dr ON dr.id = dra.reservation_id
    WHERE dr.machine_id = p_machine_id
      AND dr.status IN ('active', 'partially_consumed')
      AND dra.factory_id = v_source.factory_id
      AND dra.quantity > 0;

    PERFORM public.fn_sync_detailing_transfer_task(v_transfer_id, p_actor);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.detailing_machine_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_reservation record;
BEGIN
  v_actor := COALESCE(auth.uid(), NEW.archived_by, NEW.created_by);

  IF COALESCE(NEW.is_archived, false) AND NOT COALESCE(OLD.is_archived, false) THEN
    FOR v_reservation IN
      SELECT id FROM public.detailing_reservations
      WHERE machine_id = NEW.id AND status IN ('active', 'partially_consumed')
      FOR UPDATE
    LOOP
      PERFORM public.detailing_release_reservation_internal(
        v_reservation.id, v_actor, 'Заказ архивирован', true
      );
    END LOOP;
    PERFORM public.detailing_rebuild_machine_transfers(NEW.id, v_actor);
  ELSIF NEW.factory_id IS DISTINCT FROM OLD.factory_id THEN
    PERFORM public.detailing_rebuild_machine_transfers(NEW.id, v_actor);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER detailing_machine_change
  AFTER UPDATE OF factory_id, is_archived ON public.machines
  FOR EACH ROW EXECUTE FUNCTION public.detailing_machine_change_trigger();

CREATE OR REPLACE FUNCTION public.detailing_machine_item_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid := COALESCE(NEW.machine_id, OLD.machine_id);
  v_item_id uuid := COALESCE(NEW.id, OLD.id);
  v_actor uuid;
  v_reservation record;
BEGIN
  v_actor := public.detailing_system_actor(v_machine_id);

  DELETE FROM public.detailing_request_checks drc
  USING public.technologist_requests tr
  WHERE drc.request_id = tr.id AND tr.machine_id = v_machine_id;

  IF TG_OP = 'DELETE' THEN
    FOR v_reservation IN
      SELECT id FROM public.detailing_reservations
      WHERE machine_item_id = v_item_id AND status IN ('active', 'partially_consumed')
      FOR UPDATE
    LOOP
      PERFORM public.detailing_release_reservation_internal(
        v_reservation.id, v_actor, 'Связанная строка изделия удалена', true
      );
    END LOOP;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND (NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.product_version_id IS DISTINCT FROM OLD.product_version_id) THEN
    FOR v_reservation IN
      SELECT id, part_id FROM public.detailing_reservations
      WHERE machine_item_id = v_item_id AND status IN ('active', 'partially_consumed')
      FOR UPDATE
    LOOP
      IF NOT public.detailing_part_matches_machine_item(v_reservation.part_id, v_item_id) THEN
        PERFORM public.detailing_release_reservation_internal(
          v_reservation.id, v_actor, 'Изделие или его версия изменены', true
        );
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER detailing_machine_item_before_delete
  BEFORE DELETE ON public.machine_items
  FOR EACH ROW EXECUTE FUNCTION public.detailing_machine_item_change_trigger();

CREATE TRIGGER detailing_machine_item_after_change
  AFTER INSERT OR UPDATE OF product_id, product_version_id, quantity ON public.machine_items
  FOR EACH ROW EXECUTE FUNCTION public.detailing_machine_item_change_trigger();

CREATE OR REPLACE FUNCTION public.detailing_cutting_stage_change_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid := COALESCE(NEW.machine_id, OLD.machine_id);
  v_actor uuid;
  v_transfer record;
BEGIN
  IF COALESCE(NEW.stage_type, OLD.stage_type) <> 'cutting'::public.stage_type THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_actor := COALESCE(NEW.updated_by, OLD.updated_by, public.detailing_system_actor(v_machine_id));

  FOR v_transfer IN
    SELECT id FROM public.detailing_transfers
    WHERE machine_id = v_machine_id
      AND status IN ('needs_date', 'scheduled', 'partially_received')
  LOOP
    PERFORM public.fn_sync_detailing_transfer_task(v_transfer.id, v_actor);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER detailing_cutting_stage_change
  AFTER INSERT OR UPDATE OF date_start, is_skipped OR DELETE ON public.production_stages
  FOR EACH ROW EXECUTE FUNCTION public.detailing_cutting_stage_change_trigger();

CREATE OR REPLACE FUNCTION public.fn_archive_detailing_part(
  p_part_id uuid,
  p_actor uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.detailing_assert_actor(
    p_actor,
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  );
  PERFORM 1 FROM public.detailing_parts WHERE id = p_part_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Карточка детали не найдена'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.detailing_balances
    WHERE part_id = p_part_id AND (on_hand_quantity > 0 OR reserved_quantity > 0)
  ) THEN
    RAISE EXCEPTION 'Архивирование возможно только при нулевых остатках и бронях';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.detailing_reservations dr
    JOIN public.detailing_reservation_allocations dra ON dra.reservation_id = dr.id
    WHERE dr.part_id = p_part_id
      AND dr.status IN ('active', 'partially_consumed')
      AND dra.quantity > 0
  ) THEN
    RAISE EXCEPTION 'У детали есть незавершённые брони';
  END IF;

  UPDATE public.detailing_parts
  SET is_active = false, archived_at = now(), archived_by = p_actor, updated_by = p_actor
  WHERE id = p_part_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.detailing_protect_system_task()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.task_type = 'detailing_transfer'::public.task_type
     AND NEW.status IN ('completed', 'cancelled')
     AND NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.detailing_task_sync', true), 'false') <> 'true' THEN
    RAISE EXCEPTION 'Задача перемещения деталировки закрывается только при полной приёмке или отмене перевозки';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_detailing_transfer_task
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.detailing_protect_system_task();

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'detailing_parts',
    'detailing_part_products',
    'detailing_part_product_versions',
    'detailing_balances',
    'detailing_reservations',
    'detailing_reservation_allocations',
    'detailing_request_checks',
    'detailing_transfers',
    'detailing_transfer_items',
    'detailing_consumption_events',
    'detailing_consumption_items',
    'detailing_movements'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END $$;

CREATE POLICY detailing_catalogue_read ON public.detailing_parts
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'supply_manager', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_part_products_read ON public.detailing_part_products
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'supply_manager', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_part_versions_read ON public.detailing_part_product_versions
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'supply_manager', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_balances_read ON public.detailing_balances
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_reservations_read ON public.detailing_reservations
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'supply_manager', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_allocations_read ON public.detailing_reservation_allocations
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_checks_read ON public.detailing_request_checks
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_transfers_read ON public.detailing_transfers
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'supply_manager', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_transfer_items_read ON public.detailing_transfer_items
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'supply_manager', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_consumption_events_read ON public.detailing_consumption_events
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_consumption_items_read ON public.detailing_consumption_items
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));
CREATE POLICY detailing_movements_read ON public.detailing_movements
  FOR SELECT TO authenticated
  USING (public.detailing_role_allowed(
    ARRAY['technologist', 'procurement_head', 'planning_director', 'financial_director', 'commercial_director']::public.user_role[]
  ));

INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'inventory_detailing', true, true
FROM unnest(ARRAY[
  'technologist',
  'procurement_head',
  'planning_director',
  'financial_director',
  'commercial_director'
]::public.user_role[]) AS role
ON CONFLICT (role, resource_key) DO UPDATE
SET can_view = EXCLUDED.can_view, can_manage = EXCLUDED.can_manage;

-- Department permissions replace the legacy role fallback as soon as a user has
-- any department rows. Seed the two new resources for every existing scope while
-- preserving explicit decisions that administrators may already have made.
WITH resource_roles(resource_key, role) AS (
  VALUES
    ('inventory_detailing', 'technologist'::public.user_role),
    ('inventory_detailing', 'procurement_head'::public.user_role),
    ('inventory_detailing', 'planning_director'::public.user_role),
    ('inventory_detailing', 'financial_director'::public.user_role),
    ('inventory_detailing', 'commercial_director'::public.user_role),
    ('inventory_detailing_receiving', 'technologist'::public.user_role),
    ('inventory_detailing_receiving', 'planning_director'::public.user_role),
    ('inventory_detailing_receiving', 'financial_director'::public.user_role),
    ('inventory_detailing_receiving', 'commercial_director'::public.user_role)
),
department_scopes AS (
  SELECT
    department.id AS department_id,
    scope.subject_scope,
    resource.resource_key
  FROM public.departments AS department
  CROSS JOIN (VALUES ('head'::text), ('member'::text)) AS scope(subject_scope)
  CROSS JOIN (SELECT DISTINCT resource_key FROM resource_roles) AS resource
),
current_effective_access AS (
  SELECT
    member.department_id,
    CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END AS subject_scope,
    resource.resource_key,
    bool_or(resource_roles.role IS NOT NULL) AS allowed
  FROM public.department_members AS member
  JOIN public.users AS app_user
    ON app_user.id = member.user_id
   AND COALESCE(app_user.is_active, true) = true
  CROSS JOIN (SELECT DISTINCT resource_key FROM resource_roles) AS resource
  LEFT JOIN resource_roles
    ON resource_roles.resource_key = resource.resource_key
   AND resource_roles.role = app_user.role
  GROUP BY
    member.department_id,
    CASE WHEN member.is_department_head THEN 'head' ELSE 'member' END,
    resource.resource_key
)
INSERT INTO public.department_access_permissions (
  department_id, subject_scope, resource_key, can_view, can_manage
)
SELECT
  scope.department_id,
  scope.subject_scope,
  scope.resource_key,
  COALESCE(access.allowed, false),
  COALESCE(access.allowed, false)
FROM department_scopes AS scope
LEFT JOIN current_effective_access AS access
  ON access.department_id = scope.department_id
 AND access.subject_scope = scope.subject_scope
 AND access.resource_key = scope.resource_key
ON CONFLICT (department_id, subject_scope, resource_key) DO NOTHING;

INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'inventory_detailing_receiving', true, true
FROM unnest(ARRAY[
  'technologist',
  'planning_director',
  'financial_director',
  'commercial_director'
]::public.user_role[]) AS role
ON CONFLICT (role, resource_key) DO UPDATE
SET can_view = EXCLUDED.can_view, can_manage = EXCLUDED.can_manage;

REVOKE ALL ON FUNCTION public.normalize_detailing_drawing_number(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_validate_product_version() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_reject_movement_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_role_allowed(public.user_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_assert_actor(uuid, public.user_role[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_machine_item_signature(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_part_matches_machine_item(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_request_has_available_matches(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_record_movement(uuid, uuid, public.detailing_movement_type, integer, integer, uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_previous_workday(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_detailing_transfer_task(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_refresh_transfer_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_release_reservation_internal(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_consume_cutting_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_rollback_cutting_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_system_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_rebuild_machine_transfers(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_machine_change_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_machine_item_change_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_cutting_stage_change_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.detailing_protect_system_task() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.fn_create_detailing_part(text, text, numeric, uuid, integer, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_receive_detailing_stock(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_adjust_detailing_stock(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_validate_detailing_request_check(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_decline_detailing_for_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_reserve_detailing(uuid, uuid, uuid, uuid, integer, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_release_detailing_reservation(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_set_detailing_transfer_date(uuid, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_receive_detailing_transfer(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_archive_detailing_part(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.detailing_role_allowed(public.user_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_detailing_part(text, text, numeric, uuid, integer, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_receive_detailing_stock(uuid, uuid, integer, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_adjust_detailing_stock(uuid, uuid, integer, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_validate_detailing_request_check(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_decline_detailing_for_request(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_reserve_detailing(uuid, uuid, uuid, uuid, integer, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_release_detailing_reservation(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_detailing_transfer_date(uuid, date, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_receive_detailing_transfer(uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_archive_detailing_part(uuid, uuid) TO authenticated, service_role;
