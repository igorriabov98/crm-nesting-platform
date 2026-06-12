-- Production stage dates are planning dates, not actual production facts.
-- Only actual material receipt and actual shipping can advance the machine lifecycle.

DROP TRIGGER IF EXISTS trg_update_machine_status_production ON production_stages;
DROP FUNCTION IF EXISTS fn_update_machine_status_on_production();

DROP TRIGGER IF EXISTS trg_update_machine_status_shipping ON production_stages;
DROP FUNCTION IF EXISTS fn_update_machine_status_on_shipping();

CREATE OR REPLACE FUNCTION fn_machine_status_from_actual_dates(
  p_status machine_status,
  p_is_confirmed boolean,
  p_factory_id uuid,
  p_material_type material_type,
  p_planned_material_date date,
  p_actual_material_date date,
  p_actual_shipping_date date
)
RETURNS machine_status AS $$
BEGIN
  IF p_actual_shipping_date IS NOT NULL THEN
    RETURN 'shipped'::machine_status;
  END IF;

  IF p_actual_material_date IS NOT NULL THEN
    RETURN 'material_received'::machine_status;
  END IF;

  IF p_status <> 'in_production'::machine_status
     AND p_status <> 'material_received'::machine_status
     AND p_status <> 'shipped'::machine_status THEN
    RETURN p_status;
  END IF;

  IF p_factory_id IS NOT NULL
     AND p_material_type IS NOT NULL
     AND p_material_type <> 'undefined'::material_type
     AND p_planned_material_date IS NOT NULL THEN
    RETURN 'planned'::machine_status;
  END IF;

  IF COALESCE(p_is_confirmed, false) THEN
    RETURN 'confirmed'::machine_status;
  END IF;

  RETURN 'created'::machine_status;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION fn_update_machine_status_on_actual_machine_dates()
RETURNS TRIGGER AS $$
DECLARE
  v_next_status machine_status;
BEGIN
  v_next_status := fn_machine_status_from_actual_dates(
    NEW.status,
    NEW.is_confirmed,
    NEW.factory_id,
    NEW.material_type,
    NEW.planned_material_date,
    NEW.actual_material_date,
    NEW.actual_shipping_date
  );

  IF v_next_status IS DISTINCT FROM NEW.status THEN
    UPDATE machines
    SET status = v_next_status, updated_at = now()
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_machine_status_on_actual_machine_dates ON machines;

CREATE TRIGGER trg_update_machine_status_on_actual_machine_dates
  AFTER UPDATE OF actual_material_date, actual_shipping_date ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_actual_machine_dates();

CREATE OR REPLACE FUNCTION fn_update_machine_status_on_actual_shipping_stage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage_type = 'actual_shipping'
     AND NEW.date_end IS NOT NULL
     AND (OLD.date_end IS NULL OR OLD.date_end IS DISTINCT FROM NEW.date_end) THEN
    UPDATE machines
    SET status = 'shipped', updated_at = now()
    WHERE id = NEW.machine_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_update_machine_status_actual_shipping_stage
  AFTER UPDATE OF date_end ON production_stages
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_machine_status_on_actual_shipping_stage();

UPDATE machines
SET status = fn_machine_status_from_actual_dates(
      status,
      is_confirmed,
      factory_id,
      material_type,
      planned_material_date,
      actual_material_date,
      actual_shipping_date
    ),
    updated_at = now()
WHERE status IN ('in_production', 'material_received', 'shipped');
