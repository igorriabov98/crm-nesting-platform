import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test',
)

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
  'Long-stock race tests only use localhost or 127.0.0.1',
)
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
assert.ok(databaseName.toLowerCase().includes('test'), 'Test database name must contain "test"')

const productionFactAction = readFileSync(
  path.join(root, 'src', 'lib', 'actions', 'production-fact.ts'),
  'utf8',
)
assert.match(
  productionFactAction,
  /fn_save_production_machine_fact_atomic_v1/,
  'Single fact server action must use the atomic database boundary',
)
assert.match(
  productionFactAction,
  /fn_save_production_machine_facts_atomic_v1/,
  'Bulk fact server actions must use the atomic database boundary',
)
assert.doesNotMatch(
  productionFactAction,
  /async function applyCuttingFactSideEffects/,
  'Application must not retain the old post-commit cutting side-effect call',
)
assert.match(
  productionFactAction,
  /Проведённый факт заготовки нельзя перенести на другую машину или участок; сначала выполните откат/,
  'Server action must reject a structural move before calling the atomic RPC',
)

run(process.execPath, [path.join(root, 'scripts', 'test-inventory-transfers-full-schema.mjs')])

const postgresEnv = { ...process.env }
delete postgresEnv.PGDATABASE
postgresEnv.PGHOST = databaseUrl.hostname
postgresEnv.PGPORT = databaseUrl.port || '5432'
postgresEnv.PGSSLMODE = databaseUrl.searchParams.get('sslmode') || 'disable'
if (databaseUrl.username) postgresEnv.PGUSER = decodeURIComponent(databaseUrl.username)
if (databaseUrl.password) postgresEnv.PGPASSWORD = decodeURIComponent(databaseUrl.password)

const setupOutput = runPsql(
  readFileSync(path.join(root, 'supabase', 'tests', 'long_stock_cutting_race_setup.sql'), 'utf8'),
)
const fixtureLine = setupOutput.trim().split('\n').findLast((line) => line.startsWith('{'))
assert.ok(fixtureLine, 'Race fixture did not return its identifiers')
const fixture = JSON.parse(fixtureLine)
for (const [key, value] of Object.entries(fixture)) {
  assert.match(value, /^[0-9a-f-]{36}$/i, `Fixture ${key} must be a UUID`)
}

// Invalidation owns the common plan lock. The fact can execute legacy
// inventory work only inside its uncommitted transaction; after invalidation
// commits, its version check fails and the complete fact transaction rolls back.
const invalidation = spawnPsql(`
begin;
select 1
from public.long_stock_cutting_plans
where id = '${fixture.plan}'::uuid
for update;
\\echo PLAN_LOCKED
select pg_sleep(1);
select public.fn_invalidate_long_stock_cutting_plan_for_receipt(
  'request_circle',
  '${fixture.request_item}'::uuid,
  '${fixture.actor}'::uuid,
  'Конкурентная инвалидация карты',
  '${fixture.schedule}'::uuid,
  null
);
commit;
`)
await invalidation.waitFor('PLAN_LOCKED')

const concurrentFact = spawnPsql(`
select public.fn_save_production_machine_fact_atomic_v1(
  null,
  '${fixture.factory}'::uuid,
  current_date,
  '${fixture.invalidation_machine}'::uuid,
  '${fixture.section}'::uuid,
  'day'::public.production_fact_shift,
  'Конкурентный факт при инвалидации',
  '${fixture.actor}'::uuid
);
`)

const [invalidationResult, concurrentFactResult] = await Promise.all([
  invalidation.done,
  concurrentFact.done,
])
assert.equal(invalidationResult.status, 0, invalidationResult.stderr || invalidationResult.stdout)
assert.notEqual(concurrentFactResult.status, 0, 'Fact must not commit against an invalidated version')
assert.match(
  concurrentFactResult.stderr,
  /утверждённая версия карты уже недействительна/,
  'Fact must fail at the locked plan-version check',
)

const invalidationState = JSON.parse(runPsql(`
select jsonb_build_object(
  'version_status', (select status from public.long_stock_cutting_plan_versions where id = '${fixture.version}'),
  'fact_count', (select count(*) from public.production_machine_facts where machine_id = '${fixture.invalidation_machine}'),
  'event_count', (select count(*) from public.production_fact_cutting_events where machine_id = '${fixture.invalidation_machine}'),
  'cut_bar_count', (
    select count(*)
    from public.long_stock_cutting_candidate_bars
    where version_id = '${fixture.version}' and status = 'cut'
  ),
  'active_scrap_count', (
    select count(*)
    from public.long_stock_cutting_business_scraps link
    join public.inventory inventory on inventory.id = link.inventory_id
    where link.version_id = '${fixture.version}' and inventory.deleted_at is null
  ),
  'source_total', (select total_quantity from public.inventory where id = '${fixture.source_inventory}'),
  'source_reserved', (select reserved_quantity from public.inventory where id = '${fixture.source_inventory}')
);
`).trim())
assert.deepEqual(invalidationState, {
  version_status: 'invalid',
  fact_count: 0,
  event_count: 0,
  cut_bar_count: 0,
  active_scrap_count: 0,
  source_total: 6000,
  source_reserved: 6000,
})

// An existing fact event is immutable with respect to machine and section.
// The failed update must leave both the fact row and its event on the source.
const movedFact = spawnPsql(`
select public.fn_save_production_machine_fact_atomic_v1(
  '${fixture.move_fact}'::uuid,
  '${fixture.factory}'::uuid,
  current_date,
  '${fixture.move_target_machine}'::uuid,
  '${fixture.section}'::uuid,
  'day'::public.production_fact_shift,
  'Запрещённый перенос проведённого факта',
  '${fixture.actor}'::uuid
);
`)
const movedFactResult = await movedFact.done
assert.notEqual(movedFactResult.status, 0, 'Applied fact move must be rejected')
assert.match(
  movedFactResult.stderr,
  /нельзя перенести на другую машину или участок; сначала выполните откат/,
  'Applied fact move must fail with the operator-facing rollback instruction',
)

const moveState = JSON.parse(runPsql(`
select jsonb_build_object(
  'fact_machine', (
    select machine_id from public.production_machine_facts where id = '${fixture.move_fact}'
  ),
  'event_machine', (
    select machine_id from public.production_fact_cutting_events where id = '${fixture.move_event}'
  ),
  'event_count', (
    select count(*) from public.production_fact_cutting_events where fact_id = '${fixture.move_fact}'
  )
);
`).trim())
assert.deepEqual(moveState, {
  fact_machine: fixture.move_source_machine,
  event_machine: fixture.move_source_machine,
  event_count: 1,
})

// Rollback takes the machine lock before its single event snapshot. A new fact
// arriving while that lock is held is rejected before its row can be inserted.
const rollback = spawnPsql(`
begin;
select public.fn_lock_production_cutting_machine_v1('${fixture.rollback_machine}'::uuid);
\\echo MACHINE_LOCKED
select pg_sleep(1);
select public.fn_apply_production_cutting_rollback(
  '${fixture.rollback_machine}'::uuid,
  null,
  '${fixture.actor}'::uuid,
  'Конкурентный тест отката'
);
commit;
`)
await rollback.waitFor('MACHINE_LOCKED')

const factDuringRollback = spawnPsql(`
select public.fn_save_production_machine_fact_atomic_v1(
  null,
  '${fixture.factory}'::uuid,
  current_date,
  '${fixture.rollback_machine}'::uuid,
  '${fixture.section}'::uuid,
  'day'::public.production_fact_shift,
  'Новый факт во время отката',
  '${fixture.actor}'::uuid
);
`)

const [rollbackResult, factDuringRollbackResult] = await Promise.all([
  rollback.done,
  factDuringRollback.done,
])
assert.equal(rollbackResult.status, 0, rollbackResult.stderr || rollbackResult.stdout)
assert.notEqual(factDuringRollbackResult.status, 0, 'A fact racing with rollback must be rejected')
assert.match(
  factDuringRollbackResult.stderr,
  /по машине выполняется другой факт или откат/,
  'Concurrent fact must fail on the shared machine lock',
)

const rollbackState = JSON.parse(runPsql(`
select jsonb_build_object(
  'event_status', (
    select status from public.production_fact_cutting_events where id = '${fixture.rollback_event}'
  ),
  'fact_count', (
    select count(*) from public.production_machine_facts where machine_id = '${fixture.rollback_machine}'
  ),
  'stage_date', (
    select date_start
    from public.production_stages
    where machine_id = '${fixture.rollback_machine}'
      and stage_type = 'cutting'
  )
);
`).trim())
assert.deepEqual(rollbackState, {
  event_status: 'rolled_back',
  fact_count: 0,
  stage_date: null,
})

runPsql('drop table public.test_long_stock_cutting_race_fixture;')
console.log('[long-stock-cutting-races] all assertions passed')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}

function psqlArgs() {
  return ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-d', databaseName]
}

function runPsql(input) {
  const result = spawnSync('psql', psqlArgs(), {
    cwd: root,
    env: postgresEnv,
    encoding: 'utf8',
    input,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, 'psql assertion failed')
  return result.stdout || ''
}

function spawnPsql(input) {
  const child = spawn('psql', psqlArgs(), {
    cwd: root,
    env: postgresEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const outputListeners = new Set()

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    for (const listener of outputListeners) listener()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
    for (const listener of outputListeners) listener()
  })
  child.stdin.end(input)

  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (status) => resolve({ status, stdout, stderr }))
  })

  const waitFor = (marker) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      outputListeners.delete(check)
      reject(new Error(`Timed out waiting for psql marker ${marker}\n${stdout}\n${stderr}`))
    }, 5000)
    const check = () => {
      if (!stdout.includes(marker)) return
      clearTimeout(timeout)
      outputListeners.delete(check)
      resolve()
    }
    outputListeners.add(check)
    check()
  })

  return { done, waitFor }
}
