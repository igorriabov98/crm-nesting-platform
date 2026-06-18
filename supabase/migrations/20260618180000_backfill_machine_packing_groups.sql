-- Move legacy per-item packing values to the machine-level packing list.
-- Keep the legacy columns for a later contract migration, but stop using them in the app.
WITH numbered_goods AS (
  SELECT
    mi.machine_id,
    mi.packing_type,
    mi.packing_places,
    row_number() OVER (
      PARTITION BY mi.machine_id
      ORDER BY mi.sort_order NULLS LAST, mi.id
    )::integer AS item_number
  FROM public.machine_items mi
  WHERE COALESCE(mi.is_sample, false) = false
),
legacy_groups AS (
  SELECT ng.*
  FROM numbered_goods ng
  WHERE NULLIF(btrim(ng.packing_type), '') IS NOT NULL
    AND ng.packing_places IS NOT NULL
    AND ng.packing_places > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.machine_packing_groups mpg
      WHERE mpg.machine_id = ng.machine_id
    )
)
INSERT INTO public.machine_packing_groups (
  machine_id,
  start_item_number,
  end_item_number,
  packing_type_en,
  packing_type_ua,
  places,
  sort_order
)
SELECT
  machine_id,
  item_number,
  item_number,
  btrim(packing_type),
  NULL,
  packing_places,
  item_number - 1
FROM legacy_groups;
