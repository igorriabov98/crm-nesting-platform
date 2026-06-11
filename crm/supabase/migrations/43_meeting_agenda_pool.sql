-- Shared agenda pool for planning director distribution.

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'agenda_pool_distribution';

ALTER TABLE tasks
  ALTER COLUMN machine_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS meeting_agenda_pool_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  source_type text NOT NULL,
  machine_id uuid REFERENCES machines(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'assigned', 'dismissed')),
  assigned_meeting_id uuid REFERENCES meetings(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_pool_status_created
  ON meeting_agenda_pool_items(status, created_at);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_pool_machine
  ON meeting_agenda_pool_items(machine_id);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_pool_assigned_meeting
  ON meeting_agenda_pool_items(assigned_meeting_id);

ALTER TABLE meeting_agenda_pool_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agenda_pool_select" ON meeting_agenda_pool_items;
CREATE POLICY "agenda_pool_select" ON meeting_agenda_pool_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "agenda_pool_modify" ON meeting_agenda_pool_items;
CREATE POLICY "agenda_pool_modify" ON meeting_agenda_pool_items
  FOR ALL USING (is_director()) WITH CHECK (is_director());
