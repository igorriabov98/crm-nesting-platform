import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  PERMISSION_RESOURCES,
  getPermissionRequirementForPath,
  hasPermission,
  type PermissionResource,
} from '../src/lib/permissions/resources'
import {
  resolveDepartmentPermissions,
  shouldUseLegacyPermissionFallback,
  type DepartmentAccessPermissionRow,
  type DepartmentPermissionMembershipInput,
} from '../src/lib/permissions/resolve'

const root = process.cwd()

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

assert.equal(PERMISSION_RESOURCES.length, 41, 'Реестр должен содержать все 41 ресурса')
assert.equal(new Set(PERMISSION_RESOURCES.map((resource) => resource.key)).size, 41, 'Ключи ресурсов должны быть уникальными')

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

const explicitlyPublicOrSecretApiRoutes = new Set([
  'src/app/api/meetings/reminders/route.ts',
  'src/app/api/tasks/due/route.ts',
  'src/app/api/telegram/webhook/route.ts',
  'src/app/api/version/route.ts',
])
for (const filePath of walk(join(root, 'src/app/api'), 'route.ts')) {
  const relativePath = relative(root, filePath)
  if (explicitlyPublicOrSecretApiRoutes.has(relativePath)) continue
  const source = readFileSync(filePath, 'utf8')
  assert(
    /(?:get|require)NestingProxyAccess\(|requirePermission\(/u.test(source),
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
