ALTER TABLE inventory
  DROP CONSTRAINT IF EXISTS inventory_source_reservation_id_fkey;

ALTER TABLE inventory
  ADD CONSTRAINT inventory_source_reservation_id_fkey
  FOREIGN KEY (source_reservation_id)
  REFERENCES inventory_reservations(id)
  ON DELETE SET NULL;
