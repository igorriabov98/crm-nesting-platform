import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocateReceiptByPriority,
  committedScheduleQuantity,
  outstandingReceivingQuantity,
} from './receiving-quantity.mjs'

test('delivered schedules count logical allocation instead of warehouse excess', () => {
  const schedule = {
    status: 'delivered',
    quantity: 12_000,
    received_quantity: 12_000,
    allocated_quantity: 6_000,
  }
  assert.equal(committedScheduleQuantity(schedule), 6_000)
  assert.equal(outstandingReceivingQuantity(10_000, [schedule]), 4_000)
})

test('normal receipt closes the earliest preparation demands and leaves excess free', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 25,
    candidates: [
      candidate('late', '2026-08-10', 10),
      candidate('early', '2026-07-20', 8),
      candidate('middle', '2026-07-25', 4),
    ],
  })

  assert.deepEqual(result.allocations.map((row) => [row.key, row.quantity]), [
    ['early', 8],
    ['middle', 4],
    ['late', 10],
  ])
  assert.equal(result.excessQuantity, 3)
})

test('3/2 shortage suggests 1+1 by cutting date and leaves the choice editable', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 2,
    candidates: [
      candidate('needs-two', '2026-08-01', 2, {
        table: 'request_components',
        cuttingDate: '2026-08-12',
        materialDate: '2026-08-01',
      }),
      candidate('needs-one', '2026-08-02', 1, {
        table: 'request_components',
        cuttingDate: '2026-08-10',
        materialDate: '2026-08-02',
      }),
    ],
  })

  assert.deepEqual(result.allocations.map((row) => [row.key, row.quantity]), [
    ['needs-one', 1],
    ['needs-two', 1],
  ])
  assert.equal(result.excessQuantity, 0)
})

test('quantity priority uses cutting date before material-plan date', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 1,
    candidates: [
      candidate('early-material', '2026-08-01', 1, {
        cuttingDate: '2026-08-20',
        materialDate: '2026-08-01',
      }),
      candidate('early-cutting', '2026-08-10', 1, {
        cuttingDate: '2026-08-15',
        materialDate: '2026-08-10',
      }),
    ],
  })

  assert.deepEqual(result.allocations.map((row) => row.key), ['early-cutting'])
})

test('receipt keeps a separate target request for every destination machine', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 9,
    candidates: [
      candidate('machine-later', '2026-07-25', 5),
      candidate('machine-nearest', '2026-07-20', 4, { isSource: true }),
    ],
  })

  assert.deepEqual(result.allocations.map((row) => ({ id: row.id, quantity: row.quantity })), [
    { id: 'machine-nearest', quantity: 4 },
    { id: 'machine-later', quantity: 5 },
  ])
  assert.equal(result.excessQuantity, 0)
})

test('a committed future shipment is not duplicated by receipt spillover', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 12,
    candidates: [
      candidate('source', '2026-07-20', 5, { isSource: true }),
      candidate('planned', '2026-07-21', 5, { hasOtherPlannedSchedule: true }),
      candidate('free', '2026-07-22', 5),
    ],
  })

  assert.deepEqual(result.allocations.map((row) => [row.key, row.quantity]), [
    ['source', 5],
    ['free', 5],
  ])
  assert.equal(result.excessQuantity, 2)
})

test('one 12000 mm knife bar closes 6000 mm but reserves the whole physical bar', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 12_000,
    pieceLengthMm: 12_000,
    pieceCount: 1,
    candidates: [candidate('knife', '2026-07-20', 6_000, { isSource: true })],
  })

  assert.deepEqual(result.allocations, [{
    table: 'request_knives',
    id: 'knife',
    key: 'knife',
    quantity: 6_000,
    physical_quantity: 12_000,
    piece_count: 1,
  }])
  assert.equal(result.excessQuantity, 0)
})

test('one 6000 mm supplier bar closes the 1000 mm left after a 6000 mm stock reservation', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 6_000,
    pieceLengthMm: 6_000,
    pieceCount: 1,
    candidates: [candidate('knife-after-stock', '2026-08-28', 1_000, { isSource: true })],
  })

  assert.deepEqual(result.allocations, [{
    table: 'request_knives',
    id: 'knife-after-stock',
    key: 'knife-after-stock',
    quantity: 1_000,
    physical_quantity: 6_000,
    piece_count: 1,
  }])
  assert.equal(result.allocations[0].physical_quantity - result.allocations[0].quantity, 5_000)
  assert.equal(result.excessQuantity, 0)
})

test('extra knife bars satisfy later demands before becoming free stock', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 36_000,
    pieceLengthMm: 12_000,
    pieceCount: 3,
    candidates: [
      candidate('later', '2026-08-10', 6_000),
      candidate('nearest', '2026-07-20', 6_000, { isSource: true }),
    ],
  })

  assert.deepEqual(result.allocations.map((row) => [row.key, row.quantity, row.physical_quantity]), [
    ['nearest', 6_000, 12_000],
    ['later', 6_000, 12_000],
  ])
  assert.equal(result.excessQuantity, 12_000)
})

test('bar priority uses cutting date before material-plan date', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 6_000,
    pieceLengthMm: 6_000,
    pieceCount: 1,
    candidates: [
      candidate('early-material', '2026-07-20', 2_000, {
        cuttingDate: '2026-08-10',
        materialDate: '2026-07-20',
      }),
      candidate('early-cutting', '2026-07-25', 2_000, {
        cuttingDate: '2026-08-01',
        materialDate: '2026-07-25',
      }),
    ],
  })

  assert.deepEqual(result.allocations.map((row) => row.key), ['early-cutting'])
})

test('two 6000 mm bars reserve one for a 2000 mm need and leave one untouched', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 12_000,
    pieceLengthMm: 6_000,
    pieceCount: 2,
    candidates: [candidate('circle', '2026-08-01', 2_000, {
      table: 'request_circle',
      isSource: true,
    })],
  })

  assert.deepEqual(result.allocations, [{
    table: 'request_circle',
    id: 'circle',
    key: 'circle',
    quantity: 2_000,
    physical_quantity: 6_000,
    piece_count: 1,
  }])
  assert.equal(result.excessQuantity, 6_000)
})

test('an 8000 mm non-wire pipe need uses two whole 6000 mm bars', () => {
  const result = allocateReceiptByPriority({
    receivedQuantity: 12_000,
    pieceLengthMm: 6_000,
    pieceCount: 2,
    candidates: [candidate('pipe', '2026-08-01', 8_000, {
      table: 'request_pipe',
      isSource: true,
    })],
  })

  assert.equal(result.allocations[0].quantity, 8_000)
  assert.equal(result.allocations[0].physical_quantity, 12_000)
  assert.equal(result.allocations[0].piece_count, 2)
  assert.equal(result.excessQuantity, 0)
})

function candidate(key, priorityDate, outstandingQuantity, overrides = {}) {
  return {
    key,
    table: 'request_knives',
    id: key,
    priorityDate,
    outstandingQuantity,
    ...overrides,
  }
}
