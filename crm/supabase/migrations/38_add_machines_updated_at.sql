ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE machines
SET updated_at = COALESCE(updated_at, created_at, now());
