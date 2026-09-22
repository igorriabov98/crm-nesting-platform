import assert from 'node:assert/strict'
import test from 'node:test'
import { wholeBarReceiptCapacity, wholeBarLogicalQuantity } from './whole-bar-receiving'
import { calculateManualAllocation } from './manual-allocation'
import { buildMaterialReceiptBatchCalls } from './receiving-batches'
import type { LongStockPurchasePlan } from './long-stock-purchase-plan'

export const plan19: LongStockPurchasePlan = {
  plan_id: 'plan-19', plan_number: 19, version_id: 'version-1', version_number: 1,
  version_status: 'approved', cutting_status: 'plan_approved',
  components: [{ length_mm: 6000, piece_count: 2, is_nonstandard: false }],
  total_piece_count: 2, total_length_mm: 12000, uses_nonstandard_length: false,
  receipt_bars: [{ length_mm: 6000, logical_quantity: 5500 }, { length_mm: 6000, logical_quantity: 500 }],
}

test('CIV-19: twelve 500 mm cuts require both bars of the approved 11+1 layout', () => {
  const capacity = wholeBarReceiptCapacity({ plan: plan19, schedules: [], plannedPieceLengthMm: 6000,
    receivedPieceLengthMm: 6000, outstandingLogicalQuantity: 6000 })
  assert.equal(capacity.neededPieceCount, 2)
  assert.deepEqual(capacity.logicalQuantitiesByPiece, [5500, 500])
  const calculate = (pieces: number) => calculateManualAllocation({
    mode: 'whole_bar', receivedQuantity: 12000, pieceLengthMm: 6000, pieceCount: 2,
    rows: [{ key: 'circle-20', value: pieces, max: capacity.neededPieceCount, isEligible: true,
      outstandingQuantity: 6000, logicalQuantitiesByPiece: capacity.logicalQuantitiesByPiece }],
  })
  assert.equal(calculate(2).canConfirm, true)
  assert.equal(calculate(2).allocatedPhysical, 12000)
  assert.equal(calculate(2).allocatedLogical, 6000)
  assert.equal(calculate(1).allocatedLogical, 5500)
  assert.equal(calculate(3).canConfirm, false)
  assert.equal(calculate(1.5).canConfirm, false)
})

test('a partial receipt leaves the second physical bar and its 500 mm cut open', () => {
  const capacity = wholeBarReceiptCapacity({ plan: plan19,
    schedules: [{ status: 'delivered', planned_piece_length_mm: 6000, received_piece_length_mm: 6000,
      received_piece_count: 2, allocated_piece_count: 1, allocated_quantity: 5500,
      allocated_physical_quantity: 6000 }],
    plannedPieceLengthMm: 6000, receivedPieceLengthMm: 6000, outstandingLogicalQuantity: 500 })
  assert.equal(capacity.neededPieceCount, 1)
  assert.deepEqual(capacity.logicalQuantitiesByPiece, [500])
  assert.equal(wholeBarLogicalQuantity(1, 6000, 500, capacity.logicalQuantitiesByPiece), 500)
})

test('different planned lengths have separate piece limits', () => {
  const plan = { ...plan19, components: [...plan19.components,
    { length_mm: 12000, piece_count: 1, is_nonstandard: false }],
    receipt_bars: [...plan19.receipt_bars!, { length_mm: 12000, logical_quantity: 8000 }] }
  assert.equal(wholeBarReceiptCapacity({ plan, schedules: [], plannedPieceLengthMm: 6000,
    receivedPieceLengthMm: 6000, outstandingLogicalQuantity: 14000 }).neededPieceCount, 2)
  assert.equal(wholeBarReceiptCapacity({ plan, schedules: [], plannedPieceLengthMm: 12000,
    receivedPieceLengthMm: 12000, outstandingLogicalQuantity: 14000 }).neededPieceCount, 1)
})

test('a measured length discrepancy preserves planned pieces for the recalculation flow', () => {
  assert.equal(wholeBarReceiptCapacity({ plan: plan19, schedules: [], plannedPieceLengthMm: 6000,
    receivedPieceLengthMm: 5900, outstandingLogicalQuantity: 6000 }).neededPieceCount, 2)
})

test('invalid, incomplete or over-received layouts fail closed', () => {
  for (const plan of [
    { ...plan19, version_status: 'invalid' as const },
    { ...plan19, receipt_bars: undefined },
    { ...plan19, receipt_bars: [{ length_mm: 6000, logical_quantity: 5500 }] },
  ]) assert.throws(() => wholeBarReceiptCapacity({ plan, schedules: [], plannedPieceLengthMm: 6000,
    receivedPieceLengthMm: 6000, outstandingLogicalQuantity: 6000 }), /карт/)
  assert.throws(() => wholeBarReceiptCapacity({ plan: plan19,
    schedules: [{ status: 'delivered', planned_piece_length_mm: 6000, allocated_piece_count: 3 }],
    plannedPieceLengthMm: 6000, receivedPieceLengthMm: 6000, outstandingLogicalQuantity: 6000 }), /Ранее принятые/)
})

test('legacy bars keep their logical-need fallback', () => {
  assert.deepEqual(wholeBarReceiptCapacity({ plan: null, schedules: [], plannedPieceLengthMm: null,
    receivedPieceLengthMm: 6000, outstandingLogicalQuantity: 10300 }),
  { neededPieceCount: 2, logicalQuantitiesByPiece: null })
})

test('two schedule rows preserve 11+1 coverage instead of closing all cuts on the first bar', () => {
  const calls = buildMaterialReceiptBatchCalls({
    schedules: [0, 1].map((i) => ({ id: `schedule-${i}`, quantity: 6000, planned_piece_count: 1,
      created_at: `2026-09-20T00:00:0${i}Z` })),
    received_quantity: 12000, received_piece_length_mm: 6000, received_piece_count: 2,
    allocations: [{ table: 'request_circle', id: 'circle-20', quantity: 6000, physical_quantity: 12000,
      piece_count: 2, logical_quantities_by_piece: [5500, 500] }],
  })
  assert.deepEqual(calls.map((call) => call.allocations.map((row) => [row.quantity, row.physical_quantity, row.piece_count])),
    [[[5500, 6000, 1]], [[500, 6000, 1]]])
})
