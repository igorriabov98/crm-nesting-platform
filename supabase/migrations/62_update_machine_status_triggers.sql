-- Update machine status checks for the v2 material request sections.
-- request_round_tube stays legacy-only: its existing trigger may still call this function,
-- but new machine status calculation intentionally excludes that old section.

CREATE OR REPLACE FUNCTION fn_check_order_status_and_update_machine()
RETURNS TRIGGER AS $$
DECLARE
  v_request_id uuid;
  v_machine_id uuid;
  v_machine_status machine_status;
  v_total int;
  v_all_ordered int;
  v_all_delivered int;
BEGIN
  v_request_id := COALESCE(NEW.request_id, OLD.request_id);

  SELECT tr.machine_id, m.status
  INTO v_machine_id, v_machine_status
  FROM technologist_requests tr
  JOIN machines m ON m.id = tr.machine_id
  WHERE tr.id = v_request_id;

  IF v_machine_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_machine_status IN ('in_production', 'shipped') THEN
    RETURN NEW;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE os IN ('ordered', 'delivered')),
    COUNT(*) FILTER (WHERE os = 'delivered')
  INTO v_total, v_all_ordered, v_all_delivered
  FROM (
    SELECT order_status AS os
    FROM request_sheet_metal
    WHERE request_id = v_request_id
      AND (COALESCE(remainder_qty, 0) > 0 OR COALESCE(to_order_kg, 0) > 0)

    UNION ALL
    SELECT order_status
    FROM request_circle
    WHERE request_id = v_request_id
      AND COALESCE(remainder_mm, 0) > 0

    UNION ALL
    SELECT order_status
    FROM request_pipe
    WHERE request_id = v_request_id
      AND (
        (pipe_type = 'wire' AND COALESCE(remainder_kg, 0) > 0)
        OR (pipe_type <> 'wire' AND COALESCE(remainder_length_mm, 0) > 0)
      )

    UNION ALL
    SELECT order_status
    FROM request_knives
    WHERE request_id = v_request_id
      AND (COALESCE(remainder_meters, 0) > 0 OR COALESCE(to_order_mm, 0) > 0)

    UNION ALL
    SELECT order_status
    FROM request_paint
    WHERE request_id = v_request_id
      AND (COALESCE(remainder_kg, 0) > 0 OR COALESCE(to_order_kg, 0) > 0)

    UNION ALL
    SELECT order_status
    FROM request_components
    WHERE request_id = v_request_id
      AND (COALESCE(to_order, 0) > 0 OR GREATEST(COALESCE(quantity_needed, 0) - COALESCE(stock_remainder, 0), 0) > 0)

    UNION ALL
    SELECT order_status
    FROM request_mesh
    WHERE request_id = v_request_id
      AND COALESCE(remainder_qty, 0) > 0

    UNION ALL
    SELECT order_status
    FROM request_chain_cord
    WHERE request_id = v_request_id
      AND COALESCE(remainder_meters, 0) > 0
  ) all_items;

  IF v_total = 0 THEN
    RETURN NEW;
  END IF;

  IF v_all_delivered = v_total AND v_machine_status IN ('request_ready', 'purchasing') THEN
    UPDATE machines
    SET status = 'material_received', updated_at = now()
    WHERE id = v_machine_id;
    RETURN NEW;
  END IF;

  IF v_all_ordered = v_total AND v_machine_status = 'request_ready' THEN
    UPDATE machines
    SET status = 'purchasing', updated_at = now()
    WHERE id = v_machine_id;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_order_status_circle ON request_circle;
DROP TRIGGER IF EXISTS trg_order_status_pipe ON request_pipe;
DROP TRIGGER IF EXISTS trg_order_status_mesh ON request_mesh;
DROP TRIGGER IF EXISTS trg_order_status_chain_cord ON request_chain_cord;

CREATE TRIGGER trg_order_status_circle
  AFTER UPDATE OF order_status ON request_circle
  FOR EACH ROW
  WHEN (OLD.order_status IS DISTINCT FROM NEW.order_status)
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();

CREATE TRIGGER trg_order_status_pipe
  AFTER UPDATE OF order_status ON request_pipe
  FOR EACH ROW
  WHEN (OLD.order_status IS DISTINCT FROM NEW.order_status)
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();

CREATE TRIGGER trg_order_status_mesh
  AFTER UPDATE OF order_status ON request_mesh
  FOR EACH ROW
  WHEN (OLD.order_status IS DISTINCT FROM NEW.order_status)
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();

CREATE TRIGGER trg_order_status_chain_cord
  AFTER UPDATE OF order_status ON request_chain_cord
  FOR EACH ROW
  WHEN (OLD.order_status IS DISTINCT FROM NEW.order_status)
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();
