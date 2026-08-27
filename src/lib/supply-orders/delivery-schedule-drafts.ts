import type { SupplyOrderAggregateFactory } from '@/lib/actions/supply-orders'
import { mergeLongStockPurchasePlans } from '@/lib/supply-orders/long-stock-purchase-plan'

export type SupplyOrderScheduleDraft = {
  id: string
  delivery_date: string
  quantity: string
  supplier_id: string
  piece_length_mm: string
  piece_count: string
}

type SupplyOrderScheduleDraftDateSlice = {
  dateKey: string
  unscheduledQuantity: number
}

type PlannedScheduleGroup = {
  key: string
  delivery_date: string
  supplier_id: string | null
  quantity: number
  piece_length_mm: number | null
  piece_count: number | null
}

export function buildInitialSupplyOrderScheduleDrafts(
  factory: SupplyOrderAggregateFactory,
  fallbackDate: string,
  dateSlice?: SupplyOrderScheduleDraftDateSlice,
): SupplyOrderScheduleDraft[] {
  const plannedGroups = new Map<string, PlannedScheduleGroup>()
  for (const item of factory.items) {
    for (const schedule of item.delivery_schedules) {
      if (schedule.status !== 'planned') continue
      const key = `${schedule.delivery_date}:${schedule.supplier_id || 'none'}:${schedule.planned_piece_length_mm || 'bulk'}`
      const current = plannedGroups.get(key) || {
        key,
        delivery_date: schedule.delivery_date,
        supplier_id: schedule.supplier_id,
        quantity: 0,
        piece_length_mm: schedule.planned_piece_length_mm,
        piece_count: schedule.planned_piece_count,
      }
      current.quantity += Number(schedule.quantity || 0)
      plannedGroups.set(key, current)
    }
  }

  const existing = Array.from(plannedGroups.values())
    .sort((left, right) => left.delivery_date.localeCompare(right.delivery_date))
    .map((group) => ({
      id: group.key,
      delivery_date: group.delivery_date,
      quantity: formatDraftNumber(group.quantity),
      supplier_id: group.supplier_id || '',
      piece_length_mm: group.piece_length_mm ? formatDraftNumber(group.piece_length_mm) : '',
      piece_count: group.piece_count ? formatDraftNumber(group.piece_count) : '',
    }))

  const scopedExisting = dateSlice
    ? existing.filter((draft) => draft.delivery_date === dateSlice.dateKey)
    : existing
  if (scopedExisting.length > 0) return scopedExisting
  if (dateSlice && dateSlice.unscheduledQuantity <= 0) return []

  const supplierIds = Array.from(new Set(factory.items.map((item) => item.supplier_id).filter(Boolean))) as string[]
  const defaultSupplierId = supplierIds.length === 1 ? supplierIds[0] : ''
  const defaultDeliveryDate = dateSlice?.dateKey && dateSlice.dateKey !== 'no_supply_date'
    ? dateSlice.dateKey
    : factory.supply_delivery_date || factory.production_date || fallbackDate
  const remaining = dateSlice
    ? dateSlice.unscheduledQuantity
    : Math.max(factory.quantity - factory.delivered_schedule_quantity, 0)
  const purchase = mergeLongStockPurchasePlans(
    factory.items.map((item) => item.long_stock_purchase_plan).filter((plan) => plan?.cutting_status === 'plan_approved'),
  )

  if (purchase.components.length > 0) {
    const consumedPieceCountByLength = new Map<number, number>()
    for (const item of factory.items) {
      for (const schedule of item.delivery_schedules) {
        if (schedule.status === 'cancelled') continue
        const pieceLength = Number(schedule.planned_piece_length_mm || schedule.received_piece_length_mm || 0)
        const pieceCount = Number(schedule.planned_piece_count || schedule.received_piece_count || 0)
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
    const remainingComponentsQuantity = remainingComponents.reduce(
      (total, component) => total + component.length_mm * component.piece_count,
      0,
    )
    const components = Math.abs(remainingComponentsQuantity - remaining) <= 0.000001
      ? remainingComponents
      : purchase.components.filter((component) => (
        Number.isInteger(remaining / component.length_mm)
        && remaining / component.length_mm > 0
      )).slice(0, 1).map((component) => ({
        ...component,
        piece_count: remaining / component.length_mm,
      }))

    if (components.length > 0) {
      return components.map((component) => ({
        id: `cutting-plan:${component.length_mm}:${component.is_nonstandard ? 'nonstandard' : 'standard'}`,
        delivery_date: defaultDeliveryDate,
        quantity: formatDraftNumber(component.length_mm * component.piece_count),
        supplier_id: defaultSupplierId,
        piece_length_mm: formatDraftNumber(component.length_mm),
        piece_count: formatDraftNumber(component.piece_count),
      }))
    }
  }

  return [{
    id: 'initial',
    delivery_date: defaultDeliveryDate,
    quantity: remaining > 0 ? formatDraftNumber(remaining) : '',
    supplier_id: defaultSupplierId,
    piece_length_mm: '',
    piece_count: '',
  }]
}

function formatDraftNumber(value: number) {
  return String(Math.round(value * 1000) / 1000)
}
