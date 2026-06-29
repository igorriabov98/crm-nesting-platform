ALTER TABLE public.production_fact_sections
  ADD COLUMN IF NOT EXISTS production_stage_type public.stage_type NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'production_fact_sections_stage_type_supported'
      AND conrelid = 'public.production_fact_sections'::regclass
  ) THEN
    ALTER TABLE public.production_fact_sections
      ADD CONSTRAINT production_fact_sections_stage_type_supported
      CHECK (
        production_stage_type IS NULL
        OR production_stage_type = 'cutting'::public.stage_type
      );
  END IF;
END $$;

ALTER TABLE public.inventory_reservations
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS consumed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consumed_cutting_event_id uuid NULL;

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'production_cutting_rollback_review';

CREATE TABLE IF NOT EXISTS public.production_fact_cutting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  factory_id uuid REFERENCES public.factories(id) ON DELETE SET NULL,
  fact_id uuid REFERENCES public.production_machine_facts(id) ON DELETE SET NULL,
  section_id uuid REFERENCES public.production_fact_sections(id) ON DELETE SET NULL,
  fact_date date NOT NULL,
  stage_id uuid REFERENCES public.production_stages(id) ON DELETE SET NULL,
  previous_stage_date_start date,
  applied_stage_date_start date,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'rolled_back', 'kept', 'blocked')),
  rollback_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rolled_back_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rolled_back_at timestamptz,
  rollback_comment text,
  kept_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  kept_at timestamptz,
  keep_comment text
);

CREATE UNIQUE INDEX IF NOT EXISTS production_fact_cutting_events_fact_id_unique
  ON public.production_fact_cutting_events(fact_id)
  WHERE fact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS production_fact_cutting_events_machine_status_idx
  ON public.production_fact_cutting_events(machine_id, status, created_at);

CREATE TABLE IF NOT EXISTS public.production_fact_cutting_event_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.production_fact_cutting_events(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.inventory_reservations(id) ON DELETE SET NULL,
  inventory_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE RESTRICT,
  material_variant_id uuid REFERENCES public.material_variants(id) ON DELETE SET NULL,
  request_item_table text NOT NULL,
  request_item_id uuid NOT NULL,
  reserved_quantity numeric NOT NULL,
  reserved_secondary_quantity numeric,
  is_cut_reservation boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS production_fact_cutting_event_reservations_unique
  ON public.production_fact_cutting_event_reservations(event_id, reservation_id)
  WHERE reservation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.production_fact_cutting_event_scrap_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.production_fact_cutting_events(id) ON DELETE CASCADE,
  inventory_id uuid NOT NULL REFERENCES public.inventory(id) ON DELETE RESTRICT,
  previous_business_scrap_state text NOT NULL DEFAULT 'future',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS production_fact_cutting_event_scrap_unique
  ON public.production_fact_cutting_event_scrap_promotions(event_id, inventory_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inventory_reservations_consumed_cutting_event_id_fkey'
      AND conrelid = 'public.inventory_reservations'::regclass
  ) THEN
    ALTER TABLE public.inventory_reservations
      ADD CONSTRAINT inventory_reservations_consumed_cutting_event_id_fkey
      FOREIGN KEY (consumed_cutting_event_id)
      REFERENCES public.production_fact_cutting_events(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_reservations_active_machine_idx
  ON public.inventory_reservations(machine_id, consumed_at)
  WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_apply_production_fact_cutting(
  p_fact_id uuid,
  p_performed_by uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fact record;
  v_effective_stage public.stage_type;
  v_stage public.production_stages%ROWTYPE;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_applied_stage_date date;
  v_promoted_count integer := 0;
BEGIN
  SELECT pmf.*, m.factory_id AS machine_factory_id
  INTO v_fact
  FROM public.production_machine_facts pmf
  JOIN public.machines m ON m.id = pmf.machine_id
  WHERE pmf.id = p_fact_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Факт производства не найден';
  END IF;

  SELECT COALESCE(section.production_stage_type, parent.production_stage_type)
  INTO v_effective_stage
  FROM public.production_fact_sections section
  LEFT JOIN public.production_fact_sections parent ON parent.id = section.parent_id
  WHERE section.id = v_fact.section_id;

  IF v_effective_stage IS DISTINCT FROM 'cutting'::public.stage_type THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_stage
  FROM public.production_stages
  WHERE machine_id = v_fact.machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.production_stages (machine_id, stage_type, workshop, updated_by)
    VALUES (v_fact.machine_id, 'cutting'::public.stage_type, 1, p_performed_by)
    RETURNING * INTO v_stage;
  END IF;

  SELECT id
  INTO v_existing_event_id
  FROM public.production_fact_cutting_events
  WHERE fact_id = p_fact_id
  LIMIT 1;

  IF v_existing_event_id IS NOT NULL THEN
    RETURN v_existing_event_id;
  END IF;

  v_applied_stage_date := COALESCE(v_stage.date_start, v_fact.fact_date);

  INSERT INTO public.production_fact_cutting_events (
    machine_id,
    factory_id,
    fact_id,
    section_id,
    fact_date,
    stage_id,
    previous_stage_date_start,
    applied_stage_date_start,
    created_by
  )
  VALUES (
    v_fact.machine_id,
    v_fact.machine_factory_id,
    v_fact.id,
    v_fact.section_id,
    v_fact.fact_date,
    v_stage.id,
    v_stage.date_start,
    v_applied_stage_date,
    p_performed_by
  )
  RETURNING id INTO v_event_id;

  IF v_stage.date_start IS NULL THEN
    UPDATE public.production_stages
    SET date_start = v_fact.fact_date,
        updated_by = p_performed_by
    WHERE id = v_stage.id;
  END IF;

  INSERT INTO public.production_fact_cutting_event_reservations (
    event_id,
    reservation_id,
    inventory_id,
    material_id,
    material_variant_id,
    request_item_table,
    request_item_id,
    reserved_quantity,
    reserved_secondary_quantity,
    is_cut_reservation
  )
  SELECT
    v_event_id,
    r.id,
    r.inventory_id,
    r.material_id,
    r.material_variant_id,
    r.request_item_table,
    r.request_item_id,
    r.reserved_quantity,
    r.reserved_secondary_quantity,
    COALESCE(r.is_cut_reservation, false)
  FROM public.inventory_reservations r
  WHERE r.machine_id = v_fact.machine_id
    AND r.consumed_at IS NULL;

  WITH normal_reservations AS (
    SELECT
      r.inventory_id,
      SUM(r.reserved_quantity) AS reserved_quantity,
      SUM(COALESCE(r.reserved_secondary_quantity, 0)) AS reserved_secondary_quantity
    FROM public.inventory_reservations r
    WHERE r.machine_id = v_fact.machine_id
      AND r.consumed_at IS NULL
      AND COALESCE(r.is_cut_reservation, false) = false
    GROUP BY r.inventory_id
  )
  UPDATE public.inventory i
  SET total_quantity = GREATEST(i.total_quantity - n.reserved_quantity, 0),
      reserved_quantity = GREATEST(i.reserved_quantity - n.reserved_quantity, 0),
      total_secondary_quantity = CASE
        WHEN i.total_secondary_quantity IS NULL THEN NULL
        ELSE GREATEST(COALESCE(i.total_secondary_quantity, 0) - n.reserved_secondary_quantity, 0)
      END,
      reserved_secondary_quantity = CASE
        WHEN i.reserved_secondary_quantity IS NULL AND n.reserved_secondary_quantity = 0 THEN i.reserved_secondary_quantity
        ELSE GREATEST(COALESCE(i.reserved_secondary_quantity, 0) - n.reserved_secondary_quantity, 0)
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  FROM normal_reservations n
  WHERE i.id = n.inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  SELECT
    i.factory_id,
    r.inventory_id,
    r.material_id,
    r.material_variant_id,
    'write_off'::public.inventory_transaction_type,
    -r.reserved_quantity,
    CASE WHEN r.reserved_secondary_quantity IS NULL THEN NULL ELSE -r.reserved_secondary_quantity END,
    r.machine_id,
    r.request_item_table,
    r.request_item_id,
    p_performed_by,
    'Автоматическое списание по факту заготовки'
  FROM public.inventory_reservations r
  JOIN public.inventory i ON i.id = r.inventory_id
  WHERE r.machine_id = v_fact.machine_id
    AND r.consumed_at IS NULL
    AND COALESCE(r.is_cut_reservation, false) = false;

  UPDATE public.inventory_reservations r
  SET consumed_at = now(),
      consumed_by = p_performed_by,
      consumed_cutting_event_id = v_event_id
  WHERE r.machine_id = v_fact.machine_id
    AND r.consumed_at IS NULL;

  FOR v_fact IN
    SELECT DISTINCT request_item_table, request_item_id
    FROM public.production_fact_cutting_event_reservations
    WHERE event_id = v_event_id
  LOOP
    PERFORM public.fn_set_request_reserved_quantity(v_fact.request_item_table, v_fact.request_item_id);
  END LOOP;

  INSERT INTO public.production_fact_cutting_event_scrap_promotions (
    event_id,
    inventory_id,
    previous_business_scrap_state
  )
  SELECT
    v_event_id,
    i.id,
    i.business_scrap_state
  FROM public.inventory i
  WHERE i.is_business_scrap = true
    AND i.business_scrap_state = 'future'
    AND i.deleted_at IS NULL
    AND i.available_from_stage_id = v_stage.id;

  UPDATE public.inventory i
  SET business_scrap_state = 'available',
      updated_at = now(),
      last_updated_by = p_performed_by
  FROM public.production_fact_cutting_event_scrap_promotions s
  WHERE s.event_id = v_event_id
    AND s.inventory_id = i.id;

  GET DIAGNOSTICS v_promoted_count = ROW_COUNT;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_production_cutting_rollback_preview(
  p_machine_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage public.production_stages%ROWTYPE;
  v_event_count integer := 0;
  v_active_cutting_facts integer := 0;
  v_reservation_count integer := 0;
  v_reservation_quantity numeric := 0;
  v_scrap_count integer := 0;
  v_scrap_reserved_count integer := 0;
  v_scrap_deleted_count integer := 0;
  v_missing_reservation_count integer := 0;
  v_after_date date;
  v_expected_current_date date;
  v_blockers text[] := ARRAY[]::text[];
BEGIN
  SELECT *
  INTO v_stage
  FROM public.production_stages
  WHERE machine_id = p_machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at
  LIMIT 1;

  SELECT COUNT(*)
  INTO v_event_count
  FROM public.production_fact_cutting_events
  WHERE machine_id = p_machine_id
    AND status = 'applied';

  SELECT previous_stage_date_start
  INTO v_after_date
  FROM public.production_fact_cutting_events
  WHERE machine_id = p_machine_id
    AND status = 'applied'
  ORDER BY created_at
  LIMIT 1;

  SELECT applied_stage_date_start
  INTO v_expected_current_date
  FROM public.production_fact_cutting_events
  WHERE machine_id = p_machine_id
    AND status = 'applied'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT COUNT(*)
  INTO v_active_cutting_facts
  FROM public.production_machine_facts pmf
  JOIN public.production_fact_sections section ON section.id = pmf.section_id
  LEFT JOIN public.production_fact_sections parent ON parent.id = section.parent_id
  WHERE pmf.machine_id = p_machine_id
    AND COALESCE(section.production_stage_type, parent.production_stage_type) = 'cutting'::public.stage_type;

  SELECT
    COUNT(*),
    COALESCE(SUM(reserved_quantity), 0)
  INTO v_reservation_count, v_reservation_quantity
  FROM public.production_fact_cutting_event_reservations r
  JOIN public.production_fact_cutting_events e ON e.id = r.event_id
  WHERE e.machine_id = p_machine_id
    AND e.status = 'applied';

  SELECT COUNT(*)
  INTO v_missing_reservation_count
  FROM public.production_fact_cutting_event_reservations r
  JOIN public.production_fact_cutting_events e ON e.id = r.event_id
  LEFT JOIN public.inventory_reservations ir ON ir.id = r.reservation_id
  WHERE e.machine_id = p_machine_id
    AND e.status = 'applied'
    AND r.reservation_id IS NOT NULL
    AND ir.id IS NULL;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE COALESCE(i.reserved_quantity, 0) > 0 OR COALESCE(i.reserved_secondary_quantity, 0) > 0),
    COUNT(*) FILTER (WHERE i.deleted_at IS NOT NULL)
  INTO v_scrap_count, v_scrap_reserved_count, v_scrap_deleted_count
  FROM public.production_fact_cutting_event_scrap_promotions s
  JOIN public.production_fact_cutting_events e ON e.id = s.event_id
  JOIN public.inventory i ON i.id = s.inventory_id
  WHERE e.machine_id = p_machine_id
    AND e.status = 'applied';

  IF v_event_count = 0 THEN
    v_blockers := array_append(v_blockers, 'Нет активных событий списания заготовки');
  END IF;

  IF v_active_cutting_facts > 0 THEN
    v_blockers := array_append(v_blockers, 'По машине еще есть факт заготовки');
  END IF;

  IF v_stage.id IS NULL THEN
    v_blockers := array_append(v_blockers, 'Этап заготовки не найден');
  ELSIF v_expected_current_date IS NOT NULL AND v_stage.date_start IS DISTINCT FROM v_expected_current_date THEN
    v_blockers := array_append(v_blockers, 'Дата старта заготовки уже изменена вручную');
  END IF;

  IF v_missing_reservation_count > 0 THEN
    v_blockers := array_append(v_blockers, 'Часть списанных броней уже удалена');
  END IF;

  IF v_scrap_reserved_count > 0 THEN
    v_blockers := array_append(v_blockers, 'Деловой отход уже зарезервирован или использован');
  END IF;

  IF v_scrap_deleted_count > 0 THEN
    v_blockers := array_append(v_blockers, 'Деловой отход уже удален со склада');
  END IF;

  RETURN jsonb_build_object(
    'canRollback', COALESCE(array_length(v_blockers, 1), 0) = 0,
    'blockers', to_jsonb(v_blockers),
    'eventCount', v_event_count,
    'stage', jsonb_build_object(
      'currentDateStart', v_stage.date_start,
      'afterDateStart', v_after_date
    ),
    'reservations', jsonb_build_object(
      'count', v_reservation_count,
      'quantity', v_reservation_quantity
    ),
    'scrap', jsonb_build_object(
      'count', v_scrap_count,
      'reservedCount', v_scrap_reserved_count,
      'deletedCount', v_scrap_deleted_count
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_apply_production_cutting_rollback(
  p_machine_id uuid,
  p_task_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preview jsonb;
  v_can_rollback boolean;
  v_stage public.production_stages%ROWTYPE;
  v_after_date date;
  v_event_ids uuid[];
  v_restored_reservations integer := 0;
  v_restored_scrap integer := 0;
BEGIN
  v_preview := public.fn_get_production_cutting_rollback_preview(p_machine_id);
  v_can_rollback := COALESCE((v_preview ->> 'canRollback')::boolean, false);

  IF NOT v_can_rollback THEN
    RAISE EXCEPTION 'Откат заблокирован: %', COALESCE(v_preview -> 'blockers', '[]'::jsonb)::text;
  END IF;

  SELECT ARRAY_AGG(id ORDER BY created_at)
  INTO v_event_ids
  FROM public.production_fact_cutting_events
  WHERE machine_id = p_machine_id
    AND status = 'applied';

  SELECT *
  INTO v_stage
  FROM public.production_stages
  WHERE machine_id = p_machine_id
    AND stage_type = 'cutting'::public.stage_type
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  SELECT previous_stage_date_start
  INTO v_after_date
  FROM public.production_fact_cutting_events
  WHERE id = v_event_ids[1];

  WITH normal_reservations AS (
    SELECT
      r.inventory_id,
      SUM(r.reserved_quantity) AS reserved_quantity,
      SUM(COALESCE(r.reserved_secondary_quantity, 0)) AS reserved_secondary_quantity
    FROM public.production_fact_cutting_event_reservations r
    WHERE r.event_id = ANY(v_event_ids)
      AND r.is_cut_reservation = false
    GROUP BY r.inventory_id
  )
  UPDATE public.inventory i
  SET total_quantity = i.total_quantity + n.reserved_quantity,
      reserved_quantity = i.reserved_quantity + n.reserved_quantity,
      total_secondary_quantity = CASE
        WHEN i.total_secondary_quantity IS NULL AND n.reserved_secondary_quantity = 0 THEN i.total_secondary_quantity
        ELSE COALESCE(i.total_secondary_quantity, 0) + n.reserved_secondary_quantity
      END,
      reserved_secondary_quantity = CASE
        WHEN i.reserved_secondary_quantity IS NULL AND n.reserved_secondary_quantity = 0 THEN i.reserved_secondary_quantity
        ELSE COALESCE(i.reserved_secondary_quantity, 0) + n.reserved_secondary_quantity
      END,
      last_updated_by = p_performed_by,
      updated_at = now()
  FROM normal_reservations n
  WHERE i.id = n.inventory_id;

  INSERT INTO public.inventory_transactions (
    factory_id,
    inventory_id,
    material_id,
    material_variant_id,
    transaction_type,
    quantity,
    secondary_quantity,
    machine_id,
    request_item_table,
    request_item_id,
    performed_by,
    comment
  )
  SELECT
    i.factory_id,
    r.inventory_id,
    r.material_id,
    r.material_variant_id,
    'receipt'::public.inventory_transaction_type,
    r.reserved_quantity,
    r.reserved_secondary_quantity,
    p_machine_id,
    r.request_item_table,
    r.request_item_id,
    p_performed_by,
    'Автоматический откат списания заготовки'
  FROM public.production_fact_cutting_event_reservations r
  JOIN public.inventory i ON i.id = r.inventory_id
  WHERE r.event_id = ANY(v_event_ids)
    AND r.is_cut_reservation = false;

  UPDATE public.inventory_reservations ir
  SET consumed_at = NULL,
      consumed_by = NULL,
      consumed_cutting_event_id = NULL
  FROM public.production_fact_cutting_event_reservations er
  WHERE er.event_id = ANY(v_event_ids)
    AND er.reservation_id = ir.id;

  GET DIAGNOSTICS v_restored_reservations = ROW_COUNT;

  PERFORM public.fn_set_request_reserved_quantity(er.request_item_table, er.request_item_id)
  FROM (
    SELECT DISTINCT request_item_table, request_item_id
    FROM public.production_fact_cutting_event_reservations
    WHERE event_id = ANY(v_event_ids)
  ) er;

  UPDATE public.inventory i
  SET business_scrap_state = s.previous_business_scrap_state,
      updated_at = now(),
      last_updated_by = p_performed_by
  FROM public.production_fact_cutting_event_scrap_promotions s
  WHERE s.event_id = ANY(v_event_ids)
    AND s.inventory_id = i.id;

  GET DIAGNOSTICS v_restored_scrap = ROW_COUNT;

  UPDATE public.production_stages
  SET date_start = v_after_date,
      updated_by = p_performed_by
  WHERE id = v_stage.id;

  UPDATE public.production_fact_cutting_events
  SET status = 'rolled_back',
      rolled_back_by = p_performed_by,
      rolled_back_at = now(),
      rollback_comment = p_comment
  WHERE id = ANY(v_event_ids);

  IF p_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET status = 'completed',
        completed_at = now(),
        updated_at = now()
    WHERE id = p_task_id;
  END IF;

  RETURN jsonb_build_object(
    'restoredReservations', v_restored_reservations,
    'restoredScrap', v_restored_scrap,
    'stageDateStart', v_after_date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_keep_production_cutting_rollback(
  p_machine_id uuid,
  p_task_id uuid,
  p_performed_by uuid,
  p_comment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_count integer := 0;
BEGIN
  UPDATE public.production_fact_cutting_events
  SET status = 'kept',
      kept_by = p_performed_by,
      kept_at = now(),
      keep_comment = p_comment
  WHERE machine_id = p_machine_id
    AND status = 'applied';

  GET DIAGNOSTICS v_event_count = ROW_COUNT;

  IF p_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET status = 'completed',
        completed_at = now(),
        updated_at = now(),
        description = CASE
          WHEN p_comment IS NULL OR btrim(p_comment) = '' THEN description
          ELSE COALESCE(description || E'\n\n', '') || 'Откат оставлен без изменений: ' || p_comment
        END
    WHERE id = p_task_id;
  END IF;

  RETURN jsonb_build_object('keptEvents', v_event_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_apply_production_fact_cutting(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_production_cutting_rollback_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_keep_production_cutting_rollback(uuid, uuid, uuid, text) TO authenticated;
