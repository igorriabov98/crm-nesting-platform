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
  cutting_status: 'plan_approved' | 'accepted' | 'requires_recalculation'
  components: LongStockPurchaseComponent[]
  total_piece_count: number
  total_length_mm: number
  uses_nonstandard_length: boolean
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

export function formatLongStockPurchaseComposition(components: LongStockPurchaseComponent[]) {
  return components.map((component) => (
    `${formatInteger(component.length_mm)} × ${formatInteger(component.piece_count)}`
  )).join(' + ')
}

function formatInteger(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)
}
