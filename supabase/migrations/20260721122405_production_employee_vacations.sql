-- Vacation periods for production employees. Active vacations and active
-- people-planning assignments are mutually exclusive for the same date.

CREATE TABLE public.employee_vacations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 500),
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT employee_vacations_date_order CHECK (end_date >= start_date)
);

CREATE INDEX employee_vacations_employee_period_idx
  ON public.employee_vacations(employee_id, start_date, end_date)
  WHERE cancelled_at IS NULL;
CREATE INDEX employee_vacations_created_by_idx
  ON public.employee_vacations(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX employee_vacations_updated_by_idx
  ON public.employee_vacations(updated_by) WHERE updated_by IS NOT NULL;

CREATE FUNCTION public.people_planning_validate_vacation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_active boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('people-employee-availability:' || NEW.employee_id::text, 0)
  );

  -- Cancellation keeps the immutable vacation history and must remain
  -- possible after an employee has been deactivated.
  IF TG_OP = 'UPDATE'
     AND OLD.cancelled_at IS NULL
     AND NEW.cancelled_at IS NOT NULL
     AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id
     AND NEW.start_date IS NOT DISTINCT FROM OLD.start_date
     AND NEW.end_date IS NOT DISTINCT FROM OLD.end_date
     AND NEW.note IS NOT DISTINCT FROM OLD.note THEN
    RETURN NEW;
  END IF;

  SELECT active
    INTO v_employee_active
    FROM public.employees
    WHERE id = NEW.employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;
  IF NOT v_employee_active THEN
    RAISE EXCEPTION 'Vacation employee must be active';
  END IF;

  NEW.note := nullif(btrim(NEW.note), '');

  IF NEW.cancelled_at IS NULL AND EXISTS (
    SELECT 1
    FROM public.employee_vacations vacation
    WHERE vacation.employee_id = NEW.employee_id
      AND vacation.cancelled_at IS NULL
      AND vacation.id IS DISTINCT FROM NEW.id
      AND vacation.start_date <= NEW.end_date
      AND vacation.end_date >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'Employee vacation overlaps existing vacation';
  END IF;

  IF NEW.cancelled_at IS NULL AND EXISTS (
    SELECT 1
    FROM public.employee_assignments assignment
    WHERE assignment.employee_id = NEW.employee_id
      AND assignment.cancelled_at IS NULL
      AND assignment.work_date BETWEEN NEW.start_date AND NEW.end_date
  ) THEN
    RAISE EXCEPTION 'Employee has assignments in vacation period';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER employee_vacations_validate
  BEFORE INSERT OR UPDATE ON public.employee_vacations
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_validate_vacation();
CREATE TRIGGER employee_vacations_touch_updated_at
  BEFORE UPDATE ON public.employee_vacations
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_touch_updated_at();

-- Reuse the existing assignment invariant and extend it with employee
-- availability. Every assignment path (single slot, full day, copy and edit)
-- passes through this trigger.
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended('people-employee-availability:' || NEW.employee_id::text, 0)
  );
  IF NEW.cancelled_at IS NULL AND EXISTS (
    SELECT 1
    FROM public.employee_vacations vacation
    WHERE vacation.employee_id = NEW.employee_id
      AND vacation.cancelled_at IS NULL
      AND NEW.work_date BETWEEN vacation.start_date AND vacation.end_date
  ) THEN
    RAISE EXCEPTION 'Employee is on vacation for selected date';
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

CREATE FUNCTION public.fn_people_vacations_period(
  p_factory_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS SETOF public.employee_vacations
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
    SELECT vacation.*
    FROM public.employee_vacations vacation
    JOIN public.employees employee ON employee.id = vacation.employee_id
    WHERE employee.factory_id = p_factory_id
      AND vacation.cancelled_at IS NULL
      AND vacation.start_date <= p_end_date
      AND vacation.end_date >= p_start_date
    ORDER BY vacation.start_date, employee.full_name;
END;
$$;

ALTER TABLE public.employee_vacations ENABLE ROW LEVEL SECURITY;

CREATE POLICY employee_vacations_select ON public.employee_vacations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = employee_vacations.employee_id
        AND (
          (select public.is_director())
          OR (
            (select public.get_user_role()) = 'production_manager'::public.user_role
            AND employee.factory_id = (select public.get_user_factory_id())
          )
        )
    )
  );

CREATE POLICY employee_vacations_insert ON public.employee_vacations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = employee_vacations.employee_id
        AND (
          (select public.is_director())
          OR (
            (select public.get_user_role()) = 'production_manager'::public.user_role
            AND employee.factory_id = (select public.get_user_factory_id())
          )
        )
    )
  );

CREATE POLICY employee_vacations_update ON public.employee_vacations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = employee_vacations.employee_id
        AND (
          (select public.is_director())
          OR (
            (select public.get_user_role()) = 'production_manager'::public.user_role
            AND employee.factory_id = (select public.get_user_factory_id())
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = employee_vacations.employee_id
        AND (
          (select public.is_director())
          OR (
            (select public.get_user_role()) = 'production_manager'::public.user_role
            AND employee.factory_id = (select public.get_user_factory_id())
          )
        )
    )
  );

REVOKE ALL ON TABLE public.employee_vacations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.employee_vacations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.employee_vacations TO service_role;
REVOKE ALL ON FUNCTION public.fn_people_vacations_period(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_vacations_period(uuid, date, date) TO authenticated;

COMMENT ON TABLE public.employee_vacations
  IS 'Vacation date ranges for production employees; cancellation preserves history';
COMMENT ON COLUMN public.employee_vacations.cancelled_at
  IS 'Marks a vacation as cancelled without deleting its history';
COMMENT ON FUNCTION public.people_planning_validate_vacation()
  IS 'Prevents overlapping vacations and vacations over active assignments';
COMMENT ON FUNCTION public.fn_people_vacations_period(uuid, date, date)
  IS 'Returns active employee vacations overlapping one authorized planning period';
