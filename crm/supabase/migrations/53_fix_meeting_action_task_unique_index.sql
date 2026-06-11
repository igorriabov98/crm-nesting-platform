DROP INDEX IF EXISTS idx_tasks_related_meeting_type_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_related_meeting_unresolved_unique
  ON tasks(related_meeting_id, task_type)
  WHERE related_meeting_id IS NOT NULL
    AND task_type = 'meeting_unresolved_agenda';
