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

export type LongStockPurchaseLength = {
  lengthMm: number
  kind: LongStockLengthKind
}

export type LongStockSolverInput = {
  workpieces: LongStockWorkpiece[]
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
  source: 'business_remnant' | 'new_stock'
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
  exploredVariants: number
  searchComplete: boolean
  bars: LongStockCuttingBar[]
}

export type LongStockSolverResult = {
  stockBars: LongStockCuttingBar[]
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

const DEFAULT_SEARCH_BUDGET = 50_000
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
  const stockSelection = selectBusinessRemnants(
    normalized.workpieces,
    normalized.businessRemnants,
    normalized.kerfMm,
    normalized.endTrimMm,
  )

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

  if (normalized.allowMixedLengths && eligibleLengths.length > 1) {
    const mixedSearch = searchNewBarLayouts(
      stockSelection.remainingWorkpieces,
      eligibleLengths,
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
    unusedBusinessRemnantIds: stockSelection.unusedBusinessRemnantIds,
    workpieceIdsRequiringPurchase: stockSelection.remainingWorkpieces.map((piece) => piece.id),
    candidates,
    recommendedCandidateKey: candidates[0]?.key ?? null,
  }
}

function normalizeInput(input: LongStockSolverInput) {
  assertNonNegativeFinite(input.kerfMm, 'kerfMm')
  assertNonNegativeFinite(input.endTrimMm, 'endTrimMm')
  const searchBudget = input.searchBudget ?? DEFAULT_SEARCH_BUDGET
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

  const remnantIds = new Set<string>()
  const businessRemnants = (input.businessRemnants ?? []).map((remnant, inputIndex) => {
    assertIdentifier(remnant.id, 'business remnant id')
    assertPositiveFinite(remnant.lengthMm, `business remnant ${remnant.id} lengthMm`)
    const createdAtMs = Date.parse(remnant.createdAt)
    if (!Number.isFinite(createdAtMs)) {
      throw new Error(`business remnant ${remnant.id} createdAt must be an ISO date`)
    }
    if (remnantIds.has(remnant.id)) throw new Error(`Duplicate business remnant id: ${remnant.id}`)
    remnantIds.add(remnant.id)
    return { ...remnant, createdAtMs, inputIndex, cuts: [] as IndexedWorkpiece[] }
  })

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
    businessRemnants,
    purchaseLengths,
    kerfMm: input.kerfMm,
    endTrimMm: input.endTrimMm,
    mode,
    allowMixedLengths: input.allowMixedLengths ?? false,
    searchBudget,
  }
}

function selectBusinessRemnants(
  workpieces: IndexedWorkpiece[],
  businessRemnants: Array<LongStockBusinessRemnant & {
    createdAtMs: number
    inputIndex: number
    cuts: IndexedWorkpiece[]
  }>,
  kerfMm: number,
  endTrimMm: number,
) {
  const remainingWorkpieces: IndexedWorkpiece[] = []
  for (const workpiece of workpieces) {
    const fitting = businessRemnants
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
        left.remainderAfter - right.remainderAfter
        || left.remnant.createdAtMs - right.remnant.createdAtMs
        || left.remnant.inputIndex - right.remnant.inputIndex
        || left.remnant.id.localeCompare(right.remnant.id, 'en'))

    const selected = fitting[0]?.remnant
    if (selected) selected.cuts.push(workpiece)
    else remainingWorkpieces.push(workpiece)
  }

  const usedBars = businessRemnants
    .filter((remnant) => remnant.cuts.length > 0)
    .sort((left, right) =>
      left.createdAtMs - right.createdAtMs
      || left.inputIndex - right.inputIndex
      || left.id.localeCompare(right.id, 'en'))
    .map((remnant) => ({
      id: remnant.id,
      createdAt: remnant.createdAt,
      lengthMm: remnant.lengthMm,
      cuts: [...remnant.cuts],
    }))

  return {
    usedBars,
    unusedBusinessRemnantIds: businessRemnants
      .filter((remnant) => remnant.cuts.length === 0)
      .sort((left, right) =>
        left.createdAtMs - right.createdAtMs
        || left.inputIndex - right.inputIndex
        || left.id.localeCompare(right.id, 'en'))
      .map((remnant) => remnant.id),
    remainingWorkpieces,
  }
}

function searchNewBarLayouts(
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

  const visit = (workpieceIndex: number, bars: MutableBar[]) => {
    if (budgetExhausted) return
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
      if (!consumeSearchVariant()) return

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
      if (!consumeSearchVariant()) return

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

  const consumeSearchVariant = () => {
    if (exploredVariants >= searchBudget) {
      budgetExhausted = true
      return false
    }
    exploredVariants += 1
    return true
  }

  visit(0, [])
  return {
    bars: best,
    exploredVariants,
    searchComplete: !budgetExhausted,
  }
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
    exploredVariants,
    searchComplete,
    bars,
  }
}

function canonicalizeOutputBars(
  stockBars: Array<{
    id: string
    createdAt: string
    lengthMm: number
    cuts: IndexedWorkpiece[]
  }>,
  newBars: MutableBar[],
  kerfMm: number,
  endTrimMm: number,
): LongStockCuttingBar[] {
  const stockOutput = stockBars.map((bar) => ({
    source: 'business_remnant' as const,
    businessRemnantId: bar.id,
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
    || left.newBarCount - right.newBarCount
    || right.maxNewBarRemainderMm - left.maxNewBarRemainderMm
    || compareNumberArrays(left.purchaseLengthsMm, right.purchaseLengthsMm)
    || layoutSignature(left.bars).localeCompare(layoutSignature(right.bars), 'en')
}

function compareLayouts(
  left: MutableBar[],
  right: MutableBar[],
  kerfMm: number,
  endTrimMm: number,
) {
  return sumPurchasedLength(left) - sumPurchasedLength(right)
    || left.length - right.length
    || maxMutableRemainder(right, endTrimMm) - maxMutableRemainder(left, endTrimMm)
    || mutableLayoutSignature(left, kerfMm, endTrimMm)
      .localeCompare(mutableLayoutSignature(right, kerfMm, endTrimMm), 'en')
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

function maxMutableRemainder(bars: MutableBar[], endTrimMm: number) {
  return bars.length === 0 ? 0 : Math.max(...bars.map((bar) => mutableBarRemainder(bar, endTrimMm)))
}

function mutableLayoutSignature(bars: MutableBar[], kerfMm: number, endTrimMm: number) {
  const output = canonicalizeOutputBars([], bars, kerfMm, endTrimMm)
  return layoutSignature(output)
}

function layoutSignature(bars: LongStockCuttingBar[]) {
  return bars.map((bar) =>
    `${bar.stockLengthMm}:${bar.remainderMm}:${cutsSignature(bar.cuts)}`).join('|')
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
