import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  listSupabaseMigrationFiles,
  orderSupabaseMigrationFiles,
} from './supabase-migration-order.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const prismaMigrationsDir = path.join(root, 'nesting-service', 'prisma', 'migrations')
const bootstrapPath = path.join(root, 'supabase', 'tests', 'full_schema_test_bootstrap.sql')
const transferCompatPath = path.join(
  root,
  'supabase',
  'tests',
  'full_schema_inventory_transfer_compat.sql',
)
const longStockSupplierScheduleGuardPath = path.join(
  root,
  'supabase',
  'tests',
  'long_stock_supplier_schedule_guard_test.sql',
)
const cuttingAreaCancelledRequestsPath = path.join(
  root,
  'supabase',
  'tests',
  'production_cutting_area_cancelled_requests_test.sql',
)
const rlsManifest = JSON.parse(
  readFileSync(path.join(root, 'config', 'rls-resource-manifest.json'), 'utf8'),
)
assert.ok(process.env.FULL_SCHEMA_TEST_DATABASE_URL, 'Set FULL_SCHEMA_TEST_DATABASE_URL explicitly: this test rebuilds the selected local database')
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL,
)

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
  'Full-schema tests only rebuild a database on localhost or 127.0.0.1',
)

const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
assert.match(databaseName, /^[a-zA-Z0-9_]+$/, 'Test database name must contain only letters, digits, and underscores')
assert.ok(databaseName.toLowerCase().includes('test'), 'Test database name must contain "test"')
assert.ok(
  !['postgres', 'template0', 'template1'].includes(databaseName.toLowerCase()),
  'Refusing to rebuild a PostgreSQL system database',
)

const postgresEnv = { ...process.env }
delete postgresEnv.PGDATABASE
postgresEnv.PGHOST = databaseUrl.hostname
postgresEnv.PGPORT = databaseUrl.port || '5432'
postgresEnv.PGSSLMODE = databaseUrl.searchParams.get('sslmode') || 'disable'
if (databaseUrl.username) postgresEnv.PGUSER = decodeURIComponent(databaseUrl.username)
if (databaseUrl.password) postgresEnv.PGPASSWORD = decodeURIComponent(databaseUrl.password)

const migrations = orderSupabaseMigrationFiles(listSupabaseMigrationFiles(migrationsDir)).filter(file=>!process.env.FULL_SCHEMA_MIGRATION_BEFORE || !/^\d{14}_/.test(file) || file < process.env.FULL_SCHEMA_MIGRATION_BEFORE)
const prismaMigrations = readdirSync(prismaMigrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const replayPreludes = new Map([
  ['20260919120000_organization_access_foundation.sql', `CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text); INSERT INTO public.departments(name,is_active) VALUES ('Финансовый отдел',true);
    DO $fixture$ DECLARE fixture_user uuid; fixture_dept uuid; BEGIN
      IF EXISTS(SELECT 1 FROM public.users WHERE is_active) AND NOT EXISTS(SELECT 1 FROM public.users WHERE public.crm_user_is_admin(id)) THEN
        INSERT INTO public.users(email,full_name,role,is_active) VALUES('replay-admin@organization.test','Replay administrator','engineer',true) RETURNING id INTO fixture_user;
        INSERT INTO public.departments(name,is_active) VALUES('Replay administration',true) RETURNING id INTO fixture_dept;
        INSERT INTO public.department_members(user_id,department_id,position_id) SELECT fixture_user,fixture_dept,id FROM public.positions WHERE name='Администратор CRM' LIMIT 1;
      END IF;
    END $fixture$;`],
  [
    '100_manual_production_stage_overdue.sql',
    'DROP VIEW IF EXISTS public.production_stages_with_delay;\n',
  ],
  [
    '20260626153000_inventory_factory_scope.sql',
    `INSERT INTO public.factories(name)
     SELECT 'Берегово'
     WHERE NOT EXISTS (SELECT 1 FROM public.factories WHERE name = 'Берегово');
     INSERT INTO public.factories(name)
     SELECT 'Ужгород'
     WHERE NOT EXISTS (SELECT 1 FROM public.factories WHERE name = 'Ужгород');
    `,
  ],
  [
    '20260905150000_meeting_system_v2.sql',
    `INSERT INTO public.meeting_recurrence_rules(
       id, meeting_type, title, meeting_time, weekdays, start_date, occurrence_count
     ) VALUES
       ('97000000-0000-4000-8000-000000000001', 'general', 'Replay series A', '09:00', ARRAY[1]::smallint[], CURRENT_DATE, 3),
       ('97000000-0000-4000-8000-000000000002', 'general', 'Replay series B', '11:00', ARRAY[3]::smallint[], CURRENT_DATE, 3)
     ON CONFLICT (id) DO NOTHING;
    `,
  ],
  [
    '20260916090000_department_rls_matrix_cutover.sql',
    `INSERT INTO public.departments(id, name, is_active)
     VALUES ('97000000-0000-4000-8000-000000000064', 'RLS replay fixture', true)
     ON CONFLICT (id) DO NOTHING;
     INSERT INTO public.department_access_permissions(
       department_id, subject_scope, resource_key, can_view, can_manage,
       factory_scope, company_view_scope, company_manage_scope
     )
     SELECT
       '97000000-0000-4000-8000-000000000064'::uuid,
       'member', resource_key, false, false, 'own', 'own', 'own'
     FROM unnest(ARRAY[${rlsManifest.resources.map((resource) => `'${resource.replaceAll("'", "''")}'`).join(', ')}]::text[]) AS resource_key
     ON CONFLICT (department_id, subject_scope, resource_key) DO NOTHING;
    `,
  ],
  [
    '20260923150000_sheet_scrap_orientation_reservation.sql',
    readFileSync(path.join(root, 'supabase', 'tests', 'sheet_scrap_orientation_legacy_cancelled_setup.sql'), 'utf8'),
  ],
  [
    '20260923152000_completion_sheet_scrap_detailing_dimensions.sql',
    readFileSync(path.join(root, 'supabase', 'tests', 'sheet_scrap_completion_legacy_approved_setup.sql'), 'utf8'),
  ],
])

console.log(`[full-schema-test] rebuilding local database ${databaseName}`)
run('dropdb', ['--if-exists', '--force', databaseName])
run('createdb', [databaseName])
runPsql('full_schema_test_bootstrap.sql', readFileSync(bootstrapPath, 'utf8'))

for (const migration of prismaMigrations) {
  const migrationPath = path.join(prismaMigrationsDir, migration, 'migration.sql')
  runPsql(
    `nesting-service/prisma/migrations/${migration}/migration.sql`,
    normalizeForLocalPostgres(readFileSync(migrationPath, 'utf8')),
  )
}

for (const migration of migrations) {
  const source = readFileSync(path.join(migrationsDir, migration), 'utf8')
  if (migration === '20260914120000_technologist_request_financial_approval.sql' && process.env.FINANCIAL_APPROVAL_LEGACY_FIXTURE === 'true') {
    runPsql('financial approval legacy fixture', readFileSync(path.join(root, 'supabase/tests/technologist_request_financial_approval_legacy_setup.sql'), 'utf8'))
  }
  if (migration === '20260917120000_technologist_approval_personal_workflow.sql' && process.env.FINANCIAL_APPROVAL_LEGACY_FIXTURE === 'true') {
    runPsql('returned approval backfill fixture', readFileSync(path.join(root, 'supabase/tests/technologist_request_financial_approval_returned_setup.sql'), 'utf8'))
  }
  const replayPrelude = replayPreludes.get(migration)
  if (replayPrelude) runPsql(`${migration} replay prelude`, replayPrelude)
  const normalizedSource = normalizeForLocalPostgres(source)
  const hasExplicitTransaction = /^\s*(?:--[^\n]*\n\s*)*BEGIN;/imu.test(normalizedSource)
  runPsql(migration, normalizedSource, !hasExplicitTransaction)
  if (migration === '20260923150000_sheet_scrap_orientation_reservation.sql') {
    runPsql('sheet orientation immutable history assertion', `
      do $$ begin
        if (select reserved_from_stock_kg from public.request_sheet_metal
            where id = '9f000000-0000-4000-8000-000000000008') is distinct from 0 then
          raise exception 'Cancelled sheet history was changed by reservation backfill';
        end if;
      end $$;
    `)
  }
  if (migration === '20260923152000_completion_sheet_scrap_detailing_dimensions.sql') {
    runPsql('approved completion waste basis and guard assertion', `
      do $$
      declare v_error text;
      begin
        if (select waste_basis_kg from public.technologist_request_waste_items
            where request_id = '9f000000-0000-4000-8000-000000000013') is distinct from 100 then
          raise exception 'Approved legacy waste basis was not backfilled';
        end if;
        begin
          update public.technologist_request_waste_items
          set item_name = 'Mutation must fail'
          where request_id = '9f000000-0000-4000-8000-000000000013';
          raise exception 'Approved waste guard was not restored';
        exception when others then
          get stacked diagnostics v_error = message_text;
          if v_error <> 'Одобренную заявку нельзя редактировать' then raise; end if;
        end;
      end $$;
    `)
  }
}

console.log(
  `[full-schema-test] applied ${prismaMigrations.length} Prisma and ${migrations.length} Supabase migrations`,
)
runPsql(
  'long_stock_supplier_schedule_guard_test.sql',
  readFileSync(longStockSupplierScheduleGuardPath, 'utf8'),
)
runPsql(
  'full_schema_inventory_transfer_compat.sql',
  readFileSync(transferCompatPath, 'utf8'),
)
if(process.env.FULL_SCHEMA_REPLAY_ONLY==='true')process.exit(0)

runPsql(
  'production_cutting_area_cancelled_requests_test.sql',
  readFileSync(cuttingAreaCancelledRequestsPath, 'utf8'),
)
run(process.execPath, [path.join(root, 'scripts', 'test-inventory-transfers.mjs')], {
  ...postgresEnv,
  INVENTORY_TRANSFER_TEST_DATABASE_URL: databaseUrl.toString(),
})

function normalizeForLocalPostgres(source) {
  return source
    .replace(/^\uFEFF/u, '')
    .replace(/^\s*SET transaction_timeout = 0;\s*$/gimu, '')
    .replace(/^\s*CREATE EXTENSION IF NOT EXISTS (?:pg_cron|pg_net);\s*$/gimu, '')
}

function runPsql(label, sql, singleTransaction = false) {
  const args = ['-X', '-v', 'ON_ERROR_STOP=1']
  if (singleTransaction) args.push('--single-transaction')
  args.push('-d', databaseName)
  const result = spawnSync('psql', args, {
    encoding: 'utf8',
    env: postgresEnv,
    input: sql,
  })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    throw new Error(`[full-schema-test] failed while applying ${label}`)
  }
}

function run(command, args, env = postgresEnv) {
  const result = spawnSync(command, args, { encoding: 'utf8', env, stdio: 'inherit' })
  assert.equal(result.status, 0, `${command} exited with status ${result.status}`)
}
