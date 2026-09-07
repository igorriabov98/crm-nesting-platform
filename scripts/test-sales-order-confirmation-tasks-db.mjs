import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const adminUrl = process.env.TEST_DATABASE_URL
if (!adminUrl) {
  console.log('sales order confirmation task database checks skipped (TEST_DATABASE_URL is not set)')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseName = `sales_order_confirmation_${process.pid}_${Date.now()}`
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
CREATE TYPE public.task_type AS ENUM ('engineer_confirm');
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  full_name text,
  is_active boolean NOT NULL DEFAULT true,
  is_service_account boolean NOT NULL DEFAULT false
);
CREATE TABLE public.machines (
  id uuid PRIMARY KEY,
  name text,
  created_by uuid REFERENCES public.users(id),
  is_confirmed boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false
);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.users(id),
  task_type public.task_type NOT NULL,
  title text NOT NULL,
  description text,
  status public.task_status NOT NULL DEFAULT 'pending',
  start_date date,
  deadline date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.task_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id),
  status text NOT NULL,
  responded_at timestamptz
);
`

const fixtureSql = String.raw`
DO $$
DECLARE
  v_manager_one uuid := '10000000-0000-0000-0000-000000000001';
  v_manager_two uuid := '10000000-0000-0000-0000-000000000002';
  v_engineer uuid := '10000000-0000-0000-0000-000000000003';
  v_machine uuid := '20000000-0000-0000-0000-000000000001';
  v_engineer_task uuid;
  v_manager_task uuid;
  v_reopened_task uuid;
  v_today date := CURRENT_DATE;
BEGIN
  IF has_function_privilege('authenticated', 'public.fn_sync_sales_order_confirmation_task(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute the protected task sync';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.fn_sync_sales_order_confirmation_task(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service role cannot execute the protected task sync';
  END IF;

  INSERT INTO public.users(id, full_name) VALUES
    (v_manager_one, 'Менеджер-создатель'),
    (v_manager_two, 'Новый менеджер-создатель'),
    (v_engineer, 'Инженер');
  INSERT INTO public.machines(id, name, created_by)
  VALUES (v_machine, 'Тестовый заказ', v_manager_one);

  INSERT INTO public.tasks(machine_id, assigned_to, task_type, title, deadline)
  VALUES (v_machine, v_engineer, 'engineer_confirm', 'Подтвердить чертежи', v_today + 10)
  RETURNING id INTO v_engineer_task;

  SELECT id INTO v_manager_task
  FROM public.tasks
  WHERE machine_id = v_machine
    AND task_type = 'sales_order_confirmation'
    AND status = 'pending';
  IF v_manager_task IS NULL THEN RAISE EXCEPTION 'manager confirmation task was not created'; END IF;
  IF (SELECT assigned_to FROM public.tasks WHERE id = v_manager_task) <> v_manager_one THEN
    RAISE EXCEPTION 'task was not assigned to the manager who created the order';
  END IF;
  IF (SELECT deadline FROM public.tasks WHERE id = v_manager_task) <> v_today + 8 THEN
    RAISE EXCEPTION 'manager deadline is not two days before the engineer deadline';
  END IF;
  IF (SELECT description FROM public.tasks WHERE id = v_manager_task) NOT LIKE '%Дедлайн инженера:%' THEN
    RAISE EXCEPTION 'engineer deadline basis is missing from the task description';
  END IF;

  UPDATE public.tasks SET status = 'in_progress' WHERE id = v_manager_task;
  UPDATE public.tasks SET deadline = v_today + 20 WHERE id = v_engineer_task;
  IF (SELECT id FROM public.tasks WHERE machine_id = v_machine AND task_type = 'sales_order_confirmation' AND status = 'in_progress') <> v_manager_task THEN
    RAISE EXCEPTION 'rescheduling replaced the active manager task';
  END IF;
  IF (SELECT deadline FROM public.tasks WHERE id = v_manager_task) <> v_today + 18 THEN
    RAISE EXCEPTION 'manager deadline did not follow the engineer deadline change';
  END IF;

  UPDATE public.machines SET is_confirmed = true WHERE id = v_machine;
  IF (SELECT status FROM public.tasks WHERE id = v_manager_task) <> 'completed' THEN
    RAISE EXCEPTION 'confirming the order did not complete the manager task';
  END IF;
  IF (SELECT completed_at FROM public.tasks WHERE id = v_manager_task) IS NULL THEN
    RAISE EXCEPTION 'automatic completion timestamp was not stored';
  END IF;

  UPDATE public.machines SET is_confirmed = false WHERE id = v_machine;
  SELECT id INTO v_reopened_task
  FROM public.tasks
  WHERE machine_id = v_machine
    AND task_type = 'sales_order_confirmation'
    AND status = 'pending';
  IF v_reopened_task IS NULL OR v_reopened_task = v_manager_task THEN
    RAISE EXCEPTION 'clearing confirmation did not create a fresh manager task';
  END IF;

  UPDATE public.machines SET created_by = v_manager_two WHERE id = v_machine;
  IF (SELECT status FROM public.tasks WHERE id = v_reopened_task) <> 'cancelled' THEN
    RAISE EXCEPTION 'old creator task was not cancelled';
  END IF;
  SELECT id INTO v_reopened_task
  FROM public.tasks
  WHERE machine_id = v_machine
    AND task_type = 'sales_order_confirmation'
    AND status = 'pending';
  IF v_reopened_task IS NULL OR (SELECT assigned_to FROM public.tasks WHERE id = v_reopened_task) <> v_manager_two THEN
    RAISE EXCEPTION 'new creator did not receive a fresh task';
  END IF;

  UPDATE public.users SET is_active = false WHERE id = v_manager_two;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine
      AND task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress')
  ) THEN RAISE EXCEPTION 'inactive creator retained an active task'; END IF;
  UPDATE public.users SET is_active = true WHERE id = v_manager_two;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine
      AND task_type = 'sales_order_confirmation'
      AND status = 'pending'
      AND assigned_to = v_manager_two
  ) THEN RAISE EXCEPTION 'reactivated creator did not receive a task'; END IF;

  UPDATE public.machines SET is_archived = true WHERE id = v_machine;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine
      AND task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress')
  ) THEN RAISE EXCEPTION 'archived order retained an active manager task'; END IF;
  UPDATE public.machines SET is_archived = false WHERE id = v_machine;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine
      AND task_type = 'sales_order_confirmation'
      AND status = 'pending'
  ) THEN RAISE EXCEPTION 'unarchived order did not restore the manager task'; END IF;

  UPDATE public.tasks SET status = 'cancelled' WHERE id = v_engineer_task;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine
      AND task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress')
  ) THEN RAISE EXCEPTION 'manager task remained active without an engineer deadline'; END IF;

  UPDATE public.tasks SET status = 'pending' WHERE id = v_engineer_task;
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine
      AND task_type = 'sales_order_confirmation'
      AND status = 'pending'
      AND deadline = v_today + 18
  ) THEN RAISE EXCEPTION 'restored engineer task did not restore the manager task'; END IF;

  UPDATE public.users SET is_service_account = true WHERE id = v_manager_two;
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = v_machine
      AND task_type = 'sales_order_confirmation'
      AND status IN ('pending', 'in_progress')
  ) THEN RAISE EXCEPTION 'service account retained a manager confirmation task'; END IF;
END;
$$;
`

command('createdb', ['--maintenance-db', adminUrl, databaseName])
try {
  psql(schemaSql)
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260906223000_sales_order_confirmation_task_type.sql')])
  command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f', path.join(root, 'supabase/migrations/20260906223100_sales_order_confirmation_task_automation.sql')])
  psql(fixtureSql)
} finally {
  command('dropdb', ['--if-exists', '--force', '--maintenance-db', adminUrl, databaseName], true)
}

console.log('sales order confirmation task database lifecycle checks passed')
