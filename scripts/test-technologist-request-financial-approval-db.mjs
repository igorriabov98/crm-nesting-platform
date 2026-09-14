import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = new URL(process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test')

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'Approval DB tests only use localhost')
assert.ok(decodeURIComponent(databaseUrl.pathname.slice(1)).toLowerCase().includes('test'), 'Test database name must contain test')

run(process.execPath, [path.join(root, 'scripts', 'test-inventory-transfers-full-schema.mjs')], { ...process.env, FINANCIAL_APPROVAL_LEGACY_FIXTURE: 'true' })
run('psql', [
  '-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-f',
  path.join(root, 'supabase', 'tests', 'technologist_request_financial_approval_test.sql'),
])

const ids = Object.fromEntries(['factory','author','reviewer','machine','request','sheet','steel'].map((key) => [key, randomUUID()]))
const version = sql(`
  begin;
  insert into factories(id,name) values ('${ids.factory}','APPROVAL-CONCURRENCY-TEST');
  insert into users(id,email,full_name,role,factory_id,is_active) values
    ('${ids.author}','${ids.author}@approval.test','Автор гонки','technologist','${ids.factory}',true),
    ('${ids.reviewer}','${ids.reviewer}@approval.test','Финансовый директор гонки','financial_director','${ids.factory}',true);
  insert into machines(id,factory_id,name,created_by,status,material_type)
    values ('${ids.machine}','${ids.factory}','APPROVAL CONCURRENCY','${ids.author}','planned','standard');
  insert into technologist_requests(id,machine_id,created_by,status)
    values ('${ids.request}','${ids.machine}','${ids.author}','stock_checked');
  insert into steel_types(id,name,density_kg_mm3) values ('${ids.steel}','APPROVAL-RACE-STEEL',0.00000785);
  insert into request_sheet_metal(id,request_id,material_name,quantity_sheets,thickness_mm,sheet_size,steel_type_id,remainder_qty)
    values ('${ids.sheet}','${ids.request}','Лист гонки',1,10,'1000x1000','${ids.steel}',1);
  select fn_submit_technologist_request_for_approval('${ids.request}','${ids.author}',
    jsonb_build_object('decision','none','enteredPlasmaMinutes',0,'wasteItems',jsonb_build_array(jsonb_build_object(
      'sourceTable','request_sheet_metal','sourceId','${ids.sheet}','itemName','Лист гонки','materialName','Лист гонки','wastePercent',10
    )),'futureItems','[]'::jsonb,'archives','[]'::jsonb),
    jsonb_build_object('schemaVersion',1,'items','[]'::jsonb,'sourceData',fn_technologist_approval_source('${ids.request}')));
  commit;
`).trim()
assert.match(version, /^[0-9a-f-]{36}$/)

const decisions = await Promise.all([decision(), decision()])
assert.equal(decisions.filter((result) => result.code === 0).length, 1, 'Exactly one concurrent approval must succeed')
assert.match(decisions.find((result) => result.code !== 0)?.stderr || '', /Решение по версии уже принято/)
assert.equal(sql(`select count(*) from technologist_request_completions where request_id = '${ids.request}'`).trim(), '1')
assert.equal(sql(`select count(*) from tasks where technologist_request_approval_id = '${version}' and status in ('pending','in_progress')`).trim(), '0')

console.log('[technologist-request-financial-approval] database lifecycle and concurrent approval assertions passed')

function sql(statement) {
  const result = spawnSync('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-c', statement], { cwd: root, encoding: 'utf8', env: process.env })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function decision() {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(), '-c', `
      begin;
      select id from technologist_requests where id = '${ids.request}' for update;
      select pg_sleep(0.2);
      select fn_approve_technologist_request('${version}','${ids.reviewer}');
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

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env, stdio: 'inherit' })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}
