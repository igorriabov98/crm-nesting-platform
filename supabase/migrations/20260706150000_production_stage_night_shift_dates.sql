ALTER TABLE public.production_stages
  ADD COLUMN IF NOT EXISTS manual_overdue boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.production_stages.manual_overdue IS
  'Manual production-stage overdue flag. Stage dates alone do not mark a production stage overdue in the UI.';

ALTER TABLE public.production_stages
  ADD COLUMN IF NOT EXISTS night_shift_dates date[] DEFAULT '{}'::date[];

UPDATE public.production_stages
SET night_shift_dates = COALESCE(night_shift_dates, '{}'::date[]);

UPDATE public.production_stages
SET night_shift_dates = ARRAY[night_shift_date]
WHERE night_shift_date IS NOT NULL
  AND COALESCE(cardinality(night_shift_dates), 0) = 0;

ALTER TABLE public.production_stages
  ALTER COLUMN night_shift_dates SET DEFAULT '{}'::date[],
  ALTER COLUMN night_shift_dates SET NOT NULL;

DROP VIEW IF EXISTS public.production_stages_with_delay;

CREATE VIEW public.production_stages_with_delay AS
SELECT
  ps.*,
  CASE
    WHEN ps.manual_overdue
      AND COALESCE(ps.planned_date_end, ps.date_end, ps.date_start) IS NOT NULL
      AND CURRENT_DATE > COALESCE(ps.planned_date_end, ps.date_end, ps.date_start)
    THEN CURRENT_DATE - COALESCE(ps.planned_date_end, ps.date_end, ps.date_start)
    ELSE 0
  END AS delay_days,
  ps.manual_overdue AS is_overdue
FROM public.production_stages ps;

SELECT pg_notify('pgrst', 'reload schema');
