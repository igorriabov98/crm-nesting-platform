/* Дополнительные расходы машины */
CREATE TABLE machine_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  category text NOT NULL,          /* Категория (Транспорт, Монтаж, и т.д.) */
  amount decimal NOT NULL CHECK (amount >= 0),  /* Сумма */
  comment text,                    /* Комментарий (опционально) */
  created_at timestamptz DEFAULT now()
);

/* Индексы */
CREATE INDEX idx_machine_expenses_machine_id ON machine_expenses(machine_id);

/* RLS (аналогично machine_items) */
ALTER TABLE machine_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "machine_expenses_select" ON machine_expenses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_expenses.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );

CREATE POLICY "machine_expenses_insert" ON machine_expenses
  FOR INSERT WITH CHECK (
    get_user_role() IN ('planning_director', 'financial_director',
      'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_expenses.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );

CREATE POLICY "machine_expenses_update" ON machine_expenses
  FOR UPDATE USING (
    get_user_role() IN ('planning_director', 'financial_director',
      'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_expenses.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );

CREATE POLICY "machine_expenses_delete" ON machine_expenses
  FOR DELETE USING (
    get_user_role() IN ('planning_director', 'financial_director',
      'commercial_director', 'sales_manager')
    AND EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_expenses.machine_id
      AND m.factory_id = get_user_factory_id()
    )
  );
