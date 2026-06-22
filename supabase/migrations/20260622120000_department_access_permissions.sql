-- Department/position-based access model.
-- Legacy users.role and role_permissions stay in place during the staged migration.

ALTER TABLE department_members
  DROP CONSTRAINT IF EXISTS department_members_user_id_department_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_department_members_unique_position
  ON department_members (user_id, department_id, position_id)
  WHERE position_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_department_members_unique_no_position
  ON department_members (user_id, department_id)
  WHERE position_id IS NULL;

CREATE TABLE IF NOT EXISTS department_access_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  subject_scope TEXT NOT NULL CHECK (subject_scope IN ('head', 'member')),
  resource_key TEXT NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT false,
  can_manage BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT department_access_permissions_unique_scope UNIQUE (department_id, subject_scope, resource_key),
  CONSTRAINT department_access_permissions_manage_requires_view CHECK (can_view OR NOT can_manage)
);

CREATE INDEX IF NOT EXISTS idx_department_access_permissions_department_scope
  ON department_access_permissions (department_id, subject_scope);

CREATE TABLE IF NOT EXISTS department_access_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  subject_scope TEXT NOT NULL CHECK (subject_scope IN ('head', 'member')),
  resource_key TEXT NOT NULL,
  old_can_view BOOLEAN,
  old_can_manage BOOLEAN,
  new_can_view BOOLEAN NOT NULL,
  new_can_manage BOOLEAN NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_department_access_audit_log_department_changed
  ON department_access_audit_log (department_id, changed_at DESC);

ALTER TABLE department_access_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_access_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "department_access_permissions_select_authenticated" ON department_access_permissions;
CREATE POLICY "department_access_permissions_select_authenticated" ON department_access_permissions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "department_access_permissions_modify_service_role" ON department_access_permissions;
CREATE POLICY "department_access_permissions_modify_service_role" ON department_access_permissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "department_access_audit_log_select_authenticated" ON department_access_audit_log;
CREATE POLICY "department_access_audit_log_select_authenticated" ON department_access_audit_log
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "department_access_audit_log_insert_service_role" ON department_access_audit_log;
CREATE POLICY "department_access_audit_log_insert_service_role" ON department_access_audit_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_department_access_permissions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_department_access_permissions_updated_at ON department_access_permissions;
CREATE TRIGGER trg_department_access_permissions_updated_at
  BEFORE UPDATE ON department_access_permissions
  FOR EACH ROW
  EXECUTE FUNCTION update_department_access_permissions_updated_at();

INSERT INTO positions (name, description, level, is_active)
VALUES ('Администратор CRM', 'Полный системный доступ через должность, без зависимости от legacy role.', 10, true)
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description,
    level = GREATEST(positions.level, EXCLUDED.level),
    is_active = true;

WITH existing_department_roles AS (
  SELECT DISTINCT
    dm.department_id,
    CASE WHEN dm.is_department_head THEN 'head' ELSE 'member' END AS subject_scope,
    u.role
  FROM department_members dm
  JOIN users u ON u.id = dm.user_id
  WHERE u.role IS NOT NULL
),
seed_permissions AS (
  SELECT
    edr.department_id,
    edr.subject_scope,
    rp.resource_key,
    bool_or(rp.can_view) AS can_view,
    bool_or(rp.can_manage) AS can_manage
  FROM existing_department_roles edr
  JOIN role_permissions rp ON rp.role = edr.role
  GROUP BY edr.department_id, edr.subject_scope, rp.resource_key
)
INSERT INTO department_access_permissions (department_id, subject_scope, resource_key, can_view, can_manage)
SELECT department_id, subject_scope, resource_key, can_view OR can_manage, can_manage
FROM seed_permissions
ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE
SET can_view = EXCLUDED.can_view,
    can_manage = EXCLUDED.can_manage,
    updated_at = NOW();

WITH admin_position AS (
  SELECT id FROM positions WHERE name = 'Администратор CRM' LIMIT 1
),
igor_user AS (
  SELECT id
  FROM users
  WHERE lower(coalesce(full_name, '')) IN ('игорь рябов', 'igor riabov', 'igor rabov')
     OR lower(coalesce(email, '')) LIKE '%igor%'
  ORDER BY created_at NULLS LAST
  LIMIT 1
),
target_department AS (
  SELECT d.id
  FROM departments d
  WHERE lower(d.name) LIKE '%план%'
  ORDER BY d.created_at NULLS LAST
  LIMIT 1
),
fallback_department AS (
  SELECT department_id AS id
  FROM department_members
  WHERE user_id = (SELECT id FROM igor_user)
  ORDER BY is_department_head DESC, joined_at NULLS LAST
  LIMIT 1
),
selected_department AS (
  SELECT id FROM target_department
  UNION ALL
  SELECT id FROM fallback_department
  LIMIT 1
)
INSERT INTO department_members (department_id, user_id, position_id, is_department_head, reports_to_user_id)
SELECT
  selected_department.id,
  igor_user.id,
  admin_position.id,
  false,
  NULL
FROM selected_department, igor_user, admin_position
ON CONFLICT DO NOTHING;
