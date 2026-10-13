import type { SupplyOrderAggregate } from '@/lib/actions/supply-orders'
import type { MaterialCategory } from '@/lib/types'
import { MATERIAL_CATEGORIES } from '@/lib/constants/procurement'
import { displayMaterialCategory } from '@/lib/materials/display-category'
import {
  groupSupplyOrderAggregatesBySupplyDate,
  supplyOrderSourceKey,
  type SupplyOrderDateSlice,
} from '@/components/features/supply-orders/supply-order-view'

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

export type SupplyOrderExportScope =
  | { kind: 'date'; dateKey: string }
  | { kind: 'period'; from: string; to: string }
  | { kind: 'machine'; machineId: string }

export type SupplyOrderExportMachine = { id: string; name: string; count: number }

export function supplyOrderSteelType(aggregate: SupplyOrderAggregate) {
  return aggregate.characteristics.find((part) => part.label === 'Тип стали')?.value.trim() || MISSING_STEEL_TYPE
}

export function getSupplyDateOrderOptions(aggregates: readonly SupplyOrderAggregate[], dateKey: string): SupplyDateOrderCategoryOption[] {
  return getSupplyOrderExportOptions(aggregates, { kind: 'date', dateKey })
}

export function getSupplyOrderExportSlices(
  aggregates: readonly SupplyOrderAggregate[],
  scope: SupplyOrderExportScope,
): SupplyOrderDateSlice[] {
  const slices = groupSupplyOrderAggregatesBySupplyDate([...aggregates], 'date_asc')
    .flatMap((group) => group.rows)
    .filter((slice) => slice.unscheduledQuantity > 0.000001)
  if (scope.kind === 'date') return slices.filter((slice) => slice.dateKey === scope.dateKey)
  if (scope.kind === 'period') return slices.filter((slice) => (
    slice.dateKey !== 'no_supply_date' && slice.dateKey >= scope.from && slice.dateKey <= scope.to
  ))
  return slices.flatMap((slice) => {
    // A material can cover several customer orders. The source allocation is
    // authoritative; a remainder without a source cannot be assigned to one.
    if (!slice.sourceQuantities) return []
    const sourceQuantities: Record<string, number> = {}
    for (const factory of slice.aggregate.factories) {
      for (const item of factory.items) {
        if (item.machine_id !== scope.machineId) continue
        const key = supplyOrderSourceKey(item)
        const quantity = slice.sourceQuantities[key] || 0
        if (quantity > 0.000001) sourceQuantities[key] = quantity
      }
    }
    const quantity = Object.values(sourceQuantities).reduce((sum, value) => sum + value, 0)
    return quantity > 0.000001 ? [{
      ...slice,
      id: `${slice.id}|machine:${scope.machineId}`,
      sourceQuantities,
      quantity,
      unscheduledQuantity: quantity,
    }] : []
  })
}

export function getSupplyOrderExportMachines(aggregates: readonly SupplyOrderAggregate[]): SupplyOrderExportMachine[] {
  const machines = new Map<string, SupplyOrderExportMachine>()
  for (const slice of groupSupplyOrderAggregatesBySupplyDate([...aggregates], 'date_asc').flatMap((group) => group.rows)) {
    if (slice.unscheduledQuantity <= 0.000001 || !slice.sourceQuantities) continue
    for (const factory of slice.aggregate.factories) {
      for (const item of factory.items) {
        if (!item.machine_id || (slice.sourceQuantities[supplyOrderSourceKey(item)] || 0) <= 0.000001) continue
        const current = machines.get(item.machine_id)
        machines.set(item.machine_id, {
          id: item.machine_id,
          name: item.machine_name || item.machine_id,
          count: (current?.count || 0) + 1,
        })
      }
    }
  }
  return [...machines.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru', { numeric: true }))
}

export function getSupplyOrderExportOptions(
  aggregates: readonly SupplyOrderAggregate[], scope: SupplyOrderExportScope,
): SupplyDateOrderCategoryOption[] {
  const slices = getSupplyOrderExportSlices(aggregates, scope)
  return MATERIAL_CATEGORIES.flatMap((category) => {
    const rows = slices.filter((slice) => displayMaterialCategory(slice.aggregate.category, null, slice.aggregate.unit) === category)
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
    const displayCategory = displayMaterialCategory(aggregate.category, null, aggregate.unit)
    if (!displayCategory || !selectedCategories.has(displayCategory)) return false
    if (!STEEL_TYPE_CATEGORIES.includes(displayCategory)) return true
    return (selection.steelTypes[displayCategory] || []).includes(supplyOrderSteelType(aggregate))
  })
}
