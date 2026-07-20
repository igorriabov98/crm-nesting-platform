-- Replace the former cascading suggestion model with exact half-day assignments.
-- Existing pending suggestions are retained as cancelled history instead of being deleted.

ALTER TABLE public.employee_assignments
  ADD COLUMN cancelled_at timestamptz;

UPDATE public.employee_assignments
SET cancelled_at = now(),
    updated_at = now()
WHERE status = 'pending'::public.employee_assignment_status
  AND cancelled_at IS NULL;

CREATE INDEX employee_assignments_active_machine_section_idx
  ON public.employee_assignments(machine_id, section_id, status, work_date, half)
  WHERE cancelled_at IS NULL;

CREATE OR REPLACE FUNCTION public.fn_people_schedule_assignment(
  p_employee_id uuid,
  p_machine_id uuid,
  p_section_id uuid,
  p_start_date date,
  p_start_half smallint DEFAULT 1
)
RETURNS SETOF public.employee_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_factory uuid;
  v_rate numeric(12, 3);
  v_total_kg numeric;
  v_confirmed_kg numeric;
  v_remaining_kg numeric;
  v_employee_slot_lock bigint;
  v_machine_section_lock bigint;
  v_assignment_id uuid;
  v_existing public.employee_assignments%ROWTYPE;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();
  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;
  IF p_start_half NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Half must be 1 or 2';
  END IF;

  v_employee_slot_lock := hashtextextended(
    'people-employee-slot:' || p_employee_id::text || ':' || p_start_date::text || ':' || p_start_half::text,
    0
  );
  v_machine_section_lock := hashtextextended(
    'people-machine-section:' || p_machine_id::text || ':' || p_section_id::text,
    0
  );
  PERFORM pg_advisory_xact_lock(least(v_employee_slot_lock, v_machine_section_lock));
  IF v_employee_slot_lock <> v_machine_section_lock THEN
    PERFORM pg_advisory_xact_lock(greatest(v_employee_slot_lock, v_machine_section_lock));
  END IF;

  SELECT e.factory_id, r.kg_per_day
    INTO v_factory, v_rate
    FROM public.employees e
    JOIN public.employee_rates r
      ON r.employee_id = e.id
     AND r.section_id = p_section_id
     AND r.active
    WHERE e.id = p_employee_id
      AND e.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active employee rate not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can plan only own factory';
  END IF;

  SELECT total_weight * 1000
    INTO v_total_kg
    FROM public.machines_with_totals
    WHERE id = p_machine_id
      AND factory_id = v_factory;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Machine must belong to the employee factory';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.production_fact_sections s
    WHERE s.id = p_section_id
      AND s.factory_id = v_factory
      AND s.parent_id IS NOT NULL
      AND s.is_active
      AND s.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Section must be an active leaf in the employee factory';
  END IF;

  SELECT COALESCE(sum(kg_planned), 0)
    INTO v_confirmed_kg
    FROM public.employee_assignments
    WHERE machine_id = p_machine_id
      AND section_id = p_section_id
      AND status = 'confirmed'::public.employee_assignment_status
      AND cancelled_at IS NULL;
  v_remaining_kg := greatest(COALESCE(v_total_kg, 0) - v_confirmed_kg, 0);
  IF v_remaining_kg <= 0 THEN
    RAISE EXCEPTION 'Machine section has no remaining weight to plan';
  END IF;

  SELECT assignment.*
    INTO v_existing
    FROM public.employee_assignments assignment
    WHERE assignment.employee_id = p_employee_id
      AND assignment.work_date = p_start_date
      AND assignment.half = p_start_half
    FOR UPDATE;

  IF FOUND THEN
    IF v_existing.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'Employee already assigned in selected half-day';
    END IF;

    UPDATE public.employee_assignments
    SET machine_id = p_machine_id,
        section_id = p_section_id,
        status = 'confirmed'::public.employee_assignment_status,
        kg_planned = round(v_rate / 2, 3),
        cancelled_at = NULL,
        updated_by = auth.uid()
    WHERE id = v_existing.id
    RETURNING id INTO v_assignment_id;
  ELSE
    INSERT INTO public.employee_assignments (
      employee_id,
      machine_id,
      section_id,
      work_date,
      half,
      status,
      kg_planned,
      created_by,
      updated_by
    ) VALUES (
      p_employee_id,
      p_machine_id,
      p_section_id,
      p_start_date,
      p_start_half,
      'confirmed'::public.employee_assignment_status,
      round(v_rate / 2, 3),
      auth.uid(),
      auth.uid()
    )
    RETURNING id INTO v_assignment_id;
  END IF;

  RETURN QUERY
    SELECT assignment.*
    FROM public.employee_assignments assignment
    WHERE assignment.id = v_assignment_id;
END;
$$;

CREATE FUNCTION public.fn_people_schedule_full_day(
  p_employee_id uuid,
  p_machine_id uuid,
  p_section_id uuid,
  p_work_date date
)
RETURNS SETOF public.employee_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
    SELECT assignment.*
    FROM public.fn_people_schedule_assignment(
      p_employee_id,
      p_machine_id,
      p_section_id,
      p_work_date,
      1::smallint
    ) assignment;

  RETURN QUERY
    SELECT assignment.*
    FROM public.fn_people_schedule_assignment(
      p_employee_id,
      p_machine_id,
      p_section_id,
      p_work_date,
      2::smallint
    ) assignment;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_people_copy_previous_day(
  p_employee_id uuid,
  p_target_date date
)
RETURNS SETOF public.employee_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_employee_factory uuid;
  v_source_count integer;
BEGIN
  v_role := public.get_user_role();
  v_actor_factory := public.get_user_factory_id();
  IF v_role IS NULL OR v_role NOT IN (
    'financial_director'::public.user_role,
    'commercial_director'::public.user_role,
    'planning_director'::public.user_role,
    'production_manager'::public.user_role
  ) THEN
    RAISE EXCEPTION 'People planning access denied';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('people-employee:' || p_employee_id::text, 0));
  SELECT factory_id
    INTO v_employee_factory
    FROM public.employees
    WHERE id = p_employee_id
      AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active employee not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_employee_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can copy only own factory';
  END IF;

  SELECT count(*)
    INTO v_source_count
    FROM public.employee_assignments
    WHERE employee_id = p_employee_id
      AND work_date = p_target_date - 1
      AND cancelled_at IS NULL;
  IF v_source_count <> 2 THEN
    RAISE EXCEPTION 'Previous day must contain both half-day assignments';
  END IF;

  INSERT INTO public.employee_assignments (
    employee_id,
    machine_id,
    section_id,
    work_date,
    half,
    status,
    kg_planned,
    created_by,
    updated_by,
    cancelled_at
  )
  SELECT
    source.employee_id,
    source.machine_id,
    source.section_id,
    p_target_date,
    source.half,
    source.status,
    source.kg_planned,
    auth.uid(),
    auth.uid(),
    NULL
  FROM public.employee_assignments source
  WHERE source.employee_id = p_employee_id
    AND source.work_date = p_target_date - 1
    AND source.cancelled_at IS NULL
  ORDER BY source.half
  ON CONFLICT ON CONSTRAINT employee_assignments_employee_slot_unique
  DO UPDATE SET
    machine_id = EXCLUDED.machine_id,
    section_id = EXCLUDED.section_id,
    status = EXCLUDED.status,
    kg_planned = EXCLUDED.kg_planned,
    cancelled_at = NULL,
    updated_by = auth.uid();

  RETURN QUERY
    SELECT assignment.*
    FROM public.employee_assignments assignment
    WHERE assignment.employee_id = p_employee_id
      AND assignment.work_date = p_target_date
      AND assignment.cancelled_at IS NULL
    ORDER BY assignment.half;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_people_schedule_assignment(uuid, uuid, uuid, date, smallint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_people_schedule_full_day(uuid, uuid, uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_people_copy_previous_day(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_schedule_assignment(uuid, uuid, uuid, date, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_people_schedule_full_day(uuid, uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_people_copy_previous_day(uuid, date) TO authenticated;

COMMENT ON COLUMN public.employee_assignments.cancelled_at
  IS 'Preserves cancelled legacy suggestions and released assignments without deleting history';
COMMENT ON FUNCTION public.fn_people_schedule_assignment(uuid, uuid, uuid, date, smallint)
  IS 'Creates exactly one confirmed assignment in the requested employee half-day slot';
COMMENT ON FUNCTION public.fn_people_schedule_full_day(uuid, uuid, uuid, date)
  IS 'Atomically creates both confirmed half-day assignments for one employee day';
