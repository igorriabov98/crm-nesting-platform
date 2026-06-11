-- Ð¢Ð¸Ð¿ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ
CREATE TYPE meeting_type AS ENUM (
  'general',          -- ÐžÐ±Ñ‰ÐµÐµ (Ð¾Ð±Ð° Ð·Ð°Ð²Ð¾Ð´Ð°)
  'factory_bergovo',  -- Собрание Берегово
  'factory_uzhgorod'  -- Ð¡Ð¾Ð±Ñ€Ð°Ð½Ð¸Ðµ Ð£Ð¶Ð³Ð¾Ñ€Ð¾Ð´
);

-- Ð¡Ñ‚Ð°Ñ‚ÑƒÑ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ
CREATE TYPE meeting_status AS ENUM (
  'planned',    -- Ð—Ð°Ð¿Ð»Ð°Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¾
  'completed',  -- ÐŸÑ€Ð¾Ð²ÐµÐ´ÐµÐ½Ð¾
  'cancelled'   -- ÐžÑ‚Ð¼ÐµÐ½ÐµÐ½Ð¾
);

-- Ð¡Ð¾Ð±Ñ€Ð°Ð½Ð¸Ñ
CREATE TABLE meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_type meeting_type NOT NULL,
  title text,                              -- ÐžÐ¿Ñ†Ð¸Ð¾Ð½Ð°Ð»ÑŒÐ½Ñ‹Ð¹ Ð·Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº
  meeting_date date NOT NULL,
  meeting_time time NOT NULL DEFAULT '10:00',
  status meeting_status NOT NULL DEFAULT 'planned',
  notes text,                              -- ÐžÐ±Ñ‰Ð¸Ðµ Ð·Ð°Ð¼ÐµÑ‚ÐºÐ¸ / Ð¸Ñ‚Ð¾Ð³Ð¸
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_meetings_date ON meetings(meeting_date);
CREATE INDEX idx_meetings_type ON meetings(meeting_type);

-- Ð£Ñ‡Ð°ÑÑ‚Ð½Ð¸ÐºÐ¸ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ (Ð¸Ð· ÑÐ¸ÑÑ‚ÐµÐ¼Ñ‹)
CREATE TABLE meeting_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  is_confirmed boolean DEFAULT false,      -- ÐŸÐ¾Ð´Ñ‚Ð²ÐµÑ€Ð´Ð¸Ð» Ð¿Ñ€Ð¸ÑÑƒÑ‚ÑÑ‚Ð²Ð¸Ðµ
  attended boolean DEFAULT false,          -- Ð ÐµÐ°Ð»ÑŒÐ½Ð¾ Ð¿Ñ€Ð¸ÑÑƒÑ‚ÑÑ‚Ð²Ð¾Ð²Ð°Ð»
  created_at timestamptz DEFAULT now(),
  UNIQUE(meeting_id, user_id)
);

CREATE INDEX idx_meeting_attendees_meeting ON meeting_attendees(meeting_id);

-- Ð’Ð½ÐµÑˆÐ½Ð¸Ðµ ÑƒÑ‡Ð°ÑÑ‚Ð½Ð¸ÐºÐ¸ (ÐÐ• Ð² ÑÐ¸ÑÑ‚ÐµÐ¼Ðµ)
CREATE TABLE meeting_external_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role_description text,                   -- ÐšÑ‚Ð¾ ÑÑ‚Ð¾ (Ð½Ð°Ð¿Ñ€Ð¸Ð¼ÐµÑ€ "ÐŸÐ¾ÑÑ‚Ð°Ð²Ñ‰Ð¸Ðº ÐœÐµÑ‚Ð°Ð»Ð»Ð¢Ñ€ÐµÐ¹Ð´")
  phone text,
  email text,
  attended boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_meeting_ext_attendees_meeting
  ON meeting_external_attendees(meeting_id);

-- ÐŸÑƒÐ½ÐºÑ‚Ñ‹ Ð¿Ð¾Ð²ÐµÑÑ‚ÐºÐ¸ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ
CREATE TABLE meeting_agenda_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES machines(id) ON DELETE SET NULL,  -- Ð¿Ñ€Ð¸Ð²ÑÐ·ÐºÐ° Ðº Ð¼Ð°ÑˆÐ¸Ð½Ðµ (Ð¾Ð¿Ñ†Ð¸Ð¾Ð½Ð°Ð»ÑŒÐ½Ð¾)
  title text NOT NULL,                     -- Ð—Ð°Ð³Ð¾Ð»Ð¾Ð²Ð¾Ðº Ð¿ÑƒÐ½ÐºÑ‚Ð°
  description text,                        -- ÐžÐ¿Ð¸ÑÐ°Ð½Ð¸Ðµ
  auto_generated boolean DEFAULT false,    -- Ð¡Ð¾Ð·Ð´Ð°Ð½ Ð°Ð²Ñ‚Ð¾Ð¼Ð°Ñ‚Ð¸Ñ‡ÐµÑÐºÐ¸ CRM
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_meeting_agenda_meeting ON meeting_agenda_items(meeting_id);

-- Ð ÐµÑˆÐµÐ½Ð¸Ñ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ (Ð¿Ñ€Ð¸Ð²ÑÐ·Ð°Ð½Ñ‹ Ðº Ð¼Ð°ÑˆÐ¸Ð½Ð°Ð¼)
CREATE TABLE meeting_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  machine_id uuid REFERENCES machines(id) ON DELETE SET NULL,
  assigned_factory_id uuid REFERENCES factories(id),  -- ÐÐ°Ð·Ð½Ð°Ñ‡ÐµÐ½Ð½Ñ‹Ð¹ Ð·Ð°Ð²Ð¾Ð´
  assigned_material_type material_type,                -- Ð¢Ð¸Ð¿ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»Ð°
  decision_text text NOT NULL,                         -- Ð¢ÐµÐºÑÑ‚ Ñ€ÐµÑˆÐµÐ½Ð¸Ñ
  responsible_user_id uuid REFERENCES users(id),       -- ÐžÑ‚Ð²ÐµÑ‚ÑÑ‚Ð²ÐµÐ½Ð½Ñ‹Ð¹
  deadline date,                                       -- Ð¡Ñ€Ð¾Ðº
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_meeting_decisions_meeting ON meeting_decisions(meeting_id);
CREATE INDEX idx_meeting_decisions_machine ON meeting_decisions(machine_id);

-- Ð˜Ñ‚Ð¾Ð³Ð¸ / Ð´Ð¾Ð¿Ð¾Ð»Ð½Ð¸Ñ‚ÐµÐ»ÑŒÐ½Ñ‹Ðµ Ð·Ð°Ð´Ð°Ñ‡Ð¸ ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ñ (Ð½Ðµ Ð¿Ñ€Ð¸Ð²ÑÐ·Ð°Ð½Ñ‹ Ðº Ð¼Ð°ÑˆÐ¸Ð½Ðµ)
CREATE TABLE meeting_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  description text NOT NULL,
  responsible_user_id uuid REFERENCES users(id),
  deadline date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_meeting_actions_meeting ON meeting_action_items(meeting_id);

-- RLS Ð´Ð»Ñ Ð²ÑÐµÑ… Ñ‚Ð°Ð±Ð»Ð¸Ñ† ÑÐ¾Ð±Ñ€Ð°Ð½Ð¸Ð¹
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_external_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_agenda_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_action_items ENABLE ROW LEVEL SECURITY;

-- ÐŸÐ¾Ð»Ð¸Ñ‚Ð¸ÐºÐ¸: Ð²ÑÐµ Ð°ÑƒÑ‚ÐµÐ½Ñ‚Ð¸Ñ„Ð¸Ñ†Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð½Ñ‹Ðµ Ð¼Ð¾Ð³ÑƒÑ‚ Ñ‡Ð¸Ñ‚Ð°Ñ‚ÑŒ
-- Ð¡Ð¾Ð·Ð´Ð°Ð²Ð°Ñ‚ÑŒ/Ñ€ÐµÐ´Ð°ÐºÑ‚Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ: Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð´Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€Ð°

CREATE POLICY "meetings_select" ON meetings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "meetings_insert" ON meetings
  FOR INSERT WITH CHECK (is_director());

CREATE POLICY "meetings_update" ON meetings
  FOR UPDATE USING (is_director());

CREATE POLICY "meetings_delete" ON meetings
  FOR DELETE USING (is_director());

-- ÐÐ½Ð°Ð»Ð¾Ð³Ð¸Ñ‡Ð½Ñ‹Ðµ Ð¿Ð¾Ð»Ð¸Ñ‚Ð¸ÐºÐ¸ Ð´Ð»Ñ Ð¾ÑÑ‚Ð°Ð»ÑŒÐ½Ñ‹Ñ… Ñ‚Ð°Ð±Ð»Ð¸Ñ†
-- (meeting_attendees, meeting_external_attendees,
--  meeting_agenda_items, meeting_decisions, meeting_action_items)
-- SELECT: Ð²ÑÐµ Ð°ÑƒÑ‚ÐµÐ½Ñ‚Ð¸Ñ„Ð¸Ñ†Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð½Ñ‹Ðµ
-- INSERT/UPDATE/DELETE: Ñ‚Ð¾Ð»ÑŒÐºÐ¾ Ð´Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€Ð°

CREATE POLICY "attendees_select" ON meeting_attendees
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "attendees_modify" ON meeting_attendees
  FOR ALL USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "ext_attendees_select" ON meeting_external_attendees
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ext_attendees_modify" ON meeting_external_attendees
  FOR ALL USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "agenda_select" ON meeting_agenda_items
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "agenda_modify" ON meeting_agenda_items
  FOR ALL USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "decisions_select" ON meeting_decisions
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "decisions_modify" ON meeting_decisions
  FOR ALL USING (is_director()) WITH CHECK (is_director());

CREATE POLICY "actions_select" ON meeting_action_items
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "actions_modify" ON meeting_action_items
  FOR ALL USING (is_director()) WITH CHECK (is_director());

