DO $$
DECLARE
  v_technologist_id uuid;
  v_task record;
  v_existing_task_id uuid;
BEGIN
  SELECT candidate.id
  INTO v_technologist_id
  FROM (
    SELECT
      employee.id,
      employee.full_name,
      employee.created_at,
      CASE WHEN employee.role = 'technologist' THEN 0 ELSE 1 END AS priority
    FROM public.users employee
    WHERE COALESCE(employee.is_active, true)
      AND lower(concat_ws(' ', employee.full_name, employee.email)) !~ '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
      AND (
        employee.role = 'technologist'
        OR EXISTS (
          SELECT 1
          FROM public.department_members member
          JOIN public.departments department
            ON department.id = member.department_id
           AND COALESCE(department.is_active, true)
          LEFT JOIN public.positions position ON position.id = member.position_id
          WHERE member.user_id = employee.id
            AND lower(concat_ws(' ', department.name, position.name)) ~ '(технолог|technolog)'
        )
      )
  ) candidate
  ORDER BY candidate.priority, candidate.full_name, candidate.created_at, candidate.id
  LIMIT 1;

  IF v_technologist_id IS NULL THEN
    RAISE NOTICE 'Active technologist was not found by role or company structure; task assignees were not changed.';
    RETURN;
  END IF;

  UPDATE public.company_settings
  SET auto_task_technologist_user_id = v_technologist_id,
      updated_at = now()
  WHERE id = '00000000-0000-0000-0000-000000000001';

  FOR v_task IN
    SELECT task.id, task.machine_id, task.task_type
    FROM public.tasks task
    JOIN public.users assignee ON assignee.id = task.assigned_to
    WHERE task.machine_id IS NOT NULL
      AND task.task_type IN ('machine_layout', 'material_type_selection')
      AND task.assigned_to <> v_technologist_id
      AND (
        NOT COALESCE(assignee.is_active, true)
        OR lower(concat_ws(' ', assignee.full_name, assignee.email)) ~ '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
      )
    ORDER BY task.created_at, task.id
  LOOP
    v_existing_task_id := NULL;

    SELECT existing.id
    INTO v_existing_task_id
    FROM public.tasks existing
    WHERE existing.machine_id = v_task.machine_id
      AND existing.assigned_to = v_technologist_id
      AND existing.task_type = v_task.task_type
      AND existing.id <> v_task.id
    ORDER BY existing.created_at DESC, existing.id
    LIMIT 1;

    IF v_existing_task_id IS NULL THEN
      UPDATE public.tasks
      SET assigned_to = v_technologist_id,
          notified_at = NULL,
          telegram_error = NULL,
          updated_at = now()
      WHERE id = v_task.id;
    ELSE
      IF v_task.task_type = 'machine_layout' THEN
        UPDATE public.machine_layout_requests
        SET task_id = v_existing_task_id,
            assigned_to = v_technologist_id,
            updated_at = now()
        WHERE task_id = v_task.id;
      END IF;

      UPDATE public.tasks
      SET status = 'cancelled', updated_at = now()
      WHERE id = v_task.id;
    END IF;
  END LOOP;

  UPDATE public.machine_layout_requests request
  SET assigned_to = v_technologist_id,
      updated_at = now()
  FROM public.users assignee
  WHERE assignee.id = request.assigned_to
    AND request.assigned_to <> v_technologist_id
    AND (
      NOT COALESCE(assignee.is_active, true)
      OR lower(concat_ws(' ', assignee.full_name, assignee.email)) ~ '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
    );
END;
$$;
