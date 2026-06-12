-- Extend inventory reservation write-back for request sections v2.
-- The reservation RPC stores the canonical reservation row in inventory_reservations,
-- and this helper mirrors the reserved amount into the request item table for legacy UI logic.

CREATE OR REPLACE FUNCTION fn_set_request_reserved_quantity(
  p_table text,
  p_id uuid,
  p_quantity numeric,
  p_secondary_quantity numeric DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  IF p_table = 'request_sheet_metal' THEN
    UPDATE request_sheet_metal SET reserved_from_stock_kg = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_round_tube' THEN
    UPDATE request_round_tube
    SET reserved_from_stock_kg = p_quantity,
        reserved_from_stock_m = COALESCE(p_secondary_quantity, 0)
    WHERE id = p_id;
  ELSIF p_table = 'request_circle' THEN
    UPDATE request_circle SET reserved_from_stock_mm = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_pipe' THEN
    UPDATE request_pipe
    SET reserved_from_stock_length_mm = CASE WHEN pipe_type = 'wire' THEN reserved_from_stock_length_mm ELSE p_quantity END,
        reserved_from_stock_kg = CASE WHEN pipe_type = 'wire' THEN p_quantity ELSE reserved_from_stock_kg END
    WHERE id = p_id;
  ELSIF p_table = 'request_knives' THEN
    UPDATE request_knives SET reserved_from_stock_mm = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_components' THEN
    UPDATE request_components SET reserved_from_stock = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_paint' THEN
    UPDATE request_paint SET reserved_from_stock_kg = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_mesh' THEN
    UPDATE request_mesh SET reserved_from_stock_qty = p_quantity WHERE id = p_id;
  ELSIF p_table = 'request_chain_cord' THEN
    UPDATE request_chain_cord SET reserved_from_stock_meters = p_quantity WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Некорректная таблица позиции: %', p_table;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
