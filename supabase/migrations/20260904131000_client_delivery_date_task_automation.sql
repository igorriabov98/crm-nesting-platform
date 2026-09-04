-- Automatic reminder for the client's responsible sales manager to record the
-- actual delivery date three calendar days before the calculated delivery.

COMMENT ON COLUMN public.clients.estimated_delivery_days IS
  'Calendar-day delivery estimate used for payment forecasts and delivery-date reminders.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_client_delivery_date_active_machine
  ON public.tasks (machine_id)
  WHERE task_type = 'client_delivery_date'
    AND status IN ('pending', 'in_progress');

CREATE OR REPLACE FUNCTION public.fn_sync_client_delivery_date_task(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_machine record;
  v_shipping_date date;
  v_calculated_delivery_date date;
  v_deadline date;
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
  v_manager_is_valid boolean := false;
  v_task_id uuid;
  v_current_assignee uuid;
BEGIN
  SELECT
    machine.id,
    machine.name,
    machine.client_id,
    machine.is_archived,
    machine.desired_shipping_date,
    machine.actual_shipping_date,
    machine.delivery_to_client_date,
    client.responsible_user_id,
    COALESCE(client.estimated_delivery_days, 7) AS estimated_delivery_days
  INTO v_machine
  FROM public.machines machine
  LEFT JOIN public.clients client ON client.id = machine.client_id
  WHERE machine.id = p_machine_id
  FOR UPDATE OF machine;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_shipping_date := COALESCE(v_machine.actual_shipping_date, v_machine.desired_shipping_date)::date;
  IF v_shipping_date IS NOT NULL THEN
    v_calculated_delivery_date := v_shipping_date + v_machine.estimated_delivery_days::integer;
    v_deadline := v_calculated_delivery_date - 3;
  END IF;

  IF v_machine.responsible_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.users manager
      WHERE manager.id = v_machine.responsible_user_id
        AND manager.role = 'sales_manager'::public.user_role
        AND manager.is_active = true
        AND COALESCE(manager.is_service_account, false) = false
    ) INTO v_manager_is_valid;
  END IF;

  SELECT task.id, task.assigned_to
  INTO v_task_id, v_current_assignee
  FROM public.tasks task
  WHERE task.machine_id = p_machine_id
    AND task.task_type = 'client_delivery_date'
    AND task.status IN ('pending', 'in_progress')
  ORDER BY task.created_at, task.id
  LIMIT 1
  FOR UPDATE;

  IF COALESCE(v_machine.is_archived, false) THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'client_delivery_date'
      AND delegation.status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    RETURN;
  END IF;

  IF v_machine.delivery_to_client_date IS NOT NULL THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'client_delivery_date'
      AND delegation.status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    RETURN;
  END IF;

  IF v_machine.client_id IS NULL
     OR v_shipping_date IS NULL
     OR v_deadline IS NULL
     OR v_machine.responsible_user_id IS NULL
     OR NOT v_manager_is_valid
     OR v_today < v_deadline THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress');

    UPDATE public.task_delegations delegation
    SET status = 'cancelled', responded_at = now()
    FROM public.tasks task
    WHERE delegation.task_id = task.id
      AND task.machine_id = p_machine_id
      AND task.task_type = 'client_delivery_date'
      AND delegation.status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    RETURN;
  END IF;

  IF v_task_id IS NOT NULL AND v_current_assignee IS DISTINCT FROM v_machine.responsible_user_id THEN
    PERFORM set_config('app.client_delivery_task_sync', 'on', true);
    UPDATE public.tasks
    SET status = 'cancelled', completed_at = NULL, updated_at = now()
    WHERE id = v_task_id;

    UPDATE public.task_delegations
    SET status = 'cancelled', responded_at = now()
    WHERE task_id = v_task_id
      AND status = 'pending';
    PERFORM set_config('app.client_delivery_task_sync', 'off', true);
    v_task_id := NULL;
  END IF;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET title = 'Внести дату доставки клиенту: ' || COALESCE(v_machine.name, 'Машина'),
        description = 'Внесите фактическую дату доставки клиенту. Расчётная дата доставки: '
          || to_char(v_calculated_delivery_date, 'DD.MM.YYYY') || ' ('
          || CASE
               WHEN v_machine.actual_shipping_date IS NOT NULL THEN 'фактическая дата отгрузки '
               ELSE 'плановая дата отгрузки '
             END
          || to_char(v_shipping_date, 'DD.MM.YYYY') || ' + '
          || v_machine.estimated_delivery_days::text || ' календ. дн.).',
        start_date = v_deadline,
        deadline = v_deadline,
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
    v_machine.responsible_user_id,
    'client_delivery_date',
    'Внести дату доставки клиенту: ' || COALESCE(v_machine.name, 'Машина'),
    'Внесите фактическую дату доставки клиенту. Расчётная дата доставки: '
      || to_char(v_calculated_delivery_date, 'DD.MM.YYYY') || ' ('
      || CASE
           WHEN v_machine.actual_shipping_date IS NOT NULL THEN 'фактическая дата отгрузки '
           ELSE 'плановая дата отгрузки '
         END
      || to_char(v_shipping_date, 'DD.MM.YYYY') || ' + '
      || v_machine.estimated_delivery_days::text || ' календ. дн.).',
    'pending',
    v_deadline,
    v_deadline
  )
  ON CONFLICT (machine_id)
    WHERE task_type = 'client_delivery_date'
      AND status IN ('pending', 'in_progress')
  DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    start_date = EXCLUDED.start_date,
    deadline = EXCLUDED.deadline,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_client_delivery_date_task(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_client_delivery_date_task(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_sync_due_client_delivery_date_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_machine_id uuid;
  v_count integer := 0;
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  FOR v_machine_id IN
    SELECT DISTINCT candidate.machine_id
    FROM (
      SELECT machine.id AS machine_id
      FROM public.machines machine
      JOIN public.clients client ON client.id = machine.client_id
      WHERE COALESCE(machine.is_archived, false) = false
        AND machine.delivery_to_client_date IS NULL
        AND COALESCE(machine.actual_shipping_date, machine.desired_shipping_date) IS NOT NULL
        AND COALESCE(machine.actual_shipping_date, machine.desired_shipping_date)::date
          + COALESCE(client.estimated_delivery_days, 7)::integer <= v_today + 3
      UNION
      SELECT task.machine_id
      FROM public.tasks task
      WHERE task.task_type = 'client_delivery_date'
        AND task.status IN ('pending', 'in_progress')
        AND task.machine_id IS NOT NULL
    ) candidate
  LOOP
    PERFORM public.fn_sync_client_delivery_date_task(v_machine_id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_due_client_delivery_date_tasks()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_due_client_delivery_date_tasks() TO service_role;

CREATE OR REPLACE FUNCTION public.trg_sync_client_delivery_date_from_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_sync_client_delivery_date_task(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_machines_client_delivery_date_sync ON public.machines;
CREATE TRIGGER trg_machines_client_delivery_date_sync
  AFTER INSERT OR UPDATE OF client_id, desired_shipping_date, actual_shipping_date, delivery_to_client_date, is_archived
  ON public.machines
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_client_delivery_date_from_machine();

CREATE OR REPLACE FUNCTION public.trg_sync_client_delivery_date_from_client()
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
    WHERE machine.client_id = NEW.id
  LOOP
    PERFORM public.fn_sync_client_delivery_date_task(v_machine_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clients_delivery_date_task_sync ON public.clients;
CREATE TRIGGER trg_clients_delivery_date_task_sync
  AFTER UPDATE OF responsible_user_id, estimated_delivery_days ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_client_delivery_date_from_client();

CREATE OR REPLACE FUNCTION public.trg_sync_client_delivery_date_from_manager()
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
    FROM public.clients client
    JOIN public.machines machine ON machine.client_id = client.id
    WHERE client.responsible_user_id = NEW.id
  LOOP
    PERFORM public.fn_sync_client_delivery_date_task(v_machine_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_client_delivery_date_task_sync ON public.users;
CREATE TRIGGER trg_users_client_delivery_date_task_sync
  AFTER UPDATE OF role, is_active, is_service_account ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_client_delivery_date_from_manager();

CREATE OR REPLACE FUNCTION public.trg_guard_client_delivery_date_task_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.client_delivery_task_sync', true), '') <> 'on'
     AND (
       (OLD.task_type = 'client_delivery_date' AND NEW.task_type IS DISTINCT FROM OLD.task_type)
       OR (OLD.task_type = 'client_delivery_date' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to)
       OR (
         OLD.task_type = 'client_delivery_date'
         AND NEW.status IS DISTINCT FROM OLD.status
         AND NOT (
           OLD.status IN ('pending', 'in_progress')
           AND NEW.status IN ('pending', 'in_progress')
         )
       )
     ) THEN
    RAISE EXCEPTION 'Задача по дате доставки меняется автоматически по ответственному менеджеру и фактической дате доставки';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_guard_client_delivery_date_mutation ON public.tasks;
CREATE TRIGGER trg_tasks_guard_client_delivery_date_mutation
  BEFORE UPDATE OF task_type, assigned_to, status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_client_delivery_date_task_mutation();

REVOKE ALL ON FUNCTION public.trg_sync_client_delivery_date_from_machine() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_client_delivery_date_from_client() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_sync_client_delivery_date_from_manager() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_guard_client_delivery_date_task_mutation() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-client-delivery-date-tasks') THEN
    PERFORM cron.unschedule('daily-client-delivery-date-tasks');
  END IF;
END;
$$;

SELECT cron.schedule(
  'daily-client-delivery-date-tasks',
  '30 6 * * *',
  $$ SELECT public.fn_sync_due_client_delivery_date_tasks(); $$
);

SELECT public.fn_sync_due_client_delivery_date_tasks();
SELECT pg_notify('pgrst', 'reload schema');
