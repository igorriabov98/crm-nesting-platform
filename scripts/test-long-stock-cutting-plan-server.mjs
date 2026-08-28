import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
  'Long-stock cutting plan server tests only use localhost or 127.0.0.1',
)
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
assert.ok(databaseName.toLowerCase().includes('test'), 'Test database name must contain "test"')

run(process.execPath, [path.join(root, 'scripts', 'test-long-stock-cutting-plan-schema.mjs')])

const postgresEnv = { ...process.env }
delete postgresEnv.PGDATABASE
postgresEnv.PGHOST = databaseUrl.hostname
postgresEnv.PGPORT = databaseUrl.port || '5432'
postgresEnv.PGSSLMODE = databaseUrl.searchParams.get('sslmode') || 'disable'
if (databaseUrl.username) postgresEnv.PGUSER = decodeURIComponent(databaseUrl.username)
if (databaseUrl.password) postgresEnv.PGPASSWORD = decodeURIComponent(databaseUrl.password)

for (const testFile of [
  'long_stock_cutting_plan_server_test.sql',
  'long_stock_selected_sources_test.sql',
]) {
  const testSql = readFileSync(path.join(root, 'supabase', 'tests', testFile), 'utf8')
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseName], {
    cwd: root,
    encoding: 'utf8',
    env: postgresEnv,
    input: testSql,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${testFile} SQL assertions failed`)
  process.stdout.write(result.stdout || '')
}
console.log('[long-stock-cutting-plan-server] all assertions passed')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
