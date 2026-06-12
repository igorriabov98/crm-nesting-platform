ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS source_machine_id uuid REFERENCES machines(id) ON DELETE SET NULL;
