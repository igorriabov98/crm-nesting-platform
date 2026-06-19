-- Организационная структура: должности, отделы и членство пользователей.
-- Текущий RBAC через users.role и role_permissions сохраняется без изменений схемы.

CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  level INT NOT NULL DEFAULT 0,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  parent_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  head_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  factory_id UUID REFERENCES factories(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT departments_no_self_parent CHECK (parent_id != id)
);

CREATE INDEX idx_departments_parent ON departments(parent_id);
CREATE INDEX idx_departments_factory ON departments(factory_id);

CREATE TABLE department_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
  reports_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_department_head BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE(user_id, department_id),
  CONSTRAINT dm_no_self_report CHECK (reports_to_user_id != user_id)
);

CREATE INDEX idx_dm_user ON department_members(user_id);
CREATE INDEX idx_dm_department ON department_members(department_id);
CREATE INDEX idx_dm_reports_to ON department_members(reports_to_user_id);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "positions_select" ON positions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "departments_select" ON departments
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "dm_select" ON department_members
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "positions_modify" ON positions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "departments_modify" ON departments
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "dm_modify" ON department_members
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO role_permissions (role, resource_key, can_view, can_manage)
SELECT enum_role, 'departments', true, false
FROM unnest(enum_range(NULL::user_role)) AS enum_role
ON CONFLICT (role, resource_key) DO NOTHING;

UPDATE role_permissions
SET can_manage = true
WHERE resource_key = 'departments'
  AND role IN ('planning_director', 'financial_director');
