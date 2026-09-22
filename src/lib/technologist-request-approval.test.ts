import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateWasteAggregate,
  compareApprovalSnapshots,
  formatApprovalVersion,
  type ApprovalSummarySnapshot,
} from './technologist-request-approval'

test('uses the actual request number for its revision series', () => {
  assert.equal(formatApprovalVersion(0, 3), '3')
  assert.equal(formatApprovalVersion(1, 3), '3.1')
  assert.equal(formatApprovalVersion(2, 3), '3.2')
})

test('calculates simple and weight-adjusted waste and excludes missing percentages', () => {
  const result = calculateWasteAggregate([
    { weightKg: 100, wastePercent: 10 },
    { weightKg: 300, wastePercent: 20 },
    { weightKg: 900, wastePercent: null },
  ])
  assert.equal(result.count, 2)
  assert.equal(result.averagePercent, 15)
  assert.equal(result.weightedPercent, 17.5)
})

test('returns no weighted result for zero weight but preserves the simple average', () => {
  const result = calculateWasteAggregate([
    { weightKg: 0, wastePercent: 12 },
    { weightKg: null, wastePercent: 18 },
  ])
  assert.equal(result.averagePercent, 15)
  assert.equal(result.weightedPercent, null)
})

function snapshot(items: ApprovalSummarySnapshot['items']): ApprovalSummarySnapshot {
  return {
    schemaVersion: 1, requestId: 'request', machineId: 'machine', orderName: 'Заказ', materialType: 'standard',
    items, futureItems: [], enteredPlasmaMinutes: 0, archives: [],
  }
}

test('compares versions by stable table and row identifiers', () => {
  const shared = { category: 'metal', categoryLabel: 'Металл', unit: 'кг', weightKg: 10, businessScrapReserved: 0, regularStockReserved: 0, wastePercent: 10 }
  const before = snapshot([
    { ...shared, key: 'request_sheet_metal:a', name: 'A', quantity: 1 },
    { ...shared, key: 'request_sheet_metal:b', name: 'B', quantity: 1 },
  ])
  const after = snapshot([
    { ...shared, key: 'request_sheet_metal:a', name: 'A', quantity: 2 },
    { ...shared, key: 'request_sheet_metal:c', name: 'C', quantity: 1 },
  ])
  const diff = compareApprovalSnapshots(before, after)
  assert.deepEqual(diff.added.map((item) => item.key), ['request_sheet_metal:c'])
  assert.deepEqual(diff.removed.map((item) => item.key), ['request_sheet_metal:b'])
  assert.deepEqual(diff.changed[0]?.fields, ['quantity'])
})
