-- Read-only production review after migration 20260924140000 for the sheet
-- remnant reported on CIV-21-2026.
-- Run before considering the separate guarded correction script.
-- The warehouse History link contains material_id, not this inventory row's id.
SELECT
  inventory.id AS inventory_id,
  inventory.business_scrap_state,
  inventory.total_quantity,
  inventory.reserved_quantity,
  inventory.calculated_weight_kg,
  inventory.created_at AS inventory_created_at,
  plan.id AS plan_id,
  plan.source_item_id,
  plan.quantity AS planned_quantity,
  plan.created_at AS plan_created_at,
  machine.name AS machine_name,
  plan.promoted_event_id,
  event.created_at AS event_created_at,
  event.fact_date,
  event.status AS event_status,
  (SELECT count(*) FROM public.production_fact_cutting_event_reservations source
   JOIN public.inventory_reservations reservation ON reservation.id=source.reservation_id
   WHERE source.event_id=event.id
     AND source.request_item_table='request_sheet_metal'
     AND source.request_item_id=plan.source_item_id
     AND coalesce(source.consumed_quantity,source.reserved_quantity,0)>0
     AND reservation.consumed_cutting_event_id=event.id
     AND reservation.reservation_source IN ('stock','supply_receipt')) AS matching_consumed_sources,
  (SELECT count(*) FROM public.inventory_reservations reservation
   WHERE reservation.inventory_id=inventory.id
      OR reservation.source_inventory_id=inventory.id
      OR reservation.business_scrap_inventory_id=inventory.id) AS remnant_reservations,
  (SELECT count(*) FROM public.inventory_transactions transaction
   WHERE transaction.inventory_id=inventory.id AND transaction.transaction_type<>'receipt') AS later_operations,
  (SELECT count(*) FROM public.metal_scrap_lots lot
   WHERE lot.source_inventory_id=inventory.id) AS metal_scrap_lots
FROM public.inventory inventory
LEFT JOIN public.technologist_sheet_scrap_plans plan ON plan.inventory_id=inventory.id
LEFT JOIN public.technologist_request_completions completion ON completion.id=plan.completion_id
LEFT JOIN public.machines machine ON machine.id=completion.machine_id
LEFT JOIN public.production_fact_cutting_events event ON event.id=plan.promoted_event_id
WHERE inventory.id='f77e8ad8-7428-47cc-bab3-d3b137ee79e9'::uuid;

-- Other available sheet plans lacking a consumed source are review cases,
-- not automatic corrections. Their reservations and transactions may differ.
SELECT inventory.id AS inventory_id, plan.id AS plan_id,
  machine.name AS machine_name, plan.source_item_id, plan.promoted_event_id,
  plan.created_at AS plan_created_at, event.created_at AS event_created_at,
  inventory.total_quantity, inventory.reserved_quantity, inventory.deleted_at,
  CASE WHEN event.id IS NULL THEN 'no linked fact'
       WHEN event.created_at < plan.created_at THEN 'fact predates plan'
       WHEN NOT EXISTS (
         SELECT 1 FROM public.production_fact_cutting_event_reservations source
         JOIN public.inventory_reservations reservation ON reservation.id=source.reservation_id
         WHERE source.event_id=event.id
           AND source.request_item_table='request_sheet_metal'
           AND source.request_item_id=plan.source_item_id
           AND coalesce(source.consumed_quantity,source.reserved_quantity,0)>0
           AND reservation.consumed_cutting_event_id=event.id
           AND reservation.reservation_source IN ('stock','supply_receipt')
       ) THEN 'fact did not consume source'
  END AS review_reason
FROM public.technologist_sheet_scrap_plans plan
JOIN public.inventory inventory ON inventory.id=plan.inventory_id
JOIN public.technologist_request_completions completion ON completion.id=plan.completion_id
JOIN public.machines machine ON machine.id=completion.machine_id
LEFT JOIN public.production_fact_cutting_events event ON event.id=plan.promoted_event_id
WHERE inventory.business_scrap_state='available'
  AND inventory.deleted_at IS NULL
  AND (event.id IS NULL OR event.created_at < plan.created_at
       OR NOT EXISTS (
         SELECT 1 FROM public.production_fact_cutting_event_reservations source
         JOIN public.inventory_reservations reservation ON reservation.id=source.reservation_id
         WHERE source.event_id=event.id
           AND source.request_item_table='request_sheet_metal'
           AND source.request_item_id=plan.source_item_id
           AND coalesce(source.consumed_quantity,source.reserved_quantity,0)>0
           AND reservation.consumed_cutting_event_id=event.id
           AND reservation.reservation_source IN ('stock','supply_receipt')
       ));

-- Historical future-fill remnants whose request rows have only the legacy
-- group key need a source review; never infer an individual sheet from it.
SELECT inventory.id AS inventory_id, inventory.source_nesting_project_id,
  inventory.source_nesting_sheet_id, inventory.business_scrap_state,
  inventory.created_at,
  (SELECT count(*) FROM public.request_sheet_metal sheet
   WHERE sheet.source_nesting_project_id=inventory.source_nesting_project_id) AS project_request_rows
FROM public.inventory inventory
JOIN public.materials material ON material.id=inventory.material_id
WHERE inventory.is_business_scrap
  AND inventory.business_scrap_state='future'
  AND inventory.deleted_at IS NULL
  AND material.category='sheet_metal'
  AND inventory.source_nesting_project_id IS NOT NULL
  AND inventory.source_nesting_sheet_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.request_sheet_metal sheet
    WHERE sheet.source_nesting_project_id=inventory.source_nesting_project_id
      AND inventory.source_nesting_sheet_id=ANY(sheet.source_nesting_sheet_ids)
  );
