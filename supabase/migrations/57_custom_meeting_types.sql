CREATE TABLE IF NOT EXISTS meeting_types (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  label text NOT NULL,
  color text NOT NULL DEFAULT 'blue',
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO meeting_types (key, label, color, is_system)
VALUES
  ('general', 'Общее собрание', 'blue', true),
  ('factory_bergovo', 'Собрание Берегово', 'green', true),
  ('factory_uzhgorod', 'Собрание Ужгород', 'orange', true)
ON CONFLICT (key) DO UPDATE
SET
  label = EXCLUDED.label,
  color = EXCLUDED.color,
  is_system = true,
  is_active = true,
  updated_at = now();

ALTER TABLE meetings
  ALTER COLUMN meeting_type TYPE text USING meeting_type::text;

ALTER TABLE meeting_recurrence_rules
  ALTER COLUMN meeting_type TYPE text USING meeting_type::text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meetings_meeting_type_fk'
  ) THEN
    ALTER TABLE meetings
      ADD CONSTRAINT meetings_meeting_type_fk
      FOREIGN KEY (meeting_type) REFERENCES meeting_types(key);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meeting_recurrence_rules_meeting_type_fk'
  ) THEN
    ALTER TABLE meeting_recurrence_rules
      ADD CONSTRAINT meeting_recurrence_rules_meeting_type_fk
      FOREIGN KEY (meeting_type) REFERENCES meeting_types(key);
  END IF;
END $$;

ALTER TABLE meeting_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_types_select" ON meeting_types;
CREATE POLICY "meeting_types_select" ON meeting_types
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meeting_types_modify" ON meeting_types;
CREATE POLICY "meeting_types_modify" ON meeting_types
  FOR ALL USING (is_director()) WITH CHECK (is_director());
