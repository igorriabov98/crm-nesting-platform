import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PERMISSION_RESOURCES } from '../src/lib/permissions/resources'

type TableMapping = {
  view: string[]
  manage: string[]
  scope: string
}

type Manifest = {
  schemaVersion: number
  resources: string[]
  tables: Record<string, TableMapping>
}

type PolicySnapshot = {
  count: number
  policies: Array<{ tablename: string; roles?: string }>
}

const root = process.cwd()
const manifest = JSON.parse(readFileSync(join(root, 'config/rls-resource-manifest.json'), 'utf8')) as Manifest
const direct = JSON.parse(readFileSync(join(root, 'supabase/reports/rls_legacy_policy_snapshot.json'), 'utf8')) as PolicySnapshot
const dependencies = JSON.parse(readFileSync(join(root, 'supabase/reports/rls_legacy_policy_dependency_snapshot.json'), 'utf8')) as PolicySnapshot
const affected = JSON.parse(readFileSync(join(root, 'supabase/reports/rls_dependency_affected_tables_policy_snapshot.json'), 'utf8')) as PolicySnapshot
const migrationPath = join(root, 'supabase/migrations/20260916090000_department_rls_matrix_cutover.sql')
const rollbackPath = join(root, 'supabase/rollback/20260916090000_department_rls_matrix_cutover.sql')
const factoryScopeCompatibilityPath = join(
  root,
  'supabase/migrations/20260916083000_expand_department_access_factory_scope.sql',
)
const technologistReservationMigrationPath = join(
  root,
  'supabase/migrations/20260920220000_technologist_reservations_projects_password.sql',
)
const draftVisibilityFixPath = join(
  root,
  'supabase/migrations/20260916103000_fix_technologist_request_draft_visibility.sql',
)
const usersSelfVisibilityFixPath = join(
  root,
  'supabase/migrations/20260917050000_fix_users_self_visibility.sql',
)
const migration = readFileSync(migrationPath, 'utf8')
const rollback = readFileSync(rollbackPath, 'utf8')
const factoryScopeCompatibility = readFileSync(factoryScopeCompatibilityPath, 'utf8')
const draftVisibilityFix = readFileSync(draftVisibilityFixPath, 'utf8')
const usersSelfVisibilityFix = readFileSync(usersSelfVisibilityFixPath, 'utf8')
const policySnapshotPath = join(root, 'supabase/reports/rls_dependency_affected_tables_policy_snapshot.json')
const functionSnapshotPath = join(root, 'supabase/reports/rls_legacy_function_snapshot.json')

const codeResources = PERMISSION_RESOURCES.map(({ key }) => key).sort()
assert.deepEqual([...manifest.resources].sort(), codeResources, 'Manifest должен содержать ровно 64 runtime-ресурса')
assert.equal(new Set(manifest.resources).size, manifest.resources.length, 'Ресурсы manifest не должны повторяться')

const policyTables = [...new Set(affected.policies.map(({ tablename }) => tablename))].sort()
assert.deepEqual(Object.keys(manifest.tables).sort(), policyTables, 'Каждая затронутая RLS-таблица должна иметь назначение права')
assert.equal(direct.count, 223, 'Снимок прямых legacy-политик изменился — требуется повторный аудит production')
assert.equal(dependencies.count, 298, 'Снимок зависимостей legacy-функций изменился — требуется повторный аудит production')
assert.equal(policyTables.length, 140, 'Cutover должен покрывать все 140 затронутых таблиц')

const validResources = new Set(manifest.resources)
for (const [table, mapping] of Object.entries(manifest.tables)) {
  assert(mapping.view.length > 0, `${table}: не назначено право view`)
  assert(mapping.manage.length > 0, `${table}: не назначено право manage`)
  for (const resource of [...mapping.view, ...mapping.manage]) {
    assert(validResources.has(resource), `${table}: неизвестный ресурс ${resource}`)
  }
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const policyChecksum = sha256(policySnapshotPath)
const functionChecksum = sha256(functionSnapshotPath)
assert.match(migration, new RegExp(`-- snapshot-sha256: ${policyChecksum}`), 'Cutover checksum не совпадает со snapshot policies')
assert.match(rollback, new RegExp(`-- policy-snapshot-sha256: ${policyChecksum}`), 'Rollback checksum policies устарел')
assert.match(rollback, new RegExp(`-- function-snapshot-sha256: ${functionChecksum}`), 'Rollback checksum functions устарел')

const advisoryIndex = migration.indexOf('pg_advisory_xact_lock')
const lockIndex = migration.indexOf('-- generated-cutover-locks:start')
const firstDdlIndex = migration.indexOf('CREATE SCHEMA IF NOT EXISTS private')
assert(advisoryIndex > migration.indexOf('BEGIN;'), 'Advisory lock должен быть внутри транзакции')
assert(lockIndex > advisoryIndex && firstDdlIndex > lockIndex, 'Все затронутые таблицы должны блокироваться до первого DDL')
assert.match(migration, /SET LOCAL lock_timeout = '5s'/)
assert.match(migration, /SET LOCAL statement_timeout = '15min'/)
assert.match(migration, /CREATE TABLE IF NOT EXISTS private\.rls_cutover_object_snapshot/)
assert.match(migration, /ALTER VIEW public\.machines_with_totals SET \(security_invoker = true\)/)
assert.match(migration, /REVOKE SELECT, INSERT, UPDATE ON public\.products FROM authenticated/)
assert.match(migration, /column_name <> 'base_price_eur'/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_get_product_base_prices/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_set_product_base_price/)
assert.match(migration, /fn_user_can_manage_client_prices[\s\S]*FROM public\.users actor[\s\S]*price_permission\.company_manage_scope = 'all'/)
assert.doesNotMatch(migration, /fn_user_can_manage_client_prices[\s\S]{0,500}p_actor = auth\.uid\(\)/)
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fn_save_department_access_permissions/)
assert.match(migration, /INSERT INTO public\.department_access_audit_log/)
assert.match(migration, /Expected 64 matrix resources/)
assert.match(migration, /Cutover left % legacy authorization policies/)
assert.match(migration, /Cutover left % authenticated legacy authorization functions/)

const generatedMarker = '-- Remaining policy/RPC replacements and the transactional invariants are\n-- generated below from the checked-in production catalog snapshot.'
const generatedStart = migration.indexOf(generatedMarker)
const generatedEnd = migration.indexOf('-- snapshot-sha256:', generatedStart)
assert(generatedStart >= 0 && generatedEnd > generatedStart, 'Не найден сгенерированный policy-блок')
const generatedPolicyStart = migration.indexOf('\nDROP POLICY IF EXISTS', generatedStart)
assert(generatedPolicyStart > generatedStart, 'Не найдено начало сгенерированных policies')
const generatedPolicies = migration.slice(generatedPolicyStart, generatedEnd)
const userPolicies = affected.policies.filter((policy) => !policy.roles?.includes('service_role')).length
assert.equal((generatedPolicies.match(/CREATE POLICY /g) || []).length, userPolicies, 'Сгенерированы не все пользовательские affected policies')
for (const forbidden of [
  /get_user_role\s*\(/i,
  /is_director\s*\(/i,
  /security_has_role\s*\(/i,
  /security_can_/i,
  /\.role\s*(?:=|<>|IN|=\s*ANY)/i,
  /USING\s*\(true\)/i,
]) {
  assert(!forbidden.test(generatedPolicies), `Policy-блок содержит запрещённую конструкцию ${forbidden}`)
}

const inventorySelectPolicy = generatedPolicies.match(
  /CREATE POLICY "Inventory read supply roles"[\s\S]*?;/,
)?.[0] || ''
assert.match(inventorySelectPolicy, /crm_has_permission\('inventory', 'view'\)/,
  'Склад должен открываться по inventory/view')
assert.doesNotMatch(inventorySelectPolicy, /crm_has_permission\('inventory', 'manage'\)/,
  'Чтение склада не должно требовать inventory/manage')

const supplyItemVisibilityPolicy = generatedPolicies.match(
  /CREATE POLICY "financial_supply_item_visibility" ON public\."request_components"[\s\S]*?;/,
)?.[0] || ''
assert.match(supplyItemVisibilityPolicy, /fn_financial_supply_visibility\(request_id\)/,
  'Restrictive lifecycle-политика позиций должна сохраняться')
assert.doesNotMatch(supplyItemVisibilityPolicy, /crm_has_permission/,
  'Restrictive lifecycle-политика не должна повторно требовать право другого ресурса')

const machinesSelectPolicy = generatedPolicies.match(
  /CREATE POLICY "machines_select"[\s\S]*?;/,
)?.[0] || ''
assert.match(machinesSelectPolicy, /crm_has_permission\('supply_orders', 'view'\)/,
  'Заказы снабжения должны видеть связанные машины')
assert.match(machinesSelectPolicy, /submitted_to_supply[\s\S]*completed/,
  'Доступ снабжения к машинам должен быть ограничен переданными заявками')

for (const table of [
  'technologist_requests',
  'request_sheet_metal',
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
]) {
  assert(manifest.tables[table].view.includes('supply_orders'),
    `${table}: supply_orders/view должен читать данные страницы заказов`)
}

assert.match(rollback, /DROP POLICY IF EXISTS "department_access_permissions_select_matrix"/)
assert.match(rollback, /CREATE POLICY "department_access_permissions_select_authenticated"/)
assert.match(rollback, /DROP FUNCTION IF EXISTS private\.crm_has_permission/)
assert.match(rollback, /Exact cutover ACL snapshot is missing/)

const expectedFactoryScopeResources = [
  'production_reports',
  'customs_clearance',
  'production_fact',
  'production_cutting_area',
  'inventory',
] as const
const codeFactoryScopeResources = PERMISSION_RESOURCES
  .filter((resource) => 'supportsFactoryScope' in resource && resource.supportsFactoryScope === true)
  .map((resource) => resource.key)
  .sort()
assert.deepEqual(codeFactoryScopeResources, [...expectedFactoryScopeResources].sort(),
  'Runtime и DB должны поддерживать одинаковый набор factory-scoped ресурсов')
const rollbackFactoryConstraint = rollback.slice(
  rollback.indexOf('ADD CONSTRAINT department_access_permissions_factory_scope_check'),
  rollback.indexOf('ADD CONSTRAINT department_access_permissions_company_view_scope_check'),
)
const technologistReservationMigration = readFileSync(technologistReservationMigrationPath, 'utf8')
for (const resource of expectedFactoryScopeResources) {
  const constraintSource = resource === 'inventory'
    ? technologistReservationMigration
    : `${factoryScopeCompatibility}\n${rollbackFactoryConstraint}`
  assert.match(constraintSource, new RegExp(`'${resource}'`),
    `Factory scope constraint должен разрешать ${resource}`)
}
assert.doesNotMatch(factoryScopeCompatibility, /'supply'/,
  'Ресурс supply не имеет однозначного factory ownership и не должен получать scope=all')

const migrationFiles = readdirSync(join(root, 'supabase/migrations'))
  .filter((file) => /^\d{14}_.+\.sql$/.test(file))
  .sort()
assert.deepEqual(
  migrationFiles.filter(file=>file >= '20260916090000_department_rls_matrix_cutover.sql'),
  [
    '20260916090000_department_rls_matrix_cutover.sql',
    '20260916103000_fix_technologist_request_draft_visibility.sql',
    '20260917050000_fix_users_self_visibility.sql',
    '20260917115900_technologist_revision_task_type.sql',
    '20260917120000_technologist_approval_personal_workflow.sql',
    '20260917180000_approval_revision_contract_scope.sql',
    '20260918130000_finance_approval_jwt_context.sql',
    '20260918160000_finance_approval_draft_cleanup_actor.sql',
    '20260919120000_organization_access_foundation.sql',
    '20260919121000_organization_access_evaluator.sql',
    '20260919121500_organization_admin_callers.sql',
    '20260919122000_organization_commands.sql',
    '20260919123000_organization_handoff.sql',
    '20260919124000_organization_snapshot.sql',
    '20260919124500_organization_auth_sync_leases.sql',
    '20260919125000_finance_inventory_view_only.sql',
    '20260919125500_organization_rls_administrator.sql',
    '20260920120000_organization_member_management.sql',
    '20260920130000_task_notifications_material_type_access.sql',
    '20260920220000_technologist_reservations_projects_password.sql',
    '20260921082107_access_programs_admin_and_layouts.sql',
    '20260921145900_revision_procurement_release_snapshot.sql',
    '20260921150000_revision_position_groups.sql',
    '20260921151000_atomic_supply_schedule_status.sql',
    '20260921152000_supply_task_wording.sql',
    '20260921153000_reconcile_civ19_ordered_status.sql',
    '20260922115830_protect_supply_receipt_surplus.sql',
    '20260922120000_request_series_and_detailing_gate.sql',
    '20260922133000_receiving_approved_bar_allocation_guard.sql',
    '20260922183000_sheet_inventory_import.sql',
    '20260923120000_sheet_import_density_schema.sql',
    '20260923120100_sheet_import_density_logic.sql',
    '20260923150000_sheet_scrap_orientation_reservation.sql',
    '20260923151000_rotated_pipe_variant_reservation.sql',
    '20260923152000_completion_sheet_scrap_detailing_dimensions.sql',
    '20260924100000_sales_member_own_client_commercial_access.sql',
    '20260924101000_berehovo_single_workshop.sql',
    '20260924125000_sales_member_trimmed_department_name.sql',
    '20260924130000_inventory_cutting_writeoff_source.sql',
    '20260924140000_future_scrap_fact_and_metal_weight.sql',
    '20260925120000_stock_material_requests.sql',

  ],
  'После cutover разрешены только проверенные follow-up миграции',
)
assert.match(draftVisibilityFix, /request\.created_by = auth\.uid\(\)/)
assert.match(draftVisibilityFix, /crm_has_permission\('technologist_requests', 'manage'\)/)
assert.doesNotMatch(
  draftVisibilityFix,
  /NOT private\.crm_has_permission\('supply_material_requests', 'view'\)/,
  'Снабженческое право не должно отменять собственный технологический доступ пользователя',
)
assert.match(usersSelfVisibilityFix, /OR id = auth\.uid\(\)/,
  'users_select должен сохранять независимый self-read путь')
assert.match(usersSelfVisibilityFix, /crm_has_permission\('departments', 'view'\)/)
assert.match(usersSelfVisibilityFix, /crm_has_permission\('admin_users', 'view'\)/)
assert.match(usersSelfVisibilityFix, /factory_id = public\.get_user_factory_id\(\)/)

const serverPermissions = readFileSync(join(root, 'src/lib/permissions/server.ts'), 'utf8')
const resolver = readFileSync(join(root, 'src/lib/permissions/resolve.ts'), 'utf8')
const factoryScope = readFileSync(join(root, 'src/lib/permissions/factory-scope.ts'), 'utf8')
const accessActions = readFileSync(join(root, 'src/lib/actions/role-permissions.ts'), 'utf8')
const accessPage = readFileSync(join(root, 'src/components/features/settings/RolePermissionsPage.tsx'), 'utf8')
const runtimeSources = `${serverPermissions}\n${resolver}\n${factoryScope}\n${accessActions}`

for (const forbidden of [
  'Legacy role fallback',
  'shouldUseLegacyPermissionFallback',
  'getRolePermissionMap',
  'addSalesOwnerCommercialCapabilities',
  ".from('role_permissions')",
  ".from<LegacyPermissionRow[]>('role_permissions')",
]) {
  assert(!runtimeSources.includes(forbidden), `Runtime всё ещё содержит ${forbidden}`)
}

assert(!factoryScope.includes('DIRECTOR_ACCESS_ROLES'), 'Legacy-роль директора не должна обходить factory scope')
assert.match(accessActions, /crm_save_matrix/)
assert.match(accessPage, /Доступ по заводам/,
  'Матрица должна явно называть выбор «Свой завод / Все заводы» доступом по заводам')
assert.match(accessPage, /setPermissions\(savedPermissions\)[\s\S]*setPersistedPermissions\(savedPermissions\)/,
  'После успешного сохранения UI должен принять server-normalized state и обнулить diff')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [path] : []
  })
}

for (const file of sourceFiles(join(root, 'src'))) {
  if (file.includes(`${join('src', 'lib', 'types')}/`)) continue
  const source = readFileSync(file, 'utf8')
  for (const forbidden of [
    /\.from(?:<[^>]+>)?\(['"]role_permissions['"]\)/,
    /get_user_role\s*\(/,
    /is_director\s*\(/,
    /security_has_role\s*\(/,
    /security_can_/,
    /shouldUseLegacyPermissionFallback/,
    /addSalesOwnerCommercialCapabilities/,
  ]) {
    assert(!forbidden.test(source), `${file}: runtime содержит legacy authorization ${forbidden}`)
  }
}

console.log(`RLS manifest: ${manifest.resources.length} ресурсов, ${policyTables.length} таблиц, ${affected.count} политик`)
