CREATE OR REPLACE FUNCTION public.activate_supply_start_task(p_machine_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine public.machines%ROWTYPE;
  v_assignee_id uuid;
  v_task_id uuid;
BEGIN
  SELECT m.*
  INTO v_machine
  FROM public.machines m
  WHERE m.id = p_machine_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Машина % не найдена', p_machine_id;
  END IF;

  v_assignee_id := public.resolve_machine_supply_task_assignee(v_machine.factory_id);
  v_assignee_id := COALESCE(v_assignee_id, v_machine.created_by);

  IF v_assignee_id IS NULL THEN
    RAISE EXCEPTION 'Не найден исполнитель задачи снабжения для машины %', p_machine_id;
  END IF;

  SELECT t.id
  INTO v_task_id
  FROM public.tasks t
  WHERE t.machine_id = p_machine_id
    AND t.task_type = 'supply_start'
  ORDER BY
    CASE WHEN t.assigned_to = v_assignee_id THEN 0 ELSE 1 END,
    CASE WHEN t.status IN ('pending', 'in_progress') THEN 0 ELSE 1 END,
    t.created_at ASC
  LIMIT 1;

  IF v_task_id IS NULL THEN
    INSERT INTO public.tasks (
      machine_id,
      assigned_to,
      task_type,
      title,
      description,
      status,
      start_date,
      deadline
    )
    VALUES (
      p_machine_id,
      v_assignee_id,
      'supply_start',
      'Забронировать материал со склада и начать обработку заявки: ' || v_machine.name,
      'Технолог завершил бронь делового остатка. Забронируйте необходимый материал со склада и начните обработку заявки.',
      'pending',
      CURRENT_DATE,
      COALESCE(v_machine.planned_material_date, CURRENT_DATE)
    )
    RETURNING id INTO v_task_id;
  ELSE
    UPDATE public.tasks
    SET
      assigned_to = v_assignee_id,
      title = 'Забронировать материал со склада и начать обработку заявки: ' || v_machine.name,
      description = 'Технолог завершил бронь делового остатка. Забронируйте необходимый материал со склада и начните обработку заявки.',
      status = 'pending',
      start_date = CURRENT_DATE,
      deadline = COALESCE(v_machine.planned_material_date, CURRENT_DATE),
      completed_at = NULL,
      notified_at = NULL,
      telegram_error = NULL,
      updated_at = now()
    WHERE id = v_task_id;
  END IF;

  UPDATE public.tasks
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE machine_id = p_machine_id
    AND task_type = 'supply_start'
    AND id <> v_task_id
    AND status IN ('pending', 'in_progress');

  RETURN v_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_supply_start_task(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_supply_start_task(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_complete_technologist_request_task_on_request_sent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('submitted_to_supply', 'completed') THEN
    PERFORM public.complete_sent_technologist_request_tasks(NEW.machine_id);
  END IF;

  IF NEW.status = 'submitted_to_supply'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.activate_supply_start_task(NEW.machine_id);
  END IF;

  RETURN NEW;
END;
$$;

SELECT pg_notify('pgrst', 'reload schema');
