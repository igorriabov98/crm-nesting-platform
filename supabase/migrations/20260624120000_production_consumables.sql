-- Production consumables: factory-scoped catalog, stock ledger, requests and delivery tracking.

CREATE TYPE consumable_request_priority AS ENUM ('standard', 'high');
CREATE TYPE consumable_request_status AS ENUM (
  'draft',
  'new',
  'invoice_taken',
  'delivery',
  'received',
  'received_partial',
  'cancelled'
);
CREATE TYPE consumable_delivery_method AS ENUM ('nova_poshta', 'other');
CREATE TYPE consumable_movement_type AS ENUM (
  'initial',
  'manual_receipt',
  'request_receipt',
  'consumption',
  'adjustment'
);

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'consumable_request_review';
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'consumable_request_shortage';

CREATE TABLE consumable_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_consumable_categories_factory_name
  ON consumable_categories(factory_id, lower(name));

CREATE TABLE consumables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES consumable_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  characteristics TEXT NOT NULL,
  article TEXT NOT NULL,
  unit TEXT NOT NULL,
  minimum_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_consumables_factory_article
  ON consumables(factory_id, lower(article));
CREATE INDEX idx_consumables_factory_category
  ON consumables(factory_id, category_id, is_active);

CREATE TABLE consumable_balances (
  consumable_id UUID PRIMARY KEY REFERENCES consumables(id) ON DELETE CASCADE,
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  current_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consumable_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  consumable_id UUID NOT NULL REFERENCES consumables(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  priority consumable_request_priority NOT NULL DEFAULT 'standard',
  requested_quantity NUMERIC(14,3) NOT NULL CHECK (requested_quantity > 0),
  received_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  status consumable_request_status NOT NULL DEFAULT 'draft',
  auto_generated BOOLEAN NOT NULL DEFAULT false,
  quantity_is_automatic BOOLEAN NOT NULL DEFAULT false,
  request_date DATE,
  need_by_date DATE,
  submitted_at TIMESTAMPTZ,
  invoice_taken_at TIMESTAMPTZ,
  delivery_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  remainder_closed_reason TEXT,
  delivery_method consumable_delivery_method,
  nova_poshta_ttn TEXT,
  carrier_name TEXT,
  carrier_eta DATE,
  tracking_status TEXT,
  tracking_status_code TEXT,
  tracking_estimated_delivery_date DATE,
  tracking_last_checked_at TIMESTAMPTZ,
  tracking_error TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumable_requests_received_not_over
    CHECK (received_quantity <= requested_quantity)
);

CREATE UNIQUE INDEX idx_consumable_requests_auto_draft
  ON consumable_requests(consumable_id)
  WHERE status = 'draft' AND auto_generated = true;
CREATE INDEX idx_consumable_requests_factory_status
  ON consumable_requests(factory_id, status, created_at DESC);
CREATE INDEX idx_consumable_requests_consumable
  ON consumable_requests(consumable_id, created_at DESC);
CREATE INDEX idx_consumable_requests_tracking
  ON consumable_requests(status, tracking_last_checked_at)
  WHERE status = 'delivery' AND delivery_method = 'nova_poshta';

CREATE TABLE consumable_request_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consumable_requests(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  received_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consumable_request_receipts_request
  ON consumable_request_receipts(request_id, received_at DESC);

CREATE TABLE consumable_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumable_id UUID NOT NULL REFERENCES consumables(id) ON DELETE RESTRICT,
  factory_id UUID NOT NULL REFERENCES factories(id) ON DELETE CASCADE,
  movement_type consumable_movement_type NOT NULL,
  quantity_delta NUMERIC(14,3) NOT NULL,
  balance_before NUMERIC(14,3) NOT NULL,
  balance_after NUMERIC(14,3) NOT NULL CHECK (balance_after >= 0),
  request_id UUID REFERENCES consumable_requests(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consumable_movements_consumable_created
  ON consumable_movements(consumable_id, created_at DESC);

CREATE TABLE consumable_request_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES consumable_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  old_status consumable_request_status,
  new_status consumable_request_status,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consumable_request_events_request_created
  ON consumable_request_events(request_id, created_at DESC);

ALTER TABLE company_settings
  ADD COLUMN supply_consumables_department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD COLUMN consumable_request_id UUID REFERENCES consumable_requests(id) ON DELETE CASCADE;

ALTER TABLE notifications
  ADD COLUMN consumable_request_id UUID REFERENCES consumable_requests(id) ON DELETE CASCADE;

CREATE INDEX idx_tasks_consumable_request
  ON tasks(consumable_request_id, status);
CREATE UNIQUE INDEX idx_tasks_consumable_request_active_type
  ON tasks(consumable_request_id, task_type)
  WHERE consumable_request_id IS NOT NULL
    AND status IN ('pending', 'in_progress');
CREATE INDEX idx_notifications_consumable_request
  ON notifications(consumable_request_id, created_at DESC);

CREATE OR REPLACE FUNCTION consumables_can_view_factory(p_factory_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE public.get_user_role()
    WHEN 'production_manager' THEN public.get_user_factory_id() = p_factory_id
    WHEN 'supply_manager' THEN true
    WHEN 'procurement_head' THEN true
    WHEN 'planning_director' THEN true
    WHEN 'financial_director' THEN true
    WHEN 'commercial_director' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION consumables_can_manage_factory(p_factory_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE public.get_user_role()
    WHEN 'production_manager' THEN public.get_user_factory_id() = p_factory_id
    WHEN 'planning_director' THEN true
    WHEN 'financial_director' THEN true
    WHEN 'commercial_director' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION consumables_can_supply_requests()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.get_user_role() IN (
    'supply_manager',
    'procurement_head',
    'planning_director',
    'financial_director',
    'commercial_director'
  );
$$;

CREATE OR REPLACE FUNCTION consumables_supply_department_head()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_department_id UUID;
  v_head UUID;
BEGIN
  SELECT supply_consumables_department_id
  INTO v_department_id
  FROM company_settings
  WHERE id = '00000000-0000-0000-0000-000000000001';

  IF v_department_id IS NULL THEN
    RAISE EXCEPTION 'В настройках компании не выбран отдел снабжения по расходникам';
  END IF;

  SELECT d.head_user_id
  INTO v_head
  FROM departments d
  JOIN users u ON u.id = d.head_user_id AND u.is_active = true
  WHERE d.id = v_department_id AND d.is_active = true;

  IF v_head IS NULL THEN
    SELECT dm.user_id
    INTO v_head
    FROM department_members dm
    JOIN users u ON u.id = dm.user_id AND u.is_active = true
    WHERE dm.department_id = v_department_id
      AND dm.is_department_head = true
    ORDER BY dm.joined_at
    LIMIT 1;
  END IF;

  IF v_head IS NULL THEN
    RAISE EXCEPTION 'У выбранного отдела снабжения нет активного руководителя';
  END IF;

  RETURN v_head;
END;
$$;

CREATE OR REPLACE FUNCTION consumables_notify_production(
  p_factory_id UUID,
  p_request_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO notifications(user_id, type, title, message, consumable_request_id)
  SELECT DISTINCT u.id, p_type, p_title, p_message, p_request_id
  FROM users u
  WHERE u.is_active = true
    AND u.factory_id = p_factory_id
    AND u.role = 'production_manager';
$$;

CREATE OR REPLACE FUNCTION consumables_notify_supply(
  p_request_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_message TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO notifications(user_id, type, title, message, consumable_request_id)
  SELECT u.id, p_type, p_title, p_message, p_request_id
  FROM users u
  WHERE u.is_active = true
    AND u.role IN ('supply_manager', 'procurement_head');
$$;

CREATE OR REPLACE FUNCTION sync_consumable_auto_draft(p_consumable_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item consumables%ROWTYPE;
  v_balance NUMERIC(14,3);
  v_deficit NUMERIC(14,3);
  v_draft consumable_requests%ROWTYPE;
  v_has_open_request BOOLEAN;
  v_actor UUID := auth.uid();
BEGIN
  SELECT * INTO v_item FROM consumables WHERE id = p_consumable_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF NOT consumables_can_manage_factory(v_item.factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для этого завода';
  END IF;

  SELECT current_quantity INTO v_balance
  FROM consumable_balances
  WHERE consumable_id = p_consumable_id;

  v_balance := COALESCE(v_balance, 0);
  v_deficit := GREATEST(v_item.minimum_quantity - v_balance, 0);

  SELECT * INTO v_draft
  FROM consumable_requests
  WHERE consumable_id = p_consumable_id
    AND status = 'draft'
    AND auto_generated = true
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM consumable_requests
    WHERE consumable_id = p_consumable_id
      AND status IN ('new', 'invoice_taken', 'delivery')
  ) INTO v_has_open_request;

  IF v_has_open_request THEN
    IF v_draft.id IS NOT NULL AND v_draft.quantity_is_automatic THEN
      DELETE FROM consumable_requests WHERE id = v_draft.id;
    END IF;
  ELSIF v_deficit > 0 AND v_item.is_active THEN
    IF v_draft.id IS NULL THEN
      INSERT INTO consumable_requests(
        factory_id,
        consumable_id,
        created_by,
        requested_quantity,
        auto_generated,
        quantity_is_automatic
      )
      VALUES (
        v_item.factory_id,
        v_item.id,
        COALESCE(v_actor, v_item.created_by),
        v_deficit,
        true,
        true
      );
    ELSIF v_draft.quantity_is_automatic THEN
      UPDATE consumable_requests
      SET requested_quantity = v_deficit, updated_at = now()
      WHERE id = v_draft.id;
    END IF;
  ELSIF v_draft.id IS NOT NULL AND v_draft.quantity_is_automatic THEN
    DELETE FROM consumable_requests WHERE id = v_draft.id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION consumables_apply_stock_movement(
  p_consumable_id UUID,
  p_movement_type consumable_movement_type,
  p_quantity_delta NUMERIC,
  p_comment TEXT,
  p_request_id UUID,
  p_actor UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item consumables%ROWTYPE;
  v_before NUMERIC(14,3);
  v_after NUMERIC(14,3);
BEGIN
  SELECT * INTO v_item
  FROM consumables
  WHERE id = p_consumable_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Расходник не найден'; END IF;

  INSERT INTO consumable_balances(consumable_id, factory_id, current_quantity)
  VALUES (v_item.id, v_item.factory_id, 0)
  ON CONFLICT (consumable_id) DO NOTHING;

  SELECT current_quantity INTO v_before
  FROM consumable_balances
  WHERE consumable_id = p_consumable_id
  FOR UPDATE;

  v_after := v_before + p_quantity_delta;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Недостаточно остатка. Доступно: % %', v_before, v_item.unit;
  END IF;

  UPDATE consumable_balances
  SET current_quantity = v_after, updated_at = now()
  WHERE consumable_id = p_consumable_id;

  INSERT INTO consumable_movements(
    consumable_id,
    factory_id,
    movement_type,
    quantity_delta,
    balance_before,
    balance_after,
    request_id,
    created_by,
    comment
  )
  VALUES (
    p_consumable_id,
    v_item.factory_id,
    p_movement_type,
    p_quantity_delta,
    v_before,
    v_after,
    p_request_id,
    p_actor,
    NULLIF(trim(p_comment), '')
  );

  PERFORM sync_consumable_auto_draft(p_consumable_id);
  RETURN v_after;
END;
$$;

REVOKE ALL ON FUNCTION consumables_apply_stock_movement(
  UUID,
  consumable_movement_type,
  NUMERIC,
  TEXT,
  UUID,
  UUID
) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION create_consumable_item(
  p_factory_id UUID,
  p_category_id UUID,
  p_name TEXT,
  p_characteristics TEXT,
  p_article TEXT,
  p_unit TEXT,
  p_minimum_quantity NUMERIC,
  p_initial_quantity NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT consumables_can_manage_factory(p_factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для этого завода';
  END IF;
  IF trim(p_name) = '' OR trim(p_characteristics) = '' OR trim(p_article) = '' OR trim(p_unit) = '' THEN
    RAISE EXCEPTION 'Заполните название, характеристику, артикул и единицу учета';
  END IF;
  IF p_minimum_quantity < 0 OR p_initial_quantity < 0 THEN
    RAISE EXCEPTION 'Количество не может быть отрицательным';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM consumable_categories
    WHERE id = p_category_id AND factory_id = p_factory_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Категория не найдена';
  END IF;

  INSERT INTO consumables(
    factory_id,
    category_id,
    name,
    characteristics,
    article,
    unit,
    minimum_quantity,
    created_by
  )
  VALUES (
    p_factory_id,
    p_category_id,
    trim(p_name),
    trim(p_characteristics),
    trim(p_article),
    trim(p_unit),
    p_minimum_quantity,
    auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO consumable_balances(consumable_id, factory_id, current_quantity)
  VALUES (v_id, p_factory_id, 0);

  IF p_initial_quantity > 0 THEN
    PERFORM consumables_apply_stock_movement(
      v_id,
      'initial',
      p_initial_quantity,
      'Начальный остаток',
      NULL,
      auth.uid()
    );
  ELSE
    PERFORM sync_consumable_auto_draft(v_id);
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_consumable_stock_operation(
  p_consumable_id UUID,
  p_operation consumable_movement_type,
  p_quantity NUMERIC,
  p_comment TEXT DEFAULT NULL,
  p_new_balance NUMERIC DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factory UUID;
  v_current NUMERIC(14,3);
  v_delta NUMERIC(14,3);
BEGIN
  SELECT factory_id INTO v_factory FROM consumables WHERE id = p_consumable_id;
  IF v_factory IS NULL THEN RAISE EXCEPTION 'Расходник не найден'; END IF;
  IF NOT consumables_can_manage_factory(v_factory) THEN
    RAISE EXCEPTION 'Недостаточно прав для этого завода';
  END IF;

  IF p_operation = 'manual_receipt' THEN
    IF p_quantity <= 0 OR trim(COALESCE(p_comment, '')) = '' THEN
      RAISE EXCEPTION 'Для прихода укажите количество и комментарий';
    END IF;
    v_delta := p_quantity;
  ELSIF p_operation = 'consumption' THEN
    IF p_quantity <= 0 THEN RAISE EXCEPTION 'Количество расхода должно быть больше нуля'; END IF;
    v_delta := -p_quantity;
  ELSIF p_operation = 'adjustment' THEN
    IF p_new_balance IS NULL OR p_new_balance < 0 OR trim(COALESCE(p_comment, '')) = '' THEN
      RAISE EXCEPTION 'Для корректировки укажите новый остаток и причину';
    END IF;
    SELECT current_quantity INTO v_current
    FROM consumable_balances
    WHERE consumable_id = p_consumable_id
    FOR UPDATE;
    v_delta := p_new_balance - COALESCE(v_current, 0);
  ELSE
    RAISE EXCEPTION 'Недопустимый тип операции';
  END IF;

  RETURN consumables_apply_stock_movement(
    p_consumable_id,
    p_operation,
    v_delta,
    p_comment,
    NULL,
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION submit_consumable_request(
  p_request_id UUID,
  p_priority consumable_request_priority
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request consumable_requests%ROWTYPE;
  v_item consumables%ROWTYPE;
  v_head UUID;
  v_today DATE := (now() AT TIME ZONE 'Europe/Kyiv')::date;
  v_deadline DATE;
BEGIN
  SELECT * INTO v_request
  FROM consumable_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  IF v_request.status <> 'draft' THEN RAISE EXCEPTION 'Отправить можно только черновик'; END IF;
  IF NOT consumables_can_manage_factory(v_request.factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для этого завода';
  END IF;

  SELECT * INTO v_item FROM consumables WHERE id = v_request.consumable_id;
  v_head := consumables_supply_department_head();
  v_deadline := v_today + CASE WHEN p_priority = 'high' THEN 4 ELSE 7 END;

  UPDATE consumable_requests
  SET priority = p_priority,
      status = 'new',
      request_date = v_today,
      need_by_date = v_deadline,
      submitted_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO consumable_request_events(request_id, event_type, old_status, new_status, created_by)
  VALUES (p_request_id, 'submitted', 'draft', 'new', auth.uid());

  INSERT INTO tasks(
    machine_id,
    assigned_to,
    task_type,
    title,
    description,
    status,
    start_date,
    deadline,
    consumable_request_id
  )
  VALUES (
    NULL,
    v_head,
    'consumable_request_review',
    'Ознакомиться с заявкой производства: ' || v_item.name,
    'Завод запросил ' || trim(to_char(v_request.requested_quantity, 'FM999999990.999')) || ' ' || v_item.unit ||
      '. Требуется взять счёт и перевести заявку в работу.',
    'pending',
    v_today,
    v_today,
    p_request_id
  );

  PERFORM consumables_notify_supply(
    p_request_id,
    'consumable_request_new',
    'Новая заявка производства',
    v_item.name || ': ' || trim(to_char(v_request.requested_quantity, 'FM999999990.999')) || ' ' || v_item.unit
  );
END;
$$;

CREATE OR REPLACE FUNCTION transition_consumable_request_supply(
  p_request_id UUID,
  p_new_status consumable_request_status,
  p_delivery_method consumable_delivery_method DEFAULT NULL,
  p_nova_poshta_ttn TEXT DEFAULT NULL,
  p_carrier_name TEXT DEFAULT NULL,
  p_carrier_eta DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request consumable_requests%ROWTYPE;
  v_item consumables%ROWTYPE;
  v_message TEXT;
BEGIN
  IF NOT consumables_can_supply_requests() THEN
    RAISE EXCEPTION 'Недостаточно прав снабжения';
  END IF;

  SELECT * INTO v_request
  FROM consumable_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  SELECT * INTO v_item FROM consumables WHERE id = v_request.consumable_id;

  IF p_new_status = 'invoice_taken' THEN
    IF v_request.status <> 'new' THEN RAISE EXCEPTION 'Счёт можно взять только по новой заявке'; END IF;
    UPDATE consumable_requests
    SET status = 'invoice_taken', invoice_taken_at = now(), updated_at = now()
    WHERE id = p_request_id;

    UPDATE tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE consumable_request_id = p_request_id
      AND task_type::text = 'consumable_request_review'
      AND status IN ('pending', 'in_progress');

    v_message := 'Снабжение взяло счёт по расходнику «' || v_item.name || '».';
  ELSIF p_new_status = 'delivery' THEN
    IF v_request.status <> 'invoice_taken' THEN
      RAISE EXCEPTION 'Начать доставку можно после статуса «Взят счёт»';
    END IF;
    IF p_delivery_method = 'nova_poshta' THEN
      IF COALESCE(trim(p_nova_poshta_ttn), '') !~ '^[0-9]{14}$' THEN
        RAISE EXCEPTION 'ТТН Новой почты должен содержать 14 цифр';
      END IF;
    ELSIF p_delivery_method = 'other' THEN
      IF trim(COALESCE(p_carrier_name, '')) = '' OR p_carrier_eta IS NULL THEN
        RAISE EXCEPTION 'Укажите перевозчика и ожидаемую дату доставки';
      END IF;
    ELSE
      RAISE EXCEPTION 'Выберите способ доставки';
    END IF;

    UPDATE consumable_requests
    SET status = 'delivery',
        delivery_method = p_delivery_method,
        nova_poshta_ttn = CASE WHEN p_delivery_method = 'nova_poshta' THEN trim(p_nova_poshta_ttn) ELSE NULL END,
        carrier_name = CASE WHEN p_delivery_method = 'other' THEN trim(p_carrier_name) ELSE NULL END,
        carrier_eta = CASE WHEN p_delivery_method = 'other' THEN p_carrier_eta ELSE NULL END,
        delivery_started_at = now(),
        tracking_error = NULL,
        updated_at = now()
    WHERE id = p_request_id;

    v_message := CASE
      WHEN p_delivery_method = 'nova_poshta'
        THEN 'Расходник «' || v_item.name || '» отправлен Новой почтой. ТТН: ' || trim(p_nova_poshta_ttn)
      ELSE 'Расходник «' || v_item.name || '» передан в доставку: ' || trim(p_carrier_name)
    END;
  ELSE
    RAISE EXCEPTION 'Недопустимый переход статуса';
  END IF;

  INSERT INTO consumable_request_events(
    request_id,
    event_type,
    old_status,
    new_status,
    details,
    created_by
  )
  VALUES (
    p_request_id,
    'status_changed',
    v_request.status,
    p_new_status,
    jsonb_build_object(
      'delivery_method', p_delivery_method,
      'nova_poshta_ttn', p_nova_poshta_ttn,
      'carrier_name', p_carrier_name,
      'carrier_eta', p_carrier_eta
    ),
    auth.uid()
  );

  PERFORM consumables_notify_production(
    v_request.factory_id,
    p_request_id,
    CASE WHEN p_new_status = 'invoice_taken' THEN 'consumable_request_invoice_taken' ELSE 'consumable_request_delivery' END,
    CASE WHEN p_new_status = 'invoice_taken' THEN 'Заявка взята в работу' ELSE 'Расходник отправлен' END,
    v_message
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_consumable_other_delivery_eta(
  p_request_id UUID,
  p_carrier_eta DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request consumable_requests%ROWTYPE;
BEGIN
  IF NOT consumables_can_supply_requests() THEN RAISE EXCEPTION 'Недостаточно прав снабжения'; END IF;
  IF p_carrier_eta IS NULL THEN RAISE EXCEPTION 'Укажите ожидаемую дату'; END IF;

  SELECT * INTO v_request FROM consumable_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'delivery' OR v_request.delivery_method <> 'other' THEN
    RAISE EXCEPTION 'Дата доступна только для активной доставки другим перевозчиком';
  END IF;

  UPDATE consumable_requests
  SET carrier_eta = p_carrier_eta, updated_at = now()
  WHERE id = p_request_id;

  INSERT INTO consumable_request_events(request_id, event_type, details, created_by)
  VALUES (
    p_request_id,
    'carrier_eta_changed',
    jsonb_build_object('old_date', v_request.carrier_eta, 'new_date', p_carrier_eta),
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION receive_consumable_request(
  p_request_id UUID,
  p_quantity NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request consumable_requests%ROWTYPE;
  v_item consumables%ROWTYPE;
  v_total NUMERIC(14,3);
  v_remaining NUMERIC(14,3);
  v_head UUID;
  v_today DATE := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  SELECT * INTO v_request
  FROM consumable_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  IF NOT consumables_can_manage_factory(v_request.factory_id) THEN
    RAISE EXCEPTION 'Недостаточно прав для получения на этом заводе';
  END IF;
  IF v_request.status <> 'delivery' THEN
    RAISE EXCEPTION 'Получение доступно только для заявки в доставке';
  END IF;
  IF p_quantity <= 0 OR p_quantity > (v_request.requested_quantity - v_request.received_quantity) THEN
    RAISE EXCEPTION 'Некорректное количество получения';
  END IF;

  SELECT * INTO v_item FROM consumables WHERE id = v_request.consumable_id;
  PERFORM consumables_apply_stock_movement(
    v_request.consumable_id,
    'request_receipt',
    p_quantity,
    'Получение по заявке',
    p_request_id,
    auth.uid()
  );

  INSERT INTO consumable_request_receipts(request_id, quantity, received_by)
  VALUES (p_request_id, p_quantity, auth.uid());

  v_total := v_request.received_quantity + p_quantity;
  v_remaining := v_request.requested_quantity - v_total;

  IF v_remaining = 0 THEN
    UPDATE consumable_requests
    SET received_quantity = v_total,
        status = 'received',
        completed_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE consumable_request_id = p_request_id
      AND task_type::text = 'consumable_request_shortage'
      AND status IN ('pending', 'in_progress');
  ELSE
    UPDATE consumable_requests
    SET received_quantity = v_total, updated_at = now()
    WHERE id = p_request_id;

    v_head := consumables_supply_department_head();
    IF NOT EXISTS (
      SELECT 1 FROM tasks
      WHERE consumable_request_id = p_request_id
        AND task_type::text = 'consumable_request_shortage'
        AND status IN ('pending', 'in_progress')
    ) THEN
      INSERT INTO tasks(
        machine_id,
        assigned_to,
        task_type,
        title,
        description,
        status,
        start_date,
        deadline,
        consumable_request_id
      )
      VALUES (
        NULL,
        v_head,
        'consumable_request_shortage',
        'Недопоставка расходника: ' || v_item.name,
        'Получено ' || trim(to_char(v_total, 'FM999999990.999')) || ' из ' ||
          trim(to_char(v_request.requested_quantity, 'FM999999990.999')) || ' ' || v_item.unit ||
          '. Осталось доставить: ' || trim(to_char(v_remaining, 'FM999999990.999')) || ' ' || v_item.unit || '.',
        'pending',
        v_today,
        v_today,
        p_request_id
      );
    END IF;

    PERFORM consumables_notify_supply(
      p_request_id,
      'consumable_request_shortage',
      'Расходник получен не полностью',
      v_item.name || ': получено ' || trim(to_char(v_total, 'FM999999990.999')) || ' из ' ||
        trim(to_char(v_request.requested_quantity, 'FM999999990.999')) || ' ' || v_item.unit
    );
    PERFORM consumables_notify_production(
      v_request.factory_id,
      p_request_id,
      'consumable_request_partial_receipt',
      'Частичное получение',
      v_item.name || ': осталось получить ' || trim(to_char(v_remaining, 'FM999999990.999')) || ' ' || v_item.unit
    );
  END IF;

  INSERT INTO consumable_request_events(request_id, event_type, old_status, new_status, details, created_by)
  VALUES (
    p_request_id,
    'receipt',
    v_request.status,
    CASE WHEN v_remaining = 0 THEN 'received' ELSE 'delivery' END,
    jsonb_build_object('quantity', p_quantity, 'received_total', v_total, 'remaining', v_remaining),
    auth.uid()
  );

  PERFORM sync_consumable_auto_draft(v_request.consumable_id);
END;
$$;

CREATE OR REPLACE FUNCTION close_consumable_request_remainder(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request consumable_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM consumable_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  IF NOT consumables_can_manage_factory(v_request.factory_id) THEN RAISE EXCEPTION 'Недостаточно прав'; END IF;
  IF v_request.status <> 'delivery' OR v_request.received_quantity <= 0 OR v_request.received_quantity >= v_request.requested_quantity THEN
    RAISE EXCEPTION 'Закрыть остаток можно только после частичного получения';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Укажите причину закрытия остатка'; END IF;

  UPDATE consumable_requests
  SET status = 'received_partial',
      remainder_closed_reason = trim(p_reason),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  UPDATE tasks
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE consumable_request_id = p_request_id
    AND task_type::text = 'consumable_request_shortage'
    AND status IN ('pending', 'in_progress');

  INSERT INTO consumable_request_events(request_id, event_type, old_status, new_status, details, created_by)
  VALUES (
    p_request_id,
    'remainder_closed',
    'delivery',
    'received_partial',
    jsonb_build_object('reason', trim(p_reason)),
    auth.uid()
  );

  PERFORM sync_consumable_auto_draft(v_request.consumable_id);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_consumable_request(
  p_request_id UUID,
  p_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request consumable_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request FROM consumable_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявка не найдена'; END IF;
  IF NOT consumables_can_manage_factory(v_request.factory_id) THEN RAISE EXCEPTION 'Недостаточно прав'; END IF;
  IF v_request.status NOT IN ('draft', 'new') THEN
    RAISE EXCEPTION 'Отменить заявку можно только до статуса «Взят счёт»';
  END IF;
  IF v_request.status = 'new' AND length(trim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Укажите причину отмены';
  END IF;

  IF v_request.status = 'draft' THEN
    DELETE FROM consumable_requests WHERE id = p_request_id;
    RETURN;
  END IF;

  UPDATE consumable_requests
  SET status = 'cancelled',
      cancellation_reason = trim(p_reason),
      cancelled_at = now(),
      updated_at = now()
  WHERE id = p_request_id;

  UPDATE tasks
  SET status = 'cancelled', updated_at = now()
  WHERE consumable_request_id = p_request_id
    AND status IN ('pending', 'in_progress');

  INSERT INTO consumable_request_events(request_id, event_type, old_status, new_status, details, created_by)
  VALUES (
    p_request_id,
    'cancelled',
    'new',
    'cancelled',
    jsonb_build_object('reason', trim(p_reason)),
    auth.uid()
  );

  PERFORM sync_consumable_auto_draft(v_request.consumable_id);
END;
$$;

CREATE OR REPLACE VIEW consumable_stock_overview
WITH (security_invoker = true)
AS
SELECT
  c.id AS consumable_id,
  c.factory_id,
  c.category_id,
  cc.name AS category_name,
  c.name,
  c.characteristics,
  c.article,
  c.unit,
  c.minimum_quantity,
  c.is_active,
  COALESCE(cb.current_quantity, 0)::NUMERIC(14,3) AS current_quantity,
  COALESCE(open_requests.in_work_quantity, 0)::NUMERIC(14,3) AS in_work_quantity,
  (COALESCE(cb.current_quantity, 0) < c.minimum_quantity) AS is_below_minimum,
  GREATEST(c.minimum_quantity - COALESCE(cb.current_quantity, 0), 0)::NUMERIC(14,3) AS shortage_quantity,
  cb.updated_at
FROM consumables c
JOIN consumable_categories cc ON cc.id = c.category_id
LEFT JOIN consumable_balances cb ON cb.consumable_id = c.id
LEFT JOIN LATERAL (
  SELECT SUM(cr.requested_quantity - cr.received_quantity) AS in_work_quantity
  FROM consumable_requests cr
  WHERE cr.consumable_id = c.id
    AND cr.status IN ('new', 'invoice_taken', 'delivery')
) open_requests ON true;

ALTER TABLE consumable_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumables ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_request_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumable_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY consumable_categories_select ON consumable_categories
  FOR SELECT TO authenticated
  USING (consumables_can_view_factory(factory_id));
CREATE POLICY consumable_categories_service_write ON consumable_categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY consumables_select ON consumables
  FOR SELECT TO authenticated
  USING (consumables_can_view_factory(factory_id));
CREATE POLICY consumables_service_write ON consumables
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY consumable_balances_select ON consumable_balances
  FOR SELECT TO authenticated
  USING (consumables_can_view_factory(factory_id));
CREATE POLICY consumable_balances_service_write ON consumable_balances
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY consumable_requests_select ON consumable_requests
  FOR SELECT TO authenticated
  USING (consumables_can_view_factory(factory_id));
CREATE POLICY consumable_requests_service_write ON consumable_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY consumable_request_receipts_select ON consumable_request_receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM consumable_requests cr
      WHERE cr.id = request_id
        AND consumables_can_view_factory(cr.factory_id)
    )
  );
CREATE POLICY consumable_request_receipts_service_write ON consumable_request_receipts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY consumable_movements_select ON consumable_movements
  FOR SELECT TO authenticated
  USING (consumables_can_view_factory(factory_id));
CREATE POLICY consumable_movements_service_write ON consumable_movements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY consumable_request_events_select ON consumable_request_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM consumable_requests cr
      WHERE cr.id = request_id
        AND consumables_can_view_factory(cr.factory_id)
    )
  );
CREATE POLICY consumable_request_events_service_write ON consumable_request_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON consumable_stock_overview TO authenticated, service_role;
REVOKE ALL ON FUNCTION consumables_supply_department_head() FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION consumables_notify_production(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION consumables_notify_supply(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION create_consumable_item(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION record_consumable_stock_operation(UUID, consumable_movement_type, NUMERIC, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION sync_consumable_auto_draft(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_consumable_request(UUID, consumable_request_priority) TO authenticated;
GRANT EXECUTE ON FUNCTION transition_consumable_request_supply(UUID, consumable_request_status, consumable_delivery_method, TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION update_consumable_other_delivery_eta(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION receive_consumable_request(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION close_consumable_request_remainder(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_consumable_request(UUID, TEXT) TO authenticated;

INSERT INTO role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'consumables', can_view, can_manage
FROM (
  VALUES
    ('financial_director'::user_role, true, true),
    ('commercial_director'::user_role, true, true),
    ('planning_director'::user_role, true, true),
    ('production_manager'::user_role, true, true),
    ('supply_manager'::user_role, false, false),
    ('procurement_head'::user_role, false, false),
    ('sales_manager'::user_role, false, false),
    ('engineer'::user_role, false, false),
    ('technologist'::user_role, false, false),
    ('painting_head'::user_role, false, false)
) AS defaults(role, can_view, can_manage)
ON CONFLICT (role, resource_key) DO NOTHING;

INSERT INTO role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'consumable_requests', can_view, can_manage
FROM (
  VALUES
    ('financial_director'::user_role, true, true),
    ('commercial_director'::user_role, true, true),
    ('planning_director'::user_role, true, true),
    ('production_manager'::user_role, true, true),
    ('supply_manager'::user_role, true, true),
    ('procurement_head'::user_role, true, true),
    ('sales_manager'::user_role, false, false),
    ('engineer'::user_role, false, false),
    ('technologist'::user_role, false, false),
    ('painting_head'::user_role, false, false)
) AS defaults(role, can_view, can_manage)
ON CONFLICT (role, resource_key) DO NOTHING;

INSERT INTO role_permissions(role, resource_key, can_view, can_manage)
SELECT role, 'supply_consumable_requests', can_view, can_manage
FROM (
  VALUES
    ('financial_director'::user_role, true, true),
    ('commercial_director'::user_role, true, true),
    ('planning_director'::user_role, true, true),
    ('production_manager'::user_role, false, false),
    ('supply_manager'::user_role, true, true),
    ('procurement_head'::user_role, true, true),
    ('sales_manager'::user_role, false, false),
    ('engineer'::user_role, false, false),
    ('technologist'::user_role, false, false),
    ('painting_head'::user_role, false, false)
) AS defaults(role, can_view, can_manage)
ON CONFLICT (role, resource_key) DO NOTHING;

WITH current_roles AS (
  SELECT DISTINCT
    dm.department_id,
    CASE WHEN dm.is_department_head THEN 'head' ELSE 'member' END AS subject_scope,
    u.role
  FROM department_members dm
  JOIN users u ON u.id = dm.user_id
),
new_resources AS (
  SELECT * FROM role_permissions
  WHERE resource_key IN ('consumables', 'consumable_requests', 'supply_consumable_requests')
),
seed AS (
  SELECT
    cr.department_id,
    cr.subject_scope,
    nr.resource_key,
    bool_or(nr.can_view) AS can_view,
    bool_or(nr.can_manage) AS can_manage
  FROM current_roles cr
  JOIN new_resources nr ON nr.role = cr.role
  GROUP BY cr.department_id, cr.subject_scope, nr.resource_key
)
INSERT INTO department_access_permissions(
  department_id,
  subject_scope,
  resource_key,
  can_view,
  can_manage
)
SELECT department_id, subject_scope, resource_key, can_view OR can_manage, can_manage
FROM seed
ON CONFLICT (department_id, subject_scope, resource_key) DO NOTHING;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Keep the hourly invocation secret inside Supabase Vault. The Edge Function
-- reads it using its service-role client; it is never exposed to browsers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM vault.secrets
    WHERE name = 'consumable_tracking_cron_secret'
  ) THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'consumable_tracking_cron_secret',
      'Hourly consumable delivery tracking invocation secret'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_consumable_tracking_cron_secret()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'consumable_tracking_cron_secret'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_consumable_tracking_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_consumable_tracking_cron_secret() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hourly-consumable-tracking') THEN
    PERFORM cron.unschedule('hourly-consumable-tracking');
  END IF;
END;
$$;

SELECT cron.schedule(
  'hourly-consumable-tracking',
  '0 * * * *',
  $cron$
    SELECT net.http_post(
      url := 'https://rmnciwiksbfxfsfomvig.supabase.co/functions/v1/consumable-tracking',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'consumable_tracking_cron_secret'
          LIMIT 1
        )
      ),
      body := '{}'::jsonb
    );
  $cron$
);

SELECT pg_notify('pgrst', 'reload schema');
