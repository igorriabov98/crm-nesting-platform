import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test',
)

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
  'Machine cleanup tests only use localhost or 127.0.0.1',
)
assert.ok(
  decodeURIComponent(databaseUrl.pathname.slice(1)).toLowerCase().includes('test'),
  'Test database name must contain "test"',
)

run(process.execPath, [path.join(root, 'scripts', 'test-inventory-transfers-full-schema.mjs')])
run('psql', [
  '-X',
  '-v',
  'ON_ERROR_STOP=1',
  databaseUrl.toString(),
  '-f',
  path.join(
    root,
    'supabase',
    'tests',
    'machine_operational_dependency_cleanup_backfill_test.sql',
  ),
])
run('psql', [
  '-X',
  '-v',
  'ON_ERROR_STOP=1',
  databaseUrl.toString(),
  '-f',
  path.join(root, 'supabase', 'tests', 'machine_operational_dependency_cleanup_test.sql'),
])

console.log('[machine-operational-cleanup] full lifecycle assertions passed')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
