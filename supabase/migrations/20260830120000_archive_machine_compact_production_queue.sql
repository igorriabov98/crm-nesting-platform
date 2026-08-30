-- Archive a machine and close gaps in the active production queue atomically.
CREATE OR REPLACE FUNCTION public.archive_machine_and_compact_production_queue(
  p_machine_id uuid,
  p_archived_by uuid,
  p_archive_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_machine record;
  v_active_queue_size integer := 0;
BEGIN
  IF p_machine_id IS NULL THEN
    RAISE EXCEPTION 'Не указана машина';
  END IF;

  IF p_archived_by IS NULL THEN
    RAISE EXCEPTION 'Не указан пользователь';
  END IF;

  -- Use the same lock as reorder_machine_production_queue so archive and drag/drop
  -- cannot calculate queue positions concurrently.
  PERFORM pg_advisory_xact_lock(hashtextextended('machine-production-queue', 0));

  SELECT
    m.id,
    m.name,
    m.production_month,
    m.factory_id,
    m.production_workshop,
    m.production_queue_number,
    COALESCE(m.is_archived, false) AS is_archived
  INTO v_machine
  FROM public.machines m
  WHERE m.id = p_machine_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Машина не найдена';
  END IF;

  IF v_machine.is_archived THEN
    RAISE EXCEPTION 'Машина уже архивирована';
  END IF;

  UPDATE public.machines
  SET
    is_archived = true,
    archived_at = now(),
    archived_by = p_archived_by,
    archive_reason = NULLIF(btrim(p_archive_reason), ''),
    updated_at = now()
  WHERE id = p_machine_id;

  UPDATE public.tasks
  SET status = 'cancelled', updated_at = now()
  WHERE machine_id = p_machine_id
    AND status IN ('pending', 'in_progress');

  IF v_machine.production_month IS NOT NULL
     AND v_machine.factory_id IS NOT NULL
     AND v_machine.production_workshop IS NOT NULL THEN
    WITH ranked AS (
      SELECT
        m.id,
        row_number() OVER (
          ORDER BY m.production_queue_number NULLS LAST, m.created_at, m.id
        )::integer AS queue_number
      FROM public.machines m
      WHERE m.production_month = v_machine.production_month
        AND m.factory_id = v_machine.factory_id
        AND m.production_workshop = v_machine.production_workshop
        AND COALESCE(m.is_archived, false) = false
    )
    UPDATE public.machines m
    SET production_queue_number = ranked.queue_number,
        updated_at = now()
    FROM ranked
    WHERE m.id = ranked.id
      AND m.production_queue_number IS DISTINCT FROM ranked.queue_number;

    SELECT count(*)
    INTO v_active_queue_size
    FROM public.machines m
    WHERE m.production_month = v_machine.production_month
      AND m.factory_id = v_machine.factory_id
      AND m.production_workshop = v_machine.production_workshop
      AND COALESCE(m.is_archived, false) = false;
  END IF;

  RETURN jsonb_build_object(
    'machineId', v_machine.id,
    'machineName', v_machine.name,
    'productionMonth', v_machine.production_month,
    'factoryId', v_machine.factory_id,
    'workshop', v_machine.production_workshop,
    'archivedQueueNumber', v_machine.production_queue_number,
    'activeQueueSize', v_active_queue_size
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_machine_and_compact_production_queue(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_machine_and_compact_production_queue(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.archive_machine_and_compact_production_queue(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.archive_machine_and_compact_production_queue(uuid, uuid, text) TO service_role;

-- Repair gaps left by machines archived before this migration. Each active queue
-- is independent by production month, factory, and workshop.
WITH ranked AS (
  SELECT
    m.id,
    row_number() OVER (
      PARTITION BY m.production_month, m.factory_id, m.production_workshop
      ORDER BY m.production_queue_number NULLS LAST, m.created_at, m.id
    )::integer AS queue_number
  FROM public.machines m
  WHERE COALESCE(m.is_archived, false) = false
    AND m.production_month IS NOT NULL
    AND m.factory_id IS NOT NULL
    AND m.production_workshop IS NOT NULL
)
UPDATE public.machines m
SET production_queue_number = ranked.queue_number,
    updated_at = now()
FROM ranked
WHERE m.id = ranked.id
  AND m.production_queue_number IS DISTINCT FROM ranked.queue_number;
