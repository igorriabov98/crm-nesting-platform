-- Telegram reminders for meeting agenda notifications.
-- One row per recipient keeps the 30-minute reminder idempotent.

CREATE TABLE IF NOT EXISTS meeting_telegram_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reminder_type text NOT NULL DEFAULT 'agenda_30_min',
  sent_at timestamptz,
  telegram_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(meeting_id, user_id, reminder_type)
);

CREATE INDEX IF NOT EXISTS idx_meeting_telegram_reminders_meeting
  ON meeting_telegram_reminders(meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_telegram_reminders_user
  ON meeting_telegram_reminders(user_id);

ALTER TABLE meeting_telegram_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_telegram_reminders_select_directors"
  ON meeting_telegram_reminders;

CREATE POLICY "meeting_telegram_reminders_select_directors"
  ON meeting_telegram_reminders
  FOR SELECT
  USING (is_director());

DROP POLICY IF EXISTS "meeting_telegram_reminders_manage_directors"
  ON meeting_telegram_reminders;

CREATE POLICY "meeting_telegram_reminders_manage_directors"
  ON meeting_telegram_reminders
  FOR ALL
  USING (is_director())
  WITH CHECK (is_director());
