-- Fix RLS for machine child tables after machines.factory_id became nullable.
-- New machines are created without a factory, so child rows must be insertable
-- by the same roles that can create/edit machines.

DROP POLICY IF EXISTS "machine_items_insert" ON machine_items;
DROP POLICY IF EXISTS "machine_items_update" ON machine_items;
DROP POLICY IF EXISTS "machine_items_delete" ON machine_items;

CREATE POLICY "machine_items_insert" ON machine_items
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_items.machine_id
    )
  );

CREATE POLICY "machine_items_update" ON machine_items
  FOR UPDATE TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_items.machine_id
    )
  )
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_items.machine_id
    )
  );

CREATE POLICY "machine_items_delete" ON machine_items
  FOR DELETE TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_items.machine_id
    )
  );

DROP POLICY IF EXISTS "machine_expenses_insert" ON machine_expenses;
DROP POLICY IF EXISTS "machine_expenses_update" ON machine_expenses;
DROP POLICY IF EXISTS "machine_expenses_delete" ON machine_expenses;

CREATE POLICY "machine_expenses_insert" ON machine_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_expenses.machine_id
    )
  );

CREATE POLICY "machine_expenses_update" ON machine_expenses
  FOR UPDATE TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_expenses.machine_id
    )
  )
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_expenses.machine_id
    )
  );

CREATE POLICY "machine_expenses_delete" ON machine_expenses
  FOR DELETE TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
    AND EXISTS (
      SELECT 1
      FROM machines m
      WHERE m.id = machine_expenses.machine_id
    )
  );
