-- Receipt RPCs create reservations atomically from the operator's allocation.
-- Cutting must only consume those reservations. Reconstructing a reservation
-- from received_quantity steals free surplus, including entire zero-allocation
-- shipments, and can recreate reservations deliberately released later.
-- Keep the signature for the existing cutting/rollback wrappers and old callers.
CREATE OR REPLACE FUNCTION public.fn_reserve_delivered_supply_for_cutting(
  p_machine_id uuid,
  p_performed_by uuid
)
RETURNS integer
LANGUAGE sql
SET search_path = ''
AS $$ SELECT 0; $$;

REVOKE ALL ON FUNCTION public.fn_reserve_delivered_supply_for_cutting(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Defense in depth for every request category, including child allocations
-- whose received_quantity is zero. Physical bar length may exceed logical
-- demand, so compare against allocated_physical_quantity, never net cut length.
CREATE OR REPLACE FUNCTION public.fn_guard_supply_receipt_reservation_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_schedule public.supply_order_delivery_schedules%ROWTYPE;
  v_physical numeric;
BEGIN
  IF NEW.reservation_source IS DISTINCT FROM 'supply_receipt' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_schedule
  FROM public.supply_order_delivery_schedules
  WHERE id = NEW.supply_order_schedule_id
  FOR UPDATE;

  IF NOT FOUND OR v_schedule.status IS DISTINCT FROM 'delivered'
    OR v_schedule.request_item_table IS DISTINCT FROM NEW.request_item_table
    OR v_schedule.request_item_id IS DISTINCT FROM NEW.request_item_id THEN
    RAISE EXCEPTION 'Бронь поставки не соответствует принятому распределению';
  END IF;

  v_physical := COALESCE(v_schedule.allocated_physical_quantity, v_schedule.allocated_quantity, 0);
  IF COALESCE(v_schedule.allocated_quantity, 0) <= 0 OR v_physical <= 0
    OR NEW.reserved_quantity > v_physical + 0.000001
    OR (v_schedule.allocated_piece_count IS NOT NULL
      AND COALESCE(NEW.reserved_secondary_quantity, 0) > v_schedule.allocated_piece_count + 0.000001)
    OR (NEW.logical_reserved_quantity IS NOT NULL
      AND NEW.logical_reserved_quantity > v_schedule.allocated_quantity + 0.000001) THEN
    RAISE EXCEPTION 'Бронь превышает распределение поставки: свободный излишек нельзя бронировать автоматически';
  END IF;

  IF v_schedule.receipt_inventory_id IS NOT NULL
    AND v_schedule.receipt_inventory_id IS DISTINCT FROM NEW.inventory_id THEN
    RAISE EXCEPTION 'Бронь поставки относится к другой складской позиции';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_guard_supply_receipt_reservation_allocation()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_supply_receipt_reservation_allocation
BEFORE INSERT OR UPDATE OF reservation_source, supply_order_schedule_id,
  request_item_table, request_item_id, inventory_id, reserved_quantity,
  reserved_secondary_quantity, logical_reserved_quantity
ON public.inventory_reservations
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_supply_receipt_reservation_allocation();
