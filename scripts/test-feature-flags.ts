import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ROUTES } from '../src/lib/constants/routes'
import { readFeatureFlagSafely } from '../src/lib/feature-flags/resolve'
import {
  PERMISSION_RESOURCES,
  SWITCHABLE_PERMISSION_RESOURCES,
  getDefaultPermissionMap,
  hasPermission,
} from '../src/lib/permissions/resources'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

async function main() {
  assert.equal(await readFeatureFlagSafely(async () => ({ data: { enabled: false } })), false)
  assert.equal(await readFeatureFlagSafely(async () => ({ data: null })), false, 'Отсутствие записи должно выключать флаг')
  assert.equal(
    await readFeatureFlagSafely(async () => ({ data: { enabled: true }, error: new Error('database unavailable') })),
    false,
    'Ошибка чтения должна выключать флаг',
  )
  assert(
    await readFeatureFlagSafely(async () => { throw new Error('database unavailable') }) === false,
    'Исключение при чтении должно выключать флаг',
  )
  assert.equal(await readFeatureFlagSafely(async () => ({ data: { enabled: true } })), true)
  assert.equal(await readFeatureFlagSafely(async () => ({ data: { enabled: 1 } })), false)

  const migration = read('supabase/migrations/20260814150000_feature_flags.sql').toLowerCase()
  for (const table of ['feature_flags', 'feature_flag_audit_log']) {
    assert(migration.includes(`create table public.${table}`), `Нет таблицы ${table}`)
    assert(migration.includes(`alter table public.${table} enable row level security`), `RLS не включён для ${table}`)
    assert(
      migration.includes(`revoke all on table public.${table} from public, anon, authenticated`),
      `Прямой доступ не закрыт для ${table}`,
    )
  }
  assert(migration.includes('enabled boolean not null default false'), 'Значение флага по умолчанию должно быть false')
  assert(migration.includes("values ('long_stock_cutting_enabled', false)"), 'Первый флаг должен создаваться выключенным')
  assert(migration.includes('create trigger feature_flags_write_audit'), 'Смена флага должна записываться триггером')
  assert(migration.includes('old.enabled is distinct from new.enabled'), 'Аудит должен фиксировать только реальную смену значения')
  assert(migration.includes('new.updated_by'), 'Аудит должен фиксировать пользователя, изменившего флаг')

  const reader = read('src/lib/feature-flags/server.ts')
  assert(reader.includes("import { cache } from 'react'"), 'Чтение должно кэшироваться в пределах запроса')
  assert(reader.includes('cache(async (key: FeatureFlagKey)'), 'Кэш должен быть привязан к ключу флага')
  for (const forbidden of ['unstable_cache', "'use cache'", 'new Map']) {
    assert(!reader.includes(forbidden), `Межзапросное состояние запрещено: ${forbidden}`)
  }
  assert(reader.includes('readFeatureFlagSafely'), 'Серверное чтение должно использовать fail-safe resolver')

  const adminModule = read('src/lib/feature-flags/admin.ts')
  const adminPage = read('src/app/(protected)/admin/settings/feature-flags/page.tsx')
  const action = read('src/lib/actions/feature-flags.ts')
  assert(adminModule.includes('permissionDetails.isAdminPosition'), 'Серверные операции должны проверять администратора CRM')
  assert(adminPage.includes('permissionDetails.isAdminPosition'), 'Страница должна проверять администратора CRM')
  assert(action.includes('requireFeatureFlagAdministrator()'), 'Server Action должна повторно проверять администратора CRM')

  const resource = PERMISSION_RESOURCES.find((item) => item.key === 'feature_flags')
  assert(resource)
  assert.equal(resource.defaultHref, ROUTES.ADMIN_FEATURE_FLAGS)
  assert.equal(resource.locked, true, 'Право фичефлагов нельзя делегировать через матрицу')
  assert.deepEqual(resource.defaultViewRoles, [])
  assert.deepEqual(resource.defaultManageRoles, [])
  assert(!SWITCHABLE_PERMISSION_RESOURCES.some((item) => item.key === 'feature_flags'))
  assert(!hasPermission(getDefaultPermissionMap('planning_director'), 'feature_flags', 'view'))

  const literalReferences = sourceFiles(join(root, 'src'))
    .filter((path) => /\.(?:ts|tsx|js|jsx)$/u.test(path))
    .filter((path) => readFileSync(path, 'utf8').includes('long_stock_cutting_enabled'))
    .map((path) => relative(root, path))
  assert.deepEqual(
    literalReferences,
    ['src/lib/feature-flags/definitions.ts'],
    'Первый флаг пока нельзя подключать к продуктовой логике',
  )

  console.log('feature-flags: OK')
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? sourceFiles(path) : [path]
  })
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
