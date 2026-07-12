-- Normalize chain/cord warehouse quantities to millimeters while keeping the
-- legacy request mirror column in meters for compatibility.

CREATE TEMP TABLE _chain_cord_meter_inventory_ids ON COMMIT DROP AS
SELECT i.id
FROM public.inventory i
JOIN public.materials m ON m.id = i.material_id
WHERE m.category = 'chain_cord'::public.material_category
  AND lower(btrim(i.unit)) IN ('м', 'm');

UPDATE public.inventory_reservations r
SET reserved_quantity = r.reserved_quantity * 1000
WHERE r.inventory_id IN (SELECT id FROM _chain_cord_meter_inventory_ids);

UPDATE public.inventory_transactions t
SET quantity = t.quantity * 1000
WHERE t.inventory_id IN (SELECT id FROM _chain_cord_meter_inventory_ids);

UPDATE public.inventory i
SET total_quantity = i.total_quantity * 1000,
    reserved_quantity = i.reserved_quantity * 1000,
    unit = 'мм',
    updated_at = now()
WHERE i.id IN (SELECT id FROM _chain_cord_meter_inventory_ids);

UPDATE public.supply_order_delivery_schedules s
SET quantity = s.quantity * 1000,
    received_quantity = CASE
      WHEN s.received_quantity IS NULL THEN NULL
      ELSE s.received_quantity * 1000
    END,
    unit = 'мм',
    updated_at = now()
WHERE s.request_item_table = 'request_chain_cord'
  AND lower(btrim(s.unit)) IN ('м', 'm');

CREATE OR REPLACE FUNCTION public.fn_set_request_reserved_quantity(
  p_table text,
  p_id uuid,
  p_quantity numeric DEFAULT NULL,
  p_secondary_quantity numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quantity numeric;
  v_secondary_quantity numeric;
BEGIN
  SELECT
    COALESCE(SUM(reserved_quantity), 0),
    COALESCE(SUM(COALESCE(reserved_secondary_quantity, 0)), 0)
  INTO v_quantity, v_secondary_quantity
  FROM public.inventory_reservations
  WHERE request_item_table = p_table
    AND request_item_id = p_id;

  IF p_table = 'request_sheet_metal' THEN
    UPDATE public.request_sheet_metal SET reserved_from_stock_kg = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_round_tube' THEN
    UPDATE public.request_round_tube
    SET reserved_from_stock_kg = v_quantity,
        reserved_from_stock_m = v_secondary_quantity
    WHERE id = p_id;
  ELSIF p_table = 'request_circle' THEN
    UPDATE public.request_circle SET reserved_from_stock_mm = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_pipe' THEN
    UPDATE public.request_pipe
    SET reserved_from_stock_length_mm = CASE WHEN pipe_type = 'wire' THEN reserved_from_stock_length_mm ELSE v_quantity END,
        reserved_from_stock_qty = CASE WHEN pipe_type = 'wire' THEN reserved_from_stock_qty ELSE v_secondary_quantity END,
        reserved_from_stock_kg = CASE WHEN pipe_type = 'wire' THEN v_quantity ELSE reserved_from_stock_kg END
    WHERE id = p_id;
  ELSIF p_table = 'request_knives' THEN
    UPDATE public.request_knives
    SET reserved_from_stock_mm = v_quantity,
        reserved_from_stock_qty = v_secondary_quantity
    WHERE id = p_id;
  ELSIF p_table = 'request_components' THEN
    UPDATE public.request_components SET reserved_from_stock = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_paint' THEN
    UPDATE public.request_paint SET reserved_from_stock_kg = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_mesh' THEN
    UPDATE public.request_mesh SET reserved_from_stock_qty = v_quantity WHERE id = p_id;
  ELSIF p_table = 'request_chain_cord' THEN
    -- inventory_reservations is canonical in millimeters; this legacy mirror
    -- remains in meters until its column can be removed in a separate migration.
    UPDATE public.request_chain_cord
    SET reserved_from_stock_meters = v_quantity / 1000
    WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Некорректная таблица позиции: %', p_table;
  END IF;
END;
$$;

UPDATE public.request_chain_cord item
SET reserved_from_stock_meters = COALESCE((
  SELECT SUM(r.reserved_quantity) / 1000
  FROM public.inventory_reservations r
  WHERE r.request_item_table = 'request_chain_cord'
    AND r.request_item_id = item.id
), 0);
