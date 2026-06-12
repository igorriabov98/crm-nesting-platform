-- Recalculate automatic engineer / technologist / supply task windows.

CREATE OR REPLACE FUNCTION fn_manage_machine_tasks()
RETURNS TRIGGER AS $$
DECLARE
  v_task_type task_type;
  v_required_role user_role;
  v_user_id uuid;
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
    ELSE
      v_required_role := 'engineer';
      v_title := 'Подтвердить чертежи: ' || NEW.name;
      v_start_date := NEW.planned_material_date - v_engineer_start_offset;
      v_deadline := NEW.planned_material_date - v_engineer_deadline_offset;
    END IF;

    SELECT id
    INTO v_user_id
    FROM users
    WHERE role = v_required_role
      AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

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

DROP TRIGGER IF EXISTS trg_manage_machine_tasks ON machines;
DROP TRIGGER IF EXISTS trg_manage_machine_tasks_insert ON machines;

CREATE TRIGGER trg_manage_machine_tasks
  AFTER UPDATE OF factory_id, material_type, planned_material_date ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_manage_machine_tasks();

CREATE TRIGGER trg_manage_machine_tasks_insert
  AFTER INSERT ON machines
  FOR EACH ROW
  WHEN (
    NEW.factory_id IS NOT NULL
    AND NEW.material_type IS NOT NULL
    AND NEW.material_type <> 'undefined'
    AND NEW.planned_material_date IS NOT NULL
  )
  EXECUTE FUNCTION fn_manage_machine_tasks();
