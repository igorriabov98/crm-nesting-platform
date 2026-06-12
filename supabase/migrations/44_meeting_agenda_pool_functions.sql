CREATE OR REPLACE FUNCTION fn_refresh_meeting_agenda_pool()
RETURNS integer AS $$
DECLARE
  v_new_count integer;
BEGIN
  CREATE TEMP TABLE tmp_agenda_pool_candidates (
    source_key text PRIMARY KEY,
    source_type text NOT NULL,
    machine_id uuid,
    title text NOT NULL,
    description text
  ) ON COMMIT DROP;

  INSERT INTO tmp_agenda_pool_candidates (source_key, source_type, machine_id, title, description)
  SELECT
    'machine_without_factory:' || m.id::text,
    'machine_without_factory',
    m.id,
    'Назначить завод: ' || m.name,
    CASE
      WHEN m.desired_shipping_date IS NOT NULL THEN
        'Машина без назначенного завода. Желаемая отгрузка: ' || to_char(m.desired_shipping_date, 'DD.MM.YYYY') || '.'
      ELSE
        'Машина без назначенного завода. Нужно определить завод.'
    END
  FROM machines m
  WHERE m.factory_id IS NULL
    AND m.status IN ('created', 'under_review')
    AND COALESCE(m.is_archived, false) = false;

  INSERT INTO tmp_agenda_pool_candidates (source_key, source_type, machine_id, title, description)
  SELECT
    'material_undefined:' || m.id::text,
    'material_undefined',
    m.id,
    'Определить тип материала: ' || m.name,
    'Тип материала не определён.'
  FROM machines m
  WHERE m.material_type = 'undefined'
    AND m.status NOT IN ('shipped')
    AND COALESCE(m.is_archived, false) = false
  ON CONFLICT (source_key) DO NOTHING;

  INSERT INTO tmp_agenda_pool_candidates (source_key, source_type, machine_id, title, description)
  SELECT DISTINCT
    'overdue_production:' || m.id::text,
    'overdue_production',
    m.id,
    'Просрочка производства: ' || m.name,
    'Есть просроченные этапы производства.'
  FROM machines m
  JOIN production_stages ps ON ps.machine_id = m.id
  WHERE ps.date_end IS NULL
    AND ps.is_skipped = false
    AND ps.planned_date_end < CURRENT_DATE
    AND COALESCE(m.is_archived, false) = false
  ON CONFLICT (source_key) DO NOTHING;

  DELETE FROM meeting_agenda_pool_items pool
  WHERE pool.status = 'new'
    AND NOT EXISTS (
      SELECT 1
      FROM tmp_agenda_pool_candidates candidate
      WHERE candidate.source_key = pool.source_key
    );

  INSERT INTO meeting_agenda_pool_items (
    source_key,
    source_type,
    machine_id,
    title,
    description,
    status,
    updated_at
  )
  SELECT
    source_key,
    source_type,
    machine_id,
    title,
    description,
    'new',
    now()
  FROM tmp_agenda_pool_candidates
  ON CONFLICT (source_key) DO UPDATE
  SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    machine_id = EXCLUDED.machine_id,
    updated_at = now()
  WHERE meeting_agenda_pool_items.status = 'new';

  SELECT count(*)
  INTO v_new_count
  FROM meeting_agenda_pool_items
  WHERE status = 'new';

  RETURN v_new_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fn_create_agenda_pool_distribution_tasks()
RETURNS integer AS $$
DECLARE
  v_pool_count integer;
  v_created_count integer := 0;
  v_user record;
BEGIN
  v_pool_count := fn_refresh_meeting_agenda_pool();

  IF v_pool_count = 0 THEN
    RETURN 0;
  END IF;

  FOR v_user IN
    SELECT id
    FROM users
    WHERE role = 'planning_director'
      AND is_active = true
  LOOP
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
      NULL,
      v_user.id,
      'agenda_pool_distribution',
      'Распределить пул повесток к запланированным собраниям',
      'В пуле есть нераспределённые пункты повестки: ' || v_pool_count::text || '. Откройте страницу пула и назначьте пункты на запланированные собрания.',
      'pending',
      CURRENT_DATE,
      CURRENT_DATE
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  RETURN v_created_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
