DO $$
DECLARE
  v_technologist_id uuid;
  v_task record;
  v_existing_task_id uuid;
BEGIN
  SELECT id
  INTO v_technologist_id
  FROM public.users
  WHERE role = 'technologist'
    AND COALESCE(is_active, true)
    AND lower(concat_ws(' ', full_name, email)) !~ '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
  ORDER BY full_name, created_at, id
  LIMIT 1;

  IF v_technologist_id IS NULL THEN
    RAISE NOTICE 'Active non-service technologist was not found; task assignees were not changed.';
    RETURN;
  END IF;

  UPDATE public.company_settings settings
  SET auto_task_technologist_user_id = v_technologist_id,
      updated_at = now()
  WHERE settings.id = '00000000-0000-0000-0000-000000000001'
    AND (
      settings.auto_task_technologist_user_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.users configured
        WHERE configured.id = settings.auto_task_technologist_user_id
          AND (
            configured.role <> 'technologist'
            OR NOT COALESCE(configured.is_active, true)
            OR lower(concat_ws(' ', configured.full_name, configured.email)) ~ '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
          )
      )
    );

  FOR v_task IN
    SELECT task.id, task.machine_id, task.task_type, task.status
    FROM public.tasks task
    JOIN public.users assignee ON assignee.id = task.assigned_to
    WHERE task.machine_id IS NOT NULL
      AND task.task_type IN ('machine_layout', 'material_type_selection')
      AND (
        assignee.role <> 'technologist'
        OR NOT COALESCE(assignee.is_active, true)
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
    AND (
      assignee.role <> 'technologist'
      OR NOT COALESCE(assignee.is_active, true)
      OR lower(concat_ws(' ', assignee.full_name, assignee.email)) ~ '(^|[[:space:]])(ci[[:space:]]+)?smoke([[:space:]]|$)|smoke[-_.+@]'
    );
END;
$$;
