-- RLS policies for client cards.

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clients_select" ON clients;
CREATE POLICY "clients_select" ON clients
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "clients_insert_sales" ON clients;
CREATE POLICY "clients_insert_sales" ON clients
  FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  );

DROP POLICY IF EXISTS "clients_update_sales" ON clients;
CREATE POLICY "clients_update_sales" ON clients
  FOR UPDATE TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  )
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  );

DROP POLICY IF EXISTS "client_contacts_select" ON client_contacts;
CREATE POLICY "client_contacts_select" ON client_contacts
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "client_contacts_modify_sales" ON client_contacts;
CREATE POLICY "client_contacts_modify_sales" ON client_contacts
  FOR ALL TO authenticated
  USING (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  )
  WITH CHECK (
    get_user_role() IN (
      'planning_director',
      'financial_director',
      'commercial_director',
      'sales_manager'
    )
  );
