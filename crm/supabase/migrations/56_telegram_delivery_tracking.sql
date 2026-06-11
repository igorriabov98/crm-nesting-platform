ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS telegram_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_error text;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS telegram_error text;

CREATE INDEX IF NOT EXISTS idx_notifications_telegram_pending
  ON notifications(user_id, created_at)
  WHERE telegram_notified_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_telegram_pending
  ON tasks(assigned_to, created_at)
  WHERE notified_at IS NULL
    AND status = 'pending';
