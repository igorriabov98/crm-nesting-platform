-- Skip coating-dependent production stages based on machine items.
-- Samples are stored in machine_items too, so they are included in the same check.

CREATE OR REPLACE FUNCTION fn_sync_coating_dependent_production_stages(p_machine_id uuid)
RETURNS void AS $$
DECLARE
  v_has_zinc boolean;
  v_has_painting boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1
      FROM machine_items
      WHERE machine_id = p_machine_id
        AND coating = 'zinc'
    ),
    EXISTS (
      SELECT 1
      FROM machine_items
      WHERE machine_id = p_machine_id
        AND coating = 'powder_coating'
    )
  INTO v_has_zinc, v_has_painting;

  UPDATE production_stages
  SET is_skipped = NOT v_has_zinc
  WHERE machine_id = p_machine_id
    AND stage_type IN ('galvanizing', 'post_galvanizing_cleaning');

  UPDATE production_stages
  SET is_skipped = NOT v_has_painting
  WHERE machine_id = p_machine_id
    AND stage_type = 'painting';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION trg_sync_coating_dependent_production_stages()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM fn_sync_coating_dependent_production_stages(OLD.machine_id);
    RETURN OLD;
  END IF;

  PERFORM fn_sync_coating_dependent_production_stages(NEW.machine_id);

  IF TG_OP = 'UPDATE' AND OLD.machine_id IS DISTINCT FROM NEW.machine_id THEN
    PERFORM fn_sync_coating_dependent_production_stages(OLD.machine_id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_coating_dependent_production_stages ON machine_items;

CREATE TRIGGER trg_sync_coating_dependent_production_stages
  AFTER INSERT OR UPDATE OF coating, machine_id OR DELETE ON machine_items
  FOR EACH ROW
  EXECUTE FUNCTION trg_sync_coating_dependent_production_stages();

SELECT fn_sync_coating_dependent_production_stages(id)
FROM machines;
