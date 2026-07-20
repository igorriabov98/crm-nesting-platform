-- People-planning progress is independent for every leaf section. The existing
-- production tables remain read-only to this module.

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
  v_slots integer;
  v_requested_slot bigint;
  v_section_slot bigint;
  v_employee_slot bigint;
  v_start_slot bigint;
  v_slot bigint;
  v_work_date date;
  v_half smallint;
  v_section_lock bigint;
  v_employee_lock bigint;
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

  v_section_lock := hashtextextended('people-section:' || p_section_id::text, 0);
  v_employee_lock := hashtextextended('people-employee:' || p_employee_id::text, 0);
  PERFORM pg_advisory_xact_lock(least(v_section_lock, v_employee_lock));
  IF v_section_lock <> v_employee_lock THEN
    PERFORM pg_advisory_xact_lock(greatest(v_section_lock, v_employee_lock));
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
    SELECT 1 FROM public.production_fact_sections s
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
      AND status = 'confirmed'::public.employee_assignment_status;
  v_remaining_kg := greatest(COALESCE(v_total_kg, 0) - v_confirmed_kg, 0);
  IF v_remaining_kg <= 0 THEN
    RAISE EXCEPTION 'Machine section has no remaining weight to plan';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_assignments
    WHERE machine_id = p_machine_id
      AND section_id = p_section_id
      AND status = 'pending'::public.employee_assignment_status
  ) THEN
    RAISE EXCEPTION 'Machine section already has pending people planning suggestions';
  END IF;
  v_slots := ceil(v_remaining_kg / (v_rate / 2))::integer;

  v_requested_slot := (p_start_date - DATE '1970-01-01')::bigint * 2 + (p_start_half - 1);
  SELECT COALESCE(max((work_date - DATE '1970-01-01')::bigint * 2 + (half - 1)) + 1, v_requested_slot)
    INTO v_section_slot
    FROM public.employee_assignments
    WHERE section_id = p_section_id;
  SELECT COALESCE(max((work_date - DATE '1970-01-01')::bigint * 2 + (half - 1)) + 1, v_requested_slot)
    INTO v_employee_slot
    FROM public.employee_assignments
    WHERE employee_id = p_employee_id;
  v_start_slot := greatest(v_requested_slot, v_section_slot, v_employee_slot);

  FOR v_slot IN v_start_slot..(v_start_slot + v_slots - 1) LOOP
    v_work_date := DATE '1970-01-01' + floor(v_slot::numeric / 2)::integer;
    v_half := mod(v_slot, 2)::smallint + 1;
    INSERT INTO public.employee_assignments (
      employee_id, machine_id, section_id, work_date, half,
      status, kg_planned, created_by, updated_by
    ) VALUES (
      p_employee_id, p_machine_id, p_section_id, v_work_date, v_half,
      CASE WHEN v_slot = v_start_slot
        THEN 'confirmed'::public.employee_assignment_status
        ELSE 'pending'::public.employee_assignment_status
      END,
      round(v_rate / 2, 3), auth.uid(), auth.uid()
    );
  END LOOP;

  RETURN QUERY
    SELECT a.*
    FROM public.employee_assignments a
    WHERE a.employee_id = p_employee_id
      AND ((a.work_date - DATE '1970-01-01')::bigint * 2 + (a.half - 1))
          BETWEEN v_start_slot AND v_start_slot + v_slots - 1
    ORDER BY a.work_date, a.half;
END;
$$;

CREATE FUNCTION public.fn_people_copy_previous_day(
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
  SELECT factory_id INTO v_employee_factory
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

  SELECT count(*) INTO v_source_count
    FROM public.employee_assignments
    WHERE employee_id = p_employee_id
      AND work_date = p_target_date - 1;
  IF v_source_count <> 2 THEN
    RAISE EXCEPTION 'Previous day must contain both half-day assignments';
  END IF;

  INSERT INTO public.employee_assignments (
    employee_id, machine_id, section_id, work_date, half,
    status, kg_planned, created_by, updated_by
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
    auth.uid()
  FROM public.employee_assignments source
  WHERE source.employee_id = p_employee_id
    AND source.work_date = p_target_date - 1
  ORDER BY source.half
  ON CONFLICT ON CONSTRAINT employee_assignments_employee_slot_unique
  DO UPDATE SET
    machine_id = EXCLUDED.machine_id,
    section_id = EXCLUDED.section_id,
    status = EXCLUDED.status,
    kg_planned = EXCLUDED.kg_planned,
    updated_by = auth.uid();

  RETURN QUERY
    SELECT assignment.*
    FROM public.employee_assignments assignment
    WHERE assignment.employee_id = p_employee_id
      AND assignment.work_date = p_target_date
    ORDER BY assignment.half;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_people_copy_previous_day(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_copy_previous_day(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.fn_people_schedule_assignment(uuid, uuid, uuid, date, smallint)
  IS 'Schedules remaining machine weight independently for one people-planning section';
COMMENT ON FUNCTION public.fn_people_copy_previous_day(uuid, date)
  IS 'Atomically copies both previous-day half assignments to the target date';
