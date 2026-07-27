import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const adminDatabaseUrl = process.env.TEST_DATABASE_URL || 'postgresql:///postgres'
const databaseName = `task_on_conflict_${process.pid}_${Date.now()}`
const databaseUrl = withDatabase(adminDatabaseUrl, databaseName)
const skipHotfix = process.env.TASK_ON_CONFLICT_SKIP_HOTFIX === '1'

const materialTransportSource = readFileSync(
  'supabase/migrations/20260706112100_material_type_transport_task_automation.sql',
  'utf8',
)
const productionPlanSource = readFileSync(
  'supabase/migrations/20260711220100_production_plan_preparation_tasks.sql',
  'utf8',
)
const hotfixSource = readFileSync(
  'supabase/migrations/20260727214500_fix_task_on_conflict_partial_index.sql',
  'utf8',
)

const functionNames = [
  'fn_sync_material_type_selection_task',
  'fn_sync_due_transport_cost_tasks',
  'fn_sync_production_plan_preparation_task',
]

const sourceFunctions = [
  extractFunction(materialTransportSource, functionNames[0]),
  extractFunction(materialTransportSource, functionNames[1]),
  extractFunction(productionPlanSource, functionNames[2]),
]
const oldFunctions = sourceFunctions.join('\n\n')
const oldPredicate = 'WHERE machine_id IS NOT NULL'
const newPredicate = "WHERE machine_id IS NOT NULL AND status IN ('pending','in_progress')"

for (const [index, name] of functionNames.entries()) {
  assert.equal(
    extractFunction(hotfixSource, name),
    sourceFunctions[index].replace(oldPredicate, newPredicate),
    `${name} must differ from its latest source body only in the ON CONFLICT predicate`,
  )
}
assert.equal(
  occurrences(hotfixSource, newPredicate),
  3,
  'hotfix must infer the active-task partial index in exactly three functions',
)

function main() {
  createDatabase()
  try {
    psql(schemaSql)
    psql(oldFunctions)
    psql(triggerSql)

    if (!skipHotfix) psql(hotfixSource)

    // This is the database sequence used by createMachine in sales-plan/actions.ts:
    // a confirmed machine is inserted first, then its non-sample positions.
    psql(confirmedOrderAndActiveTaskSql)
    psql(completedTaskCharacterizationSql)
    console.log(
      skipHotfix
        ? 'unexpected: broken predicates accepted the confirmed-order path'
        : 'task ON CONFLICT regression and characterization tests passed',
    )
  } finally {
    dropDatabase()
  }
}

function extractFunction(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`)
  assert.notEqual(start, -1, `missing source function ${name}`)
  const end = source.indexOf('\n$$;', start)
  assert.notEqual(end, -1, `unterminated source function ${name}`)
  return source.slice(start, end + 4)
}

function occurrences(source, needle) {
  return source.split(needle).length - 1
}

function withDatabase(connectionString, name) {
  const url = new URL(connectionString)
  url.pathname = `/${name}`
  return url.toString()
}

function createDatabase() {
  command('createdb', ['--maintenance-db', adminDatabaseUrl, databaseName])
}

function dropDatabase() {
  command('dropdb', ['--if-exists', '--force', '--maintenance-db', adminDatabaseUrl, databaseName], true)
}

function psql(sql) {
  command('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1'], false, sql)
}

function command(bin, args, ignoreFailure = false, input) {
  const result = spawnSync(bin, args, { encoding: 'utf8', input })
  if (result.status !== 0 && !ignoreFailure) {
    const message = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(message || `${bin} exited with ${result.status}`)
  }
}

const schemaSql = String.raw`
CREATE TYPE public.task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
CREATE TYPE public.task_type AS ENUM (
  'material_type_selection',
  'transport_cost',
  'production_plan_preparation'
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  role text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  factory_id uuid,
  full_name text
);

CREATE TABLE public.company_settings (
  id uuid PRIMARY KEY,
  auto_task_technologist_user_id uuid
);

CREATE TABLE public.machines (
  id uuid PRIMARY KEY,
  name text,
  created_by uuid,
  is_confirmed boolean DEFAULT false,
  material_type text DEFAULT 'undefined',
  is_archived boolean DEFAULT false,
  desired_shipping_date date,
  factory_id uuid,
  production_month date
);

CREATE TABLE public.machine_items (
  id uuid PRIMARY KEY,
  machine_id uuid NOT NULL,
  is_sample boolean DEFAULT false
);

CREATE TABLE public.machine_expenses (
  machine_id uuid NOT NULL,
  category text,
  amount numeric
);

CREATE TABLE public.production_stages (
  machine_id uuid NOT NULL,
  stage_type text NOT NULL,
  planned_date_end date,
  date_end date,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.production_month_plans (
  factory_id uuid NOT NULL,
  production_month date NOT NULL,
  status text NOT NULL
);

CREATE TABLE public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid,
  assigned_to uuid NOT NULL,
  task_type public.task_type NOT NULL,
  title text,
  description text,
  status public.task_status NOT NULL DEFAULT 'pending',
  start_date date,
  deadline date,
  completed_at timestamptz,
  notified_at timestamptz,
  telegram_error text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_tasks_machine_assigned_type_unique
ON public.tasks(machine_id, assigned_to, task_type)
WHERE machine_id IS NOT NULL AND status IN ('pending', 'in_progress');
`

const triggerSql = String.raw`
CREATE OR REPLACE FUNCTION public.trg_sync_material_type_selection_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_machine_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'machines' THEN
    v_machine_id := NEW.id;
  ELSE
    v_machine_id := NEW.machine_id;
  END IF;
  PERFORM public.fn_sync_material_type_selection_task(v_machine_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_material_type_selection_task_machine
AFTER INSERT OR UPDATE OF is_confirmed, material_type, is_archived ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_material_type_selection_task();

CREATE TRIGGER trg_sync_material_type_selection_task_item
AFTER INSERT OR UPDATE OF is_sample ON public.machine_items
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_material_type_selection_task();

CREATE OR REPLACE FUNCTION public.trg_sync_production_plan_preparation_from_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.fn_sync_production_plan_preparation_task(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_production_plan_preparation_from_machine
AFTER INSERT OR UPDATE OF is_confirmed, factory_id, production_month, is_archived ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_production_plan_preparation_from_machine();
`

const seedUsersSql = String.raw`
INSERT INTO public.users (id, role, factory_id, full_name, created_at) VALUES
  ('00000000-0000-0000-0000-000000000101', 'commercial_director', NULL, 'Commercial', now()),
  ('00000000-0000-0000-0000-000000000102', 'technologist', NULL, 'Technologist', now()),
  ('00000000-0000-0000-0000-000000000103', 'production_manager', '00000000-0000-0000-0000-000000000201', 'Production', now());
INSERT INTO public.company_settings (id, auto_task_technologist_user_id)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000102');
`

const confirmedOrderAndActiveTaskSql = String.raw`
${seedUsersSql}

INSERT INTO public.machines (
  id, name, created_by, is_confirmed, material_type, desired_shipping_date,
  factory_id, production_month
) VALUES (
  '00000000-0000-0000-0000-000000000301', 'Confirmed order',
  '00000000-0000-0000-0000-000000000101', true, 'undefined', CURRENT_DATE + 7,
  '00000000-0000-0000-0000-000000000201', date_trunc('month', CURRENT_DATE + interval '2 months')::date
);

INSERT INTO public.machine_items (id, machine_id, is_sample)
VALUES ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301', false);

SELECT public.fn_sync_due_transport_cost_tasks();

DO $$
DECLARE
  v_type public.task_type;
BEGIN
  FOREACH v_type IN ARRAY ARRAY[
    'material_type_selection'::public.task_type,
    'transport_cost'::public.task_type,
    'production_plan_preparation'::public.task_type
  ] LOOP
    IF (SELECT count(*) FROM public.tasks
        WHERE machine_id = '00000000-0000-0000-0000-000000000301'
          AND task_type = v_type AND status IN ('pending', 'in_progress')) <> 1 THEN
      RAISE EXCEPTION 'confirmed order did not create exactly one active % task', v_type;
    END IF;
  END LOOP;
END;
$$;

SELECT public.fn_sync_material_type_selection_task('00000000-0000-0000-0000-000000000301');
SELECT public.fn_sync_production_plan_preparation_task('00000000-0000-0000-0000-000000000301');
SELECT public.fn_sync_due_transport_cost_tasks();

DO $$
BEGIN
  IF (SELECT count(*) FROM public.tasks
      WHERE machine_id = '00000000-0000-0000-0000-000000000301'
        AND status IN ('pending', 'in_progress')) <> 3 THEN
    RAISE EXCEPTION 'active task synchronization created a duplicate';
  END IF;
END;
$$;
`

const completedTaskCharacterizationSql = String.raw`
TRUNCATE public.tasks, public.machine_items, public.machines, public.company_settings, public.users;
${seedUsersSql}

ALTER TABLE public.machines DISABLE TRIGGER USER;
ALTER TABLE public.machine_items DISABLE TRIGGER USER;

INSERT INTO public.machines (
  id, name, created_by, is_confirmed, material_type, desired_shipping_date,
  factory_id, production_month
) VALUES
  ('00000000-0000-0000-0000-000000000311', 'Material semantics', '00000000-0000-0000-0000-000000000101', true, 'undefined', NULL, '00000000-0000-0000-0000-000000000201', date_trunc('month', CURRENT_DATE + interval '2 months')::date),
  ('00000000-0000-0000-0000-000000000312', 'Transport semantics', '00000000-0000-0000-0000-000000000101', true, 'standard', CURRENT_DATE + 7, '00000000-0000-0000-0000-000000000201', date_trunc('month', CURRENT_DATE + interval '2 months')::date),
  ('00000000-0000-0000-0000-000000000313', 'Production semantics', '00000000-0000-0000-0000-000000000101', true, 'standard', NULL, '00000000-0000-0000-0000-000000000201', date_trunc('month', CURRENT_DATE + interval '2 months')::date);

INSERT INTO public.machine_items (id, machine_id, is_sample)
VALUES ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000311', false);

ALTER TABLE public.machines ENABLE TRIGGER USER;
ALTER TABLE public.machine_items ENABLE TRIGGER USER;

INSERT INTO public.tasks (id, machine_id, assigned_to, task_type, title, status, completed_at) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000102', 'material_type_selection', 'completed material', 'completed', now()),
  ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000101', 'transport_cost', 'completed transport', 'completed', now()),
  ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000313', '00000000-0000-0000-0000-000000000103', 'production_plan_preparation', 'completed production', 'completed', now());

SELECT public.fn_sync_material_type_selection_task('00000000-0000-0000-0000-000000000311');
SELECT public.fn_sync_due_transport_cost_tasks();
SELECT public.fn_sync_production_plan_preparation_task('00000000-0000-0000-0000-000000000313');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = '00000000-0000-0000-0000-000000000501'
      AND status = 'pending' AND completed_at IS NULL
  ) OR (SELECT count(*) FROM public.tasks WHERE machine_id = '00000000-0000-0000-0000-000000000311') <> 1 THEN
    RAISE EXCEPTION 'material completed-task reactivation semantics changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = '00000000-0000-0000-0000-000000000502'
      AND status = 'completed' AND completed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.tasks
    WHERE machine_id = '00000000-0000-0000-0000-000000000312'
      AND task_type = 'transport_cost' AND status IN ('pending', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'transport completed-task suppression semantics changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tasks
    WHERE id = '00000000-0000-0000-0000-000000000503'
      AND status = 'completed' AND completed_at IS NOT NULL
  ) OR (SELECT count(*) FROM public.tasks
        WHERE machine_id = '00000000-0000-0000-0000-000000000313'
          AND task_type = 'production_plan_preparation'
          AND status IN ('pending', 'in_progress')) <> 1 THEN
    RAISE EXCEPTION 'production completed-task insertion semantics changed';
  END IF;
END;
$$;
`

main()
