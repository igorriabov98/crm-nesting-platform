-- Scope production managers to their own factory plus unassigned machines.

DROP POLICY IF EXISTS "Machines - Select factory" ON machines;
DROP POLICY IF EXISTS "machines_select" ON machines;

CREATE POLICY "machines_select" ON machines
  FOR SELECT TO authenticated
  USING (
    CASE
      WHEN get_user_role() = 'production_manager' THEN
        factory_id = get_user_factory_id() OR factory_id IS NULL
      ELSE
        true
    END
  );

DROP POLICY IF EXISTS "Production Stages - Select factory" ON production_stages;
DROP POLICY IF EXISTS "production_stages_select" ON production_stages;

CREATE POLICY "production_stages_select" ON production_stages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = production_stages.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );

DROP POLICY IF EXISTS "Supply Items - Select factory" ON supply_items;
DROP POLICY IF EXISTS "supply_items_select" ON supply_items;

CREATE POLICY "supply_items_select" ON supply_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = supply_items.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );

DROP POLICY IF EXISTS "machine_items_select" ON machine_items;

CREATE POLICY "machine_items_select" ON machine_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_items.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );

DROP POLICY IF EXISTS "machine_expenses_select" ON machine_expenses;

CREATE POLICY "machine_expenses_select" ON machine_expenses
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_expenses.machine_id
        AND (
          CASE
            WHEN get_user_role() = 'production_manager' THEN
              m.factory_id = get_user_factory_id() OR m.factory_id IS NULL
            ELSE
              true
          END
        )
    )
  );

CREATE OR REPLACE FUNCTION notify_production_managers_for_machine(
  p_factory_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_machine_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (user_id, type, title, message, related_machine_id)
  SELECT u.id, p_type, p_title, p_message, p_machine_id
  FROM users u
  WHERE u.role = 'production_manager'
    AND u.is_active = true
    AND (p_factory_id IS NULL OR u.factory_id = p_factory_id);
END;
$$;

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
  WHERE u.role IN ('financial_director', 'commercial_director', 'planning_director')
    AND u.is_active = true;

  PERFORM notify_production_managers_for_machine(NEW.factory_id, v_type, v_title, v_message, NEW.id);

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
    WHERE u.role IN ('financial_director', 'commercial_director', 'planning_director')
      AND u.is_active = true;

    PERFORM notify_production_managers_for_machine(NEW.factory_id, v_type, v_title, v_message, NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_notify_confirmation_change
  AFTER UPDATE OF is_confirmed ON machines
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_confirmation_change();

DO $$
DECLARE
  rec record;
  v_replacement_id uuid;
BEGIN
  FOR rec IN
    SELECT
      t.id AS task_id,
      t.assigned_to,
      m.factory_id AS machine_factory_id
    FROM tasks t
    JOIN users u ON u.id = t.assigned_to
    JOIN machines m ON m.id = t.machine_id
    WHERE u.role = 'production_manager'
      AND t.status IN ('pending', 'in_progress')
      AND m.factory_id IS NOT NULL
      AND u.factory_id IS DISTINCT FROM m.factory_id
  LOOP
    SELECT id
    INTO v_replacement_id
    FROM users
    WHERE role = 'production_manager'
      AND factory_id = rec.machine_factory_id
      AND is_active = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_replacement_id IS NOT NULL THEN
      UPDATE tasks
      SET assigned_to = v_replacement_id,
          updated_at = now()
      WHERE id = rec.task_id;
    ELSE
      RAISE NOTICE 'No active production manager found for factory %, task % was not reassigned',
        rec.machine_factory_id,
        rec.task_id;
    END IF;
  END LOOP;
END $$;
