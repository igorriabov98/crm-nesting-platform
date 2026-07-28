import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const [enumMigration, migration, taskActions, supplyActions, supplyPage, reserveButton, settingsPage, smokeUser, types] = await Promise.all([
  read('supabase/migrations/20260728121500_shipping_documents_task_type.sql'),
  read('supabase/migrations/20260728121600_shipping_tasks_and_service_assignees.sql'),
  read('src/lib/actions/transport-cost-tasks.ts'),
  read('src/lib/actions/supply-request.ts'),
  read('src/components/features/supply-request/SupplyRequestPage.tsx'),
  read('src/components/features/supply-request/ReserveButton.tsx'),
  read('src/components/features/settings/CompanySettingsPage.tsx'),
  read('scripts/create-smoke-user.ts'),
  read('src/lib/types/database.ts'),
])

assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'shipping_documents'/)
assert.match(enumMigration, /is_service_account boolean NOT NULL DEFAULT false/)
assert.match(migration, /v_shipping_date - v_task\.days_before/)
assert.match(migration, /\('transport_cost'::public\.task_type, 7/)
assert.match(migration, /\('shipping_documents'::public\.task_type, 5/)
assert.match(migration, /task_type IN \('technologist_request', 'material_type_selection'\)/)
assert.match(migration, /COALESCE\(u\.is_service_account, false\) = false/)
assert.match(migration, /WHERE machine_id IS NOT NULL AND status IN \('pending', 'in_progress'\)/)
assert.match(taskActions, /transport_cost: \{ offset: -7/)
assert.match(taskActions, /shipping_documents: \{ offset: -5/)
assert.doesNotMatch(taskActions, /commercial_director/)
assert.match(supplyActions, /reserveAllAvailable\(requestId: string, factoryId: string\)/)
assert.match(supplyActions, /selectedInventory\.factory_id !== data\.factory_id/)
assert.match(supplyPage, /Переключение не выполняет новый запрос/)
assert.match(supplyPage, /reserveAllAvailable\(request\.id, selectedFactoryId\)/)
assert.match(reserveButton, /factory_id: selectedStock\?\.factory_id/)
assert.match(settingsPage, /selected\.full_name/)
assert.match(smokeUser, /is_service_account: true/)
assert.match(types, /'shipping_documents'/)

function runDatabaseChecks() {
  const adminUrl = process.env.TEST_DATABASE_URL
  const databaseName = `shipping_factory_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${databaseName}`
  command('createdb', ['--maintenance-db', adminUrl, databaseName])
  try {
    psql(databaseUrl.toString(), schemaSql)
    command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260728121500_shipping_documents_task_type.sql')])
    command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260728121600_shipping_tasks_and_service_assignees.sql')])
    psql(databaseUrl.toString(), fixtureSql)
  } finally {
    command('dropdb', ['--if-exists', '--force', '--maintenance-db', adminUrl, databaseName], true)
  }
}

function psql(databaseUrl, sql) {
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl], false, sql)
}

function command(binary, args, ignoreFailure = false, input) {
  const result = spawnSync(binary, args, { encoding: 'utf8', input })
  if (result.status !== 0 && !ignoreFailure) throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'))
}

const schemaSql = String.raw`
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TYPE public.task_status AS ENUM ('pending','in_progress','completed','cancelled');
CREATE TYPE public.task_type AS ENUM ('technologist_request','material_type_selection','engineer_confirm','transport_cost');
CREATE TABLE public.users(id uuid PRIMARY KEY, email text, full_name text, is_active boolean, is_service_account boolean NOT NULL DEFAULT false, updated_at timestamptz DEFAULT now());
CREATE TABLE public.company_settings(id uuid PRIMARY KEY, auto_task_technologist_user_id uuid, auto_task_engineer_user_id uuid);
CREATE TABLE public.machines(id uuid PRIMARY KEY, name text, created_by uuid, desired_shipping_date date, is_archived boolean DEFAULT false);
CREATE TABLE public.production_stages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), machine_id uuid, stage_type text, planned_date_end date, date_end date, created_at timestamptz DEFAULT now());
CREATE TABLE public.machine_expenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), machine_id uuid, category text, amount numeric);
CREATE TABLE public.tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), machine_id uuid, assigned_to uuid, task_type public.task_type, title text, description text, status public.task_status, start_date date, deadline date, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX idx_tasks_machine_assigned_type_unique ON public.tasks(machine_id, assigned_to, task_type) WHERE machine_id IS NOT NULL AND status IN ('pending','in_progress');
`

const fixtureSql = String.raw`
DO $$
DECLARE
  normal_user uuid := '10000000-0000-0000-0000-000000000001';
  smoke_user uuid := '10000000-0000-0000-0000-000000000002';
  v_machine_id uuid := '20000000-0000-0000-0000-000000000001';
  v_service_machine_id uuid := '20000000-0000-0000-0000-000000000002';
BEGIN
  INSERT INTO public.users(id,email,full_name,is_active,is_service_account) VALUES
    (normal_user,'normal@example.test','Александр Коптев',true,false),
    (smoke_user,'smoke@example.test','CI Smoke User',true,true);
  INSERT INTO public.company_settings VALUES ('00000000-0000-0000-0000-000000000001', normal_user, normal_user);
  INSERT INTO public.machines(id,name,created_by,desired_shipping_date) VALUES
    (v_machine_id,'Порог дат',normal_user,CURRENT_DATE + 8),
    (v_service_machine_id,'Служебный автор',smoke_user,CURRENT_DATE);

  PERFORM public.fn_sync_due_transport_cost_tasks();
  IF EXISTS (SELECT 1 FROM public.tasks WHERE machine_id IN (v_machine_id, v_service_machine_id)) THEN RAISE EXCEPTION 'tasks created before threshold or for service user'; END IF;

  UPDATE public.machines SET desired_shipping_date = CURRENT_DATE + 7 WHERE id = v_machine_id;
  PERFORM public.fn_sync_due_transport_cost_tasks();
  IF (SELECT count(*) FROM public.tasks WHERE machine_id = v_machine_id AND task_type = 'transport_cost' AND status = 'pending') <> 1 THEN RAISE EXCEPTION 'transport -7 threshold failed'; END IF;
  IF EXISTS (SELECT 1 FROM public.tasks WHERE machine_id = v_machine_id AND task_type = 'shipping_documents' AND status IN ('pending','in_progress')) THEN RAISE EXCEPTION 'documents created before -5'; END IF;

  UPDATE public.machines SET desired_shipping_date = CURRENT_DATE + 5 WHERE id = v_machine_id;
  PERFORM public.fn_sync_due_transport_cost_tasks();
  IF (SELECT count(*) FROM public.tasks WHERE machine_id = v_machine_id AND task_type = 'shipping_documents' AND status = 'pending') <> 1 THEN RAISE EXCEPTION 'documents -5 threshold failed'; END IF;

  UPDATE public.machines SET desired_shipping_date = CURRENT_DATE + 12 WHERE id = v_machine_id;
  PERFORM public.fn_sync_due_transport_cost_tasks();
  IF EXISTS (SELECT 1 FROM public.tasks WHERE machine_id = v_machine_id AND status IN ('pending','in_progress')) THEN RAISE EXCEPTION 'forward date move did not cancel premature tasks'; END IF;
  UPDATE public.machines SET desired_shipping_date = CURRENT_DATE + 5 WHERE id = v_machine_id;
  PERFORM public.fn_sync_due_transport_cost_tasks();
  IF (SELECT count(*) FROM public.tasks WHERE machine_id = v_machine_id AND status IN ('pending','in_progress')) <> 2 THEN RAISE EXCEPTION 'backward date move did not recreate due tasks'; END IF;

  INSERT INTO public.machine_expenses(machine_id,category,amount) VALUES (v_machine_id,'Транспорт',1);
  PERFORM public.fn_sync_due_transport_cost_tasks();
  PERFORM public.fn_sync_due_transport_cost_tasks();
  IF EXISTS (SELECT 1 FROM public.tasks WHERE machine_id = v_machine_id AND task_type = 'transport_cost' AND status IN ('pending','in_progress')) THEN RAISE EXCEPTION 'covered transport task remains active'; END IF;
  IF (SELECT count(*) FROM public.tasks WHERE machine_id = v_machine_id AND task_type = 'shipping_documents' AND status IN ('pending','in_progress')) <> 1 THEN RAISE EXCEPTION 'document task duplicated'; END IF;

  INSERT INTO public.tasks(machine_id,assigned_to,task_type,title,status) VALUES
    (v_machine_id,smoke_user,'material_type_selection','wrong assignee','pending');
  PERFORM public.fn_resync_auto_task_assignees();
  IF EXISTS (SELECT 1 FROM public.tasks WHERE task_type = 'material_type_selection' AND assigned_to = smoke_user AND status = 'pending') THEN RAISE EXCEPTION 'technologist task not reassigned'; END IF;
END;
$$;
`

if (process.env.TEST_DATABASE_URL) runDatabaseChecks()

console.log('shipping schedules, service assignees, and factory reservation source checks passed')
