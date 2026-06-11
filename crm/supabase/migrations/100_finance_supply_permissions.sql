-- Tighten finance permissions after adding the supply financial plan.
-- Directors keep full control. Supply can view finance and modify only supply-plan expenses.

ALTER TABLE finance_expense_series
  ADD COLUMN IF NOT EXISTS is_supply_plan boolean NOT NULL DEFAULT false;

ALTER TABLE finance_expenses
  ADD COLUMN IF NOT EXISTS is_supply_plan boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "finance_expense_series_modify" ON finance_expense_series;
CREATE POLICY "finance_expense_series_modify" ON finance_expense_series
  FOR ALL USING (
    is_director()
    OR (
      is_supply_plan = true
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
    )
  ) WITH CHECK (
    is_director()
    OR (
      is_supply_plan = true
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
    )
  );

DROP POLICY IF EXISTS "finance_expenses_modify" ON finance_expenses;
CREATE POLICY "finance_expenses_modify" ON finance_expenses
  FOR ALL USING (
    is_director()
    OR (
      is_supply_plan = true
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
    )
  ) WITH CHECK (
    is_director()
    OR (
      is_supply_plan = true
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
    )
  );

DROP POLICY IF EXISTS "finance_event_actions_select" ON finance_event_actions;
CREATE POLICY "finance_event_actions_select" ON finance_event_actions
  FOR SELECT USING (
    is_director()
    OR (
      event_type = 'expense'
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
      AND EXISTS (SELECT 1 FROM finance_expenses e WHERE e.id = event_id AND e.is_supply_plan = true)
    )
  );

DROP POLICY IF EXISTS "finance_event_actions_modify" ON finance_event_actions;
CREATE POLICY "finance_event_actions_modify" ON finance_event_actions
  FOR ALL USING (
    is_director()
    OR (
      event_type = 'expense'
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
      AND EXISTS (SELECT 1 FROM finance_expenses e WHERE e.id = event_id AND e.is_supply_plan = true)
    )
  ) WITH CHECK (
    is_director()
    OR (
      event_type = 'expense'
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
      AND EXISTS (SELECT 1 FROM finance_expenses e WHERE e.id = event_id AND e.is_supply_plan = true)
    )
  );

DROP POLICY IF EXISTS "finance_telegram_recipients_select" ON finance_telegram_recipients;
CREATE POLICY "finance_telegram_recipients_select" ON finance_telegram_recipients
  FOR SELECT USING (
    is_director()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'supply_manager')
  );

DROP POLICY IF EXISTS "finance_telegram_recipients_modify" ON finance_telegram_recipients;
CREATE POLICY "finance_telegram_recipients_modify" ON finance_telegram_recipients
  FOR ALL USING (is_director()) WITH CHECK (is_director());
