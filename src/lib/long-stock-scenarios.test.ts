import assert from 'node:assert/strict'
import test from 'node:test'
import type { LongStockSourceOption } from './actions/long-stock-cutting-plans'
import { solveLongStockCutting, type LongStockSolverInput } from './long-stock-cutting-solver'
import { candidateStockSelection, solveLongStockRecommendations } from './long-stock-recommendations'
import { assertLongStockCalculationFingerprint, longStockCalculationFingerprint } from './long-stock-calculation-fingerprint'
import {
  bestLongStockScenarioId, createLongStockScenario, finishLongStockScenarioCalculation,
  longStockScenarioSelection, refreshLongStockScenarios, updateLongStockScenarioQuantity,
  type LongStockScenarioCalculation,
} from './long-stock-scenarios'

const sources: LongStockSourceOption[] = [{
  inventoryId: 'stock', source: 'warehouse_stock', lengthMm: 12000, availableQuantity: 1,
  factoryId: 'own', factoryName: 'Берегово', isOwnFactory: true, requiresTransfer: false,
  state: 'available', availableFromDate: null, sourceMachineId: null, sourceMachineName: null,
  sourceRequestId: null, sourceVersionId: null, sourceVersionNumber: null, sourceBarId: null,
  available: true, unavailableReason: null, createdAt: '2026-08-01',
}]

const solverInput: LongStockSolverInput = {
  workpieces: Array.from({ length: 10 }, (_, i) => ({ id: `cut-${i}`, lengthMm: 1300 })),
  stockSources: sources.map((source) => ({ ...source, id: `${source.inventoryId}:1` })),
  purchaseLengths: [6000, 12000].map((lengthMm) => ({ lengthMm, kind: 'standard' })),
  kerfMm: 2, endTrimMm: 10, allowMixedLengths: true,
}

function calculation(input: LongStockSolverInput = solverInput): LongStockScenarioCalculation {
  const result = solveLongStockRecommendations(input)
  return {
    requestItem: { table: 'request_pipe', id: 'request-item' }, requestId: 'request', machineId: 'machine',
    factoryId: 'own', factoryName: 'Берегово', consumerCuttingDate: '2026-09-10',
    materialId: 'material', materialVariantId: 'variant', gradeKey: 'grade', weightPerMeterKg: 9.36,
    settingsSnapshot: { schema_version: 1, revision: 1, kerf_mm: 2, end_trim_mm: 10, optimization_hint_threshold_percent: 10, categories: [] },
    layoutCategoryKey: 'pipe', searchBudget: 100000, candidates: result.candidates,
    candidateInputs: result.candidates.map((candidate) => ({ candidateKey: candidate.key,
      stockSelection: candidateStockSelection(candidate), mode: 'mixed', searchBudget: 100000,
      expectedCalculationFingerprint: longStockCalculationFingerprint({}, candidate) })),
    recommendedCandidateKey: result.recommendedCandidateKey, stockSources: sources,
    recommendedStockSelection: candidateStockSelection(result.candidates[0]), recalculation: null, planningRecovery: null,
  }
}

test('each automatic recommendation reproduces its exact reviewed bars with its own sources', () => {
  const input: LongStockSolverInput = { ...solverInput, kerfMm: 0, endTrimMm: 0,
    workpieces: [6, 4, 4].map((lengthMm, i) => ({ id: String(i), lengthMm })),
    stockSources: [5, 9].map((lengthMm) => ({ ...solverInput.stockSources![0], id: `stock-${lengthMm}:1`, inventoryId: `stock-${lengthMm}`, lengthMm })),
    purchaseLengths: [6, 8, 12].map((lengthMm) => ({ lengthMm, kind: 'standard' })),
  }
  const recommendations = solveLongStockRecommendations(input)
  assert.ok(new Set(recommendations.candidates.map((candidate) => JSON.stringify(candidateStockSelection(candidate)))).size > 1)
  for (const candidate of recommendations.candidates) {
    const ids = new Set(candidateStockSelection(candidate).map((source) => source.inventoryId))
    const repeated = solveLongStockCutting({ ...input, requireAllStockSources: true,
      stockSources: input.stockSources!.filter((source) => ids.has(source.inventoryId)) }).candidates.find((entry) => entry.key === candidate.key)!
    assert.deepEqual(candidate.bars, repeated.bars)
    assert.equal(longStockCalculationFingerprint({}, candidate), longStockCalculationFingerprint({}, repeated))
  }
})

test('changing and recalculating A preserves B and the stable card ID when procurement changes', () => {
  const initial = calculation({ ...solverInput, stockSources: [] })
  const a = createLongStockScenario(initial, initial.candidates[0], 'card-a')
  const b = createLongStockScenario(initial, initial.candidates[1], 'card-b')
  const edited = updateLongStockScenarioQuantity(a, 'stock', '1')
  assert.equal(edited.status, 'dirty')
  assert.deepEqual(b.quantities, {})
  const pending = { ...edited, status: 'calculating' as const, revision: edited.revision + 1 }
  const finished = finishLongStockScenarioCalculation(pending, pending.revision, calculation({ ...solverInput, requireAllStockSources: true }))
  assert.equal(finished.id, a.id)
  assert.equal(finished.status, 'ready')
  assert.equal(finished.candidate.purchasedLengthMm, 6000)
  assert.deepEqual(finished.candidate.bars.map((bar) => [bar.cuts.length, bar.remainderMm]), [[9, 272], [1, 4688]])
  assert.equal(b.candidate.purchasedLengthMm, 18000)
  assert.deepEqual(b.quantities, {})
  assert.equal(bestLongStockScenarioId([edited, b]), b.id)
  assert.equal(bestLongStockScenarioId([finished, b]), finished.id)
})

test('late calculation response cannot erase edits, even when another card has the same solver key', () => {
  const result = calculation()
  const initial = createLongStockScenario(result, result.candidates[0], 'a')
  const pending = { ...initial, status: 'calculating' as const, revision: 1 }
  const edited = updateLongStockScenarioQuantity(pending, 'stock', '0')
  assert.strictEqual(finishLongStockScenarioCalculation(edited, 1, result), edited)
  const duplicate = createLongStockScenario(result, result.candidates[0], 'b')
  assert.notEqual(initial.id, duplicate.id)
  assert.equal(initial.candidate.key, duplicate.candidate.key)
})

test('refresh invalidates only affected alternatives, retaining missing source quantities; dates invalidate all', () => {
  const result = calculation()
  const a = createLongStockScenario(result, result.candidates[0], 'a')
  const purchaseOnly = calculation({ ...solverInput, stockSources: [] })
  const b = createLongStockScenario(purchaseOnly, purchaseOnly.candidates[0], 'b')
  const refreshed = refreshLongStockScenarios([a, b], sources, [], false)
  assert.equal(refreshed[0].status, 'dirty')
  assert.deepEqual(refreshed[0].quantities, { stock: '1' })
  assert.strictEqual(refreshed[1], b)
  assert.ok(refreshLongStockScenarios([a, b], sources, sources, true).every((scenario) => scenario.status === 'dirty'))
  assert.strictEqual(refreshLongStockScenarios([a], sources, sources, false)[0], a)
})

test('invalid, unavailable and overbooked selections are explained, never clamped or silently discarded', () => {
  for (const value of ['-1', '1.5', '2', 'NaN']) assert.throws(() => longStockScenarioSelection({ stock: value }, sources))
  assert.throws(() => longStockScenarioSelection({ stock: '1' }, []), /недоступен/)
  assert.deepEqual(longStockScenarioSelection({ stock: '0' }, []), [])
  assert.deepEqual(longStockScenarioSelection({ stock: '1' }, sources), [{ inventoryId: 'stock', quantity: 1 }])
  const aggregate = { ...sources[0], availableQuantity: 2 }
  assert.deepEqual(longStockScenarioSelection({ stock: '2' }, [aggregate]), [{ inventoryId: 'stock', quantity: 2 }])
})

test('review proof rejects changed dates, sources, settings and cuts but ignores search counters', () => {
  const candidate = calculation().candidates[0]
  const context = { date: '2026-09-10', variant: 'variant', kerf: 2, selection: [{ inventoryId: 'stock', quantity: 1 }] }
  const proof = longStockCalculationFingerprint(context, candidate)
  assert.doesNotThrow(() => assertLongStockCalculationFingerprint(proof, longStockCalculationFingerprint(context, { ...candidate, exploredVariants: 999, searchComplete: false })))
  for (const patch of [{ date: '2026-09-11' }, { variant: 'other' }, { kerf: 3 }, { selection: [] }]) {
    assert.throws(() => assertLongStockCalculationFingerprint(proof, longStockCalculationFingerprint({ ...context, ...patch }, candidate)), /Пересчитайте/)
  }
  assert.throws(() => assertLongStockCalculationFingerprint(proof, longStockCalculationFingerprint(context, { ...candidate, bars: candidate.bars.slice(1) })), /Пересчитайте/)
  assert.doesNotThrow(() => assertLongStockCalculationFingerprint(undefined, proof))
})

test('budget-limited normalized recommendations remain reproducible and never claim a proven optimum', () => {
  for (const searchBudget of [1, 4, 10]) {
    const input = { ...solverInput, searchBudget }
    const result = solveLongStockRecommendations(input)
    assert.ok(result.candidates.length > 0)
    assert.equal(new Set(result.candidates.map((candidate) => candidate.key)).size, result.candidates.length)
    assert.ok(result.candidates.every((candidate) => !candidate.searchComplete))
    for (const candidate of result.candidates) {
      const selection = candidateStockSelection(candidate)
      const exact = solveLongStockCutting({ ...input, requireAllStockSources: true,
        stockSources: input.stockSources!.filter((source) => selection.some((entry) => entry.inventoryId === source.inventoryId)),
      }).candidates.find((entry) => entry.key === candidate.key)
      assert.deepEqual(candidate.bars, exact?.bars)
    }
  }
})
