import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateLongStockBarRemainder,
  solveLongStockCutting,
  type LongStockCuttingCandidate,
  type LongStockSolverInput,
  type LongStockPhysicalSource,
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

function physicalSource(id: string, lengthMm: number, overrides: Partial<LongStockPhysicalSource> = {}): LongStockPhysicalSource {
  return {
    id, inventoryId: id, lengthMm, source: 'warehouse_stock',
    createdAt: '2026-08-01T00:00:00.000Z', factoryId: 'factory-a',
    requiresTransfer: false, availableFromDate: null, ...overrides,
  }
}

test('optimizes stock and purchase jointly instead of putting the longest cut into stock first', () => {
  for (const requireAllStockSources of [false, true]) {
    const result = solveLongStockCutting({
      workpieces: [6000, 4000, 4000].map((lengthMm, i) => ({ id: `cut-${i}`, lengthMm })),
      stockSources: [physicalSource('stock', 8002)],
      requireAllStockSources,
      purchaseLengths: [{ lengthMm: 6001, kind: 'standard' }], kerfMm: 1, endTrimMm: 0,
    })
    const best = result.candidates[0]
    assert.equal(best.purchasedLengthMm, 6001)
    assert.equal(best.searchComplete, true)
    assert.deepEqual(best.bars.find((bar) => bar.sourceInventoryId === 'stock')?.cuts.map((cut) => cut.lengthMm), [4000, 4000])
    assert.deepEqual(best.bars.find((bar) => bar.source === 'new_stock')?.cuts.map((cut) => cut.lengthMm), [6000])
  }
})

test('purchase minimization precedes dependency avoidance across the complete layout', () => {
  const result = solveLongStockCutting({
    workpieces: [6, 4, 4].map((lengthMm, i) => ({ id: `cut-${i}`, lengthMm })),
    stockSources: [physicalSource('local', 8), physicalSource('future', 6, { source: 'future_business_remnant' })],
    purchaseLengths: [{ lengthMm: 10, kind: 'standard' }], kerfMm: 0, endTrimMm: 0,
  })
  assert.equal(result.candidates[0].purchasedLengthMm, 0)
  assert.equal(result.candidates[0].futureBusinessRemnantBarCount, 1)
})

test('equal-cost stock selection uses FIFO then stable ID independently of loader order', () => {
  const sources = [physicalSource('z', 10), physicalSource('a', 10)]
  const input: LongStockSolverInput = {
    workpieces: [{ id: 'cut', lengthMm: 6 }], stockSources: sources,
    purchaseLengths: [], kerfMm: 0, endTrimMm: 0,
  }
  const first = solveLongStockCutting(input)
  const reversed = solveLongStockCutting({ ...input, stockSources: [...sources].reverse() })
  assert.equal(first.candidates[0].bars[0].sourceInventoryId, 'a')
  assert.deepEqual(first.candidates, reversed.candidates)
})

test('every alternative honours the source set adopted from the recommendation', () => {
  const result = solveLongStockCutting({
    workpieces: [6, 4, 4].map((lengthMm, i) => ({ id: `cut-${i}`, lengthMm })),
    stockSources: [physicalSource('small', 5), physicalSource('large', 9)],
    purchaseLengths: [6, 8, 12].map((lengthMm) => ({ lengthMm, kind: 'standard' })),
    kerfMm: 0, endTrimMm: 0, allowMixedLengths: true,
  })
  const selected = result.stockBars.map((bar) => bar.stockSourceId).sort()
  for (const candidate of result.candidates) {
    assert.deepEqual(candidate.bars.filter((bar) => bar.source !== 'new_stock').map((bar) => bar.stockSourceId).sort(), selected)
    assert.ok(candidate.bars.every((bar) => bar.cuts.length > 0))
  }
})

test('joint search reports an unproven incumbent when its budget is exhausted', () => {
  const input: LongStockSolverInput = {
    workpieces: [6000, 4000, 4000].map((lengthMm, i) => ({ id: `cut-${i}`, lengthMm })),
    stockSources: [physicalSource('stock', 8002)],
    purchaseLengths: [{ lengthMm: 6001, kind: 'standard' }], kerfMm: 1, endTrimMm: 0, searchBudget: 1,
  }
  const result = solveLongStockCutting(input)
  assert.deepEqual(result, solveLongStockCutting(input))
  assert.ok(result.candidates.every((candidate) => !candidate.searchComplete))
  assert.deepEqual(result.candidates[0].bars.flatMap((bar) => bar.cuts.map((cut) => cut.workpieceId)).sort(), ['cut-0', 'cut-1', 'cut-2'])
})

test('mixed purchases keep short lengths that fit smaller cuts even when the longest cut needs another length', () => {
  const result = solveLongStockCutting({
    workpieces: [5, 6, 7].map((lengthMm, i) => ({ id: `cut-${i}`, lengthMm })),
    purchaseLengths: [5, 8, 10].map((lengthMm) => ({ lengthMm, kind: 'standard' })),
    kerfMm: 1, endTrimMm: 1, allowMixedLengths: true,
  })
  assert.equal(result.candidates[0].purchasedLengthMm, 26)
  assert.deepEqual(result.candidates[0].purchaseLengthsMm, [8, 10])
})

// Independent, deliberately exhaustive oracle: no solver pruning, heuristics,
// candidate serialization, or source selection are used to derive the expectation.
function bruteForceCost(input: LongStockSolverInput): number[] | null {
  const sources = input.stockSources ?? []
  const stockUsed = sources.map(() => 0)
  const stockCuts = sources.map(() => 0)
  const purchases: Array<{ length: number; occupied: number }> = []
  let best: number[] | null = null
  const less = (left: number[], right: number[]) => {
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return left[i] < right[i]
    return false
  }
  const visit = (index: number) => {
    if (index === input.workpieces.length) {
      if (input.requireAllStockSources && stockCuts.some((cuts) => cuts === 0)) return
      const used = sources.filter((_, i) => stockCuts[i] > 0)
      const cost = [
        purchases.reduce((sum, bar) => sum + bar.length, 0),
        used.reduce((sum, bar) => sum + Number(bar.requiresTransfer) + Number(bar.source === 'future_business_remnant'), 0),
        sources.reduce((sum, bar, i) => sum + (stockCuts[i] > 0 ? bar.lengthMm - input.endTrimMm - stockUsed[i] : 0), 0)
          + purchases.reduce((sum, bar) => sum + bar.length - input.endTrimMm - bar.occupied, 0),
        -used.filter((bar) => bar.source === 'business_remnant').length,
      ]
      if (!best || less(cost, best)) best = cost
      return
    }
    const size = input.workpieces[index].lengthMm + input.kerfMm
    for (let i = 0; i < sources.length; i += 1) {
      if (sources[i].lengthMm - input.endTrimMm - stockUsed[i] < size) continue
      stockUsed[i] += size
      stockCuts[i] += 1
      visit(index + 1)
      stockCuts[i] -= 1
      stockUsed[i] -= size
    }
    for (const bar of purchases) {
      if (bar.length - input.endTrimMm - bar.occupied < size) continue
      bar.occupied += size
      visit(index + 1)
      bar.occupied -= size
    }
    for (const option of input.purchaseLengths) {
      if (option.lengthMm - input.endTrimMm < size) continue
      purchases.push({ length: option.lengthMm, occupied: size })
      visit(index + 1)
      purchases.pop()
    }
  }
  visit(0)
  return best
}

test('joint lexicographic objective matches exhaustive enumeration for mixed sources and losses', () => {
  let randomState = 7163
  const next = (max: number) => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState % max }
  for (let sample = 0; sample < 80; sample += 1) {
    const input: LongStockSolverInput = {
      workpieces: Array.from({ length: 3 + next(3) }, (_, i) => ({ id: `cut-${i}`, lengthMm: 1 + next(7) })),
      stockSources: Array.from({ length: 1 + next(3) }, (_, i) => physicalSource(`stock-${i}`, 3 + next(9), {
        source: (['warehouse_stock', 'business_remnant', 'future_business_remnant'] as const)[next(3)],
        requiresTransfer: next(3) === 0,
      })),
      requireAllStockSources: sample % 2 === 0,
      purchaseLengths: [5, 8, 10].map((lengthMm) => ({ lengthMm, kind: 'standard' })),
      allowMixedLengths: true, kerfMm: sample % 2, endTrimMm: sample % 3,
    }
    const expected = bruteForceCost(input)
    if (!expected) { assert.throws(() => solveLongStockCutting(input)); continue }
    const result = solveLongStockCutting(input)
    const best = result.candidates[0]
    assert.ok(best.searchComplete, `sample ${sample}`)
    assert.deepEqual([best.purchasedLengthMm, best.futureBusinessRemnantBarCount + best.transferBarCount,
      best.totalRemainderMm, -best.businessRemnantBarCount], expected, `sample ${sample}: ${JSON.stringify(input)}`)
    assert.deepEqual(best.bars.flatMap((bar) => bar.cuts.map((cut) => cut.workpieceId)).sort(), input.workpieces.map((piece) => piece.id).sort())
    assert.ok(best.bars.every((bar) => bar.remainderMm >= 0 && bar.cuts.length > 0))
  }
})

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

test('moves a 1222 mm cut into a 1776 mm remainder to concentrate reusable stock', () => {
  const result = solveLongStockCutting({
    workpieces: [
      ...Array.from({ length: 4 }, (_, index) => ({ id: `3000-${index + 1}`, lengthMm: 3000 })),
      ...Array.from({ length: 3 }, (_, index) => ({ id: `1222-${index + 1}`, lengthMm: 1222 })),
    ],
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
  })

  const candidate = singleLengthCandidate(result.candidates, 6000)
  assert.deepEqual(newBarRemainders(candidate), [553, 1776, 2999, 2999])
  assert.deepEqual(newBarCutSignatures(candidate), [
    '3000',
    '3000',
    '3000+1222',
    '3000+1222+1222',
  ])
  assert.equal(candidate.totalRemainderMm, 8327)
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

test('uses two selected 8500 mm warehouse bars and keeps both 2499 mm remainders', () => {
  const result = solveLongStockCutting({
    workpieces: [
      { id: 'part-6000-1', lengthMm: 6000 },
      { id: 'part-6000-2', lengthMm: 6000 },
    ],
    stockSources: [1, 2].map((pieceNumber) => ({
      id: `inventory-8500:${pieceNumber}`,
      inventoryId: 'inventory-8500',
      source: 'warehouse_stock' as const,
      lengthMm: 8500,
      createdAt: '2026-08-01T00:00:00.000Z',
      factoryId: 'factory-a',
      requiresTransfer: false,
      availableFromDate: null,
    })),
    requireAllStockSources: true,
    purchaseLengths: [{ lengthMm: 12000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
  })

  const candidate = result.candidates[0]
  assert.equal(candidate.kind, 'stock_only')
  assert.equal(candidate.purchasedLengthMm, 0)
  assert.equal(candidate.warehouseBarCount, 2)
  assert.deepEqual(candidate.bars.map((bar) => bar.remainderMm), [2499, 2499])
  assert.deepEqual(candidate.bars.map((bar) => bar.sourceInventoryId), ['inventory-8500', 'inventory-8500'])
})

test('requires every explicitly selected physical bar to receive a cut', () => {
  assert.throws(() => solveLongStockCutting({
    workpieces: [{ id: 'part-1000', lengthMm: 1000 }],
    stockSources: [1, 2].map((pieceNumber) => ({
      id: `inventory:${pieceNumber}`,
      inventoryId: 'inventory',
      source: 'warehouse_stock' as const,
      lengthMm: 6000,
      createdAt: '2026-08-01T00:00:00.000Z',
      factoryId: 'factory-a',
      requiresTransfer: false,
      availableFromDate: null,
    })),
    requireAllStockSources: true,
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
  }), /больше складских хлыстов, чем задано отрезков/)
})

test('prefers an available business remnant over future and transfer dependencies', () => {
  const result = solveLongStockCutting({
    workpieces: [{ id: 'part-6000', lengthMm: 6000 }],
    stockSources: [
      {
        id: 'future:1', inventoryId: 'future', source: 'future_business_remnant', lengthMm: 6500,
        createdAt: '2026-07-01T00:00:00.000Z', factoryId: 'factory-b', requiresTransfer: true,
        availableFromDate: '2026-08-20',
      },
      {
        id: 'business:1', inventoryId: 'business', source: 'business_remnant', lengthMm: 9000,
        createdAt: '2026-08-01T00:00:00.000Z', factoryId: 'factory-a', requiresTransfer: false,
        availableFromDate: null,
      },
    ],
    purchaseLengths: [{ lengthMm: 12000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
  })

  assert.equal(result.candidates[0].bars[0].sourceInventoryId, 'business')
  assert.equal(result.candidates[0].futureBusinessRemnantBarCount, 0)
  assert.equal(result.candidates[0].transferBarCount, 0)
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
    workpieces: Array.from({ length: 12 }, (_, index) => ({
      id: `part-${index + 1}`,
      lengthMm: 3000,
    })),
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
    searchBudget: 1,
  }
  const first = solveLongStockCutting(input)
  const second = solveLongStockCutting(input)
  assert.deepEqual(second, first)
  assert.ok(first.candidates.every((candidate) => !candidate.searchComplete))
  assert.ok(first.candidates.every((candidate) => candidate.bars.flatMap((bar) => bar.cuts).length === 12))
})

test('branch-and-bound improves the first-fit-decreasing incumbent exactly', () => {
  const result = solveLongStockCutting({
    workpieces: [6, 5, 3, 2, 2, 2].map((lengthMm, index) => ({
      id: `part-${index + 1}`,
      lengthMm,
    })),
    purchaseLengths: [{ lengthMm: 10, kind: 'standard' }],
    kerfMm: 0,
    endTrimMm: 0,
  })
  const candidate = result.candidates[0]
  assert.equal(candidate.searchComplete, true)
  assert.equal(candidate.newBarCount, 2)
  assert.equal(candidate.purchasedLengthMm, 20)
  assert.ok(candidate.exploredVariants > 0)
})

test('proves a volume lower bound infeasible without permuting identical bars', () => {
  const result = solveLongStockCutting({
    workpieces: Array.from({ length: 10 }, (_, index) => ({
      id: `part-${index + 1}`,
      lengthMm: 3000,
    })),
    purchaseLengths: [{ lengthMm: 6000, kind: 'standard' }],
    kerfMm: 1,
    endTrimMm: 0,
  })
  const candidate = result.candidates[0]
  assert.equal(candidate.searchComplete, true)
  assert.equal(candidate.newBarCount, 10)
  assert.ok(candidate.exploredVariants < 100)
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
  assert.equal(disabled.candidates.every((candidate) => candidate.purchaseLengthsMm.length <= 1), true)

  const enabled = solveLongStockCutting({ ...input, allowMixedLengths: true })
  const mixed = enabled.candidates.find((candidate) => candidate.kind === 'mixed_lengths')
  if (!mixed) assert.fail('mixed candidate must exist')
  assert.deepEqual(mixed.purchaseLengthsMm, [8000, 12000])
  assert.equal(mixed.purchasedLengthMm, 20000)
  assert.ok(mixed.purchaseLengthsMm.length <= 3)
})
