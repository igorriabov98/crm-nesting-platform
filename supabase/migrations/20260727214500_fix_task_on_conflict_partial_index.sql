-- PR #68 narrowed idx_tasks_machine_assigned_type_unique to active tasks so historical
-- tasks do not participate in uniqueness. Keep each ON CONFLICT inference predicate
-- identical to supabase/migrations/20260719163223_detailing_module.sql:8.

CREATE OR REPLACE FUNCTION public.fn_sync_material_type_selection_task(p_machine_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine record;
  v_goods_count integer;
  v_assignee uuid;
  v_task_id uuid;
  v_task_status task_status;
  v_today date := CURRENT_DATE;
BEGIN
  SELECT id, name, created_by, is_confirmed, material_type, is_archived
  INTO v_machine
  FROM public.machines
  WHERE id = p_machine_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(v_machine.is_archived, false) = true OR COALESCE(v_machine.is_confirmed, false) = false THEN
    UPDATE public.tasks
    SET status = 'cancelled', updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type::text = 'material_type_selection'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  IF v_machine.material_type IS NOT NULL AND v_machine.material_type::text <> 'undefined' THEN
    UPDATE public.tasks
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type::text = 'material_type_selection'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  SELECT COUNT(*)
  INTO v_goods_count
  FROM public.machine_items
  WHERE machine_id = p_machine_id
    AND COALESCE(is_sample, false) = false;

  IF v_goods_count = 0 THEN
    UPDATE public.tasks
    SET status = 'cancelled', updated_at = now()
    WHERE machine_id = p_machine_id
      AND task_type::text = 'material_type_selection'
      AND status IN ('pending', 'in_progress');
    RETURN;
  END IF;

  SELECT u.id
  INTO v_assignee
  FROM public.company_settings cs
  JOIN public.users u ON u.id = cs.auto_task_technologist_user_id
  WHERE cs.id = '00000000-0000-0000-0000-000000000001'
    AND COALESCE(u.is_active, true) = true
  LIMIT 1;

  IF v_assignee IS NULL THEN
    SELECT id
    INTO v_assignee
    FROM public.users
    WHERE role = 'technologist'
      AND COALESCE(is_active, true) = true
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_assignee IS NULL AND v_machine.created_by IS NOT NULL THEN
    SELECT id
    INTO v_assignee
    FROM public.users
    WHERE id = v_machine.created_by
      AND COALESCE(is_active, true) = true
    LIMIT 1;
  END IF;

  IF v_assignee IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.tasks
  SET status = 'cancelled', updated_at = now()
  WHERE machine_id = p_machine_id
    AND task_type::text = 'material_type_selection'
    AND assigned_to <> v_assignee
    AND status IN ('pending', 'in_progress');

  SELECT id, status
  INTO v_task_id, v_task_status
  FROM public.tasks
  WHERE machine_id = p_machine_id
    AND assigned_to = v_assignee
    AND task_type::text = 'material_type_selection'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET
      title = 'Определить тип материала: ' || COALESCE(v_machine.name, 'машина'),
      description = 'Во вкладке "Снабжение" выберите тип материала: стандартный или нестандартный.',
      status = CASE WHEN v_task_status = 'in_progress' THEN 'in_progress'::task_status ELSE 'pending'::task_status END,
      start_date = v_today,
      deadline = v_today,
      completed_at = NULL,
      updated_at = now()
    WHERE id = v_task_id;
  ELSE
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
      v_assignee,
      'material_type_selection'::task_type,
      'Определить тип материала: ' || COALESCE(v_machine.name, 'машина'),
      'Во вкладке "Снабжение" выберите тип материала: стандартный или нестандартный.',
      'pending',
      v_today,
      v_today
    )
    ON CONFLICT (machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL AND status IN ('pending','in_progress') DO UPDATE
    SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      status = 'pending',
      start_date = EXCLUDED.start_date,
      deadline = EXCLUDED.deadline,
      completed_at = NULL,
      updated_at = now();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_sync_due_transport_cost_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  v_shipping_date date;
  v_deadline date;
  v_assignee uuid;
  v_task_id uuid;
  v_task_status task_status;
  v_completed_exists boolean;
  v_synced integer := 0;
BEGIN
  FOR rec IN
    SELECT DISTINCT
      m.id,
      m.name,
      m.created_by,
      m.is_archived,
      COALESCE(ps.planned_date_end, ps.date_end, m.desired_shipping_date)::date AS shipping_date
    FROM public.machines m
    LEFT JOIN LATERAL (
      SELECT planned_date_end, date_end
      FROM public.production_stages
      WHERE machine_id = m.id
        AND stage_type = 'shipping'
      ORDER BY created_at ASC
      LIMIT 1
    ) ps ON true
    WHERE COALESCE(ps.planned_date_end, ps.date_end, m.desired_shipping_date)::date <= CURRENT_DATE + 7
       OR EXISTS (
         SELECT 1
         FROM public.tasks t
         WHERE t.machine_id = m.id
           AND t.task_type::text = 'transport_cost'
           AND t.status IN ('pending', 'in_progress')
       )
  LOOP
    v_shipping_date := rec.shipping_date;

    IF COALESCE(rec.is_archived, false) = true
       OR v_shipping_date IS NULL
       OR v_shipping_date - 7 > CURRENT_DATE
       OR EXISTS (
         SELECT 1
         FROM public.machine_expenses me
         WHERE me.machine_id = rec.id
           AND lower(btrim(me.category)) IN ('транспорт', 'transport', 'transport_cost')
           AND COALESCE(me.amount, 0) > 0
       ) THEN
      UPDATE public.tasks
      SET status = 'cancelled', updated_at = now()
      WHERE machine_id = rec.id
        AND task_type::text = 'transport_cost'
        AND status IN ('pending', 'in_progress');
      CONTINUE;
    END IF;

    v_deadline := v_shipping_date - 7;
    v_assignee := NULL;
    v_task_id := NULL;
    v_task_status := NULL;
    v_completed_exists := false;

    IF rec.created_by IS NOT NULL THEN
      SELECT id
      INTO v_assignee
      FROM public.users
      WHERE id = rec.created_by
        AND COALESCE(is_active, true) = true
      LIMIT 1;
    END IF;

    IF v_assignee IS NULL THEN
      SELECT id
      INTO v_assignee
      FROM public.users
      WHERE role = 'commercial_director'
        AND COALESCE(is_active, true) = true
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    IF v_assignee IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.tasks
    SET status = 'cancelled', updated_at = now()
    WHERE machine_id = rec.id
      AND task_type::text = 'transport_cost'
      AND assigned_to <> v_assignee
      AND status IN ('pending', 'in_progress');

    SELECT id, status
    INTO v_task_id, v_task_status
    FROM public.tasks
    WHERE machine_id = rec.id
      AND assigned_to = v_assignee
      AND task_type::text = 'transport_cost'
      AND status <> 'completed'
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.tasks
      WHERE machine_id = rec.id
        AND assigned_to = v_assignee
        AND task_type::text = 'transport_cost'
        AND status = 'completed'
    )
    INTO v_completed_exists;

    IF v_task_id IS NOT NULL THEN
      UPDATE public.tasks
      SET
        title = 'Внести стоимость транспорта: ' || COALESCE(rec.name, 'Машина'),
        description = 'Укажите транспортный расход для машины ' || COALESCE(rec.name, 'Машина') || '. Плановая отгрузка: ' || to_char(v_shipping_date, 'DD.MM.YYYY') || '.',
        status = CASE WHEN v_task_status = 'cancelled' THEN 'pending'::task_status ELSE v_task_status END,
        start_date = v_deadline,
        deadline = v_deadline,
        updated_at = now()
      WHERE id = v_task_id;
      v_synced := v_synced + 1;
    ELSIF v_completed_exists = false THEN
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
        rec.id,
        v_assignee,
        'transport_cost',
        'Внести стоимость транспорта: ' || COALESCE(rec.name, 'Машина'),
        'Укажите транспортный расход для машины ' || COALESCE(rec.name, 'Машина') || '. Плановая отгрузка: ' || to_char(v_shipping_date, 'DD.MM.YYYY') || '.',
        'pending',
        v_deadline,
        v_deadline
      )
      ON CONFLICT (machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL AND status IN ('pending','in_progress') DO NOTHING;
      v_synced := v_synced + 1;
    END IF;
  END LOOP;

  RETURN v_synced;
END;
$$;

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
    ON CONFLICT (machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL AND status IN ('pending','in_progress')
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
