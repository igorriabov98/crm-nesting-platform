ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;
