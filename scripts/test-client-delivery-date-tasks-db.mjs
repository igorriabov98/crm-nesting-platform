import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const adminUrl = process.env.TEST_DATABASE_URL
if (!adminUrl) {
  console.log('client delivery date task database checks skipped (TEST_DATABASE_URL is not set)')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseName = `client_delivery_date_${process.pid}_${Date.now()}`
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
CREATE TYPE public.user_role AS ENUM ('sales_manager','production_manager');
CREATE TYPE public.task_status AS ENUM ('pending','in_progress','completed','cancelled');
CREATE TYPE public.task_type AS ENUM ('shipping_documents','transport_cost');
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  full_name text,
  role public.user_role NOT NULL,
  is_active boolean DEFAULT true,
  is_service_account boolean DEFAULT false
);
CREATE TABLE public.clients (
  id uuid PRIMARY KEY,
  name text,
  responsible_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  estimated_delivery_days integer NOT NULL DEFAULT 7
);
CREATE TABLE public.machines (
  id uuid PRIMARY KEY,
  name text,
  client_id uuid REFERENCES public.clients(id),
  created_by uuid REFERENCES public.users(id),
  desired_shipping_date date,
  actual_shipping_date date,
  delivery_to_client_date date,
  is_archived boolean DEFAULT false
);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid REFERENCES public.machines(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.users(id),
  task_type public.task_type NOT NULL,
  title text NOT NULL,
  description text,
  status public.task_status NOT NULL DEFAULT 'pending',
  start_date date,
  deadline date NOT NULL,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.task_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id),
  status text NOT NULL,
  responded_at timestamptz
);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobname text PRIMARY KEY);
CREATE FUNCTION cron.schedule(text, text, text) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO cron.job(jobname) VALUES ($1) ON CONFLICT DO NOTHING; RETURN 1; END $$;
CREATE FUNCTION cron.unschedule(text) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN DELETE FROM cron.job WHERE jobname = $1; RETURN true; END $$;
`

const fixtureSql = String.raw`
DO $$
DECLARE
  v_manager_one uuid := '10000000-0000-0000-0000-000000000001';
  v_manager_two uuid := '10000000-0000-0000-0000-000000000002';
  v_client uuid := '20000000-0000-0000-0000-000000000001';
  v_machine uuid := '30000000-0000-0000-0000-000000000001';
  v_early_machine uuid := '30000000-0000-0000-0000-000000000002';
  v_task uuid;
  v_old_task uuid;
  v_today date := (now() AT TIME ZONE 'Europe/Kyiv')::date;
BEGIN
  IF has_function_privilege('authenticated', 'public.fn_sync_client_delivery_date_task(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the protected single-machine sync';
  END IF;
  IF has_function_privilege('authenticated', 'public.fn_sync_due_client_delivery_date_tasks()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the protected due-task sweep';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_sync_client_delivery_date_task(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service role cannot execute the protected single-machine sync';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-client-delivery-date-tasks') THEN
    RAISE EXCEPTION 'daily delivery task cron was not installed';
  END IF;

  INSERT INTO public.users(id, full_name, role) VALUES
    (v_manager_one, 'Ответственный менеджер', 'sales_manager'),
    (v_manager_two, 'Автор машины', 'sales_manager');
  INSERT INTO public.clients(id, name, responsible_user_id, estimated_delivery_days)
  VALUES (v_client, 'Тестовый клиент', v_manager_one, 7);

  INSERT INTO public.machines(
    id, name, client_id, created_by, desired_shipping_date
  ) VALUES (
    v_machine, 'Тестовая машина', v_client, v_manager_two, v_today - 4
  );

  SELECT id INTO v_task
  FROM public.tasks
  WHERE machine_id = v_machine
    AND task_type = 'client_delivery_date'
    AND status = 'pending';
  IF v_task IS NULL THEN RAISE EXCEPTION 'task was not created three days before calculated delivery'; END IF;
  IF (SELECT assigned_to FROM public.tasks WHERE id = v_task) <> v_manager_one THEN
    RAISE EXCEPTION 'task was not assigned to the client responsible manager';
  END IF;
  IF (SELECT deadline FROM public.tasks WHERE id = v_task) <> v_today THEN
    RAISE EXCEPTION 'deadline is not calculated delivery minus three calendar days';
  END IF;
  IF (SELECT description FROM public.tasks WHERE id = v_task) NOT LIKE '%плановая дата отгрузки%' THEN
    RAISE EXCEPTION 'planned shipping basis is missing from the task description';
  END IF;

  UPDATE public.tasks SET status = 'in_progress' WHERE id = v_task;
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
  BEGIN
    UPDATE public.tasks SET assigned_to = v_manager_two WHERE id = v_task;
    RAISE EXCEPTION 'manual reassignment was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'manual reassignment was allowed' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.tasks SET task_type = 'transport_cost' WHERE id = v_task;
    RAISE EXCEPTION 'manual task type replacement was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'manual task type replacement was allowed' THEN RAISE; END IF;
  END;

  UPDATE public.machines SET actual_shipping_date = v_today + 10 WHERE id = v_machine;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'future actual shipping date did not cancel the active task'; END IF;

  UPDATE public.machines SET actual_shipping_date = v_today - 7 WHERE id = v_machine;
  SELECT id INTO v_task
  FROM public.tasks
  WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status = 'pending';
  IF v_task IS NULL THEN RAISE EXCEPTION 'due task was not recreated after actual shipping changed'; END IF;
  IF (SELECT description FROM public.tasks WHERE id = v_task) NOT LIKE '%фактическая дата отгрузки%' THEN
    RAISE EXCEPTION 'actual shipping did not take precedence over planned shipping';
  END IF;

  UPDATE public.machines SET delivery_to_client_date = v_today WHERE id = v_machine;
  IF (SELECT status FROM public.tasks WHERE id = v_task) <> 'completed' THEN
    RAISE EXCEPTION 'entering delivery date did not complete the task';
  END IF;
  IF (SELECT completed_at FROM public.tasks WHERE id = v_task) IS NULL THEN
    RAISE EXCEPTION 'automatic completion timestamp was not stored';
  END IF;

  UPDATE public.machines SET delivery_to_client_date = NULL WHERE id = v_machine;
  SELECT id INTO v_task
  FROM public.tasks
  WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status = 'pending';
  IF v_task IS NULL THEN RAISE EXCEPTION 'clearing a due delivery date did not reopen a task'; END IF;

  v_old_task := v_task;
  UPDATE public.clients SET responsible_user_id = v_manager_two WHERE id = v_client;
  IF (SELECT status FROM public.tasks WHERE id = v_old_task) <> 'cancelled' THEN
    RAISE EXCEPTION 'old manager task was not cancelled after reassignment';
  END IF;
  SELECT id INTO v_task
  FROM public.tasks
  WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status = 'pending';
  IF v_task IS NULL OR (SELECT assigned_to FROM public.tasks WHERE id = v_task) <> v_manager_two THEN
    RAISE EXCEPTION 'new responsible manager did not receive a fresh task';
  END IF;

  UPDATE public.clients SET estimated_delivery_days = 30 WHERE id = v_client;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'future delivery estimate did not cancel the active task'; END IF;
  UPDATE public.clients SET estimated_delivery_days = 7 WHERE id = v_client;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status = 'pending'
  ) THEN RAISE EXCEPTION 'restored delivery estimate did not recreate the task'; END IF;

  UPDATE public.users SET is_active = false WHERE id = v_manager_two;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'inactive responsible manager retained an active task'; END IF;
  UPDATE public.users SET is_active = true WHERE id = v_manager_two;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status = 'pending'
  ) THEN RAISE EXCEPTION 'reactivated responsible manager did not receive the task'; END IF;

  UPDATE public.users SET role = 'production_manager' WHERE id = v_manager_two;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'non-sales responsible retained an active task'; END IF;
  UPDATE public.users SET role = 'sales_manager', is_service_account = true WHERE id = v_manager_two;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'service account received a delivery task'; END IF;
  UPDATE public.users SET is_service_account = false WHERE id = v_manager_two;

  UPDATE public.clients SET responsible_user_id = NULL WHERE id = v_client;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'task remained active without a responsible manager'; END IF;
  UPDATE public.clients SET responsible_user_id = v_manager_one WHERE id = v_client;

  UPDATE public.machines SET actual_shipping_date = NULL, desired_shipping_date = v_today + 10 WHERE id = v_machine;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'future planned shipping date did not cancel the task'; END IF;
  UPDATE public.machines SET desired_shipping_date = v_today - 4 WHERE id = v_machine;

  UPDATE public.machines SET is_archived = true WHERE id = v_machine;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress')
  ) THEN RAISE EXCEPTION 'archived machine retained an active delivery task'; END IF;
  UPDATE public.machines SET is_archived = false WHERE id = v_machine;

  DELETE FROM public.tasks
  WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status IN ('pending','in_progress');
  PERFORM public.fn_sync_due_client_delivery_date_tasks();
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine AND task_type = 'client_delivery_date' AND status = 'pending'
  ) THEN RAISE EXCEPTION 'due-task sweep did not restore a missing task'; END IF;

  INSERT INTO public.machines(
    id, name, client_id, created_by, desired_shipping_date, delivery_to_client_date
  ) VALUES (
    v_early_machine, 'Уже доставлена', v_client, v_manager_two, v_today - 4, v_today
  );
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_early_machine AND task_type = 'client_delivery_date'
  ) THEN RAISE EXCEPTION 'task was created despite delivery date being entered early'; END IF;
END;
$$;
`

command('createdb', ['--maintenance-db', adminUrl, databaseName])
try {
  psql(schemaSql)
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260904130000_client_delivery_date_task_type.sql')])
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260904131000_client_delivery_date_task_automation.sql')])
  psql(fixtureSql)
} finally {
  command('dropdb', ['--if-exists', '--force', '--maintenance-db', adminUrl, databaseName], true)
}

console.log('client delivery date task database lifecycle checks passed')
