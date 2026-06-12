-- Backfill schema pieces required by the supply financial plan for databases
-- where migration 99 was applied before these columns were added to the repo.

ALTER TABLE finance_expense_series
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS amount_uah numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS factory_id uuid REFERENCES factories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_supply_plan boolean NOT NULL DEFAULT false;

ALTER TABLE finance_expenses
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR',
  ADD COLUMN IF NOT EXISTS amount_uah numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount_uah numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric,
  ADD COLUMN IF NOT EXISTS factory_id uuid REFERENCES factories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_supply_plan boolean NOT NULL DEFAULT false;

UPDATE finance_expense_series
SET amount_uah = amount
WHERE amount_uah = 0;

UPDATE finance_expenses
SET amount_uah = amount,
    paid_amount_uah = paid_amount
WHERE amount_uah = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_series_currency_valid'
      AND conrelid = 'finance_expense_series'::regclass
  ) THEN
    ALTER TABLE finance_expense_series
      ADD CONSTRAINT finance_series_currency_valid CHECK (currency IN ('UAH', 'EUR'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_expense_currency_valid'
      AND conrelid = 'finance_expenses'::regclass
  ) THEN
    ALTER TABLE finance_expenses
      ADD CONSTRAINT finance_expense_currency_valid CHECK (currency IN ('UAH', 'EUR'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_expense_paid_uah_lte_amount_uah'
      AND conrelid = 'finance_expenses'::regclass
  ) THEN
    ALTER TABLE finance_expenses
      ADD CONSTRAINT finance_expense_paid_uah_lte_amount_uah CHECK (paid_amount_uah <= amount_uah);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS finance_budget_limits (
  category text PRIMARY KEY,
  monthly_limit_uah numeric CHECK (monthly_limit_uah IS NULL OR monthly_limit_uah >= 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_settings (
  key text PRIMARY KEY,
  value_numeric numeric,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_expenses_supply_plan ON finance_expenses(is_supply_plan, category, planned_date);
CREATE INDEX IF NOT EXISTS idx_finance_expenses_factory ON finance_expenses(factory_id);

ALTER TABLE finance_budget_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_budget_limits_select" ON finance_budget_limits;
CREATE POLICY "finance_budget_limits_select" ON finance_budget_limits
  FOR SELECT USING (
    is_director()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
  );

DROP POLICY IF EXISTS "finance_budget_limits_modify" ON finance_budget_limits;
CREATE POLICY "finance_budget_limits_modify" ON finance_budget_limits
  FOR ALL USING (is_director()) WITH CHECK (is_director());

DROP POLICY IF EXISTS "finance_settings_select" ON finance_settings;
CREATE POLICY "finance_settings_select" ON finance_settings
  FOR SELECT USING (
    is_director()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
  );

DROP POLICY IF EXISTS "finance_settings_modify" ON finance_settings;
CREATE POLICY "finance_settings_modify" ON finance_settings
  FOR ALL USING (is_director()) WITH CHECK (is_director());
