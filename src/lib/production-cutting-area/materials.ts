import {
  formatMaterialRequestStockQuantity,
  getMaterialRequestStockCoverage,
  type MaterialRequestItemTable,
} from '@/lib/material-request-stock-coverage'
import { materialFulfillment } from '@/lib/supply-orders/material-fulfillment'
import { CHAIN_CORD_SUBTYPE_LABELS, PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'

export type CuttingAreaMaterialTable = MaterialRequestItemTable | 'request_round_tube'
export type CuttingAreaMaterialState = 'not_ordered' | 'delivery' | 'received' | 'stock'
export type CuttingAreaMaterialDetail = {
  id: string
  requestId: string
  category: string
  label: string
  description: string | null
  quantity: string
  demandQuantity: string
  stockQuantity: string
  notes: string[]
}
export type CuttingAreaMaterialSummary = {
  counts: Record<CuttingAreaMaterialState, number>
  details: Record<CuttingAreaMaterialState, CuttingAreaMaterialDetail[]>
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
  plannedLogicalQuantity?: number
  inactive?: boolean
  custom_delivery_date?: string | null
  steel_types?: { name?: string | null } | null
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
  allocated_piece_count?: number | string | null
  received_piece_length_mm?: number | string | null
  allocated_physical_quantity?: number | string | null
  planned_piece_length_mm?: number | string | null
  planned_piece_count?: number | string | null
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
    return { needed: positive(item.order_kg), reserved: positive(item.reserved_from_stock_kg), unit: 'кг' }
  }
  const value = getMaterialRequestStockCoverage(item.table, item)
  return { needed: positive(value.needed), reserved: positive(value.reserved), unit: value.unit }
}

const categoryLabels: Record<CuttingAreaMaterialTable, string> = {
  request_sheet_metal: 'Листовой металл',
  request_round_tube: 'Круг / труба',
  request_circle: 'Круг',
  request_pipe: 'Труба',
  request_knives: 'Ножи',
  request_components: 'Комплектация',
  request_paint: 'Краска',
  request_mesh: 'Сетка',
  request_chain_cord: 'Цепь / шнур',
}

function compact(parts: unknown[]) {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== '' && part !== false)
    .map(String)
    .join(' · ')
}

function value(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number)
    ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(number)
    : null
}

function materialIdentity(item: CuttingAreaMaterialItem) {
  const steelType = item.steel_types?.name?.trim()
  if (item.table === 'request_sheet_metal') return {
    label: String(item.material_name || 'Листовой металл'),
    description: compact([
      item.material_grade,
      steelType ? `Тип стали: ${steelType}` : null,
      item.sheet_size,
      value(item.thickness_mm) ? `толщина ${value(item.thickness_mm)} мм` : null,
    ]),
  }
  if (item.table === 'request_round_tube') return {
    label: String(item.material_name || 'Круг / труба'),
    description: compact([value(item.piece_count) ? `${value(item.piece_count)} шт` : null]),
  }
  if (item.table === 'request_circle') return {
    label: String(item.steel_grade || 'Круг'),
    description: compact([
      steelType ? `Тип стали: ${steelType}` : null,
      value(item.diameter_mm) ? `Ø ${value(item.diameter_mm)} мм` : null,
      item.is_calibrated ? 'калиброванный' : null,
    ]),
  }
  if (item.table === 'request_pipe') return {
    label: PIPE_SUBTYPE_LABELS[String(item.pipe_type)] || String(item.pipe_type || 'Труба'),
    description: compact([
      steelType ? `Тип стали: ${steelType}` : null,
      item.size,
      value(item.diameter_mm) ? `Ø ${value(item.diameter_mm)} мм` : null,
      value(item.wall_thickness_mm) ? `стенка ${value(item.wall_thickness_mm)} мм` : null,
    ]),
  }
  if (item.table === 'request_knives') return {
    label: String(item.knife_type || 'Нож'),
    description: compact([
      item.steel_grade,
      steelType ? `Тип стали: ${steelType}` : null,
      value(item.length_mm) ? `длина ${value(item.length_mm)} мм` : null,
      value(item.width_mm) && value(item.height_mm) ? `${value(item.width_mm)}×${value(item.height_mm)} мм` : null,
    ]),
  }
  if (item.table === 'request_components') return {
    label: String(item.component_name || 'Комплектующее'),
    description: compact([
      item.specification,
      value(item.diameter_mm) ? `Ø ${value(item.diameter_mm)} мм` : null,
    ]),
  }
  if (item.table === 'request_paint') return {
    label: compact([item.paint_type || 'Краска', item.ral_code]) || 'Краска',
    description: compact([item.finish]),
  }
  if (item.table === 'request_mesh') return {
    label: String(item.description || 'Сетка'),
    description: value(item.length_mm) && value(item.width_mm)
      ? `${value(item.length_mm)}×${value(item.width_mm)} мм`
      : '',
  }
  return {
    label: CHAIN_CORD_SUBTYPE_LABELS[String(item.item_type)] || String(item.item_type || 'Цепь / шнур'),
    description: compact([item.parameters]),
  }
}

function itemKey(table: string, id: string) { return `${table}:${id}` }

function receivedQuantity(schedule: CuttingAreaMaterialSchedule) {
  return schedule.status === 'delivered'
    ? positive(schedule.allocated_quantity)
    : 0
}

function activeSchedule(schedule: CuttingAreaMaterialSchedule) {
  return schedule.status === 'planned' ? positive(schedule.quantity) > 0 : receivedQuantity(schedule) > 0
}

export function emptyCuttingAreaMaterialSummary(): CuttingAreaMaterialSummary {
  return {
    counts: { not_ordered: 0, delivery: 0, received: 0, stock: 0 },
    details: { not_ordered: [], delivery: [], received: [], stock: [] },
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
      result.details[state].push(...summary.details[state])
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
    if (item.order_status === 'cancelled' || item.inactive) continue
    const key = groupKey(item)
    if (!key) continue
    const own = schedulesByItem.get(itemKey(item.table, item.id)) || []
    const planned = own.filter((schedule) => schedule.status === 'planned')
    const group = sharedSchedules.get(key) || []
    group.push(...planned)
    sharedSchedules.set(key, group)
  }

  const sharedGroupKeys = new Set<string>()
  for (const item of items) {
    const key = groupKey(item)
    const own = schedulesByItem.get(itemKey(item.table, item.id)) || []
    const c = coverage(item)
    const outstanding = c.needed - c.reserved - own.reduce((sum, row) => sum + receivedQuantity(row), 0)
    if (key && !item.inactive && ['ordered', 'delivered'].includes(item.order_status || '') && outstanding > EPSILON
      && !own.some((row) => row.status === 'planned')
      && !dateOnly(item.custom_delivery_date) && (sharedSchedules.get(key) || []).length) {
      sharedGroupKeys.add(key)
    }
  }

  const datesByRequest = new Map<string, Set<string>>()
  for (const item of items) {
    const summary = summaries.get(item.request_id)
    if (!summary || item.order_status === 'cancelled') continue
    if (item.inactive) continue
    const { needed, reserved, unit } = coverage(item)
    if (needed <= EPSILON) continue
    const own = schedulesByItem.get(itemKey(item.table, item.id)) || []
    const key = groupKey(item)
    const shared = key && sharedGroupKeys.has(key) && (['ordered', 'delivered'].includes(item.order_status || '') || own.some((row) => row.status === 'planned'))
      && !dateOnly(item.custom_delivery_date) ? sharedSchedules.get(key) || [] : []
    const effective = shared.length > 0 ? [...own.filter((row) => row.status === 'delivered'), ...shared] : own
    const plannedRows = effective.filter((row) => row.status === 'planned')
    const planned = plannedRows.reduce((sum, row) => sum + positive(row.quantity), 0)
    const delivered = own.reduce((sum, row) => sum + receivedQuantity(row), 0)
    // Receipt allocation is the fact. Lifecycle flags and supplier surplus do not cover demand.
    const progress = materialFulfillment({ demand: needed, stock: reserved,
      allocated: delivered, planned: shared.length > 0 ? 0 : item.plannedLogicalQuantity ?? planned })
    const identity = materialIdentity(item)
    const format = (quantity: number) => formatMaterialRequestStockQuantity(quantity, unit)
    const isBar = item.table === 'request_circle' || item.table === 'request_knives'
      || (item.table === 'request_pipe' && item.pipe_type !== 'wire')
    const plannedByDate = new Map<string, CuttingAreaMaterialSchedule[]>()
    for (const row of plannedRows) {
      const date = dateOnly(row.delivery_date) || ''
      plannedByDate.set(date, [...plannedByDate.get(date) || [], row])
    }
    const notes = [...plannedByDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, rows]) => {
      const label = date ? date.split('-').reverse().join('.') : 'дата не указана'
      const quantity = rows.reduce((sum, row) => sum + positive(row.quantity), 0)
      const piecesByLength = new Map<number, number>()
      for (const row of rows) {
        const length = positive(row.planned_piece_length_mm)
        const pieces = positive(row.planned_piece_count)
        if (length && pieces) piecesByLength.set(length, (piecesByLength.get(length) || 0) + pieces)
      }
      const composition = [...piecesByLength].map(([length, pieces]) => `${pieces} хлыстов по ${value(length)} мм`).join('; ')
      return `Поставка ${label} — ${format(quantity)}${isBar ? ` физического материала${composition ? ` (${composition})` : ''}` : ''}`
    })
    if (!isBar && !shared.length && progress.plannedExcess > EPSILON) {
      notes.push(`По всем будущим поставкам сверх потребности: ${format(progress.plannedExcess)}`)
    }
    if (isBar) notes.push('Потребность показана в длине для заказа; поставка — в физических хлыстах.')
    const add = (state: CuttingAreaMaterialState, quantity: number, stateNotes: string[] = [], sharedQuantity = false) => {
      if (quantity <= EPSILON) return
      summary.counts[state] += 1
      summary.details[state].push({ id: item.id, requestId: item.request_id,
        category: item.table === 'request_pipe' && item.pipe_type === 'wire' ? 'Круг' : categoryLabels[item.table],
        label: identity.label, description: identity.description || null,
        quantity: sharedQuantity ? 'Распределение при приёмке' : format(quantity),
        demandQuantity: format(needed), stockQuantity: format(progress.stock), notes: stateNotes })
    }
    add('stock', progress.stock)
    add('received', progress.received)
    if (shared.length && progress.outstanding > EPSILON) {
      const groupOutstanding = items.filter((member) => groupKey(member) === key && !member.inactive && member.order_status !== 'cancelled')
        .reduce((sum, member) => {
          const c = coverage(member)
          const receipts = schedulesByItem.get(itemKey(member.table, member.id)) || []
          return sum + materialFulfillment({ demand: c.needed, stock: c.reserved,
            allocated: receipts.reduce((amount, row) => amount + receivedQuantity(row), 0), planned: 0 }).outstanding
        }, 0)
      if (!isBar && groupOutstanding > planned + EPSILON) {
        notes.push(`Не заказано по всей группе: ${format(groupOutstanding - planned)}; распределение остатка между заявками не задано.`)
        summary.hasUndatedDelivery = true
      }
      add('delivery', progress.outstanding, [
        'Общий график; распределение при приёмке',
        `Осталось обеспечить эту заявку: ${format(progress.outstanding)}`, ...notes,
      ], true)
    } else {
      add('delivery', progress.expected, notes)
      add('not_ordered', progress.notOrdered, ['Для этого количества нет подтверждённого графика поставки.'])
    }
    const dates = datesByRequest.get(item.request_id) || new Set<string>()
    for (const row of effective) {
      const date = dateOnly(row.delivery_date)
      if (date) dates.add(date)
    }
    const customDate = effective.length === 0 ? dateOnly(item.custom_delivery_date) : null
    if (customDate && progress.outstanding > EPSILON) dates.add(customDate)
    datesByRequest.set(item.request_id, dates)
    summary.hasSharedSchedule ||= shared.length > 0
    summary.hasUndatedDelivery ||= !shared.length && progress.notOrdered > EPSILON
      || (progress.outstanding > EPSILON && plannedRows.some((row) => !dateOnly(row.delivery_date)))
  }
  for (const [id, summary] of summaries) summary.deliveryDates = [...(datesByRequest.get(id) || [])].sort()
  return summaries
}
