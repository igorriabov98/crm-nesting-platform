-- Keep inventory history when a machine is hard-deleted.
-- Active reservations are released first; historical transactions keep their
-- stock effect and lose only the deleted machine reference.

ALTER TABLE inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_machine_id_fkey;

ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_machine_id_fkey
  FOREIGN KEY (machine_id)
  REFERENCES machines(id)
  ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION fn_delete_machine_with_inventory_cleanup(
  p_machine_id uuid,
  p_performed_by uuid
)
RETURNS void AS $$
DECLARE
  v_role user_role;
  v_reservation record;
  v_deleted_id uuid;
BEGIN
  IF p_machine_id IS NULL THEN
    RAISE EXCEPTION 'Machine id is required';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  IF p_performed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete machine on behalf of another user';
  END IF;

  SELECT role INTO v_role
  FROM users
  WHERE id = auth.uid();

  IF v_role NOT IN ('financial_director', 'commercial_director', 'planning_director') THEN
    RAISE EXCEPTION 'Only directors can delete machines';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM machines WHERE id = p_machine_id FOR UPDATE) THEN
    RAISE EXCEPTION 'Machine not found or already deleted';
  END IF;

  FOR v_reservation IN
    SELECT id
    FROM inventory_reservations
    WHERE machine_id = p_machine_id
  LOOP
    PERFORM fn_unreserve_inventory_reservation(
      v_reservation.id,
      p_performed_by,
      'Unreserve stock before machine deletion'
    );
  END LOOP;

  UPDATE inventory_transactions
  SET machine_id = NULL
  WHERE machine_id = p_machine_id;

  DELETE FROM machines
  WHERE id = p_machine_id
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'Machine not found or already deleted';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION fn_delete_machine_with_inventory_cleanup(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_delete_machine_with_inventory_cleanup(uuid, uuid) TO authenticated;
