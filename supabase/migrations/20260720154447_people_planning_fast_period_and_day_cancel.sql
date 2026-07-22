-- Fast, permission-aware period reads for the people-planning board and
-- history-preserving clearing of both half-day slots for one employee day.

-- Cancelling a historical row must remain possible after its employee or
-- section has been deactivated. Reactivating or changing an assignment still
-- passes through the complete validation below.
CREATE OR REPLACE FUNCTION public.people_planning_validate_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee record;
  v_machine_factory uuid;
  v_section record;
  v_rate numeric(12, 3);
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.cancelled_at IS NULL
     AND NEW.cancelled_at IS NOT NULL
     AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id
     AND NEW.machine_id IS NOT DISTINCT FROM OLD.machine_id
     AND NEW.section_id IS NOT DISTINCT FROM OLD.section_id
     AND NEW.work_date IS NOT DISTINCT FROM OLD.work_date
     AND NEW.half IS NOT DISTINCT FROM OLD.half
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.kg_planned IS NOT DISTINCT FROM OLD.kg_planned THEN
    RETURN NEW;
  END IF;

  SELECT factory_id, active
    INTO v_employee
    FROM public.employees
    WHERE id = NEW.employee_id;
  IF NOT FOUND OR NOT v_employee.active THEN
    RAISE EXCEPTION 'Assignment employee must be active';
  END IF;

  SELECT factory_id INTO v_machine_factory
    FROM public.machines
    WHERE id = NEW.machine_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment machine not found';
  END IF;

  SELECT factory_id, parent_id, is_active, archived_at
    INTO v_section
    FROM public.production_fact_sections
    WHERE id = NEW.section_id;
  IF NOT FOUND OR v_section.parent_id IS NULL THEN
    RAISE EXCEPTION 'Assignment section must be a leaf production fact section';
  END IF;
  IF NOT v_section.is_active OR v_section.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Assignment section must be active';
  END IF;
  IF v_employee.factory_id IS DISTINCT FROM v_machine_factory
     OR v_employee.factory_id IS DISTINCT FROM v_section.factory_id THEN
    RAISE EXCEPTION 'Employee, machine and section must belong to the same factory';
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.section_id IS DISTINCT FROM OLD.section_id THEN
    SELECT kg_per_day INTO v_rate
      FROM public.employee_rates
      WHERE employee_id = NEW.employee_id
        AND section_id = NEW.section_id
        AND active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Active employee rate for the selected section not found';
    END IF;
    NEW.kg_planned := round(v_rate / 2, 3);
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.fn_people_planning_period(
  p_factory_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS SETOF public.employee_assignments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
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
  IF p_start_date IS NULL
     OR p_end_date IS NULL
     OR p_end_date < p_start_date
     OR p_end_date - p_start_date > 6 THEN
    RAISE EXCEPTION 'People planning period must contain from 1 to 7 days';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND p_factory_id IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can view only own factory';
  END IF;

  RETURN QUERY
    SELECT assignment.*
    FROM public.employee_assignments assignment
    JOIN public.employees employee ON employee.id = assignment.employee_id
    WHERE employee.factory_id = p_factory_id
      AND assignment.work_date BETWEEN p_start_date AND p_end_date
      AND assignment.cancelled_at IS NULL
    ORDER BY assignment.work_date, assignment.half, employee.full_name;
END;
$$;

CREATE FUNCTION public.fn_people_cancel_employee_day(
  p_employee_id uuid,
  p_work_date date
)
RETURNS SETOF public.employee_assignments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_employee_factory uuid;
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended('people-employee-day:' || p_employee_id::text || ':' || p_work_date::text, 0)
  );

  SELECT factory_id
    INTO v_employee_factory
    FROM public.employees
    WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_employee_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can clear only own factory';
  END IF;

  RETURN QUERY
    UPDATE public.employee_assignments assignment
    SET cancelled_at = now(),
        updated_by = auth.uid()
    WHERE assignment.employee_id = p_employee_id
      AND assignment.work_date = p_work_date
      AND assignment.cancelled_at IS NULL
    RETURNING assignment.*;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_people_planning_period(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_people_cancel_employee_day(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_planning_period(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_people_cancel_employee_day(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.fn_people_planning_period(uuid, date, date)
  IS 'Returns active people-planning assignments for one authorized factory and a period of at most seven days';
COMMENT ON FUNCTION public.fn_people_cancel_employee_day(uuid, date)
  IS 'Releases every active half-day assignment for one employee day while retaining immutable assignment history';
