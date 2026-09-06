CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END;
$roles$;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  role text NOT NULL,
  full_name text,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.role_permissions (
  role text NOT NULL,
  resource_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, resource_key)
);
CREATE TABLE public.departments (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.positions (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE public.department_members (
  department_id uuid NOT NULL REFERENCES public.departments(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  position_id uuid REFERENCES public.positions(id),
  is_department_head boolean NOT NULL DEFAULT false,
  PRIMARY KEY (department_id, user_id)
);
CREATE TABLE public.department_access_permissions (
  department_id uuid NOT NULL REFERENCES public.departments(id),
  subject_scope text NOT NULL,
  resource_key text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_manage boolean NOT NULL DEFAULT false,
  PRIMARY KEY (department_id, subject_scope, resource_key)
);

CREATE TABLE public.mail_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id),
  disconnected_at timestamptz
);
CREATE TABLE public.mail_threads (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.mail_accounts(id)
);
CREATE TABLE public.mail_messages (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.mail_accounts(id),
  thread_id uuid NOT NULL REFERENCES public.mail_threads(id)
);

CREATE TABLE public.product_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  client_id uuid,
  description text NOT NULL DEFAULT '',
  characteristics text NOT NULL DEFAULT '',
  client_wishes text NOT NULL DEFAULT '',
  assigned_engineer_id uuid NOT NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'new_project',
  approved_version_id uuid,
  created_by uuid REFERENCES public.users(id),
  updated_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.product_project_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.product_projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  version_label text,
  description text NOT NULL DEFAULT '',
  characteristics text NOT NULL DEFAULT '',
  client_wishes text NOT NULL DEFAULT '',
  name_uk text,
  name_en text,
  uktzed text,
  drawing_number text,
  unit_weight_kg numeric,
  base_price_eur numeric,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version_number)
);
ALTER TABLE public.product_projects
  ADD CONSTRAINT product_projects_approved_version_id_fkey
  FOREIGN KEY (approved_version_id) REFERENCES public.product_project_versions(id) ON DELETE SET NULL;
CREATE TABLE public.product_project_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.product_projects(id) ON DELETE CASCADE,
  version_id uuid REFERENCES public.product_project_versions(id) ON DELETE CASCADE,
  file_kind text NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  file_size bigint,
  uploaded_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid,
  product_project_id uuid REFERENCES public.product_projects(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.users(id),
  task_type text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'pending',
  start_date date,
  deadline date NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.department_requests (
  id uuid PRIMARY KEY,
  target_department text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  machine_id uuid,
  due_date date,
  created_by uuid NOT NULL REFERENCES public.users(id),
  factory_id uuid
);
CREATE FUNCTION public.create_department_request(
  p_request_id uuid,
  p_target_department text,
  p_title text,
  p_description text,
  p_machine_id uuid DEFAULT NULL,
  p_due_date date DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.department_requests(
    id, target_department, title, description, machine_id, due_date, created_by
  ) VALUES (
    p_request_id, p_target_department, p_title, p_description,
    p_machine_id, p_due_date, auth.uid()
  );
  RETURN p_request_id;
END;
$$;

CREATE TABLE public.product_project_mail_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_project_id uuid NOT NULL REFERENCES public.product_projects(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.mail_threads(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by uuid REFERENCES public.users(id),
  UNIQUE (product_project_id, thread_id)
);
CREATE TABLE public.product_project_mail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_project_id uuid NOT NULL REFERENCES public.product_projects(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.mail_messages(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by uuid REFERENCES public.users(id),
  UNIQUE (product_project_id, message_id)
);
CREATE TABLE public.department_request_mail_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_request_id uuid NOT NULL REFERENCES public.department_requests(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.mail_threads(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by uuid REFERENCES public.users(id),
  UNIQUE (department_request_id, thread_id)
);
CREATE TABLE public.department_request_mail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_request_id uuid NOT NULL REFERENCES public.department_requests(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.mail_messages(id) ON DELETE RESTRICT,
  linked_by uuid NOT NULL REFERENCES public.users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by uuid REFERENCES public.users(id),
  UNIQUE (department_request_id, message_id)
);

ALTER TABLE public.mail_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_project_mail_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_project_mail_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_request_mail_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_request_mail_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_threads_owner_or_crm_reader
  ON public.mail_threads FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mail_accounts AS account
      WHERE account.id = mail_threads.account_id AND account.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.product_project_mail_threads AS link
      WHERE link.thread_id = mail_threads.id AND link.unlinked_at IS NULL
    )
  );
CREATE POLICY mail_messages_owner_or_crm_reader
  ON public.mail_messages FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mail_accounts AS account
      WHERE account.id = mail_messages.account_id AND account.user_id = auth.uid()
    ) OR EXISTS (
      SELECT 1 FROM public.product_project_mail_messages AS link
      WHERE link.message_id = mail_messages.id AND link.unlinked_at IS NULL
    )
  );
CREATE POLICY product_project_mail_links_reader
  ON public.product_project_mail_threads FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mail_threads AS thread
    WHERE thread.id = product_project_mail_threads.thread_id
  ));
CREATE POLICY product_project_mail_links_manager_insert
  ON public.product_project_mail_threads FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mail_threads AS thread WHERE thread.id = thread_id
  ));
CREATE POLICY product_project_mail_links_manager_update
  ON public.product_project_mail_threads FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY product_project_mail_messages_reader
  ON public.product_project_mail_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.mail_messages AS message
    WHERE message.id = product_project_mail_messages.message_id
  ));
CREATE POLICY product_project_mail_messages_manager_insert
  ON public.product_project_mail_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.mail_messages AS message WHERE message.id = message_id
  ));
CREATE POLICY product_project_mail_messages_manager_update
  ON public.product_project_mail_messages FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);
CREATE POLICY department_request_mail_threads_owner_insert
  ON public.department_request_mail_threads FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY department_request_mail_messages_owner_insert
  ON public.department_request_mail_messages FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
GRANT SELECT ON public.users, public.role_permissions, public.departments,
  public.positions, public.department_members, public.department_access_permissions,
  public.mail_accounts, public.mail_threads, public.mail_messages,
  public.product_projects, public.product_project_versions,
  public.department_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_project_mail_threads,
  public.product_project_mail_messages, public.department_request_mail_threads,
  public.department_request_mail_messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_department_request(
  uuid, text, text, text, uuid, date, jsonb
) TO authenticated, service_role;

INSERT INTO public.users(id, role, full_name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'sales_manager', 'Менеджер'),
  ('10000000-0000-0000-0000-000000000002', 'sales_manager', 'Чужой менеджер'),
  ('10000000-0000-0000-0000-000000000003', 'engineer', 'Инженер');
INSERT INTO public.role_permissions(role, resource_key, can_view, can_manage)
VALUES ('sales_manager', 'product_projects', true, true);
INSERT INTO public.departments(id, name)
VALUES ('11000000-0000-0000-0000-000000000001', 'Технический отдел');
INSERT INTO public.department_members(department_id, user_id)
VALUES (
  '11000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003'
);

INSERT INTO public.mail_accounts(id, user_id) VALUES
  ('12000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('12000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002');
INSERT INTO public.mail_threads(id, account_id) VALUES
  ('40000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002');
INSERT INTO public.mail_messages(id, account_id, thread_id) VALUES
  ('50000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002');

INSERT INTO public.product_projects(
  id, title, description, characteristics, client_wishes,
  assigned_engineer_id, status, created_by, updated_by
) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Проект A', 'Описание', 'Характеристики', 'Исходные пожелания', '10000000-0000-0000-0000-000000000003', 'approved', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Проект B', '', '', 'Другие пожелания', '10000000-0000-0000-0000-000000000003', 'draft', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.product_project_versions(
  id, project_id, version_number, version_label, description,
  characteristics, client_wishes, name_uk, name_en, uktzed,
  drawing_number, unit_weight_kg, base_price_eur, status, created_by
) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, '1', 'Описание', 'Характеристики', 'Исходные пожелания', 'Название UA', 'Name EN', '1234', 'DRAW-1', 12.5, 99.5, 'approved', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 1, '1', '', '', 'Другие пожелания', NULL, NULL, NULL, NULL, NULL, NULL, 'draft', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 2, '2', 'Описание', 'Характеристики', 'Старое замечание', 'Название UA', 'Name EN', '1234', 'DRAW-1', 12.5, 99.5, 'draft', '10000000-0000-0000-0000-000000000001');
UPDATE public.product_projects
SET approved_version_id = '30000000-0000-0000-0000-000000000003'
WHERE id = '20000000-0000-0000-0000-000000000001';

INSERT INTO public.tasks(
  product_project_id, assigned_to, task_type, title, description,
  status, start_date, deadline
) VALUES (
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003',
  'product_project_sales_review', 'Проверить', 'Проверка', 'pending', current_date, current_date + 2
);
