-- Meeting duration, agenda resolution, and lazy lifecycle support.

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'meeting_unresolved_agenda';

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE meetings
  DROP CONSTRAINT IF EXISTS meetings_duration_minutes_valid;

ALTER TABLE meetings
  ADD CONSTRAINT meetings_duration_minutes_valid
  CHECK (duration_minutes BETWEEN 15 AND 240 AND duration_minutes % 15 = 0);

ALTER TABLE meeting_recurrence_rules
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE meeting_recurrence_rules
  DROP CONSTRAINT IF EXISTS meeting_recurrence_duration_minutes_valid;

ALTER TABLE meeting_recurrence_rules
  ADD CONSTRAINT meeting_recurrence_duration_minutes_valid
  CHECK (duration_minutes BETWEEN 15 AND 240 AND duration_minutes % 15 = 0);

ALTER TABLE meeting_agenda_items
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_decision_id uuid REFERENCES meeting_decisions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS carried_from_item_id uuid REFERENCES meeting_agenda_items(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_agenda_source_key_unique
  ON meeting_agenda_items(meeting_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_agenda_carried_from_unique
  ON meeting_agenda_items(meeting_id, carried_from_item_id)
  WHERE carried_from_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_unresolved
  ON meeting_agenda_items(meeting_id, resolved_at)
  WHERE resolved_at IS NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS related_meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_related_meeting_type_unique
  ON tasks(related_meeting_id, task_type)
  WHERE related_meeting_id IS NOT NULL;
