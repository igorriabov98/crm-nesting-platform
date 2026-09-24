-- Separate production-data correction. Review civ21_sheet_scrap_reconciliation.sql
-- first. This script changes the row only if its old promotion has no consumed
-- source and the remnant has never been reserved, used or sold.
BEGIN;
DO $correction$
DECLARE
  v_inventory_id constant uuid := '92f01d19-65a3-4067-915d-415c94e9e793';
  v_plan_id uuid;
  v_event_id uuid;
BEGIN
  SELECT plan.id, plan.promoted_event_id INTO v_plan_id, v_event_id
  FROM public.technologist_sheet_scrap_plans plan
  JOIN public.inventory inventory ON inventory.id=plan.inventory_id
  WHERE inventory.id=v_inventory_id
    AND inventory.deleted_at IS NULL
    AND inventory.is_business_scrap
    AND inventory.business_scrap_state='available'
    AND inventory.total_quantity=plan.quantity
    AND coalesce(inventory.reserved_quantity,0)=0
    AND coalesce(inventory.reserved_secondary_quantity,0)=0
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_reservations reservation
      WHERE reservation.inventory_id=inventory.id
         OR reservation.source_inventory_id=inventory.id
         OR reservation.business_scrap_inventory_id=inventory.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.inventory_transactions transaction
      WHERE transaction.inventory_id=inventory.id AND transaction.transaction_type<>'receipt'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.metal_scrap_lots lot WHERE lot.source_inventory_id=inventory.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.production_fact_cutting_events event
      JOIN public.production_fact_cutting_event_reservations source ON source.event_id=event.id
      JOIN public.inventory_reservations reservation ON reservation.id=source.reservation_id
      JOIN public.technologist_request_completions completion ON completion.machine_id=event.machine_id
        AND completion.id=plan.completion_id
      WHERE event.status IN ('applied','kept')
        AND event.created_at>=plan.created_at
        AND source.request_item_table='request_sheet_metal'
        AND source.request_item_id=plan.source_item_id
        AND coalesce(source.consumed_quantity,source.reserved_quantity,0)>0
        AND reservation.consumed_cutting_event_id=event.id
        AND reservation.reservation_source IN ('stock','supply_receipt')
    )
  FOR UPDATE OF plan, inventory;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'CIV-21-2026 remnant is not eligible for automatic correction; review the report';
  END IF;

  UPDATE public.inventory SET business_scrap_state='future',updated_at=now()
  WHERE id=v_inventory_id;
  UPDATE public.technologist_sheet_scrap_plans SET promoted_event_id=NULL WHERE id=v_plan_id;
  DELETE FROM public.production_fact_cutting_event_scrap_promotions
  WHERE inventory_id=v_inventory_id AND event_id=v_event_id;
  RAISE NOTICE 'Restored future sheet remnant %, plan %, old event %',v_inventory_id,v_plan_id,v_event_id;
END;
$correction$;
COMMIT;
