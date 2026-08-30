import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (!process.env.TEST_DATABASE_URL) {
  console.log('[machine-archive-queue] skipped: TEST_DATABASE_URL is not set')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adminUrl = new URL(process.env.TEST_DATABASE_URL)
assert.equal(adminUrl.protocol, 'postgresql:', 'TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(adminUrl.hostname),
  'Machine archive queue tests only use localhost or 127.0.0.1',
)

const databaseName = `machine_archive_queue_test_${process.pid}_${Date.now()}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`

run('createdb', ['--maintenance-db', adminUrl.toString(), databaseName])
try {
  psql(String.raw`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END;
    $roles$;

    CREATE TABLE public.machines (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      production_month date,
      factory_id uuid,
      production_workshop smallint,
      production_queue_number integer,
      is_archived boolean NOT NULL DEFAULT false,
      archived_at timestamptz,
      archived_by uuid,
      archive_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      machine_id uuid NOT NULL REFERENCES public.machines(id),
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO public.machines (
      id, name, production_month, factory_id, production_workshop,
      production_queue_number, is_archived, created_at
    ) VALUES
      ('10000000-0000-0000-0000-000000000001', 'August archived', '2026-08-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 1, true,  '2026-01-01'),
      ('10000000-0000-0000-0000-000000000002', 'August active',   '2026-08-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 5, false, '2026-01-02'),
      ('20000000-0000-0000-0000-000000000001', 'September archived', '2026-09-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 1, true,  '2026-01-01'),
      ('20000000-0000-0000-0000-000000000002', 'September active',   '2026-09-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 2, false, '2026-01-02'),
      ('30000000-0000-0000-0000-000000000001', 'October first',  '2026-10-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 2, false, '2026-01-01'),
      ('30000000-0000-0000-0000-000000000002', 'October middle', '2026-10-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 4, false, '2026-01-02'),
      ('30000000-0000-0000-0000-000000000003', 'October last',   '2026-10-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, 7, false, '2026-01-03'),
      ('40000000-0000-0000-0000-000000000001', 'Other workshop', '2026-10-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, 4, false, '2026-01-01'),
      ('50000000-0000-0000-0000-000000000001', 'Other factory',  '2026-10-01', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, 9, false, '2026-01-01');

    INSERT INTO public.tasks(machine_id, status) VALUES
      ('30000000-0000-0000-0000-000000000002', 'pending'),
      ('30000000-0000-0000-0000-000000000002', 'in_progress'),
      ('30000000-0000-0000-0000-000000000002', 'completed');
  `)

  run('psql', [
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    databaseUrl.toString(),
    '-f',
    path.join(root, 'supabase/migrations/20260830120000_archive_machine_compact_production_queue.sql'),
  ])

  psql(String.raw`
    DO $assertions$
    DECLARE
      v_result jsonb;
      v_failed boolean := false;
    BEGIN
      IF (SELECT production_queue_number FROM public.machines WHERE id = '10000000-0000-0000-0000-000000000002') <> 1 THEN
        RAISE EXCEPTION 'August historical gap was not repaired';
      END IF;
      IF (SELECT production_queue_number FROM public.machines WHERE id = '20000000-0000-0000-0000-000000000002') <> 1 THEN
        RAISE EXCEPTION 'September historical gap was not repaired';
      END IF;
      IF ARRAY(
        SELECT production_queue_number
        FROM public.machines
        WHERE production_month = '2026-10-01'
          AND factory_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          AND production_workshop = 1
          AND is_archived = false
        ORDER BY production_queue_number
      ) <> ARRAY[1, 2, 3] THEN
        RAISE EXCEPTION 'Migration did not compact the October queue';
      END IF;

      v_result := public.archive_machine_and_compact_production_queue(
        '30000000-0000-0000-0000-000000000002',
        '90000000-0000-0000-0000-000000000001',
        '  Test archive  '
      );

      IF v_result->>'activeQueueSize' <> '2' THEN
        RAISE EXCEPTION 'RPC returned the wrong active queue size: %', v_result;
      END IF;
      IF ARRAY(
        SELECT production_queue_number
        FROM public.machines
        WHERE production_month = '2026-10-01'
          AND factory_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
          AND production_workshop = 1
          AND is_archived = false
        ORDER BY production_queue_number
      ) <> ARRAY[1, 2] THEN
        RAISE EXCEPTION 'Archive did not close the queue gap';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.machines
        WHERE id = '30000000-0000-0000-0000-000000000002'
          AND is_archived = true
          AND archived_at IS NOT NULL
          AND archived_by = '90000000-0000-0000-0000-000000000001'
          AND archive_reason = 'Test archive'
      ) THEN
        RAISE EXCEPTION 'Archive metadata was not saved';
      END IF;
      IF (SELECT count(*) FROM public.tasks WHERE machine_id = '30000000-0000-0000-0000-000000000002' AND status = 'cancelled') <> 2 THEN
        RAISE EXCEPTION 'Active tasks were not cancelled';
      END IF;
      IF (SELECT count(*) FROM public.tasks WHERE machine_id = '30000000-0000-0000-0000-000000000002' AND status = 'completed') <> 1 THEN
        RAISE EXCEPTION 'Completed task history was changed';
      END IF;
      IF (SELECT production_queue_number FROM public.machines WHERE id = '40000000-0000-0000-0000-000000000001') <> 1 THEN
        RAISE EXCEPTION 'Other workshop queue changed unexpectedly';
      END IF;
      IF (SELECT production_queue_number FROM public.machines WHERE id = '50000000-0000-0000-0000-000000000001') <> 1 THEN
        RAISE EXCEPTION 'Other factory queue changed unexpectedly';
      END IF;

      BEGIN
        PERFORM public.archive_machine_and_compact_production_queue(
          '30000000-0000-0000-0000-000000000002',
          '90000000-0000-0000-0000-000000000001',
          NULL
        );
      EXCEPTION WHEN OTHERS THEN
        v_failed := position('Машина уже архивирована' in SQLERRM) > 0;
      END;
      IF NOT v_failed THEN RAISE EXCEPTION 'Repeated archive was accepted'; END IF;

      IF has_function_privilege('anon', 'public.archive_machine_and_compact_production_queue(uuid,uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon can execute archive RPC';
      END IF;
      IF has_function_privilege('authenticated', 'public.archive_machine_and_compact_production_queue(uuid,uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated can execute archive RPC directly';
      END IF;
      IF NOT has_function_privilege('service_role', 'public.archive_machine_and_compact_production_queue(uuid,uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'service_role cannot execute archive RPC';
      END IF;
    END;
    $assertions$;
  `)

  console.log('[machine-archive-queue] archive and queue compaction assertions passed')
} finally {
  run('dropdb', ['--if-exists', '--maintenance-db', adminUrl.toString(), databaseName])
}

function psql(sql) {
  run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString()], sql)
}

function run(command, args, input) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    input,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
