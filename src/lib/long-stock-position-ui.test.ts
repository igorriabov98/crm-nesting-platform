import assert from 'node:assert/strict'
import test from 'node:test'
import {
  candidateComposition,
  candidateRemainderPreview,
  candidateWastePercent,
  cutDisplayLabel,
  expandLongStockSegmentRows,
  shouldShowBarSegmentLabel,
  totalLongStockSegmentLength,
} from '@/lib/long-stock-position-ui'
import type { LongStockCuttingCandidate } from '@/lib/long-stock-cutting-solver'

test('expands length and quantity rows into stable workpieces', () => {
  const segments = expandLongStockSegmentRows([
    { id: 'row-a', lengthMm: '1200', quantity: '2' },
    { id: 'row-b', lengthMm: 850, quantity: 1 },
  ])
  assert.deepEqual(segments, [
    { id: 'row-a-1', lengthMm: 1200 },
    { id: 'row-a-2', lengthMm: 1200 },
    { id: 'row-b-1', lengthMm: 850 },
  ])
  assert.equal(totalLongStockSegmentLength(segments), 3250)
})

test('rejects a non-integer quantity and points to the row', () => {
  assert.throws(
    () => expandLongStockSegmentRows([{ id: 'row-a', lengthMm: 1200, quantity: 1.5 }]),
    /Строка 1: количество/,
  )
})

test('formats a mixed candidate composition and waste percent', () => {
  const candidate = {
    totalRemainderMm: 1450,
    bars: [
      { source: 'new_stock', stockLengthMm: 6000 },
      { source: 'new_stock', stockLengthMm: 8500 },
    ],
  } as LongStockCuttingCandidate
  assert.equal(candidateComposition(candidate), '6 000 × 1 + 8 500 × 1')
  assert.equal(candidateWastePercent(candidate), 10)
})

test('sorts remainder pieces and abbreviates only lists longer than three pieces', () => {
  const twoPieces = {
    bars: [
      { remainderMm: 96 },
      { remainderMm: 3699 },
    ],
  } as LongStockCuttingCandidate
  assert.deepEqual(candidateRemainderPreview(twoPieces), {
    pieces: [3699, 96],
    visiblePieces: [3699, 96],
    hiddenCount: 0,
  })

  const fourPieces = {
    bars: [
      { remainderMm: 96 },
      { remainderMm: 3699 },
      { remainderMm: 850 },
      { remainderMm: 1200 },
      { remainderMm: 0 },
    ],
  } as LongStockCuttingCandidate
  assert.deepEqual(candidateRemainderPreview(fourPieces), {
    pieces: [3699, 1200, 850, 96],
    visiblePieces: [3699, 1200],
    hiddenCount: 2,
  })
})

test('uses user-facing cut labels and omits labels on short bar segments', () => {
  assert.equal(cutDisplayLabel(2), 'Рез 2')
  assert.equal(cutDisplayLabel(2).includes('segment-row'), false)
  assert.equal(shouldShowBarSegmentLabel(96, 6000), false)
  assert.equal(shouldShowBarSegmentLabel(600, 6000), true)
})
