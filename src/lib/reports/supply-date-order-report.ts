import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import type { SupplyOrderAggregate } from '@/lib/actions/supply-orders'
import {
  formatLongStockPurchaseComposition,
  mergeLongStockPurchasePlans,
  type LongStockPurchaseComponent,
} from '@/lib/supply-orders/long-stock-purchase-plan'
import {
  groupSupplyOrderAggregatesBySupplyDate,
  isSupplyOrderBarMaterial,
  partitionSupplyOrderAggregatesByRedelivery,
  summarizeSupplyOrderUnscheduledMachineRoutes,
} from '@/components/features/supply-orders/supply-order-view'

const QUANTITY_EPSILON = 0.000001

export type SupplyDateOrderReportRow = {
  category: string
  material: string
  characteristics: string
  purchaseComposition: string
  barLengthMm: number | null
  barCount: number | null
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
    .flatMap((slice): SupplyDateOrderReportRow[] => {
      const factory = slice.aggregate.factories[0]
      const machineRoutes = factory
        ? summarizeSupplyOrderUnscheduledMachineRoutes(factory.items, slice.unscheduledQuantity)
        : []
      const remainingItems = factory?.items.filter((item) => item.unscheduled_quantity > QUANTITY_EPSILON) || []
      const supplierNames = Array.from(new Set(
        remainingItems.map((item) => item.supplier_name).filter((name): name is string => Boolean(name)),
      )).sort((left, right) => left.localeCompare(right, 'ru'))
      const routeWeights = machineRoutes.map((route) => route.weightKg)
      const weightKg = routeWeights.length > 0 && routeWeights.every((weight): weight is number => weight !== null)
        ? routeWeights.reduce((sum, weight) => sum + weight, 0)
        : null
      const baseRow = {
        category: MATERIAL_CATEGORY_LABELS[slice.aggregate.category],
        material: slice.aggregate.item_name,
        characteristics: slice.aggregate.characteristics
          .map((part) => `${part.label}: ${part.value}`)
          .join('; '),
        unit: slice.aggregate.unit,
        supplier: supplierNames.length > 0 ? supplierNames.join(', ') : 'Не назначен',
        machines: machineRoutes.length > 0
          ? machineRoutes.map((route) => route.machineName).join(', ')
          : 'Не указаны',
      }
      if (!factory || !isSupplyOrderBarMaterial(slice.aggregate)) {
        return [{
          ...baseRow,
          purchaseComposition: '',
          barLengthMm: null,
          barCount: null,
          quantity: slice.unscheduledQuantity,
          weightKg,
        }]
      }

      const purchase = makeRemainingLongStockPurchase(factory, slice.unscheduledQuantity)
      if (purchase.components.length === 0) {
        return [{
          ...baseRow,
          purchaseComposition: purchase.issue,
          barLengthMm: null,
          barCount: null,
          quantity: slice.unscheduledQuantity,
          weightKg,
        }]
      }

      return purchase.components.map((component) => {
        const componentQuantity = component.length_mm * component.piece_count
        return {
          ...baseRow,
          purchaseComposition: formatLongStockPurchaseComposition([component]),
          barLengthMm: component.length_mm,
          barCount: component.piece_count,
          quantity: componentQuantity,
          weightKg: weightKg === null
            ? null
            : weightKg * componentQuantity / slice.unscheduledQuantity,
        }
      })
    })
    .sort((left, right) => (
      left.category.localeCompare(right.category, 'ru')
      || left.material.localeCompare(right.material, 'ru', { numeric: true })
      || left.characteristics.localeCompare(right.characteristics, 'ru', { numeric: true })
      || (right.barLengthMm || 0) - (left.barLengthMm || 0)
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

function makeRemainingLongStockPurchase(
  factory: SupplyOrderAggregate['factories'][number],
  remainingQuantity: number,
) {
  const plans = factory.items
    .map((item) => item.long_stock_purchase_plan)
    .filter((plan) => (
      plan?.version_status === 'approved'
      && (plan.cutting_status === 'plan_approved' || plan.cutting_status === 'accepted')
    ))
  const purchase = mergeLongStockPurchasePlans(plans)
  if (purchase.components.length === 0) {
    const requiresRecalculation = factory.items.some((item) => (
      item.long_stock_purchase_plan?.cutting_status === 'requires_recalculation'
    ))
    return {
      components: [] as LongStockPurchaseComponent[],
      issue: requiresRecalculation
        ? 'Требуется пересчитать и утвердить карту раскроя'
        : 'Требуется утверждённая карта раскроя',
    }
  }

  const consumedPieceCountByLength = new Map<number, number>()
  for (const item of factory.items) {
    for (const schedule of item.delivery_schedules) {
      if (schedule.status === 'cancelled' || schedule.receipt_parent_schedule_id) continue
      const pieceLength = Number(schedule.received_piece_length_mm || schedule.planned_piece_length_mm || 0)
      const pieceCount = Number(schedule.received_piece_count || schedule.planned_piece_count || 0)
      if (pieceLength <= 0 || pieceCount <= 0) continue
      consumedPieceCountByLength.set(
        pieceLength,
        (consumedPieceCountByLength.get(pieceLength) || 0) + pieceCount,
      )
    }
  }

  const remainingComponents = purchase.components
    .map((component) => ({
      ...component,
      piece_count: Math.max(
        component.piece_count - (consumedPieceCountByLength.get(component.length_mm) || 0),
        0,
      ),
    }))
    .filter((component) => component.piece_count > 0)
  const componentQuantity = remainingComponents.reduce(
    (total, component) => total + component.length_mm * component.piece_count,
    0,
  )
  if (Math.abs(componentQuantity - remainingQuantity) <= QUANTITY_EPSILON) {
    return { components: remainingComponents, issue: '' }
  }

  const matchingLengths = purchase.components.filter((component) => (
    Number.isInteger(remainingQuantity / component.length_mm)
    && remainingQuantity / component.length_mm > 0
  ))
  if (matchingLengths.length === 1) {
    return {
      components: [{
        ...matchingLengths[0],
        piece_count: remainingQuantity / matchingLengths[0].length_mm,
      }],
      issue: '',
    }
  }

  return {
    components: [] as LongStockPurchaseComponent[],
    issue: 'Проверьте остаток по утверждённой карте раскроя',
  }
}
