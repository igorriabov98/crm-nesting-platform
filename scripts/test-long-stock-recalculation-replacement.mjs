import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actionsSource = readFileSync(path.join(root, 'src/lib/actions/long-stock-cutting-plans.ts'), 'utf8')
const dialogSource = readFileSync(
  path.join(root, 'src/components/features/requests/LongStockPositionDialog.tsx'),
  'utf8',
)
assert.match(actionsSource, /LongStockSafeResult<[\s\S]*success: false; data: null; error: string/)
assert.match(dialogSource, /Утвердить и создать новую заявку/)
assert.match(dialogSource, /Открыть новую заявку/)
assert.match(dialogSource, /Актуальные настройки раскроя/)
assert.doesNotMatch(dialogSource, /Server Components/)
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test',
)

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
  'Replacement lifecycle tests only use localhost or 127.0.0.1',
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

const testSql = readFileSync(
  path.join(root, 'supabase', 'tests', 'long_stock_recalculation_replacement_test.sql'),
  'utf8',
)
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
assert.equal(result.status, 0, 'Long-stock replacement lifecycle SQL assertions failed')
process.stdout.write(result.stdout || '')
console.log('[long-stock-recalculation-replacement] all assertions passed')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
