-- Machine confirmation state and notifications.
ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS is_confirmed boolean NOT NULL DEFAULT false;

DROP VIEW IF EXISTS machines_with_totals CASCADE;

CREATE VIEW machines_with_totals AS
SELECT
  m.*,
  COALESCE(
    (SELECT SUM(mi.weight * mi.quantity) / 1000
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_weight,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS total_items_cost,
  COALESCE(
    (SELECT SUM(me.amount)
     FROM machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_expenses,
  COALESCE(
    (SELECT SUM(mi.price * mi.quantity)
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) + COALESCE(
    (SELECT SUM(me.amount)
     FROM machine_expenses me
     WHERE me.machine_id = m.id),
    0
  ) AS total_cost,
  COALESCE(
    (SELECT COUNT(mi.id)
     FROM machine_items mi
     WHERE mi.machine_id = m.id),
    0
  ) AS item_count,
  EXISTS(
    SELECT 1
    FROM machine_items mi
    WHERE mi.machine_id = m.id AND mi.coating = 'zinc'
  ) AS has_zinc,
  EXISTS(
    SELECT 1
    FROM machine_items mi
    WHERE mi.machine_id = m.id AND mi.coating = 'powder_coating'
  ) AS has_painting
FROM machines m;

DROP TRIGGER IF EXISTS trg_notify_new_machine ON machines;
DROP TRIGGER IF EXISTS trg_notify_confirmation_change ON machines;

CREATE OR REPLACE FUNCTION fn_notify_new_machine()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_message text;
  v_type text;
BEGIN
  IF NEW.is_confirmed THEN
    v_title := 'Новая машина (подтверждена)';
    v_message := 'Машина "' || NEW.name || '" создана и подтверждена.';
    v_type := 'new_machine_confirmed';
  ELSE
    v_title := 'Новая машина (не подтверждена)';
    v_message := 'Машина "' || NEW.name || '" создана, но не подтверждена.';
    v_type := 'new_machine_unconfirmed';
  END IF;

  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT u.id, v_type, v_title, v_message, NEW.id
  FROM users u
  WHERE u.role IN ('financial_director', 'commercial_director', 'planning_director', 'production_manager')
    AND u.is_active = true;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_new_machine
  AFTER INSERT ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_new_machine();

CREATE OR REPLACE FUNCTION fn_notify_confirmation_change()
RETURNS TRIGGER AS $$
DECLARE
  v_title text;
  v_message text;
  v_type text;
BEGIN
  IF OLD.is_confirmed != NEW.is_confirmed THEN
    IF NEW.is_confirmed THEN
      v_title := 'Машина подтверждена';
      v_message := 'Машина "' || NEW.name || '" подтверждена.';
      v_type := 'machine_confirmed';
    ELSE
      v_title := 'Подтверждение снято';
      v_message := 'С машины "' || NEW.name || '" снято подтверждение.';
      v_type := 'machine_unconfirmed';
    END IF;

    INSERT INTO notifications (user_id, type, title, message, related_machine_id)
    SELECT u.id, v_type, v_title, v_message, NEW.id
    FROM users u
    WHERE u.role IN ('financial_director', 'commercial_director', 'planning_director', 'production_manager')
      AND u.is_active = true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_confirmation_change
  AFTER UPDATE OF is_confirmed ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_confirmation_change();
