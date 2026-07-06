CREATE OR REPLACE FUNCTION public.machine_supply_request_sent(p_machine_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.technologist_requests tr
    WHERE tr.machine_id = p_machine_id
      AND tr.status IN ('submitted_to_supply', 'completed')
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_sent_technologist_request_tasks(p_machine_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.tasks
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, now()),
    updated_at = now()
  WHERE machine_id = p_machine_id
    AND task_type = 'technologist_request'
    AND status IN ('pending', 'in_progress')
    AND public.machine_supply_request_sent(p_machine_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complete_technologist_request_task_on_request_sent ON public.technologist_requests;
CREATE TRIGGER trg_complete_technologist_request_task_on_request_sent
AFTER INSERT OR UPDATE OF status ON public.technologist_requests
FOR EACH ROW
EXECUTE FUNCTION public.fn_complete_technologist_request_task_on_request_sent();

CREATE OR REPLACE FUNCTION public.fn_manage_machine_tasks()
RETURNS TRIGGER AS $$
DECLARE
  v_task_type task_type;
  v_required_role user_role;
  v_user_id uuid;
  v_configured_user_id uuid;
  v_task_id uuid;
  v_task_status task_status;
  v_title text;
  v_description text;
  v_start_date date;
  v_deadline date;
  v_supply_offset int;
  v_technologist_start_offset int;
  v_technologist_deadline_offset int;
  v_engineer_start_offset int;
  v_engineer_deadline_offset int;
  v_supply_request_sent boolean;
BEGIN
  IF NEW.factory_id IS NULL
     OR NEW.material_type IS NULL
     OR NEW.material_type = 'undefined'
     OR NEW.planned_material_date IS NULL THEN
    UPDATE public.tasks
    SET
      status = 'cancelled',
      updated_at = now()
    WHERE machine_id = NEW.id
      AND task_type IN ('supply_start', 'technologist_request', 'engineer_confirm')
      AND status IN ('pending', 'in_progress');

    RETURN NEW;
  END IF;

  IF NEW.material_type = 'standard' THEN
    v_supply_offset := 10;
    v_technologist_start_offset := 12;
    v_technologist_deadline_offset := 10;
    v_engineer_start_offset := 14;
    v_engineer_deadline_offset := 12;
  ELSE
    v_supply_offset := 20;
    v_technologist_start_offset := 22;
    v_technologist_deadline_offset := 20;
    v_engineer_start_offset := 24;
    v_engineer_deadline_offset := 22;
  END IF;

  v_supply_request_sent := public.machine_supply_request_sent(NEW.id);

  FOREACH v_task_type IN ARRAY ARRAY[
    'supply_start'::task_type,
    'technologist_request'::task_type,
    'engineer_confirm'::task_type
  ]
  LOOP
    v_user_id := NULL;
    v_configured_user_id := NULL;
    v_task_id := NULL;
    v_task_status := NULL;
    v_description := NULL;
    v_required_role := NULL;

    IF v_task_type = 'supply_start' THEN
      v_title := 'Начать обработку заявки: ' || NEW.name;
      v_start_date := NEW.planned_material_date - v_supply_offset;
      v_deadline := NEW.planned_material_date;
    ELSIF v_task_type = 'technologist_request' THEN
      v_required_role := 'technologist';
      v_title := 'Подготовить заявку для снабжения: ' || NEW.name;
      v_start_date := NEW.planned_material_date - v_technologist_start_offset;
      v_deadline := NEW.planned_material_date - v_technologist_deadline_offset;

      IF v_supply_request_sent THEN
        PERFORM public.complete_sent_technologist_request_tasks(NEW.id);
        CONTINUE;
      END IF;

      SELECT auto_task_technologist_user_id
      INTO v_configured_user_id
      FROM public.company_settings
      WHERE id = '00000000-0000-0000-0000-000000000001';
    ELSE
      v_required_role := 'engineer';
      v_title := 'Подтвердить чертежи: ' || NEW.name;
      v_start_date := NEW.planned_material_date - v_engineer_start_offset;
      v_deadline := NEW.planned_material_date - v_engineer_deadline_offset;

      SELECT auto_task_engineer_user_id
      INTO v_configured_user_id
      FROM public.company_settings
      WHERE id = '00000000-0000-0000-0000-000000000001';
    END IF;

    IF v_task_type = 'supply_start' THEN
      v_user_id := public.resolve_machine_supply_task_assignee(NEW.factory_id);
    ELSIF v_configured_user_id IS NOT NULL THEN
      SELECT id
      INTO v_user_id
      FROM public.users
      WHERE id = v_configured_user_id
        AND COALESCE(is_active, true) = true
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL AND v_required_role IS NOT NULL THEN
      SELECT id
      INTO v_user_id
      FROM public.users
      WHERE role = v_required_role
        AND COALESCE(is_active, true) = true
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      v_user_id := NEW.created_by;
      IF v_task_type = 'supply_start' THEN
        v_description := 'Нет активного руководителя отдела снабжения, задача назначена создателю';
      ELSE
        v_description := 'Нет активного пользователя с ролью ' || v_required_role || ', задача назначена создателю';
      END IF;
    END IF;

    SELECT id, status
    INTO v_task_id, v_task_status
    FROM public.tasks
    WHERE machine_id = NEW.id
      AND task_type = v_task_type
      AND status <> 'cancelled'
    ORDER BY created_at ASC
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
        NEW.id,
        v_user_id,
        v_task_type,
        v_title,
        v_description,
        'pending',
        v_start_date,
        v_deadline
      );
    ELSIF v_task_status IN ('pending', 'in_progress') THEN
      UPDATE public.tasks
      SET
        assigned_to = v_user_id,
        title = v_title,
        description = v_description,
        start_date = v_start_date,
        deadline = v_deadline,
        updated_at = now()
      WHERE id = v_task_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

UPDATE public.tasks t
SET
  status = 'completed',
  completed_at = COALESCE(t.completed_at, now()),
  updated_at = now()
WHERE t.task_type = 'technologist_request'
  AND t.status IN ('pending', 'in_progress')
  AND public.machine_supply_request_sent(t.machine_id);

SELECT pg_notify('pgrst', 'reload schema');
