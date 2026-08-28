export type LongStockLengthKind = 'standard' | 'nonstandard'
export type LongStockSolverMode = 'standard_only' | 'optimal'

export type LongStockWorkpiece = {
  id: string
  lengthMm: number
}

export type LongStockBusinessRemnant = {
  id: string
  lengthMm: number
  createdAt: string
}

export type LongStockPhysicalSourceKind =
  | 'warehouse_stock'
  | 'business_remnant'
  | 'future_business_remnant'

export type LongStockPhysicalSource = {
  /** Unique physical-piece key. Aggregate inventory rows use inventoryId:pieceNumber. */
  id: string
  inventoryId: string
  source: LongStockPhysicalSourceKind
  lengthMm: number
  createdAt: string
  factoryId: string
  requiresTransfer: boolean
  availableFromDate: string | null
}

export type LongStockPurchaseLength = {
  lengthMm: number
  kind: LongStockLengthKind
}

export type LongStockSolverInput = {
  workpieces: LongStockWorkpiece[]
  stockSources?: LongStockPhysicalSource[]
  requireAllStockSources?: boolean
  /** @deprecated Use stockSources. Kept for stored versions and focused legacy tests. */
  businessRemnants?: LongStockBusinessRemnant[]
  purchaseLengths: LongStockPurchaseLength[]
  kerfMm: number
  endTrimMm: number
  mode?: LongStockSolverMode
  allowMixedLengths?: boolean
  searchBudget?: number
}

export type LongStockCut = {
  cutNumber: number
  workpieceId: string
  lengthMm: number
}

export type LongStockCuttingBar = {
  barNumber: number
  source: LongStockPhysicalSourceKind | 'new_stock'
  sourceInventoryId: string | null
  stockSourceId: string | null
  sourceFactoryId: string | null
  requiresTransfer: boolean
  availableFromDate: string | null
  businessRemnantId: string | null
  businessRemnantCreatedAt: string | null
  purchaseLengthKind: LongStockLengthKind | null
  stockLengthMm: number
  cuts: LongStockCut[]
  remainderMm: number
}

export type LongStockCuttingCandidate = {
  key: string
  kind: 'stock_only' | 'single_length' | 'mixed_lengths'
  purchaseLengthsMm: number[]
  usesNonstandardLength: boolean
  purchasedLengthMm: number
  newBarCount: number
  totalBarCount: number
  netPartsLengthMm: number
  kerfLossLengthMm: number
  endTrimLossLengthMm: number
  totalRemainderMm: number
  maxNewBarRemainderMm: number
  warehouseBarCount: number
  businessRemnantBarCount: number
  futureBusinessRemnantBarCount: number
  transferBarCount: number
  exploredVariants: number
  searchComplete: boolean
  bars: LongStockCuttingBar[]
}

export type LongStockSolverResult = {
  stockBars: LongStockCuttingBar[]
  unusedStockSourceIds: string[]
  unusedBusinessRemnantIds: string[]
  workpieceIdsRequiringPurchase: string[]
  candidates: LongStockCuttingCandidate[]
  recommendedCandidateKey: string | null
}

type IndexedWorkpiece = LongStockWorkpiece & { inputIndex: number }

type MutableBar = {
  stockLengthMm: number
  purchaseLengthKind: LongStockLengthKind
  cuts: IndexedWorkpiece[]
  occupiedMm: number
}

type SearchResult = {
  bars: MutableBar[]
  exploredVariants: number
  searchComplete: boolean
}

type UnnumberedOutputBar = Omit<LongStockCuttingBar, 'barNumber' | 'cuts'> & {
  cuts: Array<Omit<LongStockCut, 'cutNumber'>>
}

export const DEFAULT_LONG_STOCK_SEARCH_BUDGET = 250_000
export const EXTENDED_LONG_STOCK_SEARCH_BUDGET = 2_000_000
const MAX_MIXED_LENGTHS = 3

export function calculateLongStockBarRemainder(
  stockLengthMm: number,
  cutLengthsMm: readonly number[],
  kerfMm: number,
  endTrimMm: number,
): number {
  return stockLengthMm
    - endTrimMm
    - cutLengthsMm.reduce((total, lengthMm) => total + lengthMm, 0)
    - cutLengthsMm.length * kerfMm
}

export function solveLongStockCutting(input: LongStockSolverInput): LongStockSolverResult {
  const normalized = normalizeInput(input)
  if (normalized.stockSources.length > 0) return solveJointStockCutting(normalized)
  return solveStockFirstCutting(normalized)
}

/** Legacy greedy layout is an incumbent, never a proof of the joint optimum. */
function solveStockFirstCutting(normalized: ReturnType<typeof normalizeInput>): LongStockSolverResult {
  let stockSelection = selectStockSources(
    normalized.workpieces,
    normalized.stockSources,
    normalized.kerfMm,
    normalized.endTrimMm,
    normalized.requireAllStockSources,
  )
  if (!normalized.requireAllStockSources && stockSelection.usedBars.length > 0) {
    const initiallyUnusedStockSourceIds = stockSelection.unusedStockSourceIds
    const initiallyUnusedBusinessRemnantIds = stockSelection.unusedBusinessRemnantIds
    const recommendedIds = new Set(stockSelection.usedBars.map((bar) => bar.id))
    const recommendedSources = normalized.stockSources
      .filter((source) => recommendedIds.has(source.id))
      .map((source) => ({ ...source, cuts: [] as IndexedWorkpiece[] }))
    stockSelection = selectStockSources(
      normalized.workpieces,
      recommendedSources,
      normalized.kerfMm,
      normalized.endTrimMm,
      true,
    )
    stockSelection.unusedStockSourceIds = [
      ...initiallyUnusedStockSourceIds,
      ...stockSelection.unusedStockSourceIds,
    ]
    stockSelection.unusedBusinessRemnantIds = [
      ...initiallyUnusedBusinessRemnantIds,
      ...stockSelection.unusedBusinessRemnantIds,
    ]
  }

  if (stockSelection.remainingWorkpieces.length === 0) {
    const stockOnly = buildCandidate(
      'stock_only',
      stockSelection.usedBars,
      [],
      normalized.kerfMm,
      normalized.endTrimMm,
      0,
      true,
    )
    return {
      stockBars: stockOnly.bars,
      unusedStockSourceIds: stockSelection.unusedStockSourceIds,
      unusedBusinessRemnantIds: stockSelection.unusedBusinessRemnantIds,
      workpieceIdsRequiringPurchase: [],
      candidates: [stockOnly],
      recommendedCandidateKey: stockOnly.key,
    }
  }

  const longestWorkpieceMm = stockSelection.remainingWorkpieces[0].lengthMm
  const eligibleLengths = normalized.purchaseLengths.filter((option) =>
    option.lengthMm >= longestWorkpieceMm + normalized.kerfMm + normalized.endTrimMm
    && (normalized.mode === 'optimal' || option.kind === 'standard'))

  const candidates = eligibleLengths.map((option) => {
    const search = searchNewBarLayouts(
      stockSelection.remainingWorkpieces,
      [option],
      normalized.kerfMm,
      normalized.endTrimMm,
      normalized.searchBudget,
      1,
    )
    return buildCandidate(
      'single_length',
      stockSelection.usedBars,
      search.bars,
      normalized.kerfMm,
      normalized.endTrimMm,
      search.exploredVariants,
      search.searchComplete,
    )
  })

  const shortestWorkpieceMm = stockSelection.remainingWorkpieces[stockSelection.remainingWorkpieces.length - 1].lengthMm
  const mixedLengths = normalized.purchaseLengths.filter((option) =>
    option.lengthMm >= shortestWorkpieceMm + normalized.kerfMm + normalized.endTrimMm
    && (normalized.mode === 'optimal' || option.kind === 'standard'))
  if (normalized.allowMixedLengths && eligibleLengths.length > 0 && mixedLengths.length > 1) {
    const mixedSearch = searchNewBarLayouts(
      stockSelection.remainingWorkpieces,
      mixedLengths,
      normalized.kerfMm,
      normalized.endTrimMm,
      normalized.searchBudget,
      MAX_MIXED_LENGTHS,
    )
    const mixedCandidate = buildCandidate(
      'mixed_lengths',
      stockSelection.usedBars,
      mixedSearch.bars,
      normalized.kerfMm,
      normalized.endTrimMm,
      mixedSearch.exploredVariants,
      mixedSearch.searchComplete,
    )
    if (mixedCandidate.purchaseLengthsMm.length > 1) candidates.push(mixedCandidate)
  }

  candidates.sort(compareCandidates)
  return {
    stockBars: canonicalizeOutputBars(stockSelection.usedBars, [], normalized.kerfMm, normalized.endTrimMm),
    unusedStockSourceIds: stockSelection.unusedStockSourceIds,
    unusedBusinessRemnantIds: stockSelection.unusedBusinessRemnantIds,
    workpieceIdsRequiringPurchase: stockSelection.remainingWorkpieces.map((piece) => piece.id),
    candidates,
    recommendedCandidateKey: candidates[0]?.key ?? null,
  }
}

function solveJointStockCutting(input: ReturnType<typeof normalizeInput>): LongStockSolverResult {
  const lengths = input.purchaseLengths.filter((option) => input.mode === 'optimal' || option.kind === 'standard')
  const lengthGroups = lengths.length > 0 ? lengths.map((option) => [option]) : [[]]
  if (input.allowMixedLengths && lengths.length > 1) lengthGroups.push(lengths)
  const searches = lengthGroups.map((options) => searchJointLayout(input, options))
  const byKey = new Map<string, LongStockCuttingCandidate>()
  for (const search of searches) {
    if (!search.candidate) continue
    const previous = byKey.get(search.candidate.key)
    if (!previous || compareCandidates(search.candidate, previous) < 0) byKey.set(search.candidate.key, search.candidate)
  }
  const searchComplete = searches.every((search) => search.searchComplete)
  const exploredVariants = searches.reduce((sum, search) => sum + search.exploredVariants, 0)
  const candidates = [...byKey.values()].map((candidate) => ({ ...candidate, searchComplete, exploredVariants })).sort(compareCandidates)
  if (candidates.length === 0 && input.requireAllStockSources) {
    throw new Error(searchComplete
      ? 'Выбранные складские хлысты и закупаемые длины не позволяют разместить все отрезки'
      : 'Не удалось найти раскладку за отведённое число вариантов. Запустите расширенный расчёт')
  }
  const best = candidates[0]
  const stockBars = best?.bars.filter((bar) => bar.source !== 'new_stock') ?? []
  const usedIds = new Set(stockBars.map((bar) => bar.stockSourceId))
  const unused = input.stockSources.filter((source) => !usedIds.has(source.id))
  // The UI adopts this recommended source set. Every displayed alternative must
  // therefore honour the same exact selection, just like a subsequent recalculation.
  if (best && !input.requireAllStockSources) {
    const exactInput = {
      ...input,
      stockSources: input.stockSources.filter((source) => usedIds.has(source.id)),
      requireAllStockSources: true,
    }
    const exactResult = solveJointStockCutting(exactInput)
    return {
      ...exactResult,
      candidates: exactResult.candidates.map((candidate) => ({
        ...candidate, searchComplete: candidate.searchComplete && searchComplete,
        exploredVariants: candidate.exploredVariants + exploredVariants,
      })),
      unusedStockSourceIds: unused.map((source) => source.id),
      unusedBusinessRemnantIds: unused.filter((source) => source.source === 'business_remnant').map((source) => source.inventoryId),
    }
  }
  return {
    stockBars,
    unusedStockSourceIds: unused.map((source) => source.id),
    unusedBusinessRemnantIds: unused.filter((source) => source.source === 'business_remnant').map((source) => source.inventoryId),
    workpieceIdsRequiringPurchase: best
      ? best.bars.filter((bar) => bar.source === 'new_stock').flatMap((bar) => bar.cuts.map((cut) => cut.workpieceId))
      : input.workpieces.map((piece) => piece.id),
    candidates,
    recommendedCandidateKey: best?.key ?? null,
  }
}

/** Search physical bars and new bars in the same tree so neither consumes cuts prematurely. */
function searchJointLayout(input: ReturnType<typeof normalizeInput>, lengths: LongStockPurchaseLength[]) {
  const { workpieces, kerfMm, endTrimMm, requireAllStockSources, searchBudget } = input
  // The seed also validates that every mandatory bar can receive a distinct cut.
  const seed = solveStockFirstCutting({
    ...input,
    stockSources: input.stockSources.map((source) => ({ ...source, cuts: [] })),
    purchaseLengths: lengths,
    allowMixedLengths: lengths.length > 1,
  })
  let best = seed.candidates[0] ?? null
  const stock = input.stockSources.map((source) => ({ ...source, cuts: [] as IndexedWorkpiece[], occupiedMm: 0 }))
  const purchased: MutableBar[] = []
  const remainingOccupied = Array<number>(workpieces.length + 1).fill(0)
  for (let i = workpieces.length - 1; i >= 0; i -= 1) remainingOccupied[i] = remainingOccupied[i + 1] + workpieces[i].lengthMm + kerfMm
  const visited = new Set<string>()
  let exploredVariants = 0
  let exhausted = false
  const visit = (index: number, purchasedLength: number, dependencies: number) => {
    if (exhausted) return
    if (best && (purchasedLength > best.purchasedLengthMm
      || (purchasedLength === best.purchasedLengthMm && dependencies > best.futureBusinessRemnantBarCount + best.transferBarCount))) return
    const emptyCount = stock.filter((bar) => bar.cuts.length === 0).length
    if (requireAllStockSources && emptyCount > workpieces.length - index) return
    const stateKey = `${index}|${stock.map((bar) => bar.occupiedMm).join(',')}|${purchased
      .map((bar) => `${bar.stockLengthMm}:${bar.occupiedMm}`).sort().join(',')}`
    if (visited.has(stateKey)) return
    if (exploredVariants >= searchBudget) { exhausted = true; return }
    visited.add(stateKey)
    exploredVariants += 1
    if (index === workpieces.length) {
      const used = stock.filter((bar) => bar.cuts.length > 0)
      const kind = purchased.length === 0 ? 'stock_only'
        : new Set(purchased.map((bar) => bar.stockLengthMm)).size === 1 ? 'single_length' : 'mixed_lengths'
      const candidate = buildCandidate(kind, used, purchased, kerfMm, endTrimMm, 0, true)
      if (!best || compareCandidates(candidate, best) < 0) best = candidate
      return
    }
    // Optimistic volume bound includes all free physical capacity, even optional bars.
    const shortestOccupied = workpieces[workpieces.length - 1].lengthMm + kerfMm
    const freeCapacity = [...stock.map((bar) => bar.lengthMm - endTrimMm - bar.occupiedMm),
      ...purchased.map((bar) => mutableBarRemainder(bar, endTrimMm))]
      .reduce((sum, capacity) => sum + (capacity >= shortestOccupied ? capacity : 0), 0)
    if (best && purchasedLength + Math.max(0, remainingOccupied[index] - freeCapacity) > best.purchasedLengthMm) return

    const piece = workpieces[index]
    const occupied = piece.lengthMm + kerfMm
    const placements = stock.map((bar) => ({ bar, remainder: bar.lengthMm - endTrimMm - bar.occupiedMm - occupied }))
      .filter(({ remainder }) => remainder >= 0)
      .sort((a, b) => Number(a.bar.cuts.length === 0) - Number(b.bar.cuts.length === 0)
        || stockSourceDependencyScore(a.bar) - stockSourceDependencyScore(b.bar)
        || a.remainder - b.remainder || stockSourceTypePriority(a.bar) - stockSourceTypePriority(b.bar)
        || a.bar.createdAtMs - b.bar.createdAtMs || a.bar.id.localeCompare(b.bar.id, 'en'))
    const equivalentStock = new Set<string>()
    for (const { bar } of placements) {
      const key = `${bar.source}:${bar.requiresTransfer}:${bar.lengthMm}:${bar.occupiedMm}`
      // Unopened equivalent bars are ordered by FIFO and stable ID above.
      if (equivalentStock.has(key)) continue
      equivalentStock.add(key)
      const addedDependencies = bar.cuts.length === 0 ? stockSourceDependencyScore(bar) : 0
      bar.cuts.push(piece)
      bar.occupiedMm += occupied
      visit(index + 1, purchasedLength, dependencies + addedDependencies)
      bar.occupiedMm -= occupied
      bar.cuts.pop()
      if (exhausted) return
    }
    const equivalentPurchased = new Set<string>()
    for (const bar of purchased) {
      if (mutableBarRemainder(bar, endTrimMm) < occupied) continue
      const key = `${bar.stockLengthMm}:${bar.occupiedMm}`
      if (equivalentPurchased.has(key)) continue
      equivalentPurchased.add(key)
      bar.cuts.push(piece)
      bar.occupiedMm += occupied
      visit(index + 1, purchasedLength, dependencies)
      bar.occupiedMm -= occupied
      bar.cuts.pop()
      if (exhausted) return
    }
    const distinctLengths = new Set(purchased.map((bar) => bar.stockLengthMm))
    for (const option of lengths) {
      if (option.lengthMm - endTrimMm < occupied) continue
      if (!distinctLengths.has(option.lengthMm) && distinctLengths.size >= MAX_MIXED_LENGTHS) continue
      if (best && purchasedLength + option.lengthMm > best.purchasedLengthMm) continue
      purchased.push({ stockLengthMm: option.lengthMm, purchaseLengthKind: option.kind, cuts: [piece], occupiedMm: occupied })
      visit(index + 1, purchasedLength + option.lengthMm, dependencies)
      purchased.pop()
      if (exhausted) return
    }
  }
  visit(0, 0, 0)
  return { candidate: best, exploredVariants, searchComplete: !exhausted }
}

function normalizeInput(input: LongStockSolverInput) {
  assertNonNegativeFinite(input.kerfMm, 'kerfMm')
  assertNonNegativeFinite(input.endTrimMm, 'endTrimMm')
  const searchBudget = input.searchBudget ?? DEFAULT_LONG_STOCK_SEARCH_BUDGET
  if (!Number.isSafeInteger(searchBudget) || searchBudget <= 0) {
    throw new Error('searchBudget must be a positive safe integer')
  }
  const mode = input.mode ?? 'standard_only'
  if (mode !== 'standard_only' && mode !== 'optimal') {
    throw new Error('mode must be standard_only or optimal')
  }

  const workpieceIds = new Set<string>()
  const workpieces = input.workpieces.map((piece, inputIndex) => {
    assertIdentifier(piece.id, 'workpiece id')
    assertPositiveFinite(piece.lengthMm, `workpiece ${piece.id} lengthMm`)
    if (workpieceIds.has(piece.id)) throw new Error(`Duplicate workpiece id: ${piece.id}`)
    workpieceIds.add(piece.id)
    return { ...piece, inputIndex }
  }).sort(compareWorkpieces)

  const legacyStockSources: LongStockPhysicalSource[] = (input.businessRemnants ?? []).map((remnant) => ({
    ...remnant,
    inventoryId: remnant.id,
    source: 'business_remnant',
    factoryId: 'legacy',
    requiresTransfer: false,
    availableFromDate: null,
  }))
  const sourceIds = new Set<string>()
  const stockSources = (input.stockSources ?? legacyStockSources).map((source, inputIndex) => {
    assertIdentifier(source.id, 'stock source id')
    assertIdentifier(source.inventoryId, `stock source ${source.id} inventoryId`)
    assertIdentifier(source.factoryId, `stock source ${source.id} factoryId`)
    assertPositiveFinite(source.lengthMm, `stock source ${source.id} lengthMm`)
    if (!['warehouse_stock', 'business_remnant', 'future_business_remnant'].includes(source.source)) {
      throw new Error(`stock source ${source.id} has an unknown source type`)
    }
    const createdAtMs = Date.parse(source.createdAt)
    if (!Number.isFinite(createdAtMs)) {
      throw new Error(`stock source ${source.id} createdAt must be an ISO date`)
    }
    if (sourceIds.has(source.id)) throw new Error(`Duplicate stock source id: ${source.id}`)
    sourceIds.add(source.id)
    return { ...source, createdAtMs, inputIndex, cuts: [] as IndexedWorkpiece[] }
  }).sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id, 'en'))

  const purchaseLengthValues = new Set<number>()
  const purchaseLengths = input.purchaseLengths.map((option) => {
    if (!Number.isSafeInteger(option.lengthMm) || option.lengthMm <= 0) {
      throw new Error('purchase length must be a positive safe integer')
    }
    if (option.kind !== 'standard' && option.kind !== 'nonstandard') {
      throw new Error('purchase length kind must be standard or nonstandard')
    }
    if (purchaseLengthValues.has(option.lengthMm)) {
      throw new Error(`Duplicate purchase length: ${option.lengthMm}`)
    }
    purchaseLengthValues.add(option.lengthMm)
    return { ...option }
  }).sort(comparePurchaseLengths)

  return {
    workpieces,
    stockSources,
    requireAllStockSources: input.requireAllStockSources ?? false,
    purchaseLengths,
    kerfMm: input.kerfMm,
    endTrimMm: input.endTrimMm,
    mode,
    allowMixedLengths: input.allowMixedLengths ?? false,
    searchBudget,
  }
}

function selectStockSources(
  workpieces: IndexedWorkpiece[],
  stockSources: Array<LongStockPhysicalSource & {
    createdAtMs: number
    inputIndex: number
    cuts: IndexedWorkpiece[]
  }>,
  kerfMm: number,
  endTrimMm: number,
  requireAllStockSources: boolean,
) {
  const remainingWorkpieces = [...workpieces]
  if (requireAllStockSources && stockSources.length > remainingWorkpieces.length) {
    throw new Error('Выбрано больше складских хлыстов, чем задано отрезков')
  }

  if (requireAllStockSources) {
    const mandatorySources = [...stockSources].sort((left, right) =>
      left.lengthMm - right.lengthMm
      || stockSourceDependencyScore(left) - stockSourceDependencyScore(right)
      || stockSourceTypePriority(left) - stockSourceTypePriority(right)
      || left.createdAtMs - right.createdAtMs
      || left.id.localeCompare(right.id, 'en'))
    for (const source of mandatorySources) {
      const workpieceIndex = remainingWorkpieces.findIndex((workpiece) =>
        calculateLongStockBarRemainder(source.lengthMm, [workpiece.lengthMm], kerfMm, endTrimMm) >= 0)
      if (workpieceIndex < 0) {
        throw new Error(`Выбранный складской хлыст ${source.lengthMm} мм нельзя использовать ни для одного отрезка`)
      }
      source.cuts.push(remainingWorkpieces.splice(workpieceIndex, 1)[0])
    }
  }

  const requiringPurchase: IndexedWorkpiece[] = []
  for (const workpiece of remainingWorkpieces) {
    const fitting = stockSources
      .map((remnant) => ({
        remnant,
        remainderAfter: calculateLongStockBarRemainder(
          remnant.lengthMm,
          [...remnant.cuts.map((cut) => cut.lengthMm), workpiece.lengthMm],
          kerfMm,
          endTrimMm,
        ),
      }))
      .filter((candidate) => candidate.remainderAfter >= 0)
      .sort((left, right) =>
        stockSourceDependencyScore(left.remnant) - stockSourceDependencyScore(right.remnant)
        || left.remainderAfter - right.remainderAfter
        || stockSourceTypePriority(left.remnant) - stockSourceTypePriority(right.remnant)
        || left.remnant.createdAtMs - right.remnant.createdAtMs
        || left.remnant.id.localeCompare(right.remnant.id, 'en'))

    const selected = fitting[0]?.remnant
    if (selected) selected.cuts.push(workpiece)
    else requiringPurchase.push(workpiece)
  }

  const usedBars = stockSources
    .filter((remnant) => remnant.cuts.length > 0)
    .sort((left, right) =>
      left.createdAtMs - right.createdAtMs
      || left.id.localeCompare(right.id, 'en'))
    .map((remnant) => ({
      id: remnant.id,
      inventoryId: remnant.inventoryId,
      source: remnant.source,
      factoryId: remnant.factoryId,
      requiresTransfer: remnant.requiresTransfer,
      availableFromDate: remnant.availableFromDate,
      createdAt: remnant.createdAt,
      lengthMm: remnant.lengthMm,
      cuts: [...remnant.cuts],
    }))

  return {
    usedBars,
    unusedStockSourceIds: stockSources
      .filter((remnant) => remnant.cuts.length === 0)
      .sort((left, right) =>
        left.createdAtMs - right.createdAtMs
        || left.id.localeCompare(right.id, 'en'))
      .map((remnant) => remnant.id),
    unusedBusinessRemnantIds: stockSources
      .filter((source) => source.source === 'business_remnant' && source.cuts.length === 0)
      .map((source) => source.inventoryId),
    remainingWorkpieces: requiringPurchase,
  }
}

function stockSourceDependencyScore(source: Pick<LongStockPhysicalSource, 'source' | 'requiresTransfer'>) {
  return Number(source.source === 'future_business_remnant') + Number(source.requiresTransfer)
}

function stockSourceTypePriority(source: Pick<LongStockPhysicalSource, 'source'>) {
  if (source.source === 'business_remnant') return 0
  if (source.source === 'warehouse_stock') return 1
  return 2
}

function searchNewBarLayouts(
  workpieces: IndexedWorkpiece[],
  availableLengths: LongStockPurchaseLength[],
  kerfMm: number,
  endTrimMm: number,
  searchBudget: number,
  maxDistinctLengths: number,
): SearchResult {
  if (availableLengths.length === 1) {
    return searchIdenticalBarLayouts(
      workpieces,
      availableLengths[0],
      kerfMm,
      endTrimMm,
      searchBudget,
    )
  }

  return searchMixedBarLayouts(
    workpieces,
    availableLengths,
    kerfMm,
    endTrimMm,
    searchBudget,
    maxDistinctLengths,
  )
}

function searchIdenticalBarLayouts(
  workpieces: IndexedWorkpiece[],
  purchaseLength: LongStockPurchaseLength,
  kerfMm: number,
  endTrimMm: number,
  searchBudget: number,
): SearchResult {
  const capacityMm = purchaseLength.lengthMm - endTrimMm
  const occupiedByWorkpiece = workpieces.map((workpiece) => workpiece.lengthMm + kerfMm)
  const remainingOccupiedMm = Array<number>(workpieces.length + 1).fill(0)
  for (let index = workpieces.length - 1; index >= 0; index -= 1) {
    remainingOccupiedMm[index] = remainingOccupiedMm[index + 1] + occupiedByWorkpiece[index]
  }

  let best = buildFirstFitDecreasingLayout(workpieces, purchaseLength, kerfMm, endTrimMm)
  let exploredVariants = 0
  let budgetExhausted = false
  let optimumReached = best.length === Math.ceil(remainingOccupiedMm[0] / capacityMm)
  const visitedStates = new Set<string>()

  const visit = (workpieceIndex: number, bars: MutableBar[]) => {
    if (budgetExhausted || optimumReached) return

    const remainders = bars.map((bar) => mutableBarRemainder(bar, endTrimMm))
    const stateKey = `${workpieceIndex}|${[...remainders].sort((left, right) => right - left).join(',')}`
    if (visitedStates.has(stateKey)) return
    visitedStates.add(stateKey)
    if (exploredVariants >= searchBudget) {
      budgetExhausted = true
      return
    }
    exploredVariants += 1

    if (workpieceIndex === workpieces.length) {
      if (bars.length < best.length) {
        best = cloneMutableBars(bars)
        optimumReached = best.length === Math.ceil(remainingOccupiedMm[0] / capacityMm)
      }
      return
    }

    if (bars.length > best.length) return

    const shortestRemainingMm = occupiedByWorkpiece[occupiedByWorkpiece.length - 1]
    const usableExistingRemainderMm = remainders.reduce(
      (total, remainderMm) => total + (remainderMm >= shortestRemainingMm ? remainderMm : 0),
      0,
    )
    const occupiedRequiringNewBarsMm = Math.max(
      0,
      remainingOccupiedMm[workpieceIndex] - usableExistingRemainderMm,
    )
    const minimumAdditionalBars = Math.ceil(occupiedRequiringNewBarsMm / capacityMm)
    if (bars.length + minimumAdditionalBars >= best.length) return

    const workpiece = workpieces[workpieceIndex]
    const occupiedMm = occupiedByWorkpiece[workpieceIndex]
    const existingPlacements = bars
      .map((bar, barIndex) => ({
        bar,
        barIndex,
        remainderBefore: remainders[barIndex],
        remainderAfter: remainders[barIndex] - occupiedMm,
      }))
      .filter((placement) => placement.remainderAfter >= 0)
      .sort((left, right) =>
        left.remainderAfter - right.remainderAfter
        || left.barIndex - right.barIndex)

    const interchangeableRemainders = new Set<number>()
    for (const placement of existingPlacements) {
      if (interchangeableRemainders.has(placement.remainderBefore)) continue
      interchangeableRemainders.add(placement.remainderBefore)

      placement.bar.cuts.push(workpiece)
      placement.bar.occupiedMm += occupiedMm
      visit(workpieceIndex + 1, bars)
      placement.bar.occupiedMm -= occupiedMm
      placement.bar.cuts.pop()
      if (budgetExhausted || optimumReached) return
    }

    if (bars.length + 1 >= best.length) return
    bars.push({
      stockLengthMm: purchaseLength.lengthMm,
      purchaseLengthKind: purchaseLength.kind,
      cuts: [workpiece],
      occupiedMm,
    })
    visit(workpieceIndex + 1, bars)
    bars.pop()
  }

  if (!optimumReached) visit(0, [])
  best = concentrateIdenticalBarRemainders(best, kerfMm, endTrimMm)
  return {
    bars: best,
    exploredVariants,
    searchComplete: !budgetExhausted,
  }
}

function concentrateIdenticalBarRemainders(
  initialBars: MutableBar[],
  kerfMm: number,
  endTrimMm: number,
) {
  let current = cloneMutableBars(initialBars)

  while (true) {
    let improved: MutableBar[] | null = null
    const consider = (candidate: MutableBar[]) => {
      if (compareLayouts(candidate, improved ?? current, kerfMm, endTrimMm) < 0) {
        improved = candidate
      }
    }

    for (let sourceIndex = 0; sourceIndex < current.length; sourceIndex += 1) {
      const source = current[sourceIndex]
      if (source.cuts.length <= 1) continue
      for (let cutIndex = 0; cutIndex < source.cuts.length; cutIndex += 1) {
        const cut = source.cuts[cutIndex]
        const occupiedMm = cut.lengthMm + kerfMm
        for (let targetIndex = 0; targetIndex < current.length; targetIndex += 1) {
          if (sourceIndex === targetIndex) continue
          const target = current[targetIndex]
          if (mutableBarRemainder(target, endTrimMm) < occupiedMm) continue
          const candidate = cloneMutableBars(current)
          candidate[sourceIndex].cuts.splice(cutIndex, 1)
          candidate[sourceIndex].occupiedMm -= occupiedMm
          candidate[targetIndex].cuts.push(cut)
          candidate[targetIndex].occupiedMm += occupiedMm
          consider(candidate)
        }
      }
    }

    for (let leftBarIndex = 0; leftBarIndex < current.length; leftBarIndex += 1) {
      for (let rightBarIndex = leftBarIndex + 1; rightBarIndex < current.length; rightBarIndex += 1) {
        const leftBar = current[leftBarIndex]
        const rightBar = current[rightBarIndex]
        for (let leftCutIndex = 0; leftCutIndex < leftBar.cuts.length; leftCutIndex += 1) {
          const leftCut = leftBar.cuts[leftCutIndex]
          const leftOccupiedMm = leftCut.lengthMm + kerfMm
          for (let rightCutIndex = 0; rightCutIndex < rightBar.cuts.length; rightCutIndex += 1) {
            const rightCut = rightBar.cuts[rightCutIndex]
            const rightOccupiedMm = rightCut.lengthMm + kerfMm
            if (mutableBarRemainder(leftBar, endTrimMm) + leftOccupiedMm < rightOccupiedMm) continue
            if (mutableBarRemainder(rightBar, endTrimMm) + rightOccupiedMm < leftOccupiedMm) continue
            const candidate = cloneMutableBars(current)
            candidate[leftBarIndex].cuts[leftCutIndex] = rightCut
            candidate[leftBarIndex].occupiedMm += rightOccupiedMm - leftOccupiedMm
            candidate[rightBarIndex].cuts[rightCutIndex] = leftCut
            candidate[rightBarIndex].occupiedMm += leftOccupiedMm - rightOccupiedMm
            consider(candidate)
          }
        }
      }
    }

    for (let sourceBarIndex = 0; sourceBarIndex < current.length; sourceBarIndex += 1) {
      const sourceBar = current[sourceBarIndex]
      for (let targetBarIndex = 0; targetBarIndex < current.length; targetBarIndex += 1) {
        if (sourceBarIndex === targetBarIndex) continue
        const targetBar = current[targetBarIndex]
        for (let sourceCutIndex = 0; sourceCutIndex < sourceBar.cuts.length; sourceCutIndex += 1) {
          const sourceCut = sourceBar.cuts[sourceCutIndex]
          const sourceOccupiedMm = sourceCut.lengthMm + kerfMm
          for (let firstTargetCutIndex = 0; firstTargetCutIndex < targetBar.cuts.length; firstTargetCutIndex += 1) {
            const firstTargetCut = targetBar.cuts[firstTargetCutIndex]
            const firstTargetOccupiedMm = firstTargetCut.lengthMm + kerfMm
            for (let secondTargetCutIndex = firstTargetCutIndex + 1; secondTargetCutIndex < targetBar.cuts.length; secondTargetCutIndex += 1) {
              const secondTargetCut = targetBar.cuts[secondTargetCutIndex]
              const targetOccupiedMm = firstTargetOccupiedMm + secondTargetCut.lengthMm + kerfMm
              if (mutableBarRemainder(sourceBar, endTrimMm) + sourceOccupiedMm < targetOccupiedMm) continue
              if (mutableBarRemainder(targetBar, endTrimMm) + targetOccupiedMm < sourceOccupiedMm) continue

              const candidate = cloneMutableBars(current)
              candidate[sourceBarIndex].cuts.splice(sourceCutIndex, 1, firstTargetCut, secondTargetCut)
              candidate[sourceBarIndex].occupiedMm += targetOccupiedMm - sourceOccupiedMm
              candidate[targetBarIndex].cuts.splice(secondTargetCutIndex, 1)
              candidate[targetBarIndex].cuts.splice(firstTargetCutIndex, 1, sourceCut)
              candidate[targetBarIndex].occupiedMm += sourceOccupiedMm - targetOccupiedMm
              consider(candidate)
            }
          }
        }
      }
    }

    if (!improved) return current
    current = improved
  }
}

function searchMixedBarLayouts(
  workpieces: IndexedWorkpiece[],
  availableLengths: LongStockPurchaseLength[],
  kerfMm: number,
  endTrimMm: number,
  searchBudget: number,
  maxDistinctLengths: number,
): SearchResult {
  let best = buildGreedyLayout(workpieces, availableLengths, kerfMm, endTrimMm, maxDistinctLengths)
  let exploredVariants = 0
  let budgetExhausted = false
  const visitedStates = new Set<string>()

  const visit = (workpieceIndex: number, bars: MutableBar[]) => {
    if (budgetExhausted) return

    const stateKey = `${workpieceIndex}|${bars
      .map((bar) => `${bar.stockLengthMm}:${mutableBarRemainder(bar, endTrimMm)}`)
      .sort()
      .join(',')}`
    if (visitedStates.has(stateKey)) return
    visitedStates.add(stateKey)
    if (exploredVariants >= searchBudget) {
      budgetExhausted = true
      return
    }
    exploredVariants += 1

    if (workpieceIndex === workpieces.length) {
      if (compareLayouts(bars, best, kerfMm, endTrimMm) < 0) best = cloneMutableBars(bars)
      return
    }

    const currentPurchasedLength = sumPurchasedLength(bars)
    const bestPurchasedLength = sumPurchasedLength(best)
    if (currentPurchasedLength > bestPurchasedLength) return
    if (availableLengths.length === 1 && bars.length > best.length) return

    const workpiece = workpieces[workpieceIndex]
    const existingPlacements = bars
      .map((bar, barIndex) => ({
        bar,
        barIndex,
        remainderBefore: mutableBarRemainder(bar, endTrimMm),
        remainderAfter: mutableBarRemainder(bar, endTrimMm) - workpiece.lengthMm - kerfMm,
      }))
      .filter((placement) => placement.remainderAfter >= 0)
      .sort((left, right) =>
        left.remainderAfter - right.remainderAfter
        || left.bar.stockLengthMm - right.bar.stockLengthMm
        || left.barIndex - right.barIndex)

    const symmetricExistingBars = new Set<string>()
    for (const placement of existingPlacements) {
      const symmetryKey = `${placement.bar.stockLengthMm}:${placement.remainderBefore}`
      if (symmetricExistingBars.has(symmetryKey)) continue
      symmetricExistingBars.add(symmetryKey)

      placement.bar.cuts.push(workpiece)
      placement.bar.occupiedMm += workpiece.lengthMm + kerfMm
      visit(workpieceIndex + 1, bars)
      placement.bar.occupiedMm -= workpiece.lengthMm + kerfMm
      placement.bar.cuts.pop()
      if (budgetExhausted) return
    }

    const distinctLengths = new Set(bars.map((bar) => bar.stockLengthMm))
    for (const option of availableLengths) {
      if (option.lengthMm - endTrimMm - kerfMm - workpiece.lengthMm < 0) continue
      if (!distinctLengths.has(option.lengthMm) && distinctLengths.size >= maxDistinctLengths) continue

      bars.push({
        stockLengthMm: option.lengthMm,
        purchaseLengthKind: option.kind,
        cuts: [workpiece],
        occupiedMm: workpiece.lengthMm + kerfMm,
      })
      visit(workpieceIndex + 1, bars)
      bars.pop()
      if (budgetExhausted) return
    }
  }

  visit(0, [])
  return {
    bars: best,
    exploredVariants,
    searchComplete: !budgetExhausted,
  }
}

function buildFirstFitDecreasingLayout(
  workpieces: IndexedWorkpiece[],
  purchaseLength: LongStockPurchaseLength,
  kerfMm: number,
  endTrimMm: number,
): MutableBar[] {
  const bars: MutableBar[] = []
  for (const workpiece of workpieces) {
    const occupiedMm = workpiece.lengthMm + kerfMm
    const fittingBar = bars.find((bar) => mutableBarRemainder(bar, endTrimMm) >= occupiedMm)
    if (fittingBar) {
      fittingBar.cuts.push(workpiece)
      fittingBar.occupiedMm += occupiedMm
      continue
    }
    bars.push({
      stockLengthMm: purchaseLength.lengthMm,
      purchaseLengthKind: purchaseLength.kind,
      cuts: [workpiece],
      occupiedMm,
    })
  }
  return bars
}

function buildGreedyLayout(
  workpieces: IndexedWorkpiece[],
  availableLengths: LongStockPurchaseLength[],
  kerfMm: number,
  endTrimMm: number,
  maxDistinctLengths: number,
): MutableBar[] {
  const bars: MutableBar[] = []
  for (const workpiece of workpieces) {
    const fittingBar = bars
      .map((bar, barIndex) => ({
        bar,
        barIndex,
        remainderAfter: mutableBarRemainder(bar, endTrimMm) - workpiece.lengthMm - kerfMm,
      }))
      .filter((placement) => placement.remainderAfter >= 0)
      .sort((left, right) =>
        left.remainderAfter - right.remainderAfter
        || left.bar.stockLengthMm - right.bar.stockLengthMm
        || left.barIndex - right.barIndex)[0]?.bar

    if (fittingBar) {
      fittingBar.cuts.push(workpiece)
      fittingBar.occupiedMm += workpiece.lengthMm + kerfMm
      continue
    }

    const distinctLengths = new Set(bars.map((bar) => bar.stockLengthMm))
    const option = availableLengths.find((candidate) =>
      candidate.lengthMm - endTrimMm - kerfMm - workpiece.lengthMm >= 0
      && (distinctLengths.has(candidate.lengthMm) || distinctLengths.size < maxDistinctLengths))
    if (!option) throw new Error(`No purchase length can fit workpiece ${workpiece.id}`)
    bars.push({
      stockLengthMm: option.lengthMm,
      purchaseLengthKind: option.kind,
      cuts: [workpiece],
      occupiedMm: workpiece.lengthMm + kerfMm,
    })
  }
  return bars
}

function buildCandidate(
  kind: LongStockCuttingCandidate['kind'],
  stockBars: Array<{
    id: string
    inventoryId: string
    source: LongStockPhysicalSourceKind
    factoryId: string
    requiresTransfer: boolean
    availableFromDate: string | null
    createdAt: string
    lengthMm: number
    cuts: IndexedWorkpiece[]
  }>,
  newBars: MutableBar[],
  kerfMm: number,
  endTrimMm: number,
  exploredVariants: number,
  searchComplete: boolean,
): LongStockCuttingCandidate {
  const bars = canonicalizeOutputBars(stockBars, newBars, kerfMm, endTrimMm)
  const purchaseLengthsMm = [...new Set(newBars.map((bar) => bar.stockLengthMm))].sort((a, b) => a - b)
  const newOutputBars = bars.filter((bar) => bar.source === 'new_stock')
  const allCuts = bars.flatMap((bar) => bar.cuts)
  const purchasedLengthMm = newBars.reduce((total, bar) => total + bar.stockLengthMm, 0)
  const key = kind === 'stock_only'
    ? 'stock_only'
    : kind === 'single_length'
      ? `single:${purchaseLengthsMm[0]}`
      : `mixed:${purchaseLengthsMm.join('+')}`

  return {
    key,
    kind,
    purchaseLengthsMm,
    usesNonstandardLength: newBars.some((bar) => bar.purchaseLengthKind === 'nonstandard'),
    purchasedLengthMm,
    newBarCount: newBars.length,
    totalBarCount: bars.length,
    netPartsLengthMm: allCuts.reduce((total, cut) => total + cut.lengthMm, 0),
    kerfLossLengthMm: allCuts.length * kerfMm,
    endTrimLossLengthMm: bars.length * endTrimMm,
    totalRemainderMm: bars.reduce((total, bar) => total + bar.remainderMm, 0),
    maxNewBarRemainderMm: newOutputBars.length === 0
      ? 0
      : Math.max(...newOutputBars.map((bar) => bar.remainderMm)),
    warehouseBarCount: bars.filter((bar) => bar.source === 'warehouse_stock').length,
    businessRemnantBarCount: bars.filter((bar) => bar.source === 'business_remnant').length,
    futureBusinessRemnantBarCount: bars.filter((bar) => bar.source === 'future_business_remnant').length,
    transferBarCount: bars.filter((bar) => bar.requiresTransfer).length,
    exploredVariants,
    searchComplete,
    bars,
  }
}

function canonicalizeOutputBars(
  stockBars: Array<{
    id: string
    inventoryId: string
    source: LongStockPhysicalSourceKind
    factoryId: string
    requiresTransfer: boolean
    availableFromDate: string | null
    createdAt: string
    lengthMm: number
    cuts: IndexedWorkpiece[]
  }>,
  newBars: MutableBar[],
  kerfMm: number,
  endTrimMm: number,
): LongStockCuttingBar[] {
  const stockOutput = stockBars.map((bar) => ({
    source: bar.source,
    sourceInventoryId: bar.inventoryId,
    stockSourceId: bar.id,
    sourceFactoryId: bar.factoryId,
    requiresTransfer: bar.requiresTransfer,
    availableFromDate: bar.availableFromDate,
    businessRemnantId: bar.source === 'business_remnant' ? bar.inventoryId : null,
    businessRemnantCreatedAt: bar.createdAt,
    purchaseLengthKind: null,
    stockLengthMm: bar.lengthMm,
    cuts: canonicalizeCuts(bar.cuts),
    remainderMm: calculateLongStockBarRemainder(
      bar.lengthMm,
      bar.cuts.map((cut) => cut.lengthMm),
      kerfMm,
      endTrimMm,
    ),
  }))
  const newOutput = newBars.map((bar) => ({
    source: 'new_stock' as const,
    sourceInventoryId: null,
    stockSourceId: null,
    sourceFactoryId: null,
    requiresTransfer: false,
    availableFromDate: null,
    businessRemnantId: null,
    businessRemnantCreatedAt: null,
    purchaseLengthKind: bar.purchaseLengthKind,
    stockLengthMm: bar.stockLengthMm,
    cuts: canonicalizeCuts(bar.cuts),
    remainderMm: mutableBarRemainder(bar, endTrimMm),
  })).sort(compareOutputBars)

  return [...stockOutput, ...newOutput].map((bar, barIndex) => ({
    ...bar,
    barNumber: barIndex + 1,
    cuts: bar.cuts.map((cut, cutIndex) => ({ ...cut, cutNumber: cutIndex + 1 })),
  }))
}

function canonicalizeCuts(cuts: IndexedWorkpiece[]) {
  return [...cuts]
    .sort(compareWorkpieces)
    .map((cut) => ({ workpieceId: cut.id, lengthMm: cut.lengthMm }))
}

function compareWorkpieces(left: IndexedWorkpiece, right: IndexedWorkpiece) {
  return right.lengthMm - left.lengthMm
    || left.inputIndex - right.inputIndex
    || left.id.localeCompare(right.id, 'en')
}

function comparePurchaseLengths(left: LongStockPurchaseLength, right: LongStockPurchaseLength) {
  return left.lengthMm - right.lengthMm
    || (left.kind === 'standard' ? -1 : 1)
}

function compareCandidates(left: LongStockCuttingCandidate, right: LongStockCuttingCandidate) {
  return left.purchasedLengthMm - right.purchasedLengthMm
    || (left.futureBusinessRemnantBarCount + left.transferBarCount)
      - (right.futureBusinessRemnantBarCount + right.transferBarCount)
    || left.totalRemainderMm - right.totalRemainderMm
    || right.businessRemnantBarCount - left.businessRemnantBarCount
    || compareSourceFifo(left.bars, right.bars)
    || left.newBarCount - right.newBarCount
    || compareNumberArrays(left.purchaseLengthsMm, right.purchaseLengthsMm)
    || layoutSignature(left.bars).localeCompare(layoutSignature(right.bars), 'en')
}

function compareSourceFifo(left: LongStockCuttingBar[], right: LongStockCuttingBar[]) {
  const fifo = (bars: LongStockCuttingBar[]) => bars.filter((bar) => bar.source !== 'new_stock').sort((a, b) =>
    Date.parse(a.businessRemnantCreatedAt!) - Date.parse(b.businessRemnantCreatedAt!)
    || a.stockSourceId!.localeCompare(b.stockSourceId!, 'en'))
  const a = fifo(left)
  const b = fifo(right)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = Date.parse(a[index].businessRemnantCreatedAt!) - Date.parse(b[index].businessRemnantCreatedAt!)
      || a[index].stockSourceId!.localeCompare(b[index].stockSourceId!, 'en')
    if (difference) return difference
  }
  return a.length - b.length
}

function compareLayouts(
  left: MutableBar[],
  right: MutableBar[],
  kerfMm: number,
  endTrimMm: number,
) {
  return sumPurchasedLength(left) - sumPurchasedLength(right)
    || left.length - right.length
    || compareRemainderConcentration(left, right, endTrimMm)
    || mutableLayoutSignature(left, kerfMm, endTrimMm)
      .localeCompare(mutableLayoutSignature(right, kerfMm, endTrimMm), 'en')
}

function compareRemainderConcentration(
  left: MutableBar[],
  right: MutableBar[],
  endTrimMm: number,
) {
  const leftRemainders = left
    .map((bar) => mutableBarRemainder(bar, endTrimMm))
    .sort((first, second) => second - first)
  const rightRemainders = right
    .map((bar) => mutableBarRemainder(bar, endTrimMm))
    .sort((first, second) => second - first)

  for (let index = 0; index < leftRemainders.length; index += 1) {
    if (leftRemainders[index] !== rightRemainders[index]) {
      return rightRemainders[index] - leftRemainders[index]
    }
  }
  return 0
}

function compareOutputBars(left: UnnumberedOutputBar, right: UnnumberedOutputBar) {
  return left.remainderMm - right.remainderMm
    || left.stockLengthMm - right.stockLengthMm
    || cutsSignature(left.cuts).localeCompare(cutsSignature(right.cuts), 'en')
}

function compareNumberArrays(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return left.length - right.length
}

function cloneMutableBars(bars: MutableBar[]): MutableBar[] {
  return bars.map((bar) => ({ ...bar, cuts: [...bar.cuts] }))
}

function mutableBarRemainder(bar: MutableBar, endTrimMm: number) {
  return bar.stockLengthMm - endTrimMm - bar.occupiedMm
}

function sumPurchasedLength(bars: MutableBar[]) {
  return bars.reduce((total, bar) => total + bar.stockLengthMm, 0)
}

function mutableLayoutSignature(bars: MutableBar[], kerfMm: number, endTrimMm: number) {
  const output = canonicalizeOutputBars([], bars, kerfMm, endTrimMm)
  return layoutSignature(output)
}

function layoutSignature(bars: LongStockCuttingBar[]) {
  return bars.map((bar) =>
    `${bar.source}:${bar.sourceInventoryId ?? ''}:${bar.stockSourceId ?? ''}:${bar.stockLengthMm}:${bar.remainderMm}:${cutsSignature(bar.cuts)}`).join('|')
}

function cutsSignature(cuts: Array<{ workpieceId: string; lengthMm: number }>) {
  return cuts.map((cut) => `${cut.lengthMm}:${cut.workpieceId}`).join(',')
}

function assertIdentifier(value: string, label: string) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be non-empty`)
}

function assertPositiveFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`)
}

function assertNonNegativeFinite(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative`)
}
