CREATE OR REPLACE FUNCTION public.fn_resync_auto_task_assignees()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_technologist_user_id uuid;
  v_engineer_user_id uuid;
  v_updated integer := 0;
  v_total integer := 0;
BEGIN
  SELECT u.id INTO v_technologist_user_id
  FROM public.company_settings cs
  JOIN public.users u ON u.id = cs.auto_task_technologist_user_id
  WHERE cs.id = '00000000-0000-0000-0000-000000000001'
    AND COALESCE(u.is_active, true) = true
    AND COALESCE(u.is_service_account, false) = false;

  IF v_technologist_user_id IS NOT NULL THEN
    UPDATE public.tasks
    SET assigned_to = v_technologist_user_id, updated_at = now()
    WHERE task_type IN ('technologist_request', 'material_type_selection')
      AND status IN ('pending', 'in_progress')
      AND assigned_to IS DISTINCT FROM v_technologist_user_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;
  END IF;

  SELECT u.id INTO v_engineer_user_id
  FROM public.company_settings cs
  JOIN public.users u ON u.id = cs.auto_task_engineer_user_id
  WHERE cs.id = '00000000-0000-0000-0000-000000000001'
    AND COALESCE(u.is_active, true) = true
    AND COALESCE(u.is_service_account, false) = false;

  IF v_engineer_user_id IS NOT NULL THEN
    UPDATE public.tasks
    SET assigned_to = v_engineer_user_id, updated_at = now()
    WHERE task_type = 'engineer_confirm'
      AND status IN ('pending', 'in_progress')
      AND assigned_to IS DISTINCT FROM v_engineer_user_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;
  END IF;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_due_transport_cost_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine record;
  v_task record;
  v_shipping_date date;
  v_assignee uuid;
  v_deadline date;
  v_has_transport_cost boolean;
  v_count integer := 0;
BEGIN
  FOR v_machine IN
    SELECT DISTINCT m.id, m.name, m.created_by, m.is_archived
    FROM public.machines m
    LEFT JOIN public.production_stages ps
      ON ps.machine_id = m.id
      AND ps.stage_type = 'shipping'
    LEFT JOIN public.tasks existing_task
      ON existing_task.machine_id = m.id
      AND existing_task.task_type IN ('transport_cost', 'shipping_documents')
      AND existing_task.status IN ('pending', 'in_progress')
    WHERE existing_task.id IS NOT NULL
       OR COALESCE(ps.date_end, ps.planned_date_end) <= CURRENT_DATE + 7
  LOOP
    SELECT COALESCE(ps.date_end, ps.planned_date_end)::date
    INTO v_shipping_date
    FROM (SELECT 1) seed
    LEFT JOIN LATERAL (
      SELECT date_end, planned_date_end
      FROM public.production_stages
      WHERE machine_id = v_machine.id
        AND stage_type = 'shipping'
      ORDER BY created_at DESC
      LIMIT 1
    ) ps ON true;

    SELECT u.id INTO v_assignee
    FROM public.users u
    WHERE u.id = v_machine.created_by
      AND COALESCE(u.is_active, true) = true
      AND COALESCE(u.is_service_account, false) = false;

    IF COALESCE(v_machine.is_archived, false) OR v_shipping_date IS NULL OR v_assignee IS NULL THEN
      UPDATE public.tasks
      SET status = 'cancelled', updated_at = now()
      WHERE machine_id = v_machine.id
        AND task_type IN ('transport_cost', 'shipping_documents')
        AND status IN ('pending', 'in_progress');
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.machine_expenses me
      WHERE me.machine_id = v_machine.id
        AND lower(btrim(COALESCE(me.category, ''))) IN (
          'транспорт',
          'транспортные расходы',
          'transport',
          'transport_cost'
        )
        AND COALESCE(me.amount, 0) > 0
    ) INTO v_has_transport_cost;

    FOR v_task IN
      SELECT *
      FROM (VALUES
        ('transport_cost'::public.task_type, 7, 'Внести стоимость транспорта', 'Укажите транспортный расход'),
        ('shipping_documents'::public.task_type, 5, 'Подготовить документы для отгрузки', 'Подготовьте документы для отгрузки')
      ) AS task_definition(task_type, days_before, title, description)
    LOOP
      v_deadline := v_shipping_date - v_task.days_before;

      IF CURRENT_DATE < v_deadline OR (v_task.task_type = 'transport_cost' AND v_has_transport_cost) THEN
        UPDATE public.tasks
        SET status = 'cancelled', updated_at = now()
        WHERE machine_id = v_machine.id
          AND task_type = v_task.task_type
          AND status IN ('pending', 'in_progress');
        CONTINUE;
      END IF;

      WITH ranked AS (
        SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS position
        FROM public.tasks
        WHERE machine_id = v_machine.id
          AND task_type = v_task.task_type
          AND status IN ('pending', 'in_progress')
      )
      UPDATE public.tasks t
      SET status = 'cancelled', updated_at = now()
      FROM ranked r
      WHERE t.id = r.id
        AND r.position > 1;

      UPDATE public.tasks
      SET assigned_to = v_assignee,
          title = v_task.title || ': ' || COALESCE(v_machine.name, 'Машина'),
          description = v_task.description || ' для машины ' || COALESCE(v_machine.name, 'Машина')
            || '. Плановая готовность к погрузке: ' || to_char(v_shipping_date, 'DD.MM.YYYY') || '.',
          start_date = v_deadline,
          deadline = v_deadline,
          updated_at = now()
      WHERE machine_id = v_machine.id
        AND task_type = v_task.task_type
        AND status IN ('pending', 'in_progress');

      IF NOT FOUND AND NOT EXISTS (
        SELECT 1
        FROM public.tasks
        WHERE machine_id = v_machine.id
          AND task_type = v_task.task_type
          AND status = 'completed'
      ) THEN
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
          v_machine.id,
          v_assignee,
          v_task.task_type,
          v_task.title || ': ' || COALESCE(v_machine.name, 'Машина'),
          v_task.description || ' для машины ' || COALESCE(v_machine.name, 'Машина')
            || '. Плановая готовность к погрузке: ' || to_char(v_shipping_date, 'DD.MM.YYYY') || '.',
          'pending',
          v_deadline,
          v_deadline
        )
        ON CONFLICT (machine_id, assigned_to, task_type)
          WHERE machine_id IS NOT NULL
            AND status IN ('pending', 'in_progress')
        DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            start_date = EXCLUDED.start_date,
            deadline = EXCLUDED.deadline,
            updated_at = now();
      END IF;

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$$;

SELECT public.fn_resync_auto_task_assignees();
SELECT public.fn_sync_due_transport_cost_tasks();
SELECT pg_notify('pgrst', 'reload schema');
