import { MATERIAL_CATEGORY_LABELS } from '@/lib/constants/procurement'
import type { SupplyOrderAggregate } from '@/lib/actions/supply-orders'
import { displayMaterialCategory } from '@/lib/materials/display-category'
import {
  getSupplyOrderExportMachines,
  getSupplyOrderExportSlices,
  MISSING_STEEL_TYPE,
  STEEL_TYPE_CATEGORIES,
  supplyOrderSteelType,
  type SupplyDateOrderSelection,
  type SupplyOrderExportScope,
} from '@/lib/reports/supply-date-order-selection'
import {
  formatLongStockPurchaseComposition,
  mergeLongStockPurchasePlans,
  type LongStockPurchaseComponent,
} from '@/lib/supply-orders/long-stock-purchase-plan'
import {
  isSupplyOrderBarMaterial,
  supplyOrderDateSliceItems,
  summarizeSupplyOrderUnscheduledMachineRoutes,
  type SupplyOrderDateSlice,
} from '@/components/features/supply-orders/supply-order-view'

const QUANTITY_EPSILON = 0.000001

export type SupplyDateOrderReportRow = {
  category: string
  material: string
  steelType: string
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
  scopeLabel: string
  factoryLabel: string
  rows: SupplyDateOrderReportRow[]
}

export function buildSupplyDateOrderReport(
  aggregates: readonly SupplyOrderAggregate[],
  dateKey: string,
): SupplyDateOrderReport {
  return buildSupplyOrderExportReport(aggregates, { kind: 'date', dateKey })
}

export function buildSupplyOrderExportReport(
  aggregates: readonly SupplyOrderAggregate[],
  scope: SupplyOrderExportScope,
  selection: SupplyDateOrderSelection | null = null,
): SupplyDateOrderReport {
  const slices = getSupplyOrderExportSlices(aggregates, scope).filter((slice) => {
    if (!selection) return true
    const category = displayMaterialCategory(slice.aggregate.category, null, slice.aggregate.unit)
    if (!category || !selection.categories.includes(category)) return false
    return !STEEL_TYPE_CATEGORIES.includes(category)
      || (selection.steelTypes[category] || []).includes(supplyOrderSteelType(slice.aggregate))
  })
  const entries = slices.flatMap(buildSliceRows)
  const rows = (scope.kind === 'date' ? entries.map((entry) => entry.row) : sumMaterialRows(entries))
    .sort((left, right) => (
      left.category.localeCompare(right.category, 'ru')
      || left.material.localeCompare(right.material, 'ru', { numeric: true })
      || left.characteristics.localeCompare(right.characteristics, 'ru', { numeric: true })
      || (right.barLengthMm || 0) - (left.barLengthMm || 0)
    ))
  const factoryNames = Array.from(new Set(slices
    .flatMap((slice) => slice.aggregate.factories.map((factory) => factory.factory_name))))
    .sort((left, right) => left.localeCompare(right, 'ru'))
  const machineName = scope.kind === 'machine'
    ? getSupplyOrderExportMachines(aggregates).find((machine) => machine.id === scope.machineId)?.name || scope.machineId
    : null
  return {
    dateKey: scope.kind === 'date' ? scope.dateKey : scope.kind,
    dateLabel: scope.kind === 'date' ? formatSupplyDateLabel(scope.dateKey)
      : scope.kind === 'period' ? `${formatSupplyDateLabel(scope.from)} — ${formatSupplyDateLabel(scope.to)}`
        : machineName || '',
    scopeLabel: scope.kind === 'date' ? 'Дата поставки' : scope.kind === 'period' ? 'Период поставки' : 'Заказ клиента',
    factoryLabel: factoryNames.length > 0 ? factoryNames.join(', ') : 'Не указан',
    rows,
  }
}

type ReportEntry = {
  key: string
  row: SupplyDateOrderReportRow
  baseCharacteristics: string[]
  notes: string[]
  supplierNames: string[]
  machineNames: string[]
}

function buildSliceRows(slice: SupplyOrderDateSlice): ReportEntry[] {
  const sliceItems = supplyOrderDateSliceItems(slice)
  const factory = slice.aggregate.factories.find((candidate) => candidate.items.some((item) => (
    sliceItems.some((selected) => selected.table === item.table && selected.id === item.id)
  ))) || slice.aggregate.factories[0]
  const machineRoutes = summarizeSupplyOrderUnscheduledMachineRoutes(sliceItems, slice.unscheduledQuantity)
  const supplierNames = Array.from(new Set(sliceItems
    .filter((item) => item.unscheduled_quantity > QUANTITY_EPSILON)
    .map((item) => item.supplier_name || 'Не назначен')))
    .sort((left, right) => left.localeCompare(right, 'ru'))
  const machineNames = machineRoutes.map((route) => route.machineName)
  const routeWeights = machineRoutes.map((route) => route.weightKg)
  const weightKg = routeWeights.length > 0 && routeWeights.every((weight): weight is number => weight !== null)
    ? routeWeights.reduce((sum, weight) => sum + weight, 0)
    : null
  const steelType = supplyOrderSteelType(slice.aggregate)
  const baseCharacteristics = slice.aggregate.characteristics
    .filter((part) => part.label !== 'Тип стали')
    .map((part) => `${part.label}: ${part.value}`)
  const notes = slice.state === 'redelivery' ? slice.ambiguousOrigin
    ? ['Источник довоза требует уточнения']
    : (slice.origins || []).map((origin) => `Довоз из поставки ${origin.date} · ${origin.supplierName || 'без поставщика'}`)
    : []
  const key = JSON.stringify([
    factory?.factory_id || '', slice.aggregate.category, slice.aggregate.item_name, slice.aggregate.unit,
    slice.aggregate.characteristics,
  ])
  const baseRow = {
    category: slice.aggregate.category === 'pipe' && slice.aggregate.unit === 'кг'
      ? 'Проволока' : MATERIAL_CATEGORY_LABELS[slice.aggregate.category],
    material: slice.aggregate.item_name,
    steelType: steelType === MISSING_STEEL_TYPE ? 'Не указан' : steelType,
    characteristics: [...baseCharacteristics, ...notes].join('; '),
    unit: slice.aggregate.unit,
    supplier: supplierNames.join(', ') || 'Не назначен',
    machines: machineNames.join(', ') || 'Не указаны',
  }
  const entry = (row: SupplyDateOrderReportRow): ReportEntry => ({
    key, row, baseCharacteristics, notes, supplierNames, machineNames,
  })
  if (!factory || !isSupplyOrderBarMaterial(slice.aggregate)) {
    return [entry({ ...baseRow, purchaseComposition: '', barLengthMm: null, barCount: null,
      quantity: slice.unscheduledQuantity, weightKg })]
  }
  const purchase = makeRemainingLongStockPurchase({ ...factory, items: sliceItems }, slice.unscheduledQuantity, slice.pieceLengthMm)
  if (purchase.components.length === 0) {
    return [entry({ ...baseRow, purchaseComposition: purchase.issue, barLengthMm: null, barCount: null,
      quantity: slice.unscheduledQuantity, weightKg })]
  }
  return purchase.components.map((component) => {
    const quantity = component.length_mm * component.piece_count
    return entry({ ...baseRow, purchaseComposition: formatLongStockPurchaseComposition([component]),
      barLengthMm: component.length_mm, barCount: component.piece_count, quantity,
      weightKg: weightKg === null ? null : weightKg * quantity / slice.unscheduledQuantity })
  })
}

function sumMaterialRows(entries: ReportEntry[]): SupplyDateOrderReportRow[] {
  const groups = new Map<string, {
    row: SupplyDateOrderReportRow
    baseCharacteristics: string[]
    notes: Set<string>
    suppliers: Set<string>
    machines: Set<string>
    lengths: Map<number, number>
    issues: Set<string>
  }>()
  for (const entry of entries) {
    const group = groups.get(entry.key) || {
      row: { ...entry.row, quantity: 0, weightKg: 0, barLengthMm: null, barCount: null, purchaseComposition: '' },
      baseCharacteristics: entry.baseCharacteristics,
      notes: new Set<string>(), suppliers: new Set<string>(), machines: new Set<string>(),
      lengths: new Map<number, number>(), issues: new Set<string>(),
    }
    group.row.quantity += entry.row.quantity
    group.row.weightKg = group.row.weightKg === null || entry.row.weightKg === null
      ? null : group.row.weightKg + entry.row.weightKg
    entry.notes.forEach((note) => group.notes.add(note))
    entry.supplierNames.forEach((name) => group.suppliers.add(name))
    entry.machineNames.forEach((name) => group.machines.add(name))
    if (entry.row.barLengthMm !== null && entry.row.barCount !== null) {
      group.lengths.set(entry.row.barLengthMm, (group.lengths.get(entry.row.barLengthMm) || 0) + entry.row.barCount)
    } else if (entry.row.purchaseComposition) group.issues.add(entry.row.purchaseComposition)
    groups.set(entry.key, group)
  }
  return [...groups.values()].map((group) => {
    const lengths = [...group.lengths.entries()].sort(([left], [right]) => right - left)
    const composition = lengths.map(([length, count]) => `${new Intl.NumberFormat('ru-RU').format(length)} × ${count}`)
    return {
      ...group.row,
      characteristics: [...group.baseCharacteristics, ...group.notes].join('; '),
      supplier: [...group.suppliers].sort((a, b) => a.localeCompare(b, 'ru')).join(', ') || 'Не назначен',
      machines: [...group.machines].sort((a, b) => a.localeCompare(b, 'ru')).join(', ') || 'Не указаны',
      purchaseComposition: [...composition, ...group.issues].join('; '),
      barLengthMm: lengths.length === 1 && group.issues.size === 0 ? lengths[0][0] : null,
      barCount: lengths.length > 0 && group.issues.size === 0
        ? lengths.reduce((sum, [, count]) => sum + count, 0) : null,
    }
  })
}

export function supplyDateOrderFilename(dateKey: string) {
  const suffix = dateKey === 'no_supply_date' ? 'bez-daty' : dateKey
  return `zakaz-materialov-${suffix}.xlsx`
}

export function supplyOrderExportFilename(scope: SupplyOrderExportScope) {
  if (scope.kind === 'date') return supplyDateOrderFilename(scope.dateKey)
  if (scope.kind === 'period') return `zakaz-materialov-${scope.from}_${scope.to}.xlsx`
  return `zakaz-materialov-order-${scope.machineId}.xlsx`
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
  pieceLengthMm: number | null = null,
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

  const matchingComponents = pieceLengthMm
    ? purchase.components.filter((component) => component.length_mm === pieceLengthMm)
    : purchase.components
  const remainingComponents = matchingComponents
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

  const matchingLengths = matchingComponents.filter((component) => (
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
