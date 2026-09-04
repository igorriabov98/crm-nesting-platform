-- Broker department, permission resource and private machine customs documents.
-- The enum change is isolated because PostgreSQL cannot safely use a new enum
-- value in the same migration transaction.

ALTER TYPE public.task_type ADD VALUE IF NOT EXISTS 'customs_clearance';

INSERT INTO public.positions (name, level, description, is_active)
VALUES
  ('Начальник Брокерского отдела', 2, 'Руководитель Брокерского отдела', true),
  ('Брокер', 0, 'Таможенное оформление машин', true)
ON CONFLICT (name) DO UPDATE
SET level = EXCLUDED.level,
    description = EXCLUDED.description,
    is_active = true;

INSERT INTO public.departments (name, description, parent_id, head_user_id, factory_id, is_active, sort_order)
SELECT
  'Брокерский',
  'Таможенное оформление машин обоих заводов',
  NULL,
  NULL,
  NULL,
  true,
  COALESCE((SELECT MAX(sort_order) + 10 FROM public.departments WHERE parent_id IS NULL), 10)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.departments
  WHERE lower(btrim(name)) = lower('Брокерский')
);

ALTER TABLE public.department_access_permissions
  DROP CONSTRAINT IF EXISTS department_access_permissions_factory_scope_check;

ALTER TABLE public.department_access_permissions
  ADD CONSTRAINT department_access_permissions_factory_scope_check
  CHECK (
    factory_scope IN ('own', 'all')
    AND (
      factory_scope = 'own'
      OR resource_key IN ('production_cutting_area', 'customs_clearance')
    )
  );

ALTER TABLE public.department_access_audit_log
  DROP CONSTRAINT IF EXISTS department_access_audit_log_old_factory_scope_check,
  DROP CONSTRAINT IF EXISTS department_access_audit_log_new_factory_scope_check;

ALTER TABLE public.department_access_audit_log
  ADD CONSTRAINT department_access_audit_log_old_factory_scope_check
    CHECK (
      old_factory_scope IS NULL
      OR (
        old_factory_scope IN ('own', 'all')
        AND (
          old_factory_scope = 'own'
          OR resource_key IN ('production_cutting_area', 'customs_clearance')
        )
      )
    ),
  ADD CONSTRAINT department_access_audit_log_new_factory_scope_check
    CHECK (
      new_factory_scope IN ('own', 'all')
      AND (
        new_factory_scope = 'own'
        OR resource_key IN ('production_cutting_area', 'customs_clearance')
      )
    );

INSERT INTO public.department_access_permissions (
  department_id,
  subject_scope,
  resource_key,
  can_view,
  can_manage,
  factory_scope
)
SELECT department.id, scope.subject_scope, permission.resource_key,
       true, true, permission.factory_scope
FROM public.departments department
CROSS JOIN (VALUES ('head'), ('member')) AS scope(subject_scope)
CROSS JOIN (
  VALUES
    ('customs_clearance', 'all'),
    ('tasks', 'own')
) AS permission(resource_key, factory_scope)
WHERE lower(btrim(department.name)) = lower('Брокерский')
ON CONFLICT (department_id, subject_scope, resource_key) DO UPDATE
SET can_view = true,
    can_manage = true,
    factory_scope = EXCLUDED.factory_scope,
    updated_at = now();

CREATE TABLE IF NOT EXISTS public.machine_customs_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  document_kind text NOT NULL CHECK (document_kind IN ('invoice', 'specification', 'packing_list', 'other')),
  file_name text NOT NULL CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 240),
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  storage_path text NOT NULL UNIQUE CHECK (
    storage_path LIKE 'customs-clearance/%'
    AND storage_path NOT LIKE '%..%'
  ),
  uploaded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_machine_customs_documents_machine_created
  ON public.machine_customs_documents (machine_id, created_at DESC);

ALTER TABLE public.machine_customs_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "machine_customs_documents_service_role" ON public.machine_customs_documents;
CREATE POLICY "machine_customs_documents_service_role"
  ON public.machine_customs_documents
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.machine_customs_documents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.machine_customs_documents TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'customs-clearance-files',
  'customs-clearance-files',
  false,
  26214400,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMENT ON TABLE public.machine_customs_documents IS
  'Private broker-uploaded customs documents attached to a machine.';

SELECT pg_notify('pgrst', 'reload schema');
