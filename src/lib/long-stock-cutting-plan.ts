import {
  calculateLongStockBarRemainder,
  type LongStockBusinessRemnant,
  type LongStockCuttingBar,
  type LongStockCuttingCandidate,
  type LongStockPhysicalSource,
  type LongStockPhysicalSourceKind,
  type LongStockPurchaseLength,
  type LongStockWorkpiece,
} from '@/lib/long-stock-cutting-solver'

export type LongStockRequestItemTable = 'request_circle' | 'request_pipe' | 'request_knives'

export type LongStockRequestItemRef = {
  table: LongStockRequestItemTable
  id: string
}

export type LongStockPlanCalculationMode = 'standard' | 'with_nonstandard' | 'mixed'

export type LongStockPlanSegmentInput = {
  id: string
  lengthMm: number
}

export type LongStockPlanCalculationInput = {
  requestItem: LongStockRequestItemRef
  segments: LongStockPlanSegmentInput[]
  /** Undefined asks the solver for a recommendation; an array is an exact mandatory selection. */
  stockSelection?: LongStockSourceSelection[]
  mode?: LongStockPlanCalculationMode
  searchBudget?: number
}

export type LongStockSourceSelection = {
  inventoryId: string
  quantity: number
}

export function supportsLongStockSourceSelection(
  category: string,
  pipeType: string | null | undefined,
) {
  return category === 'circle'
    || category === 'knives'
    || (category === 'pipe' && pipeType !== 'wire')
}

export type LongStockManualBarInput = {
  source: LongStockPhysicalSourceKind | 'new_stock'
  sourceInventoryId?: string | null
  stockSourceId?: string | null
  sourceFactoryId?: string | null
  requiresTransfer?: boolean
  availableFromDate?: string | null
  /** @deprecated Use sourceInventoryId. */
  businessRemnantId?: string | null
  purchaseLengthKind?: 'standard' | 'nonstandard' | null
  stockLengthMm: number
  cuts: Array<{ workpieceId: string }>
}

export type StoredLongStockCandidate = {
  candidate_number: number
  is_complete: boolean
  metrics: {
    purchased_length_mm: number
    net_parts_length_mm: number
    kerf_loss_length_mm: number
    end_trim_loss_length_mm: number
    business_scrap_length_mm: number
    purchased_weight_kg: number
    net_parts_weight_kg: number
    kerf_loss_weight_kg: number
    end_trim_loss_weight_kg: number
    business_scrap_weight_kg: number
  }
  bars: Array<{
    bar_number: number
    stock_length_mm: number
    length_group: 'standard' | 'nonstandard' | null
    source_type: LongStockPhysicalSourceKind | 'new_stock'
    source_inventory_id: string | null
    cuts: Array<{
      cut_number: number
      segment_number: number
      cut_length_mm: number
    }>
  }>
}

export function assertLongStockCuttingPlanApprovalSucceeded<T>(result: T): T {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const approval = result as Record<string, unknown>
    if (approval.status === 'conflict') {
      throw new Error(String(approval.message || 'Выбранный складской источник уже занят. Обновите остатки и пересчитайте раскладку.'))
    }
    if (approval.status === 'invalid' || approval.position_status === 'requires_recalculation') {
      throw new Error(
        'Утверждение не состоялось: фактический состав принятого материала расходится с картой. Требуется пересчёт.',
      )
    }
  }
  return result
}

export function normalizeLongStockPlanSegments(
  segments: readonly LongStockPlanSegmentInput[],
): LongStockWorkpiece[] {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('Нужна минимум одна заготовка')
  }

  const ids = new Set<string>()
  return segments.map((segment) => {
    const id = String(segment.id ?? '').trim()
    if (!id) throw new Error('У каждой заготовки должен быть идентификатор')
    if (ids.has(id)) throw new Error(`Заготовка ${id} указана повторно`)
    if (!Number.isFinite(segment.lengthMm) || segment.lengthMm <= 0) {
      throw new Error(`Длина заготовки ${id} должна быть больше 0`)
    }
    ids.add(id)
    return { id, lengthMm: segment.lengthMm }
  }).sort((left, right) => left.id.localeCompare(right.id, 'en'))
}

export function solverModeForPlan(mode: LongStockPlanCalculationMode = 'standard') {
  if (mode === 'standard') {
    return { mode: 'standard_only' as const, allowMixedLengths: false }
  }
  if (mode === 'with_nonstandard') {
    return { mode: 'optimal' as const, allowMixedLengths: false }
  }
  if (mode === 'mixed') {
    return { mode: 'standard_only' as const, allowMixedLengths: true }
  }
  throw new Error('Неизвестный режим расчёта раскроя')
}

export function validateManualLongStockLayout(input: {
  workpieces: LongStockWorkpiece[]
  businessRemnants: LongStockBusinessRemnant[]
  stockSources?: LongStockPhysicalSource[]
  purchaseLengths: LongStockPurchaseLength[]
  bars: LongStockManualBarInput[]
  kerfMm: number
  endTrimMm: number
}): LongStockCuttingCandidate {
  if (!Array.isArray(input.bars) || input.bars.length === 0) {
    throw new Error('Ручная раскладка должна содержать хотя бы один хлыст')
  }

  const workpieceById = new Map(input.workpieces.map((piece) => [piece.id, piece]))
  const expectedIds = new Set(workpieceById.keys())
  const assignedIds = new Set<string>()
  const legacySources: LongStockPhysicalSource[] = input.businessRemnants.map((remnant) => ({
    ...remnant,
    inventoryId: remnant.id,
    source: 'business_remnant',
    factoryId: 'legacy',
    requiresTransfer: false,
    availableFromDate: null,
  }))
  const sourceByPhysicalId = new Map((input.stockSources ?? legacySources).map((source) => [source.id, source]))
  const usedSourceIds = new Set<string>()
  const purchaseLengthByValue = new Map(input.purchaseLengths.map((length) => [length.lengthMm, length]))
  const distinctPurchaseLengths = new Set<number>()

  const bars: LongStockCuttingBar[] = input.bars.map((bar, barIndex) => {
    const barNumber = barIndex + 1
    if (!Number.isSafeInteger(bar.stockLengthMm) || bar.stockLengthMm <= 0) {
      throw new Error(`Хлыст №${barNumber}: длина должна быть положительным целым числом`)
    }
    if (!Array.isArray(bar.cuts) || bar.cuts.length === 0) {
      throw new Error(`Хлыст №${barNumber}: не содержит заготовок`)
    }

    let businessRemnantId: string | null = null
    let businessRemnantCreatedAt: string | null = null
    let sourceInventoryId: string | null = null
    let stockSourceId: string | null = null
    let sourceFactoryId: string | null = null
    let requiresTransfer = false
    let availableFromDate: string | null = null
    let purchaseLengthKind: 'standard' | 'nonstandard' | null = null
    if (bar.source !== 'new_stock') {
      stockSourceId = String(bar.stockSourceId ?? bar.businessRemnantId ?? '').trim()
      const source = sourceByPhysicalId.get(stockSourceId)
      if (!source || source.source !== bar.source) {
        throw new Error(`Хлыст №${barNumber}: выбранный складской источник недоступен`)
      }
      if (usedSourceIds.has(source.id)) {
        throw new Error(`Хлыст №${barNumber}: физический источник ${source.id} использован повторно`)
      }
      if (source.lengthMm !== bar.stockLengthMm) {
        throw new Error(`Хлыст №${barNumber}: длина складского источника изменилась`)
      }
      usedSourceIds.add(source.id)
      sourceInventoryId = source.inventoryId
      sourceFactoryId = source.factoryId
      requiresTransfer = source.requiresTransfer
      availableFromDate = source.availableFromDate
      businessRemnantId = source.source === 'business_remnant' ? source.inventoryId : null
      businessRemnantCreatedAt = source.createdAt
    } else if (bar.source === 'new_stock') {
      const purchaseLength = purchaseLengthByValue.get(bar.stockLengthMm)
      if (!purchaseLength || purchaseLength.kind !== bar.purchaseLengthKind) {
        throw new Error(`Хлыст №${barNumber}: закупаемая длина отсутствует в выбранном режиме`)
      }
      purchaseLengthKind = purchaseLength.kind
      distinctPurchaseLengths.add(bar.stockLengthMm)
    } else {
      throw new Error(`Хлыст №${barNumber}: неизвестный источник`)
    }

    const cuts = bar.cuts.map((cut, cutIndex) => {
      const workpieceId = String(cut.workpieceId ?? '').trim()
      const workpiece = workpieceById.get(workpieceId)
      if (!workpiece) {
        throw new Error(`Хлыст №${barNumber}: заготовка ${workpieceId || 'без ID'} не заявлена`)
      }
      if (assignedIds.has(workpieceId)) {
        throw new Error(`Хлыст №${barNumber}: заготовка ${workpieceId} задвоена`)
      }
      if (workpiece.lengthMm > bar.stockLengthMm) {
        throw new Error(
          `Хлыст №${barNumber}: заготовка ${workpieceId} длиннее хлыста на ${formatMm(workpiece.lengthMm - bar.stockLengthMm)} мм`,
        )
      }
      assignedIds.add(workpieceId)
      return {
        cutNumber: cutIndex + 1,
        workpieceId,
        lengthMm: workpiece.lengthMm,
      }
    })

    const remainderMm = calculateLongStockBarRemainder(
      bar.stockLengthMm,
      cuts.map((cut) => cut.lengthMm),
      input.kerfMm,
      input.endTrimMm,
    )
    if (remainderMm < 0) {
      throw new Error(`Переполнение хлыста №${barNumber}: превышение ${formatMm(-remainderMm)} мм`)
    }

    return {
      barNumber,
      source: bar.source,
      sourceInventoryId,
      stockSourceId,
      sourceFactoryId,
      requiresTransfer,
      availableFromDate,
      businessRemnantId,
      businessRemnantCreatedAt,
      purchaseLengthKind,
      stockLengthMm: bar.stockLengthMm,
      cuts,
      remainderMm,
    }
  })

  if (distinctPurchaseLengths.size > 3) {
    throw new Error('В ручной раскладке допустимо максимум три разных закупаемых длины')
  }

  const missingIds = [...expectedIds].filter((id) => !assignedIds.has(id))
  if (missingIds.length > 0) {
    throw new Error(`Потеряны заготовки: ${missingIds.join(', ')}`)
  }

  const newBars = bars.filter((bar) => bar.source === 'new_stock')
  const purchaseLengthsMm = [...distinctPurchaseLengths].sort((left, right) => left - right)
  return {
    key: `manual:${manualLayoutSignature(bars)}`,
    kind: newBars.length === 0
      ? 'stock_only'
      : purchaseLengthsMm.length > 1 ? 'mixed_lengths' : 'single_length',
    purchaseLengthsMm,
    usesNonstandardLength: newBars.some((bar) => bar.purchaseLengthKind === 'nonstandard'),
    purchasedLengthMm: newBars.reduce((total, bar) => total + bar.stockLengthMm, 0),
    newBarCount: newBars.length,
    totalBarCount: bars.length,
    netPartsLengthMm: bars.flatMap((bar) => bar.cuts)
      .reduce((total, cut) => total + cut.lengthMm, 0),
    kerfLossLengthMm: bars.reduce((total, bar) => total + bar.cuts.length * input.kerfMm, 0),
    endTrimLossLengthMm: bars.length * input.endTrimMm,
    totalRemainderMm: bars.reduce((total, bar) => total + bar.remainderMm, 0),
    maxNewBarRemainderMm: newBars.length === 0
      ? 0
      : Math.max(...newBars.map((bar) => bar.remainderMm)),
    warehouseBarCount: bars.filter((bar) => bar.source === 'warehouse_stock').length,
    businessRemnantBarCount: bars.filter((bar) => bar.source === 'business_remnant').length,
    futureBusinessRemnantBarCount: bars.filter((bar) => bar.source === 'future_business_remnant').length,
    transferBarCount: bars.filter((bar) => bar.requiresTransfer).length,
    exploredVariants: 0,
    searchComplete: true,
    bars,
  }
}

export function serializeLongStockCandidates(input: {
  candidates: LongStockCuttingCandidate[]
  workpieces: LongStockWorkpiece[]
  weightPerMeterKg: number | null
}): StoredLongStockCandidate[] {
  const segmentNumberById = new Map(
    input.workpieces.map((workpiece, index) => [workpiece.id, index + 1]),
  )
  const weightPerMm = Math.max(Number(input.weightPerMeterKg) || 0, 0) / 1000

  return input.candidates.map((candidate, candidateIndex) => ({
    candidate_number: candidateIndex + 1,
    is_complete: candidate.searchComplete,
    metrics: {
      purchased_length_mm: candidate.purchasedLengthMm,
      net_parts_length_mm: candidate.netPartsLengthMm,
      kerf_loss_length_mm: candidate.kerfLossLengthMm,
      end_trim_loss_length_mm: candidate.endTrimLossLengthMm,
      business_scrap_length_mm: candidate.totalRemainderMm,
      purchased_weight_kg: candidate.purchasedLengthMm * weightPerMm,
      net_parts_weight_kg: candidate.netPartsLengthMm * weightPerMm,
      kerf_loss_weight_kg: candidate.kerfLossLengthMm * weightPerMm,
      end_trim_loss_weight_kg: candidate.endTrimLossLengthMm * weightPerMm,
      business_scrap_weight_kg: candidate.totalRemainderMm * weightPerMm,
    },
    bars: candidate.bars.map((bar) => ({
      bar_number: bar.barNumber,
      stock_length_mm: bar.stockLengthMm,
      length_group: bar.source === 'new_stock' ? bar.purchaseLengthKind : null,
      source_type: bar.source,
      source_inventory_id: bar.sourceInventoryId,
      cuts: bar.cuts.map((cut) => {
        const segmentNumber = segmentNumberById.get(cut.workpieceId)
        if (!segmentNumber) throw new Error(`Заготовка ${cut.workpieceId} отсутствует во входных данных`)
        return {
          cut_number: cut.cutNumber,
          segment_number: segmentNumber,
          cut_length_mm: cut.lengthMm,
        }
      }),
    })),
  }))
}

function manualLayoutSignature(bars: LongStockCuttingBar[]) {
  return bars.map((bar) => [
    bar.source,
    bar.sourceInventoryId ?? '',
    bar.stockSourceId ?? '',
    bar.stockLengthMm,
    bar.cuts.map((cut) => cut.workpieceId).join(','),
  ].join(':')).join('|')
}

function formatMm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}
