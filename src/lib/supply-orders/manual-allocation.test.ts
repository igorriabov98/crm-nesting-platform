import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateManualAllocation } from './manual-allocation'

test('3/2 quantity receipt supports 1+1, 0+2, and a free remainder', () => {
  const onePlusOne = quantityAllocation([1, 1], 2)
  assert.equal(onePlusOne.allocatedPhysical, 2)
  assert.equal(onePlusOne.freeQuantity, 0)
  assert.equal(onePlusOne.canConfirm, true)

  const zeroPlusTwo = quantityAllocation([0, 2], 2)
  assert.equal(zeroPlusTwo.allocatedPhysical, 2)
  assert.equal(zeroPlusTwo.allocatedLogical, 2)
  assert.equal(zeroPlusTwo.canConfirm, true)

  const leaveOneFree = quantityAllocation([0, 1], 2)
  assert.equal(leaveOneFree.allocatedPhysical, 1)
  assert.equal(leaveOneFree.freeQuantity, 1)
  assert.equal(leaveOneFree.canConfirm, true)
})

test('quantity receipt rejects all-zero, per-machine overflow, and receipt overflow', () => {
  assert.equal(quantityAllocation([0, 0], 2).canConfirm, false)

  const machineOverflow = quantityAllocation([2, 0], 2)
  assert.equal(machineOverflow.invalidRows, true)
  assert.equal(machineOverflow.canConfirm, false)

  const receiptOverflow = quantityAllocation([1, 2], 2)
  assert.equal(receiptOverflow.exceedsReceipt, true)
  assert.equal(receiptOverflow.canConfirm, false)
})

test('whole bars preserve physical, logical, future-scrap, and free-piece totals', () => {
  const result = calculateManualAllocation({
    mode: 'whole_bar',
    receivedQuantity: 18_000,
    pieceLengthMm: 6_000,
    pieceCount: 3,
    rows: [
      row('machine-a', 1, 1, 2_000),
      row('machine-b', 1, 1, 6_000),
    ],
  })

  assert.equal(result.allocatedPieces, 2)
  assert.equal(result.allocatedPhysical, 12_000)
  assert.equal(result.allocatedLogical, 8_000)
  assert.equal(result.futureScrap, 4_000)
  assert.equal(result.freePieces, 1)
  assert.equal(result.freeQuantity, 6_000)
  assert.equal(result.canConfirm, true)
})

test('whole-bar allocation accepts only integer piece counts', () => {
  const result = calculateManualAllocation({
    mode: 'whole_bar',
    receivedQuantity: 6_000,
    pieceLengthMm: 6_000,
    pieceCount: 1,
    rows: [row('machine-a', 0.5, 1, 2_000)],
  })

  assert.equal(result.invalidRows, true)
  assert.equal(result.canConfirm, false)
})

function quantityAllocation(values: number[], receivedQuantity: number) {
  return calculateManualAllocation({
    mode: 'quantity',
    receivedQuantity,
    pieceLengthMm: null,
    pieceCount: null,
    rows: [
      row('needs-one', values[0] || 0, 1, 1),
      row('needs-two', values[1] || 0, 2, 2),
    ],
  })
}

function row(key: string, value: number, max: number, outstandingQuantity: number) {
  return { key, value, max, isEligible: true, outstandingQuantity }
}
