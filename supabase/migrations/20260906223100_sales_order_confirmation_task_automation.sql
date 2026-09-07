-- Keep the sales manager's order-confirmation deadline two calendar days ahead
-- of the engineer drawing-confirmation deadline.

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_sales_order_confirmation_active_machine
  ON public.tasks (machine_id)
  WHERE task_type = 'sales_order_confirmation'
    AND status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.fn_sync_sales_order_confirmation_task(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_machine record;
  v_engineer_deadline date;
  v_confirmation_deadline date;
  v_manager_is_valid boolean := false;
  v_task_id uuid;
  v_current_assignee uuid;
BEGIN
  SELECT
    machine.id,
    machine.name,
    machine.created_by,
    machine.is_confirmed,
    machine.is_archived
  INTO v_machine
  FROM public.machines machine
  WHERE machine.id = p_machine_id
  FOR UPDATE OF machine;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT task.deadline
  INTO v_engineer_deadline
  FROM public.tasks task
  WHERE task.machine_id = p_machine_id
    AND task.task_type = 'engineer_confirm'
    AND task.status <> 'cancelled'
    AND task.deadline IS NOT NULL
  ORDER BY
    CASE WHEN task.status IN ('pending', 'in_progress') THEN 0 ELSE 1 END,
    task.created_at DESC,
    task.id DESC
  LIMIT 1;

  IF v_engineer_deadline IS NOT NULL THEN
    v_confirmation_deadline := v_engineer_deadline - 2;
  END IF;

  IF v_machine.created_by IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.users manager
      WHERE manager.id = v_machine.created_by
        AND manager.is_active = true
        AND COALESCE(manager.is_service_account, false) = false
    ) INTO v_manager_is_valid;
  END IF;

  SELECT task.id, task.assigned_to
  INTO v_task_id, v_current_assignee
  FROM public.tasks task
  WHERE task.machine_id = p_machine_id
    AND task.task_type = 'sales_order_confirmation'
    AND task.status IN ('pending', 'in_progress')
  ORDER BY task.created_at, task.id
  LIMIT 1
  FOR UPDATE;

  IF COALESCE(v_machine.is_archived, false) THEN
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'sales_order_confirmation'
      AND delegation.status = 'pending';
    RETURN;
  END IF;

  IF COALESCE(v_machine.is_confirmed, false) THEN
    UPDATE public.tasks
    SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'sales_order_confirmation'
      AND delegation.status = 'pending';
    RETURN;
  END IF;

  IF v_confirmation_deadline IS NULL OR NOT v_manager_is_valid THEN
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'sales_order_confirmation'
      AND delegation.status = 'pending';
    RETURN;
  END IF;

  IF v_task_id IS NOT NULL AND v_current_assignee IS DISTINCT FROM v_machine.created_by THEN
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE id = v_task_id;

    UPDATE public.task_delegations
    SET status = 'cancelled', responded_at = now()
    WHERE task_id = v_task_id
      AND status = 'pending';
    v_task_id := NULL;
  END IF;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET title = 'Подтвердить заказ: ' || COALESCE(v_machine.name, 'Машина'),
        description = 'Подтвердите заказ до начала инженерного подтверждения чертежей. '
          || 'Дедлайн инженера: ' || to_char(v_engineer_deadline, 'DD.MM.YYYY') || '.',
        start_date = v_confirmation_deadline,
        deadline = v_confirmation_deadline,
        completed_at = NULL,
        updated_at = now()
    WHERE id = v_task_id;
    RETURN;
  END IF;

  INSERT INTO public.tasks (
    machine_id,
    assigned_to,
    task_type,
    title,
    description,
    status,
    start_date,
    deadline
  ) VALUES (
    p_machine_id,
    v_machine.created_by,
    'sales_order_confirmation',
    'Подтвердить заказ: ' || COALESCE(v_machine.name, 'Машина'),
    'Подтвердите заказ до начала инженерного подтверждения чертежей. '
      || 'Дедлайн инженера: ' || to_char(v_engineer_deadline, 'DD.MM.YYYY') || '.',
    'pending',
    v_confirmation_deadline,
    v_confirmation_deadline
  )
  ON CONFLICT (machine_id)
    WHERE task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress')
  DO UPDATE SET
    assigned_to = EXCLUDED.assigned_to,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    deadline = EXCLUDED.deadline,
    completed_at = NULL,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_sales_order_confirmation_task(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_sales_order_confirmation_task(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_sync_sales_order_confirmation_from_engineer_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_sync_sales_order_confirmation_task(NEW.machine_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_engineer_task_sales_confirmation_insert ON public.tasks;
CREATE TRIGGER trg_engineer_task_sales_confirmation_insert
  AFTER INSERT ON public.tasks
  FOR EACH ROW
  WHEN (NEW.task_type = 'engineer_confirm')
  EXECUTE FUNCTION public.trg_sync_sales_order_confirmation_from_engineer_task();

DROP TRIGGER IF EXISTS trg_engineer_task_sales_confirmation_update ON public.tasks;
CREATE TRIGGER trg_engineer_task_sales_confirmation_update
  AFTER UPDATE OF deadline, status ON public.tasks
  FOR EACH ROW
  WHEN (NEW.task_type = 'engineer_confirm')
  EXECUTE FUNCTION public.trg_sync_sales_order_confirmation_from_engineer_task();

CREATE OR REPLACE FUNCTION public.trg_sync_sales_order_confirmation_from_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_sync_sales_order_confirmation_task(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_machines_sales_order_confirmation_sync ON public.machines;
CREATE TRIGGER trg_machines_sales_order_confirmation_sync
  AFTER UPDATE OF created_by, is_confirmed, is_archived ON public.machines
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_sales_order_confirmation_from_machine();

CREATE OR REPLACE FUNCTION public.trg_sync_sales_order_confirmation_from_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_machine_id uuid;
BEGIN
  FOR v_machine_id IN
    SELECT machine.id
    FROM public.machines machine
    WHERE machine.created_by = NEW.id
  LOOP
    PERFORM public.fn_sync_sales_order_confirmation_task(v_machine_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_sales_order_confirmation_task_sync ON public.users;
CREATE TRIGGER trg_users_sales_order_confirmation_task_sync
  AFTER UPDATE OF is_active, is_service_account ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_sales_order_confirmation_from_manager();

REVOKE ALL ON FUNCTION public.trg_sync_sales_order_confirmation_from_engineer_task()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_sales_order_confirmation_from_machine()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_sales_order_confirmation_from_manager()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_machine_id uuid;
BEGIN
  FOR v_machine_id IN
    SELECT DISTINCT task.machine_id
    FROM public.tasks task
    WHERE task.task_type = 'engineer_confirm'
      AND task.status <> 'cancelled'
      AND task.machine_id IS NOT NULL
  LOOP
    PERFORM public.fn_sync_sales_order_confirmation_task(v_machine_id);
  END LOOP;
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
