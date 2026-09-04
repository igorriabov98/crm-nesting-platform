import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareCustomsClearanceMachines,
  filterCustomsClearanceMachines,
  getCustomsClearanceState,
  localDateKey,
  type CustomsClearanceMachine,
} from './customs-clearance'
import { validateCustomsClearanceFile } from './customs-clearance-files'

function machine(overrides: Partial<CustomsClearanceMachine> = {}): CustomsClearanceMachine {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Машина А',
    factoryId: 'factory-a',
    factoryName: 'Берегово',
    shippingReadinessDate: '2026-09-10',
    customsClearanceDate: null,
    deliveryToClientDate: null,
    documents: [],
    ...overrides,
  }
}

test('moves a machine to cleared only when delivery, customs date and a document exist', () => {
  const complete = machine({
    customsClearanceDate: '2026-09-09',
    deliveryToClientDate: '2026-09-12',
    documents: [{
      id: 'document', documentKind: 'other', fileName: 'file.pdf', mimeType: 'application/pdf',
      fileSize: 10, uploadedBy: 'user', uploadedByName: 'Брокер', createdAt: '2026-09-09T10:00:00Z',
    }],
  })
  assert.equal(getCustomsClearanceState(complete).cleared, true)
  assert.equal(getCustomsClearanceState({ ...complete, documents: [] }).cleared, false)
  assert.equal(getCustomsClearanceState({ ...complete, customsClearanceDate: null }).cleared, false)
  assert.equal(getCustomsClearanceState({ ...complete, deliveryToClientDate: null }).cleared, false)
})

test('marks delivery with missing customs evidence as visibly incomplete', () => {
  const state = getCustomsClearanceState(machine({ deliveryToClientDate: '2026-09-12' }))
  assert.equal(state.incompleteAfterDelivery, true)
  assert.deepEqual(state.missing, ['дата затаможивания', 'прикреплённый документ'])
})

test('filters by tab, factory and machine name', () => {
  const cleared = machine({
    id: 'cleared', name: 'Линия Ужгород', factoryId: 'factory-b',
    customsClearanceDate: '2026-09-09', deliveryToClientDate: '2026-09-12',
    documents: [{ id: 'doc', documentKind: 'invoice', fileName: 'i.pdf', mimeType: 'application/pdf', fileSize: 10, uploadedBy: 'u', uploadedByName: 'Брокер', createdAt: '2026-09-09' }],
  })
  const active = machine({ id: 'active', name: 'Линия Берегово' })
  assert.deepEqual(filterCustomsClearanceMachines([cleared, active], {
    tab: 'active', factoryId: 'factory-a', search: 'берег', sort: 'default',
  }).map((item) => item.id), ['active'])
  assert.deepEqual(filterCustomsClearanceMachines([cleared, active], {
    tab: 'cleared', factoryId: 'factory-b', search: 'ужгород', sort: 'delivery',
  }).map((item) => item.id), ['cleared'])
})

test('default sorting puts overdue first and then nearest readiness', () => {
  const overdue = machine({ id: 'overdue', shippingReadinessDate: '2026-09-03' })
  const near = machine({ id: 'near', shippingReadinessDate: '2026-09-05' })
  const far = machine({ id: 'far', shippingReadinessDate: '2026-09-20' })
  const ordered = [far, near, overdue].sort((left, right) =>
    compareCustomsClearanceMachines(left, right, 'default', '2026-09-04'))
  assert.deepEqual(ordered.map((item) => item.id), ['overdue', 'near', 'far'])
})

test('uses the local calendar day instead of UTC for due-state comparisons', () => {
  assert.equal(localDateKey(new Date(2026, 8, 4, 0, 30)), '2026-09-04')
})

test('validates the document extension, canonical MIME type and size', () => {
  assert.deepEqual(validateCustomsClearanceFile({
    fileName: 'invoice.PDF',
    fileSize: 1024,
    contentType: 'Application/PDF; charset=binary',
  }), {
    fileName: 'invoice.PDF',
    extension: '.pdf',
    mimeType: 'application/pdf',
  })
  assert.throws(
    () => validateCustomsClearanceFile({ fileName: 'invoice.pdf', fileSize: 1024, contentType: 'image/png' }),
    /не соответствует расширению/,
  )
  assert.throws(
    () => validateCustomsClearanceFile({ fileName: 'script.exe', fileSize: 1024, contentType: 'application/octet-stream' }),
    /Разрешены PDF/,
  )
  assert.throws(
    () => validateCustomsClearanceFile({ fileName: 'invoice.pdf', fileSize: 25 * 1024 * 1024 + 1 }),
    /25 МБ/,
  )
})
