import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

if (!process.env.TEST_DATABASE_URL) {
  console.log('[product-project-mail-db] skipped: TEST_DATABASE_URL is not set')
  process.exit(0)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const adminUrl = new URL(process.env.TEST_DATABASE_URL)
assert.equal(adminUrl.protocol, 'postgresql:', 'TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(adminUrl.hostname),
  'Product-project mail DB tests only use localhost or 127.0.0.1',
)

const databaseName = `product_project_mail_test_${process.pid}_${Date.now()}`
const databaseUrl = new URL(adminUrl)
databaseUrl.pathname = `/${databaseName}`

run('createdb', ['--maintenance-db', adminUrl.toString(), databaseName])
try {
  run('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(),
    '-f', path.join(root, 'supabase/tests/product_project_mail_versions_setup.sql'),
  ])

  const recursiveInsert = runResult('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(),
  ], String.raw`
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false);
    INSERT INTO public.product_project_mail_threads(
      product_project_id, thread_id, linked_by
    ) VALUES (
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000001'
    );
  `)
  assert.notEqual(recursiveInsert.status, 0, 'regression setup did not reproduce recursive RLS')
  assert.match(
    `${recursiveInsert.stdout}\n${recursiveInsert.stderr}`,
    /infinite recursion detected in policy/u,
    'the reproduced failure was not the expected recursive RLS error',
  )

  run('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(),
    '-f', path.join(root, 'supabase/migrations/20260906120000_product_project_mail_versions.sql'),
  ])
  run('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1', databaseUrl.toString(),
    '-f', path.join(root, 'supabase/tests/product_project_mail_versions_test.sql'),
  ])

  console.log('[product-project-mail-db] RLS, atomic mail, correction and version assertions passed')
} finally {
  run('dropdb', ['--if-exists', '--maintenance-db', adminUrl.toString(), databaseName])
}

function run(command, args, input) {
  const result = runResult(command, args, input)
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}

function runResult(command, args, input) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    input,
    env: process.env,
  })
}
