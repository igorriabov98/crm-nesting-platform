import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveActualMaterialDate } from './material-completion'

test('uses the latest completion date when delivered and cancelled materials close a machine', () => {
  assert.equal(resolveActualMaterialDate([
    { status: 'delivered', completionDates: ['2026-09-07T12:30:00Z'] },
    { status: 'cancelled', completionDates: ['2026-09-08T08:00:00Z'] },
  ], '2026-09-09'), '2026-09-08')
})

test('an all-cancelled material request is complete', () => {
  assert.equal(resolveActualMaterialDate([
    { status: 'cancelled', completionDates: ['2026-09-06T15:00:00Z'] },
  ], '2026-09-09'), '2026-09-06')
})

test('uses the reconciliation day when a legacy cancellation has no timestamp', () => {
  assert.equal(resolveActualMaterialDate([
    { status: 'cancelled', completionDates: [null] },
  ], '2026-09-09'), '2026-09-09')
})

test('does not complete a machine while any required material remains open', () => {
  assert.equal(resolveActualMaterialDate([
    { status: 'delivered', completionDates: ['2026-09-08'] },
    { status: 'open' },
    { status: 'cancelled', completionDates: ['2026-09-07'] },
  ], '2026-09-09'), null)
})

test('does not invent a material date when no required materials exist', () => {
  assert.equal(resolveActualMaterialDate([], '2026-09-09'), null)
})
