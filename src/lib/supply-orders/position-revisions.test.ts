import assert from 'node:assert/strict'
import test from 'node:test'

import { supplyPositionHasPhysicalReceipt } from './position-revisions'

const schedule = (fields: Partial<Parameters<typeof supplyPositionHasPhysicalReceipt>[0][number]> = {}) => ({
  status: 'planned', received_quantity: 0, allocated_quantity: 0,
  allocated_physical_quantity: 0, received_piece_count: 0, allocated_piece_count: 0,
  ...fields,
})

test('частичная приёмка закрывает возврат технологу, даже если довоз ещё запланирован', () => {
  assert.equal(supplyPositionHasPhysicalReceipt([
    schedule({ received_quantity: 2 }), schedule(),
  ]), true)
  assert.equal(supplyPositionHasPhysicalReceipt([schedule()]), false)
})

test('физическое распределение и уже принятая дата также закрывают возврат', () => {
  assert.equal(supplyPositionHasPhysicalReceipt([schedule({ allocated_physical_quantity: 1 })]), true)
  assert.equal(supplyPositionHasPhysicalReceipt([schedule({ status: 'delivered' })]), true)
})
