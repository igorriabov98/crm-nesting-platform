import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertLongStockRecoverySegmentTotal,
  candidatePurchaseComposition,
  candidateRemainderPreview,
  candidateWastePercent,
  candidatesForLongStockMode,
  cutDisplayLabel,
  DEFAULT_MIXED_LONG_STOCK_LENGTHS,
  expandLongStockSegmentRows,
  filterLongStockCandidatesByReservedStock,
  longStockCutColorMap,
  shouldShowBarSegmentLabel,
  totalLongStockSegmentLength,
  upsertLongStockRequestRow,
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

test('requires legacy recovery cuts to preserve the request demand total', () => {
  assert.doesNotThrow(() => assertLongStockRecoverySegmentTotal([
    { id: 'a', lengthMm: 3000 },
    { id: 'b', lengthMm: 3000 },
    { id: 'c', lengthMm: 2000 },
  ], 8000))
  assert.throws(
    () => assertLongStockRecoverySegmentTotal([{ id: 'a', lengthMm: 3000 }], 8000),
    /Сумма отрезков должна равняться потребности позиции: 8000 мм/,
  )
})

test('keeps only layouts that use the exact physical reserved bar composition', () => {
  const oneBar = {
    key: 'one-bar',
    bars: [{ source: 'new_stock', stockLengthMm: 12000 }],
  } as LongStockCuttingCandidate
  const twoBars = {
    key: 'two-bars',
    bars: [
      { source: 'new_stock', stockLengthMm: 6000 },
      { source: 'new_stock', stockLengthMm: 6000 },
    ],
  } as LongStockCuttingCandidate
  const wrongLength = {
    key: 'wrong-length',
    bars: [{ source: 'new_stock', stockLengthMm: 9000 }],
  } as LongStockCuttingCandidate

  assert.deepEqual(
    filterLongStockCandidatesByReservedStock(
      [oneBar, twoBars, wrongLength],
      [{ lengthMm: 12000, pieceCount: 1 }],
    ).map((candidate) => candidate.key),
    ['one-bar'],
  )
  assert.deepEqual(
    filterLongStockCandidatesByReservedStock(
      [oneBar, twoBars, wrongLength],
      [{ lengthMm: 6000, pieceCount: 2 }],
    ).map((candidate) => candidate.key),
    ['two-bars'],
  )
  assert.deepEqual(
    filterLongStockCandidatesByReservedStock(
      [oneBar, twoBars, wrongLength],
      [{ lengthMm: 12000, pieceCount: 1 }, { lengthMm: 6000, pieceCount: 1 }],
    ),
    [],
  )
})

test('defaults to mixed standard lengths', () => {
  assert.equal(DEFAULT_MIXED_LONG_STOCK_LENGTHS, true)
})

test('keeps one request row when server revalidation already returned the approved draft', () => {
  const approved = { id: 'request-row', value: 'approved' }
  assert.deepEqual(upsertLongStockRequestRow([], approved), [approved])
  assert.deepEqual(
    upsertLongStockRequestRow([{ id: 'request-row', value: 'server' }], approved),
    [approved],
  )
})

test('formats the purchased composition in descending order and excludes warehouse remnants', () => {
  const candidate = {
    totalRemainderMm: 4450,
    bars: [
      { source: 'new_stock', stockLengthMm: 6000 },
      { source: 'new_stock', stockLengthMm: 12000 },
      { source: 'business_remnant', stockLengthMm: 8500 },
      { source: 'new_stock', stockLengthMm: 6000 },
      { source: 'new_stock', stockLengthMm: 12000 },
    ],
  } as LongStockCuttingCandidate
  assert.equal(candidatePurchaseComposition(candidate), '12 000 × 2 + 6 000 × 2')
  assert.equal(candidateWastePercent(candidate), 10)
})

test('keeps the single-length fallback in mixed mode and removes mixed candidates when disabled', () => {
  const single = {
    key: 'single',
    kind: 'single_length',
    purchasedLengthMm: 24000,
    newBarCount: 2,
  } as LongStockCuttingCandidate
  const mixed = {
    key: 'mixed',
    kind: 'mixed_lengths',
    purchasedLengthMm: 22000,
    newBarCount: 3,
  } as LongStockCuttingCandidate

  assert.deepEqual(candidatesForLongStockMode([single, mixed], true).map((candidate) => candidate.key), ['mixed', 'single'])
  assert.deepEqual(candidatesForLongStockMode([single, mixed], false).map((candidate) => candidate.key), ['single'])
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

test('uses one color per cut length and a different color for another length', () => {
  const colors = longStockCutColorMap([1200, 850, 1200])
  assert.equal(colors.get(1200), colors.get(1200))
  assert.notEqual(colors.get(1200), colors.get(850))
})
