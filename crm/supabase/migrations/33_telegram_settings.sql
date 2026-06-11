-- Store operational CRM settings that directors can update from the UI.
-- Telegram token is kept here so directors do not need server filesystem access.

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Directors read settings" ON app_settings;
DROP POLICY IF EXISTS "Directors insert settings" ON app_settings;
DROP POLICY IF EXISTS "Directors update settings" ON app_settings;
DROP POLICY IF EXISTS "Directors delete settings" ON app_settings;

CREATE POLICY "Directors read settings" ON app_settings
  FOR SELECT TO authenticated
  USING (is_director());

CREATE POLICY "Directors insert settings" ON app_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_director());

CREATE POLICY "Directors update settings" ON app_settings
  FOR UPDATE TO authenticated
  USING (is_director())
  WITH CHECK (is_director());

CREATE POLICY "Directors delete settings" ON app_settings
  FOR DELETE TO authenticated
  USING (is_director());
