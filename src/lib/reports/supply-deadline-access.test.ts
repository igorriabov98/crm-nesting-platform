import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSupplyDeadlineFactoryAccess } from './supply-deadline-access'

const factories = [{ id: 'beregovo', name: 'Берегово' }, { id: 'uzhgorod', name: 'Ужгород' }]
const memberships = [{ departmentId: 'supply', isDepartmentHead: false }]
const matrix = [{ department_id: 'supply', subject_scope: 'member', can_view: true, can_manage: false }]
const grants = factories.map((factory) => ({
  department_id: 'supply', subject_scope: 'member', factory_id: factory.id,
  can_view: true, can_manage: false,
}))

test('сотрудник без завода в профиле видит оба явно назначенных завода', () => {
  const access = resolveSupplyDeadlineFactoryAccess(factories, memberships, grants, matrix, false)
  assert.deepEqual(access.factories, factories)
  assert.deepEqual(access.canManageFactoryIds, [])
})

test('нет права матрицы или отдельного гранта: завод закрыт на сервере', () => {
  assert.equal(resolveSupplyDeadlineFactoryAccess(factories, memberships, grants, [], false).factories.length, 0)
  assert.deepEqual(resolveSupplyDeadlineFactoryAccess(factories, memberships, grants.slice(0, 1), matrix, false).factories,
    factories.slice(0, 1))
})

test('управление исключениями требует одновременно право матрицы и грант завода', () => {
  const managed = [{ ...matrix[0], can_manage: true }]
  const withGrant = [{ ...grants[0], can_manage: true }, grants[1]]
  assert.deepEqual(resolveSupplyDeadlineFactoryAccess(factories, memberships, withGrant, managed, false).canManageFactoryIds,
    ['beregovo'])
  assert.deepEqual(resolveSupplyDeadlineFactoryAccess(factories, memberships, withGrant, matrix, false).canManageFactoryIds,
    [])
})
