import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const productionFactActions = readFileSync(
  path.join(root, 'src', 'lib', 'actions', 'production-fact.ts'),
  'utf8',
)
const taskActions = readFileSync(
  path.join(root, 'src', 'lib', 'actions', 'tasks.ts'),
  'utf8',
)
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test',
)

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
  'Long-stock cutting fact tests only use localhost or 127.0.0.1',
)
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
assert.ok(databaseName.toLowerCase().includes('test'), 'Test database name must contain "test"')

run(process.execPath, [path.join(root, 'scripts', 'test-inventory-transfers-full-schema.mjs')])

const postgresEnv = { ...process.env }
delete postgresEnv.PGDATABASE
postgresEnv.PGHOST = databaseUrl.hostname
postgresEnv.PGPORT = databaseUrl.port || '5432'
postgresEnv.PGSSLMODE = databaseUrl.searchParams.get('sslmode') || 'disable'
if (databaseUrl.username) postgresEnv.PGUSER = decodeURIComponent(databaseUrl.username)
if (databaseUrl.password) postgresEnv.PGPASSWORD = decodeURIComponent(databaseUrl.password)

const applyCuttingFactSideEffects = sourceSection(
  productionFactActions,
  'async function applyCuttingFactSideEffects',
  'async function getCuttingRollbackAssignee',
)
const saveProductionMachineFact = sourceSection(
  productionFactActions,
  'export async function saveProductionMachineFact',
  'export async function deleteProductionMachineFact',
)
const getProductionCuttingRollbackPreview = sourceSection(
  taskActions,
  'export async function getProductionCuttingRollbackPreview',
  'export async function applyProductionCuttingRollbackTask',
)
const applyProductionCuttingRollbackTask = sourceSection(
  taskActions,
  'export async function applyProductionCuttingRollbackTask',
  'export async function keepProductionCuttingRollbackTask',
)
const keepProductionCuttingRollbackTask = sourceSection(
  taskActions,
  'export async function keepProductionCuttingRollbackTask',
  'export async function completeTechnologistTaskWithoutRequest',
)

assert.match(
  saveProductionMachineFact,
  /getContext\('production_fact', 'manage'\)[\s\S]*assertFactoryAccess[\s\S]*assertFactoryMachine[\s\S]*applyCuttingFactSideEffects\(admin, [^,]+, userId\)/u,
  'the application must authorize cutting facts and pass the server user to the admin RPC path',
)
assert.match(
  applyCuttingFactSideEffects,
  /\.rpc\('fn_apply_production_fact_cutting',[\s\S]*p_performed_by: userId/u,
  'the cutting-fact RPC actor must come from the authorized server context',
)
assert.match(
  getProductionCuttingRollbackPreview,
  /getCurrentUser\('manage'\)[\s\S]*getCuttingRollbackTaskForUser[\s\S]*getAdminTaskDb\(\)[\s\S]*previewRpcDb\.rpc\('fn_get_production_cutting_rollback_preview'/u,
  'the application must authorize rollback preview and use the service-role RPC path',
)
assert.doesNotMatch(
  getProductionCuttingRollbackPreview,
  /\bdb\.rpc\('fn_get_production_cutting_rollback_preview'/u,
  'the authenticated task client must not invoke the rollback preview RPC',
)
assert.match(
  applyProductionCuttingRollbackTask,
  /getCurrentUser\('manage'\)[\s\S]*getCuttingRollbackTaskForUser[\s\S]*getAdminTaskDb\(\)[\s\S]*rollbackRpcDb\.rpc\('fn_apply_production_cutting_rollback',[\s\S]*p_performed_by: userId/u,
  'the application must authorize rollback and use the server user in the service-role RPC call',
)
assert.doesNotMatch(
  applyProductionCuttingRollbackTask,
  /\bdb\.rpc\('fn_apply_production_cutting_rollback'/u,
  'the authenticated task client must not invoke the rollback mutation RPC',
)
assert.match(
  keepProductionCuttingRollbackTask,
  /getCurrentUser\('manage'\)[\s\S]*getCuttingRollbackTaskForUser[\s\S]*getAdminTaskDb\(\)[\s\S]*keepRpcDb\.rpc\('fn_keep_production_cutting_rollback',[\s\S]*p_performed_by: userId/u,
  'the application must authorize keeping a rollback and use the server user in the service-role RPC call',
)
assert.doesNotMatch(
  keepProductionCuttingRollbackTask,
  /\bdb\.rpc\('fn_keep_production_cutting_rollback'/u,
  'the authenticated task client must not invoke the keep-rollback mutation RPC',
)

assertRpcDeniedForAuthenticated(
  'fn_apply_production_fact_cutting',
  `select public.fn_apply_production_fact_cutting(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000099'::uuid
  );`,
)
assertRpcDeniedForAuthenticated(
  'fn_get_production_cutting_rollback_preview',
  `select public.fn_get_production_cutting_rollback_preview(
    '00000000-0000-0000-0000-000000000001'::uuid
  );`,
)
assertRpcDeniedForAuthenticated(
  'fn_apply_production_cutting_rollback',
  `select public.fn_apply_production_cutting_rollback(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000099'::uuid,
    'spoofed actor'
  );`,
)
assertRpcDeniedForAuthenticated(
  'fn_keep_production_cutting_rollback',
  `select public.fn_keep_production_cutting_rollback(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000099'::uuid,
    'spoofed actor'
  );`,
)

assertServiceRoleCanExecute()

const testSql = readFileSync(
  path.join(root, 'supabase', 'tests', 'long_stock_cutting_fact_test.sql'),
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
assert.equal(result.status, 0, 'Long-stock cutting fact SQL assertions failed')
process.stdout.write(result.stdout || '')
console.log('[long-stock-cutting-fact] all assertions passed')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `Unable to locate ${startMarker}`)
  return source.slice(start, end)
}

function assertRpcDeniedForAuthenticated(functionName, statement) {
  const result = spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseName],
    {
      cwd: root,
      encoding: 'utf8',
      env: postgresEnv,
      input: `begin;\nset local role authenticated;\n${statement}\nrollback;\n`,
    },
  )
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  assert.notEqual(result.status, 0, `${functionName} must reject authenticated callers`)
  assert.match(
    output,
    new RegExp(`permission denied for function ${functionName}`, 'iu'),
    `${functionName} failed for a reason other than its authenticated EXECUTE boundary`,
  )
}

function assertServiceRoleCanExecute() {
  const result = spawnSync(
    'psql',
    ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', databaseName],
    {
      cwd: root,
      encoding: 'utf8',
      env: postgresEnv,
      input: `select
        has_function_privilege(
          'service_role',
          'public.fn_apply_production_fact_cutting(uuid, uuid)',
          'EXECUTE'
        )
        and has_function_privilege(
          'service_role',
          'public.fn_get_production_cutting_rollback_preview(uuid)',
          'EXECUTE'
        )
        and has_function_privilege(
          'service_role',
          'public.fn_apply_production_cutting_rollback(uuid, uuid, uuid, text)',
          'EXECUTE'
        )
        and has_function_privilege(
          'service_role',
          'public.fn_keep_production_cutting_rollback(uuid, uuid, uuid, text)',
          'EXECUTE'
        );\n`,
    },
  )
  assert.equal(result.status, 0, 'Unable to inspect service-role RPC privileges')
  assert.equal(result.stdout.trim(), 't', 'the application service role must retain all cutting RPCs')
}
