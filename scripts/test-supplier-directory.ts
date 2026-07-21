import assert from 'node:assert/strict'
import { MATERIAL_CATEGORIES } from '../src/lib/constants/procurement'
import {
  CONSUMABLE_SUPPLIER_CATEGORIES,
  METAL_SUPPLIER_CATEGORIES,
  filterSuppliersByDirectorySection,
  getSupplierCreateHref,
  getSupplierDirectorySections,
  getSupplierEditHref,
  getSupplierPrimaryRole,
  getUnmappedMaterialCategories,
  validateSupplierRoleConfiguration,
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
    id: 'metal-and-consumables',
    categories: ['pipe', 'components'],
    can_transport: false,
    can_outsource: false,
  },
]

assert.deepEqual(getUnmappedMaterialCategories(), [], 'Каждая существующая категория материала должна входить в один из каталогов')
assert.equal(
  new Set([...METAL_SUPPLIER_CATEGORIES, ...CONSUMABLE_SUPPLIER_CATEGORIES]).size,
  MATERIAL_CATEGORIES.length,
  'Категории металла и расходников не должны теряться или дублироваться',
)

assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'metal').map(({ id }) => id), ['metal', 'metal-and-consumables'])
assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'consumables').map(({ id }) => id), ['consumables', 'metal-and-consumables'])
assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'transport').map(({ id }) => id), ['transport'])
assert.deepEqual(filterSuppliersByDirectorySection(fixtures, 'outsourcing').map(({ id }) => id), ['outsourcing'])
assert.equal(filterSuppliersByDirectorySection(fixtures, 'all').length, fixtures.length)

assert.deepEqual(getSupplierDirectorySections(fixtures[4]), ['metal', 'consumables'])
assert.equal(getSupplierPrimaryRole(fixtures[0]), 'supplier')
assert.equal(getSupplierPrimaryRole(fixtures[2]), 'transport')
assert.equal(getSupplierPrimaryRole(fixtures[3]), 'outsourcing')
assert.equal(getSupplierPrimaryRole({ ...fixtures[0], can_transport: true }), null)
assert.deepEqual(
  getSupplierDirectorySections({ ...fixtures[0], can_transport: true }),
  [],
  'Конфликтная legacy-запись должна оставаться только в полном реестре',
)

const validConfigurations = [
  {
    primary_role: 'supplier',
    supplies_metal: true,
    supplies_consumables: false,
    categories: ['sheet_metal'],
  },
  {
    primary_role: 'supplier',
    supplies_metal: false,
    supplies_consumables: true,
    categories: ['paint'],
  },
  {
    primary_role: 'supplier',
    supplies_metal: true,
    supplies_consumables: true,
    categories: ['pipe', 'components'],
  },
  {
    primary_role: 'transport',
    supplies_metal: false,
    supplies_consumables: false,
    categories: [],
  },
  {
    primary_role: 'outsourcing',
    supplies_metal: false,
    supplies_consumables: false,
    categories: [],
  },
] as const

for (const configuration of validConfigurations) {
  assert.equal(validateSupplierRoleConfiguration({
    ...configuration,
    categories: [...configuration.categories] as MaterialCategory[],
  }).success, true)
}

const combinedSupplier = validateSupplierRoleConfiguration({
  primary_role: 'supplier',
  supplies_metal: true,
  supplies_consumables: true,
  categories: ['pipe', 'components', 'pipe'],
})
assert.equal(combinedSupplier.success, true)
if (combinedSupplier.success) {
  assert.deepEqual(combinedSupplier.data, {
    can_transport: false,
    can_outsource: false,
    categories: ['pipe', 'components'],
  })
}

const transportCompany = validateSupplierRoleConfiguration({
  primary_role: 'transport',
  supplies_metal: false,
  supplies_consumables: false,
  categories: [],
})
assert.equal(transportCompany.success, true)
if (transportCompany.success) {
  assert.deepEqual(transportCompany.data, {
    can_transport: true,
    can_outsource: false,
    categories: [],
  })
}

const invalidConfigurations = [
  { primary_role: null, supplies_metal: null, supplies_consumables: null, categories: [] },
  { primary_role: 'unknown', supplies_metal: false, supplies_consumables: false, categories: [] },
  { primary_role: 'supplier', supplies_metal: undefined, supplies_consumables: true, categories: ['paint'] },
  { primary_role: 'supplier', supplies_metal: null, supplies_consumables: false, categories: [] },
  { primary_role: 'supplier', supplies_metal: false, supplies_consumables: null, categories: [] },
  { primary_role: 'supplier', supplies_metal: false, supplies_consumables: false, categories: [] },
  { primary_role: 'supplier', supplies_metal: true, supplies_consumables: false, categories: [] },
  { primary_role: 'supplier', supplies_metal: false, supplies_consumables: true, categories: [] },
  { primary_role: 'supplier', supplies_metal: false, supplies_consumables: true, categories: ['pipe'] },
  { primary_role: 'transport', supplies_metal: true, supplies_consumables: false, categories: ['pipe'] },
  { primary_role: 'outsourcing', supplies_metal: false, supplies_consumables: true, categories: ['paint'] },
] as const

for (const configuration of invalidConfigurations) {
  assert.equal(validateSupplierRoleConfiguration({
    ...configuration,
    categories: [...configuration.categories] as MaterialCategory[],
  } as unknown as Parameters<typeof validateSupplierRoleConfiguration>[0]).success, false)
}
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
