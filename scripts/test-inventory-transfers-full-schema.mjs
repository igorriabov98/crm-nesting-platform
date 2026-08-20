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
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test',
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

const migrations = orderSupabaseMigrationFiles(listSupabaseMigrationFiles(migrationsDir))
const prismaMigrations = readdirSync(prismaMigrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
const replayPreludes = new Map([
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
  const replayPrelude = replayPreludes.get(migration)
  if (replayPrelude) runPsql(`${migration} replay prelude`, replayPrelude)
  const normalizedSource = normalizeForLocalPostgres(source)
  const hasExplicitTransaction = /^\s*(?:--[^\n]*\n\s*)*BEGIN;/imu.test(normalizedSource)
  runPsql(migration, normalizedSource, !hasExplicitTransaction)
}

console.log(
  `[full-schema-test] applied ${prismaMigrations.length} Prisma and ${migrations.length} Supabase migrations`,
)
runPsql(
  'full_schema_inventory_transfer_compat.sql',
  readFileSync(transferCompatPath, 'utf8'),
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
