import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = new URL(process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test')
assert.equal(databaseUrl.protocol, 'postgresql:')
assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'DB integration tests only use localhost')
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
assert.ok(databaseName.toLowerCase().includes('test'), 'DB name must contain test')

const env = { ...process.env }
delete env.PGDATABASE
env.PGHOST = databaseUrl.hostname
env.PGPORT = databaseUrl.port || '5432'
env.PGSSLMODE = databaseUrl.searchParams.get('sslmode') || 'disable'
if (databaseUrl.username) env.PGUSER = decodeURIComponent(databaseUrl.username)
if (databaseUrl.password) env.PGPASSWORD = decodeURIComponent(databaseUrl.password)

runPsql(readFileSync(path.join(root, 'supabase/tests/production_analytics_item_facts_test.sql'), 'utf8'))

const fixture = JSON.parse(runPsql(`
do $$
declare
  v_factory uuid;
  v_actor uuid := '95000000-0000-4000-8000-000000000001';
  v_parent uuid := '95000000-0000-4000-8000-000000000002';
  v_section uuid := '95000000-0000-4000-8000-000000000003';
  v_machine uuid := '95000000-0000-4000-8000-000000000004';
  v_item uuid := '95000000-0000-4000-8000-000000000005';
begin
  delete from public.machines where id = v_machine;
  delete from public.production_fact_sections where id in (v_section, v_parent);
  delete from public.users where id = v_actor;
  select id into strict v_factory from public.factories order by created_at, id limit 1;
  insert into public.users(id, email, full_name, role, factory_id, is_active)
  values (v_actor, 'production-analytics-race@example.test', 'Production Analytics Race', 'production_manager', v_factory, true);
  insert into public.production_fact_sections(id, factory_id, parent_id, name, production_stage_type, created_by, updated_by)
  values
    (v_parent, v_factory, null, 'Сборка race', 'assembly', v_actor, v_actor),
    (v_section, v_factory, v_parent, 'Цех 95', 'assembly', v_actor, v_actor);
  insert into public.machines(id, factory_id, name, created_by) values (v_machine, v_factory, 'PRODUCTION-ANALYTICS-RACE', v_actor);
  insert into public.machine_items(id, machine_id, drawing_number, product_name, weight, price, quantity, coating)
  values (v_item, v_machine, 'R-1', 'Race item', 1, 0, 10, 'powder_coating');
  create table if not exists public.test_production_analytics_race_fixture(factory_id uuid, actor_id uuid, section_id uuid, machine_id uuid, item_id uuid);
  truncate public.test_production_analytics_race_fixture;
  insert into public.test_production_analytics_race_fixture values (v_factory, v_actor, v_section, v_machine, v_item);
end;
$$;
select row_to_json(f) from public.test_production_analytics_race_fixture f;
`).trim().split('\n').findLast((line) => line.startsWith('{')))

const calls = ['2026-09-10', '2026-09-11'].map((factDate) => spawnPsql(`
select public.fn_save_production_machine_item_fact_v1(
  '${fixture.factory_id}', '${factDate}', 'day', '${fixture.machine_id}', '${fixture.section_id}', 'assembly',
  jsonb_build_array(jsonb_build_object('machine_item_id', '${fixture.item_id}', 'quantity', 6)), null, '${fixture.actor_id}'
);
`))
const results = await Promise.all(calls.map((call) => call.done))
assert.equal(results.filter((result) => result.status === 0).length, 1, 'exactly one concurrent save must commit')
assert.equal(results.filter((result) => /Количество превышает остаток по этапу/.test(result.stderr)).length, 1, 'the other concurrent save must be rejected by the remaining-quantity lock')
assert.equal(Number(runPsql(`select coalesce(sum(quantity), 0) from public.production_machine_item_facts where machine_item_snapshot_id = '${fixture.item_id}';`).trim()), 6)

runPsql(`
drop table if exists public.test_production_analytics_race_fixture;
delete from public.machines where id = '${fixture.machine_id}';
delete from public.production_tonnage_facts where section_id = '${fixture.section_id}';
delete from public.production_fact_sections where id = '${fixture.section_id}' or id = '95000000-0000-4000-8000-000000000002';
delete from public.users where id = '${fixture.actor_id}';
`)

console.log('Production analytics database and race contracts: OK')

function runPsql(sql) {
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-d', databaseName], { cwd: root, env, input: sql, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

function spawnPsql(sql) {
  const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq', '-d', databaseName], { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdin.end(sql)
  return { done: new Promise((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr }))) }
}
