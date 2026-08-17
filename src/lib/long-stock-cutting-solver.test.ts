import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateLongStockBarRemainder,
  solveLongStockCutting,
  type LongStockCuttingCandidate,
  type LongStockSolverInput,
} from './long-stock-cutting-solver'

const referenceWorkpieces = [
  { id: '1200-1', lengthMm: 1200 },
  { id: '1200-2', lengthMm: 1200 },
  { id: '1200-3', lengthMm: 1200 },
  { id: '2300-1', lengthMm: 2300 },
  { id: '2300-2', lengthMm: 2300 },
]

const referenceInput: LongStockSolverInput = {
  workpieces: referenceWorkpieces,
  purchaseLengths: [
    { lengthMm: 6000, kind: 'standard' },
    { lengthMm: 8000, kind: 'nonstandard' },
    { lengthMm: 12000, kind: 'standard' },
  ],
  kerfMm: 1,
  endTrimMm: 0,
  mode: 'optimal',
}

function singleLengthCandidate(candidates: LongStockCuttingCandidate[], lengthMm: number) {
  const candidate = candidates.find((item) =>
    item.kind === 'single_length' && item.purchaseLengthsMm[0] === lengthMm)
  if (!candidate) assert.fail(`candidate for ${lengthMm} mm must exist`)
  return candidate
}

function newBarRemainders(candidate: LongStockCuttingCandidate) {
  return candidate.bars
    .filter((bar) => bar.source === 'new_stock')
    .map((bar) => bar.remainderMm)
    .sort((left, right) => left - right)
}

function newBarCutSignatures(candidate: LongStockCuttingCandidate) {
  return candidate.bars
    .filter((bar) => bar.source === 'new_stock')
    .map((bar) => bar.cuts.map((cut) => cut.lengthMm).sort((a, b) => b - a).join('+'))
    .sort()
}

test('matches reference layouts and charges kerf for every workpiece', () => {
  const result = solveLongStockCutting(referenceInput)

  const sixMetres = singleLengthCandidate(result.candidates, 6000)
  assert.equal(sixMetres.newBarCount, 2)
  assert.deepEqual(newBarRemainders(sixMetres), [96, 3699])
  assert.deepEqual(newBarCutSignatures(sixMetres), ['2300', '2300+1200+1200+1200'])
  assert.notDeepEqual(
    newBarCutSignatures(sixMetres),
    ['1200+1200', '2300+2300+1200'],
    'the solver must concentrate the long remainder instead of smearing it across bars',
  )
  assert.equal(
    calculateLongStockBarRemainder(6000, [2300, 2300, 1200], 1, 0),
    197,
    'the rejected layout is 197 mm by the declared per-workpiece kerf formula',
  )

  const twelveMetres = singleLengthCandidate(result.candidates, 12000)
  assert.equal(twelveMetres.newBarCount, 1)
  assert.deepEqual(newBarRemainders(twelveMetres), [3795])
  assert.equal(twelveMetres.totalRemainderMm, 3795)
  assert.equal(calculateLongStockBarRemainder(12000, [1200, 1200, 1200, 2300, 2300], 1, 0), 3795)
  assert.equal(calculateLongStockBarRemainder(6000, [1000, 2000], 1, 10), 2988)

  const eightMetres = singleLengthCandidate(result.candidates, 8000)
  assert.equal(eightMetres.newBarCount, 2, '8200 mm of parts cannot fit into one 8000 mm bar')
  assert.deepEqual(newBarRemainders(eightMetres), [996, 6799])
})

test('uses standard lengths by default and adds nonstandard lengths only in optimal mode', () => {
  const standardOnly = solveLongStockCutting({ ...referenceInput, mode: undefined })
  assert.deepEqual(
    standardOnly.candidates.map((candidate) => candidate.purchaseLengthsMm),
    [[12000], [6000]],
  )
  const optimal = solveLongStockCutting(referenceInput)
  assert.ok(optimal.candidates.some((candidate) => candidate.purchaseLengthsMm[0] === 8000))
})

test('selects the shortest fitting business remnant before purchase stock', () => {
  const result = solveLongStockCutting({
    workpieces: [{ id: 'part-300', lengthMm: 300 }],
    businessRemnants: [
      { id: 'large', lengthMm: 5900, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'small', lengthMm: 400, createdAt: '2026-01-02T00:00:00.000Z' },
    ],
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
  })
  assert.equal(result.recommendedCandidateKey, 'stock_only')
  assert.equal(result.stockBars[0].businessRemnantId, 'small')
  assert.equal(result.stockBars[0].remainderMm, 99)
  assert.deepEqual(result.unusedBusinessRemnantIds, ['large'])
})

test('uses the oldest remnant when equal lengths are equally suitable', () => {
  const result = solveLongStockCutting({
    workpieces: [{ id: 'part-300', lengthMm: 300 }],
    businessRemnants: [
      { id: 'newer', lengthMm: 400, createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'older', lengthMm: 400, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
  })
  assert.equal(result.stockBars[0].businessRemnantId, 'older')
})

test('does not return purchase lengths that cannot fit the longest workpiece with losses', () => {
  const result = solveLongStockCutting({
    workpieces: [{ id: 'part-2300', lengthMm: 2300 }],
    purchaseLengths: [
      { lengthMm: 2300, kind: 'standard' },
      { lengthMm: 2400, kind: 'standard' },
    ],
    kerfMm: 1,
    endTrimMm: 0,
  })
  assert.deepEqual(result.candidates.map((candidate) => candidate.purchaseLengthsMm), [[2400]])
})

test('returns a deterministic best-so-far result when the search budget is exhausted', () => {
  const input: LongStockSolverInput = {
    ...referenceInput,
    searchBudget: 1,
  }
  const first = solveLongStockCutting(input)
  const second = solveLongStockCutting(input)
  assert.deepEqual(second, first)
  assert.ok(first.candidates.every((candidate) => !candidate.searchComplete))
  assert.ok(first.candidates.every((candidate) => candidate.bars.flatMap((bar) => bar.cuts).length === 5))
})

test('is reproducible when exhaustive searches complete', () => {
  const untouchedInput = structuredClone(referenceInput)
  assert.deepEqual(solveLongStockCutting(referenceInput), solveLongStockCutting(referenceInput))
  assert.deepEqual(referenceInput, untouchedInput, 'the pure solver must not mutate its input')
})

test('mixes no more than three lengths only when the mode is explicitly enabled', () => {
  const input: LongStockSolverInput = {
    workpieces: [
      { id: 'part-7000', lengthMm: 7000 },
      { id: 'part-5000-a', lengthMm: 5000 },
      { id: 'part-5000-b', lengthMm: 5000 },
    ],
    purchaseLengths: [
      { lengthMm: 8000, kind: 'standard' },
      { lengthMm: 12000, kind: 'standard' },
      { lengthMm: 13000, kind: 'standard' },
      { lengthMm: 14000, kind: 'standard' },
    ],
    kerfMm: 1,
    endTrimMm: 0,
  }

  const disabled = solveLongStockCutting(input)
  assert.equal(disabled.candidates.some((candidate) => candidate.kind === 'mixed_lengths'), false)

  const enabled = solveLongStockCutting({ ...input, allowMixedLengths: true })
  const mixed = enabled.candidates.find((candidate) => candidate.kind === 'mixed_lengths')
  if (!mixed) assert.fail('mixed candidate must exist')
  assert.deepEqual(mixed.purchaseLengthsMm, [8000, 12000])
  assert.equal(mixed.purchasedLengthMm, 20000)
  assert.ok(mixed.purchaseLengthsMm.length <= 3)
})
