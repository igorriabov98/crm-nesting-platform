import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const url = new URL(process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test')
assert.equal(url.protocol, 'postgresql:')
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Repair regression is localhost-only')
assert.match(url.pathname, /test/i)
const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGSSLMODE: 'disable' }
delete env.PGDATABASE
if (url.username) env.PGUSER = decodeURIComponent(url.username)
if (url.password) env.PGPASSWORD = decodeURIComponent(url.password)
const base = ['-X', '-v', 'ON_ERROR_STOP=1', '-d', decodeURIComponent(url.pathname.slice(1))]
function psql(args, input) {
  const result = spawnSync('psql', [...base, ...args], { env, input, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}
const scalar = (sql) => psql(['-At', '-c', sql])
const inventory = 'c40b2464-1b4d-4fb8-88b8-db3d7bddb75d'
const quantity = () => scalar(`select total_quantity || ',' || reserved_quantity || ',' || available_quantity from public.inventory where id='${inventory}'`)
const backupDir = mkdtempSync(path.join(tmpdir(), 'civ19-surplus-repair-'))
psql(['-f', 'supabase/tests/civ19_receipt_surplus_repair_setup.sql'])
const repairArgs = ['-v', 'actor_id=49a966fb-683f-4710-a41b-6e9cf57e5615', '-f', 'scripts/repair-civ19-receipt-surplus.sql']

psql(repairArgs)
assert.equal(quantity(), '0,0,0', 'Default repair must roll back')
const backupPath = path.join(backupDir, 'before.json')
psql(['-v', 'apply=true', '-v', `backup_path=${backupPath}`, ...repairArgs])
const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
assert.equal(backup.reservations.length, 2)
assert.equal(backup.event_reservations.length, 2)
assert.equal(backup.transactions.length, 6)
assert.equal(quantity(), '3,0,3', 'Only three surplus sheets must be restored')
assert.equal(scalar(`select count(*) from public.inventory_transactions where inventory_id='${inventory}'`), '7', 'Original movement history must remain')
assert.equal(scalar(`select sum(reserved_quantity) from public.production_fact_cutting_event_reservations where inventory_id='${inventory}'`), '12', 'Rollback must restore only the legitimate consumption')
psql(['-v', 'apply=true', '-v', `backup_path=${path.join(backupDir, 'repeat.json')}`, ...repairArgs])
assert.equal(quantity(), '3,0,3', 'Repeated repair must be a no-op')
assert.equal(scalar(`select count(*) from public.inventory_transactions where inventory_id='${inventory}'`), '7')
psql(['-c', "select public.fn_reserve_delivered_supply_for_cutting('93766eaa-4656-4779-964c-de604f32c954','49a966fb-683f-4710-a41b-6e9cf57e5615')"])
assert.equal(quantity(), '3,0,3', 'Cutting must not re-reserve repaired surplus')
psql([], `
  BEGIN;
  SELECT set_config('request.jwt.claim.sub','49a966fb-683f-4710-a41b-6e9cf57e5615',true);
  DELETE FROM public.production_machine_facts WHERE id='4d7316bb-18f7-42f1-bc1b-c936e59050ee';
  SELECT public.fn_apply_production_cutting_rollback(
    '93766eaa-4656-4779-964c-de604f32c954',null,'49a966fb-683f-4710-a41b-6e9cf57e5615','Surplus repair regression'
  );
  DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.inventory WHERE id='${inventory}'
      AND total_quantity=15 AND reserved_quantity=12 AND available_quantity=3) THEN
      RAISE EXCEPTION 'Cutting rollback restored surplus twice or lost the legitimate reservation';
    END IF;
  END $$;
  ROLLBACK;
`)
console.log('[civ19-surplus-repair] dry run, backup, repair, idempotency and actual cutting rollback passed')
