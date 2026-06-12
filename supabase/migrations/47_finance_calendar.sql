-- Finance calendar: planned expenses, income audit dates, Telegram recipients, and reminders.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_expense_status') THEN
    CREATE TYPE finance_expense_status AS ENUM ('planned', 'partially_paid', 'paid', 'overdue', 'rejected');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_recurrence_frequency') THEN
    CREATE TYPE finance_recurrence_frequency AS ENUM ('weekly', 'monthly', 'quarterly');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'finance_event_type') THEN
    CREATE TYPE finance_event_type AS ENUM ('income', 'expense');
  END IF;
END $$;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS original_planned_date date,
  ADD COLUMN IF NOT EXISTS rescheduled_date date,
  ADD COLUMN IF NOT EXISTS actual_paid_date date,
  ADD COLUMN IF NOT EXISTS finance_comment text,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE invoices
SET original_planned_date = COALESCE(original_planned_date, due_date, payment_date)
WHERE original_planned_date IS NULL;

CREATE TABLE IF NOT EXISTS finance_expense_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  category text NOT NULL,
  counterparty text NOT NULL,
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  frequency finance_recurrence_frequency NOT NULL,
  weekdays smallint[] NOT NULL DEFAULT '{}',
  month_days smallint[] NOT NULL DEFAULT '{}',
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_series_weekdays_valid CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]::smallint[]),
  CONSTRAINT finance_series_month_days_valid CHECK (month_days <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]),
  CONSTRAINT finance_series_end_after_start CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS finance_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid REFERENCES finance_expense_series(id) ON DELETE SET NULL,
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  category text NOT NULL,
  counterparty text NOT NULL,
  responsible_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  planned_date date NOT NULL,
  original_planned_date date NOT NULL,
  rescheduled_date date,
  actual_paid_date date,
  status finance_expense_status NOT NULL DEFAULT 'planned',
  paid_amount numeric NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  comment text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_expense_paid_lte_amount CHECK (paid_amount <= amount)
);

CREATE TABLE IF NOT EXISTS finance_event_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type finance_event_type NOT NULL,
  event_id uuid NOT NULL,
  action text NOT NULL,
  previous_planned_date date,
  new_planned_date date,
  amount numeric,
  comment text,
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  performed_via text NOT NULL DEFAULT 'crm',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_telegram_recipients (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_telegram_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type finance_event_type NOT NULL,
  event_id uuid NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  notification_date date NOT NULL DEFAULT CURRENT_DATE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_type, event_id, user_id, notification_date)
);

CREATE TABLE IF NOT EXISTS finance_telegram_dialog_states (
  chat_id text PRIMARY KEY,
  event_type finance_event_type NOT NULL,
  event_id uuid NOT NULL,
  action text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_planned_date ON finance_expenses(planned_date);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_status ON finance_expenses(status);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_responsible ON finance_expenses(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_finance_expense_series_active ON finance_expense_series(is_active, start_date);
CREATE INDEX IF NOT EXISTS idx_finance_actions_event ON finance_event_actions(event_type, event_id, created_at);

CREATE OR REPLACE FUNCTION trg_finance_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finance_expenses_updated_at ON finance_expenses;
CREATE TRIGGER trg_finance_expenses_updated_at
  BEFORE UPDATE ON finance_expenses
  FOR EACH ROW EXECUTE FUNCTION trg_finance_set_updated_at();

DROP TRIGGER IF EXISTS trg_finance_expense_series_updated_at ON finance_expense_series;
CREATE TRIGGER trg_finance_expense_series_updated_at
  BEFORE UPDATE ON finance_expense_series
  FOR EACH ROW EXECUTE FUNCTION trg_finance_set_updated_at();

CREATE OR REPLACE FUNCTION check_daily_finance_overdue()
RETURNS void AS $$
BEGIN
  UPDATE invoices
  SET status = 'overdue'
  WHERE status = 'not_paid'
    AND COALESCE(rescheduled_date, due_date, payment_date) IS NOT NULL
    AND CURRENT_DATE > COALESCE(rescheduled_date, due_date, payment_date);

  UPDATE finance_expenses
  SET status = 'overdue'
  WHERE status IN ('planned', 'partially_paid')
    AND CURRENT_DATE > planned_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE finance_expense_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_event_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_telegram_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_telegram_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_telegram_dialog_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_expense_series_select" ON finance_expense_series;
CREATE POLICY "finance_expense_series_select" ON finance_expense_series
  FOR SELECT USING (is_director() OR EXISTS (SELECT 1 FROM finance_telegram_recipients r WHERE r.user_id = auth.uid() AND r.is_active));

DROP POLICY IF EXISTS "finance_expense_series_modify" ON finance_expense_series;
CREATE POLICY "finance_expense_series_modify" ON finance_expense_series
  FOR ALL USING (is_director()) WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_expenses_select" ON finance_expenses;
CREATE POLICY "finance_expenses_select" ON finance_expenses
  FOR SELECT USING (is_director() OR responsible_user_id = auth.uid() OR EXISTS (SELECT 1 FROM finance_telegram_recipients r WHERE r.user_id = auth.uid() AND r.is_active));

DROP POLICY IF EXISTS "finance_expenses_modify" ON finance_expenses;
CREATE POLICY "finance_expenses_modify" ON finance_expenses
  FOR ALL USING (is_director()) WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_event_actions_select" ON finance_event_actions;
CREATE POLICY "finance_event_actions_select" ON finance_event_actions
  FOR SELECT USING (is_director());

DROP POLICY IF EXISTS "finance_event_actions_modify" ON finance_event_actions;
CREATE POLICY "finance_event_actions_modify" ON finance_event_actions
  FOR ALL USING (is_director()) WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_telegram_recipients_select" ON finance_telegram_recipients;
CREATE POLICY "finance_telegram_recipients_select" ON finance_telegram_recipients
  FOR SELECT USING (is_director());

DROP POLICY IF EXISTS "finance_telegram_recipients_modify" ON finance_telegram_recipients;
CREATE POLICY "finance_telegram_recipients_modify" ON finance_telegram_recipients
  FOR ALL USING (is_director()) WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_telegram_notifications_select" ON finance_telegram_notifications;
CREATE POLICY "finance_telegram_notifications_select" ON finance_telegram_notifications
  FOR SELECT USING (is_director());

DROP POLICY IF EXISTS "finance_telegram_notifications_modify" ON finance_telegram_notifications;
CREATE POLICY "finance_telegram_notifications_modify" ON finance_telegram_notifications
  FOR ALL USING (is_director()) WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_telegram_dialog_states_select" ON finance_telegram_dialog_states;
CREATE POLICY "finance_telegram_dialog_states_select" ON finance_telegram_dialog_states
  FOR SELECT USING (is_director());

DROP POLICY IF EXISTS "finance_telegram_dialog_states_modify" ON finance_telegram_dialog_states;
CREATE POLICY "finance_telegram_dialog_states_modify" ON finance_telegram_dialog_states
  FOR ALL USING (is_director()) WITH CHECK (is_director());
