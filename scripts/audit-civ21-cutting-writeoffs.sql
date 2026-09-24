-- Read-only audit for the CIV-21-2026 cutting fact shown on 23 September 2026.
-- Run with a credential authorized to read the production ledger; do not use this file as a migration.
WITH cutting_events AS (
  SELECT id, machine_id, fact_id, created_at
  FROM public.production_fact_cutting_events
  WHERE machine_id = 'cdcd434c-566f-4683-9c05-a6786d9f4530'::uuid
    AND created_at >= '2026-09-23T00:00:00Z'
    AND created_at < '2026-09-24T00:00:00Z'
), consumed AS (
  SELECT e.id AS event_id, e.fact_id, e.created_at AS event_at,
    r.reservation_id, r.inventory_id, r.request_item_table, r.request_item_id,
    coalesce(r.consumed_quantity, r.reserved_quantity) AS quantity,
    ir.supply_order_schedule_id, ir.consumed_at,
    s.delivery_date, s.receipt_inventory_id
  FROM cutting_events e
  JOIN public.production_fact_cutting_event_reservations r ON r.event_id = e.id
  LEFT JOIN public.inventory_reservations ir ON ir.id = r.reservation_id
  LEFT JOIN public.supply_order_delivery_schedules s ON s.id = ir.supply_order_schedule_id
  WHERE r.is_cut_reservation = false
), written AS (
  SELECT t.id AS transaction_id, t.created_at AS transaction_at,
    t.inventory_id, t.request_item_table, t.request_item_id,
    -t.quantity AS quantity
  FROM public.inventory_transactions t
  WHERE t.machine_id = 'cdcd434c-566f-4683-9c05-a6786d9f4530'::uuid
    AND t.transaction_type = 'write_off'
    AND t.comment = 'Автоматическое списание потребности по факту заготовки'
    AND t.created_at >= '2026-09-23T00:00:00Z'
    AND t.created_at < '2026-09-24T00:00:00Z'
)
SELECT c.event_id, c.fact_id, c.inventory_id, c.request_item_table, c.request_item_id,
  c.quantity, count(DISTINCT c.reservation_id) AS consumed_reservations,
  count(DISTINCT w.transaction_id) AS matching_write_offs,
  array_agg(DISTINCT c.reservation_id) AS reservation_ids,
  array_agg(DISTINCT c.supply_order_schedule_id) AS schedule_ids,
  array_agg(DISTINCT c.delivery_date) AS delivery_dates,
  array_agg(DISTINCT c.receipt_inventory_id) AS receipt_inventory_ids,
  array_agg(DISTINCT c.consumed_at) AS consumption_times,
  array_agg(DISTINCT w.transaction_id) AS transaction_ids
FROM consumed c
LEFT JOIN written w ON w.inventory_id = c.inventory_id
  AND w.request_item_table = c.request_item_table
  AND w.request_item_id = c.request_item_id
  AND w.quantity = c.quantity
  AND w.transaction_at BETWEEN c.event_at AND c.event_at + interval '10 minutes'
GROUP BY c.event_id, c.fact_id, c.inventory_id, c.request_item_table, c.request_item_id, c.quantity
ORDER BY c.event_id, c.request_item_table, c.request_item_id, c.quantity;

-- Any row here means the same reservation appears in more than one cutting
-- event. Investigate these IDs before preparing a separate data correction.
SELECT r.reservation_id,
  count(DISTINCT r.event_id) AS cutting_event_count,
  array_agg(DISTINCT r.event_id) AS event_ids
FROM public.production_fact_cutting_event_reservations r
JOIN public.production_fact_cutting_events e ON e.id = r.event_id
WHERE e.machine_id = 'cdcd434c-566f-4683-9c05-a6786d9f4530'::uuid
  AND r.is_cut_reservation = false
  AND r.reservation_id IS NOT NULL
GROUP BY r.reservation_id
HAVING count(DISTINCT r.event_id) > 1;
