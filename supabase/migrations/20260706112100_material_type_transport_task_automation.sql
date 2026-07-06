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
    ON CONFLICT (machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL DO UPDATE
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

CREATE OR REPLACE FUNCTION public.trg_sync_material_type_selection_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'machines' THEN
    IF TG_OP = 'DELETE' THEN
      v_machine_id := OLD.id;
    ELSE
      v_machine_id := NEW.id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_machine_id := OLD.machine_id;
  ELSE
    v_machine_id := NEW.machine_id;
  END IF;

  PERFORM public.fn_sync_material_type_selection_task(v_machine_id);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_material_type_selection_task_machine ON public.machines;
CREATE TRIGGER trg_sync_material_type_selection_task_machine
AFTER INSERT OR UPDATE OF is_confirmed, material_type, is_archived ON public.machines
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_material_type_selection_task();

DROP TRIGGER IF EXISTS trg_sync_material_type_selection_task_item ON public.machine_items;
CREATE TRIGGER trg_sync_material_type_selection_task_item
AFTER INSERT OR UPDATE OF is_sample OR DELETE ON public.machine_items
FOR EACH ROW
EXECUTE FUNCTION public.trg_sync_material_type_selection_task();

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
      ON CONFLICT (machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL DO NOTHING;
      v_synced := v_synced + 1;
    END IF;
  END LOOP;

  RETURN v_synced;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-transport-cost-tasks') THEN
    PERFORM cron.unschedule('daily-transport-cost-tasks');
  END IF;
END;
$$;

SELECT cron.schedule(
  'daily-transport-cost-tasks',
  '15 6 * * *',
  $$ SELECT public.fn_sync_due_transport_cost_tasks(); $$
);

SELECT public.fn_sync_due_transport_cost_tasks();
SELECT public.fn_sync_material_type_selection_task(id)
FROM public.machines
WHERE COALESCE(is_archived, false) = false;

SELECT pg_notify('pgrst', 'reload schema');
