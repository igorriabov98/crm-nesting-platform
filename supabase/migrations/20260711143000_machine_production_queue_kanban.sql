-- Persist Kanban moves as one transaction and create the audit trail/notifications
-- in the same transaction as the queue change.
ALTER TABLE public.machine_updates
  ADD COLUMN IF NOT EXISTS message_kind text NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS system_event_key text;

ALTER TABLE public.machine_updates
  DROP CONSTRAINT IF EXISTS machine_updates_message_kind_check,
  ADD CONSTRAINT machine_updates_message_kind_check
    CHECK (message_kind IN ('user', 'system'));

CREATE INDEX IF NOT EXISTS idx_machine_updates_system_event
  ON public.machine_updates(machine_id, system_event_key, created_at DESC)
  WHERE message_kind = 'system';

CREATE OR REPLACE FUNCTION public.reorder_machine_production_queue(
  p_machine_id uuid,
  p_target_factory_id uuid,
  p_target_workshop smallint,
  p_target_queue_number integer,
  p_changed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_machine_name text;
  v_production_month date;
  v_source_factory_id uuid;
  v_source_factory_name text;
  v_source_workshop smallint;
  v_source_queue integer;
  v_target_factory_name text;
  v_target_queue integer;
  v_target_count integer;
  v_actor_name text;
  v_message text;
BEGIN
  IF p_target_queue_number < 1 THEN
    RAISE EXCEPTION 'Номер очереди должен быть больше нуля';
  END IF;

  -- Queue edits are infrequent; a single transaction lock prevents cross-column
  -- moves from deadlocking while they lock the same two groups in reverse order.
  PERFORM pg_advisory_xact_lock(hashtextextended('machine-production-queue', 0));

  SELECT m.name, m.production_month, m.factory_id, f.name,
         m.production_workshop, m.production_queue_number
    INTO v_machine_name, v_production_month, v_source_factory_id, v_source_factory_name,
         v_source_workshop, v_source_queue
  FROM public.machines m
  LEFT JOIN public.factories f ON f.id = m.factory_id
  WHERE m.id = p_machine_id
    AND COALESCE(m.is_archived, false) = false
  FOR UPDATE OF m;

  IF v_machine_name IS NULL THEN
    RAISE EXCEPTION 'Машина не найдена';
  END IF;
  IF v_production_month IS NULL OR v_source_factory_id IS NULL
     OR v_source_workshop IS NULL OR v_source_queue IS NULL THEN
    RAISE EXCEPTION 'Сначала назначьте машине месяц, завод, цех и очередь';
  END IF;

  SELECT name INTO v_target_factory_name
  FROM public.factories
  WHERE id = p_target_factory_id;

  IF v_target_factory_name IS NULL THEN
    RAISE EXCEPTION 'Целевой завод не найден';
  END IF;

  IF lower(v_target_factory_name) LIKE '%берегово%' THEN
    IF p_target_workshop NOT IN (1, 2) THEN
      RAISE EXCEPTION 'Для Берегово доступны только цеха 1 и 2';
    END IF;
  ELSIF p_target_workshop <> 1 THEN
    RAISE EXCEPTION 'Для этого завода доступен только цех 1';
  END IF;

  -- Serialize changes in both affected groups.
  PERFORM 1
  FROM public.machines m
  WHERE m.production_month = v_production_month
    AND (
      (m.factory_id = v_source_factory_id AND m.production_workshop = v_source_workshop)
      OR
      (m.factory_id = p_target_factory_id AND m.production_workshop = p_target_workshop)
    )
  ORDER BY m.id
  FOR UPDATE;

  -- Close any historical gaps before calculating the requested position.
  WITH ranked AS (
    SELECT m.id,
           row_number() OVER (
             PARTITION BY m.production_month, m.factory_id, m.production_workshop
             ORDER BY m.production_queue_number NULLS LAST, m.created_at, m.id
           )::integer AS queue_number
    FROM public.machines m
    WHERE m.production_month = v_production_month
      AND COALESCE(m.is_archived, false) = false
      AND (
        (m.factory_id = v_source_factory_id AND m.production_workshop = v_source_workshop)
        OR
        (m.factory_id = p_target_factory_id AND m.production_workshop = p_target_workshop)
      )
  )
  UPDATE public.machines m
  SET production_queue_number = ranked.queue_number
  FROM ranked
  WHERE m.id = ranked.id;

  SELECT production_queue_number INTO v_source_queue
  FROM public.machines
  WHERE id = p_machine_id;

  SELECT count(*) INTO v_target_count
  FROM public.machines m
  WHERE m.production_month = v_production_month
    AND m.factory_id = p_target_factory_id
    AND m.production_workshop = p_target_workshop
    AND m.id <> p_machine_id
    AND COALESCE(m.is_archived, false) = false;

  v_target_queue := LEAST(p_target_queue_number, v_target_count + 1);

  IF v_source_factory_id = p_target_factory_id AND v_source_workshop = p_target_workshop THEN
    IF v_target_queue < v_source_queue THEN
      UPDATE public.machines
      SET production_queue_number = production_queue_number + 1
      WHERE production_month = v_production_month
        AND factory_id = v_source_factory_id
        AND production_workshop = v_source_workshop
        AND id <> p_machine_id
        AND production_queue_number >= v_target_queue
        AND production_queue_number < v_source_queue;
    ELSIF v_target_queue > v_source_queue THEN
      UPDATE public.machines
      SET production_queue_number = production_queue_number - 1
      WHERE production_month = v_production_month
        AND factory_id = v_source_factory_id
        AND production_workshop = v_source_workshop
        AND id <> p_machine_id
        AND production_queue_number > v_source_queue
        AND production_queue_number <= v_target_queue;
    END IF;
  ELSE
    UPDATE public.machines
    SET production_queue_number = production_queue_number - 1
    WHERE production_month = v_production_month
      AND factory_id = v_source_factory_id
      AND production_workshop = v_source_workshop
      AND id <> p_machine_id
      AND production_queue_number > v_source_queue;

    UPDATE public.machines
    SET production_queue_number = production_queue_number + 1
    WHERE production_month = v_production_month
      AND factory_id = p_target_factory_id
      AND production_workshop = p_target_workshop
      AND id <> p_machine_id
      AND production_queue_number >= v_target_queue;
  END IF;

  UPDATE public.machines
  SET factory_id = p_target_factory_id,
      production_workshop = p_target_workshop,
      production_queue_number = v_target_queue,
      updated_at = now()
  WHERE id = p_machine_id;

  SELECT full_name INTO v_actor_name FROM public.users WHERE id = p_changed_by;
  v_actor_name := COALESCE(v_actor_name, 'Пользователь CRM');
  v_message := format(
    'Очередь производства изменена. Было: %s · Цех %s · Очередь %s. Стало: %s · Цех %s · Очередь %s. Изменил: %s.',
    COALESCE(v_source_factory_name, 'Без завода'), v_source_workshop, v_source_queue,
    v_target_factory_name, p_target_workshop, v_target_queue, v_actor_name
  );

  INSERT INTO public.machine_updates (
    machine_id, body, created_by, updated_by, message_kind, system_event_key
  ) VALUES (
    p_machine_id, v_message, p_changed_by, p_changed_by, 'system',
    'production_queue_changed:' || gen_random_uuid()::text
  );

  INSERT INTO public.notifications (user_id, type, title, message, related_machine_id)
  SELECT DISTINCT u.id, 'production_queue_changed',
         'Изменена очередь производства', v_message, p_machine_id
  FROM public.users u
  WHERE u.is_active = true
    AND (
      u.role IN (
        'financial_director'::public.user_role,
        'engineer'::public.user_role,
        'technologist'::public.user_role,
        'supply_manager'::public.user_role,
        'production_manager'::public.user_role
      )
      OR EXISTS (
        SELECT 1
        FROM public.department_members dm
        JOIN public.departments d ON d.id = dm.department_id AND d.is_active = true
        LEFT JOIN public.departments parent ON parent.id = d.parent_id AND parent.is_active = true
        LEFT JOIN public.positions pos ON pos.id = dm.position_id
        WHERE dm.user_id = u.id
          AND lower(concat_ws(' ', d.name, parent.name, pos.name)) ~
            '(снаб|закуп|постач|supply|procurement|purchase|инженер|конструкт|engineer|технолог|technolog|производ|production)'
      )
    );

  RETURN jsonb_build_object(
    'machineId', p_machine_id,
    'machineName', v_machine_name,
    'productionMonth', v_production_month,
    'before', jsonb_build_object(
      'factoryId', v_source_factory_id,
      'factoryName', v_source_factory_name,
      'workshop', v_source_workshop,
      'queueNumber', v_source_queue
    ),
    'after', jsonb_build_object(
      'factoryId', p_target_factory_id,
      'factoryName', v_target_factory_name,
      'workshop', p_target_workshop,
      'queueNumber', v_target_queue
    ),
    'message', v_message
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_machine_production_queue(uuid, uuid, smallint, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reorder_machine_production_queue(uuid, uuid, smallint, integer, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reorder_machine_production_queue(uuid, uuid, smallint, integer, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_machine_production_queue(uuid, uuid, smallint, integer, uuid) TO service_role;
