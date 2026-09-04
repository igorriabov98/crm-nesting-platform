import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  PERMISSION_RESOURCES,
  getDefaultPermissionMap,
  getFullPermissionMap,
  getPermissionRequirementForPath,
  getSidebarResources,
  hasPermission,
  type PermissionResource,
} from '../src/lib/permissions/resources'
import {
  resolveDepartmentPermissions,
  shouldUseLegacyPermissionFallback,
  type DepartmentAccessPermissionRow,
  type DepartmentPermissionMembershipInput,
} from '../src/lib/permissions/resolve'
import {
  canAccessAllFactories,
  canAccessFactory,
} from '../src/lib/permissions/factory-scope'

const root = process.cwd()

const accessSettingsSource = readFileSync(
  join(root, 'src/components/features/settings/RolePermissionsPage.tsx'),
  'utf8',
)
assert(
  /timeZone: 'Europe\/Uzhgorod'/u.test(accessSettingsSource),
  'Даты аудита прав должны форматироваться в фиксированной зоне CRM без hydration mismatch',
)

function walk(directory: string, fileName: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return walk(path, fileName)
    return entry.name === fileName ? [path] : []
  })
}

function pagePath(filePath: string) {
  const pageRoot = join(root, 'src/app/(protected)')
  const route = relative(pageRoot, filePath)
    .replace(/\/page\.tsx$/, '')
    .split('/')
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .map((segment) => segment.replace(/^\[.+\]$/, 'sample-id'))
    .join('/')
  return `/${route}`
}

assert.equal(PERMISSION_RESOURCES.length, 58, 'Реестр должен содержать все 58 ресурсов')
assert.equal(new Set(PERMISSION_RESOURCES.map((resource) => resource.key)).size, 58, 'Ключи ресурсов должны быть уникальными')

const technologistPermissions = getDefaultPermissionMap('technologist')
const procurementHeadPermissions = getDefaultPermissionMap('procurement_head')
const supplyManagerPermissions = getDefaultPermissionMap('supply_manager')
const engineerPermissions = getDefaultPermissionMap('engineer')
const productionManagerPermissions = getDefaultPermissionMap('production_manager')
assert(hasPermission(technologistPermissions, 'inventory_detailing', 'manage'), 'Технолог должен управлять деталировкой')
assert(hasPermission(technologistPermissions, 'inventory_detailing_receiving', 'manage'), 'Технолог должен принимать деталировку')
assert(hasPermission(technologistPermissions, 'machine_cutting', 'manage'), 'Начальные права порезки должны повторять nesting')
assert(hasPermission(productionManagerPermissions, 'production_cutting_area', 'manage'), 'Начальные права Участка заготовки должны повторять production_fact')
assert(hasPermission(procurementHeadPermissions, 'inventory_detailing', 'manage'), 'Руководитель снабжения должен управлять каталогом деталировки')
assert(!hasPermission(procurementHeadPermissions, 'inventory_detailing_receiving', 'view'), 'Руководитель снабжения не должен принимать деталировку')
assert(hasPermission(supplyManagerPermissions, 'supply_transport', 'manage'), 'Снабженец должен управлять транспортом')
assert(!hasPermission(supplyManagerPermissions, 'inventory_detailing', 'manage'), 'Снабженец не должен менять склад деталировки')
assert(!hasPermission(technologistPermissions, 'future_detailing', 'view'), 'Новые права будущей деталировки назначаются только через структуру')
assert(!hasPermission(technologistPermissions, 'metal_scrap', 'view'), 'Новые права металлолома назначаются только через структуру')
assert(!hasPermission(technologistPermissions, 'metal_scrap_sales', 'manage'), 'Право сдачи металлолома назначается только через структуру')
assert(!hasPermission(technologistPermissions, 'product_production_drawings', 'view'), 'Комплектные чертежи по умолчанию закрыты')
assert(!hasPermission(supplyManagerPermissions, 'product_production_drawings', 'manage'), 'Управление комплектными чертежами назначается только через структуру')
assert(hasPermission(engineerPermissions, 'products', 'view'), 'Инженер должен видеть карточки изделий')
assert(!hasPermission(engineerPermissions, 'product_production_drawings', 'view'), 'products.view не должен раскрывать комплектные чертежи')
assert(hasPermission(getFullPermissionMap(), 'product_production_drawings', 'manage'), 'CRM-администратор должен получать полный доступ')
assert(!hasPermission(getDefaultPermissionMap('financial_director'), 'complex_reports', 'view'), 'Комплексные отчёты по умолчанию выдаются только через матрицу доступа')
assert(!hasPermission(getDefaultPermissionMap('sales_manager'), 'complex_reports', 'view'), 'Роль не должна автоматически открывать комплексные отчёты')
assert(hasPermission(getFullPermissionMap(), 'complex_reports', 'view'), 'CRM-администратор должен видеть комплексные отчёты')
assert(!hasPermission(getDefaultPermissionMap('planning_director'), 'production_reports', 'view'), 'Производственная аналитика по умолчанию закрыта')
assert(!hasPermission(getDefaultPermissionMap('production_manager'), 'production_reports', 'manage'), 'Роль производства не должна автоматически управлять отчётом')
assert(hasPermission(getFullPermissionMap(), 'production_reports', 'manage'), 'CRM-администратор должен управлять производственной аналитикой')
assert(hasPermission(getDefaultPermissionMap('sales_manager'), 'client_payments', 'manage'), 'Sales-менеджер должен вести оплаты своих компаний')
assert(hasPermission(getDefaultPermissionMap('commercial_director'), 'client_payments', 'manage'), 'Директор должен вести оплаты всех компаний')
assert(hasPermission(getDefaultPermissionMap('commercial_director'), 'invoices', 'manage'), 'Коммерческий директор должен управлять инвойсами в своей области')
assert.equal(getSidebarResources('financial_director', getDefaultPermissionMap('financial_director'), 'reports').length, 0, 'Раздел отчётов должен быть скрыт без права')
assert.equal(getSidebarResources('financial_director', getFullPermissionMap(), 'reports')[0]?.key, 'complex_reports', 'Раздел отчётов должен появляться с правом')
assert.equal(
  getPermissionRequirementForPath('/reports/complex')?.resourceKey,
  'complex_reports',
  'Маршрут комплексных отчётов должен использовать отдельное право',
)
assert.equal(
  getPermissionRequirementForPath('/reports/production')?.operation,
  'view',
  'Основной производственный отчёт должен требовать production_reports.view',
)
assert.equal(
  getPermissionRequirementForPath('/reports/production/settings')?.operation,
  'manage',
  'Настройки производственного отчёта должны требовать production_reports.manage',
)
const longStockLayoutSettings = PERMISSION_RESOURCES.find((resource) => resource.key === 'long_stock_layout_settings')
assert(longStockLayoutSettings?.locked, 'Настройки раскладки хлыстов должны быть закрытым ресурсом администратора')
assert(!hasPermission(technologistPermissions, 'long_stock_layout_settings', 'view'), 'Технолог не должен видеть настройки раскладки хлыстов')
assert(!hasPermission(getDefaultPermissionMap('planning_director'), 'long_stock_layout_settings', 'view'), 'Директор не должен видеть настройки раскладки хлыстов по роли')
assert(hasPermission(getFullPermissionMap(), 'long_stock_layout_settings', 'manage'), 'CRM-администратор должен управлять настройками раскладки хлыстов')
assert.equal(
  getPermissionRequirementForPath('/admin/settings/long-stock-layout')?.resourceKey,
  'long_stock_layout_settings',
  'Маршрут настроек раскладки должен использовать отдельный закрытый ресурс',
)
assert(hasPermission(supplyManagerPermissions, 'department_requests', 'manage'), 'Снабженец должен создавать и обрабатывать запросы')
assert(hasPermission(technologistPermissions, 'department_requests', 'manage'), 'Технолог должен создавать и обрабатывать запросы')
assert.equal(
  getPermissionRequirementForPath('/requests/supply')?.resourceKey,
  'department_requests',
  'Межотдельные запросы должны использовать отдельное право',
)
assert.equal(
  getPermissionRequirementForPath('/production/requests')?.resourceKey,
  'production_fact',
  'Запросы завода должны использовать действующее право производства',
)
assert.equal(
  getPermissionRequirementForPath('/supply/requests')?.resourceKey,
  'supply_transport',
  'Запросы внешним компаниям должны использовать действующее право транспорта снабжения',
)

for (const resource of PERMISSION_RESOURCES as readonly PermissionResource[]) {
  if (!resource.defaultHref) continue
  const requirement = getPermissionRequirementForPath(resource.defaultHref)
  assert(requirement, `Маршрут ${resource.defaultHref} ресурса ${resource.key} не зарегистрирован`)
  assert.equal(requirement.resourceKey, resource.key, `Маршрут ${resource.defaultHref} сопоставлен не с ${resource.key}`)
}

const unprotectedProfilePages = new Set(['/profile'])
for (const filePath of walk(join(root, 'src/app/(protected)'), 'page.tsx')) {
  const pathname = pagePath(filePath)
  if (unprotectedProfilePages.has(pathname)) continue
  assert(
    getPermissionRequirementForPath(pathname),
    `Защищённая страница ${pathname} не зарегистрирована в PERMISSION_RESOURCES`,
  )
}

const memberships: DepartmentPermissionMembershipInput[] = [
  { departmentId: 'technical', departmentName: 'Технический', isDepartmentHead: false },
  { departmentId: 'production', departmentName: 'Производство', isDepartmentHead: true },
]
const rows: DepartmentAccessPermissionRow[] = [
  { department_id: 'technical', subject_scope: 'member', resource_key: 'nesting', can_view: false, can_manage: false },
  { department_id: 'technical', subject_scope: 'member', resource_key: 'nesting_catalog', can_view: true, can_manage: false },
  { department_id: 'technical', subject_scope: 'member', resource_key: 'nesting_settings', can_view: false, can_manage: false },
  { department_id: 'production', subject_scope: 'head', resource_key: 'nesting', can_view: false, can_manage: true },
  { department_id: 'production', subject_scope: 'head', resource_key: 'supply', can_view: true, can_manage: false },
  { department_id: 'production', subject_scope: 'head', resource_key: 'production_cutting_area', can_view: true, can_manage: true, factory_scope: 'all' },
  { department_id: 'technical', subject_scope: 'member', resource_key: 'production_cutting_area', can_view: true, can_manage: false, factory_scope: 'own' },
]

const resolved = resolveDepartmentPermissions(memberships, rows)
assert.equal(resolved.appliedDepartmentRows, rows.length, 'Должны учитываться строки всех отделов пользователя')
assert(hasPermission(resolved.permissions, 'nesting', 'manage'), 'Права нескольких отделов должны объединяться через OR')
assert(hasPermission(resolved.permissions, 'nesting', 'view'), 'manage должен автоматически разрешать view')
assert(hasPermission(resolved.permissions, 'nesting_catalog', 'view'), 'Каталог должен иметь независимое право')
assert(!hasPermission(resolved.permissions, 'nesting_catalog', 'manage'), 'view каталога не должен разрешать запись')
assert(!hasPermission(resolved.permissions, 'nesting_settings', 'view'), 'Настройки nesting должны быть независимы от nesting.manage')
assert(!shouldUseLegacyPermissionFallback(resolved.appliedDepartmentRows), 'Явные строки отделов нельзя обходить legacy-ролью')
assert(shouldUseLegacyPermissionFallback(0), 'Legacy fallback допустим только без настроенных строк отделов')
assert.equal(resolved.factoryScopes.production_cutting_area?.view, 'all', 'Охват просмотра нескольких отделов должен объединяться через OR')
assert.equal(resolved.factoryScopes.production_cutting_area?.manage, 'all', 'Охват управления должен учитываться только из строки с manage')

const ownFactoryPermission = {
  role: 'production_manager',
  factoryId: 'uzhhorod',
  permissionDetails: { isAdminPosition: false, factoryScopes: { production_cutting_area: { view: 'own' as const, manage: 'own' as const } } },
}
assert(canAccessFactory(ownFactoryPermission, 'production_cutting_area', 'view', 'uzhhorod'))
assert(!canAccessFactory(ownFactoryPermission, 'production_cutting_area', 'view', 'berehove'))
assert(!canAccessFactory({ ...ownFactoryPermission, factoryId: null }, 'production_cutting_area', 'view', 'uzhhorod'), 'Пользователь без завода должен быть закрыт по умолчанию')
assert(canAccessAllFactories({
  ...ownFactoryPermission,
  permissionDetails: { isAdminPosition: false, factoryScopes: { production_cutting_area: { view: 'all', manage: 'own' } } },
}, 'production_cutting_area', 'view'), 'Настраиваемый охват просмотра должен открывать оба завода')
assert(!canAccessAllFactories({
  ...ownFactoryPermission,
  permissionDetails: { isAdminPosition: false, factoryScopes: { production_cutting_area: { view: 'all', manage: 'own' } } },
}, 'production_cutting_area', 'manage'), 'Глобальный просмотр не должен расширять управление другого отдела')
assert(canAccessAllFactories({
  ...ownFactoryPermission,
  role: 'planning_director',
  factoryId: null,
}, 'production_cutting_area', 'manage'), 'Действующий глобальный доступ директоров должен сохраниться')
assert(canAccessAllFactories({
  ...ownFactoryPermission,
  factoryId: null,
  permissionDetails: { isAdminPosition: true, factoryScopes: {} },
}, 'production_cutting_area', 'manage'), 'Администратор CRM должен видеть все заводы')

const denied = resolveDepartmentPermissions(
  [{ departmentId: 'technical', departmentName: 'Технический', isDepartmentHead: false }],
  [{ department_id: 'technical', subject_scope: 'member', resource_key: 'nesting', can_view: false, can_manage: false }],
)
assert.equal(denied.appliedDepartmentRows, 1)
assert(!hasPermission(denied.permissions, 'nesting', 'view'), 'Явный запрет отдела должен сохраняться')

const engineerDepartmentAccess = resolveDepartmentPermissions(
  [{ departmentId: 'technical', departmentName: 'Технический', isDepartmentHead: false }],
  [{ department_id: 'technical', subject_scope: 'member', resource_key: 'nesting', can_view: true, can_manage: true }],
)
assert(
  hasPermission(engineerDepartmentAccess.permissions, 'nesting', 'manage'),
  'Сотрудник технического отдела с nesting.manage должен запускать раскладку независимо от legacy-роли',
)

const productionDrawingViewOnly = resolveDepartmentPermissions(
  [{ departmentId: 'engineering', departmentName: 'Инженерный отдел', isDepartmentHead: false }],
  [{ department_id: 'engineering', subject_scope: 'member', resource_key: 'product_production_drawings', can_view: true, can_manage: false }],
)
assert(hasPermission(productionDrawingViewOnly.permissions, 'product_production_drawings', 'view'))
assert(!hasPermission(productionDrawingViewOnly.permissions, 'product_production_drawings', 'manage'))

const productionDrawingManage = resolveDepartmentPermissions(
  [{ departmentId: 'production', departmentName: 'Производство', isDepartmentHead: false }],
  [{ department_id: 'production', subject_scope: 'member', resource_key: 'product_production_drawings', can_view: false, can_manage: true }],
)
assert(hasPermission(productionDrawingManage.permissions, 'product_production_drawings', 'view'), 'manage должен включать view')
assert(hasPermission(productionDrawingManage.permissions, 'product_production_drawings', 'manage'))

const complexReportOnly = resolveDepartmentPermissions(
  [{ departmentId: 'finance', departmentName: 'Финансы', isDepartmentHead: false }],
  [
    { department_id: 'finance', subject_scope: 'member', resource_key: 'complex_reports', can_view: true, can_manage: false },
    { department_id: 'finance', subject_scope: 'member', resource_key: 'invoices', can_view: false, can_manage: false },
  ],
)
assert(hasPermission(complexReportOnly.permissions, 'complex_reports', 'view'), 'Матрица должна независимо открывать комплексные отчёты')
assert(!hasPermission(complexReportOnly.permissions, 'invoices', 'view'), 'Доступ к отчёту не должен автоматически открывать инвойсы')

const paymentScopes = resolveDepartmentPermissions(
  [{ departmentId: 'sales', departmentName: 'Sales', isDepartmentHead: false }],
  [
    { department_id: 'sales', subject_scope: 'member', resource_key: 'client_payments', can_view: true, can_manage: true, company_view_scope: 'all', company_manage_scope: 'own' },
    { department_id: 'sales', subject_scope: 'member', resource_key: 'invoices', can_view: true, can_manage: false, company_view_scope: 'own', company_manage_scope: 'own' },
  ],
)
assert.equal(paymentScopes.companyScopes.client_payments?.view, 'all', 'Охват просмотра оплат должен настраиваться независимо')
assert.equal(paymentScopes.companyScopes.client_payments?.manage, 'own', 'Охват управления оплатами должен настраиваться независимо')
assert.equal(paymentScopes.companyScopes.invoices?.view, 'own', 'Охват инвойсов не должен наследоваться от оплат')
assert.equal(getPermissionRequirementForPath('/sales/payments/sample-id')?.resourceKey, 'client_payments')

const nestingRoutes = walk(join(root, 'src/app/api/nesting'), 'route.ts')
assert(nestingRoutes.length > 0, 'Не найдены API-маршруты nesting')
for (const filePath of nestingRoutes) {
  const source = readFileSync(filePath, 'utf8')
  assert(
    /(?:get|require)NestingProxyAccess\(\{[\s\S]*?resourceKey:[\s\S]*?operation:/.test(source),
    `API-маршрут ${relative(root, filePath)} не проверяет типизированное право`,
  )
  assert(!/(?:get|require)NestingProxyAccess\(['"]/u.test(source), `В ${relative(root, filePath)} осталась старая ролевая проверка`)
}
const nestingUploadSource = readFileSync(join(root, 'src/app/api/nesting/upload/route.ts'), 'utf8')
assert(
  /getNestingProxyAccess\(\{\s*resourceKey: 'nesting',\s*operation: 'manage'\s*\}\)/u.test(nestingUploadSource),
  'Загрузка детали должна проверять nesting.manage',
)

const apiRoutesWithDedicatedAuthorization = new Set([
  'src/app/api/impersonation/stop/route.ts',
  'src/app/api/mail/attachments/[id]/route.ts',
  'src/app/api/mail/oauth/callback/route.ts',
  'src/app/api/mail/oauth/start/route.ts',
  'src/app/api/mail/pubsub/route.ts',
  'src/app/api/mail/watch/renew/route.ts',
  'src/app/api/meetings/reminders/route.ts',
  'src/app/api/tasks/due/route.ts',
  'src/app/api/telegram/webhook/route.ts',
  'src/app/api/version/route.ts',
])
for (const filePath of walk(join(root, 'src/app/api'), 'route.ts')) {
  const relativePath = relative(root, filePath)
  if (apiRoutesWithDedicatedAuthorization.has(relativePath)) continue
  const source = readFileSync(filePath, 'utf8')
  if (relativePath === 'src/app/api/materials/search/route.ts') {
    assert(/await searchMaterialsWithVariants\(/u.test(source), 'Поиск должен делегировать защищённому действию')
    const materialActions = readFileSync(join(root, 'src/lib/actions/materials.ts'), 'utf8')
    const bundleAction = materialActions.split('export async function searchMaterialsWithVariants(')[1]?.split('export async function ')[0]
    assert(bundleAction && /await requireMaterialPermission\('view'\)/u.test(bundleAction), 'Действие поиска должно проверять materials.view')
    assert(/await requireReadPermissionDataClient\('materials'\)/u.test(materialActions), 'Чтение должно использовать общую проверку materials.view')
    const permissions = readFileSync(join(root, 'src/lib/permissions/server.ts'), 'utf8')
    const readGuard = permissions.split('export async function requireReadPermissionDataClient(')[1]?.split('export async function ')[0]
    assert(readGuard && /auth\.getUser\(\)/u.test(readGuard), 'Поиск должен проверять сессию через Auth')
    assert(readGuard && /await getCurrentUserPermissions\(user.id\)/u.test(readGuard), 'Поиск должен использовать общую матрицу прав')
    assert(readGuard && /hasPermission\(permissionDetails.permissions, resourceKey, 'view'\)/u.test(readGuard), 'Поиск должен требовать право чтения')
    continue
  }
  assert(
    /(?:get|require)NestingProxyAccess\(|requirePermission\(|requireProductProductionDrawingAccess\(/u.test(source),
    `API-маршрут ${relativePath} не проверяет право модуля`,
  )
}

for (const [relativePath, requirement] of [
  ['src/lib/actions/tasks.ts', /requirePermission\('tasks', operation\)/u],
  ['src/app/(protected)/notifications/actions.ts', /requirePermission\('notifications', '(?:view|manage)'\)/u],
  ['src/app/(protected)/production/gantt/actions.ts', /requirePermission\('production', 'view'\)/u],
] as const) {
  const source = readFileSync(join(root, relativePath), 'utf8')
  assert(requirement.test(source), `Серверные действия ${relativePath} не проверяют право модуля`)
}

const catalogSource = readFileSync(join(root, 'src/lib/nesting/catalog-api.ts'), 'utf8')
const catalogExports = catalogSource.match(/export async function /g) || []
const catalogChecks = catalogSource.match(/requirePermission\('nesting_catalog', '(?:view|manage)'\)/g) || []
assert(catalogExports.length > 0)
assert(catalogChecks.length >= catalogExports.length, 'Каждое действие каталога должно проверять nesting_catalog.view/manage')

const migration = readFileSync(
  join(root, 'supabase/migrations/20260713102511_backfill_business_scrap_department_access.sql'),
  'utf8',
)
assert(migration.includes("'business_scrap_reservations'"))
assert(/ON CONFLICT[\s\S]*DO NOTHING;/u.test(migration), 'Миграция не должна перезаписывать существующую матрицу')
assert(!/\b(?:UPDATE|DELETE|TRUNCATE)\b/iu.test(migration), 'Миграция должна быть только аддитивной')

console.log(`access-control: OK (${PERMISSION_RESOURCES.length} ресурсов, ${nestingRoutes.length} nesting API, ${catalogExports.length} действий каталога)`)
