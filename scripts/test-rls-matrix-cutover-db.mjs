import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = new URL(
  process.env.RLS_CUTOVER_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test',
)

assert.equal(databaseUrl.protocol, 'postgresql:')
assert.ok(['localhost', '127.0.0.1'].includes(databaseUrl.hostname))
assert.match(databaseUrl.pathname.toLowerCase(), /test/)

const connection = databaseUrl.toString()
const migration = path.join(root, 'supabase/migrations/20260916090000_department_rls_matrix_cutover.sql')
const rollback = path.join(root, 'supabase/rollback/20260916090000_department_rls_matrix_cutover.sql')

function run(label, command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
    throw new Error(`${label} failed with status ${result.status}`)
  }
  return result.stdout.trim()
}

function query(sql) {
  return run('psql query', 'psql', ['-v', 'ON_ERROR_STOP=1', '-At', connection, '-c', sql])
}

function assertCutoverState() {
  const result = query(`
    SELECT concat_ws('|',
      (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public'
         AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
           ~* '(get_user_role\\s*\\(|is_director\\s*\\(|security_has_role\\s*\\(|security_can_|role_permissions|\\.role[[:space:]]*(=|<>|IN|=[[:space:]]*ANY))'),
      to_regprocedure('private.crm_has_permission(text,text)') IS NOT NULL,
      has_table_privilege('authenticated', 'public.role_permissions', 'SELECT'),
      has_column_privilege('authenticated', 'public.products', 'base_price_eur', 'SELECT'),
      has_column_privilege('authenticated', 'public.machine_items', 'price', 'SELECT'),
      has_column_privilege('authenticated', 'public.machine_expenses', 'amount', 'SELECT'),
      has_column_privilege('authenticated', 'public.machines_with_totals', 'total_cost', 'SELECT'),
      has_table_privilege('authenticated', 'public.client_product_prices', 'SELECT'),
      EXISTS (
        SELECT 1 FROM pg_class relation
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'machines_with_totals'
          AND 'security_invoker=true' = ANY(coalesce(relation.reloptions, ARRAY[]::text[]))
      ),
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'department_access_permissions_select_matrix'),
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'department_access_permissions_select_authenticated')
    );
  `)
  assert.equal(result, '0|t|f|f|f|f|f|f|t|1|0')
}

run(
  'full schema forward rehearsal',
  process.execPath,
  [path.join(root, 'scripts/test-inventory-transfers-full-schema.mjs')],
  { ...process.env, FULL_SCHEMA_TEST_DATABASE_URL: connection },
)
assertCutoverState()
run(
  'matrix permission scenarios',
  'psql',
  [
    '-v', 'ON_ERROR_STOP=1', connection,
    '-f', path.join(root, 'supabase/tests/rls_matrix_permissions_test.sql'),
  ],
)

run('rollback rehearsal', 'psql', ['-v', 'ON_ERROR_STOP=1', connection, '-f', rollback])
const rollbackState = query(`
  SELECT concat_ws('|',
    to_regprocedure('private.crm_has_permission(text,text)') IS NULL,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'department_access_permissions_select_authenticated'),
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'department_access_permissions_select_matrix'),
    position('app_user.role = ANY' in pg_get_functiondef('public.inventory_transfer_role_allowed(public.user_role[])'::regprocedure)) > 0
  );
`)
assert.equal(rollbackState, 't|1|0|t')

run('second forward rehearsal', 'psql', ['-v', 'ON_ERROR_STOP=1', connection, '-f', migration])
assertCutoverState()
run(
  'post-reapply inventory regression',
  process.execPath,
  [path.join(root, 'scripts/test-inventory-transfers.mjs')],
  { ...process.env, INVENTORY_TRANSFER_TEST_DATABASE_URL: connection },
)

console.log('RLS cutover DB rehearsal: forward -> rollback -> forward OK')
