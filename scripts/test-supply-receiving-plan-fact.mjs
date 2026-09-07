import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
  'Supply receiving plan/fact tests only use localhost or 127.0.0.1',
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

const testSql = readFileSync(
  path.join(root, 'supabase', 'tests', 'supply_receiving_plan_fact_test.sql'),
  'utf8',
)
const batchTestSql = readFileSync(
  path.join(root, 'supabase', 'tests', 'material_receiving_batch_test.sql'),
  'utf8',
)
for (const [label, sql] of [
  ['Supply receiving plan/fact', testSql],
  ['Material receiving batch', batchTestSql],
]) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseName], {
    cwd: root,
    encoding: 'utf8',
    env: postgresEnv,
    input: sql,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${label} SQL assertions failed`)
  process.stdout.write(result.stdout || '')
}
await testConcurrentBatchReceipt()
console.log('[supply-receiving-plan-fact] all assertions passed')

async function testConcurrentBatchReceipt() {
  const fixture = {
    actor: randomUUID(),
    machine: randomUUID(),
    request: randomUUID(),
    supplier: randomUUID(),
    material: randomUUID(),
    item: randomUUID(),
    firstSchedule: randomUUID(),
    secondSchedule: randomUUID(),
  }
  const setupSql = `
    DO $$
    DECLARE v_factory uuid;
    BEGIN
      SELECT id INTO v_factory FROM public.factories ORDER BY created_at NULLS LAST LIMIT 1;
      IF v_factory IS NULL THEN RAISE EXCEPTION 'Для теста не найден завод'; END IF;
      INSERT INTO public.users(id, email, full_name, role, factory_id, is_active)
      VALUES ('${fixture.actor}', 'material-batch-concurrency-${fixture.actor}@example.test', 'Конкурентная приёмка', 'supply_manager', v_factory, true);
      INSERT INTO public.suppliers(id, name) VALUES ('${fixture.supplier}', 'Concurrent supplier ${fixture.supplier}');
      INSERT INTO public.machines(id, factory_id, name, created_by)
      VALUES ('${fixture.machine}', v_factory, 'Конкурентная пакетная приёмка', '${fixture.actor}');
      INSERT INTO public.technologist_requests(id, machine_id, created_by, status)
      VALUES ('${fixture.request}', '${fixture.machine}', '${fixture.actor}', 'submitted_to_supply');
      INSERT INTO public.materials(id, name, category, default_supplier_id, created_by)
      VALUES ('${fixture.material}', 'Concurrent RAL', 'paint', '${fixture.supplier}', '${fixture.actor}');
      INSERT INTO public.request_paint(
        id, request_id, paint_type, ral_code, finish, weight_kg, waste_percent,
        order_status, ordered_at, material_id, supplier_id, remainder_kg
      ) VALUES (
        '${fixture.item}', '${fixture.request}', 'concurrent ral', 'CONCURRENT', 'матовый', 10, 0,
        'ordered', now(), '${fixture.material}', '${fixture.supplier}', 10
      );
      INSERT INTO public.supply_order_delivery_schedules(
        id, request_item_table, request_item_id, delivery_date, quantity, unit,
        supplier_id, created_by, updated_by, created_at
      ) VALUES
        ('${fixture.firstSchedule}', 'request_paint', '${fixture.item}', date '2026-09-13', 5, 'кг', '${fixture.supplier}', '${fixture.actor}', '${fixture.actor}', now()),
        ('${fixture.secondSchedule}', 'request_paint', '${fixture.item}', date '2026-09-13', 5, 'кг', '${fixture.supplier}', '${fixture.actor}', '${fixture.actor}', now() + interval '1 second');
    END;
    $$;
  `
  runPsql(setupSql, 'Concurrent batch fixture setup')

  const receiptJson = JSON.stringify([
    {
      schedule_id: fixture.firstSchedule,
      received_quantity: 5,
      allocations: [{
        table: 'request_paint', id: fixture.item, quantity: 5, physical_quantity: 5, piece_count: null,
      }],
    },
    {
      schedule_id: fixture.secondSchedule,
      received_quantity: 5,
      allocations: [{
        table: 'request_paint', id: fixture.item, quantity: 5, physical_quantity: 5, piece_count: null,
      }],
    },
  ]).replaceAll("'", "''")
  const callSql = `SELECT public.fn_receive_supply_order_schedule_batch_v1('${receiptJson}'::jsonb, '${fixture.actor}');`
  const firstSql = `
    BEGIN;
    SELECT id FROM public.supply_order_delivery_schedules
    WHERE id IN ('${fixture.firstSchedule}', '${fixture.secondSchedule}') ORDER BY id FOR UPDATE;
    SELECT pg_sleep(0.5);
    ${callSql}
    SELECT pg_sleep(1);
    COMMIT;
  `

  const first = runPsqlAsync(firstSql)
  await new Promise((resolve) => setTimeout(resolve, 150))
  const secondStartedAt = Date.now()
  const second = runPsqlAsync(callSql)
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.status, 0, `First concurrent receipt failed: ${firstResult.stderr}`)
  assert.notEqual(secondResult.status, 0, 'Concurrent repeated receipt unexpectedly succeeded')
  assert.match(`${secondResult.stdout}\n${secondResult.stderr}`, /Поставка уже принята/)
  assert.ok(Date.now() - secondStartedAt >= 900, 'Concurrent receipt did not wait for the schedule lock')

  const verifySql = `
    DO $$
    DECLARE v_factory uuid;
    BEGIN
      SELECT factory_id INTO v_factory FROM public.machines WHERE id = '${fixture.machine}';
      IF (SELECT count(*) FROM public.supply_order_delivery_schedules
          WHERE id IN ('${fixture.firstSchedule}', '${fixture.secondSchedule}') AND status = 'delivered') <> 2 THEN
        RAISE EXCEPTION 'Конкурентная проверка не закрыла обе технические строки';
      END IF;
      IF (SELECT total_quantity FROM public.inventory
          WHERE factory_id = v_factory AND material_id = '${fixture.material}' AND material_variant_id IS NULL AND is_business_scrap = false) <> 10 THEN
        RAISE EXCEPTION 'Конкурентный повтор изменил складской итог более одного раза';
      END IF;
      -- This fixture is committed so two sessions can race. Keep it from
      -- participating in later role-based recipient selection in the same DB.
      UPDATE public.users SET is_active = false WHERE id = '${fixture.actor}';
    END;
    $$;
  `
  runPsql(verifySql, 'Concurrent batch verification')
  console.log('[material-receiving-batch] concurrent repeat rejected after row lock')
}

function runPsql(sql, label) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseName], {
    cwd: root,
    encoding: 'utf8',
    env: postgresEnv,
    input: sql,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${label} failed`)
}

function runPsqlAsync(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', databaseName], {
      cwd: root,
      env: postgresEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
    child.stdin.end(sql)
  })
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
