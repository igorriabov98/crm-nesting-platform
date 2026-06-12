-- Автоматические переходы статусов машины по бизнес-событиям.

CREATE OR REPLACE FUNCTION fn_update_machine_status_on_confirm()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('in_production', 'shipped') THEN
    RETURN NEW;
  END IF;

  IF NEW.is_confirmed = true AND OLD.is_confirmed IS DISTINCT FROM NEW.is_confirmed AND NEW.status = 'created' THEN
    UPDATE machines
    SET status = 'confirmed', updated_at = now()
    WHERE id = NEW.id;
  ELSIF NEW.is_confirmed = false AND OLD.is_confirmed IS DISTINCT FROM NEW.is_confirmed AND NEW.status = 'confirmed' THEN
    UPDATE machines
    SET status = 'created', updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_machine_status_on_confirm ON machines;

CREATE TRIGGER trg_update_machine_status_on_confirm
  AFTER UPDATE OF is_confirmed ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_confirm();

CREATE OR REPLACE FUNCTION fn_update_machine_status_on_plan()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('in_production', 'shipped') THEN
    RETURN NEW;
  END IF;

  IF NEW.factory_id IS NOT NULL
     AND NEW.material_type IS NOT NULL
     AND NEW.planned_material_date IS NOT NULL
     AND NEW.status IN ('created', 'confirmed') THEN
    UPDATE machines
    SET status = 'planned', updated_at = now()
    WHERE id = NEW.id;
  ELSIF (
      NEW.factory_id IS NULL
      OR NEW.material_type IS NULL
      OR NEW.planned_material_date IS NULL
    )
    AND NEW.status = 'planned' THEN
    UPDATE machines
    SET
      status = CASE WHEN NEW.is_confirmed THEN 'confirmed'::machine_status ELSE 'created'::machine_status END,
      updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_machine_status_on_plan ON machines;
DROP TRIGGER IF EXISTS trg_update_machine_status_on_plan_insert ON machines;

CREATE TRIGGER trg_update_machine_status_on_plan
  AFTER UPDATE OF factory_id, material_type, planned_material_date ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_plan();

CREATE TRIGGER trg_update_machine_status_on_plan_insert
  AFTER INSERT ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_plan();

CREATE OR REPLACE FUNCTION fn_update_machine_status_on_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'submitted_to_supply'
     AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE machines
    SET status = 'request_ready', updated_at = now()
    WHERE id = NEW.machine_id
      AND status = 'planned';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_machine_status_on_request ON technologist_requests;

CREATE TRIGGER trg_update_machine_status_on_request
  AFTER UPDATE OF status ON technologist_requests
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_request();

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
  v_request_id := NEW.request_id;

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
    SELECT order_status AS os FROM request_sheet_metal WHERE request_id = v_request_id AND to_order_kg > 0
    UNION ALL
    SELECT order_status FROM request_round_tube WHERE request_id = v_request_id AND order_kg > 0
    UNION ALL
    SELECT order_status FROM request_knives WHERE request_id = v_request_id AND to_order_mm > 0
    UNION ALL
    SELECT order_status FROM request_components WHERE request_id = v_request_id AND to_order > 0
    UNION ALL
    SELECT order_status FROM request_paint WHERE request_id = v_request_id AND to_order_kg > 0
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

DROP TRIGGER IF EXISTS trg_order_status_sheet_metal ON request_sheet_metal;
DROP TRIGGER IF EXISTS trg_order_status_round_tube ON request_round_tube;
DROP TRIGGER IF EXISTS trg_order_status_knives ON request_knives;
DROP TRIGGER IF EXISTS trg_order_status_components ON request_components;
DROP TRIGGER IF EXISTS trg_order_status_paint ON request_paint;

CREATE TRIGGER trg_order_status_sheet_metal
  AFTER UPDATE OF order_status ON request_sheet_metal
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();

CREATE TRIGGER trg_order_status_round_tube
  AFTER UPDATE OF order_status ON request_round_tube
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();

CREATE TRIGGER trg_order_status_knives
  AFTER UPDATE OF order_status ON request_knives
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();

CREATE TRIGGER trg_order_status_components
  AFTER UPDATE OF order_status ON request_components
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();

CREATE TRIGGER trg_order_status_paint
  AFTER UPDATE OF order_status ON request_paint
  FOR EACH ROW
  EXECUTE FUNCTION fn_check_order_status_and_update_machine();
