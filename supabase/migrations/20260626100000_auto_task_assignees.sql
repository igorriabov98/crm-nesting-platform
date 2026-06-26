ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS auto_task_technologist_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auto_task_engineer_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

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
    UPDATE tasks
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

    IF v_task_type = 'supply_start' THEN
      v_required_role := 'supply_manager';
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
      FROM company_settings
      WHERE id = '00000000-0000-0000-0000-000000000001';
    ELSE
      v_required_role := 'engineer';
      v_title := 'Подтвердить чертежи: ' || NEW.name;
      v_start_date := NEW.planned_material_date - v_engineer_start_offset;
      v_deadline := NEW.planned_material_date - v_engineer_deadline_offset;

      SELECT auto_task_engineer_user_id
      INTO v_configured_user_id
      FROM company_settings
      WHERE id = '00000000-0000-0000-0000-000000000001';
    END IF;

    IF v_configured_user_id IS NOT NULL THEN
      SELECT id
      INTO v_user_id
      FROM users
      WHERE id = v_configured_user_id
        AND is_active = true
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      SELECT id
      INTO v_user_id
      FROM users
      WHERE role = v_required_role
        AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
      v_user_id := NEW.created_by;
      v_description := 'Нет активного пользователя с ролью ' || v_required_role || ', задача назначена создателю';
    END IF;

    SELECT id, status
    INTO v_task_id, v_task_status
    FROM tasks
    WHERE machine_id = NEW.id
      AND task_type = v_task_type
      AND status <> 'cancelled'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_task_id IS NULL THEN
      INSERT INTO tasks (
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
      UPDATE tasks
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
  SELECT u.id
  INTO v_technologist_user_id
  FROM company_settings cs
  JOIN users u ON u.id = cs.auto_task_technologist_user_id
  WHERE cs.id = '00000000-0000-0000-0000-000000000001'
    AND u.is_active = true;

  IF v_technologist_user_id IS NOT NULL THEN
    UPDATE tasks
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
  FROM company_settings cs
  JOIN users u ON u.id = cs.auto_task_engineer_user_id
  WHERE cs.id = '00000000-0000-0000-0000-000000000001'
    AND u.is_active = true;

  IF v_engineer_user_id IS NOT NULL THEN
    UPDATE tasks
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
