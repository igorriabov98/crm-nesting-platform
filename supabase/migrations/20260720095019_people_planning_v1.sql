-- Isolated people planning v1. This migration intentionally does not alter
-- existing production tables, policies, triggers, or data.

CREATE TYPE public.employee_assignment_status AS ENUM ('confirmed', 'pending');

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  default_section_id uuid REFERENCES public.production_fact_sections(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE public.employee_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES public.production_fact_sections(id) ON DELETE RESTRICT,
  kg_per_day numeric(12, 3) NOT NULL CHECK (kg_per_day > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_rates_employee_section_unique UNIQUE (employee_id, section_id)
);

CREATE TABLE public.employee_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES public.production_fact_sections(id) ON DELETE RESTRICT,
  work_date date NOT NULL,
  half smallint NOT NULL CHECK (half IN (1, 2)),
  status public.employee_assignment_status NOT NULL DEFAULT 'pending',
  kg_planned numeric(12, 3) NOT NULL CHECK (kg_planned > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT employee_assignments_employee_slot_unique UNIQUE (employee_id, work_date, half)
);

CREATE INDEX employees_factory_active_idx
  ON public.employees(factory_id, active, full_name);
CREATE INDEX employees_default_section_idx
  ON public.employees(default_section_id) WHERE default_section_id IS NOT NULL;
CREATE INDEX employees_user_idx
  ON public.employees(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX employees_created_by_idx
  ON public.employees(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX employees_updated_by_idx
  ON public.employees(updated_by) WHERE updated_by IS NOT NULL;
CREATE INDEX employee_rates_section_active_idx
  ON public.employee_rates(section_id, active);
CREATE INDEX employee_assignments_section_slot_idx
  ON public.employee_assignments(section_id, work_date, half);
CREATE INDEX employee_assignments_machine_status_idx
  ON public.employee_assignments(machine_id, status, work_date, half);
CREATE INDEX employee_assignments_created_by_idx
  ON public.employee_assignments(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX employee_assignments_updated_by_idx
  ON public.employee_assignments(updated_by) WHERE updated_by IS NOT NULL;

CREATE FUNCTION public.people_planning_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.people_planning_validate_employee()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_section record;
BEGIN
  NEW.full_name := btrim(NEW.full_name);

  IF TG_OP = 'UPDATE'
     AND NEW.factory_id IS DISTINCT FROM OLD.factory_id
     AND (
       EXISTS (SELECT 1 FROM public.employee_rates r WHERE r.employee_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.employee_assignments a WHERE a.employee_id = OLD.id)
     ) THEN
    RAISE EXCEPTION 'Employee factory cannot be changed after rates or assignments exist';
  END IF;

  IF NEW.default_section_id IS NOT NULL THEN
    SELECT factory_id, parent_id, is_active, archived_at
      INTO v_section
      FROM public.production_fact_sections
      WHERE id = NEW.default_section_id;

    IF NOT FOUND OR v_section.parent_id IS NULL THEN
      RAISE EXCEPTION 'Default section must be a leaf production fact section';
    END IF;
    IF v_section.factory_id IS DISTINCT FROM NEW.factory_id THEN
      RAISE EXCEPTION 'Default section must belong to the employee factory';
    END IF;
    IF NOT v_section.is_active OR v_section.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Default section must be active';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.people_planning_validate_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_factory uuid;
  v_section record;
BEGIN
  SELECT factory_id INTO v_employee_factory
    FROM public.employees
    WHERE id = NEW.employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  SELECT factory_id, parent_id, is_active, archived_at
    INTO v_section
    FROM public.production_fact_sections
    WHERE id = NEW.section_id;
  IF NOT FOUND OR v_section.parent_id IS NULL THEN
    RAISE EXCEPTION 'Rate section must be a leaf production fact section';
  END IF;
  IF v_section.factory_id IS DISTINCT FROM v_employee_factory THEN
    RAISE EXCEPTION 'Employee and rate section must belong to the same factory';
  END IF;
  IF NOT v_section.is_active OR v_section.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Rate section must be active';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.people_planning_validate_assignment()
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

CREATE TRIGGER employees_validate
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_validate_employee();
CREATE TRIGGER employees_touch_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_touch_updated_at();
CREATE TRIGGER employee_rates_validate
  BEFORE INSERT OR UPDATE ON public.employee_rates
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_validate_rate();
CREATE TRIGGER employee_rates_touch_updated_at
  BEFORE UPDATE ON public.employee_rates
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_touch_updated_at();
CREATE TRIGGER employee_assignments_validate
  BEFORE INSERT OR UPDATE ON public.employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_validate_assignment();
CREATE TRIGGER employee_assignments_touch_updated_at
  BEFORE UPDATE ON public.employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.people_planning_touch_updated_at();

CREATE FUNCTION public.fn_people_schedule_assignment(
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
      AND status = 'confirmed'::public.employee_assignment_status;
  v_remaining_kg := greatest(COALESCE(v_total_kg, 0) - v_confirmed_kg, 0);
  IF v_remaining_kg <= 0 THEN
    RAISE EXCEPTION 'Machine has no remaining weight to plan';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.employee_assignments
    WHERE machine_id = p_machine_id
      AND status = 'pending'::public.employee_assignment_status
  ) THEN
    RAISE EXCEPTION 'Machine already has pending people planning suggestions';
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

CREATE FUNCTION public.fn_people_confirm_assignment(p_assignment_id uuid)
RETURNS public.employee_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role public.user_role;
  v_actor_factory uuid;
  v_factory uuid;
  v_result public.employee_assignments;
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

  SELECT e.factory_id INTO v_factory
    FROM public.employee_assignments a
    JOIN public.employees e ON e.id = a.employee_id
    WHERE a.id = p_assignment_id
    FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;
  IF v_role = 'production_manager'::public.user_role
     AND v_factory IS DISTINCT FROM v_actor_factory THEN
    RAISE EXCEPTION 'Production manager can confirm only own factory';
  END IF;

  UPDATE public.employee_assignments
    SET status = 'confirmed'::public.employee_assignment_status,
        updated_by = auth.uid()
    WHERE id = p_assignment_id
    RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY employees_select ON public.employees
  FOR SELECT TO authenticated
  USING (
    (select public.is_director())
    OR ((select public.get_user_role()) = 'production_manager'::public.user_role
        AND factory_id = (select public.get_user_factory_id()))
  );
CREATE POLICY employees_insert ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (
    (select public.is_director())
    OR ((select public.get_user_role()) = 'production_manager'::public.user_role
        AND factory_id = (select public.get_user_factory_id()))
  );
CREATE POLICY employees_update ON public.employees
  FOR UPDATE TO authenticated
  USING (
    (select public.is_director())
    OR ((select public.get_user_role()) = 'production_manager'::public.user_role
        AND factory_id = (select public.get_user_factory_id()))
  )
  WITH CHECK (
    (select public.is_director())
    OR ((select public.get_user_role()) = 'production_manager'::public.user_role
        AND factory_id = (select public.get_user_factory_id()))
  );

CREATE POLICY employee_rates_select ON public.employee_rates
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_rates.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  );
CREATE POLICY employee_rates_insert ON public.employee_rates
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_rates.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  );
CREATE POLICY employee_rates_update ON public.employee_rates
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_rates.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_rates.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  );

CREATE POLICY employee_assignments_select ON public.employee_assignments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_assignments.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  );
CREATE POLICY employee_assignments_insert ON public.employee_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_assignments.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  );
CREATE POLICY employee_assignments_update ON public.employee_assignments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_assignments.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.employees e
      WHERE e.id = employee_assignments.employee_id
        AND ((select public.is_director())
          OR ((select public.get_user_role()) = 'production_manager'::public.user_role
              AND e.factory_id = (select public.get_user_factory_id())))
    )
  );

REVOKE ALL ON TABLE public.employees FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employee_rates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employee_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.employees, public.employee_rates, public.employee_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.employees, public.employee_rates, public.employee_assignments TO service_role;

REVOKE ALL ON FUNCTION public.people_planning_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.people_planning_validate_employee() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.people_planning_validate_rate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.people_planning_validate_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_people_schedule_assignment(uuid, uuid, uuid, date, smallint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_people_confirm_assignment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_people_schedule_assignment(uuid, uuid, uuid, date, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_people_confirm_assignment(uuid) TO authenticated;

COMMENT ON TABLE public.employees IS 'Isolated v1 production people planning employee directory';
COMMENT ON TABLE public.employee_rates IS 'Employee output rates by leaf production fact section';
COMMENT ON TABLE public.employee_assignments IS 'Half-day people planning slots; does not affect production facts or stages';
