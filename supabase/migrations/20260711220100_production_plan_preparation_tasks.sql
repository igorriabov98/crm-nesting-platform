CREATE OR REPLACE FUNCTION public.fn_sync_production_plan_preparation_task(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine record;
  v_plan_status text;
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

  v_deadline := (
    date_trunc('month', v_machine.production_month)::date
    - interval '1 month'
    + interval '9 days'
  )::date;

  UPDATE public.tasks t
  SET status = 'cancelled', updated_at = now()
  WHERE t.machine_id = p_machine_id
    AND t.task_type = 'production_plan_preparation'
    AND t.status IN ('pending', 'in_progress')
    AND NOT EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = t.assigned_to
        AND u.role = 'production_manager'
        AND u.factory_id = v_machine.factory_id
        AND COALESCE(u.is_active, true)
    );

  FOR v_manager IN
    SELECT id
    FROM public.users
    WHERE role = 'production_manager'
      AND factory_id = v_machine.factory_id
      AND COALESCE(is_active, true)
    ORDER BY full_name, created_at, id
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
      CURRENT_DATE,
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

CREATE OR REPLACE FUNCTION public.trg_sync_production_plan_preparation_from_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_sync_production_plan_preparation_task(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_production_plan_preparation_from_machine ON public.machines;
CREATE TRIGGER trg_sync_production_plan_preparation_from_machine
AFTER INSERT OR UPDATE OF is_confirmed, factory_id, production_month, is_archived ON public.machines
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_production_plan_preparation_from_machine();

CREATE OR REPLACE FUNCTION public.trg_sync_production_plan_preparation_from_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid;
BEGIN
  FOR v_machine_id IN
    SELECT id
    FROM public.machines
    WHERE factory_id = NEW.factory_id
      AND production_month = NEW.production_month
  LOOP
    PERFORM public.fn_sync_production_plan_preparation_task(v_machine_id);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_production_plan_preparation_from_plan ON public.production_month_plans;
CREATE TRIGGER trg_sync_production_plan_preparation_from_plan
AFTER INSERT OR UPDATE OF status ON public.production_month_plans
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_production_plan_preparation_from_plan();

SELECT public.fn_sync_production_plan_preparation_task(id)
FROM public.machines
WHERE COALESCE(is_confirmed, false)
  AND NOT COALESCE(is_archived, false);

SELECT pg_notify('pgrst', 'reload schema');
