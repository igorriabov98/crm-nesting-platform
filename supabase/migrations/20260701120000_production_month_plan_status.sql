DO $$
BEGIN
  CREATE TYPE production_month_plan_status AS ENUM ('draft', 'preliminary_ready', 'confirmed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE production_date_change_request_status AS ENUM ('pending', 'approved', 'rejected', 'conflicted');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'production_plan_date_change_approval';

ALTER TABLE public.machine_chat_messages
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS message_kind text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS system_event_key text;

ALTER TABLE public.machine_chat_messages
  DROP CONSTRAINT IF EXISTS machine_chat_messages_message_kind_check,
  ADD CONSTRAINT machine_chat_messages_message_kind_check
  CHECK (message_kind IN ('user', 'system'));

CREATE INDEX IF NOT EXISTS idx_machine_chat_messages_system_event
  ON public.machine_chat_messages(machine_id, system_event_key, created_at DESC)
  WHERE message_kind = 'system';

CREATE TABLE IF NOT EXISTS public.production_month_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  production_month date NOT NULL,
  status production_month_plan_status NOT NULL DEFAULT 'draft',
  preliminary_ready_at timestamptz,
  preliminary_ready_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT production_month_plans_month_start_check
    CHECK (production_month = date_trunc('month', production_month)::date),
  CONSTRAINT production_month_plans_status_timestamps_check
    CHECK (
      (status <> 'preliminary_ready' OR preliminary_ready_at IS NOT NULL)
      AND (status <> 'confirmed' OR confirmed_at IS NOT NULL)
    ),
  UNIQUE(factory_id, production_month)
);

CREATE INDEX IF NOT EXISTS idx_production_month_plans_factory_month
  ON public.production_month_plans(factory_id, production_month);

CREATE TABLE IF NOT EXISTS public.production_plan_date_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_month_plan_id uuid NOT NULL REFERENCES public.production_month_plans(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  status production_date_change_request_status NOT NULL DEFAULT 'pending',
  comment text,
  decision_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,

  CONSTRAINT production_plan_date_change_requests_decision_check
    CHECK (
      status = 'pending'
      OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_plan_date_change_one_pending
  ON public.production_plan_date_change_requests(production_month_plan_id, machine_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_production_plan_date_change_task
  ON public.production_plan_date_change_requests(task_id)
  WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.production_plan_date_change_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.production_plan_date_change_requests(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('machine', 'stage')),
  production_stage_id uuid REFERENCES public.production_stages(id) ON DELETE CASCADE,
  stage_type stage_type,
  field_name text NOT NULL,
  old_value date,
  new_value date,
  status production_date_change_request_status NOT NULL DEFAULT 'pending',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,

  CONSTRAINT production_plan_date_change_request_items_target_check
    CHECK (
      (target_type = 'machine' AND production_stage_id IS NULL AND stage_type IS NULL AND field_name = 'planned_material_date')
      OR
      (target_type = 'stage' AND production_stage_id IS NOT NULL AND stage_type IS NOT NULL AND field_name IN ('date_start', 'date_end', 'night_shift_date'))
    )
);

CREATE INDEX IF NOT EXISTS idx_production_plan_date_change_items_request
  ON public.production_plan_date_change_request_items(request_id, sort_order);

CREATE OR REPLACE FUNCTION public.touch_production_month_plan_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_month_plans_touch_updated_at ON public.production_month_plans;
CREATE TRIGGER production_month_plans_touch_updated_at
  BEFORE UPDATE ON public.production_month_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_production_month_plan_updated_at();

DROP TRIGGER IF EXISTS production_plan_date_change_requests_touch_updated_at ON public.production_plan_date_change_requests;
CREATE TRIGGER production_plan_date_change_requests_touch_updated_at
  BEFORE UPDATE ON public.production_plan_date_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_production_month_plan_updated_at();

ALTER TABLE public.production_month_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_date_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_plan_date_change_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_month_plans_select ON public.production_month_plans;
CREATE POLICY production_month_plans_select
  ON public.production_month_plans
  FOR SELECT
  TO authenticated
  USING (
    CASE
      WHEN public.get_user_role() = 'production_manager' THEN factory_id = public.get_user_factory_id()
      ELSE true
    END
  );

DROP POLICY IF EXISTS production_plan_date_change_requests_select ON public.production_plan_date_change_requests;
CREATE POLICY production_plan_date_change_requests_select
  ON public.production_plan_date_change_requests
  FOR SELECT
  TO authenticated
  USING (
    requested_by = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.tasks t
      WHERE t.id = production_plan_date_change_requests.task_id
        AND t.assigned_to = auth.uid()
    )
    OR public.is_director()
    OR EXISTS (
      SELECT 1
      FROM public.machines m
      WHERE m.id = production_plan_date_change_requests.machine_id
        AND public.get_user_role() = 'production_manager'
        AND m.factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_plan_date_change_request_items_select ON public.production_plan_date_change_request_items;
CREATE POLICY production_plan_date_change_request_items_select
  ON public.production_plan_date_change_request_items
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.production_plan_date_change_requests r
      WHERE r.id = production_plan_date_change_request_items.request_id
        AND (
          r.requested_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.tasks t
            WHERE t.id = r.task_id
              AND t.assigned_to = auth.uid()
          )
          OR public.is_director()
          OR EXISTS (
            SELECT 1
            FROM public.machines m
            WHERE m.id = r.machine_id
              AND public.get_user_role() = 'production_manager'
              AND m.factory_id = public.get_user_factory_id()
          )
        )
    )
  );

DROP POLICY IF EXISTS production_month_plans_service_role_modify ON public.production_month_plans;
CREATE POLICY production_month_plans_service_role_modify
  ON public.production_month_plans
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS production_plan_date_change_requests_service_role_modify ON public.production_plan_date_change_requests;
CREATE POLICY production_plan_date_change_requests_service_role_modify
  ON public.production_plan_date_change_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS production_plan_date_change_request_items_service_role_modify ON public.production_plan_date_change_request_items;
CREATE POLICY production_plan_date_change_request_items_service_role_modify
  ON public.production_plan_date_change_request_items
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.production_month_plans TO authenticated;
GRANT SELECT ON public.production_plan_date_change_requests TO authenticated;
GRANT SELECT ON public.production_plan_date_change_request_items TO authenticated;
