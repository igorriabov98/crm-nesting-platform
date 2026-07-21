import assert from 'node:assert/strict'
import { MATERIAL_CATEGORIES } from '../src/lib/constants/procurement'
import {
  CONSUMABLE_SUPPLIER_CATEGORIES,
  METAL_SUPPLIER_CATEGORIES,
  filterSuppliersByDirectorySection,
  getSupplierCreateHref,
  getSupplierDirectorySections,
  getSupplierEditHref,
  getUnmappedMaterialCategories,
} from '../src/lib/suppliers/directory'
import { getPermissionRequirementForPath } from '../src/lib/permissions/resources'
import type { MaterialCategory } from '../src/lib/types'

type Fixture = {
  id: string
  categories: MaterialCategory[]
  can_transport: boolean
  can_outsource: boolean
}

const fixtures: Fixture[] = [
  { id: 'metal', categories: ['sheet_metal'], can_transport: false, can_outsource: false },
  { id: 'consumables', categories: ['paint'], can_transport: false, can_outsource: false },
  { id: 'transport', categories: [], can_transport: true, can_outsource: false },
  { id: 'outsourcing', categories: [], can_transport: false, can_outsource: true },
  {
    id: 'multi-role',
    categories: ['pipe', 'components'],
    can_transport: true,
    can_outsource: true,
  },
]

assert.deepEqual(getUnmappedMaterialCategories(), [], 'Каждая существующая категория материала должна входить в один из каталогов')
assert.equal(
  new Set([...METAL_SUPPLIER_CATEGORIES, ...CONSUMABLE_SUPPLIER_CATEGORIES]).size,
  MATERIAL_CATEGORIES.length,
  'Категории металла и расходников не должны теряться или дублироваться',
)

assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'metal').map(({ id }) => id), ['metal', 'multi-role'])
assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'consumables').map(({ id }) => id), ['consumables', 'multi-role'])
assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'transport').map(({ id }) => id), ['transport', 'multi-role'])
assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'outsourcing').map(({ id }) => id), ['outsourcing', 'multi-role'])
assert.equal(filterSuppliersByDirectorySection(fixtures, 'all').length, fixtures.length)

assert.deepEqual(getSupplierDirectorySections(fixtures[4]), ['transport', 'metal', 'outsourcing', 'consumables'])
assert.equal(getSupplierCreateHref('metal'), '/admin/database/metal/new')
assert.equal(getSupplierEditHref('transport', 'supplier-1'), '/admin/database/transport/supplier-1')

for (const [pathname, operation] of [
  ['/admin/database', 'view'],
  ['/admin/database/metal', 'view'],
  ['/admin/database/transport/new', 'manage'],
  ['/admin/database/outsourcing/supplier-1', 'manage'],
  ['/admin/suppliers', 'view'],
  ['/admin/suppliers/new', 'manage'],
] as const) {
  const requirement = getPermissionRequirementForPath(pathname)
  assert(requirement, `Маршрут ${pathname} должен быть зарегистрирован`)
  assert.equal(requirement.resourceKey, 'suppliers', `Маршрут ${pathname} должен использовать ресурс suppliers`)
  assert.equal(requirement.operation, operation, `Маршрут ${pathname} должен требовать suppliers.${operation}`)
}

console.log(`supplier-directory: OK (${fixtures.length} сценариев, ${MATERIAL_CATEGORIES.length} категорий)`)
