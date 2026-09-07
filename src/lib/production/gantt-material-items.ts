export type AggregateableGanttMaterialItem = {
  id: string
  nomenclature: string
  planned_delivery_date: string | null
  actual_delivery_date: string | null
  supply_status: string
  unit: string | null
  quantity: number | null
  supplier: string | null
  price_per_unit: number | null
  comment: string | null
  source?: 'legacy_supply' | 'supply_order'
  aggregation_key?: string | null
  planned_piece_length_mm?: number | null
  source_ids?: string[]
  technical_position_count?: number
}

export function aggregateGanttMaterialItems<T extends AggregateableGanttMaterialItem>(items: T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = [
      item.source || 'unknown',
      item.aggregation_key || `single:${item.id}`,
      item.nomenclature,
      item.planned_delivery_date || 'no-plan-date',
      item.actual_delivery_date || 'no-actual-date',
      item.supply_status,
      item.unit || 'no-unit',
      item.supplier || 'no-supplier',
      item.price_per_unit ?? 'no-price',
      item.comment || 'no-comment',
      item.planned_piece_length_mm ?? 'bulk',
    ].join('|')
    groups.set(key, [...(groups.get(key) || []), item])
  }

  return Array.from(groups.values()).map((group) => {
    const first = group[0]
    return {
      ...first,
      quantity: group.every((item) => item.quantity !== null)
        ? group.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
        : null,
      source_ids: Array.from(new Set(group.flatMap((item) => item.source_ids?.length ? item.source_ids : [item.id]))),
      technical_position_count: group.reduce((sum, item) => sum + Number(item.technical_position_count || 1), 0),
    }
  })
}
