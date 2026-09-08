export const LONG_STOCK_REQUEST_ITEM_TABLES = [
  'request_circle',
  'request_pipe',
  'request_knives',
] as const

export type LongStockRequestItemTable = typeof LONG_STOCK_REQUEST_ITEM_TABLES[number]

export type LongStockPurchaseBar = {
  stock_length_mm: number | string
  length_group: 'standard' | 'nonstandard' | null
  source_type: 'new_stock' | 'business_remnant'
}

export type LongStockPurchaseComponent = {
  length_mm: number
  piece_count: number
  is_nonstandard: boolean
}

export type LongStockPurchasePlan = {
  plan_id: string
  plan_number: number
  version_id: string
  version_number: number
  version_status: 'approved' | 'invalid'
  cutting_status: 'plan_approved' | 'accepted' | 'requires_recalculation' | 'cancelled'
  components: LongStockPurchaseComponent[]
  total_piece_count: number
  total_length_mm: number
  uses_nonstandard_length: boolean
  returned_assigned_to?: string | null
}

type PlannedLongStockSchedule = {
  id: string
  delivery_date: string
  created_at?: string | null
  status: string
  quantity: number | string
  planned_piece_length_mm: number | string | null
  planned_piece_count: number | string | null
  received_piece_length_mm?: number | string | null
  received_piece_count?: number | string | null
  receipt_parent_schedule_id?: string | null
}

export function isLongStockRequestItemTable(value: string): value is LongStockRequestItemTable {
  return LONG_STOCK_REQUEST_ITEM_TABLES.includes(value as LongStockRequestItemTable)
}

export function summarizeLongStockPurchaseBars(
  bars: LongStockPurchaseBar[],
): Pick<LongStockPurchasePlan, 'components' | 'total_piece_count' | 'total_length_mm' | 'uses_nonstandard_length'> {
  const grouped = new Map<string, LongStockPurchaseComponent>()

  for (const bar of bars) {
    if (bar.source_type !== 'new_stock') continue
    const lengthMm = Number(bar.stock_length_mm)
    if (!Number.isFinite(lengthMm) || lengthMm <= 0) continue
    const isNonstandard = bar.length_group === 'nonstandard'
    const key = `${lengthMm}:${isNonstandard ? 'nonstandard' : 'standard'}`
    const current = grouped.get(key)
    grouped.set(key, {
      length_mm: lengthMm,
      piece_count: (current?.piece_count ?? 0) + 1,
      is_nonstandard: isNonstandard,
    })
  }

  const components = Array.from(grouped.values()).sort((left, right) => (
    right.length_mm - left.length_mm
      || Number(left.is_nonstandard) - Number(right.is_nonstandard)
  ))

  return {
    components,
    total_piece_count: components.reduce((sum, component) => sum + component.piece_count, 0),
    total_length_mm: components.reduce(
      (sum, component) => sum + component.length_mm * component.piece_count,
      0,
    ),
    uses_nonstandard_length: components.some((component) => component.is_nonstandard),
  }
}

export function mergeLongStockPurchasePlans(
  plans: Array<LongStockPurchasePlan | null | undefined>,
) {
  return summarizeLongStockPurchaseBars(plans.flatMap((plan) => (
    plan?.components.flatMap((component) => Array.from(
      { length: component.piece_count },
      () => ({
        stock_length_mm: component.length_mm,
        length_group: component.is_nonstandard ? 'nonstandard' as const : 'standard' as const,
        source_type: 'new_stock' as const,
      }),
    )) ?? []
  )))
}

/**
 * Limits supplier schedule rows to the new bars in the approved cutting map.
 * Warehouse bars are deliberately absent from plan components and must never
 * create supplier transport or receiving work.
 */
export function projectPlannedLongStockSchedulesToPurchasePlan<T extends PlannedLongStockSchedule>(
  schedules: T[],
  plan: LongStockPurchasePlan | null | undefined,
  options: {
    preferredScheduleIds?: ReadonlySet<string>
  } = {},
): T[] {
  if (!plan) return schedules

  const remainingPieces = new Map<number, number>()
  for (const component of plan.components) {
    remainingPieces.set(
      component.length_mm,
      (remainingPieces.get(component.length_mm) || 0) + component.piece_count,
    )
  }

  for (const schedule of schedules) {
    if (schedule.status !== 'delivered' || schedule.receipt_parent_schedule_id) continue
    const pieceLength = Number(schedule.received_piece_length_mm || schedule.planned_piece_length_mm || 0)
    const pieceCount = Number(schedule.received_piece_count || schedule.planned_piece_count || 0)
    if (pieceLength <= 0 || !Number.isFinite(pieceCount) || pieceCount <= 0) continue
    remainingPieces.set(pieceLength, Math.max((remainingPieces.get(pieceLength) || 0) - pieceCount, 0))
  }

  const displayOrder = schedules
    .slice()
    .sort((left, right) => (
      left.delivery_date.localeCompare(right.delivery_date)
      || String(left.created_at || '').localeCompare(String(right.created_at || ''))
      || left.id.localeCompare(right.id)
    ))

  // Choosing which legacy rows represent the approved purchase plan must not
  // depend on the mutable delivery date. Otherwise moving a linked schedule to
  // a trip date can make a previously hidden excess row appear as a new free
  // transport need. Active transport links take precedence; creation order is
  // the stable fallback for pre-guard legacy rows.
  const allocationOrder = schedules
    .filter((schedule) => schedule.status === 'planned')
    .slice()
    .sort((left, right) => (
      Number(options.preferredScheduleIds?.has(right.id) || false)
      - Number(options.preferredScheduleIds?.has(left.id) || false)
      || String(left.created_at || '').localeCompare(String(right.created_at || ''))
      || left.id.localeCompare(right.id)
      || left.delivery_date.localeCompare(right.delivery_date)
    ))
  const projectedById = new Map<string, T>()

  for (const schedule of allocationOrder) {
    let pieceLength = Number(schedule.planned_piece_length_mm || 0)
    let pieceCount = Number(schedule.planned_piece_count || 0)
    if (pieceLength <= 0 || !Number.isInteger(pieceCount) || pieceCount <= 0) {
      const availableLengths = Array.from(remainingPieces.entries())
        .filter(([, count]) => count > 0)
        .map(([length]) => length)
      if (availableLengths.length !== 1) continue
      pieceLength = availableLengths[0]
      pieceCount = Number(schedule.quantity) / pieceLength
      if (!Number.isInteger(pieceCount) || pieceCount <= 0) continue
    }

    const projectedPieceCount = Math.min(pieceCount, remainingPieces.get(pieceLength) || 0)
    if (projectedPieceCount <= 0) continue
    remainingPieces.set(pieceLength, (remainingPieces.get(pieceLength) || 0) - projectedPieceCount)

    projectedById.set(schedule.id, {
      ...schedule,
      quantity: pieceLength * projectedPieceCount,
      planned_piece_length_mm: pieceLength,
      planned_piece_count: projectedPieceCount,
    })
  }

  return displayOrder.flatMap((schedule): T[] => {
    if (schedule.status !== 'planned') return [schedule]
    const projected = projectedById.get(schedule.id)
    return projected ? [projected] : []
  })
}

export function formatLongStockPurchaseComposition(components: LongStockPurchaseComponent[]) {
  return components.map((component) => (
    `${formatInteger(component.length_mm)} × ${formatInteger(component.piece_count)}`
  )).join(' + ')
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)
}
