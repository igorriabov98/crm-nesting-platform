ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'meeting_action_item';

ALTER TABLE meeting_action_items
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS related_task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

UPDATE meeting_action_items
SET title = description
WHERE title IS NULL OR btrim(title) = '';

ALTER TABLE meeting_action_items
  ALTER COLUMN title SET NOT NULL,
  ALTER COLUMN description DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meeting_action_items_related_task_id
  ON meeting_action_items(related_task_id);
