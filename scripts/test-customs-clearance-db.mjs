import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const adminUrl = process.env.TEST_DATABASE_URL
if (!adminUrl) {
  console.log('customs clearance database checks skipped (TEST_DATABASE_URL is not set)')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseName = `customs_clearance_${process.pid}_${Date.now()}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`

function command(binary, args, ignoreFailure = false, input) {
  const result = spawnSync(binary, args, { encoding: 'utf8', input })
  if (result.status !== 0 && !ignoreFailure) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'))
  }
}

function psql(sql) {
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()], false, sql)
}

const schemaSql = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TYPE public.task_status AS ENUM ('pending','in_progress','completed','cancelled');
CREATE TYPE public.task_type AS ENUM ('shipping_documents','transport_cost');
CREATE TABLE public.users (id uuid PRIMARY KEY, full_name text, is_active boolean DEFAULT true, is_service_account boolean DEFAULT false);
CREATE TABLE public.factories (id uuid PRIMARY KEY, name text);
CREATE TABLE public.positions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, level integer NOT NULL DEFAULT 0, description text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now(), created_by uuid);
CREATE TABLE public.departments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text, parent_id uuid, head_user_id uuid, factory_id uuid, is_active boolean DEFAULT true, sort_order integer DEFAULT 0, created_at timestamptz DEFAULT now(), created_by uuid);
CREATE TABLE public.department_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL, user_id uuid NOT NULL, is_department_head boolean DEFAULT false);
CREATE TABLE public.department_access_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL, subject_scope text NOT NULL, resource_key text NOT NULL, can_view boolean NOT NULL DEFAULT false, can_manage boolean NOT NULL DEFAULT false, updated_by uuid, updated_at timestamptz DEFAULT now(), factory_scope text NOT NULL DEFAULT 'own', CONSTRAINT department_access_permissions_unique_scope UNIQUE(department_id, subject_scope, resource_key));
CREATE TABLE public.department_access_audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), department_id uuid NOT NULL, subject_scope text NOT NULL, resource_key text NOT NULL, old_factory_scope text, new_factory_scope text NOT NULL DEFAULT 'own');
CREATE TABLE public.machines (id uuid PRIMARY KEY, name text, is_archived boolean DEFAULT false);
CREATE TABLE public.production_stages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), machine_id uuid NOT NULL, stage_type text NOT NULL, planned_date_end date, date_end date, created_at timestamptz DEFAULT now());
CREATE TABLE public.tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), machine_id uuid, assigned_to uuid NOT NULL, task_type public.task_type NOT NULL, title text NOT NULL, description text, status public.task_status DEFAULT 'pending', start_date date, deadline date, completed_at timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.task_delegations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, delegated_by uuid NOT NULL, delegated_from uuid NOT NULL, delegated_to uuid NOT NULL, department_id uuid NOT NULL, status text NOT NULL, responded_at timestamptz);
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobname text PRIMARY KEY);
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO cron.job(jobname) VALUES ($1) ON CONFLICT DO NOTHING; RETURN 1; END $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN DELETE FROM cron.job WHERE jobname = $1; RETURN true; END $$;
`

const fixtureSql = String.raw`
DO $$
DECLARE
  v_head uuid := '10000000-0000-0000-0000-000000000001';
  v_broker uuid := '10000000-0000-0000-0000-000000000002';
  v_new_head uuid := '10000000-0000-0000-0000-000000000003';
  v_machine uuid := '20000000-0000-0000-0000-000000000001';
  v_department uuid := '30000000-0000-0000-0000-000000000001';
  v_task uuid;
BEGIN
  IF has_table_privilege('authenticated', 'public.machine_customs_documents', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can read private customs document metadata directly';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_finalize_customs_clearance_documents(uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the protected finalize function';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_finalize_customs_clearance_documents(uuid,uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service role cannot execute the protected finalize function';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'customs-clearance-files'
      AND public = false
      AND file_size_limit = 26214400
  ) THEN
    RAISE EXCEPTION 'private customs storage bucket is misconfigured';
  END IF;

  INSERT INTO public.users(id, full_name) VALUES
    (v_head, 'Начальник'),
    (v_broker, 'Брокер'),
    (v_new_head, 'Новый начальник');
  INSERT INTO public.departments(id, name, head_user_id) VALUES (v_department, 'Брокерский', NULL);
  INSERT INTO public.department_members(department_id, user_id, is_department_head) VALUES (v_department, v_broker, false);
  INSERT INTO public.machines(id, name) VALUES (v_machine, 'Тестовая машина');

  INSERT INTO public.production_stages(machine_id, stage_type, planned_date_end) VALUES (v_machine, 'shipping', CURRENT_DATE + 2);
  IF EXISTS (SELECT 1 FROM public.tasks WHERE machine_id = v_machine) THEN RAISE EXCEPTION 'task created without a department head'; END IF;

  UPDATE public.departments SET head_user_id = v_head WHERE id = v_department;
  SELECT id INTO v_task FROM public.tasks WHERE machine_id = v_machine AND task_type = 'customs_clearance' AND status = 'pending';
  IF v_task IS NULL THEN RAISE EXCEPTION 'head assignment did not backfill task'; END IF;
  IF (SELECT deadline FROM public.tasks WHERE id = v_task) <> CURRENT_DATE THEN RAISE EXCEPTION 'deadline is not readiness minus two calendar days'; END IF;

  UPDATE public.departments SET head_user_id = v_new_head WHERE id = v_department;
  IF (SELECT assigned_to FROM public.tasks WHERE id = v_task) <> v_new_head THEN RAISE EXCEPTION 'open task was not reassigned to the new head'; END IF;
  UPDATE public.departments SET head_user_id = v_head WHERE id = v_department;

  UPDATE public.tasks SET assigned_to = v_broker WHERE id = v_task;
  INSERT INTO public.task_delegations(task_id, delegated_by, delegated_from, delegated_to, department_id, status) VALUES (v_task, v_head, v_head, v_broker, v_department, 'accepted');
  PERFORM public.fn_sync_customs_clearance_task(v_machine);
  IF (SELECT assigned_to FROM public.tasks WHERE id = v_task) <> v_broker THEN RAISE EXCEPTION 'accepted broker delegation was not preserved'; END IF;

  BEGIN
    UPDATE public.tasks SET status = 'completed' WHERE id = v_task;
    RAISE EXCEPTION 'manual completion was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'manual completion was allowed' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.tasks SET status = 'cancelled' WHERE id = v_task;
    RAISE EXCEPTION 'manual cancellation was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'manual cancellation was allowed' THEN RAISE; END IF;
  END;

  INSERT INTO storage.objects(bucket_id, name, metadata) VALUES (
    'customs-clearance-files',
    'customs-clearance/20000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000002/invalid.pdf',
    '{"size":"100","mimetype":"image/png"}'::jsonb
  );
  BEGIN
    PERFORM public.fn_finalize_customs_clearance_documents(
      v_machine,
      v_broker,
      'other',
      jsonb_build_array(jsonb_build_object(
        'objectPath', 'customs-clearance/20000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000002/invalid.pdf',
        'fileName', 'invalid.pdf',
        'mimeType', 'application/pdf',
        'fileSize', 100
      ))
    );
    RAISE EXCEPTION 'storage MIME mismatch was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'storage MIME mismatch was accepted' THEN RAISE; END IF;
  END;

  INSERT INTO storage.objects(bucket_id, name, metadata) VALUES (
    'customs-clearance-files',
    'customs-clearance/20000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000002/proof.pdf',
    '{"size":"100","mimetype":"application/pdf"}'::jsonb
  );
  PERFORM public.fn_finalize_customs_clearance_documents(
    v_machine,
    v_broker,
    'other',
    jsonb_build_array(jsonb_build_object(
      'objectPath', 'customs-clearance/20000000-0000-0000-0000-000000000001/10000000-0000-0000-0000-000000000002/proof.pdf',
      'fileName', 'proof.pdf',
      'mimeType', 'application/pdf',
      'fileSize', 100
    ))
  );
  IF (SELECT status FROM public.tasks WHERE id = v_task) <> 'completed' THEN RAISE EXCEPTION 'any uploaded document did not complete the task'; END IF;

  DELETE FROM public.machine_customs_documents WHERE machine_id = v_machine;
  IF (SELECT count(*) FROM public.tasks WHERE machine_id = v_machine AND status IN ('pending','in_progress')) <> 1 THEN RAISE EXCEPTION 'deleting the last document did not reopen one task'; END IF;

  UPDATE public.production_stages SET date_end = CURRENT_DATE + 10, planned_date_end = CURRENT_DATE WHERE machine_id = v_machine;
  IF EXISTS (SELECT 1 FROM public.tasks WHERE machine_id = v_machine AND status IN ('pending','in_progress')) THEN RAISE EXCEPTION 'actual readiness did not take precedence over planned readiness'; END IF;

  INSERT INTO public.machine_customs_documents(machine_id, document_kind, file_name, mime_type, file_size, storage_path, uploaded_by) VALUES (v_machine, 'other', 'early.pdf', 'application/pdf', 100, 'customs-clearance/test/early.pdf', v_broker);
  UPDATE public.production_stages SET date_end = CURRENT_DATE + 2 WHERE machine_id = v_machine;
  IF EXISTS (SELECT 1 FROM public.tasks WHERE machine_id = v_machine AND status IN ('pending','in_progress')) THEN RAISE EXCEPTION 'task created despite an early document upload'; END IF;
END;
$$;
`

command('createdb', ['--maintenance-db', adminUrl, databaseName])
try {
  psql(schemaSql)
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260904120000_customs_clearance_foundation.sql')])
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260904121000_customs_clearance_task_automation.sql')])
  psql(fixtureSql)
} finally {
  command('dropdb', ['--if-exists', '--force', '--maintenance-db', adminUrl, databaseName], true)
}

console.log('customs clearance database lifecycle checks passed')
