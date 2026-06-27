DO $$
BEGIN
  CREATE TYPE public.production_fact_shift AS ENUM ('day', 'night');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS public.production_fact_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.production_fact_sections(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.production_machine_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  fact_date date NOT NULL,
  shift public.production_fact_shift NOT NULL,
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES public.production_fact_sections(id) ON DELETE RESTRICT,
  comment text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_machine_facts_unique_scope UNIQUE (factory_id, fact_date, shift, machine_id, section_id)
);

CREATE TABLE IF NOT EXISTS public.production_tonnage_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id uuid NOT NULL REFERENCES public.factories(id) ON DELETE CASCADE,
  fact_date date NOT NULL,
  section_id uuid NOT NULL REFERENCES public.production_fact_sections(id) ON DELETE RESTRICT,
  tonnage numeric(12, 3) NOT NULL DEFAULT 0 CHECK (tonnage >= 0),
  comment text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_tonnage_facts_unique_scope UNIQUE (factory_id, fact_date, section_id)
);

CREATE INDEX IF NOT EXISTS production_fact_sections_factory_idx
  ON public.production_fact_sections(factory_id, parent_id, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS production_fact_sections_active_name_idx
  ON public.production_fact_sections(
    factory_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(btrim(name))
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS production_machine_facts_day_idx
  ON public.production_machine_facts(factory_id, fact_date);

CREATE INDEX IF NOT EXISTS production_machine_facts_machine_idx
  ON public.production_machine_facts(machine_id, fact_date DESC);

CREATE INDEX IF NOT EXISTS production_machine_facts_section_idx
  ON public.production_machine_facts(section_id, fact_date DESC);

CREATE INDEX IF NOT EXISTS production_tonnage_facts_day_idx
  ON public.production_tonnage_facts(factory_id, fact_date);

CREATE INDEX IF NOT EXISTS production_tonnage_facts_section_idx
  ON public.production_tonnage_facts(section_id, fact_date DESC);

CREATE OR REPLACE FUNCTION public.touch_production_fact_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_fact_section()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_record record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'Section cannot be its own parent';
    END IF;

    SELECT factory_id, parent_id
      INTO parent_record
      FROM public.production_fact_sections
      WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent production fact section not found';
    END IF;

    IF parent_record.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Production fact sections support only two levels';
    END IF;

    IF parent_record.factory_id IS DISTINCT FROM NEW.factory_id THEN
      RAISE EXCEPTION 'Parent section must belong to the same factory';
    END IF;
  END IF;

  IF NEW.archived_at IS NOT NULL THEN
    NEW.is_active = false;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_machine_fact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  section_record record;
BEGIN
  PERFORM 1
    FROM public.machines
    WHERE id = NEW.machine_id
      AND factory_id = NEW.factory_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Machine must belong to the same factory';
  END IF;

  SELECT factory_id, parent_id
    INTO section_record
    FROM public.production_fact_sections
    WHERE id = NEW.section_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production fact subsection not found';
  END IF;

  IF section_record.parent_id IS NULL THEN
    RAISE EXCEPTION 'Production facts can be entered only by subsection';
  END IF;

  IF section_record.factory_id IS DISTINCT FROM NEW.factory_id THEN
    RAISE EXCEPTION 'Subsection must belong to the same factory';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_production_tonnage_fact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  section_record record;
BEGIN
  SELECT factory_id, parent_id
    INTO section_record
    FROM public.production_fact_sections
    WHERE id = NEW.section_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production fact subsection not found';
  END IF;

  IF section_record.parent_id IS NULL THEN
    RAISE EXCEPTION 'Tonnage facts can be entered only by subsection';
  END IF;

  IF section_record.factory_id IS DISTINCT FROM NEW.factory_id THEN
    RAISE EXCEPTION 'Subsection must belong to the same factory';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_fact_sections_touch_updated_at ON public.production_fact_sections;
CREATE TRIGGER production_fact_sections_touch_updated_at
  BEFORE UPDATE ON public.production_fact_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_production_fact_updated_at();

DROP TRIGGER IF EXISTS production_fact_sections_validate ON public.production_fact_sections;
CREATE TRIGGER production_fact_sections_validate
  BEFORE INSERT OR UPDATE ON public.production_fact_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_production_fact_section();

DROP TRIGGER IF EXISTS production_machine_facts_touch_updated_at ON public.production_machine_facts;
CREATE TRIGGER production_machine_facts_touch_updated_at
  BEFORE UPDATE ON public.production_machine_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_production_fact_updated_at();

DROP TRIGGER IF EXISTS production_machine_facts_validate ON public.production_machine_facts;
CREATE TRIGGER production_machine_facts_validate
  BEFORE INSERT OR UPDATE ON public.production_machine_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_production_machine_fact();

DROP TRIGGER IF EXISTS production_tonnage_facts_touch_updated_at ON public.production_tonnage_facts;
CREATE TRIGGER production_tonnage_facts_touch_updated_at
  BEFORE UPDATE ON public.production_tonnage_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_production_fact_updated_at();

DROP TRIGGER IF EXISTS production_tonnage_facts_validate ON public.production_tonnage_facts;
CREATE TRIGGER production_tonnage_facts_validate
  BEFORE INSERT OR UPDATE ON public.production_tonnage_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_production_tonnage_fact();

ALTER TABLE public.production_fact_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_machine_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_tonnage_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_fact_sections_select ON public.production_fact_sections;
CREATE POLICY production_fact_sections_select
  ON public.production_fact_sections
  FOR SELECT
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_fact_sections_insert ON public.production_fact_sections;
CREATE POLICY production_fact_sections_insert
  ON public.production_fact_sections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_fact_sections_update ON public.production_fact_sections;
CREATE POLICY production_fact_sections_update
  ON public.production_fact_sections
  FOR UPDATE
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  )
  WITH CHECK (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_machine_facts_select ON public.production_machine_facts;
CREATE POLICY production_machine_facts_select
  ON public.production_machine_facts
  FOR SELECT
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_machine_facts_insert ON public.production_machine_facts;
CREATE POLICY production_machine_facts_insert
  ON public.production_machine_facts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_machine_facts_update ON public.production_machine_facts;
CREATE POLICY production_machine_facts_update
  ON public.production_machine_facts
  FOR UPDATE
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  )
  WITH CHECK (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_machine_facts_delete ON public.production_machine_facts;
CREATE POLICY production_machine_facts_delete
  ON public.production_machine_facts
  FOR DELETE
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_tonnage_facts_select ON public.production_tonnage_facts;
CREATE POLICY production_tonnage_facts_select
  ON public.production_tonnage_facts
  FOR SELECT
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_tonnage_facts_insert ON public.production_tonnage_facts;
CREATE POLICY production_tonnage_facts_insert
  ON public.production_tonnage_facts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_tonnage_facts_update ON public.production_tonnage_facts;
CREATE POLICY production_tonnage_facts_update
  ON public.production_tonnage_facts
  FOR UPDATE
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  )
  WITH CHECK (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

DROP POLICY IF EXISTS production_tonnage_facts_delete ON public.production_tonnage_facts;
CREATE POLICY production_tonnage_facts_delete
  ON public.production_tonnage_facts
  FOR DELETE
  TO authenticated
  USING (
    public.is_director()
    OR (
      public.get_user_role() = 'production_manager'
      AND factory_id = public.get_user_factory_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_fact_sections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_machine_facts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_tonnage_facts TO authenticated;
