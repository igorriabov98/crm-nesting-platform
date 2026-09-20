import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateReservationCapability } from './supply-request-access'

const base = {
  hasWorkflowPermission: true,
  hasInventoryManage: true,
  isAdmin: false,
  inventoryFactoryScope: 'own' as const,
  userFactoryId: 'beregovo',
  targetFactoryId: 'beregovo',
  workflowDeniedReason: 'Нет права управлять заявкой',
}

test('own factory permits only the factory in the user profile', () => {
  assert.equal(evaluateReservationCapability(base).allowed, true)
  const missing = evaluateReservationCapability({ ...base, userFactoryId: null })
  assert.equal(missing.allowed, false)
  assert.match(missing.reason || '', /не указан завод/)
  const another = evaluateReservationCapability({ ...base, targetFactoryId: 'uzhgorod' })
  assert.equal(another.allowed, false)
  assert.match(another.reason || '', /другому заводу/)
})

test('all factories broadens scope but never grants inventory management', () => {
  assert.equal(evaluateReservationCapability({ ...base, userFactoryId: null, targetFactoryId: 'uzhgorod', inventoryFactoryScope: 'all' }).allowed, true)
  const withoutManage = evaluateReservationCapability({ ...base, hasInventoryManage: false, inventoryFactoryScope: 'all' })
  assert.equal(withoutManage.allowed, false)
  assert.equal(withoutManage.reason, 'Нет права управлять складом')
})

test('active CRM administrator retains factory access while blocked workflow rights stay explicit', () => {
  assert.equal(evaluateReservationCapability({ ...base, isAdmin: true, userFactoryId: null, targetFactoryId: 'uzhgorod' }).allowed, true)
  const denied = evaluateReservationCapability({ ...base, hasWorkflowPermission: false, isAdmin: false })
  assert.equal(denied.allowed, false)
  assert.equal(denied.reason, base.workflowDeniedReason)
})
