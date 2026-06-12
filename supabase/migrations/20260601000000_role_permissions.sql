-- Управляемая матрица доступа по ролям для v0.1.

CREATE TABLE IF NOT EXISTS role_permissions (
  role user_role NOT NULL,
  resource_key TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_manage BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, resource_key),
  CONSTRAINT role_permissions_manage_requires_view CHECK (can_view OR NOT can_manage)
);

CREATE TABLE IF NOT EXISTS role_permission_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role user_role NOT NULL,
  resource_key TEXT NOT NULL,
  old_can_view BOOLEAN,
  old_can_manage BOOLEAN,
  new_can_view BOOLEAN NOT NULL,
  new_can_manage BOOLEAN NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permission_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select_authenticated" ON role_permissions;
CREATE POLICY "role_permissions_select_authenticated" ON role_permissions
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "role_permissions_modify_directors" ON role_permissions;
CREATE POLICY "role_permissions_modify_directors" ON role_permissions
  FOR ALL TO authenticated
  USING (is_director())
  WITH CHECK (is_director());

DROP POLICY IF EXISTS "role_permission_audit_select_directors" ON role_permission_audit_log;
CREATE POLICY "role_permission_audit_select_directors" ON role_permission_audit_log
  FOR SELECT TO authenticated
  USING (is_director());

DROP POLICY IF EXISTS "role_permission_audit_insert_directors" ON role_permission_audit_log;
CREATE POLICY "role_permission_audit_insert_directors" ON role_permission_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (is_director());

CREATE OR REPLACE FUNCTION update_role_permissions_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_role_permissions_updated_at ON role_permissions;
CREATE TRIGGER trg_role_permissions_updated_at
  BEFORE UPDATE ON role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_role_permissions_updated_at();

WITH all_roles(role) AS (
  VALUES
    ('financial_director'::user_role),
    ('commercial_director'::user_role),
    ('planning_director'::user_role),
    ('sales_manager'::user_role),
    ('engineer'::user_role),
    ('technologist'::user_role),
    ('supply_manager'::user_role),
    ('production_manager'::user_role),
    ('procurement_head'::user_role),
    ('painting_head'::user_role)
),
seed(resource_key, view_roles, manage_roles) AS (
  VALUES
    ('dashboard', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[], ARRAY[]::user_role[]),
    ('sales_plan', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager']::user_role[]),
    ('technologist_requests', ARRAY['financial_director','commercial_director','planning_director','engineer','technologist','supply_manager']::user_role[], ARRAY['financial_director','commercial_director','planning_director','technologist']::user_role[]),
    ('products', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer']::user_role[]),
    ('product_projects', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer']::user_role[]),
    ('clients', ARRAY['financial_director','commercial_director','planning_director','sales_manager']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager']::user_role[]),
    ('contracts', ARRAY['financial_director','commercial_director','planning_director','sales_manager']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager']::user_role[]),
    ('invoices', ARRAY['financial_director','commercial_director','planning_director','sales_manager']::user_role[], ARRAY['financial_director','planning_director','sales_manager']::user_role[]),
    ('finance_calendar', ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[], ARRAY['financial_director','planning_director','supply_manager']::user_role[]),
    ('supply_finance', ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[], ARRAY['financial_director','planning_director','supply_manager']::user_role[]),
    ('tasks', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[]),
    ('production', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager','production_manager']::user_role[]),
    ('supply', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[], ARRAY['financial_director','commercial_director','planning_director','engineer','technologist','supply_manager']::user_role[]),
    ('supply_orders', ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[], ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[]),
    ('inventory', ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[], ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[]),
    ('suppliers', ARRAY['financial_director','commercial_director','planning_director']::user_role[], ARRAY['financial_director','commercial_director','planning_director']::user_role[]),
    ('materials', ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[], ARRAY['financial_director','commercial_director','planning_director','supply_manager']::user_role[]),
    ('nesting', ARRAY['financial_director','commercial_director','planning_director','technologist']::user_role[], ARRAY['financial_director','commercial_director','planning_director','technologist']::user_role[]),
    ('nesting_catalog', ARRAY['financial_director','commercial_director','planning_director','technologist']::user_role[], ARRAY['financial_director','commercial_director','planning_director','technologist']::user_role[]),
    ('nesting_settings', ARRAY['financial_director','commercial_director','planning_director']::user_role[], ARRAY['financial_director','commercial_director','planning_director']::user_role[]),
    ('meetings', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[], ARRAY['financial_director','commercial_director','planning_director']::user_role[]),
    ('meetings_agenda_pool', ARRAY['planning_director']::user_role[], ARRAY['planning_director']::user_role[]),
    ('notifications', ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[], ARRAY['financial_director','commercial_director','planning_director','sales_manager','engineer','technologist','supply_manager','production_manager','procurement_head','painting_head']::user_role[]),
    ('admin_settings', ARRAY['financial_director','commercial_director','planning_director']::user_role[], ARRAY['financial_director','commercial_director','planning_director']::user_role[]),
    ('admin_users', ARRAY['planning_director']::user_role[], ARRAY['planning_director']::user_role[]),
    ('telegram_settings', ARRAY['financial_director','commercial_director','planning_director']::user_role[], ARRAY['financial_director','commercial_director','planning_director']::user_role[]),
    ('company_settings', ARRAY['financial_director','commercial_director','planning_director']::user_role[], ARRAY['financial_director','commercial_director','planning_director']::user_role[])
)
INSERT INTO role_permissions (role, resource_key, can_view, can_manage)
SELECT
  all_roles.role,
  seed.resource_key,
  all_roles.role = ANY(seed.view_roles) OR all_roles.role = ANY(seed.manage_roles),
  all_roles.role = ANY(seed.manage_roles)
FROM all_roles
CROSS JOIN seed
ON CONFLICT (role, resource_key) DO NOTHING;
