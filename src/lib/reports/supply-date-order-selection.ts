import type { SupplyOrderAggregate } from '@/lib/actions/supply-orders'
import type { MaterialCategory } from '@/lib/types'
import { MATERIAL_CATEGORIES } from '@/lib/constants/procurement'
import { groupSupplyOrderAggregatesBySupplyDate } from '@/components/features/supply-orders/supply-order-view'

export const STEEL_TYPE_CATEGORIES: MaterialCategory[] = ['sheet_metal', 'pipe', 'circle', 'knives']
export const MISSING_STEEL_TYPE = '__missing__'

export type SupplyDateOrderSelection = {
  categories: MaterialCategory[]
  steelTypes: Partial<Record<MaterialCategory, string[]>>
}

export type SupplyDateOrderCategoryOption = {
  category: MaterialCategory
  count: number
  steelTypes: string[]
}

export function supplyOrderSteelType(aggregate: SupplyOrderAggregate) {
  return aggregate.characteristics.find((part) => part.label === 'Тип стали')?.value.trim() || MISSING_STEEL_TYPE
}

export function getSupplyDateOrderOptions(aggregates: readonly SupplyOrderAggregate[], dateKey: string): SupplyDateOrderCategoryOption[] {
  const group = groupSupplyOrderAggregatesBySupplyDate([...aggregates], 'date_asc')
    .find((entry) => entry.dateKey === dateKey)
  return MATERIAL_CATEGORIES.flatMap((category) => {
    const rows = (group?.rows || []).filter((slice) => (
      slice.unscheduledQuantity > 0.000001 && slice.aggregate.category === category
    ))
    if (rows.length === 0) return []
    return [{
      category,
      count: rows.length,
      steelTypes: STEEL_TYPE_CATEGORIES.includes(category)
        ? Array.from(new Set(rows.map((slice) => supplyOrderSteelType(slice.aggregate))))
          .sort((left, right) => left.localeCompare(right, 'ru'))
        : [],
    }]
  })
}

export function selectSupplyDateOrderAggregates(
  aggregates: readonly SupplyOrderAggregate[],
  selection: SupplyDateOrderSelection,
) {
  const selectedCategories = new Set(selection.categories)
  return aggregates.filter((aggregate) => {
    if (!selectedCategories.has(aggregate.category)) return false
    if (!STEEL_TYPE_CATEGORIES.includes(aggregate.category)) return true
    return (selection.steelTypes[aggregate.category] || []).includes(supplyOrderSteelType(aggregate))
  })
}
