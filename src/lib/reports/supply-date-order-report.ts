import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import type { SupplyOrderAggregate } from '@/lib/actions/supply-orders'
import { buildInitialSupplyOrderScheduleDrafts } from '@/lib/supply-orders/delivery-schedule-drafts'
import { formatLongStockPurchaseComposition } from '@/lib/supply-orders/long-stock-purchase-plan'
import {
  groupSupplyOrderAggregatesBySupplyDate,
  partitionSupplyOrderAggregatesByRedelivery,
  summarizeSupplyOrderUnscheduledMachineRoutes,
} from '@/components/features/supply-orders/supply-order-view'

const QUANTITY_EPSILON = 0.000001

export type SupplyDateOrderReportRow = {
  category: string
  material: string
  characteristics: string
  purchaseComposition: string
  quantity: number
  unit: string
  weightKg: number | null
  supplier: string
  machines: string
}

export type SupplyDateOrderReport = {
  dateKey: string
  dateLabel: string
  factoryLabel: string
  rows: SupplyDateOrderReportRow[]
}

export function buildSupplyDateOrderReport(
  aggregates: readonly SupplyOrderAggregate[],
  dateKey: string,
): SupplyDateOrderReport {
  const regularAggregates = partitionSupplyOrderAggregatesByRedelivery([...aggregates]).regular
  const dateGroup = groupSupplyOrderAggregatesBySupplyDate(regularAggregates, 'date_asc')
    .find((group) => group.dateKey === dateKey)

  const rows = (dateGroup?.rows || [])
    .filter((slice) => slice.unscheduledQuantity > QUANTITY_EPSILON)
    .map((slice): SupplyDateOrderReportRow => {
      const factory = slice.aggregate.factories[0]
      const machineRoutes = factory
        ? summarizeSupplyOrderUnscheduledMachineRoutes(factory.items, slice.unscheduledQuantity)
        : []
      const remainingItems = factory?.items.filter((item) => item.unscheduled_quantity > QUANTITY_EPSILON) || []
      const supplierNames = Array.from(new Set(
        remainingItems.map((item) => item.supplier_name).filter((name): name is string => Boolean(name)),
      )).sort((left, right) => left.localeCompare(right, 'ru'))
      const purchaseComposition = factory
        ? makeRemainingPurchaseComposition(factory, slice.unscheduledQuantity)
        : ''
      const routeWeights = machineRoutes.map((route) => route.weightKg)
      const weightKg = routeWeights.length > 0 && routeWeights.every((weight): weight is number => weight !== null)
        ? routeWeights.reduce((sum, weight) => sum + weight, 0)
        : null

      return {
        category: MATERIAL_CATEGORY_LABELS[slice.aggregate.category],
        material: slice.aggregate.item_name,
        characteristics: slice.aggregate.characteristics
          .map((part) => `${part.label}: ${part.value}`)
          .join('; '),
        purchaseComposition,
        quantity: slice.unscheduledQuantity,
        unit: slice.aggregate.unit,
        weightKg,
        supplier: supplierNames.length > 0 ? supplierNames.join(', ') : 'Не назначен',
        machines: machineRoutes.length > 0
          ? machineRoutes.map((route) => route.machineName).join(', ')
          : 'Не указаны',
      }
    })
    .sort((left, right) => (
      left.category.localeCompare(right.category, 'ru')
      || left.material.localeCompare(right.material, 'ru', { numeric: true })
      || left.characteristics.localeCompare(right.characteristics, 'ru', { numeric: true })
    ))

  const factoryNames = Array.from(new Set((dateGroup?.rows || [])
    .flatMap((slice) => slice.aggregate.factories.map((factory) => factory.factory_name))))
    .sort((left, right) => left.localeCompare(right, 'ru'))

  return {
    dateKey,
    dateLabel: formatSupplyDateLabel(dateKey),
    factoryLabel: factoryNames.length > 0 ? factoryNames.join(', ') : 'Не указан',
    rows,
  }
}

export function supplyDateOrderFilename(dateKey: string) {
  const suffix = dateKey === 'no_supply_date' ? 'bez-daty' : dateKey
  return `zakaz-materialov-${suffix}.xlsx`
}

export function formatSupplyDateLabel(dateKey: string) {
  if (dateKey === 'no_supply_date') return 'Без даты поставки'
  const [year, month, day] = dateKey.split('-').map(Number)
  if (!year || !month || !day) return dateKey
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function makeRemainingPurchaseComposition(
  factory: SupplyOrderAggregate['factories'][number],
  remainingQuantity: number,
) {
  const drafts = buildInitialSupplyOrderScheduleDrafts(
    factory,
    factory.production_date || '1970-01-01',
    { dateKey: 'no_supply_date', unscheduledQuantity: remainingQuantity },
  )
  const components = drafts.flatMap((draft) => {
    const lengthMm = Number(draft.piece_length_mm)
    const pieceCount = Number(draft.piece_count)
    if (lengthMm <= 0 || pieceCount <= 0) return []
    return [{ length_mm: lengthMm, piece_count: pieceCount, is_nonstandard: false }]
  })
  return components.length > 0 ? formatLongStockPurchaseComposition(components) : ''
}
