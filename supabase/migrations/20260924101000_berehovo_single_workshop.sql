-- Merge Berehovo workshop 2 after workshop 1, preserving both monthly queues.
DO $$
DECLARE
  v_factory_id uuid;
  v_factory_count integer;
  v_before_count integer;
  v_after_count integer;
  v_workshop_two_count integer;
  v_active_workshop_two_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('machine-production-queue', 0));
  LOCK TABLE public.machines IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*), (array_agg(id))[1] INTO v_factory_count, v_factory_id
  FROM public.factories WHERE lower(name) LIKE '%берегово%';
  IF v_factory_count <> 1 THEN
    RAISE EXCEPTION 'Ожидался ровно один завод Берегово, найдено: %', v_factory_count;
  END IF;

  SELECT count(*) INTO v_before_count FROM public.machines WHERE factory_id = v_factory_id;
  SELECT count(*), count(*) FILTER (WHERE NOT coalesce(is_archived, false))
    INTO v_workshop_two_count, v_active_workshop_two_count
  FROM public.machines
  WHERE factory_id = v_factory_id AND production_workshop = 2;
  RAISE NOTICE 'Берегово: всего машин %, цех 2 всего %, цех 2 активных %',
    v_before_count, v_workshop_two_count, v_active_workshop_two_count;

  WITH ranked AS (
    SELECT id,
      row_number() OVER (
        PARTITION BY production_month
        ORDER BY production_workshop, production_queue_number NULLS LAST, created_at, id
      )::integer AS new_queue_number
    FROM public.machines
    WHERE factory_id = v_factory_id
      AND production_workshop IN (1, 2)
      AND production_month IS NOT NULL
      AND NOT coalesce(is_archived, false)
  )
  UPDATE public.machines AS machine
  SET production_workshop = 1,
      production_queue_number = ranked.new_queue_number
  FROM ranked
  WHERE machine.id = ranked.id
    AND (machine.production_workshop IS DISTINCT FROM 1
      OR machine.production_queue_number IS DISTINCT FROM ranked.new_queue_number);

  -- Archived and unscheduled machines have no place in an active monthly queue.
  UPDATE public.machines
  SET production_workshop = 1
  WHERE factory_id = v_factory_id AND production_workshop = 2;

  SELECT count(*) INTO v_after_count FROM public.machines WHERE factory_id = v_factory_id;
  IF v_after_count <> v_before_count THEN
    RAISE EXCEPTION 'Количество машин Берегово изменилось: % -> %', v_before_count, v_after_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.machines
    WHERE factory_id = v_factory_id AND production_workshop = 2
  ) THEN
    RAISE EXCEPTION 'После переноса остались машины Берегово в цехе 2';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_berehovo_workshop_two()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
BEGIN
  IF NEW.production_workshop = 2 AND EXISTS (
    SELECT 1 FROM public.factories
    WHERE id = NEW.factory_id AND lower(name) LIKE '%берегово%'
  ) THEN
    RAISE EXCEPTION 'Для Берегово доступен только цех 1' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reject_berehovo_workshop_two ON public.machines;
CREATE TRIGGER trg_reject_berehovo_workshop_two
  BEFORE INSERT OR UPDATE OF factory_id, production_workshop ON public.machines
  FOR EACH ROW EXECUTE FUNCTION public.reject_berehovo_workshop_two();
