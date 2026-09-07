import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateSupplyReceiptProgress,
  deliveredSupplyPieceCount,
  deliveredSupplyQuantity,
} from './receiving-supply-progress'

test('whole-bar progress uses the physical purchase plan instead of the cutting need', () => {
  assert.deepEqual(calculateSupplyReceiptProgress({
    requestedQuantity: 6_000,
    requestedPieceCount: 1,
    schedules: [],
  }), {
    requestedQuantity: 6_000,
    deliveredQuantity: 0,
    outstandingQuantity: 6_000,
    requestedPieceCount: 1,
    deliveredPieceCount: 0,
    outstandingPieceCount: 1,
  })
})

test('previous whole-bar receipts close physical millimetres and pieces', () => {
  const delivered = {
    status: 'delivered',
    allocated_quantity: 4_500,
    allocated_physical_quantity: 6_000,
    allocated_piece_count: 1,
    received_quantity: 6_000,
    received_piece_length_mm: 6_000,
    received_piece_count: 1,
  }

  assert.equal(deliveredSupplyQuantity(delivered), 6_000)
  assert.equal(deliveredSupplyPieceCount(delivered), 1)
  assert.deepEqual(calculateSupplyReceiptProgress({
    requestedQuantity: 12_000,
    requestedPieceCount: 2,
    schedules: [delivered],
  }), {
    requestedQuantity: 12_000,
    deliveredQuantity: 6_000,
    outstandingQuantity: 6_000,
    requestedPieceCount: 2,
    deliveredPieceCount: 1,
    outstandingPieceCount: 1,
  })
})

test('logical cutting coverage never replaces physical supplier receipt', () => {
  const progress = calculateSupplyReceiptProgress({
    requestedQuantity: 12_000,
    requestedPieceCount: 2,
    schedules: [{
      status: 'delivered',
      allocated_quantity: 9_000,
      allocated_physical_quantity: 12_000,
      allocated_piece_count: 2,
      received_quantity: 12_000,
      received_piece_length_mm: 6_000,
      received_piece_count: 2,
    }],
  })

  assert.equal(progress.deliveredQuantity, 12_000)
  assert.equal(progress.deliveredPieceCount, 2)
  assert.equal(progress.outstandingQuantity, 0)
  assert.equal(progress.outstandingPieceCount, 0)
})

test('planned and cancelled schedules are not counted as previous receipts', () => {
  const progress = calculateSupplyReceiptProgress({
    requestedQuantity: 25,
    requestedPieceCount: null,
    schedules: [
      { status: 'planned', received_quantity: 25, allocated_quantity: 25 },
      { status: 'cancelled', received_quantity: 25, allocated_quantity: 25 },
      { status: 'delivered', received_quantity: 3, allocated_quantity: 3 },
    ],
  })

  assert.deepEqual(progress, {
    requestedQuantity: 25,
    deliveredQuantity: 3,
    outstandingQuantity: 22,
    requestedPieceCount: null,
    deliveredPieceCount: null,
    outstandingPieceCount: null,
  })
})

test('overdelivery remains visible while outstanding supply is clamped at zero', () => {
  const progress = calculateSupplyReceiptProgress({
    requestedQuantity: 10,
    requestedPieceCount: null,
    schedules: [{ status: 'delivered', received_quantity: 12, allocated_quantity: 12 }],
  })

  assert.equal(progress.deliveredQuantity, 12)
  assert.equal(progress.outstandingQuantity, 0)
})
