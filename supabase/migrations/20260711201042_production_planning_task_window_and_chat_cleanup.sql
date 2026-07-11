-- Layout uploads are official machine updates, not chat messages.
DELETE FROM public.machine_chat_messages
WHERE message_kind = 'system'
  AND system_event_key LIKE 'machine_layout_pdf_uploaded:%';

CREATE OR REPLACE FUNCTION public.fn_is_production_manager_for_factory(
  p_user_id uuid,
  p_factory_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users employee
    WHERE employee.id = p_user_id
      AND COALESCE(employee.is_active, true)
      AND (
        (
          employee.role = 'production_manager'
          AND employee.factory_id = p_factory_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.department_members member
          JOIN public.departments department
            ON department.id = member.department_id
           AND department.factory_id = p_factory_id
           AND COALESCE(department.is_active, true)
          LEFT JOIN public.positions position ON position.id = member.position_id
          WHERE member.user_id = employee.id
            AND lower(concat_ws(' ', department.name, position.name)) ~ '(производ|production|вироб)'
            AND (
              COALESCE(member.is_department_head, false)
              OR department.head_user_id = employee.id
              OR lower(COALESCE(position.name, '')) ~ '(начальник|керівник|manager|head)'
            )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.fn_is_production_manager_for_factory(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_sync_production_plan_preparation_task(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_machine record;
  v_plan_status text;
  v_activation_date date;
  v_business_date date := timezone('Europe/Kyiv', now())::date;
  v_deadline date;
  v_manager record;
BEGIN
  SELECT id, name, factory_id, production_month, is_confirmed, is_archived
  INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(v_machine.is_archived, false)
     OR NOT COALESCE(v_machine.is_confirmed, false)
     OR v_machine.factory_id IS NULL
     OR v_machine.production_month IS NULL THEN
    UPDATE public.tasks
    SET status = 'cancelled', updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'production_plan_preparation'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  v_activation_date := (
    date_trunc('month', v_machine.production_month)::date
    - interval '1 month'
  )::date;

  IF v_business_date < v_activation_date THEN
    UPDATE public.tasks
    SET status = 'cancelled', updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'production_plan_preparation'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  SELECT status::text
  INTO v_plan_status
  FROM public.production_month_plans
  WHERE factory_id = v_machine.factory_id
    AND production_month = date_trunc('month', v_machine.production_month)::date
  LIMIT 1;

  IF v_plan_status IN ('preliminary_ready', 'confirmed') THEN
    UPDATE public.tasks
    SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type = 'production_plan_preparation'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  v_deadline := (v_activation_date + interval '9 days')::date;

  UPDATE public.tasks t
  SET status = 'cancelled', updated_at = now()
  WHERE t.machine_id = p_machine_id
    AND t.task_type = 'production_plan_preparation'
    AND t.status IN ('pending', 'in_progress')
    AND NOT public.fn_is_production_manager_for_factory(t.assigned_to, v_machine.factory_id);

  FOR v_manager IN
    SELECT employee.id
    FROM public.users employee
    WHERE public.fn_is_production_manager_for_factory(employee.id, v_machine.factory_id)
    ORDER BY
      CASE WHEN employee.role = 'production_manager' THEN 0 ELSE 1 END,
      employee.full_name,
      employee.created_at,
      employee.id
  LOOP
    INSERT INTO public.tasks (
      machine_id,
      assigned_to,
      task_type,
      title,
      description,
      status,
      start_date,
      deadline,
      completed_at,
      notified_at,
      telegram_error,
      updated_at
    ) VALUES (
      p_machine_id,
      v_manager.id,
      'production_plan_preparation',
      'Подготовить предварительный план: ' || COALESCE(v_machine.name, 'машина'),
      'Составьте предварительный план производства машины до 10 числа месяца, предшествующего месяцу производства. Месяц производства: '
        || to_char(v_machine.production_month, 'MM.YYYY') || '.',
      'pending',
      v_business_date,
      v_deadline,
      NULL,
      NULL,
      NULL,
      now()
    )
    ON CONFLICT (machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL
    DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = CASE
        WHEN tasks.status = 'in_progress' THEN 'in_progress'::public.task_status
        ELSE 'pending'::public.task_status
      END,
      start_date = EXCLUDED.start_date,
      deadline = EXCLUDED.deadline,
      completed_at = NULL,
      notified_at = CASE
        WHEN tasks.status IN ('completed', 'cancelled') THEN NULL
        ELSE tasks.notified_at
      END,
      telegram_error = NULL,
      updated_at = now();
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_production_plan_preparation_task(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_sync_due_production_plan_preparation_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_machine_id uuid;
  v_synced integer := 0;
  v_business_date date := timezone('Europe/Kyiv', now())::date;
BEGIN
  FOR v_machine_id IN
    SELECT id
    FROM public.machines
    WHERE COALESCE(is_confirmed, false)
      AND NOT COALESCE(is_archived, false)
      AND factory_id IS NOT NULL
      AND production_month IS NOT NULL
      AND (
        date_trunc('month', production_month)::date - interval '1 month'
      )::date <= v_business_date
  LOOP
    PERFORM public.fn_sync_production_plan_preparation_task(v_machine_id);
    v_synced := v_synced + 1;
  END LOOP;

  RETURN v_synced;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_due_production_plan_preparation_tasks() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-due-production-plan-preparation-tasks') THEN
    PERFORM cron.unschedule('sync-due-production-plan-preparation-tasks');
  END IF;
END;
$$;

SELECT cron.schedule(
  'sync-due-production-plan-preparation-tasks',
  -- Hourly execution keeps local midnight correct across Kyiv daylight-saving changes.
  '5 * * * *',
  $$ SELECT public.fn_sync_due_production_plan_preparation_tasks(); $$
);

SELECT public.fn_sync_production_plan_preparation_task(id)
FROM public.machines
WHERE production_month IS NOT NULL;

SELECT pg_notify('pgrst', 'reload schema');
