-- Recurring meeting schedules and generated occurrences.

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS recurrence_rule_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_occurrence_date date;

CREATE TABLE IF NOT EXISTS meeting_recurrence_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_type meeting_type NOT NULL,
  title text,
  meeting_time time NOT NULL DEFAULT '10:00',
  weekdays smallint[] NOT NULL,
  start_date date NOT NULL,
  end_date date,
  occurrence_count integer,
  attendee_ids uuid[] NOT NULL DEFAULT '{}',
  external_attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT meeting_recurrence_weekdays_not_empty CHECK (array_length(weekdays, 1) BETWEEN 1 AND 7),
  CONSTRAINT meeting_recurrence_weekdays_valid CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT meeting_recurrence_count_valid CHECK (occurrence_count IS NULL OR occurrence_count BETWEEN 1 AND 104),
  CONSTRAINT meeting_recurrence_end_after_start CHECK (end_date IS NULL OR end_date >= start_date)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meetings_recurrence_rule_id_fkey'
  ) THEN
    ALTER TABLE meetings
      ADD CONSTRAINT meetings_recurrence_rule_id_fkey
      FOREIGN KEY (recurrence_rule_id)
      REFERENCES meeting_recurrence_rules(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_meetings_recurrence_rule_date
  ON meetings(recurrence_rule_id, meeting_date);

CREATE INDEX IF NOT EXISTS idx_meeting_recurrence_rules_active
  ON meeting_recurrence_rules(is_active, start_date);

ALTER TABLE meeting_recurrence_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_recurrence_rules_select" ON meeting_recurrence_rules;
CREATE POLICY "meeting_recurrence_rules_select" ON meeting_recurrence_rules
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "meeting_recurrence_rules_modify" ON meeting_recurrence_rules;
CREATE POLICY "meeting_recurrence_rules_modify" ON meeting_recurrence_rules
  FOR ALL USING (is_director()) WITH CHECK (is_director());
