import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const prismaMigrationsDir = path.join(root, 'nesting-service', 'prisma', 'migrations')
const bootstrapPath = path.join(root, 'supabase', 'tests', 'full_schema_test_bootstrap.sql')
const featureFlagAssertionsPath = path.join(root, 'supabase', 'tests', 'feature_flags_assertions.sql')
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

const migrations = migrationOrderFromGitHistory()
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
  'feature_flags_assertions.sql',
  readFileSync(featureFlagAssertionsPath, 'utf8'),
)
runPsql(
  'full_schema_inventory_transfer_compat.sql',
  readFileSync(transferCompatPath, 'utf8'),
)
run(process.execPath, [path.join(root, 'scripts', 'test-inventory-transfers.mjs')], {
  ...postgresEnv,
  INVENTORY_TRANSFER_TEST_DATABASE_URL: databaseUrl.toString(),
})

function compareMigrationNames(left, right) {
  if (left === '001_initial_schema.sql') return -1
  if (right === '001_initial_schema.sql') return 1

  const leftVersion = BigInt(left.split('_', 1)[0])
  const rightVersion = BigInt(right.split('_', 1)[0])
  if (leftVersion < rightVersion) return -1
  if (leftVersion > rightVersion) return 1
  return left.localeCompare(right, 'en')
}

function migrationOrderFromGitHistory() {
  const filesOnDisk = new Set(
    readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')),
  )
  const history = spawnSync('git', [
    'log', '--reverse', '--diff-filter=A', '--format=format:__COMMIT__', '--name-only',
    '--', 'supabase/migrations',
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(history.status, 0, 'Unable to read migration order from git history')

  const ordered = []
  const seen = new Set()
  let commitFiles = []
  const flushCommit = () => {
    for (const file of commitFiles.sort(compareMigrationNames)) {
      if (filesOnDisk.has(file) && !seen.has(file)) {
        ordered.push(file)
        seen.add(file)
      }
    }
    commitFiles = []
  }

  for (const line of history.stdout.split('\n')) {
    if (line === '__COMMIT__') {
      flushCommit()
    } else if (line.startsWith('supabase/migrations/') && line.endsWith('.sql')) {
      commitFiles.push(path.basename(line))
    }
  }
  flushCommit()

  for (const file of [...filesOnDisk].filter((item) => !seen.has(item)).sort(compareMigrationNames)) {
    ordered.push(file)
  }
  return ordered
}

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
