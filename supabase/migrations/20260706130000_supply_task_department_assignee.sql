CREATE OR REPLACE FUNCTION public.resolve_machine_supply_task_assignee(p_factory_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_department_id uuid;
  v_assignee uuid;
BEGIN
  SELECT d.id
  INTO v_department_id
  FROM public.departments d
  WHERE d.is_active = true
    AND lower(btrim(d.name)) IN ('снабжение', 'отдел снабжения')
    AND (
      p_factory_id IS NULL
      OR d.factory_id IS NULL
      OR d.factory_id = p_factory_id
    )
  ORDER BY
    CASE WHEN p_factory_id IS NOT NULL AND d.factory_id = p_factory_id THEN 0 ELSE 1 END,
    d.sort_order ASC,
    d.created_at ASC
  LIMIT 1;

  IF v_department_id IS NOT NULL THEN
    SELECT d.head_user_id
    INTO v_assignee
    FROM public.departments d
    JOIN public.users u ON u.id = d.head_user_id
    WHERE d.id = v_department_id
      AND COALESCE(u.is_active, true) = true
    LIMIT 1;

    IF v_assignee IS NULL THEN
      SELECT dm.user_id
      INTO v_assignee
      FROM public.department_members dm
      JOIN public.users u ON u.id = dm.user_id
      WHERE dm.department_id = v_department_id
        AND dm.is_department_head = true
        AND COALESCE(u.is_active, true) = true
      ORDER BY dm.joined_at ASC
      LIMIT 1;
    END IF;

    IF v_assignee IS NULL THEN
      SELECT dm.user_id
      INTO v_assignee
      FROM public.department_members dm
      JOIN public.users u ON u.id = dm.user_id
      WHERE dm.department_id = v_department_id
        AND COALESCE(u.is_active, true) = true
      ORDER BY dm.is_department_head DESC, dm.joined_at ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_assignee IS NULL THEN
    SELECT u.id
    INTO v_assignee
    FROM public.users u
    WHERE u.role IN ('procurement_head', 'supply_manager')
      AND COALESCE(u.is_active, true) = true
    ORDER BY
      CASE u.role WHEN 'procurement_head' THEN 0 ELSE 1 END,
      u.created_at ASC
    LIMIT 1;
  END IF;

  RETURN v_assignee;
END;
$$;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_resync_auto_task_assignees()
RETURNS integer AS $$
DECLARE
  v_technologist_user_id uuid;
  v_engineer_user_id uuid;
  v_updated integer;
  v_total integer := 0;
BEGIN
  WITH supply_tasks AS (
    SELECT
      t.id,
      public.resolve_machine_supply_task_assignee(m.factory_id) AS assignee_id
    FROM public.tasks t
    JOIN public.machines m ON m.id = t.machine_id
    WHERE t.task_type = 'supply_start'
      AND t.status IN ('pending', 'in_progress')
  ),
  updated AS (
    UPDATE public.tasks t
    SET
      assigned_to = st.assignee_id,
      description = CASE
        WHEN COALESCE(t.description, '') LIKE 'Нет активного пользователя с ролью supply_manager%'
          OR COALESCE(t.description, '') LIKE 'Нет активного руководителя отдела снабжения%'
        THEN NULL
        ELSE t.description
      END,
      updated_at = now()
    FROM supply_tasks st
    WHERE t.id = st.id
      AND st.assignee_id IS NOT NULL
      AND (
        t.assigned_to IS DISTINCT FROM st.assignee_id
        OR COALESCE(t.description, '') LIKE 'Нет активного пользователя с ролью supply_manager%'
        OR COALESCE(t.description, '') LIKE 'Нет активного руководителя отдела снабжения%'
      )
    RETURNING t.id
  )
  SELECT COUNT(*)
  INTO v_updated
  FROM updated;

  v_total := v_total + COALESCE(v_updated, 0);

  SELECT u.id
  INTO v_technologist_user_id
  FROM public.company_settings cs
  JOIN public.users u ON u.id = cs.auto_task_technologist_user_id
  WHERE cs.id = '00000000-0000-0000-0000-000000000001'
    AND COALESCE(u.is_active, true) = true;

  IF v_technologist_user_id IS NOT NULL THEN
    UPDATE public.tasks
    SET assigned_to = v_technologist_user_id,
        updated_at = now()
    WHERE task_type = 'technologist_request'
      AND status IN ('pending', 'in_progress')
      AND assigned_to IS DISTINCT FROM v_technologist_user_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;
  END IF;

  SELECT u.id
  INTO v_engineer_user_id
  FROM public.company_settings cs
  JOIN public.users u ON u.id = cs.auto_task_engineer_user_id
  WHERE cs.id = '00000000-0000-0000-0000-000000000001'
    AND COALESCE(u.is_active, true) = true;

  IF v_engineer_user_id IS NOT NULL THEN
    UPDATE public.tasks
    SET assigned_to = v_engineer_user_id,
        updated_at = now()
    WHERE task_type = 'engineer_confirm'
      AND status IN ('pending', 'in_progress')
      AND assigned_to IS DISTINCT FROM v_engineer_user_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;
  END IF;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT public.fn_resync_auto_task_assignees();
SELECT pg_notify('pgrst', 'reload schema');
