import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = new URL(
  process.env.FULL_SCHEMA_TEST_DATABASE_URL ?? 'postgresql://localhost/crm_full_schema_test',
)

assert.equal(databaseUrl.protocol, 'postgresql:', 'FULL_SCHEMA_TEST_DATABASE_URL must use postgresql://')
assert.ok(
  ['localhost', '127.0.0.1'].includes(databaseUrl.hostname),
  'Third-review tests only use localhost or 127.0.0.1',
)
assert.ok(
  decodeURIComponent(databaseUrl.pathname.slice(1)).toLowerCase().includes('test'),
  'Test database name must contain "test"',
)

const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8')
const inventoryAction = read('src/lib/actions/inventory.ts')
const supplyAction = read('src/lib/actions/supply-request.ts')
const supplyOrderAction = read('src/lib/actions/supply-orders.ts')
const productionFactAction = read('src/lib/actions/production-fact.ts')
const secureRpc = read('src/lib/inventory/secure-rpc.ts')
const inventoryPage = read('src/components/features/inventory/InventoryPage.tsx')
const supplyOrderItem = read('src/components/features/supply-orders/OrderItemRow.tsx')
const reservationIntegrityMigration = read('supabase/migrations/20260823150000_long_stock_reservation_integrity.sql')

assert.match(
  supplyAction,
  /function isWholeBarRequest[\s\S]*table === 'request_knives'[\s\S]*use_cut_reservation: false[\s\S]*use_whole_bar_reservation: usesWholeBarStock/u,
  'Knife stock reservations must use whole-bar routing instead of cut reservations',
)
assert.match(
  supplyOrderItem,
  /lengthStockItems\.find\(\(row\) => row\.id === inventoryRowId\)[\s\S]*inventory_id: selectedStockItem\?\.id[\s\S]*use_whole_bar_reservation: selectedStockItem !== null/u,
  'Supply-order reservation must preserve the exact inventory-row identity',
)
assert.match(
  supplyOrderAction,
  /\.is\('deleted_at', null\)[\s\S]*\.eq\('business_scrap_state', 'available'\)[\s\S]*\.eq\('is_business_scrap', false\)/u,
  'Supply-order stock choices must exclude deleted, future and business-scrap rows',
)
const reserveAction = inventoryAction.slice(inventoryAction.indexOf('export async function reserveForMachine'))
assert.ok(
  reserveAction.indexOf('await assertInventoryReservationAccess')
    < reserveAction.indexOf('data.use_inventory_transfer'),
  'Inter-factory routing must validate machine/request/factory access before its RPC branch',
)
assert.doesNotMatch(
  inventoryAction,
  /\.rpc\(\s*['"](?:fn_reserve_inventory_for_machine|fn_reserve_inventory_row_for_machine|fn_reserve_inventory_row_for_machine_transfer|fn_reserve_whole_bar_inventory_row_for_machine_transfer|fn_adjust_inventory_record|fn_archive_inventory_item)['"]/u,
  'Closed inventory RPCs must not be called through the authenticated action client',
)
for (const functionName of [
  'reserveInventoryForMachine',
  'reserveInventoryRowForMachine',
  'reserveInventoryRowForMachineTransfer',
  'reserveWholeBarInventoryForMachineTransfer',
  'adjustInventoryRecord',
  'archiveInventoryItem',
]) {
  assert.match(secureRpc, new RegExp(`export async function ${functionName}\\b`, 'u'))
}
assert.match(
  productionFactAction,
  /deleteProductionMachineFact[\s\S]*fn_delete_production_machine_fact_atomic_v1/u,
  'Fact deletion must use one atomic RPC',
)
assert.doesNotMatch(
  productionFactAction.slice(productionFactAction.indexOf('export async function deleteProductionMachineFact')),
  /from\('production_machine_facts'\)\.delete\(\)/u,
  'Fact action must not delete the row before rollback task creation',
)
assert.match(
  inventoryPage,
  /disabled=\{adjustRow\.piece_length_mm !== null\}[\s\S]*Рассчитывается автоматически/u,
  'Measured-row total input must be locked and described as calculated',
)
assert.match(
  reservationIntegrityMigration,
  /fn_reserve_long_stock_plan_inventory_v1[\s\S]*bar\.stock_length_mm = v_anchor\.piece_length_mm[\s\S]*v_remaining_piece_count/u,
  'Approved-plan reservations must use exact bar lengths and physical counts',
)
assert.match(
  reservationIntegrityMigration,
  /fn_apply_long_stock_cutting_fact_v1[\s\S]*v_matched_piece_count is distinct from v_event_piece_count/u,
  'Cutting facts must reject a physical composition that does not match the approved map',
)

run(process.execPath, [path.join(root, 'scripts', 'test-inventory-transfers-full-schema.mjs')])
runPsqlFile('supabase/tests/long_stock_third_review_fixes_test.sql')
runPsqlFile('supabase/tests/long_stock_cutting_plan_schema_test.sql')

for (const [functionName, statement] of [
  [
    'fn_reserve_inventory_for_machine',
    `select public.fn_reserve_inventory_for_machine(
      gen_random_uuid(), gen_random_uuid(), 1, 'request_components',
      gen_random_uuid(), gen_random_uuid(), null, null, null
    );`,
  ],
  [
    'fn_reserve_inventory_row_for_machine',
    `select public.fn_reserve_inventory_row_for_machine(
      gen_random_uuid(), gen_random_uuid(), 1, 'request_components',
      gen_random_uuid(), gen_random_uuid(), null, false
    );`,
  ],
  [
    'fn_adjust_inventory_record',
    `select public.fn_adjust_inventory_record(
      gen_random_uuid(), 1, gen_random_uuid(), 'unauthorized', null
    );`,
  ],
  [
    'fn_archive_inventory_item',
    `select public.fn_archive_inventory_item(
      gen_random_uuid(), gen_random_uuid(), 'unauthorized'
    );`,
  ],
  [
    'fn_reserve_inventory_row_for_machine_transfer',
    `select public.fn_reserve_inventory_row_for_machine_transfer(
      gen_random_uuid(), gen_random_uuid(), 1, 'request_components',
      gen_random_uuid(), gen_random_uuid(), null, false
    );`,
  ],
  [
    'fn_reserve_whole_bar_inventory_row_for_machine_transfer',
    `select public.fn_reserve_whole_bar_inventory_row_for_machine_transfer(
      gen_random_uuid(), gen_random_uuid(), 1, 'request_knives',
      gen_random_uuid(), gen_random_uuid()
    );`,
  ],
]) {
  assertAuthenticatedDenied(functionName, statement)
}

const overloadAudit = runPsql(`
select jsonb_build_object(
  'old_seven_arg_exists', to_regprocedure(
    'public.fn_reserve_inventory_for_machine(uuid,uuid,numeric,text,uuid,uuid,numeric)'
  ) is not null,
  'authenticated_overloads', coalesce((
    select jsonb_agg(procedure.proname || '(' || pg_get_function_identity_arguments(procedure.oid) || ')')
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'fn_reserve_inventory_for_machine',
        'fn_reserve_inventory_for_machine_before_long_stock_map_v1',
        'fn_reserve_inventory_row_for_machine',
        'fn_reserve_inventory_row_for_machine_before_long_stock_map_v1',
        'fn_reserve_inventory_row_for_machine_transfer',
        'fn_reserve_inventory_row_transfer_pre_map_v1',
        'fn_adjust_inventory_record',
        'fn_archive_inventory_item',
        'fn_reserve_whole_bar_inventory_row_for_machine',
        'fn_reserve_whole_bar_inventory_row_before_plan_integrity_v1',
        'fn_reserve_whole_bar_inventory_row_for_machine_transfer',
        'fn_reserve_whole_bar_row_transfer_pre_plan_v1',
        'fn_unreserve_inventory_reservation',
        'fn_unreserve_inventory_reservation_before_whole_bar',
        'fn_promote_due_future_business_scrap'
      ])
      and has_function_privilege('authenticated', procedure.oid, 'execute')
  ), '[]'::jsonb),
  'service_role_internal_functions', coalesce((
    select jsonb_agg(procedure.proname order by procedure.proname)
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'fn_reserve_inventory_for_machine_before_long_stock_map_v1',
        'fn_reserve_inventory_row_for_machine_before_long_stock_map_v1',
        'fn_reserve_inventory_row_transfer_pre_map_v1',
        'fn_reserve_whole_bar_inventory_row_before_plan_integrity_v1',
        'fn_reserve_whole_bar_row_transfer_pre_plan_v1',
        'fn_apply_long_stock_fact_pre_reservation_guard_v1'
      ])
      and has_function_privilege('service_role', procedure.oid, 'execute')
  ), '[]'::jsonb)
);
`)
assert.deepEqual(JSON.parse(overloadAudit.trim()), {
  old_seven_arg_exists: false,
  authenticated_overloads: [],
  service_role_internal_functions: [],
})

console.log('[long-stock-third-review-fixes] all assertions passed')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: 'inherit',
  })
  assert.equal(result.status, 0, `${path.basename(command)} exited with status ${result.status}`)
}

function psqlEnvironment() {
  const env = { ...process.env }
  delete env.PGDATABASE
  env.PGHOST = databaseUrl.hostname
  env.PGPORT = databaseUrl.port || '5432'
  env.PGSSLMODE = databaseUrl.searchParams.get('sslmode') || 'disable'
  if (databaseUrl.username) env.PGUSER = decodeURIComponent(databaseUrl.username)
  if (databaseUrl.password) env.PGPASSWORD = decodeURIComponent(databaseUrl.password)
  return env
}

function runPsqlFile(relativePath) {
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-d', decodeURIComponent(databaseUrl.pathname.slice(1)),
    '-f', path.join(root, relativePath),
  ], {
    cwd: root,
    env: psqlEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '')
    process.stderr.write(result.stderr || '')
  }
  assert.equal(result.status, 0, `${relativePath} failed`)
  process.stdout.write(result.stdout || '')
}

function runPsql(sql) {
  const result = spawnSync('psql', [
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-d', decodeURIComponent(databaseUrl.pathname.slice(1)),
  ], {
    cwd: root,
    env: psqlEnvironment(),
    encoding: 'utf8',
    input: sql,
  })
  assert.equal(result.status, 0, result.stderr || 'psql command failed')
  return result.stdout
}

function assertAuthenticatedDenied(functionName, statement) {
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1',
    '-d', decodeURIComponent(databaseUrl.pathname.slice(1)),
  ], {
    cwd: root,
    env: psqlEnvironment(),
    encoding: 'utf8',
    input: `begin;\nset local role authenticated;\n${statement}\nrollback;\n`,
  })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  assert.notEqual(result.status, 0, `${functionName} must reject authenticated callers`)
  assert.match(
    output,
    new RegExp(`permission denied for function ${functionName}`, 'iu'),
    `${functionName} failed for a reason other than its EXECUTE boundary`,
  )
}
