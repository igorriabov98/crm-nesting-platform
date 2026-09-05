-- Meeting system v2: configurable templates, schedules, questions and rules.
-- Legacy meeting rows remain readable; future occurrences are attached to v2 templates.

ALTER TYPE public.meeting_status ADD VALUE IF NOT EXISTS 'in_progress';

CREATE TABLE IF NOT EXISTS public.meeting_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_type_key text UNIQUE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  description text,
  color text NOT NULL DEFAULT 'blue',
  scope_type text NOT NULL DEFAULT 'all'
    CHECK (scope_type IN ('all', 'factory', 'department', 'custom')),
  scope_id uuid,
  facilitator_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  default_duration_minutes integer NOT NULL DEFAULT 60
    CHECK (default_duration_minutes BETWEEN 15 AND 480 AND default_duration_minutes % 15 = 0),
  accepted_categories text[] NOT NULL DEFAULT ARRAY[]::text[],
  reminder_offsets_minutes integer[] NOT NULL DEFAULT ARRAY[1440, 30],
  notification_channels text[] NOT NULL DEFAULT ARRAY['crm', 'telegram'],
  fallback_template_id uuid REFERENCES public.meeting_templates(id) ON DELETE SET NULL,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_templates_active
  ON public.meeting_templates(is_active, name);

CREATE TABLE IF NOT EXISTS public.meeting_template_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.meeting_templates(id) ON DELETE CASCADE,
  participant_type text NOT NULL
    CHECK (participant_type IN ('user', 'role', 'department', 'external')),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  role public.user_role,
  department_id uuid REFERENCES public.departments(id) ON DELETE CASCADE,
  external_name text,
  external_role text,
  external_email text,
  external_phone text,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meeting_template_participant_subject CHECK (
    (participant_type = 'user' AND user_id IS NOT NULL)
    OR (participant_type = 'role' AND role IS NOT NULL)
    OR (participant_type = 'department' AND department_id IS NOT NULL)
    OR (participant_type = 'external' AND external_name IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_meeting_template_participants_template
  ON public.meeting_template_participants(template_id);

CREATE TABLE IF NOT EXISTS public.meeting_schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.meeting_templates(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  recurrence_kind text NOT NULL
    CHECK (recurrence_kind IN ('one_time', 'weekly', 'monthly', 'interval')),
  start_date date NOT NULL,
  start_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'Europe/Uzhgorod',
  duration_minutes integer NOT NULL DEFAULT 60
    CHECK (duration_minutes BETWEEN 15 AND 480 AND duration_minutes % 15 = 0),
  weekdays smallint[] NOT NULL DEFAULT ARRAY[]::smallint[],
  month_day smallint CHECK (month_day BETWEEN 1 AND 31),
  interval_days integer CHECK (interval_days BETWEEN 1 AND 365),
  end_date date,
  occurrence_count integer CHECK (occurrence_count BETWEEN 1 AND 520),
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, version_no),
  CONSTRAINT meeting_schedule_end_valid CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT meeting_schedule_effective_valid CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT meeting_schedule_end_mode CHECK (end_date IS NULL OR occurrence_count IS NULL),
  CONSTRAINT meeting_schedule_recurrence_config CHECK (
    recurrence_kind = 'one_time'
    OR (recurrence_kind = 'weekly' AND array_length(weekdays, 1) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[])
    OR (recurrence_kind = 'monthly' AND month_day IS NOT NULL)
    OR (recurrence_kind = 'interval' AND interval_days IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_meeting_schedule_versions_active
  ON public.meeting_schedule_versions(template_id, is_active, effective_from);

CREATE OR REPLACE FUNCTION public.meeting_postgres_timezone_v2(p_timezone text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT name FROM pg_timezone_names WHERE name = p_timezone LIMIT 1),
    (SELECT name FROM pg_timezone_names WHERE name = 'Europe/Kyiv' LIMIT 1),
    'UTC'
  );
$$;

COMMENT ON FUNCTION public.meeting_postgres_timezone_v2(text) IS
  'Keeps the Europe/Uzhgorod business timezone label compatible with PostgreSQL builds where its historical IANA alias is absent.';

ALTER TABLE public.meetings
  ALTER COLUMN meeting_type DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.meeting_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schedule_version_id uuid REFERENCES public.meeting_schedule_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS facilitator_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS agenda_snapshot_at timestamptz,
  ADD COLUMN IF NOT EXISTS legacy_read_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS occurrence_key text;

CREATE TABLE IF NOT EXISTS public.meeting_schedule_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL UNIQUE REFERENCES public.meetings(id) ON DELETE CASCADE,
  schedule_version_id uuid REFERENCES public.meeting_schedule_versions(id) ON DELETE SET NULL,
  exception_type text NOT NULL CHECK (exception_type IN ('rescheduled', 'cancelled')),
  original_starts_at timestamptz NOT NULL,
  override_starts_at timestamptz,
  override_ends_at timestamptz,
  override_title text,
  reason text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_occurrence_key
  ON public.meetings(occurrence_key);
CREATE INDEX IF NOT EXISTS idx_meetings_template_starts
  ON public.meetings(template_id, starts_at, status);

ALTER TABLE public.meeting_telegram_reminders
  ADD COLUMN IF NOT EXISTS crm_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS crm_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS telegram_locked_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_meeting_reminder_delivery_v2(
  p_meeting_id uuid,
  p_user_id uuid,
  p_reminder_type text,
  p_channel text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_channel NOT IN ('crm', 'telegram') THEN
    RAISE EXCEPTION 'Недопустимый канал напоминания';
  END IF;
  INSERT INTO public.meeting_telegram_reminders(meeting_id, user_id, reminder_type)
  VALUES (p_meeting_id, p_user_id, p_reminder_type)
  ON CONFLICT (meeting_id, user_id, reminder_type) DO NOTHING;

  IF p_channel = 'crm' THEN
    UPDATE public.meeting_telegram_reminders
    SET crm_locked_at = now(), updated_at = now()
    WHERE meeting_id = p_meeting_id
      AND user_id = p_user_id
      AND reminder_type = p_reminder_type
      AND crm_sent_at IS NULL
      AND (crm_locked_at IS NULL OR crm_locked_at < now() - interval '5 minutes')
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.meeting_telegram_reminders
    SET telegram_locked_at = now(), updated_at = now()
    WHERE meeting_id = p_meeting_id
      AND user_id = p_user_id
      AND reminder_type = p_reminder_type
      AND sent_at IS NULL
      AND (telegram_locked_at IS NULL OR telegram_locked_at < now() - interval '5 minutes')
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_meeting_reminder_delivery_v2(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_meeting_reminder_delivery_v2(uuid, uuid, text, text) TO service_role;
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS related_meeting_id uuid REFERENCES public.meetings(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_notifications_related_meeting
  ON public.notifications(related_meeting_id)
  WHERE related_meeting_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.meeting_question_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  title_template text NOT NULL CHECK (char_length(btrim(title_template)) BETWEEN 2 AND 300),
  description_template text,
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  expected_outcome text,
  allowed_outcomes text[] NOT NULL DEFAULT ARRAY['decision', 'task', 'defer', 'dismiss'],
  default_responsible_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  task_sla_days integer CHECK (task_sla_days BETWEEN 0 AND 365),
  source_url_template text,
  fixed_for_every_occurrence boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meeting_template_questions (
  template_id uuid NOT NULL REFERENCES public.meeting_templates(id) ON DELETE CASCADE,
  question_template_id uuid NOT NULL REFERENCES public.meeting_question_templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY(template_id, question_template_id)
);

CREATE TABLE IF NOT EXISTS public.meeting_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 160),
  question_template_id uuid NOT NULL REFERENCES public.meeting_question_templates(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  current_version_id uuid,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meeting_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.meeting_rules(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('record_state', 'relative_time', 'field_change', 'aggregate')),
  source_key text NOT NULL,
  dsl jsonb NOT NULL,
  grouping jsonb NOT NULL DEFAULT '{}'::jsonb,
  routing jsonb NOT NULL DEFAULT '{}'::jsonb,
  lifecycle jsonb NOT NULL DEFAULT '{"clearBehavior":"auto_close"}'::jsonb,
  notifications jsonb NOT NULL DEFAULT '{"channels":["crm","telegram"]}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rule_id, version_no),
  CONSTRAINT meeting_rule_version_dsl_object CHECK (jsonb_typeof(dsl) = 'object'),
  CONSTRAINT meeting_rule_version_grouping_object CHECK (jsonb_typeof(grouping) = 'object'),
  CONSTRAINT meeting_rule_version_routing_object CHECK (jsonb_typeof(routing) = 'object')
);

ALTER TABLE public.meeting_rules
  DROP CONSTRAINT IF EXISTS meeting_rules_current_version_id_fkey;
ALTER TABLE public.meeting_rules
  ADD CONSTRAINT meeting_rules_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES public.meeting_rule_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.meeting_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_template_id uuid REFERENCES public.meeting_question_templates(id) ON DELETE SET NULL,
  rule_id uuid REFERENCES public.meeting_rules(id) ON DELETE SET NULL,
  rule_version_id uuid REFERENCES public.meeting_rule_versions(id) ON DELETE SET NULL,
  assigned_meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  episode_key text NOT NULL,
  group_key text,
  source_type text NOT NULL,
  source_id text,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'assigned', 'in_meeting', 'on_control', 'deferred', 'resolved', 'auto_closed', 'dismissed')),
  factory_id uuid REFERENCES public.factories(id) ON DELETE SET NULL,
  department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL,
  responsible_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deadline date,
  source_url text,
  condition_active boolean NOT NULL DEFAULT true,
  condition_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_assignment_locked boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  priority_rank smallint GENERATED ALWAYS AS (
    CASE priority
      WHEN 'critical' THEN 4
      WHEN 'high' THEN 3
      WHEN 'normal' THEN 2
      ELSE 1
    END
  ) STORED,
  carry_count integer NOT NULL DEFAULT 0 CHECK (carry_count >= 0),
  legacy_agenda_item_id uuid REFERENCES public.meeting_agenda_items(id) ON DELETE SET NULL,
  legacy_pool_item_id uuid REFERENCES public.meeting_agenda_pool_items(id) ON DELETE SET NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_questions_active_episode
  ON public.meeting_questions(rule_id, episode_key)
  WHERE rule_id IS NOT NULL AND status IN ('new', 'assigned', 'in_meeting', 'on_control', 'deferred');
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_questions_legacy_agenda
  ON public.meeting_questions(legacy_agenda_item_id) WHERE legacy_agenda_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_questions_legacy_pool
  ON public.meeting_questions(legacy_pool_item_id) WHERE legacy_pool_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_questions_pool
  ON public.meeting_questions(status, is_pinned DESC, priority_rank DESC, deadline, opened_at);
CREATE INDEX IF NOT EXISTS idx_meeting_questions_assigned
  ON public.meeting_questions(assigned_meeting_id, status);

CREATE TABLE IF NOT EXISTS public.meeting_question_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.meeting_questions(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  source_type text NOT NULL,
  source_id text,
  title text NOT NULL,
  source_url text,
  condition_active boolean NOT NULL DEFAULT true,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  cleared_at timestamptz,
  UNIQUE(question_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_meeting_question_members_active
  ON public.meeting_question_members(question_id, condition_active);

CREATE TABLE IF NOT EXISTS public.meeting_question_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.meeting_questions(id) ON DELETE CASCADE,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  outcome_type text NOT NULL CHECK (outcome_type IN ('decision', 'task', 'defer', 'dismiss', 'source_update')),
  decision_text text,
  responsible_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  deadline date,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meeting_question_task_links (
  question_id uuid NOT NULL REFERENCES public.meeting_questions(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  outcome_id uuid REFERENCES public.meeting_question_outcomes(id) ON DELETE SET NULL,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(question_id, task_id)
);

CREATE TABLE IF NOT EXISTS public.meeting_question_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id uuid NOT NULL REFERENCES public.meeting_questions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_question_events_question
  ON public.meeting_question_events(question_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.meeting_question_meeting_history (
  question_id uuid NOT NULL REFERENCES public.meeting_questions(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  agenda_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  entered_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY(question_id, meeting_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_question_history_meeting
  ON public.meeting_question_meeting_history(meeting_id, entered_at);

CREATE TABLE IF NOT EXISTS public.meeting_rule_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_key text NOT NULL,
  source_id text,
  operation text NOT NULL CHECK (operation IN ('insert', 'update', 'delete', 'timer', 'reconcile')),
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meeting_rule_events_pending
  ON public.meeting_rule_events(available_at, id) WHERE processed_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_meeting_rule_events_v2(p_limit integer DEFAULT 100)
RETURNS SETOF public.meeting_rule_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT event.id
    FROM public.meeting_rule_events event
    WHERE event.processed_at IS NULL
      AND event.available_at <= now()
      AND (event.locked_at IS NULL OR event.locked_at < now() - interval '5 minutes')
    ORDER BY event.id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
  )
  UPDATE public.meeting_rule_events event
  SET locked_at = now(), attempts = event.attempts + 1
  FROM claimed
  WHERE event.id = claimed.id
  RETURNING event.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_meeting_rule_event_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current jsonb := '{}'::jsonb;
  v_previous jsonb := '{}'::jsonb;
  v_source_id text;
  v_changed_fields text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP <> 'DELETE' THEN v_current := to_jsonb(NEW); END IF;
  IF TG_OP <> 'INSERT' THEN v_previous := to_jsonb(OLD); END IF;
  v_source_id := COALESCE(v_current->>'id', v_previous->>'id');

  SELECT COALESCE(array_agg(keys.key ORDER BY keys.key), ARRAY[]::text[])
  INTO v_changed_fields
  FROM (
    SELECT COALESCE(current_values.key, previous_values.key) AS key
    FROM jsonb_each(v_current) current_values
    FULL JOIN jsonb_each(v_previous) previous_values USING (key)
    WHERE current_values.value IS DISTINCT FROM previous_values.value
  ) keys;

  INSERT INTO public.meeting_rule_events(source_key, source_id, operation, changed_fields, payload)
  VALUES (
    TG_ARGV[0],
    v_source_id,
    lower(TG_OP),
    v_changed_fields,
    jsonb_build_object('current', v_current, 'previous', v_previous, 'table', TG_TABLE_NAME)
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE trigger_row record;
BEGIN
  FOR trigger_row IN
    SELECT * FROM (VALUES
      ('tasks', 'tasks'),
      ('department_requests', 'department_requests'),
      ('consumable_requests', 'consumable_requests'),
      ('machines', 'machines'),
      ('production_stages', 'production_stages'),
      ('production_stage_intervals', 'production_stages'),
      ('inventory_transfers', 'inventory'),
      ('inventory_transfer_items', 'inventory'),
      ('machine_outsourcing_transport_needs', 'outsourcing_transport'),
      ('machine_outsourcing_operations', 'outsourcing_transport'),
      ('employee_assignments', 'people'),
      ('employee_vacations', 'people'),
      ('supply_order_delivery_schedules', 'supply_materials'),
      ('request_sheet_metal', 'supply_materials'),
      ('request_round_tube', 'supply_materials'),
      ('request_circle', 'supply_materials'),
      ('request_pipe', 'supply_materials'),
      ('request_knives', 'supply_materials'),
      ('request_components', 'supply_materials'),
      ('request_paint', 'supply_materials'),
      ('request_mesh', 'supply_materials'),
      ('request_chain_cord', 'supply_materials')
    ) AS trigger_sources(table_name, source_key)
  LOOP
    IF to_regclass('public.' || trigger_row.table_name) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_' || trigger_row.table_name || '_meeting_rules_v2', trigger_row.table_name);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enqueue_meeting_rule_event_v2(%L)',
        'trg_' || trigger_row.table_name || '_meeting_rules_v2', trigger_row.table_name, trigger_row.source_key
      );
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_meeting_rule_reconciliation_v2()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.meeting_rule_events(source_key, operation, payload)
  SELECT DISTINCT v.source_key, 'reconcile', jsonb_build_object('scheduledAt', now())
  FROM public.meeting_rules r
  JOIN public.meeting_rule_versions v ON v.id = r.current_version_id
  WHERE r.status = 'published'
    AND NOT EXISTS (
      SELECT 1 FROM public.meeting_rule_events pending
      WHERE pending.source_key = v.source_key
        AND pending.operation = 'reconcile'
        AND pending.processed_at IS NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-rules-reconcile-v2') THEN
    PERFORM cron.unschedule('meeting-rules-reconcile-v2');
  END IF;
END $$;
SELECT cron.schedule(
  'meeting-rules-reconcile-v2',
  '*/15 * * * *',
  $$ SELECT public.enqueue_meeting_rule_reconciliation_v2(); $$
);

CREATE OR REPLACE FUNCTION public.extend_meeting_schedule_horizon_v2(p_horizon_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_inserted integer := 0;
BEGIN
  IF p_horizon_days < 1 OR p_horizon_days > 180 THEN
    RAISE EXCEPTION 'Горизонт должен быть от 1 до 180 дней';
  END IF;

  WITH possible_dates AS (
    SELECT schedule.*, template.name AS template_name,
           template.legacy_type_key, template.facilitator_user_id,
           candidate_date::date AS meeting_date
    FROM public.meeting_schedule_versions schedule
    JOIN public.meeting_templates template ON template.id = schedule.template_id
    CROSS JOIN LATERAL generate_series(
      schedule.start_date::timestamp,
      (CURRENT_DATE + p_horizon_days)::timestamp,
      interval '1 day'
    ) candidate_date
    WHERE schedule.is_active AND template.is_active
      AND candidate_date::date >= schedule.effective_from
      AND (schedule.effective_to IS NULL OR candidate_date::date <= schedule.effective_to)
      AND (schedule.end_date IS NULL OR candidate_date::date <= schedule.end_date)
      AND (
        (schedule.recurrence_kind = 'one_time' AND candidate_date::date = schedule.start_date)
        OR (schedule.recurrence_kind = 'weekly' AND extract(isodow FROM candidate_date)::smallint = ANY(schedule.weekdays))
        OR (schedule.recurrence_kind = 'monthly' AND extract(day FROM candidate_date)::integer = LEAST(
          schedule.month_day,
          extract(day FROM (date_trunc('month', candidate_date) + interval '1 month - 1 day'))::integer
        ))
        OR (schedule.recurrence_kind = 'interval' AND (candidate_date::date - schedule.start_date) % schedule.interval_days = 0)
      )
  ), ranked AS (
    SELECT possible_dates.*,
           row_number() OVER (PARTITION BY id ORDER BY meeting_date) AS occurrence_no
    FROM possible_dates
  ), inserted AS (
    INSERT INTO public.meetings(
      meeting_type, title, meeting_date, meeting_time, status, created_by,
      duration_minutes, template_id, schedule_version_id, facilitator_user_id,
      starts_at, ends_at, occurrence_key
    )
    SELECT legacy_type_key, template_name, meeting_date, start_time, 'planned',
           created_by, duration_minutes, template_id, id, facilitator_user_id,
           (meeting_date + start_time) AT TIME ZONE public.meeting_postgres_timezone_v2(timezone),
           ((meeting_date + start_time) AT TIME ZONE public.meeting_postgres_timezone_v2(timezone)) + make_interval(mins => duration_minutes),
           id::text || ':' || meeting_date::text || ':' || start_time::text
    FROM ranked
    WHERE meeting_date >= CURRENT_DATE
      AND (occurrence_count IS NULL OR occurrence_no <= occurrence_count)
    ON CONFLICT (occurrence_key) DO NOTHING
    RETURNING id, template_id
  ), direct_attendees AS (
    INSERT INTO public.meeting_attendees(meeting_id, user_id)
    SELECT inserted.id, participant.user_id
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'user'
    ON CONFLICT (meeting_id, user_id) DO NOTHING
  ), role_attendees AS (
    INSERT INTO public.meeting_attendees(meeting_id, user_id)
    SELECT DISTINCT inserted.id, app_user.id
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'role'
    JOIN public.users app_user ON app_user.role = participant.role AND app_user.is_active
    ON CONFLICT (meeting_id, user_id) DO NOTHING
  ), department_attendees AS (
    INSERT INTO public.meeting_attendees(meeting_id, user_id)
    SELECT DISTINCT inserted.id, member.user_id
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'department'
    JOIN public.department_members member ON member.department_id = participant.department_id
    ON CONFLICT (meeting_id, user_id) DO NOTHING
  ), external_attendees AS (
    INSERT INTO public.meeting_external_attendees(
      meeting_id, full_name, role_description, email, phone
    )
    SELECT inserted.id, participant.external_name, participant.external_role,
           participant.external_email, participant.external_phone
    FROM inserted
    JOIN public.meeting_template_participants participant
      ON participant.template_id = inserted.template_id
     AND participant.participant_type = 'external'
  ), fixed_questions AS (
    INSERT INTO public.meeting_questions(
      question_template_id, assigned_meeting_id, episode_key, source_type,
      title, description, category, priority, status, condition_active, created_by
    )
    SELECT question_template.id, inserted.id,
           'fixed:' || question_template.id::text || ':' || inserted.id::text,
           'fixed', question_template.title_template, question_template.description_template,
           question_template.category, question_template.priority, 'assigned', true, NULL
    FROM inserted
    JOIN public.meeting_template_questions template_question
      ON template_question.template_id = inserted.template_id
    JOIN public.meeting_question_templates question_template
      ON question_template.id = template_question.question_template_id
     AND question_template.is_active
  )
  SELECT count(*) INTO v_inserted FROM inserted;
  RETURN v_inserted;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-schedule-horizon-v2') THEN
    PERFORM cron.unschedule('meeting-schedule-horizon-v2');
  END IF;
END $$;
SELECT cron.schedule(
  'meeting-schedule-horizon-v2',
  '17 2 * * *',
  $$ SELECT public.extend_meeting_schedule_horizon_v2(90); $$
);
REVOKE ALL ON FUNCTION public.enqueue_meeting_rule_event_v2() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_meeting_rule_reconciliation_v2() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_meeting_rule_events_v2(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extend_meeting_schedule_horizon_v2(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_meeting_rule_reconciliation_v2() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_meeting_rule_events_v2(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_meeting_schedule_horizon_v2(integer) TO service_role;

CREATE TABLE IF NOT EXISTS public.meeting_rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.meeting_rules(id) ON DELETE SET NULL,
  rule_version_id uuid REFERENCES public.meeting_rule_versions(id) ON DELETE SET NULL,
  run_type text NOT NULL CHECK (run_type IN ('preview', 'event', 'reconcile', 'backfill')),
  execution_mode text NOT NULL DEFAULT 'active'
    CHECK (execution_mode IN ('shadow', 'active')),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  matched_count integer NOT NULL DEFAULT 0,
  group_count integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  closed_count integer NOT NULL DEFAULT 0,
  error_text text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.meeting_system_rollout_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('shadow', 'active')),
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.prevent_meeting_version_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Опубликованные версии совещаний и правил неизменяемы; создайте новую версию';
END;
$$;

DROP TRIGGER IF EXISTS trg_meeting_rule_versions_immutable_v2 ON public.meeting_rule_versions;
CREATE TRIGGER trg_meeting_rule_versions_immutable_v2
BEFORE UPDATE OR DELETE ON public.meeting_rule_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_meeting_version_mutation_v2();

CREATE OR REPLACE FUNCTION public.meeting_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['meeting_templates', 'meeting_question_templates', 'meeting_rules', 'meeting_questions']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_touch ON public.%I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER trg_%I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.meeting_touch_updated_at()', table_name, table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.can_view_meeting_resource(p_resource_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.role_permissions rp ON rp.role = u.role
      WHERE u.id = auth.uid()
        AND u.is_active IS DISTINCT FROM false
        AND rp.resource_key = p_resource_key
        AND (rp.can_view OR rp.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.department_access_permissions dap
        ON dap.department_id = dm.department_id
       AND dap.subject_scope = CASE WHEN dm.is_department_head THEN 'head' ELSE 'member' END
      WHERE dm.user_id = auth.uid()
        AND dap.resource_key = p_resource_key
        AND (dap.can_view OR dap.can_manage)
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.positions p ON p.id = dm.position_id
      WHERE dm.user_id = auth.uid() AND p.name = 'Администратор CRM'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_meeting_resource(p_resource_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.users u
      JOIN public.role_permissions rp ON rp.role = u.role
      WHERE u.id = auth.uid()
        AND u.is_active IS DISTINCT FROM false
        AND rp.resource_key = p_resource_key
        AND rp.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.department_access_permissions dap
        ON dap.department_id = dm.department_id
       AND dap.subject_scope = CASE WHEN dm.is_department_head THEN 'head' ELSE 'member' END
      WHERE dm.user_id = auth.uid()
        AND dap.resource_key = p_resource_key
        AND dap.can_manage
    )
    OR EXISTS (
      SELECT 1
      FROM public.department_members dm
      JOIN public.positions p ON p.id = dm.position_id
      WHERE dm.user_id = auth.uid() AND p.name = 'Администратор CRM'
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_meeting_resource(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_meeting_resource(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_meeting_resource(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_meeting_resource(text) TO authenticated, service_role;

ALTER TABLE public.meeting_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_template_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_schedule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_schedule_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_question_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_template_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_question_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_question_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_question_task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_question_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_question_meeting_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_rule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_rule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_system_rollout_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE policy_row record;
BEGIN
  FOR policy_row IN
    SELECT * FROM (VALUES
      ('meeting_templates', 'meeting_templates'),
      ('meeting_template_participants', 'meeting_templates'),
      ('meeting_schedule_versions', 'meeting_templates'),
      ('meeting_schedule_exceptions', 'meetings'),
      ('meeting_question_templates', 'meeting_question_templates'),
      ('meeting_template_questions', 'meeting_question_templates'),
      ('meeting_rules', 'meeting_rules'),
      ('meeting_rule_versions', 'meeting_rules'),
      ('meeting_questions', 'meetings_agenda_pool'),
      ('meeting_question_members', 'meetings_agenda_pool'),
      ('meeting_question_outcomes', 'meetings'),
      ('meeting_question_task_links', 'meetings'),
      ('meeting_question_events', 'meetings')
      ,('meeting_question_meeting_history', 'meetings')
      ,('meeting_system_rollout_events', 'meeting_rules')
    ) AS policies(table_name, resource_key)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_row.table_name || '_view', policy_row.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_meeting_resource(%L))',
      policy_row.table_name || '_view', policy_row.table_name, policy_row.resource_key
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_row.table_name || '_manage', policy_row.table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.can_manage_meeting_resource(%L)) WITH CHECK (public.can_manage_meeting_resource(%L))',
      policy_row.table_name || '_manage', policy_row.table_name, policy_row.resource_key, policy_row.resource_key
    );
  END LOOP;
END $$;

-- Runtime queues are only available to the service role.
REVOKE ALL ON public.meeting_rule_events, public.meeting_rule_runs FROM anon, authenticated;
GRANT ALL ON public.meeting_rule_events, public.meeting_rule_runs TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

CREATE OR REPLACE FUNCTION public.assign_meeting_question_v2(
  p_question_id uuid,
  p_meeting_id uuid,
  p_manual_lock boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_status text;
BEGIN
  IF NOT public.can_manage_meeting_resource('meetings_agenda_pool') THEN
    RAISE EXCEPTION 'Нет прав для управления пулом повесток';
  END IF;
  SELECT status::text INTO v_status FROM public.meetings WHERE id = p_meeting_id FOR UPDATE;
  IF v_status IS NULL OR v_status <> 'planned' THEN
    RAISE EXCEPTION 'Можно назначить только запланированное совещание';
  END IF;
  UPDATE public.meeting_questions
  SET assigned_meeting_id = p_meeting_id,
      status = 'assigned',
      manual_assignment_locked = p_manual_lock
  WHERE id = p_question_id
    AND status IN ('new', 'assigned', 'deferred', 'on_control');
  IF NOT FOUND THEN RAISE EXCEPTION 'Открытый вопрос не найден'; END IF;
  INSERT INTO public.meeting_question_events(question_id, event_type, meeting_id, actor_user_id)
  VALUES (p_question_id, 'assigned', p_meeting_id, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.start_meeting_v2(p_meeting_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_meeting_resource('meetings') THEN RAISE EXCEPTION 'Нет прав'; END IF;
  UPDATE public.meetings
  SET status = 'in_progress', started_at = now(), agenda_snapshot_at = now()
  WHERE id = p_meeting_id AND status::text = 'planned';
  IF NOT FOUND THEN RAISE EXCEPTION 'Совещание уже начато, завершено или отменено'; END IF;
  UPDATE public.meeting_questions SET status = 'in_meeting'
  WHERE assigned_meeting_id = p_meeting_id AND status = 'assigned';
  INSERT INTO public.meeting_question_meeting_history(question_id, meeting_id, agenda_snapshot)
  SELECT q.id, p_meeting_id, jsonb_build_object(
    'title', q.title,
    'description', q.description,
    'priority', q.priority,
    'category', q.category,
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', member.id, 'title', member.title, 'sourceUrl', member.source_url,
        'snapshot', member.snapshot
      ) ORDER BY member.opened_at)
      FROM public.meeting_question_members member
      WHERE member.question_id = q.id AND member.condition_active
    ), '[]'::jsonb)
  )
  FROM public.meeting_questions q
  WHERE q.assigned_meeting_id = p_meeting_id
  ON CONFLICT (question_id, meeting_id) DO NOTHING;
  INSERT INTO public.meeting_question_events(question_id, event_type, meeting_id, actor_user_id)
  SELECT id, 'meeting_started', p_meeting_id, auth.uid()
  FROM public.meeting_questions WHERE assigned_meeting_id = p_meeting_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_meeting_v2(p_meeting_id uuid, p_notes text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_carried integer;
BEGIN
  IF NOT public.can_manage_meeting_resource('meetings') THEN RAISE EXCEPTION 'Нет прав'; END IF;
  UPDATE public.meetings
  SET status = 'completed', completed_at = now(), notes = NULLIF(btrim(p_notes), '')
  WHERE id = p_meeting_id AND status::text IN ('planned', 'in_progress');
  IF NOT FOUND THEN RAISE EXCEPTION 'Совещание уже завершено или отменено'; END IF;

  INSERT INTO public.meeting_question_events(question_id, event_type, meeting_id, actor_user_id, details)
  SELECT id, 'carried_without_decision', p_meeting_id, auth.uid(), jsonb_build_object('carryCount', carry_count + 1)
  FROM public.meeting_questions
  WHERE assigned_meeting_id = p_meeting_id AND status IN ('assigned', 'in_meeting');
  GET DIAGNOSTICS v_carried = ROW_COUNT;

  UPDATE public.meeting_questions
  SET assigned_meeting_id = NULL, status = 'new', manual_assignment_locked = false, carry_count = carry_count + 1
  WHERE assigned_meeting_id = p_meeting_id AND status IN ('assigned', 'in_meeting');
  UPDATE public.meeting_questions SET assigned_meeting_id = NULL
  WHERE assigned_meeting_id = p_meeting_id AND status = 'on_control';
  UPDATE public.meeting_question_meeting_history SET left_at = now()
  WHERE meeting_id = p_meeting_id AND left_at IS NULL;
  RETURN v_carried;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_meeting_v2(p_meeting_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_moved integer;
BEGIN
  IF NOT public.can_manage_meeting_resource('meetings') THEN RAISE EXCEPTION 'Нет прав'; END IF;
  INSERT INTO public.meeting_schedule_exceptions(
    meeting_id, schedule_version_id, exception_type, original_starts_at, created_by
  )
  SELECT id, schedule_version_id, 'cancelled', starts_at, auth.uid()
  FROM public.meetings
  WHERE id = p_meeting_id AND schedule_version_id IS NOT NULL
  ON CONFLICT (meeting_id) DO UPDATE SET
    exception_type = 'cancelled',
    override_starts_at = NULL,
    override_ends_at = NULL,
    created_by = EXCLUDED.created_by,
    created_at = now();
  UPDATE public.meetings SET status = 'cancelled'
  WHERE id = p_meeting_id AND status::text IN ('planned', 'in_progress');
  IF NOT FOUND THEN RAISE EXCEPTION 'Совещание уже завершено или отменено'; END IF;
  INSERT INTO public.meeting_question_events(question_id, event_type, meeting_id, actor_user_id)
  SELECT id, 'meeting_cancelled', p_meeting_id, auth.uid()
  FROM public.meeting_questions
  WHERE assigned_meeting_id = p_meeting_id AND status IN ('assigned', 'in_meeting', 'on_control');
  UPDATE public.meeting_questions
  SET assigned_meeting_id = NULL,
      status = CASE WHEN status = 'on_control' THEN 'on_control' ELSE 'new' END,
      manual_assignment_locked = false
  WHERE assigned_meeting_id = p_meeting_id AND status IN ('assigned', 'in_meeting', 'on_control');
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  UPDATE public.meeting_question_meeting_history SET left_at = now()
  WHERE meeting_id = p_meeting_id AND left_at IS NULL;
  RETURN v_moved;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_meeting_v2(
  p_meeting_id uuid,
  p_scope text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_title text DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings%rowtype;
  v_schedule public.meeting_schedule_versions%rowtype;
  v_timezone text := 'Europe/Uzhgorod';
  v_local_date date;
  v_local_time time;
  v_original_local_date date;
  v_shift interval;
  v_day_shift integer;
  v_weekdays smallint[];
  v_new_version_id uuid;
  v_version_no integer;
  v_duration integer;
  v_prior_occurrence_count integer := 0;
BEGIN
  IF NOT public.can_manage_meeting_resource('meetings') THEN
    RAISE EXCEPTION 'Нет прав для изменения совещания';
  END IF;
  IF p_scope NOT IN ('single', 'following') THEN
    RAISE EXCEPTION 'Выберите одну встречу или эту и все последующие';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'Время завершения должно быть позже начала';
  END IF;

  SELECT * INTO v_meeting
  FROM public.meetings
  WHERE id = p_meeting_id
  FOR UPDATE;
  IF NOT FOUND OR v_meeting.status::text <> 'planned' OR v_meeting.started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Можно изменить только ещё не начатое совещание';
  END IF;
  IF v_meeting.legacy_read_only THEN
    RAISE EXCEPTION 'Архивное совещание нельзя изменить';
  END IF;

  IF v_meeting.schedule_version_id IS NOT NULL THEN
    SELECT * INTO v_schedule
    FROM public.meeting_schedule_versions
    WHERE id = v_meeting.schedule_version_id
    FOR UPDATE;
    v_timezone := COALESCE(v_schedule.timezone, v_timezone);
  END IF;
  v_local_date := (p_starts_at AT TIME ZONE public.meeting_postgres_timezone_v2(v_timezone))::date;
  v_local_time := (p_starts_at AT TIME ZONE public.meeting_postgres_timezone_v2(v_timezone))::time;
  v_original_local_date := (v_meeting.starts_at AT TIME ZONE public.meeting_postgres_timezone_v2(v_timezone))::date;
  v_duration := GREATEST(15, CEIL(EXTRACT(epoch FROM (p_ends_at - p_starts_at)) / 60.0)::integer);

  IF p_scope = 'single' THEN
    INSERT INTO public.meeting_schedule_exceptions(
      meeting_id, schedule_version_id, exception_type, original_starts_at,
      override_starts_at, override_ends_at, override_title, reason, created_by
    ) VALUES (
      p_meeting_id, v_meeting.schedule_version_id, 'rescheduled', v_meeting.starts_at,
      p_starts_at, p_ends_at, NULLIF(btrim(p_title), ''), NULLIF(btrim(p_reason), ''), auth.uid()
    )
    ON CONFLICT (meeting_id) DO UPDATE SET
      exception_type = 'rescheduled',
      override_starts_at = EXCLUDED.override_starts_at,
      override_ends_at = EXCLUDED.override_ends_at,
      override_title = EXCLUDED.override_title,
      reason = EXCLUDED.reason,
      created_by = EXCLUDED.created_by,
      created_at = now();

    UPDATE public.meetings
    SET starts_at = p_starts_at,
        ends_at = p_ends_at,
        meeting_date = v_local_date,
        meeting_time = v_local_time,
        duration_minutes = v_duration,
        title = COALESCE(NULLIF(btrim(p_title), ''), title)
    WHERE id = p_meeting_id;
    RETURN v_meeting.schedule_version_id;
  END IF;

  IF v_meeting.schedule_version_id IS NULL OR v_meeting.template_id IS NULL THEN
    RAISE EXCEPTION 'У этой встречи нет повторяющейся серии';
  END IF;

  SELECT COALESCE(max(version_no), 0) + 1 INTO v_version_no
  FROM public.meeting_schedule_versions
  WHERE template_id = v_meeting.template_id;
  v_day_shift := v_local_date - v_original_local_date;
  IF v_schedule.occurrence_count IS NOT NULL THEN
    SELECT count(*) INTO v_prior_occurrence_count
    FROM generate_series(
      v_schedule.start_date::timestamp,
      (v_original_local_date - 1)::timestamp,
      interval '1 day'
    ) AS candidate_date
    WHERE
      (v_schedule.recurrence_kind = 'one_time' AND candidate_date::date = v_schedule.start_date)
      OR (v_schedule.recurrence_kind = 'weekly' AND extract(isodow FROM candidate_date)::smallint = ANY(v_schedule.weekdays))
      OR (v_schedule.recurrence_kind = 'monthly' AND extract(day FROM candidate_date)::integer = LEAST(
        v_schedule.month_day,
        extract(day FROM (date_trunc('month', candidate_date) + interval '1 month - 1 day'))::integer
      ))
      OR (v_schedule.recurrence_kind = 'interval' AND (candidate_date::date - v_schedule.start_date) % v_schedule.interval_days = 0);
  END IF;
  SELECT COALESCE(
    array_agg((((day_value - 1 + ((v_day_shift % 7 + 7) % 7)) % 7) + 1)::smallint ORDER BY day_value),
    ARRAY[]::smallint[]
  ) INTO v_weekdays
  FROM unnest(v_schedule.weekdays) AS day_value;

  UPDATE public.meeting_schedule_versions
  SET is_active = false,
      effective_to = CASE
        WHEN v_local_date > effective_from THEN v_local_date - 1
        ELSE effective_from
      END
  WHERE id = v_schedule.id;

  INSERT INTO public.meeting_schedule_versions(
    template_id, version_no, recurrence_kind, start_date, start_time, timezone,
    duration_minutes, weekdays, month_day, interval_days, end_date,
    occurrence_count, effective_from, is_active, created_by
  ) VALUES (
    v_meeting.template_id, v_version_no, v_schedule.recurrence_kind,
    v_local_date, v_local_time, v_timezone, v_duration,
    CASE WHEN v_schedule.recurrence_kind = 'weekly' THEN v_weekdays ELSE v_schedule.weekdays END,
    CASE WHEN v_schedule.recurrence_kind = 'monthly' THEN extract(day FROM v_local_date)::integer ELSE v_schedule.month_day END,
    v_schedule.interval_days,
    CASE
      WHEN v_schedule.end_date IS NULL THEN NULL
      ELSE GREATEST(v_local_date, v_schedule.end_date + v_day_shift)
    END,
    CASE
      WHEN v_schedule.occurrence_count IS NULL THEN NULL
      ELSE GREATEST(1, v_schedule.occurrence_count - v_prior_occurrence_count)
    END,
    v_local_date, true, auth.uid()
  ) RETURNING id INTO v_new_version_id;

  v_shift := p_starts_at - v_meeting.starts_at;
  UPDATE public.meetings
  SET schedule_version_id = v_new_version_id,
      starts_at = starts_at + v_shift,
      ends_at = starts_at + v_shift + make_interval(mins => v_duration),
      meeting_date = ((starts_at + v_shift) AT TIME ZONE public.meeting_postgres_timezone_v2(v_timezone))::date,
      meeting_time = ((starts_at + v_shift) AT TIME ZONE public.meeting_postgres_timezone_v2(v_timezone))::time,
      duration_minutes = v_duration,
      title = COALESCE(NULLIF(btrim(p_title), ''), title),
      occurrence_key = v_new_version_id::text || ':' ||
        (((starts_at + v_shift) AT TIME ZONE public.meeting_postgres_timezone_v2(v_timezone))::date)::text || ':' ||
        (((starts_at + v_shift) AT TIME ZONE public.meeting_postgres_timezone_v2(v_timezone))::time)::text
  WHERE schedule_version_id = v_schedule.id
    AND status::text = 'planned'
    AND started_at IS NULL
    AND starts_at >= v_meeting.starts_at;

  PERFORM public.extend_meeting_schedule_horizon_v2(90);
  RETURN v_new_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_meeting_question_outcome_v2(
  p_question_id uuid,
  p_meeting_id uuid,
  p_outcome_type text,
  p_decision_text text DEFAULT NULL,
  p_responsible_user_id uuid DEFAULT NULL,
  p_deadline date DEFAULT NULL,
  p_create_task boolean DEFAULT false,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question public.meeting_questions%rowtype;
  v_outcome_id uuid;
  v_task_id uuid;
  v_wait_for_task boolean := true;
BEGIN
  IF NOT public.can_manage_meeting_resource('meetings') THEN RAISE EXCEPTION 'Нет прав'; END IF;
  IF p_outcome_type NOT IN ('decision', 'task', 'defer', 'dismiss', 'source_update') THEN
    RAISE EXCEPTION 'Недопустимый результат вопроса';
  END IF;
  SELECT * INTO v_question FROM public.meeting_questions WHERE id = p_question_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Вопрос не найден'; END IF;
  IF v_question.question_template_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.meeting_question_templates template
    WHERE template.id = v_question.question_template_id
      AND p_outcome_type = ANY(template.allowed_outcomes)
  ) THEN
    RAISE EXCEPTION 'Это действие не разрешено шаблоном вопроса';
  END IF;
  IF p_meeting_id IS NOT NULL AND v_question.assigned_meeting_id IS DISTINCT FROM p_meeting_id THEN
    RAISE EXCEPTION 'Вопрос не относится к этому совещанию';
  END IF;
  IF p_outcome_type IN ('decision', 'task') AND NULLIF(btrim(p_decision_text), '') IS NULL THEN
    RAISE EXCEPTION 'Зафиксируйте решение';
  END IF;
  IF (p_create_task OR p_outcome_type = 'task') AND p_responsible_user_id IS NULL THEN
    RAISE EXCEPTION 'Для задачи выберите ответственного';
  END IF;
  IF v_question.rule_version_id IS NOT NULL THEN
    SELECT COALESCE(version.lifecycle->>'taskBehavior', 'wait_for_completion') <> 'close_after_creation'
    INTO v_wait_for_task
    FROM public.meeting_rule_versions version
    WHERE version.id = v_question.rule_version_id;
  END IF;

  INSERT INTO public.meeting_question_outcomes(
    question_id, meeting_id, outcome_type, decision_text, responsible_user_id,
    deadline, payload, created_by
  ) VALUES (
    p_question_id, p_meeting_id, p_outcome_type,
    NULLIF(btrim(p_decision_text), ''), p_responsible_user_id, p_deadline,
    COALESCE(p_payload, '{}'::jsonb), auth.uid()
  ) RETURNING id INTO v_outcome_id;

  IF p_create_task OR p_outcome_type = 'task' THEN
    INSERT INTO public.tasks(
      related_meeting_id, assigned_to, task_type, title, description,
      status, start_date, deadline
    ) VALUES (
      p_meeting_id, p_responsible_user_id, 'meeting_action_item',
      left('По итогам совещания: ' || v_question.title, 240),
      NULLIF(btrim(p_decision_text), ''), 'pending', CURRENT_DATE,
      COALESCE(p_deadline, CURRENT_DATE + 7)
    ) RETURNING id INTO v_task_id;
    INSERT INTO public.meeting_question_task_links(question_id, task_id, outcome_id, is_required)
    VALUES (p_question_id, v_task_id, v_outcome_id, v_wait_for_task);
    UPDATE public.meeting_questions
    SET status = CASE WHEN v_wait_for_task THEN 'on_control' ELSE 'resolved' END,
        assigned_meeting_id = CASE WHEN v_wait_for_task THEN assigned_meeting_id ELSE NULL END,
        closed_at = CASE WHEN v_wait_for_task THEN NULL ELSE now() END,
        responsible_user_id = p_responsible_user_id,
        deadline = COALESCE(p_deadline, deadline)
    WHERE id = p_question_id;
  ELSIF p_outcome_type = 'decision' THEN
    UPDATE public.meeting_questions
    SET status = 'resolved', assigned_meeting_id = NULL, closed_at = now()
    WHERE id = p_question_id;
  ELSIF p_outcome_type = 'defer' THEN
    UPDATE public.meeting_questions
    SET status = 'deferred', assigned_meeting_id = NULL, manual_assignment_locked = false,
        deadline = COALESCE(p_deadline, deadline)
    WHERE id = p_question_id;
  ELSIF p_outcome_type = 'dismiss' THEN
    UPDATE public.meeting_questions
    SET status = 'dismissed', assigned_meeting_id = NULL, closed_at = now()
    WHERE id = p_question_id;
  END IF;

  INSERT INTO public.meeting_question_events(question_id, event_type, meeting_id, actor_user_id, details)
  VALUES (p_question_id, 'outcome_' || p_outcome_type, p_meeting_id, auth.uid(),
          jsonb_build_object('outcomeId', v_outcome_id, 'taskId', v_task_id));
  RETURN jsonb_build_object('outcomeId', v_outcome_id, 'taskId', v_task_id);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_meeting_question_v2(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_meeting_v2(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_meeting_v2(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_meeting_v2(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reschedule_meeting_v2(uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_meeting_question_outcome_v2(uuid, uuid, text, text, uuid, date, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_meeting_question_v2(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_meeting_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_meeting_v2(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_meeting_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_meeting_v2(uuid, text, timestamptz, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_meeting_question_outcome_v2(uuid, uuid, text, text, uuid, date, boolean, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_meeting_question_task_state_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status::text IN ('pending', 'in_progress', 'cancelled') THEN
    UPDATE public.meeting_questions q
    SET status = 'on_control', closed_at = NULL
    FROM public.meeting_question_task_links l
    WHERE l.task_id = NEW.id AND l.question_id = q.id
      AND l.is_required
      AND q.status NOT IN ('dismissed', 'auto_closed');
  ELSIF NEW.status::text = 'completed' THEN
    UPDATE public.meeting_questions q
    SET status = CASE WHEN q.rule_id IS NULL OR q.condition_active = false THEN 'resolved' ELSE 'on_control' END,
        closed_at = CASE WHEN q.rule_id IS NULL OR q.condition_active = false THEN now() ELSE NULL END
    WHERE q.id IN (
      SELECT l.question_id FROM public.meeting_question_task_links l
      WHERE l.task_id = NEW.id AND l.is_required
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.meeting_question_task_links required_link
      JOIN public.tasks required_task ON required_task.id = required_link.task_id
      WHERE required_link.question_id = q.id AND required_link.is_required
        AND required_task.status::text <> 'completed'
    );
  END IF;
  INSERT INTO public.meeting_rule_events(source_key, operation, payload)
  SELECT DISTINCT version.source_key, 'reconcile',
         jsonb_build_object('reason', 'linked_task_status_changed', 'taskId', NEW.id)
  FROM public.meeting_question_task_links link
  JOIN public.meeting_questions question ON question.id = link.question_id
  JOIN public.meeting_rule_versions version ON version.id = question.rule_version_id
  WHERE link.task_id = NEW.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.meeting_rule_events pending
      WHERE pending.source_key = version.source_key
        AND pending.operation = 'reconcile'
        AND pending.processed_at IS NULL
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_meeting_question_state_v2 ON public.tasks;
CREATE TRIGGER trg_tasks_meeting_question_state_v2
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.sync_meeting_question_task_state_v2();

-- Existing types become configurable meeting templates.
INSERT INTO public.meeting_templates(
  legacy_type_key, name, color, default_duration_minutes, is_system, created_by
)
SELECT mt.key, mt.label, COALESCE(mt.color, 'blue'), 60, mt.is_system, mt.created_by
FROM public.meeting_types mt
ON CONFLICT (legacy_type_key) DO UPDATE SET
  name = EXCLUDED.name,
  color = EXCLUDED.color,
  is_system = EXCLUDED.is_system;

-- Existing weekly series become the first immutable schedule version. Reusing the
-- legacy rule UUID gives every future occurrence a stable migration target.
INSERT INTO public.meeting_schedule_versions(
  id, template_id, version_no, recurrence_kind, start_date, start_time, timezone,
  duration_minutes, weekdays, end_date, occurrence_count, effective_from,
  effective_to, is_active, created_by, created_at
)
SELECT recurrence.id, template.id, 1, 'weekly', recurrence.start_date,
       recurrence.meeting_time, 'Europe/Uzhgorod', recurrence.duration_minutes,
       recurrence.weekdays, recurrence.end_date,
       CASE WHEN recurrence.end_date IS NULL THEN recurrence.occurrence_count ELSE NULL END,
       recurrence.start_date, recurrence.end_date, recurrence.is_active,
       recurrence.created_by, recurrence.created_at
FROM public.meeting_recurrence_rules recurrence
JOIN public.meeting_templates template ON template.legacy_type_key = recurrence.meeting_type
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meeting_template_participants(
  template_id, participant_type, user_id, is_required
)
SELECT DISTINCT template.id, 'user', attendee_id, true
FROM public.meeting_recurrence_rules recurrence
JOIN public.meeting_templates template ON template.legacy_type_key = recurrence.meeting_type
CROSS JOIN LATERAL unnest(recurrence.attendee_ids) attendee_id
WHERE attendee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.meeting_template_participants existing
    WHERE existing.template_id = template.id
      AND existing.participant_type = 'user'
      AND existing.user_id = attendee_id
  );

INSERT INTO public.meeting_template_participants(
  template_id, participant_type, external_name, external_role,
  external_email, external_phone, is_required
)
SELECT DISTINCT template.id, 'external', attendee->>'full_name',
       NULLIF(attendee->>'role_description', ''), NULLIF(attendee->>'email', ''),
       NULLIF(attendee->>'phone', ''), true
FROM public.meeting_recurrence_rules recurrence
JOIN public.meeting_templates template ON template.legacy_type_key = recurrence.meeting_type
CROSS JOIN LATERAL jsonb_array_elements(recurrence.external_attendees) attendee
WHERE NULLIF(btrim(attendee->>'full_name'), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.meeting_template_participants existing
    WHERE existing.template_id = template.id
      AND existing.participant_type = 'external'
      AND existing.external_name = attendee->>'full_name'
  );

UPDATE public.meetings m
SET template_id = t.id,
    schedule_version_id = COALESCE(m.schedule_version_id, m.recurrence_rule_id),
    facilitator_user_id = COALESCE(m.facilitator_user_id, m.created_by),
    starts_at = COALESCE(m.starts_at, ((m.meeting_date::text || ' ' || m.meeting_time::text)::timestamp AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod'))),
    ends_at = COALESCE(m.ends_at, ((m.meeting_date::text || ' ' || m.meeting_time::text)::timestamp AT TIME ZONE public.meeting_postgres_timezone_v2('Europe/Uzhgorod')) + make_interval(mins => m.duration_minutes)),
    legacy_read_only = CASE WHEN m.status::text IN ('completed', 'cancelled') THEN true ELSE m.legacy_read_only END,
    occurrence_key = COALESCE(
      m.occurrence_key,
      CASE WHEN m.recurrence_rule_id IS NOT NULL
        THEN 'legacy:' || m.recurrence_rule_id::text || ':' || m.meeting_date::text
        ELSE NULL
      END
    )
FROM public.meeting_templates t
WHERE t.legacy_type_key = m.meeting_type AND m.template_id IS NULL;

-- Standard question templates requested for the first release.
INSERT INTO public.meeting_question_templates(
  id, name, title_template, description_template, category, priority,
  expected_outcome, allowed_outcomes, source_url_template, is_system
)
VALUES
  ('20000000-0000-4000-8000-000000000001', 'Просроченные задачи',
   'Просроченные задачи: {Ответственный} — {Количество}',
   'Открытые задачи с истёкшим сроком. Разберите причины и зафиксируйте новый план.',
   'tasks', 'high', 'Обновлённый план и ответственный', ARRAY['decision','task','defer','dismiss'], '/tasks', true),
  ('20000000-0000-4000-8000-000000000002', 'Запрос долго не взят в работу',
   'Запросы без реакции: {Отдел} — {Количество}',
   'Новые запросы не взяты в работу в течение одного рабочего дня.',
   'requests', 'high', 'Запросы назначены и взяты в работу', ARRAY['decision','task','defer','dismiss'], '/requests', true),
  ('20000000-0000-4000-8000-000000000003', 'Просроченная надобность производства',
   'Просроченные надобности: {Завод} — {Количество}',
   'Производственные расходники не получены к дате «Нужно до».',
   'production_needs', 'high', 'Подтверждён срок поставки', ARRAY['decision','task','defer','dismiss'], '/supply/production-requests', true),
  ('20000000-0000-4000-8000-000000000004', 'Риск опоздания материала',
   'Риск опоздания материала: {Завод} — {Количество}',
   'Плановая поставка позже даты, требуемой производством.',
   'materials', 'high', 'Срок поставки согласован с производством', ARRAY['decision','task','defer','dismiss'], '/supply/orders?view=details', true),
  ('20000000-0000-4000-8000-000000000005', 'Фактическое опоздание материала',
   'Материал уже опаздывает: {Завод} — {Количество}',
   'Дата Мат.плана прошла, материал получен не полностью.',
   'materials', 'critical', 'Устранён срыв обеспечения производства', ARRAY['decision','task','defer','dismiss'], '/supply/orders?view=details', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meeting_rules(id, name, question_template_id, status, is_system)
VALUES
  ('30000000-0000-4000-8000-000000000001', 'Просроченные задачи', '20000000-0000-4000-8000-000000000001', 'published', true),
  ('30000000-0000-4000-8000-000000000002', 'Запросы без реакции один рабочий день', '20000000-0000-4000-8000-000000000002', 'published', true),
  ('30000000-0000-4000-8000-000000000003', 'Просроченные надобности производства', '20000000-0000-4000-8000-000000000003', 'published', true),
  ('30000000-0000-4000-8000-000000000004', 'Риск опоздания материала', '20000000-0000-4000-8000-000000000004', 'published', true),
  ('30000000-0000-4000-8000-000000000005', 'Фактическое опоздание материала', '20000000-0000-4000-8000-000000000005', 'published', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meeting_rule_versions(
  id, rule_id, version_no, trigger_type, source_key, dsl, grouping, routing, lifecycle, notifications
)
VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, 'relative_time', 'tasks',
   '{"logic":"and","conditions":[{"field":"status","operator":"in","value":["pending","in_progress"]},{"field":"deadline","operator":"before_today"}]}'::jsonb,
   '{"fields":["responsible_user_id","factory_id","task_type"],"mode":"smart"}'::jsonb,
   '{"strategy":"nearest_matching","requireParticipant":"responsible","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb,
   '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 1, 'relative_time', 'department_requests',
   '{"logic":"and","conditions":[{"field":"status","operator":"eq","value":"new"},{"field":"created_at","operator":"business_days_elapsed","value":1}]}'::jsonb,
   '{"fields":["target_department","factory_id"],"mode":"smart"}'::jsonb,
   '{"strategy":"nearest_matching","requireParticipant":"department","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb,
   '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 1, 'relative_time', 'consumable_requests',
   '{"logic":"and","conditions":[{"field":"status","operator":"in","value":["new","invoice_taken","delivery","received_partial"]},{"field":"remaining_quantity","operator":"gt","value":0},{"field":"need_by_date","operator":"before_today"}]}'::jsonb,
   '{"fields":["factory_id","responsible_user_id"],"mode":"smart"}'::jsonb,
   '{"strategy":"nearest_matching","requireParticipant":"supply","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb,
   '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 1, 'record_state', 'supply_materials',
   '{"logic":"and","conditions":[{"field":"remaining_quantity","operator":"gt","value":0},{"field":"promised_delivery_date","operator":"after_field","value":"planned_material_date"}]}'::jsonb,
   '{"fields":["factory_id","responsible_user_id"],"mode":"smart"}'::jsonb,
   '{"strategy":"nearest_matching","requireParticipant":"supply","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb,
   '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb),
  ('40000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000005', 1, 'relative_time', 'supply_materials',
   '{"logic":"and","conditions":[{"field":"remaining_quantity","operator":"gt","value":0},{"field":"planned_material_date","operator":"before_today"}]}'::jsonb,
   '{"fields":["factory_id","responsible_user_id"],"mode":"smart"}'::jsonb,
   '{"strategy":"nearest_matching","requireParticipant":"supply","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb,
   '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Former hardcoded agenda checks stay visible and versioned in the same constructor.
INSERT INTO public.meeting_question_templates(
  id, name, title_template, description_template, category, priority,
  expected_outcome, allowed_outcomes, source_url_template, is_system
)
VALUES
  ('20000000-0000-4000-8000-000000000006', 'Не назначен завод',
   'Назначить завод: {Машина}', 'Машина без назначенного завода.',
   'planning', 'high', 'Завод назначен', ARRAY['decision','task','defer','dismiss'], '/sales-plan', true),
  ('20000000-0000-4000-8000-000000000007', 'Не определён материал',
   'Определить материал: {Машина}', 'Для машины не определён тип материала.',
   'materials', 'high', 'Материал определён', ARRAY['decision','task','defer','dismiss'], '/sales-plan', true),
  ('20000000-0000-4000-8000-000000000008', 'Просрочен этап производства',
   'Просрочка производства: {Машина}', 'Есть незавершённые этапы с прошедшим плановым сроком.',
   'production', 'critical', 'Новый реалистичный план этапов', ARRAY['decision','task','defer','dismiss'], '/production/gantt', true),
  ('20000000-0000-4000-8000-000000000009', 'Просрочена желаемая отгрузка',
   'Просрочена отгрузка: {Машина}', 'Желаемая дата отгрузки прошла, фактической отгрузки нет.',
   'shipping', 'critical', 'Подтверждена дата отгрузки', ARRAY['decision','task','defer','dismiss'], '/sales-plan', true),
  ('20000000-0000-4000-8000-000000000010', 'Не назначена загрузка производства',
   'Назначить загрузку производства: {Машина}', 'Подтверждённая машина ещё не поставлена в месяц, цех и очередь производства.',
   'production', 'high', 'Машина поставлена в производственную очередь', ARRAY['decision','task','defer','dismiss'], '/production', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meeting_rules(id, name, question_template_id, status, is_system)
VALUES
  ('30000000-0000-4000-8000-000000000006', 'Машины без завода', '20000000-0000-4000-8000-000000000006', 'published', true),
  ('30000000-0000-4000-8000-000000000007', 'Машины с неопределённым материалом', '20000000-0000-4000-8000-000000000007', 'published', true),
  ('30000000-0000-4000-8000-000000000008', 'Просроченные этапы производства', '20000000-0000-4000-8000-000000000008', 'published', true),
  ('30000000-0000-4000-8000-000000000009', 'Просроченная отгрузка', '20000000-0000-4000-8000-000000000009', 'published', true),
  ('30000000-0000-4000-8000-000000000010', 'Машины без загрузки производства', '20000000-0000-4000-8000-000000000010', 'published', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.meeting_rule_versions(
  id, rule_id, version_no, trigger_type, source_key, dsl, grouping, routing, lifecycle, notifications
)
VALUES
  ('40000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000006', 1, 'record_state', 'machines',
   '{"logic":"and","conditions":[{"field":"status","operator":"in","value":["created","under_review"]},{"field":"factory_id","operator":"is_empty"},{"field":"is_archived","operator":"eq","value":false}]}'::jsonb,
   '{"fields":[],"mode":"none"}'::jsonb, '{"strategy":"nearest_matching","requireParticipant":"none","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb, '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb),
  ('40000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000007', 1, 'record_state', 'machines',
   '{"logic":"and","conditions":[{"field":"material_type","operator":"eq","value":"undefined"},{"field":"status","operator":"neq","value":"shipped"},{"field":"is_archived","operator":"eq","value":false}]}'::jsonb,
   '{"fields":[],"mode":"none"}'::jsonb, '{"strategy":"nearest_matching","requireParticipant":"none","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb, '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb),
  ('40000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000008', 1, 'relative_time', 'production_stages',
   '{"logic":"and","conditions":[{"field":"actual_date_end","operator":"is_empty"},{"field":"planned_date_end","operator":"before_today"},{"field":"is_skipped","operator":"eq","value":false}]}'::jsonb,
   '{"fields":["machine_id"],"mode":"smart"}'::jsonb, '{"strategy":"nearest_matching","requireParticipant":"none","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb, '{"channels":["crm","telegram"],"criticalOnly":false}'::jsonb),
  ('40000000-0000-4000-8000-000000000009', '30000000-0000-4000-8000-000000000009', 1, 'relative_time', 'machines',
   '{"logic":"and","conditions":[{"field":"desired_shipping_date","operator":"before_today"},{"field":"actual_shipping_date","operator":"is_empty"},{"field":"is_archived","operator":"eq","value":false}]}'::jsonb,
   '{"fields":[],"mode":"none"}'::jsonb, '{"strategy":"nearest_matching","requireParticipant":"none","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb, '{"channels":["crm","telegram"],"criticalOnly":false}'::jsonb),
  ('40000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000010', 1, 'record_state', 'machines',
   '{"logic":"and","conditions":[{"field":"status","operator":"in","value":["confirmed","planned","factory_assigned"]},{"field":"production_month","operator":"is_empty"},{"field":"is_archived","operator":"eq","value":false}]}'::jsonb,
   '{"fields":[],"mode":"none"}'::jsonb, '{"strategy":"nearest_matching","requireParticipant":"none","fallback":"pool"}'::jsonb,
   '{"clearBehavior":"auto_close","taskBehavior":"wait_for_completion"}'::jsonb, '{"channels":["crm","telegram"],"criticalOnly":true}'::jsonb)
ON CONFLICT (id) DO NOTHING;

UPDATE public.meeting_rules r
SET current_version_id = v.id
FROM public.meeting_rule_versions v
WHERE v.rule_id = r.id AND v.version_no = 1 AND r.current_version_id IS NULL;

-- Open legacy agenda and pool rows become master questions. Completed meeting history stays untouched.
INSERT INTO public.meeting_questions(
  assigned_meeting_id, episode_key, source_type, source_id, title, description,
  category, priority, status, condition_snapshot, legacy_agenda_item_id, opened_at
)
SELECT ai.meeting_id,
       COALESCE(ai.source_key, 'legacy-agenda:' || ai.id::text),
       COALESCE(ai.source_type, 'legacy_agenda'), ai.machine_id::text,
       ai.title, ai.description, 'legacy', 'normal', 'assigned',
       jsonb_build_object('migratedFrom', 'meeting_agenda_items'), ai.id, ai.created_at
FROM public.meeting_agenda_items ai
JOIN public.meetings m ON m.id = ai.meeting_id
WHERE ai.resolved_at IS NULL AND m.status::text = 'planned'
ON CONFLICT DO NOTHING;

INSERT INTO public.meeting_questions(
  assigned_meeting_id, episode_key, source_type, source_id, title, description,
  category, priority, status, condition_snapshot, legacy_pool_item_id, opened_at
)
SELECT CASE WHEN p.status = 'assigned' THEN p.assigned_meeting_id ELSE NULL END,
       p.source_key, p.source_type, p.machine_id::text, p.title, p.description,
       'legacy', 'normal', CASE WHEN p.status = 'assigned' THEN 'assigned' ELSE 'new' END,
       jsonb_build_object('migratedFrom', 'meeting_agenda_pool_items'), p.id, p.created_at
FROM public.meeting_agenda_pool_items p
WHERE p.status IN ('new', 'assigned')
ON CONFLICT DO NOTHING;

INSERT INTO public.meeting_question_members(question_id, source_key, source_type, source_id, title, snapshot)
SELECT q.id, q.episode_key, q.source_type, q.source_id, q.title, q.condition_snapshot
FROM public.meeting_questions q
WHERE NOT EXISTS (SELECT 1 FROM public.meeting_question_members m WHERE m.question_id = q.id);

-- The new resources are visible in the shared permission matrix. CRM administrators
-- still receive full access from the application-level administrator-position override.
WITH all_roles(role) AS (
  SELECT unnest(enum_range(NULL::public.user_role))
), resources(resource_key) AS (
  VALUES ('meeting_templates'), ('meeting_question_templates'), ('meeting_rules')
)
INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
SELECT role, resource_key, false, false FROM all_roles CROSS JOIN resources
ON CONFLICT (role, resource_key) DO NOTHING;

COMMENT ON TABLE public.meeting_questions IS 'Master agenda question registry. Assignment moves this row; it never copies the question.';
COMMENT ON TABLE public.meeting_rule_versions IS 'Immutable safe JSON DSL snapshots; no SQL fragments are accepted.';

-- Rollout switch: shadow keeps legacy generation alive while v2 results are compared.
-- Switching the value to active disables both legacy generators without deleting them.
INSERT INTO public.app_settings(key, value)
VALUES ('meeting_system_v2_mode', 'shadow')
ON CONFLICT (key) DO NOTHING;

-- Published rules are evaluated in shadow mode without creating questions.
-- This initial reconciliation produces comparable counts before activation.
DO $$
BEGIN
  PERFORM public.enqueue_meeting_rule_reconciliation_v2();
END $$;

CREATE OR REPLACE FUNCTION public.set_meeting_system_v2_mode(p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous_mode text;
  v_missing_templates integer;
  v_published integer := 0;
  v_queued integer := 0;
BEGIN
  IF NOT public.can_manage_meeting_resource('meeting_rules') THEN
    RAISE EXCEPTION 'Нет прав для переключения системы совещаний';
  END IF;
  IF p_mode NOT IN ('shadow', 'active') THEN
    RAISE EXCEPTION 'Допустим только теневой или активный режим';
  END IF;

  SELECT value INTO v_previous_mode
  FROM public.app_settings
  WHERE key = 'meeting_system_v2_mode'
  FOR UPDATE;

  IF p_mode = 'active' THEN
    SELECT count(*) INTO v_missing_templates
    FROM public.meetings meeting
    WHERE meeting.status::text = 'planned'
      AND meeting.meeting_date >= CURRENT_DATE
      AND meeting.template_id IS NULL;
    IF v_missing_templates > 0 THEN
      RAISE EXCEPTION 'Нельзя активировать: % будущих встреч не привязаны к шаблонам', v_missing_templates;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.meeting_rules
      WHERE is_system AND status = 'draft' AND current_version_id IS NULL
    ) THEN
      RAISE EXCEPTION 'Нельзя активировать: у системного правила нет версии';
    END IF;

    UPDATE public.meeting_rules
    SET status = 'published',
        published_by = auth.uid(),
        published_at = COALESCE(published_at, now())
    WHERE is_system AND status = 'draft' AND current_version_id IS NOT NULL;
    GET DIAGNOSTICS v_published = ROW_COUNT;
  END IF;

  INSERT INTO public.app_settings(key, value, updated_at)
  VALUES ('meeting_system_v2_mode', p_mode, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;

  IF p_mode = 'active' THEN
    v_queued := public.enqueue_meeting_rule_reconciliation_v2();
  END IF;

  INSERT INTO public.meeting_system_rollout_events(mode, actor_user_id, details)
  VALUES (
    p_mode,
    auth.uid(),
    jsonb_build_object(
      'previousMode', COALESCE(v_previous_mode, 'shadow'),
      'publishedSystemRules', v_published,
      'queuedSources', v_queued
    )
  );
  RETURN jsonb_build_object(
    'mode', p_mode,
    'previousMode', COALESCE(v_previous_mode, 'shadow'),
    'publishedSystemRules', v_published,
    'queuedSources', v_queued
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_meeting_system_v2_mode(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_meeting_system_v2_mode(text) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.fn_generate_meeting_agenda_legacy(uuid)') IS NULL
     AND to_regprocedure('public.fn_generate_meeting_agenda(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.fn_generate_meeting_agenda(uuid) RENAME TO fn_generate_meeting_agenda_legacy;
  END IF;
  IF to_regprocedure('public.fn_refresh_meeting_agenda_pool_legacy()') IS NULL
     AND to_regprocedure('public.fn_refresh_meeting_agenda_pool()') IS NOT NULL THEN
    ALTER FUNCTION public.fn_refresh_meeting_agenda_pool() RENAME TO fn_refresh_meeting_agenda_pool_legacy;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_generate_meeting_agenda(p_meeting_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_mode text;
BEGIN
  SELECT value INTO v_mode FROM public.app_settings WHERE key = 'meeting_system_v2_mode';
  IF COALESCE(v_mode, 'shadow') <> 'active' THEN
    PERFORM public.fn_generate_meeting_agenda_legacy(p_meeting_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_refresh_meeting_agenda_pool()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_mode text; v_count integer := 0;
BEGIN
  SELECT value INTO v_mode FROM public.app_settings WHERE key = 'meeting_system_v2_mode';
  IF COALESCE(v_mode, 'shadow') <> 'active' THEN
    v_count := public.fn_refresh_meeting_agenda_pool_legacy();
  END IF;
  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_generate_meeting_agenda_legacy(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_refresh_meeting_agenda_pool_legacy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_generate_meeting_agenda(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_refresh_meeting_agenda_pool() TO authenticated, service_role;
