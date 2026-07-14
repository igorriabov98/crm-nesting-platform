'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import {
  allocateReceiptByPriority,
  committedScheduleQuantity,
  outstandingReceivingQuantity,
} from '@/lib/supply-orders/receiving-quantity.mjs'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { PermissionOperation } from '@/lib/permissions/resources'
import type { MaterialCategory, OrderItemStatus } from '@/lib/types'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'

type DbResult = { data: unknown; error: { message?: string } | null; count?: number | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  neq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  gt: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  range: (from: number, to: number) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
  insert: (values: Record<string, unknown> | Record<string, unknown>[]) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  delete: () => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }
type RpcDb = LooseDb & {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<DbResult>
}

export type SupplyFinancePaymentInput = {
  supplierId: string
  plannedDate: string
  amount: number
  currency: 'UAH' | 'EUR'
  itemKeys: string[]
}

export type SupplyOrderPlacementInput = {
  supplierId: string
  supplyDeliveryDate: string
}

type RequestRow = {
  id: string
  machine_id: string
  machines: { id: string; name: string; factory_id: string | null; planned_material_date: string | null; is_archived: boolean | null } | null
}

type RequestItemRow = Record<string, unknown> & {
  id: string
  request_id: string
  materials?: { id: string; name: string } | null
  supplier_id?: string | null
  material_id?: string | null
  material_variant_id?: string | null
  custom_delivery_date?: string | null
  order_status?: OrderItemStatus
  delivered_at?: string | null
  calculated_weight_kg?: number | null
}

type RawOrderItem = {
  table: string
  id: string
  request_id: string
  category: MaterialCategory
  item_name: string
  to_order: number
  requested_quantity: number
  reserved_quantity: number
  secondary_requested_quantity: number | null
  secondary_reserved_quantity: number | null
  unit: string
  supplier_id: string | null
  material_id: string | null
  material_variant_id: string | null
  custom_delivery_date: string | null
  order_status: OrderItemStatus
  delivered_at: string | null
  calculated_weight_kg: number | null
  selected_piece_length_mm: number | null
}

export type SupplyOrderDeliverySchedule = {
  id: string
  delivery_date: string
  quantity: number
  unit: string
  supplier_id: string | null
  supplier_name: string | null
  change_reason: string | null
  status: 'planned' | 'delivered' | 'cancelled'
  received_quantity: number | null
  allocated_quantity: number | null
  allocated_physical_quantity: number | null
  received_piece_length_mm: number | null
  received_piece_count: number | null
  allocated_piece_count: number | null
  excess_quantity: number | null
  receipt_parent_schedule_id: string | null
  delivered_at: string | null
  received_by: string | null
  created_at: string
  updated_at: string
}

export type SupplyOrderItem = {
  table: string
  id: string
  machine_name: string
  machine_id: string
  category: MaterialCategory
  item_name: string
  to_order: number
  requested_quantity: number
  reserved_quantity: number
  secondary_requested_quantity: number | null
  secondary_reserved_quantity: number | null
  unit: string
  supplier_name: string | null
  supplier_id: string | null
  material_id: string | null
  material_variant_id: string | null
  planned_material_date: string | null
  target_delivery_date: string | null
  is_custom_delivery_date: boolean
  request_id: string
  order_status: OrderItemStatus
  delivered_at: string | null
  stock_available: number | null
  stock_unit: string | null
  stock_items: SupplyOrderStockItem[]
  calculated_weight_kg: number | null
  reservation_id: string | null
  selected_piece_length_mm: number | null
  delivery_schedules: SupplyOrderDeliverySchedule[]
}

export type SupplyOrderStockItem = {
  id: string
  factory_id: string
  piece_length_mm: number | null
  total_quantity: number
  available_quantity: number
  unit: string
  total_secondary_quantity: number | null
  available_secondary_quantity: number | null
  secondary_unit: string | null
}

export type SupplyOrderHistoryItem = {
  id: string
  source: 'item' | 'schedule'
  table: string
  item_id: string
  schedule_id: string | null
  machine_id: string
  machine_name: string
  request_id: string
  category: MaterialCategory
  item_name: string
  characteristics: SupplyOrderAggregateCharacteristic[]
  supplier_name: string | null
  planned_material_date: string | null
  planned_delivery_date: string | null
  accepted_at: string | null
  quantity: number
  unit: string
  weight_kg: number | null
}

export type SupplyOrderAggregateCharacteristic = {
  label: string
  value: string
}

export type SupplyOrderAggregateSourceItem = {
  table: string
  id: string
  request_id: string
  machine_id: string
  machine_name: string
  quantity: number
  unit: string
  supplier_id: string | null
  supplier_name: string | null
  weight_kg: number | null
  order_status: Extract<OrderItemStatus, 'pending' | 'ordered' | 'delivered'>
  supply_delivery_date: string | null
  planned_schedule_quantity: number
  delivered_schedule_quantity: number
  unscheduled_quantity: number
  delivery_schedules: SupplyOrderDeliverySchedule[]
}

export type SupplyOrderAggregateSupplier = {
  id: string | null
  name: string
  item_count: number
  pending_count: number
  ordered_count: number
  delivered_count: number
}

export type SupplyOrderAggregateFactory = {
  factory_id: string | null
  factory_name: string
  quantity: number
  requested_quantity: number
  reserved_quantity: number
  weight_kg: number | null
  item_count: number
  machine_count: number
  pending_count: number
  ordered_count: number
  delivered_count: number
  planned_schedule_quantity: number
  delivered_schedule_quantity: number
  unscheduled_quantity: number
  delivery_schedule_count: number
  has_delivery_schedules: boolean
  production_date: string | null
  supply_delivery_date: string | null
  has_mixed_supply_delivery_dates: boolean
  suppliers: SupplyOrderAggregateSupplier[]
  items: SupplyOrderAggregateSourceItem[]
}

export type SupplyOrderAggregate = {
  id: string
  planned_material_date: string | null
  category: MaterialCategory
  item_name: string
  unit: string
  material_id: string | null
  material_variant_id: string | null
  characteristics: SupplyOrderAggregateCharacteristic[]
  quantity: number
  requested_quantity: number
  reserved_quantity: number
  weight_kg: number | null
  item_count: number
  machine_count: number
  pending_count: number
  ordered_count: number
  delivered_count: number
  planned_schedule_quantity: number
  delivered_schedule_quantity: number
  unscheduled_quantity: number
  factories: SupplyOrderAggregateFactory[]
}

export type SupplyOrderAggregateScheduleInput = {
  delivery_date: string
  quantity: number
  supplier_id?: string | null
  piece_length_mm?: number | null
  piece_count?: number | null
}

export type MaterialReceivingFactory = {
  id: string
  name: string
}

export type MaterialReceivingItem = {
  key: string
  schedule_id: string | null
  table: string
  id: string
  request_id: string
  machine_id: string
  machine_name: string
  factory_id: string | null
  factory_name: string
  delivery_date: string
  planned_quantity: number
  unit: string
  supplier_id: string | null
  supplier_name: string | null
  category: MaterialCategory
  item_name: string
  material_id: string | null
  material_variant_id: string | null
  characteristics: SupplyOrderAggregateCharacteristic[]
  weight_kg: number | null
  is_virtual_schedule: boolean
  piece_length_mm: number | null
  piece_count: number | null
}

export type MaterialReceivingDateGroup = {
  date: string
  is_initially_open: boolean
  items: MaterialReceivingItem[]
}

export type MaterialReceivingPageData = {
  factories: MaterialReceivingFactory[]
  activeFactoryId: string | null
  groups: MaterialReceivingDateGroup[]
}

type SupplyOrderAggregateInputItem = RawOrderItem & {
  raw: RequestItemRow
  machine_id: string
  machine_name: string
  factory_id: string | null
  planned_material_date: string | null
}

const ORDER_TABLES = [
  'request_sheet_metal',
  // @deprecated — round_tube excluded from new UI
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
]
const MATERIAL_COMPLETION_REQUEST_STATUSES = ['submitted_to_supply', 'completed']

async function requireAccess(operation: PermissionOperation = 'view') {
  const { supabase, userId } = await requirePermission('supply_orders', operation)
  return { db: supabase as unknown as RpcDb, userId }
}

async function requireReceivingAccess(operation: PermissionOperation = 'view') {
  const { supabase, userId } = await requirePermission('inventory_receiving', operation)
  return { db: supabase as unknown as RpcDb, userId }
}

function getTargetDeliveryDate(plannedMaterialDate: Date, deliveryDays: number[], deliveryLeadDays: number, customDeliveryDate?: string | null): Date | null {
  if (customDeliveryDate) return new Date(`${customDeliveryDate}T00:00:00`)
  const latestShipDate = new Date(plannedMaterialDate)
  latestShipDate.setDate(latestShipDate.getDate() - deliveryLeadDays)
  if (!deliveryDays.length) return latestShipDate
  const date = new Date(latestShipDate)
  for (let i = 0; i < 7; i++) {
    if (deliveryDays.includes(date.getDay())) return new Date(date)
    date.setDate(date.getDate() - 1)
  }
  return latestShipDate
}

function isoDate(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null
}

function dateValue(value: string | null | undefined) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

async function getNbuEurRate() {
  try {
    const response = await fetch('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew?json&valcode=EUR', {
      next: { revalidate: 60 * 60 },
    })
    if (!response.ok) return null
    const data = await response.json() as Array<{ rate?: number }>
    const rate = Number(data?.[0]?.rate)
    return Number.isFinite(rate) && rate > 0 ? rate : null
  } catch {
    return null
  }
}

async function convertPaymentToUah(amount: number, currency: 'UAH' | 'EUR') {
  if (currency === 'UAH') return { amountUah: Math.round(amount * 100) / 100, exchangeRate: null as number | null }
  const exchangeRate = await getNbuEurRate()
  if (!exchangeRate) throw new Error('Не удалось получить актуальный курс НБУ EUR')
  return { amountUah: Math.round(amount * exchangeRate * 100) / 100, exchangeRate }
}

function itemName(row: RequestItemRow, fallback: unknown) {
  return row.materials?.name || String(fallback || '')
}

function requestedQuantity(table: string, row: RequestItemRow) {
  if (table === 'request_sheet_metal') return Number(row.remainder_qty || row.to_order_kg || 0)
  // @deprecated — round_tube excluded from new UI
  if (table === 'request_round_tube') return Number(row.order_kg || 0)
  if (table === 'request_circle') return Number(row.remainder_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.remainder_kg || 0) : Number(row.remainder_length_mm || 0)
  if (table === 'request_knives') {
    const meters = Number(row.remainder_meters || 0)
    return meters > 0 ? meters * 1000 : Number(row.to_order_mm || 0)
  }
  if (table === 'request_components') return Math.max(Number(row.quantity_needed || 0) - Number(row.stock_remainder || 0), 0)
  if (table === 'request_mesh') return Number(row.remainder_qty || 0)
  if (table === 'request_chain_cord') return Number(row.remainder_meters || 0) * 1000
  return Number(row.remainder_kg || row.to_order_kg || 0)
}

function reservedQuantity(table: string, row: RequestItemRow) {
  if (table === 'request_sheet_metal') return Number(row.reserved_from_stock_kg || 0)
  // @deprecated — round_tube excluded from new UI
  if (table === 'request_round_tube') return Number(row.reserved_from_stock_kg || 0)
  if (table === 'request_circle') return Number(row.reserved_from_stock_mm || 0)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? Number(row.reserved_from_stock_kg || 0) : Number(row.reserved_from_stock_length_mm || 0)
  if (table === 'request_knives') return Number(row.reserved_from_stock_mm || 0)
  if (table === 'request_components') return Number(row.reserved_from_stock || 0)
  if (table === 'request_mesh') return Number(row.reserved_from_stock_qty || 0)
  if (table === 'request_chain_cord') return Number(row.reserved_from_stock_meters || 0) * 1000
  return Number(row.reserved_from_stock_kg || 0)
}

function primaryUnit(table: string, row: RequestItemRow) {
  if (table === 'request_sheet_metal') return 'шт'
  // @deprecated — round_tube excluded from new UI
  if (table === 'request_round_tube') return 'кг'
  if (table === 'request_circle') return 'мм'
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? 'кг' : 'мм'
  if (table === 'request_knives') return 'мм'
  if (table === 'request_components') return String(row.unit || 'шт')
  if (table === 'request_mesh') return 'шт'
  if (table === 'request_chain_cord') return 'мм'
  return 'кг'
}

async function getDeliveryDays(db: LooseDb, supplierIds: string[]) {
  if (supplierIds.length === 0) return new Map<string, number[]>()
  const { data, error } = await db
    .from('supplier_delivery_days')
    .select('supplier_id, day_of_week')
    .in('supplier_id', supplierIds)
  if (error) throw new Error(error.message || 'Не удалось загрузить дни отгрузки')
  const map = new Map<string, number[]>()
  for (const row of (data || []) as { supplier_id: string; day_of_week: number }[]) {
    map.set(row.supplier_id, [...(map.get(row.supplier_id) || []), row.day_of_week])
  }
  return map
}

async function loadRows(db: LooseDb, table: string, requestIds: string[]) {
  if (requestIds.length === 0) return []
  const { data, error } = await db.from(table).select('*, materials(id, name)').in('request_id', requestIds)
  if (error) throw new Error(error.message || 'Не удалось загрузить позиции')
  return (data || []) as RequestItemRow[]
}

async function loadRowsByIds(db: LooseDb, table: string, ids: string[]) {
  if (ids.length === 0) return []
  const { data, error } = await db.from(table).select('*, materials(id, name)').in('id', ids)
  if (error) throw new Error(error.message || 'Не удалось загрузить позиции')
  return (data || []) as RequestItemRow[]
}

function groupItemsByTable(items: { table: string; id: string }[]) {
  const grouped = new Map<string, string[]>()
  for (const item of items) {
    if (!ORDER_TABLES.includes(item.table)) throw new Error('Некорректная таблица позиции')
    grouped.set(item.table, [...(grouped.get(item.table) || []), item.id])
  }
  return grouped
}

async function getAffectedMachineIds(db: LooseDb, groupedItems: Map<string, string[]>) {
  const requestIds = new Set<string>()

  await Promise.all(Array.from(groupedItems.entries()).map(async ([table, ids]) => {
    const { data, error } = await db.from(table).select('request_id').in('id', ids)
    if (error) throw new Error(error.message || 'Не удалось определить заявку позиции')
    const rows = (data || []) as { request_id: string }[]
    for (const row of rows) {
      if (row.request_id) requestIds.add(row.request_id)
    }
  }))

  if (requestIds.size === 0) return []

  const { data, error } = await db
    .from('technologist_requests')
    .select('machine_id')
    .in('id', Array.from(requestIds))
  if (error) throw new Error(error.message || 'Не удалось определить машины позиций')

  return Array.from(new Set(((data || []) as { machine_id: string }[]).map((row) => row.machine_id).filter(Boolean)))
}

function todayDateOnly() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateOnly(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 10) : null
}

function rememberLatestDate(current: string | null, next: string | null) {
  if (!next) return current
  return !current || next > current ? next : current
}

async function syncActualMaterialDatesForMachines(machineIds: string[]) {
  const uniqueMachineIds = Array.from(new Set(machineIds.filter(Boolean)))
  if (uniqueMachineIds.length === 0) return

  const adminDb = createAdminClient() as unknown as LooseDb
  const { data: requestsData, error: requestsError } = await adminDb
    .from('technologist_requests')
    .select('id, machine_id')
    .in('machine_id', uniqueMachineIds)
    .in('status', MATERIAL_COMPLETION_REQUEST_STATUSES)

  if (requestsError) throw new Error(requestsError.message || 'Не удалось проверить заявки снабжения')

  const requests = (requestsData || []) as Array<{ id: string; machine_id: string }>
  const requestIds = requests.map((request) => request.id)
  if (requestIds.length === 0) return

  const requestMachineMap = new Map(requests.map((request) => [request.id, request.machine_id]))
  const stateByMachine = new Map(uniqueMachineIds.map((machineId) => [machineId, {
    hasOrderableItems: false,
    allDelivered: true,
    latestDeliveredDate: null as string | null,
  }]))

  const rowsByTable = await Promise.all(ORDER_TABLES.map(async (table) => ({
    table,
    rows: await loadRows(adminDb, table, requestIds),
  })))

  const orderableItems: Array<{ table: string; row: RequestItemRow; machineId: string }> = []
  for (const { table, rows } of rowsByTable) {
    for (const row of rows) {
      const machineId = requestMachineMap.get(row.request_id)
      if (!machineId) continue

      const toOrder = Math.max(requestedQuantity(table, row) - reservedQuantity(table, row), 0)
      if (toOrder <= 0) continue
      orderableItems.push({ table, row, machineId })
    }
  }

  const itemIds = orderableItems.map((item) => item.row.id)
  const { data: schedulesData, error: schedulesError } = itemIds.length > 0
    ? await adminDb
        .from('supply_order_delivery_schedules')
        .select('request_item_table, request_item_id, delivery_date, status, delivered_at')
        .in('request_item_id', itemIds)
        .neq('status', 'cancelled')
    : { data: [], error: null }

  if (schedulesError) throw new Error(schedulesError.message || 'Не удалось загрузить график снабжения')

  const schedulesByItem = new Map<string, Array<{
    request_item_table: string
    request_item_id: string
    delivery_date: string | null
    status: string | null
    delivered_at: string | null
  }>>()
  for (const schedule of (schedulesData || []) as Array<{
    request_item_table: string
    request_item_id: string
    delivery_date: string | null
    status: string | null
    delivered_at: string | null
  }>) {
    const key = `${schedule.request_item_table}:${schedule.request_item_id}`
    schedulesByItem.set(key, [...(schedulesByItem.get(key) || []), schedule])
  }

  for (const { table, row, machineId } of orderableItems) {
    const state = stateByMachine.get(machineId)
    if (!state) continue

    state.hasOrderableItems = true
    const schedules = schedulesByItem.get(`${table}:${row.id}`) || []
    const itemDelivered = schedules.length > 0
      ? schedules.every((schedule) => schedule.status === 'delivered')
      : row.order_status === 'delivered'

    if (!itemDelivered) {
      state.allDelivered = false
      continue
    }

    state.latestDeliveredDate = rememberLatestDate(state.latestDeliveredDate, dateOnly(row.delivered_at))
    for (const schedule of schedules) {
      if (schedule.status !== 'delivered') continue
      state.latestDeliveredDate = rememberLatestDate(
        state.latestDeliveredDate,
        dateOnly(schedule.delivered_at) || dateOnly(schedule.delivery_date)
      )
    }
  }

  await Promise.all(Array.from(stateByMachine.entries()).map(async ([machineId, state]) => {
    if (!state.hasOrderableItems || !state.allDelivered) return

    const nextDate = state.latestDeliveredDate || todayDateOnly()
    const { error } = await adminDb
      .from('machines')
      .update({ actual_material_date: nextDate })
      .eq('id', machineId)

    if (error) throw new Error(error.message || 'Не удалось обновить фактическую дату поставки материала')
  }))
}

function assertOrderTable(table: string) {
  if (!ORDER_TABLES.includes(table)) throw new Error('Некорректная таблица позиции')
}

function selectedPieceLength(table: string, row: RequestItemRow) {
  if (table === 'request_knives') {
    const value = Number(row.length_mm || 0)
    return Number.isFinite(value) && value > 0 ? value : null
  }
  return null
}

function receiptSecondaryQuantity(item: RawOrderItem) {
  if (item.category === 'pipe' && item.selected_piece_length_mm && item.secondary_requested_quantity !== null) {
    return Math.max((item.secondary_requested_quantity || 0) - (item.secondary_reserved_quantity || 0), 0)
  }
  if (item.category === 'knives' && item.selected_piece_length_mm) {
    return item.to_order / item.selected_piece_length_mm
  }
  return item.secondary_requested_quantity !== null
    ? Math.max((item.secondary_requested_quantity || 0) - (item.secondary_reserved_quantity || 0), 0)
    : null
}

function receiptSecondaryUnit(item: RawOrderItem) {
  if (item.selected_piece_length_mm && (item.category === 'pipe' || item.category === 'knives')) return 'шт'
  if (item.secondary_requested_quantity !== null) return 'м'
  return null
}

function supplierForRow(row: RequestItemRow) {
  return row.supplier_id || null
}

function secondaryRequestedQuantity(table: string, row: RequestItemRow) {
  if (table === 'request_round_tube') return Number(row.order_meters || 0)
  return null
}

function secondaryReservedQuantity(table: string, row: RequestItemRow) {
  if (table === 'request_round_tube') return Number(row.reserved_from_stock_m || 0)
  return null
}

const AGGREGATE_ORDER_STATUSES = new Set<OrderItemStatus>(['pending', 'ordered', 'delivered'])

const IDENTITY_FIELDS: Record<string, Array<[label: string, field: string]>> = {
  request_sheet_metal: [
    ['Материал', 'material_name'],
    ['Марка', 'material_grade'],
    ['Тип стали', 'steel_type_id'],
    ['Толщина', 'thickness_mm'],
    ['Размер листа', 'sheet_size'],
  ],
  request_round_tube: [
    ['Материал', 'material_name'],
    ['Штук/длина', 'piece_count'],
  ],
  request_circle: [
    ['Марка', 'steel_grade'],
    ['Тип стали', 'steel_type_id'],
    ['Диаметр', 'diameter_mm'],
    ['Калиброванный', 'is_calibrated'],
  ],
  request_pipe: [
    ['Тип трубы', 'pipe_type'],
    ['Тип стали', 'steel_type_id'],
    ['Размер', 'size'],
    ['Стенка', 'wall_thickness_mm'],
    ['Диаметр', 'diameter_mm'],
  ],
  request_knives: [
    ['Тип ножа', 'knife_type'],
    ['Марка', 'steel_grade'],
    ['Тип стали', 'steel_type_id'],
    ['Длина', 'length_mm'],
    ['Ширина', 'width_mm'],
    ['Высота', 'height_mm'],
  ],
  request_components: [
    ['Компонент', 'component_name'],
    ['Спецификация', 'specification'],
    ['Диаметр', 'diameter_mm'],
    ['Ед.', 'unit'],
  ],
  request_paint: [
    ['Тип краски', 'paint_type'],
    ['RAL', 'ral_code'],
    ['Финиш', 'finish'],
  ],
  request_mesh: [
    ['Описание', 'description'],
    ['Длина', 'length_mm'],
    ['Ширина', 'width_mm'],
  ],
  request_chain_cord: [
    ['Тип', 'item_type'],
    ['Параметры', 'parameters'],
  ],
}

const DISPLAY_FIELDS: Record<string, Array<[label: string, field: string]>> = Object.fromEntries(
  Object.entries(IDENTITY_FIELDS).map(([table, fields]) => [
    table,
    fields.filter(([, field]) => field !== 'steel_type_id'),
  ])
)

function normalizeCharacteristicValue(value: unknown) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  const text = String(value).trim()
  return text.length ? text : null
}

function getCharacteristicParts(table: string, row: RequestItemRow, displayOnly = false) {
  const fields = (displayOnly ? DISPLAY_FIELDS : IDENTITY_FIELDS)[table] || []
  return fields.flatMap(([label, field]) => {
    const value = normalizeCharacteristicValue(row[field])
    return value ? [{ label, value }] : []
  })
}

function getAggregateIdentityKey(table: string, row: RequestItemRow, item: RawOrderItem) {
  const base = [
    table,
    item.category,
    item.material_id || item.item_name,
    item.unit,
  ]

  if (item.material_variant_id) {
    return [...base, `variant:${item.material_variant_id}`].join('|')
  }

  const characteristics = getCharacteristicParts(table, row)
    .map((part) => `${part.label}:${part.value}`)

  return [...base, ...characteristics].join('|')
}

function getAggregateCharacteristics(table: string, row: RequestItemRow, item: RawOrderItem): SupplyOrderAggregateCharacteristic[] {
  const characteristics = getCharacteristicParts(table, row, true)
  return characteristics.length ? characteristics : [{ label: 'Позиция', value: item.item_name }]
}

function plannedDateKey(value: string | null) {
  return value || 'no_planned_date'
}

function factoryKey(value: string | null) {
  return value || 'no_factory'
}

function effectiveSupplyDeliveryDate(item: Pick<RawOrderItem, 'custom_delivery_date'>, plannedDate: string | null) {
  return item.custom_delivery_date || plannedDate || null
}

function assertDateOrNull(value: string | null) {
  if (value === null) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('Некорректная дата поставки')
  const date = new Date(`${normalized}T00:00:00`)
  if (Number.isNaN(date.getTime())) throw new Error('Некорректная дата поставки')
  return normalized
}

function normalizeOrderPlacement(input?: SupplyOrderPlacementInput) {
  if (!input) return null
  const supplierId = input.supplierId.trim()
  if (!supplierId) throw new Error('Укажите поставщика')
  const supplyDeliveryDate = assertDateOrNull(input.supplyDeliveryDate)
  if (!supplyDeliveryDate) throw new Error('Укажите мат.план снабжения')
  return { supplierId, supplyDeliveryDate }
}

function validateReceiptFields(item: RawOrderItem) {
  if (item.category === 'knives') {
    if (!item.selected_piece_length_mm) throw new Error(`Для ножа "${item.item_name}" не указана длина складской позиции`)
  }
}

function receiptPayload(item: RawOrderItem) {
  const secondaryQuantity = receiptSecondaryQuantity(item)
  return {
    table: item.table,
    id: item.id,
    material_id: item.material_id,
    material_variant_id: item.material_variant_id,
    quantity: item.to_order,
    unit: item.unit,
    secondary_quantity: secondaryQuantity,
    secondary_unit: secondaryQuantity !== null ? receiptSecondaryUnit(item) : null,
    supplier_id: item.supplier_id,
    piece_length_mm: item.selected_piece_length_mm,
    comment: `Приход по листу закупки: ${item.item_name}`,
  }
}

function validateScheduleInput(data: { delivery_date: string; quantity: number }) {
  if (!data.delivery_date) throw new Error('Укажите дату поставки')
  const date = new Date(`${data.delivery_date}T00:00:00`)
  if (Number.isNaN(date.getTime())) throw new Error('Некорректная дата поставки')
  if (!Number.isFinite(data.quantity) || data.quantity <= 0) throw new Error('Количество поставки должно быть больше 0')
}

async function loadOneOrderItem(db: LooseDb, table: string, id: string) {
  const grouped = new Map([[table, [id]]])
  const [item] = await loadSelectedOrderItems(db, grouped)
  if (!item) throw new Error('Позиция закупки не найдена')
  return item
}

async function getPlannedScheduleTotal(db: LooseDb, table: string, id: string, excludeId?: string) {
  const { data, error } = await db
    .from('supply_order_delivery_schedules')
    .select('id, quantity, status, received_quantity')
    .eq('request_item_table', table)
    .eq('request_item_id', id)
    .neq('status', 'cancelled')
  if (error) throw new Error(error.message || 'Не удалось загрузить график поставок')
  return ((data || []) as Array<{ id: string; quantity: number; status: string; received_quantity: number | null }>)
    .filter((row) => row.id !== excludeId)
    .reduce((sum, row) => sum + committedScheduleQuantity(row), 0)
}

async function loadSelectedOrderItems(db: LooseDb, groupedItems: Map<string, string[]>): Promise<RawOrderItem[]> {
  const selectedRows = await Promise.all(Array.from(groupedItems.entries()).map(async ([table, ids]) => ({
    table,
    rows: await loadRowsByIds(db, table, ids),
  })))
  const requestIds = Array.from(new Set(selectedRows.flatMap(({ rows }) => rows.map((row) => row.request_id).filter(Boolean))))
  if (!requestIds.length) return []

  const { data: requestsData, error } = await db
    .from('technologist_requests')
    .select('id, machine_id, status, submitted_at, machines!inner(id, name, factory_id, planned_material_date, is_archived)')
    .in('id', requestIds)
  if (error) throw new Error(error.message || 'Не удалось загрузить заявки')
  const requests = (requestsData || []) as RequestRow[]
  const requestMap = new Map(requests.map((request) => [request.id, request]))

  const makeItem = (table: string, category: MaterialCategory, row: RequestItemRow, name: unknown, supplierId: string | null = null): RawOrderItem => {
    const request = requestMap.get(row.request_id)
    if (!request || request.machines?.is_archived) throw new Error('Позиция относится к архивной или недоступной машине')
    const requested = requestedQuantity(table, row)
    const reserved = reservedQuantity(table, row)
    return {
      table,
      category,
      id: row.id,
      request_id: row.request_id,
      item_name: itemName(row, name),
      requested_quantity: requested,
      reserved_quantity: reserved,
      secondary_requested_quantity: secondaryRequestedQuantity(table, row),
      secondary_reserved_quantity: secondaryReservedQuantity(table, row),
      to_order: Math.max(requested - reserved, 0),
      unit: primaryUnit(table, row),
      supplier_id: supplierId,
      material_id: row.material_id || null,
      material_variant_id: row.material_variant_id || null,
      custom_delivery_date: row.custom_delivery_date || null,
      order_status: (row.order_status || 'pending') as OrderItemStatus,
      delivered_at: row.delivered_at || null,
      calculated_weight_kg: Number(row.calculated_weight_kg || 0) || null,
      selected_piece_length_mm: selectedPieceLength(table, row),
    }
  }

  const rawItems: RawOrderItem[] = selectedRows.flatMap(({ table, rows }) => {
    if (table === 'request_sheet_metal') return rows.map((row) => makeItem(table, 'sheet_metal', row, row.material_name, supplierForRow(row)))
    if (table === 'request_round_tube') return rows.map((row) => makeItem(table, 'round_tube', row, row.material_name, supplierForRow(row)))
    if (table === 'request_circle') return rows.map((row) => makeItem(table, 'circle', row, row.steel_grade, supplierForRow(row)))
    if (table === 'request_pipe') return rows.map((row) => makeItem(table, 'pipe', row, row.size, supplierForRow(row)))
    if (table === 'request_knives') return rows.map((row) => makeItem(table, 'knives', row, row.knife_type, supplierForRow(row)))
    if (table === 'request_components') return rows.map((row) => makeItem(table, 'components', row, row.component_name, supplierForRow(row)))
    if (table === 'request_paint') return rows.map((row) => makeItem(table, 'paint', row, row.paint_type || row.ral_code, supplierForRow(row)))
    if (table === 'request_mesh') return rows.map((row) => makeItem(table, 'mesh', row, row.description, supplierForRow(row)))
    if (table === 'request_chain_cord') return rows.map((row) => makeItem(table, 'chain_cord', row, row.parameters, supplierForRow(row)))
    return []
  })

  const materialIds = Array.from(new Set(rawItems.map((item) => item.material_id).filter(Boolean))) as string[]
  const materialsRes = materialIds.length
    ? await db.from('materials').select('id, default_supplier_id').in('id', materialIds)
    : { data: [], error: null }
  if (materialsRes.error) throw new Error(materialsRes.error.message || 'Не удалось загрузить материалы')
  const materialSupplierMap = new Map(((materialsRes.data || []) as { id: string; default_supplier_id: string | null }[]).map((item) => [item.id, item.default_supplier_id]))

  return rawItems.map((item) => ({
    ...item,
    supplier_id: item.supplier_id || (item.material_id ? materialSupplierMap.get(item.material_id) || null : null),
  }))
}

export async function getSupplyOrders(page = 0, pageSize = 50) {
  try {
    const { db } = await requireAccess()
    const safePage = Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0)
    const safePageSize = Math.min(100, Math.max(1, Number.isFinite(pageSize) ? Math.floor(pageSize) : 50))
    const from = safePage * safePageSize
    const to = from + safePageSize - 1

    const { data: requestsData, error, count } = await db
      .from('technologist_requests')
      .select('id, machine_id, status, submitted_at, machines!inner(id, name, factory_id, planned_material_date, is_archived)', { count: 'exact' })
      .in('status', ['submitted_to_supply', 'completed'])
      .eq('machines.is_archived', false)
      .order('submitted_at', { ascending: false })
      .range(from, to)
    if (error) throw new Error(error.message || 'Не удалось загрузить заявки')

    const requests = (requestsData || []) as RequestRow[]
    const requestIds = requests.map((request) => request.id)
    const requestMap = new Map(requests.map((request) => [request.id, request]))
    const [sheet, round, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
      loadRows(db, 'request_sheet_metal', requestIds),
      // @deprecated — round_tube excluded from new UI
      loadRows(db, 'request_round_tube', requestIds),
      loadRows(db, 'request_circle', requestIds),
      loadRows(db, 'request_pipe', requestIds),
      loadRows(db, 'request_knives', requestIds),
      loadRows(db, 'request_components', requestIds),
      loadRows(db, 'request_paint', requestIds),
      loadRows(db, 'request_mesh', requestIds),
      loadRows(db, 'request_chain_cord', requestIds),
    ])
    const makeItem = (table: string, category: MaterialCategory, row: RequestItemRow, name: unknown, supplierId: string | null = null): RawOrderItem => {
      const requested = requestedQuantity(table, row)
      const reserved = reservedQuantity(table, row)
      return { table, category, id: row.id, request_id: row.request_id, item_name: itemName(row, name), requested_quantity: requested, reserved_quantity: reserved, secondary_requested_quantity: secondaryRequestedQuantity(table, row), secondary_reserved_quantity: secondaryReservedQuantity(table, row), to_order: Math.max(requested - reserved, 0), unit: primaryUnit(table, row), supplier_id: supplierId, material_id: row.material_id || null, material_variant_id: row.material_variant_id || null, custom_delivery_date: row.custom_delivery_date || null, order_status: (row.order_status || 'pending') as OrderItemStatus, delivered_at: row.delivered_at || null, calculated_weight_kg: Number(row.calculated_weight_kg || 0) || null, selected_piece_length_mm: selectedPieceLength(table, row) }
    }
    const rawItems: RawOrderItem[] = [
      ...sheet.map((row) => makeItem('request_sheet_metal', 'sheet_metal', row, row.material_name, supplierForRow(row))),
      // @deprecated — round_tube excluded from new UI
      ...round.map((row) => makeItem('request_round_tube', 'round_tube', row, row.material_name, supplierForRow(row))),
      ...circles.map((row) => makeItem('request_circle', 'circle', row, row.steel_grade, supplierForRow(row))),
      ...pipes.map((row) => makeItem('request_pipe', 'pipe', row, row.size, supplierForRow(row))),
      ...knives.map((row) => makeItem('request_knives', 'knives', row, row.knife_type, supplierForRow(row))),
      ...components.map((row) => makeItem('request_components', 'components', row, row.component_name, supplierForRow(row))),
      ...paint.map((row) => makeItem('request_paint', 'paint', row, row.paint_type || row.ral_code, supplierForRow(row))),
      ...meshItems.map((row) => makeItem('request_mesh', 'mesh', row, row.description, supplierForRow(row))),
      ...chainCords.map((row) => makeItem('request_chain_cord', 'chain_cord', row, row.parameters, supplierForRow(row))),
    ]
    const orderableRawItems = rawItems.filter((item) => item.to_order > 0)

    const materialIds = Array.from(new Set(orderableRawItems.map((item) => item.material_id).filter(Boolean))) as string[]
    const materialsRes = materialIds.length
      ? await db.from('materials').select('id, default_supplier_id').in('id', materialIds)
      : { data: [], error: null }
    if (materialsRes.error) throw new Error(materialsRes.error.message || 'Не удалось загрузить материалы')
    const materialSupplierMap = new Map(((materialsRes.data || []) as { id: string; default_supplier_id: string | null }[]).map((item) => [item.id, item.default_supplier_id]))

    const rawItemsWithSuppliers = orderableRawItems.map((item) => ({
      ...item,
      supplier_id: item.supplier_id || (item.material_id ? materialSupplierMap.get(item.material_id) || null : null),
    }))
    const stockFactoryIds = Array.from(new Set(orderableRawItems.map((item) => requestMap.get(item.request_id)?.machines?.factory_id).filter(Boolean))) as string[]
    const [inventoryRes, reservationsRes, schedulesRes] = await Promise.all([
      materialIds.length && stockFactoryIds.length ? db.from('inventory').select('id, factory_id, material_id, material_variant_id, total_quantity, available_quantity, unit, total_secondary_quantity, available_secondary_quantity, secondary_unit, piece_length_mm').in('material_id', materialIds).in('factory_id', stockFactoryIds) : Promise.resolve({ data: [], error: null } as DbResult),
      orderableRawItems.length ? db.from('inventory_reservations').select('id, request_item_table, request_item_id, consumed_at').in('request_item_id', orderableRawItems.map((item) => item.id)) : Promise.resolve({ data: [], error: null } as DbResult),
      orderableRawItems.length ? db.from('supply_order_delivery_schedules').select('id, request_item_table, request_item_id, delivery_date, quantity, unit, supplier_id, change_reason, status, received_quantity, allocated_quantity, allocated_physical_quantity, received_piece_length_mm, received_piece_count, allocated_piece_count, excess_quantity, receipt_parent_schedule_id, delivered_at, received_by, created_at, updated_at').in('request_item_id', orderableRawItems.map((item) => item.id)).order('delivery_date', { ascending: true }) : Promise.resolve({ data: [], error: null } as DbResult),
    ])
    if (inventoryRes.error) throw new Error(inventoryRes.error.message || 'Не удалось загрузить остатки склада')
    if (reservationsRes.error) throw new Error(reservationsRes.error.message || 'Не удалось загрузить бронирования')
    if (schedulesRes.error) throw new Error(schedulesRes.error.message || 'Не удалось загрузить график поставок')
    const stockRows = (inventoryRes.data || []) as { id: string; factory_id: string; material_id: string; material_variant_id: string | null; total_quantity: number; available_quantity: number; unit: string; total_secondary_quantity: number | null; available_secondary_quantity: number | null; secondary_unit: string | null; piece_length_mm: number | null }[]
    const stockMap = new Map(stockRows.map((item) => [`${factoryKey(item.factory_id)}:${item.material_id}:${item.material_variant_id || 'legacy'}:${item.piece_length_mm ?? 'null'}`, item]))
    const stockGroupMap = new Map<string, typeof stockRows>()
    const materialStockMap = new Map<string, typeof stockRows>()
    for (const item of stockRows) {
      const groupKey = `${factoryKey(item.factory_id)}:${item.material_id}:${item.material_variant_id || 'legacy'}`
      stockGroupMap.set(groupKey, [...(stockGroupMap.get(groupKey) || []), item])
      materialStockMap.set(`${factoryKey(item.factory_id)}:${item.material_id}`, [...(materialStockMap.get(`${factoryKey(item.factory_id)}:${item.material_id}`) || []), item])
    }
    for (const rows of stockGroupMap.values()) {
      rows.sort((a, b) => Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
    }
    for (const rows of materialStockMap.values()) {
      rows.sort((a, b) => Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
    }
    const reservationMap = new Map(((reservationsRes.data || []) as { id: string; request_item_table: string; request_item_id: string; consumed_at: string | null }[])
      .filter((item) => !item.consumed_at)
      .map((item) => [`${item.request_item_table}:${item.request_item_id}`, item.id]))
    const scheduleRows = ((schedulesRes.data || []) as Array<SupplyOrderDeliverySchedule & { request_item_table: string; request_item_id: string }>)
      .filter((row) => row.status !== 'cancelled')
      .filter((row) => orderableRawItems.some((item) => item.table === row.request_item_table && item.id === row.request_item_id))
    const scheduleMap = new Map<string, typeof scheduleRows>()
    for (const schedule of scheduleRows) {
      const key = `${schedule.request_item_table}:${schedule.request_item_id}`
      scheduleMap.set(key, [...(scheduleMap.get(key) || []), schedule])
    }
    const supplierIds = Array.from(new Set([
      ...rawItemsWithSuppliers.map((item) => item.supplier_id).filter(Boolean),
      ...scheduleRows.map((schedule) => schedule.supplier_id).filter(Boolean),
    ])) as string[]
    const [deliveryDays, suppliersRes] = await Promise.all([
      getDeliveryDays(db, supplierIds),
      supplierIds.length
        ? db.from('suppliers').select('id, name, delivery_lead_days').in('id', supplierIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
    ])
    if (suppliersRes.error) throw new Error(suppliersRes.error.message || 'Не удалось загрузить поставщиков')
    const supplierMap = new Map(((suppliersRes.data || []) as { id: string; name: string }[]).map((supplier) => [supplier.id, supplier.name]))
    const leadMap = new Map(((suppliersRes.data || []) as { id: string; delivery_lead_days: number }[]).map((supplier) => [supplier.id, supplier.delivery_lead_days || 0]))

    const items: SupplyOrderItem[] = rawItemsWithSuppliers.map((item) => {
      const request = requestMap.get(item.request_id)
      const machine = request?.machines
      const planned = machine?.planned_material_date || null
      const needsExactVariant = item.category === 'pipe' || item.category === 'knives'
      const itemFactoryKey = factoryKey(machine?.factory_id || null)
      const stockItems = item.material_id
        ? needsExactVariant
          ? item.material_variant_id
            ? stockGroupMap.get(`${itemFactoryKey}:${item.material_id}:${item.material_variant_id}`) || []
            : []
          : stockGroupMap.get(`${itemFactoryKey}:${item.material_id}:${item.material_variant_id || 'legacy'}`) ||
            stockGroupMap.get(`${itemFactoryKey}:${item.material_id}:legacy`) ||
            materialStockMap.get(`${itemFactoryKey}:${item.material_id}`) ||
            []
        : []
      const stockItem = item.material_id
        ? needsExactVariant
          ? item.material_variant_id
            ? stockMap.get(`${itemFactoryKey}:${item.material_id}:${item.material_variant_id}:null`) || stockItems[0] || null
            : null
          : stockMap.get(`${itemFactoryKey}:${item.material_id}:${item.material_variant_id || 'legacy'}:null`) ||
            stockMap.get(`${itemFactoryKey}:${item.material_id}:legacy:null`) ||
            stockItems[0] ||
            null
        : null
      const stockAvailable = stockItems.length
        ? stockItems.reduce((sum, row) => sum + Number(row.available_quantity || 0), 0)
        : stockItem?.available_quantity ?? null
      const deliverySchedules = scheduleMap.get(`${item.table}:${item.id}`) || []
      const firstScheduleDate = deliverySchedules[0]?.delivery_date || null
      const target = planned
        ? getTargetDeliveryDate(new Date(planned), item.supplier_id ? (deliveryDays.get(item.supplier_id) || []) : [], item.supplier_id ? (leadMap.get(item.supplier_id) || 0) : 0, item.custom_delivery_date)
        : null
      return {
        table: item.table,
        id: item.id,
        machine_name: machine?.name || 'Машина',
        machine_id: machine?.id || request?.machine_id || '',
        category: item.category,
        item_name: item.item_name,
        to_order: item.to_order,
        unit: item.unit,
        supplier_name: item.supplier_id ? supplierMap.get(item.supplier_id) || 'Поставщик' : null,
        supplier_id: item.supplier_id,
        material_id: item.material_id,
        material_variant_id: item.material_variant_id,
        planned_material_date: planned,
        target_delivery_date: firstScheduleDate || isoDate(target),
        is_custom_delivery_date: !!item.custom_delivery_date || deliverySchedules.length > 0,
        request_id: item.request_id,
        order_status: item.order_status || 'pending',
        delivered_at: item.delivered_at,
        requested_quantity: item.requested_quantity,
        reserved_quantity: item.reserved_quantity,
        secondary_requested_quantity: item.secondary_requested_quantity,
        secondary_reserved_quantity: item.secondary_reserved_quantity,
        stock_available: stockAvailable,
        stock_unit: stockItem?.unit ?? null,
        stock_items: stockItems.map((row) => ({
          id: row.id,
          factory_id: row.factory_id,
          piece_length_mm: row.piece_length_mm,
          total_quantity: row.total_quantity,
          available_quantity: row.available_quantity,
          unit: row.unit,
          total_secondary_quantity: row.total_secondary_quantity,
          available_secondary_quantity: row.available_secondary_quantity,
          secondary_unit: row.secondary_unit,
        })),
        calculated_weight_kg: item.calculated_weight_kg,
        reservation_id: reservationMap.get(`${item.table}:${item.id}`) || null,
        selected_piece_length_mm: item.selected_piece_length_mm,
        delivery_schedules: deliverySchedules.map((schedule) => ({
          id: schedule.id,
          delivery_date: schedule.delivery_date,
          quantity: Number(schedule.quantity || 0),
          unit: schedule.unit,
          supplier_id: schedule.supplier_id,
          supplier_name: schedule.supplier_id ? supplierMap.get(schedule.supplier_id) || 'Поставщик' : null,
          change_reason: schedule.change_reason,
          status: schedule.status || 'planned',
          received_quantity: schedule.received_quantity === null || schedule.received_quantity === undefined ? null : Number(schedule.received_quantity),
          allocated_quantity: schedule.allocated_quantity === null || schedule.allocated_quantity === undefined ? null : Number(schedule.allocated_quantity),
          allocated_physical_quantity: schedule.allocated_physical_quantity === null || schedule.allocated_physical_quantity === undefined ? null : Number(schedule.allocated_physical_quantity),
          received_piece_length_mm: schedule.received_piece_length_mm === null || schedule.received_piece_length_mm === undefined ? null : Number(schedule.received_piece_length_mm),
          received_piece_count: schedule.received_piece_count === null || schedule.received_piece_count === undefined ? null : Number(schedule.received_piece_count),
          allocated_piece_count: schedule.allocated_piece_count === null || schedule.allocated_piece_count === undefined ? null : Number(schedule.allocated_piece_count),
          excess_quantity: schedule.excess_quantity === null || schedule.excess_quantity === undefined ? null : Number(schedule.excess_quantity),
          receipt_parent_schedule_id: schedule.receipt_parent_schedule_id || null,
          delivered_at: schedule.delivered_at,
          received_by: schedule.received_by,
          created_at: schedule.created_at,
          updated_at: schedule.updated_at,
        })),
      }
    })

    return {
      data: items,
      error: null,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total: count || 0,
        from,
        to: Math.min(to, Math.max((count || 0) - 1, 0)),
      },
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заказы', pagination: null }
  }
}

export async function getSupplyOrderHistory(page = 0, pageSize = 50) {
  try {
    const { db } = await requireAccess()
    const safePage = Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0)
    const safePageSize = Math.min(100, Math.max(1, Number.isFinite(pageSize) ? Math.floor(pageSize) : 50))
    const from = safePage * safePageSize
    const to = from + safePageSize

    type HistoryInputItem = RawOrderItem & {
      raw: RequestItemRow
      machine_id: string
      machine_name: string
      planned_material_date: string | null
    }

    const { data: requestsData, error } = await db
      .from('technologist_requests')
      .select('id, machine_id, status, submitted_at, machines!inner(id, name, factory_id, planned_material_date, is_archived)')
      .in('status', ['submitted_to_supply', 'completed'])
      .eq('machines.is_archived', false)
      .order('submitted_at', { ascending: false })

    if (error) throw new Error(error.message || 'Не удалось загрузить заявки')

    const requests = (requestsData || []) as RequestRow[]
    const requestIds = requests.map((request) => request.id)
    const requestMap = new Map(requests.map((request) => [request.id, request]))
    if (requestIds.length === 0) {
      return { data: [], error: null, pagination: { page: safePage, pageSize: safePageSize, total: 0, from: 0, to: 0 } }
    }

    const [sheet, round, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
      loadRows(db, 'request_sheet_metal', requestIds),
      // @deprecated — round_tube excluded from new UI
      loadRows(db, 'request_round_tube', requestIds),
      loadRows(db, 'request_circle', requestIds),
      loadRows(db, 'request_pipe', requestIds),
      loadRows(db, 'request_knives', requestIds),
      loadRows(db, 'request_components', requestIds),
      loadRows(db, 'request_paint', requestIds),
      loadRows(db, 'request_mesh', requestIds),
      loadRows(db, 'request_chain_cord', requestIds),
    ])

    const makeItem = (table: string, category: MaterialCategory, row: RequestItemRow, name: unknown, supplierId: string | null = null): HistoryInputItem | null => {
      const request = requestMap.get(row.request_id)
      const machine = request?.machines
      if (!request || !machine || machine.is_archived) return null
      const requested = requestedQuantity(table, row)
      const reserved = reservedQuantity(table, row)

      return {
        table,
        category,
        id: row.id,
        request_id: row.request_id,
        item_name: itemName(row, name),
        requested_quantity: requested,
        reserved_quantity: reserved,
        secondary_requested_quantity: secondaryRequestedQuantity(table, row),
        secondary_reserved_quantity: secondaryReservedQuantity(table, row),
        to_order: Math.max(requested - reserved, 0),
        unit: primaryUnit(table, row),
        supplier_id: supplierId,
        material_id: row.material_id || null,
        material_variant_id: row.material_variant_id || null,
        custom_delivery_date: row.custom_delivery_date || null,
        order_status: (row.order_status || 'pending') as OrderItemStatus,
        delivered_at: row.delivered_at || null,
        calculated_weight_kg: Number(row.calculated_weight_kg || 0) || null,
        selected_piece_length_mm: selectedPieceLength(table, row),
        raw: row,
        machine_id: machine.id || request.machine_id,
        machine_name: machine.name || 'Машина',
        planned_material_date: machine.planned_material_date || null,
      }
    }

    const rawItems = [
      ...sheet.map((row) => makeItem('request_sheet_metal', 'sheet_metal', row, row.material_name, supplierForRow(row))),
      // @deprecated — round_tube excluded from new UI
      ...round.map((row) => makeItem('request_round_tube', 'round_tube', row, row.material_name, supplierForRow(row))),
      ...circles.map((row) => makeItem('request_circle', 'circle', row, row.steel_grade, supplierForRow(row))),
      ...pipes.map((row) => makeItem('request_pipe', 'pipe', row, row.size, supplierForRow(row))),
      ...knives.map((row) => makeItem('request_knives', 'knives', row, row.knife_type, supplierForRow(row))),
      ...components.map((row) => makeItem('request_components', 'components', row, row.component_name, supplierForRow(row))),
      ...paint.map((row) => makeItem('request_paint', 'paint', row, row.paint_type || row.ral_code, supplierForRow(row))),
      ...meshItems.map((row) => makeItem('request_mesh', 'mesh', row, row.description, supplierForRow(row))),
      ...chainCords.map((row) => makeItem('request_chain_cord', 'chain_cord', row, row.parameters, supplierForRow(row))),
    ].filter((item): item is HistoryInputItem => Boolean(item))

    const materialIds = Array.from(new Set(rawItems.map((item) => item.material_id).filter(Boolean))) as string[]
    const [materialsRes, schedulesRes] = await Promise.all([
      materialIds.length
        ? db.from('materials').select('id, default_supplier_id').in('id', materialIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
      rawItems.length
        ? db.from('supply_order_delivery_schedules').select('id, request_item_table, request_item_id, delivery_date, quantity, unit, supplier_id, change_reason, status, received_quantity, allocated_quantity, allocated_physical_quantity, received_piece_length_mm, received_piece_count, allocated_piece_count, excess_quantity, receipt_parent_schedule_id, delivered_at, received_by, created_at, updated_at').in('request_item_id', rawItems.map((item) => item.id)).order('delivery_date', { ascending: false })
        : Promise.resolve({ data: [], error: null } as DbResult),
    ])
    if (materialsRes.error) throw new Error(materialsRes.error.message || 'Не удалось загрузить материалы')
    if (schedulesRes.error) throw new Error(schedulesRes.error.message || 'Не удалось загрузить график поставок')

    const materialSupplierMap = new Map(((materialsRes.data || []) as { id: string; default_supplier_id: string | null }[]).map((item) => [item.id, item.default_supplier_id]))
    const items = rawItems.map((item) => ({
      ...item,
      supplier_id: item.supplier_id || (item.material_id ? materialSupplierMap.get(item.material_id) || null : null),
    }))
    const scheduleRows = ((schedulesRes.data || []) as Array<SupplyOrderDeliverySchedule & { request_item_table: string; request_item_id: string }>)
      .filter((row) => rawItems.some((item) => item.table === row.request_item_table && item.id === row.request_item_id))
    const schedulesByItem = new Map<string, typeof scheduleRows>()
    for (const schedule of scheduleRows) {
      const key = `${schedule.request_item_table}:${schedule.request_item_id}`
      schedulesByItem.set(key, [...(schedulesByItem.get(key) || []), schedule])
    }

    const supplierIds = Array.from(new Set([
      ...items.map((item) => item.supplier_id).filter(Boolean),
      ...scheduleRows.map((schedule) => schedule.supplier_id).filter(Boolean),
    ])) as string[]
    const [deliveryDays, suppliersRes] = await Promise.all([
      getDeliveryDays(db, supplierIds),
      supplierIds.length
        ? db.from('suppliers').select('id, name, delivery_lead_days').in('id', supplierIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
    ])
    if (suppliersRes.error) throw new Error(suppliersRes.error.message || 'Не удалось загрузить поставщиков')
    const suppliers = (suppliersRes.data || []) as { id: string; name: string; delivery_lead_days: number }[]
    const supplierMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]))
    const leadMap = new Map(suppliers.map((supplier) => [supplier.id, supplier.delivery_lead_days || 0]))

    const history: SupplyOrderHistoryItem[] = []
    for (const item of items) {
      const schedules = schedulesByItem.get(`${item.table}:${item.id}`) || []
      const allDeliveredSchedules = schedules.filter((schedule) => schedule.status === 'delivered')
      const deliveredSchedules = schedules.filter((schedule) => (
        !schedule.receipt_parent_schedule_id
        && Number(schedule.received_quantity || 0) > 0
        && (schedule.status === 'delivered' || schedule.status === 'cancelled')
      ))

      for (const schedule of deliveredSchedules) {
        const supplierId = schedule.supplier_id || item.supplier_id
        history.push({
          id: `schedule:${schedule.id}`,
          source: 'schedule',
          table: item.table,
          item_id: item.id,
          schedule_id: schedule.id,
          machine_id: item.machine_id,
          machine_name: item.machine_name,
          request_id: item.request_id,
          category: item.category,
          item_name: item.item_name,
          characteristics: getAggregateCharacteristics(item.table, item.raw, item),
          supplier_name: supplierId ? supplierMap.get(supplierId) || 'Поставщик' : null,
          planned_material_date: item.planned_material_date,
          planned_delivery_date: schedule.delivery_date,
          accepted_at: schedule.delivered_at,
          quantity: Number(schedule.received_quantity ?? schedule.quantity ?? 0),
          unit: schedule.unit || item.unit,
          weight_kg: item.calculated_weight_kg,
        })
      }

      if (allDeliveredSchedules.length === 0 && item.order_status === 'delivered') {
        const target = item.planned_material_date
          ? getTargetDeliveryDate(
            new Date(item.planned_material_date),
            item.supplier_id ? (deliveryDays.get(item.supplier_id) || []) : [],
            item.supplier_id ? (leadMap.get(item.supplier_id) || 0) : 0,
            item.custom_delivery_date,
          )
          : null
        history.push({
          id: `item:${item.table}:${item.id}`,
          source: 'item',
          table: item.table,
          item_id: item.id,
          schedule_id: null,
          machine_id: item.machine_id,
          machine_name: item.machine_name,
          request_id: item.request_id,
          category: item.category,
          item_name: item.item_name,
          characteristics: getAggregateCharacteristics(item.table, item.raw, item),
          supplier_name: item.supplier_id ? supplierMap.get(item.supplier_id) || 'Поставщик' : null,
          planned_material_date: item.planned_material_date,
          planned_delivery_date: item.custom_delivery_date || isoDate(target),
          accepted_at: item.delivered_at,
          quantity: item.to_order,
          unit: item.unit,
          weight_kg: item.calculated_weight_kg,
        })
      }
    }

    history.sort((a, b) => {
      const accepted = dateValue(b.accepted_at) - dateValue(a.accepted_at)
      if (accepted !== 0) return accepted
      const planned = dateValue(b.planned_delivery_date) - dateValue(a.planned_delivery_date)
      if (planned !== 0) return planned
      return a.machine_name.localeCompare(b.machine_name, 'ru')
    })

    const pageItems = history.slice(from, to)
    return {
      data: pageItems,
      error: null,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total: history.length,
        from,
        to: Math.min(to, history.length),
      },
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить историю поставок', pagination: null }
  }
}

async function loadAggregateRequests(db: LooseDb, factoryId?: string | null) {
  const batchSize = 1000
  const requests: RequestRow[] = []

  for (let from = 0; ; from += batchSize) {
    let query = db
      .from('technologist_requests')
      .select('id, machine_id, status, submitted_at, machines!inner(id, name, factory_id, planned_material_date, is_archived)')
      .in('status', ['submitted_to_supply', 'completed'])
      .eq('machines.is_archived', false)
      .order('submitted_at', { ascending: false })
      .range(from, from + batchSize - 1)
    if (factoryId) query = query.eq('machines.factory_id', factoryId)

    const { data, error } = await query

    if (error) throw new Error(error.message || 'Не удалось загрузить заявки')

    const rows = (data || []) as RequestRow[]
    requests.push(...rows)
    if (rows.length < batchSize) break
  }

  return requests
}

async function loadAggregateInputItems(db: LooseDb, factoryId?: string | null): Promise<SupplyOrderAggregateInputItem[]> {
  const requests = await loadAggregateRequests(db, factoryId)
  const requestIds = requests.map((request) => request.id)
  const requestMap = new Map(requests.map((request) => [request.id, request]))
  if (requestIds.length === 0) return []

  const [sheet, round, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
    loadRows(db, 'request_sheet_metal', requestIds),
    // @deprecated — round_tube excluded from new UI
    loadRows(db, 'request_round_tube', requestIds),
    loadRows(db, 'request_circle', requestIds),
    loadRows(db, 'request_pipe', requestIds),
    loadRows(db, 'request_knives', requestIds),
    loadRows(db, 'request_components', requestIds),
    loadRows(db, 'request_paint', requestIds),
    loadRows(db, 'request_mesh', requestIds),
    loadRows(db, 'request_chain_cord', requestIds),
  ])

  const makeItem = (
    table: string,
    category: MaterialCategory,
    row: RequestItemRow,
    name: unknown,
    supplierId: string | null = null
  ): SupplyOrderAggregateInputItem | null => {
    const request = requestMap.get(row.request_id)
    const machine = request?.machines
    if (!request || !machine || machine.is_archived) return null

    const orderStatus = (row.order_status || 'pending') as OrderItemStatus
    if (!AGGREGATE_ORDER_STATUSES.has(orderStatus)) return null

    const requested = requestedQuantity(table, row)
    const reserved = reservedQuantity(table, row)
    const toOrder = Math.max(requested - reserved, 0)
    if (toOrder <= 0) return null

    return {
      table,
      category,
      id: row.id,
      request_id: row.request_id,
      item_name: itemName(row, name),
      requested_quantity: requested,
      reserved_quantity: reserved,
      secondary_requested_quantity: secondaryRequestedQuantity(table, row),
      secondary_reserved_quantity: secondaryReservedQuantity(table, row),
      to_order: toOrder,
      unit: primaryUnit(table, row),
      supplier_id: supplierId,
      material_id: row.material_id || null,
      material_variant_id: row.material_variant_id || null,
      custom_delivery_date: row.custom_delivery_date || null,
      order_status: orderStatus,
      delivered_at: row.delivered_at || null,
      calculated_weight_kg: Number(row.calculated_weight_kg || 0) || null,
      selected_piece_length_mm: selectedPieceLength(table, row),
      raw: row,
      machine_id: machine.id || request.machine_id,
      machine_name: machine.name || 'Машина',
      factory_id: machine.factory_id || null,
      planned_material_date: machine.planned_material_date || null,
    }
  }

  const rawItems = [
    ...sheet.map((row) => makeItem('request_sheet_metal', 'sheet_metal', row, row.material_name, supplierForRow(row))),
    // @deprecated — round_tube excluded from new UI
    ...round.map((row) => makeItem('request_round_tube', 'round_tube', row, row.material_name, supplierForRow(row))),
    ...circles.map((row) => makeItem('request_circle', 'circle', row, row.steel_grade, supplierForRow(row))),
    ...pipes.map((row) => makeItem('request_pipe', 'pipe', row, row.size, supplierForRow(row))),
    ...knives.map((row) => makeItem('request_knives', 'knives', row, row.knife_type, supplierForRow(row))),
    ...components.map((row) => makeItem('request_components', 'components', row, row.component_name, supplierForRow(row))),
    ...paint.map((row) => makeItem('request_paint', 'paint', row, row.paint_type || row.ral_code, supplierForRow(row))),
    ...meshItems.map((row) => makeItem('request_mesh', 'mesh', row, row.description, supplierForRow(row))),
    ...chainCords.map((row) => makeItem('request_chain_cord', 'chain_cord', row, row.parameters, supplierForRow(row))),
  ].filter((item): item is SupplyOrderAggregateInputItem => Boolean(item))

  const materialIds = Array.from(new Set(rawItems.map((item) => item.material_id).filter(Boolean))) as string[]
  const materialsRes = materialIds.length
    ? await db.from('materials').select('id, default_supplier_id').in('id', materialIds)
    : { data: [], error: null }
  if (materialsRes.error) throw new Error(materialsRes.error.message || 'Не удалось загрузить материалы')
  const materialSupplierMap = new Map(((materialsRes.data || []) as { id: string; default_supplier_id: string | null }[]).map((item) => [item.id, item.default_supplier_id]))

  return rawItems.map((item) => ({
    ...item,
    supplier_id: item.supplier_id || (item.material_id ? materialSupplierMap.get(item.material_id) || null : null),
  }))
}

async function loadFactoryNameMap(db: LooseDb, factoryIds: string[]) {
  if (factoryIds.length === 0) return new Map<string, string>()

  const { data, error } = await db
    .from('factories')
    .select('id, name')
    .in('id', factoryIds)

  if (error) throw new Error(error.message || 'Не удалось загрузить заводы')

  return new Map(((data || []) as { id: string; name: string }[]).map((factory) => [factory.id, factory.name]))
}

function addNullableWeight(current: number | null, value: number | null) {
  if (!value || !Number.isFinite(value)) return current
  return (current || 0) + value
}

export async function getSupplyOrderFactories(): Promise<{
  data: MaterialReceivingFactory[] | null
  error: string | null
}> {
  try {
    const { db } = await requireAccess()
    const { data, error } = await db
      .from('factories')
      .select('id, name')
      .order('name', { ascending: true })
    if (error) throw new Error(error.message || 'Не удалось загрузить заводы')
    return { data: (data || []) as MaterialReceivingFactory[], error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заводы' }
  }
}

function schedulePlannedQuantity(schedule: SupplyOrderDeliverySchedule) {
  return Number(schedule.quantity || 0)
}

function scheduleDeliveredQuantity(schedule: SupplyOrderDeliverySchedule) {
  return Number(schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity ?? 0)
}

function toScheduleDto(
  schedule: ReceivingScheduleRow,
  supplierNameMap: Map<string, string>,
): SupplyOrderDeliverySchedule {
  return {
    id: schedule.id,
    delivery_date: schedule.delivery_date,
    quantity: Number(schedule.quantity || 0),
    unit: schedule.unit,
    supplier_id: schedule.supplier_id,
    supplier_name: schedule.supplier_id ? supplierNameMap.get(schedule.supplier_id) || 'Поставщик' : null,
    change_reason: schedule.change_reason,
    status: schedule.status || 'planned',
    received_quantity: schedule.received_quantity === null || schedule.received_quantity === undefined ? null : Number(schedule.received_quantity),
    allocated_quantity: schedule.allocated_quantity === null || schedule.allocated_quantity === undefined ? null : Number(schedule.allocated_quantity),
    allocated_physical_quantity: schedule.allocated_physical_quantity === null || schedule.allocated_physical_quantity === undefined ? null : Number(schedule.allocated_physical_quantity),
    received_piece_length_mm: schedule.received_piece_length_mm === null || schedule.received_piece_length_mm === undefined ? null : Number(schedule.received_piece_length_mm),
    received_piece_count: schedule.received_piece_count === null || schedule.received_piece_count === undefined ? null : Number(schedule.received_piece_count),
    allocated_piece_count: schedule.allocated_piece_count === null || schedule.allocated_piece_count === undefined ? null : Number(schedule.allocated_piece_count),
    excess_quantity: schedule.excess_quantity === null || schedule.excess_quantity === undefined ? null : Number(schedule.excess_quantity),
    receipt_parent_schedule_id: schedule.receipt_parent_schedule_id || null,
    delivered_at: schedule.delivered_at,
    received_by: schedule.received_by,
    created_at: schedule.created_at,
    updated_at: schedule.updated_at,
  }
}

function addSupplierSummary(
  map: Map<string, SupplyOrderAggregateSupplier>,
  item: SupplyOrderAggregateInputItem,
  supplierNameMap: Map<string, string>,
) {
  const key = item.supplier_id || 'none'
  const current = map.get(key) || {
    id: item.supplier_id,
    name: item.supplier_id ? supplierNameMap.get(item.supplier_id) || 'Поставщик' : 'Без поставщика',
    item_count: 0,
    pending_count: 0,
    ordered_count: 0,
    delivered_count: 0,
  }
  current.item_count += 1
  current.pending_count += item.order_status === 'pending' ? 1 : 0
  current.ordered_count += item.order_status === 'ordered' ? 1 : 0
  current.delivered_count += item.order_status === 'delivered' ? 1 : 0
  map.set(key, current)
}

export async function getSupplyOrderAggregates(factoryId?: string | null) {
  try {
    const { db } = await requireAccess()
    const items = await loadAggregateInputItems(db, factoryId)
    const schedules = await loadReceivingSchedules(db, items)
    const schedulesByItem = new Map<string, ReceivingScheduleRow[]>()

    for (const schedule of schedules) {
      const key = `${schedule.request_item_table}:${schedule.request_item_id}`
      schedulesByItem.set(key, [...(schedulesByItem.get(key) || []), schedule])
    }

    const factoryIds = Array.from(new Set(items.map((item) => item.factory_id).filter(Boolean))) as string[]
    const [supplierNameMap, factoryNameMap] = await Promise.all([
      loadSupplierNameMap(db, [
        ...items.map((item) => item.supplier_id).filter(Boolean),
        ...schedules.map((schedule) => schedule.supplier_id).filter(Boolean),
      ] as string[]),
      loadFactoryNameMap(db, factoryIds),
    ])

    type MutableFactory = {
      factory_id: string | null
      factory_name: string
      quantity: number
      requested_quantity: number
      reserved_quantity: number
      weight_kg: number | null
      item_count: number
      pending_count: number
      ordered_count: number
      delivered_count: number
      planned_schedule_quantity: number
      delivered_schedule_quantity: number
      unscheduled_quantity: number
      delivery_schedule_count: number
      production_date: string | null
      machineIds: Set<string>
      supplyDates: Set<string>
      deliveryScheduleDates: Set<string>
      suppliers: Map<string, SupplyOrderAggregateSupplier>
      items: SupplyOrderAggregateSourceItem[]
    }

    type MutableAggregate = {
      id: string
      planned_material_date: string | null
      category: MaterialCategory
      item_name: string
      unit: string
      material_id: string | null
      material_variant_id: string | null
      characteristics: SupplyOrderAggregateCharacteristic[]
      quantity: number
      requested_quantity: number
      reserved_quantity: number
      weight_kg: number | null
      item_count: number
      pending_count: number
      ordered_count: number
      delivered_count: number
      planned_schedule_quantity: number
      delivered_schedule_quantity: number
      unscheduled_quantity: number
      machineIds: Set<string>
      factories: Map<string, MutableFactory>
    }

    const aggregates = new Map<string, MutableAggregate>()

    for (const item of items) {
      const materialKey = getAggregateIdentityKey(item.table, item.raw, item)
      const dateKey = plannedDateKey(item.planned_material_date)
      const aggregateKey = `${factoryKey(item.factory_id)}|${dateKey}|${materialKey}`
      const itemSchedules = (schedulesByItem.get(`${item.table}:${item.id}`) || [])
        .map((schedule) => toScheduleDto(schedule, supplierNameMap))
      const plannedScheduleQuantity = itemSchedules
        .filter((schedule) => schedule.status === 'planned')
        .reduce((sum, schedule) => sum + schedulePlannedQuantity(schedule), 0)
      const deliveredScheduleQuantity = itemSchedules
        .filter((schedule) => schedule.status === 'delivered')
        .reduce((sum, schedule) => sum + scheduleDeliveredQuantity(schedule), 0)
      const unscheduledQuantity = Math.max(item.to_order - plannedScheduleQuantity - deliveredScheduleQuantity, 0)
      const supplyDeliveryDates = itemSchedules.length > 0
        ? itemSchedules.map((schedule) => schedule.delivery_date)
        : [effectiveSupplyDeliveryDate(item, item.planned_material_date)]
      const existing = aggregates.get(aggregateKey)
      const aggregate = existing || {
        id: aggregateKey,
        planned_material_date: item.planned_material_date,
        category: item.category,
        item_name: item.item_name,
        unit: item.unit,
        material_id: item.material_id,
        material_variant_id: item.material_variant_id,
        characteristics: getAggregateCharacteristics(item.table, item.raw, item),
        quantity: 0,
        requested_quantity: 0,
        reserved_quantity: 0,
        weight_kg: null,
        item_count: 0,
        pending_count: 0,
        ordered_count: 0,
        delivered_count: 0,
        planned_schedule_quantity: 0,
        delivered_schedule_quantity: 0,
        unscheduled_quantity: 0,
        machineIds: new Set<string>(),
        factories: new Map<string, MutableFactory>(),
      }

      aggregate.quantity += item.to_order
      aggregate.requested_quantity += item.requested_quantity
      aggregate.reserved_quantity += item.reserved_quantity
      aggregate.weight_kg = addNullableWeight(aggregate.weight_kg, item.calculated_weight_kg)
      aggregate.item_count += 1
      aggregate.pending_count += item.order_status === 'pending' ? 1 : 0
      aggregate.ordered_count += item.order_status === 'ordered' ? 1 : 0
      aggregate.delivered_count += item.order_status === 'delivered' ? 1 : 0
      aggregate.planned_schedule_quantity += plannedScheduleQuantity
      aggregate.delivered_schedule_quantity += deliveredScheduleQuantity
      aggregate.unscheduled_quantity += unscheduledQuantity
      aggregate.machineIds.add(item.machine_id)

      const currentFactoryKey = factoryKey(item.factory_id)
      const existingFactory = aggregate.factories.get(currentFactoryKey)
      const factory = existingFactory || {
        factory_id: item.factory_id,
        factory_name: item.factory_id ? factoryNameMap.get(item.factory_id) || 'Завод' : 'Без завода',
        quantity: 0,
        requested_quantity: 0,
        reserved_quantity: 0,
        weight_kg: null,
        item_count: 0,
        pending_count: 0,
        ordered_count: 0,
        delivered_count: 0,
        planned_schedule_quantity: 0,
        delivered_schedule_quantity: 0,
        unscheduled_quantity: 0,
        delivery_schedule_count: 0,
        production_date: item.planned_material_date,
        machineIds: new Set<string>(),
        supplyDates: new Set<string>(),
        deliveryScheduleDates: new Set<string>(),
        suppliers: new Map<string, SupplyOrderAggregateSupplier>(),
        items: [],
      }

      factory.quantity += item.to_order
      factory.requested_quantity += item.requested_quantity
      factory.reserved_quantity += item.reserved_quantity
      factory.weight_kg = addNullableWeight(factory.weight_kg, item.calculated_weight_kg)
      factory.item_count += 1
      factory.pending_count += item.order_status === 'pending' ? 1 : 0
      factory.ordered_count += item.order_status === 'ordered' ? 1 : 0
      factory.delivered_count += item.order_status === 'delivered' ? 1 : 0
      factory.planned_schedule_quantity += plannedScheduleQuantity
      factory.delivered_schedule_quantity += deliveredScheduleQuantity
      factory.unscheduled_quantity += unscheduledQuantity
      factory.machineIds.add(item.machine_id)
      addSupplierSummary(factory.suppliers, item, supplierNameMap)
      for (const supplyDeliveryDate of supplyDeliveryDates) {
        factory.supplyDates.add(supplyDeliveryDate || 'no_supply_date')
      }
      for (const schedule of itemSchedules) {
        factory.deliveryScheduleDates.add(schedule.delivery_date)
      }
      factory.items.push({
        table: item.table,
        id: item.id,
        request_id: item.request_id,
        machine_id: item.machine_id,
        machine_name: item.machine_name,
        quantity: item.to_order,
        unit: item.unit,
        supplier_id: item.supplier_id,
        supplier_name: item.supplier_id ? supplierNameMap.get(item.supplier_id) || 'Поставщик' : null,
        weight_kg: item.calculated_weight_kg,
        order_status: item.order_status as Extract<OrderItemStatus, 'pending' | 'ordered' | 'delivered'>,
        supply_delivery_date: supplyDeliveryDates[0] || null,
        planned_schedule_quantity: plannedScheduleQuantity,
        delivered_schedule_quantity: deliveredScheduleQuantity,
        unscheduled_quantity: unscheduledQuantity,
        delivery_schedules: itemSchedules,
      })

      aggregate.factories.set(currentFactoryKey, factory)
      aggregates.set(aggregateKey, aggregate)
    }

    const data: SupplyOrderAggregate[] = Array.from(aggregates.values())
      .map((aggregate) => ({
        id: aggregate.id,
        planned_material_date: aggregate.planned_material_date,
        category: aggregate.category,
        item_name: aggregate.item_name,
        unit: aggregate.unit,
        material_id: aggregate.material_id,
        material_variant_id: aggregate.material_variant_id,
        characteristics: aggregate.characteristics,
        quantity: aggregate.quantity,
        requested_quantity: aggregate.requested_quantity,
        reserved_quantity: aggregate.reserved_quantity,
        weight_kg: aggregate.weight_kg,
        item_count: aggregate.item_count,
        machine_count: aggregate.machineIds.size,
        pending_count: aggregate.pending_count,
        ordered_count: aggregate.ordered_count,
        delivered_count: aggregate.delivered_count,
        planned_schedule_quantity: aggregate.planned_schedule_quantity,
        delivered_schedule_quantity: aggregate.delivered_schedule_quantity,
        unscheduled_quantity: Math.max(
          aggregate.quantity - aggregate.planned_schedule_quantity - aggregate.delivered_schedule_quantity,
          0,
        ),
        factories: Array.from(aggregate.factories.values())
          .map((factory) => {
            const supplyDates = Array.from(factory.supplyDates)
            const hasMixedDates = supplyDates.length > 1
            const [singleDate] = supplyDates
            return {
              factory_id: factory.factory_id,
              factory_name: factory.factory_name,
              quantity: factory.quantity,
              requested_quantity: factory.requested_quantity,
              reserved_quantity: factory.reserved_quantity,
              weight_kg: factory.weight_kg,
              item_count: factory.item_count,
              machine_count: factory.machineIds.size,
              pending_count: factory.pending_count,
              ordered_count: factory.ordered_count,
              delivered_count: factory.delivered_count,
              planned_schedule_quantity: factory.planned_schedule_quantity,
              delivered_schedule_quantity: factory.delivered_schedule_quantity,
              unscheduled_quantity: Math.max(
                factory.quantity - factory.planned_schedule_quantity - factory.delivered_schedule_quantity,
                0,
              ),
              delivery_schedule_count: factory.deliveryScheduleDates.size,
              has_delivery_schedules: factory.deliveryScheduleDates.size > 0,
              production_date: factory.production_date,
              supply_delivery_date: hasMixedDates || singleDate === 'no_supply_date' ? null : singleDate,
              has_mixed_supply_delivery_dates: hasMixedDates,
              suppliers: Array.from(factory.suppliers.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
              items: factory.items.sort((a, b) => a.machine_name.localeCompare(b.machine_name, 'ru')),
            }
          })
          .sort((a, b) => a.factory_name.localeCompare(b.factory_name, 'ru')),
      }))
      .sort((a, b) => {
        if (!a.planned_material_date && b.planned_material_date) return 1
        if (a.planned_material_date && !b.planned_material_date) return -1
        const byDate = (a.planned_material_date || '').localeCompare(b.planned_material_date || '')
        if (byDate !== 0) return byDate
        return a.item_name.localeCompare(b.item_name, 'ru')
      })

    return { data, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить агрегаты заказов' }
  }
}

type ReceivingScheduleRow = SupplyOrderDeliverySchedule & {
  request_item_table: string
  request_item_id: string
}

function itemKey(item: Pick<RawOrderItem, 'table' | 'id'>) {
  return `${item.table}:${item.id}`
}

async function loadSupplierNameMap(db: LooseDb, supplierIds: string[]) {
  const uniqueIds = Array.from(new Set(supplierIds.filter(Boolean)))
  if (uniqueIds.length === 0) return new Map<string, string>()

  const { data, error } = await db
    .from('suppliers')
    .select('id, name')
    .in('id', uniqueIds)

  if (error) throw new Error(error.message || 'Не удалось загрузить поставщиков')

  return new Map(((data || []) as { id: string; name: string }[]).map((supplier) => [supplier.id, supplier.name]))
}

async function loadReceivingSchedules(db: LooseDb, items: Array<Pick<RawOrderItem, 'table' | 'id'>>) {
  const itemIds = Array.from(new Set(items.map((item) => item.id)))
  if (itemIds.length === 0) return []

  const { data, error } = await db
    .from('supply_order_delivery_schedules')
    .select('id, request_item_table, request_item_id, delivery_date, quantity, unit, supplier_id, change_reason, status, received_quantity, allocated_quantity, allocated_physical_quantity, received_piece_length_mm, received_piece_count, allocated_piece_count, excess_quantity, receipt_parent_schedule_id, delivered_at, received_by, created_at, updated_at')
    .in('request_item_id', itemIds)
    .neq('status', 'cancelled')
    .order('delivery_date', { ascending: true })

  if (error) throw new Error(error.message || 'Не удалось загрузить график поставок')

  const validKeys = new Set(items.map(itemKey))
  return ((data || []) as ReceivingScheduleRow[])
    .filter((schedule) => validKeys.has(`${schedule.request_item_table}:${schedule.request_item_id}`))
}

function makeReceivingItem(
  item: SupplyOrderAggregateInputItem,
  factoryName: string,
  supplierNameMap: Map<string, string>,
  schedule: ReceivingScheduleRow | null,
  deliveryDate: string,
  plannedQuantity: number,
): MaterialReceivingItem {
  const supplierId = schedule?.supplier_id || item.supplier_id
  return {
    key: schedule?.id || `${item.table}:${item.id}:${deliveryDate}`,
    schedule_id: schedule?.id || null,
    table: item.table,
    id: item.id,
    request_id: item.request_id,
    machine_id: item.machine_id,
    machine_name: item.machine_name,
    factory_id: item.factory_id,
    factory_name: factoryName,
    delivery_date: deliveryDate,
    planned_quantity: plannedQuantity,
    unit: schedule?.unit || item.unit,
    supplier_id: supplierId || null,
    supplier_name: supplierId ? supplierNameMap.get(supplierId) || 'Поставщик' : null,
    category: item.category,
    item_name: item.item_name,
    material_id: item.material_id,
    material_variant_id: item.material_variant_id,
    characteristics: getAggregateCharacteristics(item.table, item.raw, item),
    weight_kg: proportionalWeight(item.calculated_weight_kg, item.to_order, plannedQuantity),
    is_virtual_schedule: !schedule,
    piece_length_mm: schedule?.received_piece_length_mm ?? null,
    piece_count: schedule?.received_piece_count ?? null,
  }
}

export async function getMaterialReceivingPageData(factoryFilter?: string | null): Promise<{
  data: MaterialReceivingPageData | null
  error: string | null
}> {
  try {
    const { db } = await requireReceivingAccess()
    const { data: factoriesData, error: factoriesError } = await db
      .from('factories')
      .select('id, name')
      .order('name', { ascending: true })

    if (factoriesError) throw new Error(factoriesError.message || 'Не удалось загрузить заводы')

    const factories = (factoriesData || []) as MaterialReceivingFactory[]
    const activeFactoryId = factories.some((factory) => factory.id === factoryFilter)
      ? factoryFilter || null
      : factories[0]?.id || null

    if (!activeFactoryId) {
      return { data: { factories, activeFactoryId: null, groups: [] }, error: null }
    }

    const allItems = await loadAggregateInputItems(db, activeFactoryId)
    const items = allItems.filter((item) => (
      item.order_status === 'ordered'
      && item.factory_id === activeFactoryId
    ))
    const [factoryNameMap, schedules] = await Promise.all([
      loadFactoryNameMap(db, [activeFactoryId]),
      loadReceivingSchedules(db, items),
    ])
    const schedulesByItem = new Map<string, ReceivingScheduleRow[]>()

    for (const schedule of schedules) {
      const key = `${schedule.request_item_table}:${schedule.request_item_id}`
      schedulesByItem.set(key, [...(schedulesByItem.get(key) || []), schedule])
    }

    const supplierIds = [
      ...items.map((item) => item.supplier_id).filter(Boolean),
      ...schedules.map((schedule) => schedule.supplier_id).filter(Boolean),
    ] as string[]
    const supplierNameMap = await loadSupplierNameMap(db, supplierIds)
    const receivingItems: MaterialReceivingItem[] = []

    for (const item of items) {
      const factoryName = item.factory_id ? factoryNameMap.get(item.factory_id) || 'Завод' : 'Без завода'
      const allItemSchedules = schedulesByItem.get(itemKey(item)) || []
      const itemSchedules = allItemSchedules.filter((schedule) => schedule.status !== 'delivered')

      if (itemSchedules.length > 0) {
        for (const schedule of itemSchedules) {
          receivingItems.push(makeReceivingItem(
            item,
            factoryName,
            supplierNameMap,
            schedule,
            schedule.delivery_date,
            Number(schedule.quantity || 0),
          ))
        }
        continue
      }

      const deliveryDate = effectiveSupplyDeliveryDate(item, item.planned_material_date)
      if (!deliveryDate) continue
      const outstandingQuantity = outstandingReceivingQuantity(item.to_order, allItemSchedules)
      if (outstandingQuantity <= 0) continue
      receivingItems.push(makeReceivingItem(
        item,
        factoryName,
        supplierNameMap,
        null,
        deliveryDate,
        outstandingQuantity,
      ))
    }

    const byDate = new Map<string, MaterialReceivingItem[]>()
    for (const item of receivingItems) {
      byDate.set(item.delivery_date, [...(byDate.get(item.delivery_date) || []), item])
    }

    const groups = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rows], index) => ({
        date,
        is_initially_open: index === 0,
        items: rows.sort((a, b) => {
          const byCategory = a.category.localeCompare(b.category)
          if (byCategory !== 0) return byCategory
          const byMaterial = a.item_name.localeCompare(b.item_name, 'ru')
          if (byMaterial !== 0) return byMaterial
          return a.machine_name.localeCompare(b.machine_name, 'ru')
        }),
      }))

    return { data: { factories, activeFactoryId, groups }, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить прием материала' }
  }
}

export async function receiveMaterialDelivery(input: {
  schedule_id?: string | null
  table?: string
  id?: string
  delivery_date?: string
  planned_quantity?: number
  received_quantity: number
  piece_length_mm?: number | null
  piece_count?: number | null
}) {
  try {
    const { db, userId } = await requireReceivingAccess('manage')
    const receivedQuantity = Number(input.received_quantity)
    if (!Number.isFinite(receivedQuantity) || receivedQuantity <= 0) {
      throw new Error('Введите фактическое количество прихода')
    }

    let scheduleId = input.schedule_id || null
    let createdScheduleId: string | null = null
    let affectedItems = new Map<string, string[]>()

    if (!scheduleId) {
      const table = input.table || ''
      const id = input.id || ''
      assertOrderTable(table)
      const deliveryDate = assertDateOrNull(input.delivery_date || null)
      if (!deliveryDate) throw new Error('Не указана дата поставки')

      const orderItem = await loadOneOrderItem(db, table, id)
      if (orderItem.order_status !== 'ordered') {
        throw new Error('Поставку можно принять только после отметки позиции "Заказано"')
      }
      if (!orderItem.material_id) throw new Error(`Позиция "${orderItem.item_name}" не привязана к материалу`)
      if (!orderItem.supplier_id) throw new Error(`Назначьте поставщика для позиции "${orderItem.item_name}"`)
      validateReceiptFields(orderItem)

      const plannedQuantity = Number(input.planned_quantity || orderItem.to_order)
      if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) {
        throw new Error('Плановое количество поставки должно быть больше 0')
      }
      const { data: insertedSchedule, error: insertError } = await db
        .from('supply_order_delivery_schedules')
        .insert({
          request_item_table: table,
          request_item_id: id,
          delivery_date: deliveryDate,
          quantity: plannedQuantity,
          unit: orderItem.unit,
          supplier_id: orderItem.supplier_id,
          received_piece_length_mm: input.piece_length_mm || null,
          received_piece_count: input.piece_count || null,
          created_by: userId,
          updated_by: userId,
        })
        .select('id')
        .single()

      if (insertError) throw new Error(insertError.message || 'Не удалось создать строку графика поставки')
      scheduleId = (insertedSchedule as { id?: string } | null)?.id || null
      if (!scheduleId) throw new Error('Не удалось определить созданную поставку')
      createdScheduleId = scheduleId
      affectedItems = new Map([[table, [id]]])
    } else {
      const { data: scheduleData, error: scheduleError } = await db
        .from('supply_order_delivery_schedules')
        .select('request_item_table, request_item_id')
        .eq('id', scheduleId)
        .maybeSingle()

      if (scheduleError) throw new Error(scheduleError.message || 'Не удалось загрузить поставку')
      const schedule = scheduleData as { request_item_table?: string; request_item_id?: string } | null
      if (!schedule?.request_item_table || !schedule.request_item_id) throw new Error('Поставка не найдена')
      affectedItems = new Map([[schedule.request_item_table, [schedule.request_item_id]]])
    }

    const allOpenItems = await loadAggregateInputItems(db)
    const sourceItem = allOpenItems.find((item) => item.table === Array.from(affectedItems.keys())[0]
      && affectedItems.get(item.table)?.includes(item.id))
    if (!sourceItem) throw new Error('Не удалось определить исходную позицию поставки')

    const isKnife = sourceItem.category === 'knives'
    const pieceLengthMm = input.piece_length_mm === null || input.piece_length_mm === undefined
      ? null
      : Number(input.piece_length_mm)
    const pieceCount = input.piece_count === null || input.piece_count === undefined
      ? null
      : Number(input.piece_count)
    if (isKnife && (
      !pieceLengthMm || pieceLengthMm <= 0 || !pieceCount || !Number.isInteger(pieceCount) ||
      Math.abs(receivedQuantity - pieceLengthMm * pieceCount) > 0.000001
    )) {
      throw new Error('Для ножей укажите длину бруска и целое количество брусков')
    }
    if (!isKnife && (pieceLengthMm !== null || pieceCount !== null)) {
      throw new Error('Параметры бруска допустимы только для ножей')
    }

    const sourceIdentity = getAggregateIdentityKey(sourceItem.table, sourceItem.raw, sourceItem)
    const matchingItems = allOpenItems.filter((item) => (
      item.factory_id === sourceItem.factory_id
      && item.table === sourceItem.table
      && item.material_id === sourceItem.material_id
      && item.material_variant_id === sourceItem.material_variant_id
      && getAggregateIdentityKey(item.table, item.raw, item) === sourceIdentity
      && (item.order_status === 'pending' || item.order_status === 'ordered')
    ))
    const matchingSchedules = await loadReceivingSchedules(db, matchingItems)
    const schedulesByItem = new Map<string, ReceivingScheduleRow[]>()
    for (const schedule of matchingSchedules) {
      const key = `${schedule.request_item_table}:${schedule.request_item_id}`
      schedulesByItem.set(key, [...(schedulesByItem.get(key) || []), schedule])
    }
    const sourceKey = `${sourceItem.table}:${sourceItem.id}`
    const allocation = allocateReceiptByPriority({
      receivedQuantity,
      pieceLengthMm: isKnife ? pieceLengthMm : null,
      pieceCount: isKnife ? pieceCount : null,
      candidates: matchingItems.map((item) => {
        const key = `${item.table}:${item.id}`
        const itemSchedules = schedulesByItem.get(key) || []
        const delivered = itemSchedules
          .filter((schedule) => schedule.status === 'delivered')
          .reduce((sum, schedule) => sum + scheduleDeliveredQuantity(schedule), 0)
        return {
          key,
          table: item.table,
          id: item.id,
          priorityDate: item.planned_material_date,
          outstandingQuantity: Math.max(item.to_order - delivered, 0),
          hasOtherPlannedSchedule: itemSchedules.some((schedule) => (
            schedule.status === 'planned' && schedule.id !== scheduleId
          )),
          isSource: key === sourceKey,
        }
      }),
    })
    if (allocation.allocations.length === 0) {
      throw new Error('Не найдено открытых потребностей для распределения поставки')
    }

    affectedItems = groupItemsByTable(allocation.allocations.map((row) => ({ table: row.table, id: row.id })))
    const affectedOrderItems = await loadSelectedOrderItems(db, affectedItems)
    const machineIds = await getAffectedMachineIds(db, affectedItems)
    const { error } = await db.rpc('fn_receive_supply_order_schedule_v2', {
      p_schedule_id: scheduleId,
      p_performed_by: userId,
      p_received_quantity: receivedQuantity,
      p_allocations: allocation.allocations,
      p_received_piece_length_mm: pieceLengthMm,
      p_received_piece_count: pieceCount,
    })

    if (error) {
      if (createdScheduleId) {
        try {
          await db.from('supply_order_delivery_schedules').delete().eq('id', createdScheduleId)
        } catch {
          // The original RPC error is more important for the user-facing result.
        }
      }
      throw new Error(error.message || 'Не удалось принять поставку на склад')
    }

    await syncActualMaterialDatesForMachines(machineIds)

    try {
      await dispatchPendingTelegramDeliveries({ limit: 100 })
    } catch {
      // Telegram delivery is best-effort; CRM notifications and tasks are already persisted.
    }

    revalidatePath(ROUTES.INVENTORY)
    revalidatePath(ROUTES.INVENTORY_RECEIVING)
    revalidateInventoryHistoryPaths(affectedOrderItems)
    revalidatePath(ROUTES.SUPPLY)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    revalidatePath(ROUTES.PRODUCTION)
    revalidatePath(ROUTES.GANTT)
    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.NOTIFICATIONS)
    revalidatePath(ROUTES.MEETINGS_AGENDA_POOL)
    for (const machineId of machineIds) {
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}/request`)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось принять поставку на склад' }
  }
}

export async function updateAggregateSupplyDeliveryDate(
  items: { table: string; id: string }[],
  deliveryDate: string | null
) {
  try {
    const { db } = await requireAccess('manage')
    const normalizedDate = assertDateOrNull(deliveryDate)
    const groupedItems = groupItemsByTable(items)
    if (groupedItems.size === 0) throw new Error('Нет позиций для обновления')

    await Promise.all(Array.from(groupedItems.entries()).map(async ([table, ids]) => {
      const { error } = await db
        .from(table)
        .update({ custom_delivery_date: normalizedDate })
        .in('id', ids)

      if (error) throw new Error(error.message || 'Не удалось обновить дату снабжения')
    }))

    const machineIds = await getAffectedMachineIds(db, groupedItems)
    revalidateSupplyOrderPaths(machineIds)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить дату снабжения' }
  }
}

function revalidateSupplyOrderPaths(machineIds: string[] = []) {
  revalidatePath(ROUTES.SUPPLY)
  revalidatePath(ROUTES.SUPPLY_ORDERS)
  revalidatePath(ROUTES.INVENTORY)
  revalidatePath(ROUTES.INVENTORY_RECEIVING)
  revalidatePath(ROUTES.PRODUCTION)
  revalidatePath(ROUTES.GANTT)
  revalidatePath(ROUTES.SALES_PLAN)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.NOTIFICATIONS)
  revalidatePath(ROUTES.MEETINGS_AGENDA_POOL)
  for (const machineId of machineIds) {
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}/request`)
  }
}

function revalidateInventoryHistoryPaths(items: Array<Pick<RawOrderItem, 'material_id'>>) {
  const materialIds = Array.from(new Set(items.map((item) => item.material_id).filter(Boolean))) as string[]
  for (const materialId of materialIds) {
    revalidatePath(`${ROUTES.INVENTORY}/${materialId}/history`)
  }
}

async function getScheduleAffectedItems(db: LooseDb, scheduleIds: string[]) {
  const groupedItems = new Map<string, string[]>()
  if (scheduleIds.length === 0) return groupedItems

  const { data, error } = await db
    .from('supply_order_delivery_schedules')
    .select('request_item_table, request_item_id')
    .in('id', scheduleIds)

  if (error) throw new Error(error.message || 'Не удалось определить машины графика поставки')

  for (const row of (data || []) as { request_item_table: string; request_item_id: string }[]) {
    if (!ORDER_TABLES.includes(row.request_item_table) || !row.request_item_id) continue
    groupedItems.set(row.request_item_table, [...(groupedItems.get(row.request_item_table) || []), row.request_item_id])
  }

  return groupedItems
}

async function getScheduleAffectedMachineIds(db: LooseDb, scheduleIds: string[]) {
  const groupedItems = await getScheduleAffectedItems(db, scheduleIds)
  if (groupedItems.size === 0) return []
  return getAffectedMachineIds(db, groupedItems)
}

function normalizeScheduleInputs(schedules: SupplyOrderAggregateScheduleInput[]) {
  return schedules.map((schedule) => {
    const deliveryDate = assertDateOrNull(schedule.delivery_date)
    const quantity = Number(schedule.quantity)
    const pieceLengthMm = schedule.piece_length_mm === null || schedule.piece_length_mm === undefined
      ? null
      : Number(schedule.piece_length_mm)
    const pieceCount = schedule.piece_count === null || schedule.piece_count === undefined
      ? null
      : Number(schedule.piece_count)
    if (!deliveryDate) throw new Error('Укажите дату поставки')
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Количество поставки должно быть больше 0')
    if ((pieceLengthMm === null) !== (pieceCount === null)) {
      throw new Error('Для ножей укажите длину и количество брусков')
    }
    if (pieceLengthMm !== null && (
      !Number.isFinite(pieceLengthMm) || pieceLengthMm <= 0 ||
      !Number.isInteger(pieceCount) || Number(pieceCount) <= 0 ||
      Math.abs(quantity - pieceLengthMm * Number(pieceCount)) > 0.000001
    )) {
      throw new Error('Общая длина ножей должна равняться длине бруска, умноженной на количество')
    }
    return {
      delivery_date: deliveryDate,
      quantity,
      supplier_id: schedule.supplier_id || null,
      piece_length_mm: pieceLengthMm,
      piece_count: pieceCount,
    }
  })
}

function roundScheduleQuantity(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000
}

function scheduleSupplierIdsByItem(schedules: ReceivingScheduleRow[]) {
  const map = new Map<string, Set<string>>()
  for (const schedule of schedules) {
    if (schedule.status !== 'planned' || !schedule.supplier_id) continue
    const key = `${schedule.request_item_table}:${schedule.request_item_id}`
    map.set(key, new Set([...(map.get(key) || []), schedule.supplier_id]))
  }
  return map
}

async function deletePlannedDeliverySchedules(db: RpcDb, scheduleIds: string[]) {
  for (const scheduleId of scheduleIds) {
    const { error } = await db.rpc('fn_delete_supply_order_schedule', {
      p_schedule_id: scheduleId,
    })
    if (error) throw new Error(error.message || 'Не удалось сбросить плановые даты поставки')
  }
}

function proportionalWeight(totalWeight: number | null, totalQuantity: number, quantity: number) {
  if (totalWeight === null) return null
  if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) return totalWeight
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  return (totalWeight * quantity) / totalQuantity
}

export async function saveAggregateDeliverySchedule(
  items: { table: string; id: string }[],
  schedules: SupplyOrderAggregateScheduleInput[]
) {
  try {
    const { db, userId } = await requireAccess('manage')
    const groupedItems = groupItemsByTable(items)
    if (groupedItems.size === 0) throw new Error('Нет позиций для графика поставки')

    const normalizedSchedules = normalizeScheduleInputs(schedules)
    const selectedItems = await loadSelectedOrderItems(db, groupedItems)
    if (selectedItems.length === 0) throw new Error('Позиции закупки не найдены')
    const openItems = selectedItems.filter((item) => item.order_status !== 'delivered')
    if (openItems.length === 0) throw new Error('Вся поставка уже принята и закрыта')
    for (const item of openItems) {
      if (!item.material_id) throw new Error(`Позиция "${item.item_name}" не привязана к материалу`)
      if (item.to_order <= 0) throw new Error(`Позиция "${item.item_name}" полностью закрыта складом и не требует закупки`)
    }
    const isKnifeSchedule = openItems.every((item) => item.category === 'knives')
    if (isKnifeSchedule && normalizedSchedules.some((schedule) => !schedule.piece_length_mm || !schedule.piece_count)) {
      throw new Error('Для ножей укажите длину бруска и количество брусков')
    }
    if (!isKnifeSchedule && normalizedSchedules.some((schedule) => schedule.piece_length_mm || schedule.piece_count)) {
      throw new Error('Длина и количество брусков применяются только для ножей')
    }

    const existingSchedules = await loadReceivingSchedules(db, selectedItems)
    const existingDeliveredByItem = new Map<string, number>()
    const plannedScheduleIds = existingSchedules
      .filter((schedule) => schedule.status === 'planned')
      .map((schedule) => schedule.id)

    for (const schedule of existingSchedules) {
      if (schedule.status !== 'delivered') continue
      const key = `${schedule.request_item_table}:${schedule.request_item_id}`
      existingDeliveredByItem.set(key, (existingDeliveredByItem.get(key) || 0) + Number(
        schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity ?? 0,
      ))
    }

    const remainingItems = openItems
      .map((item) => {
        const delivered = existingDeliveredByItem.get(`${item.table}:${item.id}`) || 0
        return {
          item,
          remaining: Math.max(item.to_order - delivered, 0),
        }
      })
      .filter((entry) => entry.remaining > 0)

    const totalRemaining = remainingItems.reduce((sum, entry) => sum + entry.remaining, 0)
    const totalScheduled = normalizedSchedules.reduce((sum, schedule) => sum + schedule.quantity, 0)
    if (normalizedSchedules.length === 0 || totalScheduled <= 0) throw new Error('Добавьте хотя бы одну дату поставки')
    if (totalRemaining <= 0) throw new Error('Вся потребность уже закрыта принятыми поставками')

    const insertRows: Record<string, unknown>[] = []
    const anchor = remainingItems
      .sort((left, right) => left.item.id.localeCompare(right.item.id))[0]?.item
    if (!anchor) throw new Error('Не найдена открытая позиция для графика поставки')
    const supplierIds = new Set<string>()
    for (const schedule of normalizedSchedules) {
      const resolvedSupplierId = schedule.supplier_id || anchor.supplier_id
      if (!resolvedSupplierId) throw new Error('Выберите поставщика для каждой строки графика')
      supplierIds.add(resolvedSupplierId)
      insertRows.push({
        request_item_table: anchor.table,
        request_item_id: anchor.id,
        delivery_date: schedule.delivery_date,
        quantity: roundScheduleQuantity(schedule.quantity),
        unit: anchor.unit,
        supplier_id: resolvedSupplierId,
        received_piece_length_mm: schedule.piece_length_mm,
        received_piece_count: schedule.piece_count,
        created_by: userId,
        updated_by: userId,
      })
    }

    if (insertRows.length > 0) {
      const { error } = await db.from('supply_order_delivery_schedules').insert(insertRows)
      if (error) throw new Error(error.message || 'Не удалось сохранить график поставки')
    }

    if (plannedScheduleIds.length > 0) {
      await deletePlannedDeliverySchedules(db, plannedScheduleIds)
    }

    const orderedAt = new Date().toISOString()
    await Promise.all(openItems
      .filter((item) => item.order_status === 'pending')
      .map(async (item) => {
        const values: Record<string, unknown> = {
          order_status: 'ordered',
          ordered_at: orderedAt,
        }
        if (supplierIds.size === 1) {
          values.supplier_id = Array.from(supplierIds)[0]
        }
        const { error } = await db.from(item.table).update(values).eq('id', item.id)
        if (error) throw new Error(error.message || 'Не удалось отметить позиции заказанными')
      }))

    const machineIds = await getAffectedMachineIds(db, groupedItems)
    revalidateSupplyOrderPaths(machineIds)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось сохранить график поставки' }
  }
}

export async function clearAggregateDeliverySchedule(items: { table: string; id: string }[]) {
  try {
    const { db } = await requireAccess('manage')
    const groupedItems = groupItemsByTable(items)
    if (groupedItems.size === 0) throw new Error('Нет позиций для сброса графика поставки')

    const selectedItems = await loadSelectedOrderItems(db, groupedItems)
    if (selectedItems.length === 0) throw new Error('Позиции закупки не найдены')

    const existingSchedules = await loadReceivingSchedules(db, selectedItems)
    const plannedScheduleIds = existingSchedules
      .filter((schedule) => schedule.status === 'planned')
      .map((schedule) => schedule.id)

    if (plannedScheduleIds.length > 0) {
      await deletePlannedDeliverySchedules(db, plannedScheduleIds)
    }

    const machineIds = await getAffectedMachineIds(db, groupedItems)
    revalidateSupplyOrderPaths(machineIds)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось сбросить график поставки' }
  }
}

async function createSupplyFinancePayments(
  db: RpcDb,
  userId: string,
  selectedItems: RawOrderItem[],
  payments: SupplyFinancePaymentInput[]
) {
  if (payments.length === 0) return

  const supplierIds = Array.from(new Set(payments.map((payment) => payment.supplierId).filter(Boolean)))
  const { data: suppliersData, error: suppliersError } = supplierIds.length
    ? await db.from('suppliers').select('id, name').in('id', supplierIds)
    : { data: [], error: null }
  if (suppliersError) throw new Error(suppliersError.message || 'Не удалось загрузить поставщиков')
  const supplierMap = new Map(((suppliersData || []) as { id: string; name: string }[]).map((supplier) => [supplier.id, supplier.name]))
  const selectedByKey = new Map(selectedItems.map((item) => [`${item.table}:${item.id}`, item]))
  const scheduleSuppliersByItem = scheduleSupplierIdsByItem(await loadReceivingSchedules(db, selectedItems))

  for (const payment of payments) {
    const amount = Number(payment.amount)
    if (!payment.supplierId) throw new Error('Укажите поставщика для платежа')
    if (!payment.plannedDate) throw new Error('Укажите дату оплаты')
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма платежа должна быть больше 0')
    if (!['UAH', 'EUR'].includes(payment.currency)) throw new Error('Некорректная валюта платежа')

    const paymentItems = payment.itemKeys.map((key) => selectedByKey.get(key)).filter(Boolean) as RawOrderItem[]
    if (paymentItems.length === 0) throw new Error('Не удалось определить позиции платежа')
    if (paymentItems.some((item) => (
      item.supplier_id !== payment.supplierId
      && !scheduleSuppliersByItem.get(itemKey(item))?.has(payment.supplierId)
    ))) {
      throw new Error('Позиции платежа должны относиться к одному поставщику')
    }

    const sortedKeys = payment.itemKeys.slice().sort()
    const sourceKey = `${payment.supplierId}:${payment.plannedDate}:${sortedKeys.join('|')}`
    const existing = await db
      .from('finance_expenses')
      .select('id')
      .eq('source_type', 'supply_order')
      .eq('source_key', sourceKey)
      .maybeSingle()
    if (existing.data) continue

    const { amountUah, exchangeRate } = await convertPaymentToUah(amount, payment.currency)
    const supplierName = supplierMap.get(payment.supplierId) || 'Поставщик'
    const itemSummary = paymentItems
      .map((item) => `${item.item_name} (${item.to_order} ${item.unit})`)
      .join('; ')

    const { error } = await db.from('finance_expenses').insert({
      title: `Заказ снабжения: ${supplierName}`,
      amount,
      amount_uah: amountUah,
      paid_amount: 0,
      paid_amount_uah: 0,
      category: 'Прочие расходы',
      counterparty: supplierName,
      currency: payment.currency,
      exchange_rate: exchangeRate,
      is_supply_plan: true,
      responsible_user_id: userId,
      planned_date: payment.plannedDate,
      original_planned_date: payment.plannedDate,
      status: 'planned',
      comment: itemSummary,
      source_type: 'supply_order',
      source_key: sourceKey,
      created_by: userId,
      updated_by: userId,
    })
    if (error) {
      if (error.message?.toLowerCase().includes('duplicate')) continue
      throw new Error(error.message || 'Не удалось создать платеж снабжения')
    }
  }
}

export async function markOrderStatus(
  items: { table: string; id: string }[],
  status: Extract<OrderItemStatus, 'ordered' | 'delivered'>,
  payments: SupplyFinancePaymentInput[] = [],
  placementInput?: SupplyOrderPlacementInput
) {
  try {
    const { db, userId } = await requireAccess('manage')
    const groupedItems = groupItemsByTable(items)
    if (groupedItems.size === 0) return { success: true }
    const now = new Date().toISOString()
    const placement = status === 'ordered' ? normalizeOrderPlacement(placementInput) : null
    if (placement && payments.length > 0) {
      throw new Error('Платежи создаются только для позиций с уже назначенным поставщиком')
    }
    const selectedItems = await loadSelectedOrderItems(db, groupedItems)
    if (selectedItems.length === 0) throw new Error('Выберите позиции')
    const scheduleSuppliersByItem = status === 'ordered'
      ? scheduleSupplierIdsByItem(await loadReceivingSchedules(db, selectedItems))
      : new Map<string, Set<string>>()

    for (const item of selectedItems) {
      const scheduleSupplierIds = scheduleSuppliersByItem.get(itemKey(item)) || new Set<string>()
      const singleScheduleSupplierId = scheduleSupplierIds.size === 1 ? Array.from(scheduleSupplierIds)[0] : null
      const effectiveSupplierId = item.supplier_id || singleScheduleSupplierId || placement?.supplierId || null
      if (!item.material_id) throw new Error(`Позиция "${item.item_name}" не привязана к материалу`)
      if (item.to_order <= 0) throw new Error(`Позиция "${item.item_name}" полностью закрыта складом и не требует закупки`)
      if (!effectiveSupplierId && (status !== 'ordered' || scheduleSupplierIds.size === 0)) {
        throw new Error(`Назначьте поставщика для позиции "${item.item_name}" или укажите поставщика в графике поставки`)
      }
      if (status === 'ordered' && item.order_status !== 'pending'
        && !(item.order_status === 'ordered' && (Boolean(placement) || payments.length > 0))) {
        throw new Error(`Позицию "${item.item_name}" можно отметить заказанной только из статуса "Не заказано"`)
      }
      if (status === 'delivered' && item.order_status !== 'ordered') {
        throw new Error(`Позицию "${item.item_name}" можно принять только после отметки "Заказано"`)
      }
      if (status === 'delivered') {
        validateReceiptFields(item)
        const hasSchedule = await getPlannedScheduleTotal(db, item.table, item.id) > 0
        if (hasSchedule) throw new Error(`Позиция "${item.item_name}" разделена по датам. Принимайте поставки в графике позиции.`)
      }
    }

    const machineIds = await getAffectedMachineIds(db, groupedItems)
    if (status === 'delivered') {
      const { error } = await db.rpc('fn_mark_supply_order_delivered', {
        p_items: selectedItems.map(receiptPayload),
        p_performed_by: userId,
      })
      if (error) throw new Error(error.message || 'Не удалось принять позиции на склад')
      await syncActualMaterialDatesForMachines(machineIds)
    } else {
      await Promise.all(selectedItems.map(async (item) => {
        const scheduleSupplierIds = scheduleSuppliersByItem.get(itemKey(item)) || new Set<string>()
        const values: Record<string, unknown> = { order_status: status, ordered_at: now }
        const singleScheduleSupplierId = scheduleSupplierIds.size === 1 ? Array.from(scheduleSupplierIds)[0] : null
        const nextSupplierId = item.supplier_id || singleScheduleSupplierId || placement?.supplierId || null
        if (nextSupplierId) {
          values.supplier_id = nextSupplierId
        }
        if (placement) {
          values.custom_delivery_date = placement.supplyDeliveryDate
        }
        const { error } = await db.from(item.table).update(values).eq('id', item.id)
        if (error) throw new Error(error.message || 'Не удалось обновить статус позиции')
      }))
      await createSupplyFinancePayments(db, userId, selectedItems, payments)
    }
    revalidateSupplyOrderPaths(machineIds)
    if (status === 'delivered') {
      revalidateInventoryHistoryPaths(selectedItems)
    }
    if (status === 'ordered') {
      revalidatePath(ROUTES.SUPPLY_FINANCE)
      revalidatePath(ROUTES.FINANCE_CALENDAR)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить позиции' }
  }
}

export async function markOrderPlaced(items: { table: string; id: string }[], placement?: SupplyOrderPlacementInput) {
  return markOrderStatus(items, 'ordered', [], placement)
}

export async function markOrderPlacedWithFinance(items: { table: string; id: string }[], payments: SupplyFinancePaymentInput[]) {
  return markOrderStatus(items, 'ordered', payments)
}

export async function markOrderDelivered(items: { table: string; id: string }[]) {
  return markOrderStatus(items, 'delivered')
}

export async function updateOrderSupplier(item: { table: string; id: string; material_id?: string | null }, supplierId: string | null) {
  try {
    const { db } = await requireAccess('manage')
    if (!ORDER_TABLES.includes(item.table)) throw new Error('Некорректная таблица позиции')
    const { error } = await db.from(item.table).update({ supplier_id: supplierId || null }).eq('id', item.id)
    if (error) throw new Error(error.message || 'Не удалось назначить поставщика')
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось назначить поставщика' }
  }
}

export async function updateOrderCustomDeliveryDate(item: { table: string; id: string }, date: string | null) {
  try {
    const { db } = await requireAccess('manage')
    if (!ORDER_TABLES.includes(item.table)) throw new Error('Некорректная таблица позиции')
    const { error } = await db.from(item.table).update({ custom_delivery_date: date || null }).eq('id', item.id)
    if (error) throw new Error(error.message || 'Не удалось обновить дату доставки')
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить дату доставки' }
  }
}

export async function addOrderDeliverySchedule(
  item: { table: string; id: string },
  data: { delivery_date: string; quantity: number; supplier_id?: string | null }
) {
  try {
    const { db, userId } = await requireAccess('manage')
    assertOrderTable(item.table)
    validateScheduleInput(data)
    const orderItem = await loadOneOrderItem(db, item.table, item.id)
    if (orderItem.order_status === 'delivered') throw new Error('Нельзя менять график уже доставленной позиции')
    const { error } = await db.from('supply_order_delivery_schedules').insert({
      request_item_table: item.table,
      request_item_id: item.id,
      delivery_date: data.delivery_date,
      quantity: Number(data.quantity),
      unit: orderItem.unit,
      supplier_id: data.supplier_id || orderItem.supplier_id || null,
      created_by: userId,
      updated_by: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось добавить дату поставки')
    const machineIds = await getAffectedMachineIds(db, groupItemsByTable([item]))
    revalidateSupplyOrderPaths(machineIds)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось добавить дату поставки' }
  }
}

export async function updateOrderDeliverySchedule(
  scheduleId: string,
  data: { delivery_date: string; quantity: number; supplier_id?: string | null; change_reason?: string | null }
) {
  try {
    const { db, userId } = await requireAccess('manage')
    const machineIds = await getScheduleAffectedMachineIds(db, [scheduleId])
    validateScheduleInput(data)
    const reason = (data.change_reason || '').trim()
    const { error } = await db.rpc('fn_update_supply_order_schedule', {
      p_schedule_id: scheduleId,
      p_delivery_date: data.delivery_date,
      p_quantity: Number(data.quantity),
      p_supplier_id: data.supplier_id || null,
      p_reason: reason || null,
      p_changed_by: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось обновить дату поставки')
    revalidateSupplyOrderPaths(machineIds)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить дату поставки' }
  }
}

export async function receiveOrderDeliverySchedule(scheduleId: string, receivedQuantity?: number) {
  try {
    const { db, userId } = await requireAccess('manage')
    const affectedItems = await getScheduleAffectedItems(db, [scheduleId])
    const machineIds = await getAffectedMachineIds(db, affectedItems)
    const affectedOrderItems = await loadSelectedOrderItems(db, affectedItems)
    let actualQuantity = Number(receivedQuantity || 0)
    if (!Number.isFinite(actualQuantity) || actualQuantity <= 0) {
      const { data: scheduleData, error: scheduleError } = await db
        .from('supply_order_delivery_schedules')
        .select('quantity')
        .eq('id', scheduleId)
        .maybeSingle()
      if (scheduleError) throw new Error(scheduleError.message || 'Не удалось загрузить поставку')
      actualQuantity = Number((scheduleData as { quantity?: number } | null)?.quantity || 0)
    }
    if (!Number.isFinite(actualQuantity) || actualQuantity <= 0) throw new Error('Введите фактическое количество прихода')

    const { error } = await db.rpc('fn_receive_supply_order_schedule', {
      p_schedule_id: scheduleId,
      p_performed_by: userId,
      p_received_quantity: actualQuantity,
    })
    if (error) throw new Error(error.message || 'Не удалось принять поставку на склад')
    await syncActualMaterialDatesForMachines(machineIds)
    try {
      await dispatchPendingTelegramDeliveries({ limit: 100 })
    } catch {
      // Telegram delivery is best-effort; CRM notifications and tasks are already persisted.
    }
    revalidateSupplyOrderPaths(machineIds)
    revalidateInventoryHistoryPaths(affectedOrderItems)
    revalidatePath(ROUTES.TASKS)
    revalidatePath(ROUTES.NOTIFICATIONS)
    revalidatePath(ROUTES.MEETINGS_AGENDA_POOL)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось принять поставку на склад' }
  }
}

export async function deleteOrderDeliverySchedule(scheduleId: string) {
  try {
    const { db } = await requireAccess('manage')
    const machineIds = await getScheduleAffectedMachineIds(db, [scheduleId])
    const { error } = await db.rpc('fn_delete_supply_order_schedule', {
      p_schedule_id: scheduleId,
    })
    if (error) throw new Error(error.message || 'Не удалось удалить дату поставки')
    revalidateSupplyOrderPaths(machineIds)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось удалить дату поставки' }
  }
}

export async function getOrdersSummary() {
  const { data, error } = await getSupplyOrders(0, 100)
  if (error || !data) return { data: null, error }
  return {
    data: {
      total: data.length,
      pending: data.filter((item) => item.order_status === 'pending').length,
      ordered: data.filter((item) => item.order_status === 'ordered').length,
      delivered: data.filter((item) => item.order_status === 'delivered').length,
    },
    error: null,
  }
}
