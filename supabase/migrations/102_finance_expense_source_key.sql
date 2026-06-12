-- Link auto-created supply finance expenses back to their source order group.

ALTER TABLE finance_expenses
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_expenses_source_unique
  ON finance_expenses(source_type, source_key)
  WHERE source_type IS NOT NULL AND source_key IS NOT NULL;
