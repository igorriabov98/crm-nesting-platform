CREATE OR REPLACE FUNCTION fn_refresh_meeting_agenda_pool()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_new_count integer;
  v_nearest_tech_meeting_id uuid;
BEGIN
  WITH candidates AS (
    SELECT
      'machine_without_factory:' || m.id::text AS source_key,
      'machine_without_factory'::text AS source_type,
      m.id AS machine_id,
      'Назначить завод: ' || m.name AS title,
      CASE
        WHEN m.desired_shipping_date IS NOT NULL THEN
          'Машина без назначенного завода. Желаемая отгрузка: ' || to_char(m.desired_shipping_date, 'DD.MM.YYYY') || '.'
        ELSE
          'Машина без назначенного завода. Нужно определить завод.'
      END AS description
    FROM machines m
    WHERE m.factory_id IS NULL
      AND m.status IN ('created', 'under_review')
      AND COALESCE(m.is_archived, false) = false

    UNION ALL

    SELECT
      'material_undefined:' || m.id::text AS source_key,
      'material_undefined'::text AS source_type,
      m.id AS machine_id,
      'Определить тип материала: ' || m.name AS title,
      'Тип материала не определён.' AS description
    FROM machines m
    WHERE m.material_type = 'undefined'
      AND m.status NOT IN ('shipped')
      AND COALESCE(m.is_archived, false) = false

    UNION ALL

    SELECT DISTINCT
      'overdue_production:' || m.id::text AS source_key,
      'overdue_production'::text AS source_type,
      m.id AS machine_id,
      'Просрочка производства: ' || m.name AS title,
      'Есть просроченные этапы производства.' AS description
    FROM machines m
    JOIN production_stages ps ON ps.machine_id = m.id
    WHERE ps.date_end IS NULL
      AND ps.is_skipped = false
      AND ps.planned_date_end < CURRENT_DATE
      AND COALESCE(m.is_archived, false) = false
  )
  DELETE FROM meeting_agenda_pool_items pool
  WHERE pool.status = 'new'
    AND NOT EXISTS (
      SELECT 1
      FROM candidates candidate
      WHERE candidate.source_key = pool.source_key
    );

  WITH candidates AS (
    SELECT
      'machine_without_factory:' || m.id::text AS source_key,
      'machine_without_factory'::text AS source_type,
      m.id AS machine_id,
      'Назначить завод: ' || m.name AS title,
      CASE
        WHEN m.desired_shipping_date IS NOT NULL THEN
          'Машина без назначенного завода. Желаемая отгрузка: ' || to_char(m.desired_shipping_date, 'DD.MM.YYYY') || '.'
        ELSE
          'Машина без назначенного завода. Нужно определить завод.'
      END AS description
    FROM machines m
    WHERE m.factory_id IS NULL
      AND m.status IN ('created', 'under_review')
      AND COALESCE(m.is_archived, false) = false

    UNION ALL

    SELECT
      'material_undefined:' || m.id::text AS source_key,
      'material_undefined'::text AS source_type,
      m.id AS machine_id,
      'Определить тип материала: ' || m.name AS title,
      'Тип материала не определён.' AS description
    FROM machines m
    WHERE m.material_type = 'undefined'
      AND m.status NOT IN ('shipped')
      AND COALESCE(m.is_archived, false) = false

    UNION ALL

    SELECT DISTINCT
      'overdue_production:' || m.id::text AS source_key,
      'overdue_production'::text AS source_type,
      m.id AS machine_id,
      'Просрочка производства: ' || m.name AS title,
      'Есть просроченные этапы производства.' AS description
    FROM machines m
    JOIN production_stages ps ON ps.machine_id = m.id
    WHERE ps.date_end IS NULL
      AND ps.is_skipped = false
      AND ps.planned_date_end < CURRENT_DATE
      AND COALESCE(m.is_archived, false) = false
  )
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
  FROM candidates
  ON CONFLICT (source_key) DO UPDATE
  SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    machine_id = EXCLUDED.machine_id,
    updated_at = now()
  WHERE meeting_agenda_pool_items.status = 'new';

  SELECT id
  INTO v_nearest_tech_meeting_id
  FROM meetings
  WHERE status = 'planned'
    AND meeting_type = 'tech_engineer_supply'
    AND (meeting_date + meeting_time) >= (now() AT TIME ZONE 'Europe/Chisinau')
  ORDER BY meeting_date ASC, meeting_time ASC
  LIMIT 1;

  IF v_nearest_tech_meeting_id IS NOT NULL THEN
    WITH candidates AS (
      SELECT
        'material_undefined:' || m.id::text AS source_key,
        'material_undefined'::text AS source_type,
        m.id AS machine_id,
        'Определить тип материала: ' || m.name AS title,
        'Тип материала не определён.' AS description
      FROM machines m
      WHERE m.material_type = 'undefined'
        AND m.status NOT IN ('shipped')
        AND COALESCE(m.is_archived, false) = false
    ),
    existing_material_agenda AS (
      SELECT DISTINCT ON (candidate.source_key)
        candidate.source_key,
        agenda.meeting_id
      FROM candidates candidate
      JOIN meeting_agenda_items agenda
        ON agenda.source_key IN (candidate.source_key, 'pool:' || candidate.source_key)
      ORDER BY candidate.source_key, agenda.created_at DESC
    ),
    material_candidates AS (
      SELECT
        candidate.*,
        (40 + row_number() OVER (ORDER BY pool.created_at, candidate.source_key))::integer AS sort_order
      FROM candidates candidate
      JOIN meeting_agenda_pool_items pool
        ON pool.source_key = candidate.source_key
      LEFT JOIN existing_material_agenda existing
        ON existing.source_key = candidate.source_key
      WHERE pool.status = 'new'
        AND existing.source_key IS NULL
    ),
    inserted_material_agenda AS (
      INSERT INTO meeting_agenda_items (
        meeting_id,
        machine_id,
        title,
        description,
        auto_generated,
        source_type,
        source_key,
        sort_order
      )
      SELECT
        v_nearest_tech_meeting_id,
        machine_id,
        title,
        description,
        true,
        source_type,
        source_key,
        sort_order
      FROM material_candidates
      ON CONFLICT DO NOTHING
      RETURNING source_key, meeting_id
    ),
    assigned_material_agenda AS (
      SELECT source_key, meeting_id
      FROM inserted_material_agenda
      UNION ALL
      SELECT source_key, meeting_id
      FROM existing_material_agenda
    )
    UPDATE meeting_agenda_pool_items pool
    SET
      status = 'assigned',
      assigned_meeting_id = assigned.meeting_id,
      assigned_at = COALESCE(pool.assigned_at, now()),
      updated_at = now()
    FROM assigned_material_agenda assigned
    WHERE pool.source_key = assigned.source_key
      AND pool.status = 'new';
  END IF;

  SELECT count(*)
  INTO v_new_count
  FROM meeting_agenda_pool_items
  WHERE status = 'new';

  RETURN v_new_count;
END;
$function$;
