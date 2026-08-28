import {
  getMaterialRequestStockCoverage,
  type MaterialRequestItemTable,
} from '@/lib/material-request-stock-coverage'

export type CuttingAreaMaterialTable = MaterialRequestItemTable | 'request_round_tube'
export type CuttingAreaMaterialState = 'not_ordered' | 'delivery' | 'received' | 'stock'
export type CuttingAreaMaterialSummary = {
  counts: Record<CuttingAreaMaterialState, number>
  deliveryDates: string[]
  hasUndatedDelivery: boolean
  hasSharedSchedule: boolean
}

export type CuttingAreaMaterialRequest = {
  id: string
  status: string
  factoryId: string
  plannedMaterialDate: string | null
}

export type CuttingAreaMaterialItem = Record<string, unknown> & {
  id: string
  request_id: string
  table: CuttingAreaMaterialTable
  order_status?: string | null
  ordered_at?: string | null
  material_id?: string | null
  material_variant_id?: string | null
  custom_delivery_date?: string | null
}

export type CuttingAreaMaterialSchedule = {
  id: string
  request_item_table: string
  request_item_id: string
  delivery_date: string | null
  status: string
  quantity: number | string | null
  received_quantity: number | string | null
  allocated_quantity: number | string | null
}

const EPSILON = 0.000001

function positive(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function dateOnly(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

function coverage(item: CuttingAreaMaterialItem) {
  if (item.table === 'request_round_tube') {
    return { needed: positive(item.order_kg), reserved: positive(item.reserved_from_stock_kg) }
  }
  const value = getMaterialRequestStockCoverage(item.table, item)
  return { needed: positive(value.needed), reserved: positive(value.reserved) }
}

function itemKey(table: string, id: string) { return `${table}:${id}` }

function receivedQuantity(schedule: CuttingAreaMaterialSchedule) {
  return schedule.status === 'delivered'
    ? positive(schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity)
    : 0
}

function activeSchedule(schedule: CuttingAreaMaterialSchedule) {
  return schedule.status === 'planned' ? positive(schedule.quantity) > 0 : receivedQuantity(schedule) > 0
}

export function emptyCuttingAreaMaterialSummary(): CuttingAreaMaterialSummary {
  return {
    counts: { not_ordered: 0, delivery: 0, received: 0, stock: 0 },
    deliveryDates: [],
    hasUndatedDelivery: false,
    hasSharedSchedule: false,
  }
}

export function mergeCuttingAreaMaterialSummaries(summaries: CuttingAreaMaterialSummary[]) {
  const result = emptyCuttingAreaMaterialSummary()
  const dates = new Set<string>()
  for (const summary of summaries) {
    for (const state of Object.keys(result.counts) as CuttingAreaMaterialState[]) {
      result.counts[state] += summary.counts[state]
    }
    for (const date of summary.deliveryDates) dates.add(date)
    result.hasUndatedDelivery ||= summary.hasUndatedDelivery
    result.hasSharedSchedule ||= summary.hasSharedSchedule
  }
  result.deliveryDates = [...dates].sort()
  return result
}

export function buildCuttingAreaMaterialSummaries(
  requests: CuttingAreaMaterialRequest[],
  items: CuttingAreaMaterialItem[],
  schedules: CuttingAreaMaterialSchedule[],
): Map<string, CuttingAreaMaterialSummary> {
  const requestById = new Map(requests.map((request) => [request.id, request]))
  const summaries = new Map(requests.map((request) => [request.id, emptyCuttingAreaMaterialSummary()]))
  const schedulesByItem = new Map<string, CuttingAreaMaterialSchedule[]>()
  for (const schedule of schedules) {
    if (!activeSchedule(schedule)) continue
    const key = itemKey(schedule.request_item_table, schedule.request_item_id)
    const rows = schedulesByItem.get(key) || []
    rows.push(schedule)
    schedulesByItem.set(key, rows)
  }

  // Aggregate supply schedules can live on one anchor row. Share only planned
  // dates, never receipts, within an exact factory/date/variant/ordering-batch
  // group. saveAggregateDeliverySchedule assigns the same ordered_at to newly
  // ordered members. Quantity alone is NOT proof: whole bars can exceed demand.
  function groupKey(item: CuttingAreaMaterialItem) {
    const request = requestById.get(item.request_id)
    if (!request || !item.material_id || !item.material_variant_id || !item.ordered_at
      || !['submitted_to_supply', 'completed'].includes(request.status)) return null
    return JSON.stringify([request.factoryId, request.plannedMaterialDate, item.table, item.material_id, item.material_variant_id, item.ordered_at])
  }
  const sharedSchedules = new Map<string, CuttingAreaMaterialSchedule[]>()
  for (const item of items) {
    if (item.order_status === 'cancelled') continue
    const key = groupKey(item)
    if (!key) continue
    const own = schedulesByItem.get(itemKey(item.table, item.id)) || []
    const planned = own.filter((schedule) => schedule.status === 'planned')
    const group = sharedSchedules.get(key) || []
    group.push(...planned)
    sharedSchedules.set(key, group)
  }

  const datesByRequest = new Map<string, Set<string>>()
  for (const item of items) {
    const summary = summaries.get(item.request_id)
    if (!summary || item.order_status === 'cancelled') continue
    const { needed, reserved } = coverage(item)
    const required = Math.max(needed - reserved, 0)
    const own = schedulesByItem.get(itemKey(item.table, item.id)) || []
    const delivered = own.reduce((sum, schedule) => sum + receivedQuantity(schedule), 0)
    let state: CuttingAreaMaterialState
    if (required > EPSILON && own.length > 0 && delivered >= required - EPSILON) state = 'received'
    else if ((own.length === 0 || required <= EPSILON) && item.order_status === 'delivered') state = 'received'
    else if (needed > EPSILON && required <= EPSILON) state = 'stock'
    else if (required <= EPSILON) continue
    else if (item.order_status === 'ordered' || item.order_status === 'delivered' || own.length > 0) state = 'delivery'
    else state = 'not_ordered'
    summary.counts[state] += 1
    if (state === 'stock') continue

    const key = groupKey(item)
    const shared = own.length === 0 && !dateOnly(item.custom_delivery_date) && state === 'delivery' && item.order_status === 'ordered' && key
      ? sharedSchedules.get(key) || [] : []
    const effective = own.length > 0 ? own : shared
    const dates = datesByRequest.get(item.request_id) || new Set<string>()
    for (const schedule of effective) {
      const date = dateOnly(schedule.delivery_date)
      if (date) dates.add(date)
    }
    const customDate = effective.length === 0 ? dateOnly(item.custom_delivery_date) : null
    if (customDate) dates.add(customDate)
    datesByRequest.set(item.request_id, dates)
    summary.hasSharedSchedule ||= shared.length > 0

    if (state === 'delivery' || state === 'not_ordered') {
      const planned = effective.filter((schedule) => schedule.status === 'planned')
      summary.hasUndatedDelivery ||= effective.length === 0
        ? !customDate
        : planned.length === 0 || planned.some((schedule) => !dateOnly(schedule.delivery_date))
      // A receipt can close a shipment without closing the entire request need.
      if (own.length > 0 && delivered + planned.reduce((sum, schedule) => sum + positive(schedule.quantity), 0) < required - EPSILON) {
        summary.hasUndatedDelivery = true
      }
    }
  }
  for (const [id, summary] of summaries) summary.deliveryDates = [...(datesByRequest.get(id) || [])].sort()
  return summaries
}
