import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8')

const [migration, taskTypeMigration, securityHardeningMigration, actions, requestPage, transportPage, receivingPage, taskCards, databaseTypes] = await Promise.all([
  read('supabase/migrations/20260719163223_detailing_module.sql'),
  read('supabase/migrations/20260719163222_detailing_task_type.sql'),
  read('supabase/migrations/20260719212000_detailing_security_hardening.sql'),
  read('src/lib/actions/detailing.ts'),
  read('src/components/features/supply-request/DetailingRequestPanel.tsx'),
  read('src/components/features/supply/DetailingTransportPanel.tsx'),
  read('src/components/features/inventory/DetailingReceivingPanel.tsx'),
  read('src/components/features/tasks/TaskCards.tsx'),
  read('src/lib/types/database.ts'),
])

assert.match(taskTypeMigration, /ADD VALUE IF NOT EXISTS 'detailing_transfer'/)
assert.doesNotMatch(migration, /ALTER TYPE public\.task_type ADD VALUE/)
for (const signature of [
  'detailing_touch_updated_at\\(\\)',
  'detailing_validate_product_version\\(\\)',
  'detailing_reject_movement_changes\\(\\)',
  'detailing_previous_workday\\(date\\)',
]) {
  assert.match(
    securityHardeningMigration,
    new RegExp(`ALTER FUNCTION public\\.${signature}[\\s\\S]*?SET search_path = public`),
    `${signature} must have a fixed search_path`,
  )
}
assert.match(
  securityHardeningMigration,
  /REVOKE ALL ON FUNCTION public\.detailing_role_allowed\(public\.user_role\[\]\)[\s\S]*FROM PUBLIC, anon, authenticated/,
)
for (const table of ['detailing_parts', 'detailing_balances', 'detailing_movements', 'detailing_reservations', 'detailing_transfers', 'detailing_consumption_events']) {
  assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`), `${table} is missing`)
  assert.match(migration, new RegExp(`ALTER TABLE public\\.%I ENABLE ROW LEVEL SECURITY|CREATE POLICY [\\s\\S]* ON public\\.${table}`), `${table} RLS is missing`)
}
for (const rpc of ['fn_create_detailing_part', 'fn_reserve_detailing', 'fn_receive_detailing_transfer', 'fn_release_detailing_reservation']) {
  assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}`), `${rpc} is missing`)
}
assert.match(migration, /FOR UPDATE/)
assert.match(migration, /detail(?:ing)?_movements_immutable/)
assert.match(migration, /AFTER INSERT ON public\.production_fact_cutting_events/)
assert.match(migration, /AFTER UPDATE OF status ON public\.production_fact_cutting_events/)
assert.match(migration, /detail(?:ing)?_previous_workday/)
assert.match(migration, /INSERT INTO public\.department_access_permissions/)
assert.match(migration, /РИСК ОПОЗДАНИЯ/)
assert.match(actions, /requirePermission\('inventory_detailing'/)
assert.doesNotMatch(requestPage, /\.from\(['"]detailing_/)
assert.doesNotMatch(transportPage, /\.from\(['"]detailing_/)
assert.doesNotMatch(receivingPage, /\.from\(['"]detailing_/)
assert.match(taskCards, /В ближайшее время/)
assert.match(databaseTypes, /deadline: string \| null/)
assert.match(databaseTypes, /'detailing_transfer'/)
for (const table of ['detailing_parts', 'detailing_balances', 'detailing_reservations', 'detailing_transfers', 'detailing_movements']) {
  assert.match(databaseTypes, new RegExp(`${table}:`), `${table} database type is missing`)
}

if (process.env.DETAILING_TEST_DATABASE_URL) {
  const result = spawnSync('psql', [
    '-v', 'ON_ERROR_STOP=1',
    process.env.DETAILING_TEST_DATABASE_URL,
    '-f', path.join(root, 'supabase/tests/detailing_module_test.sql'),
  ], { stdio: 'inherit' })
  assert.equal(result.status, 0, 'SQL detailing lifecycle test failed')
}

console.log('detailing module integration checks: ok')
