'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import type { PermissionOperation } from '@/lib/permissions/resources'
import type { MaterialCategory, OrderItemStatus } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null; count?: number | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
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

type RequestRow = {
  id: string
  machine_id: string
  machines: { id: string; name: string; planned_material_date: string | null; is_archived: boolean | null } | null
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
  status: 'planned' | 'delivered'
  received_quantity: number | null
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
  piece_length_mm: number | null
  total_quantity: number
  available_quantity: number
  unit: string
  total_secondary_quantity: number | null
  available_secondary_quantity: number | null
  secondary_unit: string | null
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

async function requireAccess(operation: PermissionOperation = 'view') {
  const { supabase, userId } = await requirePermission('supply_orders', operation)
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
    .select('id, quantity')
    .eq('request_item_table', table)
    .eq('request_item_id', id)
  if (error) throw new Error(error.message || 'Не удалось загрузить график поставок')
  return ((data || []) as { id: string; quantity: number }[])
    .filter((row) => row.id !== excludeId)
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0)
}

async function assertScheduleTotalFits(db: LooseDb, item: RawOrderItem, quantity: number, excludeId?: string) {
  const existingTotal = await getPlannedScheduleTotal(db, item.table, item.id, excludeId)
  if (existingTotal + quantity > item.to_order) {
    throw new Error(`Сумма поставок не должна превышать ${item.to_order} ${item.unit}`)
  }
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
    .select('id, machine_id, status, submitted_at, machines!inner(id, name, planned_material_date, is_archived)')
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
      .select('id, machine_id, status, submitted_at, machines!inner(id, name, planned_material_date, is_archived)', { count: 'exact' })
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
      return { table, category, id: row.id, request_id: row.request_id, item_name: itemName(row, name), requested_quantity: requested, reserved_quantity: reserved, secondary_requested_quantity: secondaryRequestedQuantity(table, row), secondary_reserved_quantity: secondaryReservedQuantity(table, row), to_order: Math.max(requested - reserved, 0), unit: primaryUnit(table, row), supplier_id: supplierId, material_id: row.material_id || null, material_variant_id: row.material_variant_id || null, custom_delivery_date: row.custom_delivery_date || null, order_status: (row.order_status || 'pending') as OrderItemStatus, calculated_weight_kg: Number(row.calculated_weight_kg || 0) || null, selected_piece_length_mm: selectedPieceLength(table, row) }
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

    const materialIds = Array.from(new Set(rawItems.map((item) => item.material_id).filter(Boolean))) as string[]
    const materialsRes = materialIds.length
      ? await db.from('materials').select('id, default_supplier_id').in('id', materialIds)
      : { data: [], error: null }
    if (materialsRes.error) throw new Error(materialsRes.error.message || 'Не удалось загрузить материалы')
    const materialSupplierMap = new Map(((materialsRes.data || []) as { id: string; default_supplier_id: string | null }[]).map((item) => [item.id, item.default_supplier_id]))

    const rawItemsWithSuppliers = rawItems.map((item) => ({
      ...item,
      supplier_id: item.supplier_id || (item.material_id ? materialSupplierMap.get(item.material_id) || null : null),
    }))
    const [inventoryRes, reservationsRes, schedulesRes] = await Promise.all([
      materialIds.length ? db.from('inventory').select('id, material_id, material_variant_id, total_quantity, available_quantity, unit, total_secondary_quantity, available_secondary_quantity, secondary_unit, piece_length_mm').in('material_id', materialIds) : Promise.resolve({ data: [], error: null } as DbResult),
      db.from('inventory_reservations').select('id, request_item_table, request_item_id').in('request_item_id', rawItems.map((item) => item.id)),
      rawItems.length ? db.from('supply_order_delivery_schedules').select('id, request_item_table, request_item_id, delivery_date, quantity, unit, supplier_id, change_reason, status, received_quantity, delivered_at, received_by, created_at, updated_at').in('request_item_id', rawItems.map((item) => item.id)).order('delivery_date', { ascending: true }) : Promise.resolve({ data: [], error: null } as DbResult),
    ])
    if (inventoryRes.error) throw new Error(inventoryRes.error.message || 'Не удалось загрузить остатки склада')
    if (reservationsRes.error) throw new Error(reservationsRes.error.message || 'Не удалось загрузить бронирования')
    if (schedulesRes.error) throw new Error(schedulesRes.error.message || 'Не удалось загрузить график поставок')
    const stockRows = (inventoryRes.data || []) as { id: string; material_id: string; material_variant_id: string | null; total_quantity: number; available_quantity: number; unit: string; total_secondary_quantity: number | null; available_secondary_quantity: number | null; secondary_unit: string | null; piece_length_mm: number | null }[]
    const stockMap = new Map(stockRows.map((item) => [`${item.material_id}:${item.material_variant_id || 'legacy'}:${item.piece_length_mm ?? 'null'}`, item]))
    const stockGroupMap = new Map<string, typeof stockRows>()
    const materialStockMap = new Map<string, typeof stockRows>()
    for (const item of stockRows) {
      const groupKey = `${item.material_id}:${item.material_variant_id || 'legacy'}`
      stockGroupMap.set(groupKey, [...(stockGroupMap.get(groupKey) || []), item])
      materialStockMap.set(item.material_id, [...(materialStockMap.get(item.material_id) || []), item])
    }
    for (const rows of stockGroupMap.values()) {
      rows.sort((a, b) => Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
    }
    for (const rows of materialStockMap.values()) {
      rows.sort((a, b) => Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
    }
    const reservationMap = new Map(((reservationsRes.data || []) as { id: string; request_item_table: string; request_item_id: string }[]).map((item) => [`${item.request_item_table}:${item.request_item_id}`, item.id]))
    const scheduleRows = ((schedulesRes.data || []) as Array<SupplyOrderDeliverySchedule & { request_item_table: string; request_item_id: string }>)
      .filter((row) => rawItems.some((item) => item.table === row.request_item_table && item.id === row.request_item_id))
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
      const stockItems = item.material_id
        ? needsExactVariant
          ? item.material_variant_id
            ? stockGroupMap.get(`${item.material_id}:${item.material_variant_id}`) || []
            : []
          : stockGroupMap.get(`${item.material_id}:${item.material_variant_id || 'legacy'}`) ||
            stockGroupMap.get(`${item.material_id}:legacy`) ||
            materialStockMap.get(item.material_id) ||
            []
        : []
      const stockItem = item.material_id
        ? needsExactVariant
          ? item.material_variant_id
            ? stockMap.get(`${item.material_id}:${item.material_variant_id}:null`) || stockItems[0] || null
            : null
          : stockMap.get(`${item.material_id}:${item.material_variant_id || 'legacy'}:null`) ||
            stockMap.get(`${item.material_id}:legacy:null`) ||
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
        requested_quantity: item.requested_quantity,
        reserved_quantity: item.reserved_quantity,
        secondary_requested_quantity: item.secondary_requested_quantity,
        secondary_reserved_quantity: item.secondary_reserved_quantity,
        stock_available: stockAvailable,
        stock_unit: stockItem?.unit ?? null,
        stock_items: stockItems.map((row) => ({
          id: row.id,
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

  for (const payment of payments) {
    const amount = Number(payment.amount)
    if (!payment.supplierId) throw new Error('Укажите поставщика для платежа')
    if (!payment.plannedDate) throw new Error('Укажите дату оплаты')
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Сумма платежа должна быть больше 0')
    if (!['UAH', 'EUR'].includes(payment.currency)) throw new Error('Некорректная валюта платежа')

    const paymentItems = payment.itemKeys.map((key) => selectedByKey.get(key)).filter(Boolean) as RawOrderItem[]
    if (paymentItems.length === 0) throw new Error('Не удалось определить позиции платежа')
    if (paymentItems.some((item) => item.supplier_id !== payment.supplierId)) {
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
  payments: SupplyFinancePaymentInput[] = []
) {
  try {
    const { db, userId } = await requireAccess('manage')
    const groupedItems = groupItemsByTable(items)
    if (groupedItems.size === 0) return { success: true }
    const now = new Date().toISOString()
    const selectedItems = await loadSelectedOrderItems(db, groupedItems)
    if (selectedItems.length === 0) throw new Error('Выберите позиции')

    for (const item of selectedItems) {
      if (!item.material_id) throw new Error(`Позиция "${item.item_name}" не привязана к материалу`)
      if (item.to_order <= 0) throw new Error(`Позиция "${item.item_name}" полностью закрыта складом и не требует закупки`)
      if (!item.supplier_id) throw new Error(`Назначьте поставщика для позиции "${item.item_name}"`)
      if (status === 'ordered' && item.order_status !== 'pending') {
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
    } else {
      await Promise.all(selectedItems.map(async (item) => {
        const values: Record<string, unknown> = { order_status: status, ordered_at: now, supplier_id: item.supplier_id }
        const { error } = await db.from(item.table).update(values).eq('id', item.id)
        if (error) throw new Error(error.message || 'Не удалось обновить статус позиции')
      }))
      await createSupplyFinancePayments(db, userId, selectedItems, payments)
    }
    revalidatePath(ROUTES.SUPPLY)
    revalidatePath(ROUTES.SUPPLY_FINANCE)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    revalidatePath(ROUTES.FINANCE_CALENDAR)
    revalidatePath(ROUTES.SALES_PLAN)
    for (const machineId of machineIds) {
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}/request`)
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить позиции' }
  }
}

export async function markOrderPlaced(items: { table: string; id: string }[]) {
  return markOrderStatus(items, 'ordered')
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
    await assertScheduleTotalFits(db, orderItem, Number(data.quantity))
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
    revalidatePath(ROUTES.SUPPLY_ORDERS)
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
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить дату поставки' }
  }
}

export async function receiveOrderDeliverySchedule(scheduleId: string) {
  try {
    const { db, userId } = await requireAccess('manage')
    const { error } = await db.rpc('fn_receive_supply_order_schedule', {
      p_schedule_id: scheduleId,
      p_performed_by: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось принять поставку на склад')
    revalidatePath(ROUTES.SUPPLY)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    revalidatePath(ROUTES.SALES_PLAN)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось принять поставку на склад' }
  }
}

export async function deleteOrderDeliverySchedule(scheduleId: string) {
  try {
    const { db } = await requireAccess('manage')
    const { error } = await db.rpc('fn_delete_supply_order_schedule', {
      p_schedule_id: scheduleId,
    })
    if (error) throw new Error(error.message || 'Не удалось удалить дату поставки')
    revalidatePath(ROUTES.SUPPLY_ORDERS)
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
