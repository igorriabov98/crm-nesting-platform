import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = new URL(process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_order_discount_test')

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'Discount DB tests only use localhost')
assert.ok(decodeURIComponent(databaseUrl.pathname.slice(1)).toLowerCase().includes('test'), 'Test database name must contain test')

run(
  process.execPath,
  [path.join(root, 'scripts', 'test-inventory-transfers-full-schema.mjs')],
  { ...process.env, FULL_SCHEMA_TEST_DATABASE_URL: databaseUrl.toString() },
)
run('psql', [
  '-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f',
  path.join(root, 'supabase', 'tests', 'client_price_order_discounts_test.sql'),
])

const requestId = sql(`select id from machine_discount_requests where machine_id = '71000000-0000-4000-8000-000000000507' and status = 'pending'`).trim()
assert.match(requestId, /^[0-9a-f-]{36}$/)

const priceAdjustments = await Promise.all([priceAdjustment(), priceAdjustment()])
assert.equal(priceAdjustments.filter((result) => result.code === 0).length, 2, 'Concurrent price adjustments must both serialize successfully')
assert.equal(sql(`select price_eur from client_product_prices where client_id = '71000000-0000-4000-8000-000000000301' and product_id = '71000000-0000-4000-8000-000000000401' and coating = 'zinc'`).trim(), '133.10')
assert.equal(sql(`select count(*) from client_price_adjustment_lines where product_id = '71000000-0000-4000-8000-000000000401' and coating = 'zinc' and ((old_price = 110 and new_price = 121) or (old_price = 121 and new_price = 133.10))`).trim(), '2', 'Concurrent price audit chain is not contiguous')

const decisions = await Promise.all([decision(requestId), decision(requestId)])
assert.equal(decisions.filter((result) => result.code === 0).length, 1, 'Exactly one concurrent decision must succeed')
assert.match(decisions.find((result) => result.code !== 0)?.stderr || '', /Решение по заявке уже принято/)
assert.equal(sql(`select status from machine_discount_requests where id = '${requestId}'`).trim(), 'approved')
assert.equal(sql(`select count(*) from tasks where machine_discount_request_id = '${requestId}' and status in ('pending','in_progress')`).trim(), '0')

console.log('[order-discounts] database lifecycle, security, and concurrent decision assertions passed')

function sql(statement) {
  const result = spawnSync('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-c', statement], { cwd: root, encoding: 'utf8', env: process.env })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function decision(requestId) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-c', `
      begin;
      select id from machine_discount_requests where id = '${requestId}' for update;
      select pg_sleep(0.2);
      select fn_approve_machine_discount_request('${requestId}', '71000000-0000-4000-8000-000000000102');
      commit;
    `], { cwd: root, env: process.env, stdio: ['ignore','pipe','pipe'] })
    let stderr = ''
    child.stdout.resume()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

function priceAdjustment() {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-c', `
      select fn_adjust_client_product_prices(
        '71000000-0000-4000-8000-000000000301', 'increase', 10,
        array['zinc']::coating_type[], '71000000-0000-4000-8000-000000000101'
      );
    `], { cwd: root, env: process.env, stdio: ['ignore','pipe','pipe'] })
    let stderr = ''
    child.stdout.resume()
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env, stdio: 'inherit' })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
