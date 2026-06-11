-- ОБНОВИТЬ RLS для machines:
-- Старая логика: пользователь видит только машины своего завода
-- Новая логика:
--   1. Начальник производства → только машины своего завода
--   2. Все остальные → все машины (обоих заводов + без завода)

DROP POLICY IF EXISTS "machines_select" ON machines;

CREATE POLICY "machines_select" ON machines
  FOR SELECT USING (
    CASE
      -- Начальник производства видит только свой завод
      WHEN get_user_role() = 'production_manager' THEN
        factory_id = get_user_factory_id()
      -- Все остальные видят все машины (включая без завода)
      ELSE
        true
    END
  );

-- Аналогично обновить для production_stages, supply_items
-- (они привязаны к machines через machine_id)

DROP POLICY IF EXISTS "production_stages_select" ON production_stages;

CREATE POLICY "production_stages_select" ON production_stages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = production_stages.machine_id
      AND (
        CASE
          WHEN get_user_role() = 'production_manager' THEN
            m.factory_id = get_user_factory_id()
          ELSE true
        END
      )
    )
  );

DROP POLICY IF EXISTS "supply_items_select" ON supply_items;

CREATE POLICY "supply_items_select" ON supply_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = supply_items.machine_id
      AND (
        CASE
          WHEN get_user_role() = 'production_manager' THEN
            m.factory_id = get_user_factory_id()
          ELSE true
        END
      )
    )
  );

-- machine_items и machine_expenses — аналогично
DROP POLICY IF EXISTS "machine_items_select" ON machine_items;

CREATE POLICY "machine_items_select" ON machine_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_items.machine_id
      AND (
        CASE
          WHEN get_user_role() = 'production_manager' THEN
            m.factory_id = get_user_factory_id()
          ELSE true
        END
      )
    )
  );

DROP POLICY IF EXISTS "machine_expenses_select" ON machine_expenses;

CREATE POLICY "machine_expenses_select" ON machine_expenses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM machines m
      WHERE m.id = machine_expenses.machine_id
      AND (
        CASE
          WHEN get_user_role() = 'production_manager' THEN
            m.factory_id = get_user_factory_id()
          ELSE true
        END
      )
    )
  );

-- Invoices — начальник производства НЕ видит + фильтр по заводу
DROP POLICY IF EXISTS "invoices_select" ON invoices;

CREATE POLICY "invoices_select" ON invoices
  FOR SELECT USING (
    get_user_role() IN (
      'planning_director', 'financial_director',
      'commercial_director', 'sales_manager'
    )
    -- Нач. производства по-прежнему не видит инвойсы
  );
