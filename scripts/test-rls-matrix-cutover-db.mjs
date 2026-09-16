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
const draftVisibilityFix = path.join(root, 'supabase/migrations/20260916103000_fix_technologist_request_draft_visibility.sql')

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
      has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)', 'EXECUTE'),
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
  assert.equal(result, '0|t|f|f|f|f|f|f|t|t|f|f|t|1|0')
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
run(
  'supply orders and inventory visibility scenarios',
  'psql',
  [
    '-v', 'ON_ERROR_STOP=1', connection,
    '-f', path.join(root, 'supabase/tests/rls_supply_orders_inventory_visibility_test.sql'),
  ],
)
run(
  'technologist request draft visibility scenarios',
  'psql',
  [
    '-v', 'ON_ERROR_STOP=1', connection,
    '-f', path.join(root, 'supabase/tests/rls_technologist_request_draft_visibility_test.sql'),
  ],
)

run('rollback rehearsal', 'psql', ['-v', 'ON_ERROR_STOP=1', connection, '-f', rollback])
const rollbackState = query(`
  SELECT concat_ws('|',
    to_regprocedure('private.crm_has_permission(text,text)') IS NULL,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'department_access_permissions_select_authenticated'),
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'department_access_permissions_select_matrix'),
    has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_v3(uuid,uuid,numeric,jsonb,numeric,numeric,text)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.fn_receive_supply_order_schedule_batch_v2(jsonb,uuid,text)', 'EXECUTE'),
    position('app_user.role = ANY' in pg_get_functiondef('public.inventory_transfer_role_allowed(public.user_role[])'::regprocedure)) > 0
  );
`)
assert.equal(rollbackState, 't|1|0|f|f|t')

const compatibilityScopeState = query(`
  WITH updated AS (
    UPDATE public.department_access_permissions
    SET can_view = true,
        factory_scope = 'all'
    WHERE department_id = '97000000-0000-4000-8000-000000000064'::uuid
      AND subject_scope = 'member'
      AND resource_key = 'production_reports'
    RETURNING factory_scope
  ), audited AS (
    INSERT INTO public.department_access_audit_log(
      department_id, subject_scope, resource_key,
      old_can_view, old_can_manage, new_can_view, new_can_manage,
      old_factory_scope, new_factory_scope
    )
    SELECT
      '97000000-0000-4000-8000-000000000064'::uuid,
      'member', 'production_reports',
      false, false, true, false,
      'own', 'all'
    FROM updated
    RETURNING new_factory_scope
  )
  SELECT concat_ws('|',
    (SELECT factory_scope FROM updated),
    (SELECT new_factory_scope FROM audited),
    position('production_reports' in pg_get_constraintdef(
      (SELECT oid FROM pg_constraint
       WHERE conrelid = 'public.department_access_permissions'::regclass
         AND conname = 'department_access_permissions_factory_scope_check')
    )) > 0,
    position('production_fact' in pg_get_constraintdef(
      (SELECT oid FROM pg_constraint
       WHERE conrelid = 'public.department_access_permissions'::regclass
         AND conname = 'department_access_permissions_factory_scope_check')
    )) > 0,
    position('''supply''' in pg_get_constraintdef(
      (SELECT oid FROM pg_constraint
       WHERE conrelid = 'public.department_access_permissions'::regclass
         AND conname = 'department_access_permissions_factory_scope_check')
    )) > 0
  );
`)
assert.equal(compatibilityScopeState, 'all|all|t|t|f')

run('second forward rehearsal', 'psql', ['-v', 'ON_ERROR_STOP=1', connection, '-f', migration])
run('draft visibility follow-up rehearsal', 'psql', ['-v', 'ON_ERROR_STOP=1', connection, '-f', draftVisibilityFix])
assertCutoverState()
run(
  'post-reapply draft visibility scenarios',
  'psql',
  [
    '-v', 'ON_ERROR_STOP=1', connection,
    '-f', path.join(root, 'supabase/tests/rls_technologist_request_draft_visibility_test.sql'),
  ],
)
run(
  'post-reapply inventory regression',
  process.execPath,
  [path.join(root, 'scripts/test-inventory-transfers.mjs')],
  { ...process.env, INVENTORY_TRANSFER_TEST_DATABASE_URL: connection },
)

console.log('RLS cutover DB rehearsal: forward -> rollback -> forward OK')
