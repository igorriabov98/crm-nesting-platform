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
    RAISE EXCEPTION 'Production fact section not found';
  END IF;

  IF section_record.factory_id IS DISTINCT FROM NEW.factory_id THEN
    RAISE EXCEPTION 'Section must belong to the same factory';
  END IF;

  IF section_record.parent_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.section_id = NEW.section_id THEN
      RETURN NEW;
    END IF;

    PERFORM 1
      FROM public.production_fact_sections child
      WHERE child.parent_id = NEW.section_id
        AND child.is_active
        AND child.archived_at IS NULL;

    IF FOUND THEN
      RAISE EXCEPTION 'Production facts can be entered by parent section only when it has no active subsections';
    END IF;
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
    RAISE EXCEPTION 'Production fact section not found';
  END IF;

  IF section_record.factory_id IS DISTINCT FROM NEW.factory_id THEN
    RAISE EXCEPTION 'Section must belong to the same factory';
  END IF;

  IF section_record.parent_id IS NULL THEN
    IF TG_OP = 'UPDATE' AND OLD.section_id = NEW.section_id THEN
      RETURN NEW;
    END IF;

    PERFORM 1
      FROM public.production_fact_sections child
      WHERE child.parent_id = NEW.section_id
        AND child.is_active
        AND child.archived_at IS NULL;

    IF FOUND THEN
      RAISE EXCEPTION 'Tonnage facts can be entered by parent section only when it has no active subsections';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
