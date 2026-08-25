import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseUrl = process.env.TEST_DATABASE_URL

if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const parsedUrl = new URL(databaseUrl)
const isLocalHost = parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === 'localhost'
const isTestDatabase = parsedUrl.pathname.toLowerCase().includes('test')
if (!isLocalHost || !isTestDatabase) {
  throw new Error('Inventory integration tests only run against a local database whose name contains "test"')
}

const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), 'utf8')

function extractFunction(source, qualifiedName) {
  const startNeedle = `CREATE OR REPLACE FUNCTION ${qualifiedName}(`
  const start = source.indexOf(startNeedle)
  if (start < 0) throw new Error(`Function ${qualifiedName} was not found`)

  const bodyStart = source.indexOf('AS $$', start)
  if (bodyStart < 0) throw new Error(`Function body for ${qualifiedName} was not found`)

  const legacyEndNeedle = '$$ LANGUAGE plpgsql SECURITY DEFINER;'
  const modernEndNeedle = '\n$$;'
  const legacyEnd = source.indexOf(legacyEndNeedle, bodyStart + 5)
  const modernEnd = source.indexOf(modernEndNeedle, bodyStart + 5)
  const candidates = [
    legacyEnd >= 0 ? legacyEnd + legacyEndNeedle.length : -1,
    modernEnd >= 0 ? modernEnd + modernEndNeedle.length : -1,
  ].filter((value) => value >= 0)

  if (candidates.length === 0) throw new Error(`Function end for ${qualifiedName} was not found`)
  return source.slice(start, Math.min(...candidates))
}

const factoryMigration = read('supabase/migrations/20260626153000_inventory_factory_scope.sql')
const cutMigration = read('supabase/migrations/90_reapply_cut_reservation_functions.sql')
const chainCordMigration = read('supabase/migrations/20260712125529_normalize_chain_cord_inventory_mm.sql')
const deliveredSupplyCuttingMigration = read('supabase/migrations/20260712152924_auto_reserve_delivered_supply_for_cutting.sql')
const supplyReceiptPriorityMigration = read('supabase/migrations/20260714101554_supply_receipt_priority_allocation.sql')
const knifeSupplyFutureScrapMigration = read('supabase/migrations/20260714120049_knife_supply_future_scrap.sql')
const barReceivingLifecycleMigration = read('supabase/migrations/20260730133000_bar_receiving_lifecycle.sql')
const wholeBarCirclePipeMigration = read('supabase/migrations/20260731120000_whole_bar_circle_pipe_lifecycle.sql')
const measuredInventoryUnitsMigration = read('supabase/migrations/20260825120000_normalize_measured_inventory_units.sql')
const permissionIntegrityMigration = read('supabase/migrations/20260823130000_long_stock_permission_integrity.sql')
const archiveScrapMigration = read('supabase/migrations/92_archive_empty_business_scrap_on_unreserve.sql')

const legacyInvalidKnifeVariantFixture = `
INSERT INTO public.materials (id, category)
VALUES ('76000000-0000-0000-0000-000000000001', 'knives');
INSERT INTO public.material_variants (
  id, material_id, category, knife_bevel_count, default_unit
) VALUES (
  '76000000-0000-0000-0000-000000000002',
  '76000000-0000-0000-0000-000000000001',
  'knives',
  NULL,
  'шт'
);
ALTER TABLE public.material_variants
  ADD CONSTRAINT material_variants_knife_bevel_count_check
  CHECK (
    (category = 'knives' AND knife_bevel_count IS NOT NULL AND knife_bevel_count IN (1, 2))
    OR (category <> 'knives' AND knife_bevel_count IS NULL)
  ) NOT VALID;
`

const closedRpcCallPattern = /\.rpc\(\s*['"](?:fn_reserve_whole_bar_inventory_row_for_machine|fn_reserve_whole_bar_inventory_row_for_machine_transfer|fn_reserve_inventory_for_machine|fn_reserve_inventory_row_for_machine|fn_reserve_inventory_row_for_machine_transfer|fn_adjust_inventory_record|fn_archive_inventory_item|fn_unreserve_inventory_reservation|fn_promote_due_future_business_scrap)['"]/u
const secureRpcSource = read('src/lib/inventory/secure-rpc.ts')
assert.match(secureRpcSource, /import 'server-only'/u)
assert.match(secureRpcSource, /createAdminClient\(\)/u)
assert.match(secureRpcSource, /getCurrentUserContext\(\)/u)
assert.match(secureRpcSource, /p_reserved_by: actorId/u)
assert.match(secureRpcSource, /p_performed_by: actorId/u)
assert.doesNotMatch(secureRpcSource, /actorId:\s*string/u)
for (const file of [
  'src/lib/actions/inventory.ts',
  'src/lib/actions/production.ts',
  'src/lib/actions/production-plan.ts',
  'src/lib/actions/technologist-requests.ts',
  'src/app/(protected)/sales-plan/actions.ts',
]) {
  assert.doesNotMatch(
    read(file),
    closedRpcCallPattern,
    `${file} must call closed inventory RPCs only through the server-only service-role boundary`,
  )
}
const inventoryAction = read('src/lib/actions/inventory.ts')
assert.match(
  inventoryAction,
  /assertInventoryReservationAccess\(db, access,[\s\S]*reserveWholeBarInventoryForMachine\(/u,
  'Whole-bar reservation must validate the visible machine, factory and request before the service-role call',
)
assert.match(
  inventoryAction,
  /if \(!reservation\) throw new Error\('Бронь не найдена или доступ запрещён'\)[\s\S]*assertMachineAccess\(db, access, reservation\.machine_id\)[\s\S]*unreserveInventoryReservation\(/u,
  'Unreserve must reject an invisible reservation before the service-role call',
)
assert.match(
  read('src/lib/actions/technologist-requests.ts'),
  /assertFactoryAccess\(access, 'technologist_requests', 'manage', machine\.factory_id\)[\s\S]*unreserveInventoryReservation\(/u,
  'Request-row deletion must validate machine factory scope before the service-role unreserve call',
)
assert.match(
  read('src/app/(protected)/sales-plan/actions.ts'),
  /assertSalesPlanMachineAccess\(db, permission, id\)[\s\S]*deleteMachineWithInventoryCleanup\(/u,
  'Machine deletion must validate factory scope before cleanup can unreserve inventory',
)

const sql = [
  '\\set ON_ERROR_STOP on',
  read('supabase/tests/inventory_stock_lifecycle_setup.sql'),
  'BEGIN;',
  chainCordMigration,
  'COMMIT;',
  extractFunction(factoryMigration, 'public.fn_upsert_inventory_stock'),
  extractFunction(factoryMigration, 'public.fn_add_inventory_receipt'),
  extractFunction(cutMigration, 'fn_insert_cut_reservation'),
  extractFunction(factoryMigration, 'public.fn_reserve_inventory_row_for_machine'),
  extractFunction(factoryMigration, 'public.fn_unreserve_inventory_reservation'),
  archiveScrapMigration,
  deliveredSupplyCuttingMigration,
  supplyReceiptPriorityMigration,
  knifeSupplyFutureScrapMigration,
  barReceivingLifecycleMigration,
  wholeBarCirclePipeMigration,
  permissionIntegrityMigration,
  legacyInvalidKnifeVariantFixture,
  measuredInventoryUnitsMigration,
  read('supabase/tests/inventory_stock_lifecycle_assertions.sql'),
].join('\n\n')

const tempDir = mkdtempSync(path.join(tmpdir(), 'inventory-stock-test-'))
const sqlPath = path.join(tempDir, 'test.sql')

try {
  writeFileSync(sqlPath, sql)
  const result = spawnSync('psql', [databaseUrl, '-f', sqlPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  if (result.status !== 0) {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }

  process.stdout.write(result.stdout)
  assertAuthenticatedRpcDenied(
    'fn_reserve_whole_bar_inventory_row_for_machine',
    `select public.fn_reserve_whole_bar_inventory_row_for_machine(
      gen_random_uuid(), gen_random_uuid(), 1, 'request_circle', gen_random_uuid(), gen_random_uuid()
    );`,
  )
  assertAuthenticatedRpcDenied(
    'fn_unreserve_inventory_reservation',
    `select public.fn_unreserve_inventory_reservation(
      gen_random_uuid(), gen_random_uuid(), 'unauthorized direct call'
    );`,
  )
  assertAuthenticatedRpcDenied(
    'fn_unreserve_inventory_reservation_before_whole_bar',
    `select public.fn_unreserve_inventory_reservation_before_whole_bar(
      gen_random_uuid(), gen_random_uuid(), 'unauthorized direct call'
    );`,
  )
  assertAuthenticatedRpcDenied(
    'fn_promote_due_future_business_scrap',
    'select public.fn_promote_due_future_business_scrap(current_date + 30);',
  )
  assertServiceRoleRpcPrivileges()
  assertServiceRoleRpcWorkflow()
  console.log('Inventory stock lifecycle tests passed')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}

function assertAuthenticatedRpcDenied(functionName, statement) {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1'], {
    cwd: repoRoot,
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

function assertServiceRoleRpcPrivileges() {
  const result = spawnSync('psql', [databaseUrl, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: `select
      has_function_privilege(
        'service_role',
        'public.fn_reserve_whole_bar_inventory_row_for_machine(uuid,uuid,numeric,text,uuid,uuid)',
        'EXECUTE'
      )
      and has_function_privilege(
        'service_role',
        'public.fn_unreserve_inventory_reservation(uuid,uuid,text)',
        'EXECUTE'
      )
      and has_function_privilege(
        'service_role',
        'public.fn_promote_due_future_business_scrap(date)',
        'EXECUTE'
      );\n`,
  })
  assert.equal(result.status, 0, result.stderr || 'Unable to inspect service-role RPC privileges')
  assert.equal(result.stdout.trim(), 't', 'Closed inventory RPCs must remain executable by service_role')
}

function assertServiceRoleRpcWorkflow() {
  const result = spawnSync('psql', [databaseUrl, '-X', '-v', 'ON_ERROR_STOP=1'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: `begin;
set local role service_role;
select public.fn_reserve_whole_bar_inventory_row_for_machine(
  '70000000-0000-0000-0000-000000000008',
  '70000000-0000-0000-0000-000000000005',
  2000,
  'request_circle',
  '70000000-0000-0000-0000-000000000007',
  '70000000-0000-0000-0000-000000000001'
) as reservation_id \\gset
select public.fn_unreserve_inventory_reservation(
  :'reservation_id'::uuid,
  '70000000-0000-0000-0000-000000000001',
  'service-role application boundary test'
);
select public.fn_promote_due_future_business_scrap(current_date);
rollback;
`,
  })
  assert.equal(
    result.status,
    0,
    result.stderr || 'Closed inventory RPC workflow must work through the service-role application boundary',
  )
}
