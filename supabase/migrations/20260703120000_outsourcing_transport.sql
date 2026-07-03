-- Outsourcing operations for machine items and transport planning.

DO $$
BEGIN
  CREATE TYPE public.outsourcing_executor_type AS ENUM ('supplier', 'factory');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.outsourcing_transport_direction AS ENUM ('outbound', 'return');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.outsourcing_transport_plan_state AS ENUM ('preliminary', 'confirmed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.outsourcing_transport_need_status AS ENUM ('open', 'linked', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.outsourcing_transport_order_status AS ENUM ('needed', 'found', 'in_transit', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'outsourcing_transport';

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS can_outsource boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_transport boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.outsourcing_work_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL,
  description text,
  is_zinc boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.outsourcing_work_types (code, name, description, is_zinc)
VALUES ('zinc', 'Цинк', 'Цинкование как внешний производственный этап', true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_zinc = true,
  is_active = true,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.factory_zinc_outsourcing_defaults (
  factory_id uuid PRIMARY KEY REFERENCES public.factories(id) ON DELETE CASCADE,
  executor_type public.outsourcing_executor_type NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  executor_factory_id uuid REFERENCES public.factories(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT factory_zinc_executor_target_check CHECK (
    (
      executor_type = 'supplier'
      AND supplier_id IS NOT NULL
      AND executor_factory_id IS NULL
    )
    OR
    (
      executor_type = 'factory'
      AND executor_factory_id IS NOT NULL
      AND supplier_id IS NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS public.machine_outsourcing_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  work_type_id uuid NOT NULL REFERENCES public.outsourcing_work_types(id) ON DELETE RESTRICT,
  position_after_stage_type public.stage_type,
  source_stage_type public.stage_type,
  is_zinc_operation boolean NOT NULL DEFAULT false,
  executor_type public.outsourcing_executor_type NOT NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  executor_factory_id uuid REFERENCES public.factories(id) ON DELETE RESTRICT,
  note text,
  planned_send_date date,
  planned_return_date date,
  actual_sent_at date,
  actual_returned_at date,
  service_cost_planned numeric CHECK (service_cost_planned IS NULL OR service_cost_planned >= 0),
  service_cost_actual numeric CHECK (service_cost_actual IS NULL OR service_cost_actual >= 0),
  incoming_production_month date,
  incoming_workshop integer CHECK (incoming_workshop IS NULL OR incoming_workshop > 0),
  incoming_queue_number integer CHECK (incoming_queue_number IS NULL OR incoming_queue_number > 0),
  incoming_date_start date,
  incoming_date_end date,
  archived_at timestamptz,
  archived_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT machine_outsourcing_executor_target_check CHECK (
    (
      executor_type = 'supplier'
      AND supplier_id IS NOT NULL
      AND executor_factory_id IS NULL
    )
    OR
    (
      executor_type = 'factory'
      AND executor_factory_id IS NOT NULL
      AND supplier_id IS NULL
    )
  ),
  CONSTRAINT machine_outsourcing_send_return_check CHECK (
    planned_send_date IS NULL
    OR planned_return_date IS NULL
    OR planned_return_date >= planned_send_date
  ),
  CONSTRAINT machine_outsourcing_actual_dates_check CHECK (
    actual_sent_at IS NULL
    OR actual_returned_at IS NULL
    OR actual_returned_at >= actual_sent_at
  ),
  CONSTRAINT machine_outsourcing_incoming_dates_check CHECK (
    incoming_date_start IS NULL
    OR incoming_date_end IS NULL
    OR incoming_date_end >= incoming_date_start
  ),
  CONSTRAINT machine_outsourcing_incoming_month_check CHECK (
    incoming_production_month IS NULL
    OR incoming_production_month = date_trunc('month', incoming_production_month)::date
  )
);

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_machine
  ON public.machine_outsourcing_operations(machine_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_executor_factory
  ON public.machine_outsourcing_operations(executor_factory_id, incoming_production_month)
  WHERE executor_type = 'factory' AND archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_machine_outsourcing_one_active_zinc
  ON public.machine_outsourcing_operations(machine_id)
  WHERE is_zinc_operation = true AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.machine_outsourcing_operation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.machine_outsourcing_operations(id) ON DELETE CASCADE,
  machine_item_id uuid NOT NULL REFERENCES public.machine_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id, machine_item_id)
);

CREATE INDEX IF NOT EXISTS idx_machine_outsourcing_items_item
  ON public.machine_outsourcing_operation_items(machine_item_id);

CREATE TABLE IF NOT EXISTS public.machine_outsourcing_transport_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction public.outsourcing_transport_direction NOT NULL,
  status public.outsourcing_transport_order_status NOT NULL DEFAULT 'needed',
  carrier_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  scheduled_date date,
  price numeric CHECK (price IS NULL OR price >= 0),
  comment text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outsourcing_transport_orders_status
  ON public.machine_outsourcing_transport_orders(status, scheduled_date);

CREATE TABLE IF NOT EXISTS public.machine_outsourcing_transport_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL REFERENCES public.machine_outsourcing_operations(id) ON DELETE CASCADE,
  direction public.outsourcing_transport_direction NOT NULL,
  plan_state public.outsourcing_transport_plan_state NOT NULL,
  status public.outsourcing_transport_need_status NOT NULL DEFAULT 'open',
  needed_date date NOT NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  transport_order_id uuid REFERENCES public.machine_outsourcing_transport_orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outsourcing_transport_needs_operation
  ON public.machine_outsourcing_transport_needs(operation_id, direction, plan_state);

CREATE INDEX IF NOT EXISTS idx_outsourcing_transport_needs_order
  ON public.machine_outsourcing_transport_needs(transport_order_id)
  WHERE transport_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outsourcing_transport_one_active_need
  ON public.machine_outsourcing_transport_needs(operation_id, direction, plan_state)
  WHERE status IN ('open', 'linked');

ALTER TABLE public.production_plan_date_change_request_items
  ADD COLUMN IF NOT EXISTS outsourcing_operation_id uuid REFERENCES public.machine_outsourcing_operations(id) ON DELETE CASCADE;

ALTER TABLE public.production_plan_date_change_request_items
  DROP CONSTRAINT IF EXISTS production_plan_date_change_request_items_target_check;

ALTER TABLE public.production_plan_date_change_request_items
  ADD CONSTRAINT production_plan_date_change_request_items_target_check
  CHECK (
    (
      target_type = 'machine'
      AND production_stage_id IS NULL
      AND outsourcing_operation_id IS NULL
      AND stage_type IS NULL
      AND field_name = 'planned_material_date'
    )
    OR
    (
      target_type = 'stage'
      AND production_stage_id IS NOT NULL
      AND outsourcing_operation_id IS NULL
      AND stage_type IS NOT NULL
      AND field_name IN ('date_start', 'date_end', 'night_shift_date')
    )
    OR
    (
      target_type = 'outsourcing'
      AND production_stage_id IS NULL
      AND outsourcing_operation_id IS NOT NULL
      AND stage_type IS NULL
      AND field_name IN ('planned_send_date', 'planned_return_date')
    )
  );

CREATE OR REPLACE FUNCTION public.touch_outsourcing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outsourcing_work_types_touch_updated_at ON public.outsourcing_work_types;
CREATE TRIGGER outsourcing_work_types_touch_updated_at
  BEFORE UPDATE ON public.outsourcing_work_types
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_outsourcing_updated_at();

DROP TRIGGER IF EXISTS machine_outsourcing_operations_touch_updated_at ON public.machine_outsourcing_operations;
CREATE TRIGGER machine_outsourcing_operations_touch_updated_at
  BEFORE UPDATE ON public.machine_outsourcing_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_outsourcing_updated_at();

DROP TRIGGER IF EXISTS outsourcing_transport_orders_touch_updated_at ON public.machine_outsourcing_transport_orders;
CREATE TRIGGER outsourcing_transport_orders_touch_updated_at
  BEFORE UPDATE ON public.machine_outsourcing_transport_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_outsourcing_updated_at();

DROP TRIGGER IF EXISTS outsourcing_transport_needs_touch_updated_at ON public.machine_outsourcing_transport_needs;
CREATE TRIGGER outsourcing_transport_needs_touch_updated_at
  BEFORE UPDATE ON public.machine_outsourcing_transport_needs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_outsourcing_updated_at();

CREATE OR REPLACE FUNCTION public.validate_outsourcing_transport_need()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_operation_machine_id uuid;
  v_item_machine_id uuid;
  v_order_direction public.outsourcing_transport_direction;
BEGIN
  IF NEW.transport_order_id IS NOT NULL THEN
    SELECT direction
    INTO v_order_direction
    FROM public.machine_outsourcing_transport_orders
    WHERE id = NEW.transport_order_id;

    IF v_order_direction IS NULL THEN
      RAISE EXCEPTION 'Transport order not found';
    END IF;

    IF v_order_direction IS DISTINCT FROM NEW.direction THEN
      RAISE EXCEPTION 'Transport order direction must match need direction';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outsourcing_transport_need_validate ON public.machine_outsourcing_transport_needs;
CREATE TRIGGER outsourcing_transport_need_validate
  BEFORE INSERT OR UPDATE ON public.machine_outsourcing_transport_needs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_outsourcing_transport_need();

CREATE OR REPLACE FUNCTION public.validate_outsourcing_operation_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_operation_machine_id uuid;
  v_item_machine_id uuid;
BEGIN
  SELECT machine_id
  INTO v_operation_machine_id
  FROM public.machine_outsourcing_operations
  WHERE id = NEW.operation_id;

  SELECT machine_id
  INTO v_item_machine_id
  FROM public.machine_items
  WHERE id = NEW.machine_item_id;

  IF v_operation_machine_id IS NULL OR v_item_machine_id IS NULL THEN
    RAISE EXCEPTION 'Outsourcing operation or machine item not found';
  END IF;

  IF v_operation_machine_id IS DISTINCT FROM v_item_machine_id THEN
    RAISE EXCEPTION 'Outsourcing item must belong to the same machine as operation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS outsourcing_operation_item_validate ON public.machine_outsourcing_operation_items;
CREATE TRIGGER outsourcing_operation_item_validate
  BEFORE INSERT OR UPDATE ON public.machine_outsourcing_operation_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_outsourcing_operation_item();

ALTER TABLE public.outsourcing_work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factory_zinc_outsourcing_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_outsourcing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_outsourcing_operation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_outsourcing_transport_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_outsourcing_transport_needs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outsourcing_work_types_select ON public.outsourcing_work_types;
CREATE POLICY outsourcing_work_types_select
  ON public.outsourcing_work_types
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS factory_zinc_defaults_select ON public.factory_zinc_outsourcing_defaults;
CREATE POLICY factory_zinc_defaults_select
  ON public.factory_zinc_outsourcing_defaults
  FOR SELECT TO authenticated
  USING (public.is_director() OR factory_id = public.get_user_factory_id());

DROP POLICY IF EXISTS machine_outsourcing_operations_select ON public.machine_outsourcing_operations;
CREATE POLICY machine_outsourcing_operations_select
  ON public.machine_outsourcing_operations
  FOR SELECT TO authenticated
  USING (
    public.is_director()
    OR EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = machine_outsourcing_operations.machine_id
        AND (
          m.factory_id = public.get_user_factory_id()
          OR m.factory_id IS NULL
          OR public.get_user_role() IN ('sales_manager', 'engineer', 'technologist', 'supply_manager', 'procurement_head')
        )
    )
    OR (
      machine_outsourcing_operations.executor_type = 'factory'
      AND machine_outsourcing_operations.executor_factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS machine_outsourcing_operation_items_select ON public.machine_outsourcing_operation_items;
CREATE POLICY machine_outsourcing_operation_items_select
  ON public.machine_outsourcing_operation_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_operations op
      JOIN public.machines m ON m.id = op.machine_id
      WHERE op.id = machine_outsourcing_operation_items.operation_id
        AND (
          public.is_director()
          OR m.factory_id = public.get_user_factory_id()
          OR m.factory_id IS NULL
          OR public.get_user_role() IN ('sales_manager', 'engineer', 'technologist', 'supply_manager', 'procurement_head')
          OR (
            op.executor_type = 'factory'
            AND op.executor_factory_id = public.get_user_factory_id()
          )
        )
    )
  );

DROP POLICY IF EXISTS outsourcing_transport_orders_select ON public.machine_outsourcing_transport_orders;
CREATE POLICY outsourcing_transport_orders_select
  ON public.machine_outsourcing_transport_orders
  FOR SELECT TO authenticated
  USING (public.is_director() OR public.get_user_role() IN ('supply_manager', 'procurement_head', 'production_manager'));

DROP POLICY IF EXISTS outsourcing_transport_needs_select ON public.machine_outsourcing_transport_needs;
CREATE POLICY outsourcing_transport_needs_select
  ON public.machine_outsourcing_transport_needs
  FOR SELECT TO authenticated
  USING (
    public.is_director()
    OR public.get_user_role() IN ('supply_manager', 'procurement_head')
    OR EXISTS (
      SELECT 1
      FROM public.machine_outsourcing_operations op
      JOIN public.machines m ON m.id = op.machine_id
      WHERE op.id = machine_outsourcing_transport_needs.operation_id
        AND (
          m.factory_id = public.get_user_factory_id()
          OR (
            op.executor_type = 'factory'
            AND op.executor_factory_id = public.get_user_factory_id()
          )
        )
    )
  );

DROP POLICY IF EXISTS outsourcing_work_types_service_role_modify ON public.outsourcing_work_types;
CREATE POLICY outsourcing_work_types_service_role_modify
  ON public.outsourcing_work_types
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS factory_zinc_defaults_service_role_modify ON public.factory_zinc_outsourcing_defaults;
CREATE POLICY factory_zinc_defaults_service_role_modify
  ON public.factory_zinc_outsourcing_defaults
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS machine_outsourcing_operations_service_role_modify ON public.machine_outsourcing_operations;
CREATE POLICY machine_outsourcing_operations_service_role_modify
  ON public.machine_outsourcing_operations
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS machine_outsourcing_operation_items_service_role_modify ON public.machine_outsourcing_operation_items;
CREATE POLICY machine_outsourcing_operation_items_service_role_modify
  ON public.machine_outsourcing_operation_items
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS outsourcing_transport_orders_service_role_modify ON public.machine_outsourcing_transport_orders;
CREATE POLICY outsourcing_transport_orders_service_role_modify
  ON public.machine_outsourcing_transport_orders
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS outsourcing_transport_needs_service_role_modify ON public.machine_outsourcing_transport_needs;
CREATE POLICY outsourcing_transport_needs_service_role_modify
  ON public.machine_outsourcing_transport_needs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.outsourcing_work_types TO authenticated;
GRANT SELECT ON public.factory_zinc_outsourcing_defaults TO authenticated;
GRANT SELECT ON public.machine_outsourcing_operations TO authenticated;
GRANT SELECT ON public.machine_outsourcing_operation_items TO authenticated;
GRANT SELECT ON public.machine_outsourcing_transport_orders TO authenticated;
GRANT SELECT ON public.machine_outsourcing_transport_needs TO authenticated;
