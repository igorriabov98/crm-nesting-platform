UPDATE public.inventory
SET source_remnant_geom = COALESCE(source_remnant_geom, '{}'::jsonb) || jsonb_build_object('id', 'legacy')
WHERE is_business_scrap = true
  AND source_nesting_project_id IS NOT NULL
  AND source_nesting_sheet_id IS NOT NULL
  AND COALESCE(source_remnant_geom->>'id', '') = '';

DROP INDEX IF EXISTS public.idx_inventory_future_scrap_source_sheet;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_future_scrap_source_remnant
  ON public.inventory(
    source_nesting_project_id,
    source_nesting_sheet_id,
    (COALESCE(source_remnant_geom->>'id', 'legacy'))
  )
  WHERE is_business_scrap = true
    AND source_nesting_project_id IS NOT NULL
    AND source_nesting_sheet_id IS NOT NULL;
