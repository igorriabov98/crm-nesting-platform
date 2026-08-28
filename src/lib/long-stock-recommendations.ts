import {
  compareLongStockCandidates,
  solveLongStockCutting,
  type LongStockCuttingCandidate,
  type LongStockSolverInput,
} from './long-stock-cutting-solver'
import type { LongStockSourceSelection } from './long-stock-cutting-plan'

export function candidateStockSelection(candidate: LongStockCuttingCandidate): LongStockSourceSelection[] {
  const quantities = new Map<string, number>()
  for (const bar of candidate.bars) {
    if (bar.source === 'new_stock' || !bar.sourceInventoryId) continue
    quantities.set(bar.sourceInventoryId, (quantities.get(bar.sourceInventoryId) ?? 0) + 1)
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([inventoryId, quantity]) => ({ inventoryId, quantity }))
}

/** Each alternative adopts its OWN sources, then repeats the exact approval search. */
export function solveLongStockRecommendations(input: LongStockSolverInput) {
  const result = solveLongStockCutting(input)
  if (input.requireAllStockSources || !input.stockSources?.length) return result
  const cache = new Map<string, ReturnType<typeof solveLongStockCutting>>()
  const candidates = result.candidates.map((proposed) => {
    const selection = candidateStockSelection(proposed)
    const key = JSON.stringify(selection)
    let exact = cache.get(key)
    if (!exact) {
      const remaining = new Map(selection.map(({ inventoryId, quantity }) => [inventoryId, quantity]))
      const stockSources = input.stockSources!.filter((source) => {
        const count = remaining.get(source.inventoryId) ?? 0
        if (!count) return false
        remaining.set(source.inventoryId, count - 1)
        return true
      })
      exact = solveLongStockCutting({ ...input, stockSources, requireAllStockSources: true })
      cache.set(key, exact)
    }
    // A budget-limited recommendation can improve to another purchase family
    // once its source set is fixed. Keep that valid improvement, not an empty card.
    const candidate = exact.candidates.find((entry) => entry.key === proposed.key) ?? exact.candidates[0]
    if (!candidate) return null
    return { ...candidate, searchComplete: proposed.searchComplete && candidate.searchComplete }
  }).filter((candidate): candidate is LongStockCuttingCandidate => candidate !== null)
    .sort(compareLongStockCandidates)
  const distinct = new Map<string, LongStockCuttingCandidate>()
  for (const candidate of candidates) {
    if (!distinct.has(candidate.key)) distinct.set(candidate.key, candidate)
  }
  const normalizedCandidates = [...distinct.values()]
  const best = normalizedCandidates[0]
  const stockBars = best?.bars.filter((bar) => bar.source !== 'new_stock') ?? []
  const used = new Set(stockBars.map((bar) => bar.stockSourceId))
  const unused = input.stockSources.filter((source) => !used.has(source.id))
  return {
    ...result, candidates: normalizedCandidates, stockBars,
    recommendedCandidateKey: best?.key ?? null,
    unusedStockSourceIds: unused.map((source) => source.id),
    unusedBusinessRemnantIds: unused.filter((source) => source.source === 'business_remnant').map((source) => source.inventoryId),
    workpieceIdsRequiringPurchase: best
      ? best.bars.filter((bar) => bar.source === 'new_stock').flatMap((bar) => bar.cuts.map((cut) => cut.workpieceId))
      : input.workpieces.map((piece) => piece.id),
  }
}
