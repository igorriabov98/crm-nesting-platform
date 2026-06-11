CREATE OR REPLACE FUNCTION fn_cleanup_machine_agenda_references(p_machine_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_deleted_agenda_count integer := 0;
  v_deleted_pool_count integer := 0;
BEGIN
  IF p_machine_id IS NULL THEN
    RETURN 0;
  END IF;

  DELETE FROM meeting_agenda_items agenda
  WHERE agenda.auto_generated = true
    AND agenda.resolved_at IS NULL
    AND (
      agenda.machine_id = p_machine_id
      OR (
        agenda.source_key IS NOT NULL
        AND position(p_machine_id::text in agenda.source_key) > 0
      )
    );

  GET DIAGNOSTICS v_deleted_agenda_count = ROW_COUNT;

  DELETE FROM meeting_agenda_pool_items pool
  WHERE pool.machine_id = p_machine_id
    OR (
      pool.source_key IS NOT NULL
      AND position(p_machine_id::text in pool.source_key) > 0
    );

  GET DIAGNOSTICS v_deleted_pool_count = ROW_COUNT;

  RETURN v_deleted_agenda_count + v_deleted_pool_count;
END;
$function$;

CREATE OR REPLACE FUNCTION fn_cleanup_stale_auto_agenda_items()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_deleted_agenda_count integer := 0;
  v_deleted_pool_count integer := 0;
BEGIN
  DELETE FROM meeting_agenda_items agenda
  WHERE agenda.auto_generated = true
    AND agenda.resolved_at IS NULL
    AND (
      (
        agenda.machine_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM machines m
          WHERE m.id = agenda.machine_id
            AND COALESCE(m.is_archived, false) = false
        )
      )
      OR (
        agenda.source_type IN (
          'sales_machine_unconfirmed',
          'machine_without_factory',
          'material_undefined',
          'overdue_production',
          'factory_new_machine',
          'factory_missing_material_date',
          'factory_missing_stage_plan_dates',
          'factory_material_late',
          'factory_ready_without_actual_shipping',
          'factory_shipping_this_week',
          'factory_shipping_later_than_desired',
          'tech_material_delivery_14_days',
          'tech_non_standard_this_week'
        )
        AND agenda.source_key IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM machines m
          WHERE COALESCE(m.is_archived, false) = false
            AND position(m.id::text in agenda.source_key) > 0
        )
      )
    );

  GET DIAGNOSTICS v_deleted_agenda_count = ROW_COUNT;

  DELETE FROM meeting_agenda_pool_items pool
  WHERE (
      pool.machine_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM machines m
        WHERE m.id = pool.machine_id
          AND COALESCE(m.is_archived, false) = false
      )
    )
    OR (
      pool.source_type IN ('machine_without_factory', 'material_undefined', 'overdue_production')
      AND pool.source_key IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM machines m
        WHERE COALESCE(m.is_archived, false) = false
          AND position(m.id::text in pool.source_key) > 0
      )
    );

  GET DIAGNOSTICS v_deleted_pool_count = ROW_COUNT;

  RETURN v_deleted_agenda_count + v_deleted_pool_count;
END;
$function$;

CREATE OR REPLACE FUNCTION fn_refresh_meeting_agenda_pool()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_new_count integer;
  v_nearest_tech_meeting_id uuid;
BEGIN
  PERFORM fn_cleanup_stale_auto_agenda_items();

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
    )
    DELETE FROM meeting_agenda_items agenda
    USING candidates candidate
    WHERE agenda.auto_generated = true
      AND agenda.resolved_at IS NULL
      AND agenda.meeting_id <> v_nearest_tech_meeting_id
      AND agenda.source_key IN (candidate.source_key, 'pool:' || candidate.source_key);

    WITH candidates AS (
      SELECT
        'material_undefined:' || m.id::text AS source_key,
        'material_undefined'::text AS source_type,
        m.id AS machine_id
      FROM machines m
      WHERE m.material_type = 'undefined'
        AND m.status NOT IN ('shipped')
        AND COALESCE(m.is_archived, false) = false
    )
    UPDATE meeting_agenda_items agenda
    SET
      source_key = candidate.source_key,
      source_type = candidate.source_type
    FROM candidates candidate
    WHERE agenda.meeting_id = v_nearest_tech_meeting_id
      AND agenda.source_key = 'pool:' || candidate.source_key
      AND NOT EXISTS (
        SELECT 1
        FROM meeting_agenda_items existing
        WHERE existing.meeting_id = agenda.meeting_id
          AND existing.source_key = candidate.source_key
      );

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
      WHERE agenda.resolved_at IS NOT NULL
        OR agenda.meeting_id = v_nearest_tech_meeting_id
      ORDER BY candidate.source_key, agenda.resolved_at DESC NULLS LAST, agenda.created_at DESC
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
      WHERE pool.status IN ('new', 'assigned')
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
      AND pool.status IN ('new', 'assigned');
  END IF;

  SELECT count(*)
  INTO v_new_count
  FROM meeting_agenda_pool_items
  WHERE status = 'new';

  RETURN v_new_count;
END;
$function$;

CREATE OR REPLACE FUNCTION fn_delete_machine_with_inventory_cleanup(
  p_machine_id uuid,
  p_performed_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role user_role;
  v_reservation record;
  v_deleted_id uuid;
BEGIN
  IF p_machine_id IS NULL THEN
    RAISE EXCEPTION 'Machine id is required';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_performed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete machine on behalf of another user';
  END IF;

  SELECT role INTO v_role
  FROM users
  WHERE id = auth.uid();

  IF v_role NOT IN ('financial_director', 'commercial_director', 'planning_director') THEN
    RAISE EXCEPTION 'Only directors can delete machines';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM machines WHERE id = p_machine_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Machine not found or already deleted';
  END IF;

  PERFORM fn_cleanup_machine_agenda_references(p_machine_id);

  FOR v_reservation IN
    SELECT id
    FROM inventory_reservations
    WHERE machine_id = p_machine_id
  LOOP
    PERFORM fn_unreserve_inventory_reservation(
      v_reservation.id,
      p_performed_by,
      'Unreserve stock before machine deletion'
    );
  END LOOP;

  UPDATE inventory_transactions
  SET machine_id = NULL
  WHERE machine_id = p_machine_id;

  DELETE FROM machines
  WHERE id = p_machine_id
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'Machine not found or already deleted';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION fn_cleanup_machine_agenda_references(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_cleanup_machine_agenda_references(uuid) TO authenticated;

REVOKE ALL ON FUNCTION fn_cleanup_stale_auto_agenda_items() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_cleanup_stale_auto_agenda_items() TO authenticated;

REVOKE ALL ON FUNCTION fn_delete_machine_with_inventory_cleanup(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_delete_machine_with_inventory_cleanup(uuid, uuid) TO authenticated;

SELECT fn_cleanup_stale_auto_agenda_items();
SELECT fn_refresh_meeting_agenda_pool();
