'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { reserveForMachine, unreserveFromMachine } from '@/lib/actions/inventory'
import {
  filterReservationsByStockScope,
  type ReservationStockScope,
} from '@/lib/inventory/reservation-stock-scope'
import { requirePermission } from '@/lib/permissions/server'
import { DIRECTOR_ACCESS_ROLES, type PermissionOperation } from '@/lib/permissions/resources'
import type {
  Machine,
  RequestChainCord,
  RequestCircle,
  RequestComponents,
  RequestKnives,
  RequestMesh,
  RequestPaint,
  RequestPipe,
  RequestRoundTube,
  RequestSheetMetal,
  TechnologistRequest,
  UserRole,
  MaterialVariant,
} from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }

type RequestItemTable =
  | 'request_sheet_metal'
  | 'request_round_tube'
  | 'request_circle'
  | 'request_pipe'
  | 'request_knives'
  | 'request_components'
  | 'request_paint'
  | 'request_mesh'
  | 'request_chain_cord'

type RequestWithRelations = TechnologistRequest & {
  machine: Pick<Machine, 'id' | 'name' | 'factory_id' | 'planned_material_date' | 'created_at' | 'is_archived'>
  technologist_name: string | null
}

export type SupplyRequestRow<T> = T & {
  materials?: { id: string; name: string } | null
  steel_type_name?: string | null
  available_stock: number | null
  available_secondary_stock?: number | null
  incompatible_stock_available?: number | null
  stock_unit: string | null
  secondary_stock_unit?: string | null
  stock_items: SupplyStockItem[]
  reservation_id: string | null
  reserved_quantity: number
  covered_quantity: number
  reserved_secondary_quantity: number | null
}

export type SupplyStockItem = {
  id: string
  factory_id: string
  material_variant_id: string | null
  piece_length_mm: number | null
  is_business_scrap: boolean
  label: string | null
  total_quantity: number
  available_quantity: number
  unit: string
  total_secondary_quantity: number | null
  available_secondary_quantity: number | null
  secondary_unit: string | null
}

export type SupplyRequestSectionSummary = {
  positions: number
  needed: number | null
  reserved: number | null
  toOrder: number | null
  unit?: string
}

export type SupplyRequestPayload = {
  current_role: UserRole
  request: RequestWithRelations
  sections: {
    sheetMetal: SupplyRequestRow<RequestSheetMetal>[]
    roundTube: SupplyRequestRow<RequestRoundTube>[]
    circles: SupplyRequestRow<RequestCircle>[]
    pipes: SupplyRequestRow<RequestPipe>[]
    knives: SupplyRequestRow<RequestKnives>[]
    components: SupplyRequestRow<RequestComponents>[]
    paint: SupplyRequestRow<RequestPaint>[]
    meshItems: SupplyRequestRow<RequestMesh>[]
    chainCords: SupplyRequestRow<RequestChainCord>[]
  }
  summary: {
    sheetMetal: SupplyRequestSectionSummary
    roundTube: SupplyRequestSectionSummary
    circles: SupplyRequestSectionSummary
    pipes: SupplyRequestSectionSummary
    knives: SupplyRequestSectionSummary
    components: SupplyRequestSectionSummary
    paint: SupplyRequestSectionSummary
    meshItems: SupplyRequestSectionSummary
    chainCords: SupplyRequestSectionSummary
  }
}

type InventoryRow = {
  id?: string
  factory_id: string
  material_id: string
  material_variant_id: string | null
  total_quantity: number
  available_quantity: number
  unit: string
  total_secondary_quantity?: number | null
  available_secondary_quantity?: number | null
  secondary_unit?: string | null
  piece_length_mm: number | null
  is_business_scrap?: boolean | null
  business_scrap_state?: 'available' | 'future' | null
  deleted_at?: string | null
  variant?: MaterialVariant | null
}

type ReservationRow = {
  id: string | null
  inventory_id: string | null
  source_inventory_id: string | null
  request_item_table: string
  request_item_id: string
  reserved_quantity: number
  reserved_secondary_quantity: number | null
  consumed_at: string | null
  reservation_source?: string | null
}

type ReservationStockSource = ReservationStockScope

const REQUEST_TABLES: RequestItemTable[] = [
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
  const { supabase, userId, role } = await requirePermission('supply', operation)
  return { db: supabase as unknown as LooseDb, userId, role }
}

function reservationKey(table: string, id: string) {
  return `${table}:${id}`
}

function stockKey(materialId: string, variantId?: string | null, pieceLengthMm?: number | null) {
  return `${materialId}:${variantId || 'legacy'}:${pieceLengthMm ?? 'null'}`
}

function stockGroupKey(materialId: string, variantId?: string | null) {
  return `${materialId}:${variantId || 'legacy'}`
}

function asNumber(value: unknown) {
  return Number(value || 0)
}

function toOrder(needed: number, reserved: number) {
  return Math.max(needed - reserved, 0)
}

function getTableRequestField(table: RequestItemTable) {
  if (table === 'request_sheet_metal') return 'reserved_from_stock_kg'
  // @deprecated — round_tube excluded from new UI
  if (table === 'request_round_tube') return 'reserved_from_stock_kg'
  if (table === 'request_circle') return 'reserved_from_stock_mm'
  if (table === 'request_pipe') return 'reserved_from_stock_length_mm'
  if (table === 'request_knives') return 'reserved_from_stock_mm'
  if (table === 'request_components') return 'reserved_from_stock'
  return 'reserved_from_stock_kg'
}

function getNeededForRow(table: RequestItemTable, row: Record<string, unknown>) {
  if (table === 'request_sheet_metal') return asNumber(row.remainder_qty || row.to_order_kg)
  // @deprecated — round_tube excluded from new UI
  if (table === 'request_round_tube') return asNumber(row.order_kg)
  if (table === 'request_circle') return asNumber(row.remainder_mm)
  if (table === 'request_pipe') return row.pipe_type === 'wire' ? asNumber(row.remainder_kg) : asNumber(row.remainder_length_mm)
  if (table === 'request_knives') return asNumber(row.remainder_meters) > 0 ? asNumber(row.remainder_meters) * 1000 : asNumber(row.to_order_mm)
  if (table === 'request_components') return Math.max(asNumber(row.quantity_needed) - asNumber(row.stock_remainder), 0)
  if (table === 'request_mesh') return asNumber(row.remainder_qty)
  if (table === 'request_chain_cord') return asNumber(row.remainder_meters) * 1000
  return asNumber(row.remainder_kg || row.to_order_kg)
}

function getReservedForRow(table: RequestItemTable, row: Record<string, unknown>) {
  if (row.reserved_quantity !== undefined && row.reserved_quantity !== null) return asNumber(row.reserved_quantity)
  if (table === 'request_pipe' && row.pipe_type === 'wire') return asNumber(row.reserved_from_stock_kg)
  if (table === 'request_chain_cord') return asNumber(row[getTableRequestField(table)]) * 1000
  return asNumber(row[getTableRequestField(table)])
}

function isActiveSupplyRow(table: RequestItemTable, row: Record<string, unknown>) {
  if (row.order_status === 'delivered') return false
  return toOrder(getNeededForRow(table, row), getReservedForRow(table, row)) > 0
}

function getRoundSecondaryReserve(quantity: number, row: Record<string, unknown>) {
  // @deprecated — round_tube excluded from new UI
  const neededKg = asNumber(row.order_kg)
  const neededM = asNumber(row.order_meters)
  const reservedKg = asNumber(row.reserved_from_stock_kg)
  const reservedM = asNumber(row.reserved_from_stock_m)
  const remainingKg = Math.max(neededKg - reservedKg, 0)
  const remainingM = Math.max(neededM - reservedM, 0)
  if (remainingKg <= 0 || remainingM <= 0) return null
  return Math.min(remainingM, (quantity / remainingKg) * remainingM)
}

function requiresExactVariant(table: RequestItemTable, row: Record<string, unknown>) {
  return table === 'request_knives' || (table === 'request_pipe' && row.pipe_type !== 'wire')
}

function isCutReservationTable(table: RequestItemTable, row: Record<string, unknown>) {
  return requiresExactVariant(table, row)
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim().toLowerCase().replace(/[\u0445\u00d7*]/g, 'x')
}

function numbersMatch(left: unknown, right: unknown) {
  const a = Number(left ?? 0)
  const b = Number(right ?? 0)
  if (!a && !b) return true
  return Math.abs(a - b) < 0.001
}

function optionalTextMatches(left: unknown, right: unknown) {
  const a = normalizeText(left)
  const b = normalizeText(right)
  if (!a || !b) return true
  return a === b
}

function singleDimension(value: unknown) {
  if (typeof value !== 'string') return null
  const number = Number(value.trim().replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : null
}

function dimensionParts(value: unknown) {
  const parts = normalizeText(value)
    .replace(/\s+/g, '')
    .split('x')
    .map((part) => Number(part.replace(',', '.')))
  return parts.length >= 2 && parts.every((part) => Number.isFinite(part) && part > 0) ? parts : []
}

function pipeDiameterMatches(row: Record<string, unknown>, variant: MaterialVariant) {
  if (row.pipe_type === 'wire') return numbersMatch(row.diameter_mm, variant.diameter_mm)
  if (row.pipe_type === 'round') return numbersMatch(singleDimension(row.size) ?? row.diameter_mm, variant.diameter_mm)
  return true
}

function knifeDimensionMatches(row: Record<string, unknown>, variant: MaterialVariant) {
  const rowDimensions = [
    row.length_mm,
    row.width_mm,
    row.height_mm,
  ]
  const variantTextDimensions = dimensionParts(variant.knife_dimensions)
  const variantDimensions = [
    variant.standard_length_mm ?? variantTextDimensions[0],
    variant.width_mm ?? variantTextDimensions[1],
    variant.height_mm ?? variantTextDimensions[2],
  ]
  return numbersMatch(rowDimensions[0], variantDimensions[0])
    && numbersMatch(rowDimensions[1], variantDimensions[1])
    && numbersMatch(rowDimensions[2], variantDimensions[2])
}

function variantMatchesRequest(table: RequestItemTable, row: Record<string, unknown>, variant?: MaterialVariant | null) {
  if (!variant) return false
  if (table === 'request_pipe') {
    return optionalTextMatches(row.pipe_type, variant.pipe_type)
      && optionalTextMatches(row.size, variant.piece_description)
      && numbersMatch(row.wall_thickness_mm, variant.wall_thickness_mm)
      && pipeDiameterMatches(row, variant)
      && optionalTextMatches(row.steel_type_id, variant.steel_type_id)
  }
  if (table === 'request_knives') {
    return knifeDimensionMatches(row, variant)
      && optionalTextMatches(row.steel_type_id, variant.steel_type_id)
      && optionalTextMatches(row.steel_grade, variant.material_grade ?? variant.knife_material)
  }
  if (table === 'request_components') {
    return numbersMatch(row.diameter_mm, variant.diameter_mm)
      && optionalTextMatches(row.component_name, variant.specification)
  }
  if (table === 'request_paint') {
    return optionalTextMatches(row.ral_code, variant.ral_code)
      && optionalTextMatches(row.finish, variant.finish)
  }
  if (table === 'request_mesh') {
    return optionalTextMatches(row.description, variant.mesh_description)
      && numbersMatch(row.length_mm, variant.mesh_length_mm)
      && numbersMatch(row.width_mm, variant.mesh_width_mm)
  }
  if (table === 'request_chain_cord') {
    return optionalTextMatches(row.item_type, variant.chain_cord_type)
      && optionalTextMatches(row.parameters, variant.chain_cord_parameters)
  }
  return true
}

function getReservableQuantity(table: RequestItemTable, row: Record<string, unknown>, item: InventoryRow) {
  if (isCutReservationTable(table, row)) {
    const pieceLength = Number(item.piece_length_mm || 0)
    const pieces = Math.floor(Number(item.available_secondary_quantity || 0))
    return pieceLength > 0 && pieces > 0 ? pieceLength * pieces : 0
  }
  return Number(item.available_quantity || 0)
}

function hasAvailableStock(table: RequestItemTable, row: Record<string, unknown>, items: InventoryRow[]) {
  return items.some((item) => getReservableQuantity(table, row, item) > 0)
}

function uniqueInventoryRows(rows: InventoryRow[]) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = row.id || stockKey(row.material_id, row.material_variant_id, row.piece_length_mm)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getRawAvailableQuantity(item: InventoryRow) {
  return Number(item.available_quantity || 0)
}

function getReservationStockSource(request: Pick<TechnologistRequest, 'status'>): ReservationStockSource | null {
  if (request.status === 'pending_stock_check' || request.status === 'stock_checked') return 'business_scrap'
  if (request.status === 'submitted_to_supply' || request.status === 'completed') return 'regular_stock'
  return null
}

function assertReservationAllowedForRequest(request: Pick<TechnologistRequest, 'status'>) {
  const source = getReservationStockSource(request)
  if (!source) throw new Error('Заявка не находится на этапе бронирования склада')
  return source
}

function inventoryMatchesReservationSource(item: Pick<InventoryRow, 'is_business_scrap'>, source: ReservationStockSource) {
  return source === 'business_scrap'
    ? Boolean(item.is_business_scrap)
    : !Boolean(item.is_business_scrap)
}

function getReservationSourceError(source: ReservationStockSource) {
  return source === 'business_scrap'
    ? 'На этапе проверки технолог может бронировать только деловой отход'
    : 'Снабжение может бронировать только обычный склад'
}

function describeStockItem(table: RequestItemTable, variant?: MaterialVariant | null) {
  if (!variant) return null
  const parts: string[] = []
  if (table === 'request_pipe') {
    if (variant.pipe_type) parts.push(String(variant.pipe_type))
    if (variant.piece_description) parts.push(String(variant.piece_description))
    if (variant.wall_thickness_mm) parts.push(`стенка ${variant.wall_thickness_mm} мм`)
    if (variant.diameter_mm) parts.push(`диаметр ${variant.diameter_mm} мм`)
  } else if (table === 'request_knives') {
    if (variant.standard_length_mm) parts.push(`${variant.standard_length_mm} мм`)
    if (variant.width_mm || variant.height_mm) parts.push(`${variant.width_mm || 0}x${variant.height_mm || 0}`)
    if (variant.material_grade) parts.push(String(variant.material_grade))
  } else if (table === 'request_paint') {
    if (variant.ral_code) parts.push(String(variant.ral_code))
    if (variant.finish) parts.push(String(variant.finish))
  } else if (table === 'request_components') {
    if (variant.specification) parts.push(String(variant.specification))
    if (variant.diameter_mm) parts.push(`${variant.diameter_mm} мм`)
  } else if (table === 'request_mesh') {
    if (variant.mesh_description) parts.push(String(variant.mesh_description))
    if (variant.mesh_length_mm || variant.mesh_width_mm) parts.push(`${variant.mesh_length_mm || 0}x${variant.mesh_width_mm || 0} мм`)
  } else if (table === 'request_chain_cord') {
    if (variant.chain_cord_type) parts.push(String(variant.chain_cord_type))
    if (variant.chain_cord_parameters) parts.push(String(variant.chain_cord_parameters))
  }
  return parts.length ? parts.join(', ') : null
}

function findStockItems(
  table: RequestItemTable,
  row: { material_id: string | null; material_variant_id?: string | null },
  rowRecord: Record<string, unknown>,
  inventoryGroupMap: Map<string, InventoryRow[]>,
  materialInventoryMap: Map<string, InventoryRow[]>,
) {
  if (!row.material_id) return []

  const exactItems = row.material_variant_id
    ? inventoryGroupMap.get(stockGroupKey(row.material_id, row.material_variant_id)) || []
    : []

  const allMaterialItems = materialInventoryMap.get(row.material_id) || []
  const matchedByCharacteristics = allMaterialItems.filter((item) => {
    if (!item.material_variant_id) return false
    return variantMatchesRequest(table, rowRecord, item.variant)
  })
  if (requiresExactVariant(table, rowRecord)) {
    const matchingItems = uniqueInventoryRows([...exactItems, ...matchedByCharacteristics])
    if (hasAvailableStock(table, rowRecord, matchingItems)) return matchingItems
    return matchingItems
  }

  if (hasAvailableStock(table, rowRecord, exactItems)) return exactItems
  if (hasAvailableStock(table, rowRecord, matchedByCharacteristics)) return matchedByCharacteristics

  const legacyItems = inventoryGroupMap.get(stockGroupKey(row.material_id, null)) || []
  if (hasAvailableStock(table, rowRecord, legacyItems)) return legacyItems
  return exactItems.length ? exactItems : legacyItems.length ? legacyItems : allMaterialItems
}

async function loadRows<T>(db: LooseDb, table: RequestItemTable, requestId: string) {
  const { data, error } = await db.from(table).select('*, materials(id, name)').eq('request_id', requestId).order('sort_order', { ascending: true })
  if (error) throw new Error(error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸ Ð·Ð°ÑÐ²ÐºÐ¸')
  return (data || []) as T[]
}

async function getRequestMeta(db: LooseDb, requestId: string) {
  const { data, error } = await db.from('technologist_requests').select('*').eq('id', requestId).maybeSingle()
  if (error) throw new Error(error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð·Ð°ÑÐ²ÐºÑƒ')
  if (!data) throw new Error('Ð—Ð°ÑÐ²ÐºÐ° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')
  const request = data as TechnologistRequest

  const [{ data: machineData, error: machineError }, { data: userData }] = await Promise.all([
    db.from('machines').select('id, name, factory_id, planned_material_date, created_at, is_archived').eq('id', request.machine_id).single(),
    request.created_by ? db.from('users').select('full_name').eq('id', request.created_by).maybeSingle() : Promise.resolve({ data: null, error: null } as DbResult),
  ])
  if (machineError || !machineData) throw new Error(machineError?.message || 'ÐœÐ°ÑˆÐ¸Ð½Ð° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')
  if ((machineData as Pick<Machine, 'is_archived'>).is_archived) throw new Error('Машина не найдена')

  return {
    ...request,
    machine: machineData as Pick<Machine, 'id' | 'name' | 'factory_id' | 'planned_material_date' | 'created_at' | 'is_archived'>,
    technologist_name: (userData as { full_name?: string } | null)?.full_name || null,
  } satisfies RequestWithRelations
}

function assertSupplyRequestVisibleForRole(request: TechnologistRequest, role: UserRole) {
  const visibleStatuses = ['pending_stock_check', 'stock_checked', 'submitted_to_supply', 'completed']
  if (!visibleStatuses.includes(request.status)) {
    throw new Error('Заявка ещё не передана на проверку склада')
  }
  if (role === 'supply_manager' && request.status !== 'submitted_to_supply' && request.status !== 'completed') {
    throw new Error('Заявка ещё не передана в снабжение')
  }
}

async function getRequestIdForItem(db: LooseDb, table: RequestItemTable, id: string) {
  const { data, error } = await db.from(table).select('request_id').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð¾Ð¿Ñ€ÐµÐ´ÐµÐ»Ð¸Ñ‚ÑŒ Ð·Ð°ÑÐ²ÐºÑƒ Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸')
  const row = data as { request_id?: string } | null
  if (!row?.request_id) throw new Error('ÐŸÐ¾Ð·Ð¸Ñ†Ð¸Ñ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')
  return row.request_id
}

async function getReservationIdsForItem(
  db: LooseDb,
  table: string,
  id: string,
  reservationSource: ReservationStockSource,
) {
  const { data, error } = await db
    .from('inventory_reservations')
    .select('id, inventory_id, source_inventory_id')
    .eq('request_item_table', table)
    .eq('request_item_id', id)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Не удалось загрузить бронь')
  const reservations = (data || []) as Array<{
    id?: string
    inventory_id: string | null
    source_inventory_id: string | null
  }>
  const inventoryIds = Array.from(new Set(
    reservations
      .map((reservation) => reservation.source_inventory_id || reservation.inventory_id)
      .filter((inventoryId): inventoryId is string => Boolean(inventoryId)),
  ))
  if (!inventoryIds.length) return []

  const { data: inventoryData, error: inventoryError } = await db
    .from('inventory')
    .select('id, is_business_scrap')
    .in('id', inventoryIds)
  if (inventoryError) throw new Error(inventoryError.message || 'Не удалось определить источник брони')
  const inventoryById = new Map(
    ((inventoryData || []) as Array<{ id: string; is_business_scrap?: boolean | null }>)
      .map((inventory) => [inventory.id, inventory] as const),
  )

  return filterReservationsByStockScope(reservations, inventoryById, reservationSource)
    .map((reservation) => reservation.id)
    .filter((reservationId): reservationId is string => Boolean(reservationId))
}

function buildReservationMap(rows: ReservationRow[]) {
  const map = new Map<string, ReservationRow>()
  for (const row of rows) {
    const key = reservationKey(row.request_item_table, row.request_item_id)
    const current = map.get(key)
    if (!current) {
      map.set(key, { ...row, id: row.consumed_at ? null : row.id })
      continue
    }
    if (!current.id && !row.consumed_at) current.id = row.id
    current.reserved_quantity = Number(current.reserved_quantity || 0) + Number(row.reserved_quantity || 0)
    current.reserved_secondary_quantity = Number(current.reserved_secondary_quantity || 0) + Number(row.reserved_secondary_quantity || 0)
  }
  return map
}

function withStock<T extends { id: string; material_id: string | null; material_variant_id?: string | null }>(
  table: RequestItemTable,
  rows: T[],
  inventoryMap: Map<string, InventoryRow>,
  inventoryGroupMap: Map<string, InventoryRow[]>,
  materialInventoryMap: Map<string, InventoryRow[]>,
  reservationMap: Map<string, ReservationRow>,
  steelTypeMap: Map<string, string>,
  reservationSource: ReservationStockSource,
) {
  return rows.map((row) => {
    const rowRecord = row as Record<string, unknown>
    const stockItems = findStockItems(table, row, rowRecord, inventoryGroupMap, materialInventoryMap)
      .filter((item) => inventoryMatchesReservationSource(item, reservationSource))
    const materialItems = row.material_id ? materialInventoryMap.get(row.material_id) || [] : []
    const inventory = row.material_id
      ? inventoryMap.get(stockKey(row.material_id, row.material_variant_id, null)) ||
        inventoryMap.get(stockKey(row.material_id, null, null)) ||
        stockItems[0] ||
        materialItems[0] ||
        null
      : null
    const reservation = reservationMap.get(reservationKey(table, row.id))
    const coveredQuantity = getReservedForRow(table, rowRecord)
    const hasReservableStock = hasAvailableStock(table, rowRecord, stockItems)
    const incompatibleStockAvailable = row.material_id && requiresExactVariant(table, rowRecord) && !hasReservableStock
      ? materialItems.reduce((sum, item) => sum + getRawAvailableQuantity(item), 0)
      : 0
    const availableStock = stockItems.length
      ? stockItems.reduce((sum, item) => sum + getReservableQuantity(table, rowRecord, item), 0)
      : inventory?.available_quantity ?? null
    const availableSecondaryStock = stockItems.length
      ? stockItems.reduce((sum, item) => sum + Number(item.available_secondary_quantity || 0), 0)
      : inventory?.available_secondary_quantity ?? null
    return {
      ...row,
      steel_type_name: typeof rowRecord.steel_type_id === 'string' ? steelTypeMap.get(rowRecord.steel_type_id) || null : null,
      available_stock: availableStock,
      available_secondary_stock: availableSecondaryStock,
      incompatible_stock_available: incompatibleStockAvailable > 0 ? incompatibleStockAvailable : null,
      stock_unit: inventory?.unit ?? null,
      secondary_stock_unit: inventory?.secondary_unit ?? null,
      stock_items: stockItems.map((item) => ({
        id: item.id || stockKey(item.material_id, item.material_variant_id, item.piece_length_mm),
        factory_id: item.factory_id,
        material_variant_id: item.material_variant_id,
        piece_length_mm: item.piece_length_mm,
        is_business_scrap: Boolean(item.is_business_scrap),
        label: describeStockItem(table, item.variant),
        total_quantity: item.total_quantity,
        available_quantity: getReservableQuantity(table, rowRecord, item),
        unit: item.unit,
        total_secondary_quantity: item.total_secondary_quantity ?? null,
        available_secondary_quantity: item.available_secondary_quantity ?? null,
        secondary_unit: item.secondary_unit ?? null,
      })),
      reservation_id: reservation?.id || null,
      reserved_quantity: reservation?.reserved_quantity ?? 0,
      covered_quantity: coveredQuantity,
      reserved_secondary_quantity: reservation?.reserved_secondary_quantity ?? null,
    }
  })
}

function summarize(rows: Array<Record<string, unknown>>, table: RequestItemTable, unit?: string): SupplyRequestSectionSummary {
  const needed = rows.reduce((sum, row) => sum + getNeededForRow(table, row), 0)
  const reserved = rows.reduce((sum, row) => sum + getReservedForRow(table, row), 0)
  const covered = rows.reduce((sum, row) => sum + asNumber(row.covered_quantity ?? getReservedForRow(table, row)), 0)
  return {
    positions: rows.length,
    needed,
    reserved,
    toOrder: Math.max(needed - covered, 0),
    unit,
  }
}

function summarizeComponents(rows: RequestComponents[]): SupplyRequestSectionSummary {
  const needed = rows.reduce((sum, row) => sum + getNeededForRow('request_components', row as unknown as Record<string, unknown>), 0)
  const reserved = rows.reduce((sum, row) => sum + getReservedForRow('request_components', row as unknown as Record<string, unknown>), 0)
  const covered = rows.reduce((sum, row) => {
    const rowRecord = row as unknown as Record<string, unknown>
    return sum + asNumber(rowRecord.covered_quantity ?? getReservedForRow('request_components', rowRecord))
  }, 0)
  return {
    positions: rows.length,
    needed,
    reserved,
    toOrder: Math.max(needed - covered, 0),
    unit: 'шт',
  }
}

function revalidateSupplyRequest(requestId: string, machineId?: string) {
  revalidatePath(`${ROUTES.SUPPLY_REQUEST}/${requestId}`)
  revalidatePath(ROUTES.SUPPLY_ORDERS)
  revalidatePath(ROUTES.SUPPLY_MATERIAL_REQUESTS)
  revalidatePath(ROUTES.SUPPLY)
  revalidatePath(ROUTES.INVENTORY)
  if (machineId) {
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}/request`)
  }
}

async function loadRequestForStockSource(
  db: LooseDb,
  role: UserRole,
  requestId: string,
  stockSourceOverride?: ReservationStockSource,
): Promise<{ data: SupplyRequestPayload | null; error: string | null }> {
  try {
    const request = await getRequestMeta(db, requestId)
    assertSupplyRequestVisibleForRole(request, role)
    const [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
      loadRows<RequestSheetMetal>(db, 'request_sheet_metal', requestId),
      // @deprecated — round_tube excluded from new UI
      loadRows<RequestRoundTube>(db, 'request_round_tube', requestId),
      loadRows<RequestCircle>(db, 'request_circle', requestId),
      loadRows<RequestPipe>(db, 'request_pipe', requestId),
      loadRows<RequestKnives>(db, 'request_knives', requestId),
      loadRows<RequestComponents>(db, 'request_components', requestId),
      loadRows<RequestPaint>(db, 'request_paint', requestId),
      loadRows<RequestMesh>(db, 'request_mesh', requestId),
      loadRows<RequestChainCord>(db, 'request_chain_cord', requestId),
    ])

    const allRows = [
      ...sheetMetal.map((row) => ({ table: 'request_sheet_metal' as RequestItemTable, id: row.id, material_id: row.material_id })),
      // @deprecated — round_tube excluded from new UI
      ...roundTube.map((row) => ({ table: 'request_round_tube' as RequestItemTable, id: row.id, material_id: row.material_id })),
      ...circles.map((row) => ({ table: 'request_circle' as RequestItemTable, id: row.id, material_id: row.material_id })),
      ...pipes.map((row) => ({ table: 'request_pipe' as RequestItemTable, id: row.id, material_id: row.material_id })),
      ...knives.map((row) => ({ table: 'request_knives' as RequestItemTable, id: row.id, material_id: row.material_id })),
      ...components.map((row) => ({ table: 'request_components' as RequestItemTable, id: row.id, material_id: row.material_id })),
      ...paint.map((row) => ({ table: 'request_paint' as RequestItemTable, id: row.id, material_id: row.material_id })),
      ...meshItems.map((row) => ({ table: 'request_mesh' as RequestItemTable, id: row.id, material_id: row.material_id })),
      ...chainCords.map((row) => ({ table: 'request_chain_cord' as RequestItemTable, id: row.id, material_id: row.material_id })),
    ]
    const materialIds = Array.from(new Set(allRows.map((row) => row.material_id).filter(Boolean))) as string[]
    const itemIds = allRows.map((row) => row.id)

    const steelTypeIds = Array.from(new Set([
      ...pipes.map((row) => row.steel_type_id).filter(Boolean),
      ...knives.map((row) => row.steel_type_id).filter(Boolean),
    ])) as string[]

    const [inventoryRes, reservationsRes, steelTypesRes] = await Promise.all([
      materialIds.length && request.machine.factory_id
        ? db.from('inventory').select('id, factory_id, material_id, material_variant_id, total_quantity, available_quantity, unit, total_secondary_quantity, available_secondary_quantity, secondary_unit, piece_length_mm, is_business_scrap, business_scrap_state, deleted_at').in('material_id', materialIds).eq('factory_id', request.machine.factory_id)
        : Promise.resolve({ data: [], error: null } as DbResult),
      itemIds.length
        ? db.from('inventory_reservations').select('id, inventory_id, source_inventory_id, request_item_table, request_item_id, reserved_quantity, reserved_secondary_quantity, consumed_at, reservation_source').in('request_item_id', itemIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
      steelTypeIds.length
        ? db.from('steel_types').select('id, name').in('id', steelTypeIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
    ])
    if (inventoryRes.error) throw new Error(inventoryRes.error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¾ÑÑ‚Ð°Ñ‚ÐºÐ¸')
    if (reservationsRes.error) throw new Error(reservationsRes.error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð±Ñ€Ð¾Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ñ')
    if (steelTypesRes.error) throw new Error(steelTypesRes.error.message || 'Не удалось загрузить типы стали')
    const steelTypeMap = new Map(((steelTypesRes.data || []) as { id: string; name: string }[]).map((steelType) => [steelType.id, steelType.name]))

    const allInventoryRows = (inventoryRes.data || []) as InventoryRow[]
    const inventoryRows = allInventoryRows.filter((row) => !row.deleted_at && (row.business_scrap_state || 'available') !== 'future')
    const inventoryVariantIds = Array.from(new Set(inventoryRows.map((row) => row.material_variant_id).filter(Boolean))) as string[]
    const variantMap = new Map<string, MaterialVariant>()
    if (inventoryVariantIds.length) {
      const { data: variantsData, error: variantsError } = await db
        .from('material_variants')
        .select('*')
        .in('id', inventoryVariantIds)
      if (variantsError) throw new Error(variantsError.message || 'Не удалось загрузить характеристики складских остатков')
      for (const variant of (variantsData || []) as MaterialVariant[]) variantMap.set(variant.id, variant)
      for (const row of inventoryRows) row.variant = row.material_variant_id ? variantMap.get(row.material_variant_id) || null : null
    }
    const reservationSource = stockSourceOverride || assertReservationAllowedForRequest(request)
    const visibleInventoryRows = inventoryRows.filter((row) => inventoryMatchesReservationSource(row, reservationSource))
    const inventoryMap = new Map(visibleInventoryRows.map((row) => [stockKey(row.material_id, row.material_variant_id, row.piece_length_mm), row]))
    const inventoryGroupMap = new Map<string, InventoryRow[]>()
    const materialInventoryMap = new Map<string, InventoryRow[]>()
    for (const row of visibleInventoryRows) {
      const groupKey = stockGroupKey(row.material_id, row.material_variant_id)
      inventoryGroupMap.set(groupKey, [...(inventoryGroupMap.get(groupKey) || []), row])
      materialInventoryMap.set(row.material_id, [...(materialInventoryMap.get(row.material_id) || []), row])
    }
    for (const rows of inventoryGroupMap.values()) {
      rows.sort((a, b) => Number(Boolean(b.is_business_scrap)) - Number(Boolean(a.is_business_scrap)) || Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
    }
    for (const rows of materialInventoryMap.values()) {
      rows.sort((a, b) => Number(Boolean(b.is_business_scrap)) - Number(Boolean(a.is_business_scrap)) || Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
    }
    const inventoryById = new Map(
      allInventoryRows.flatMap((inventory) => inventory.id ? [[inventory.id, {
        id: inventory.id,
        is_business_scrap: inventory.is_business_scrap,
      }] as const] : []),
    )
    const scopedReservations = filterReservationsByStockScope(
      ((reservationsRes.data || []) as ReservationRow[])
        .filter((reservation) => reservation.reservation_source !== 'correction_hold'),
      inventoryById,
      reservationSource,
    )
    const reservationMap = buildReservationMap(scopedReservations)
    const sections = {
      sheetMetal: withStock('request_sheet_metal', sheetMetal, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      // @deprecated — round_tube excluded from new UI
      roundTube: withStock('request_round_tube', roundTube, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      circles: withStock('request_circle', circles, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      pipes: withStock('request_pipe', pipes, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      knives: withStock('request_knives', knives, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      components: withStock('request_components', components, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      paint: withStock('request_paint', paint, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      meshItems: withStock('request_mesh', meshItems, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
      chainCords: withStock('request_chain_cord', chainCords, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource),
    }

    return {
      data: {
        current_role: role,
        request,
        sections,
        summary: {
          sheetMetal: summarize(sections.sheetMetal, 'request_sheet_metal', 'шт'),
          // @deprecated — round_tube excluded from new UI
          roundTube: summarize(sections.roundTube, 'request_round_tube', 'кг'),
          circles: summarize(sections.circles, 'request_circle', 'мм'),
          pipes: summarize(sections.pipes, 'request_pipe', 'мм'),
          knives: summarize(sections.knives, 'request_knives', 'мм'),
          components: summarizeComponents(sections.components),
          paint: summarize(sections.paint, 'request_paint', 'кг'),
          meshItems: summarize(sections.meshItems, 'request_mesh', 'шт'),
          chainCords: summarize(sections.chainCords, 'request_chain_cord', 'мм'),
        },
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð·Ð°ÑÐ²ÐºÑƒ' }
  }
}

export async function getRequestForSupply(requestId: string): Promise<{ data: SupplyRequestPayload | null; error: string | null }> {
  try {
    const { db, role } = await requireAccess()
    return await loadRequestForStockSource(db, role, requestId)
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заявку' }
  }
}

export async function getRequestForBusinessScrap(requestId: string): Promise<{ data: SupplyRequestPayload | null; error: string | null }> {
  try {
    const { supabase, userId, role } = await requirePermission('business_scrap_reservations', 'view')
    const db = supabase as unknown as LooseDb
    const request = await getRequestMeta(db, requestId)
    if (!(DIRECTOR_ACCESS_ROLES as readonly UserRole[]).includes(role)) {
      const { data: taskData, error: taskError } = await db
        .from('tasks')
        .select('id')
        .eq('machine_id', request.machine_id)
        .eq('task_type', 'technologist_request')
        .eq('assigned_to', userId)
        .in('status', ['pending', 'in_progress', 'completed'])
        .limit(1)
      if (taskError) throw new Error(taskError.message || 'Не удалось проверить назначение машины')
      if (!Array.isArray(taskData) || taskData.length === 0) throw new Error('Машина не назначена текущему технологу')
    }
    return await loadRequestForStockSource(db, role, requestId, 'business_scrap')
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить деловой остаток' }
  }
}

export async function reserveItemFromStock(data: {
  request_item_table: RequestItemTable
  request_item_id: string
  inventory_id: string
  material_id: string
  material_variant_id?: string | null
  piece_length_mm?: number | null
  machine_id: string
  quantity: number
}) {
  try {
    const { db } = await requireAccess('manage')
    if (!REQUEST_TABLES.includes(data.request_item_table)) throw new Error('ÐÐµÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ð°Ñ Ñ‚Ð°Ð±Ð»Ð¸Ñ†Ð° Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸')
    const requestId = await getRequestIdForItem(db, data.request_item_table, data.request_item_id)
    const request = await getRequestMeta(db, requestId)
    const reservationSource = assertReservationAllowedForRequest(request)
    const { data: rowData, error } = await db.from(data.request_item_table).select('*').eq('id', data.request_item_id).single()
    if (error || !rowData) throw new Error(error?.message || 'ÐŸÐ¾Ð·Ð¸Ñ†Ð¸Ñ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')

    const row = rowData as Record<string, unknown>
    const { data: selectedInventoryData, error: selectedInventoryError } = await db
      .from('inventory')
      .select('id, factory_id, material_id, material_variant_id, total_quantity, available_quantity, unit, total_secondary_quantity, available_secondary_quantity, secondary_unit, piece_length_mm, is_business_scrap, business_scrap_state, deleted_at')
      .eq('id', data.inventory_id)
      .maybeSingle()
    if (selectedInventoryError) throw new Error(selectedInventoryError.message || 'Не удалось проверить выбранный складской остаток')
    const selectedInventory = selectedInventoryData as InventoryRow | null
    if (!selectedInventory?.id || selectedInventory.deleted_at) throw new Error('Выбранный складской остаток не найден')
    if (!request.machine.factory_id || selectedInventory.factory_id !== request.machine.factory_id) {
      throw new Error('Выбранный складской остаток относится к другому заводу')
    }
    if ((selectedInventory.business_scrap_state || 'available') === 'future') throw new Error('Будущий деловой отход нельзя бронировать в этой заявке')
    if (!inventoryMatchesReservationSource(selectedInventory, reservationSource)) {
      throw new Error(getReservationSourceError(reservationSource))
    }
    if (selectedInventory.material_id !== data.material_id || selectedInventory.material_id !== row.material_id) {
      throw new Error('Выбранный складской остаток не относится к материалу позиции заявки')
    }
    if ((data.material_variant_id ?? null) !== (selectedInventory.material_variant_id ?? null)) {
      throw new Error('Выбранная характеристика не соответствует складской строке')
    }
    if ((data.piece_length_mm ?? null) !== (selectedInventory.piece_length_mm ?? null)) {
      throw new Error('Выбранная длина складского куска не соответствует складской строке')
    }

    const selectedVariantId = selectedInventory.material_variant_id ?? null
    if (selectedVariantId) {
      const { data: selectedVariantData, error: selectedVariantError } = await db
        .from('material_variants')
        .select('*')
        .eq('id', selectedVariantId)
        .maybeSingle()
      if (selectedVariantError) throw new Error(selectedVariantError.message || 'Не удалось проверить характеристику складского остатка')
      if (!selectedVariantData) throw new Error('Характеристика складского остатка не найдена.')
      if (selectedVariantData && !variantMatchesRequest(data.request_item_table, row, selectedVariantData as MaterialVariant | null)) {
        throw new Error('Выбранный складской остаток не совпадает с характеристикой позиции заявки.')
      }
    } else if (requiresExactVariant(data.request_item_table, row)) {
      throw new Error('Выберите складской остаток с точной характеристикой материала.')
    }
    const needed = getNeededForRow(data.request_item_table, row)
    const reserved = getReservedForRow(data.request_item_table, row)
    const maxQuantity = Math.max(needed - reserved, 0)
    const quantity = Math.min(Number(data.quantity || 0), maxQuantity)
    if (quantity <= 0) throw new Error('ÐÐµÑ‡ÐµÐ³Ð¾ Ð±Ñ€Ð¾Ð½Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ')
    const available = getReservableQuantity(data.request_item_table, row, selectedInventory)
    if (available <= 0) throw new Error('В выбранной складской строке нет доступного остатка')
    if (quantity > available) throw new Error(`Недостаточно на выбранной складской строке. Доступно: ${available} ${selectedInventory.unit}`)

    const secondaryQuantity = data.request_item_table === 'request_round_tube'
      ? getRoundSecondaryReserve(quantity, row)
      : null

    const result = await reserveForMachine({
      inventory_id: selectedInventory.id,
      material_id: data.material_id,
      material_variant_id: selectedVariantId,
      piece_length_mm: selectedInventory.piece_length_mm ?? null,
      machine_id: request.machine_id,
      quantity,
      secondary_quantity: secondaryQuantity,
      use_cut_reservation: isCutReservationTable(data.request_item_table, row),
      request_item_table: data.request_item_table,
      request_item_id: data.request_item_id,
    })
    if (!result.success) throw new Error(result.error || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð±Ñ€Ð¾Ð½Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»')
    revalidateSupplyRequest(requestId, request.machine_id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð±Ñ€Ð¾Ð½Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ Ð¼Ð°Ñ‚ÐµÑ€Ð¸Ð°Ð»' }
  }
}

export async function unreserveItem(data: { request_item_table: RequestItemTable; request_item_id: string }) {
  try {
    const { db } = await requireAccess('manage')
    if (!REQUEST_TABLES.includes(data.request_item_table)) throw new Error('ÐÐµÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ð°Ñ Ñ‚Ð°Ð±Ð»Ð¸Ñ†Ð° Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸')
    const requestId = await getRequestIdForItem(db, data.request_item_table, data.request_item_id)
    const request = await getRequestMeta(db, requestId)
    const reservationSource = assertReservationAllowedForRequest(request)
    const reservationIds = await getReservationIdsForItem(
      db,
      data.request_item_table,
      data.request_item_id,
      reservationSource,
    )
    if (!reservationIds.length) return { success: true }

    for (const reservationId of reservationIds) {
      const result = await unreserveFromMachine(reservationId)
      if (!result.success) throw new Error(result.error || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ½ÑÑ‚ÑŒ Ð±Ñ€Ð¾Ð½ÑŒ')
    }
    revalidateSupplyRequest(requestId, request.machine_id)
    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ½ÑÑ‚ÑŒ Ð±Ñ€Ð¾Ð½ÑŒ' }
  }
}

export async function reserveAllAvailable(requestId: string) {
  try {
    await requireAccess('manage')
    const { data, error } = await getRequestForSupply(requestId)
    if (error || !data) throw new Error(error || 'Ð—Ð°ÑÐ²ÐºÐ° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')

    let reservedCount = 0
    let skippedCount = 0
    const machineId = data.request.machine_id
    const reserveRow = async (
      table: RequestItemTable,
      row: SupplyRequestRow<Record<string, unknown> & { id: string; material_id: string | null }>,
    ) => {
      if (!row.material_id || row.reservation_id) {
        skippedCount += 1
        return
      }
      const needed = getNeededForRow(table, row)
      const remaining = Math.max(needed - row.covered_quantity, 0)
      const reservableStockItems = row.stock_items.filter((item) => Number(item.available_quantity || 0) > 0)
      if (reservableStockItems.length !== 1) {
        skippedCount += 1
        return
      }
      const available = Number(row.available_stock || 0)
      const quantity = Math.min(remaining, available)
      if (quantity <= 0) {
        skippedCount += 1
        return
      }
      const result = await reserveItemFromStock({
        request_item_table: table,
        request_item_id: row.id,
        inventory_id: reservableStockItems[0].id,
        material_id: row.material_id,
        material_variant_id: reservableStockItems.length === 1
          ? reservableStockItems[0].material_variant_id
          : null,
        piece_length_mm: reservableStockItems.length === 1 ? reservableStockItems[0].piece_length_mm : null,
        machine_id: machineId,
        quantity,
      })
      if (result.success) reservedCount += 1
      else skippedCount += 1
    }

    for (const row of data.sections.sheetMetal) await reserveRow('request_sheet_metal', row)
    // @deprecated — round_tube excluded from new UI
    for (const row of data.sections.roundTube) await reserveRow('request_round_tube', row)
    for (const row of data.sections.circles) await reserveRow('request_circle', row)
    for (const row of data.sections.pipes) await reserveRow('request_pipe', row)
    for (const row of data.sections.knives) await reserveRow('request_knives', row)
    for (const row of data.sections.components) await reserveRow('request_components', row)
    for (const row of data.sections.paint) await reserveRow('request_paint', row)
    for (const row of data.sections.meshItems) await reserveRow('request_mesh', row)
    for (const row of data.sections.chainCords) await reserveRow('request_chain_cord', row)

    revalidateSupplyRequest(requestId, machineId)
    return { success: true, reserved_count: reservedCount, skipped_count: skippedCount }
  } catch (error) {
    return {
      success: false,
      reserved_count: 0,
      skipped_count: 0,
      error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð²Ñ‹Ð¿Ð¾Ð»Ð½Ð¸Ñ‚ÑŒ Ð¼Ð°ÑÑÐ¾Ð²Ð¾Ðµ Ð±Ñ€Ð¾Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ðµ',
    }
  }
}

export async function getSupplyRequestCards() {
  try {
    const { db, role } = await requireAccess()
    const statuses = role === 'supply_manager'
      ? ['submitted_to_supply']
      : ['pending_stock_check', 'stock_checked', 'submitted_to_supply']
    const { data: requestsData, error } = await db
      .from('technologist_requests')
      .select('id, machine_id, created_at, status')
      .in('status', statuses)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð·Ð°ÑÐ²ÐºÐ¸')

    const requests = (requestsData || []) as TechnologistRequest[]
    if (!requests.length) return { data: [], error: null }

    const machineIds = Array.from(new Set(requests.map((request) => request.machine_id)))
    const { data: machinesData, error: machinesError } = await db
      .from('machines')
      .select('id, name, is_archived')
      .in('id', machineIds)
      .eq('is_archived', false)
    if (machinesError) throw new Error(machinesError.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¼Ð°ÑˆÐ¸Ð½Ñ‹')
    const machineMap = new Map(((machinesData || []) as Pick<Machine, 'id' | 'name'>[]).map((machine) => [machine.id, machine.name]))

    const cards = []
    for (const request of requests) {
      const machineName = machineMap.get(request.machine_id)
      if (!machineName) continue

      const [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords] = await Promise.all([
        loadRows<RequestSheetMetal>(db, 'request_sheet_metal', request.id),
        // @deprecated — round_tube excluded from new UI
        loadRows<RequestRoundTube>(db, 'request_round_tube', request.id),
        loadRows<RequestCircle>(db, 'request_circle', request.id),
        loadRows<RequestPipe>(db, 'request_pipe', request.id),
        loadRows<RequestKnives>(db, 'request_knives', request.id),
        loadRows<RequestComponents>(db, 'request_components', request.id),
        loadRows<RequestPaint>(db, 'request_paint', request.id),
        loadRows<RequestMesh>(db, 'request_mesh', request.id),
        loadRows<RequestChainCord>(db, 'request_chain_cord', request.id),
      ])
      const rows: Array<{ table: RequestItemTable; row: Record<string, unknown> }> = [
        ...sheetMetal.map((row) => ({ table: 'request_sheet_metal' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        // @deprecated — round_tube excluded from new UI
        ...roundTube.map((row) => ({ table: 'request_round_tube' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        ...circles.map((row) => ({ table: 'request_circle' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        ...pipes.map((row) => ({ table: 'request_pipe' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        ...knives.map((row) => ({ table: 'request_knives' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        ...components.map((row) => ({ table: 'request_components' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        ...paint.map((row) => ({ table: 'request_paint' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        ...meshItems.map((row) => ({ table: 'request_mesh' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
        ...chainCords.map((row) => ({ table: 'request_chain_cord' as RequestItemTable, row: row as unknown as Record<string, unknown> })),
      ]
      if (rows.length === 0) continue

      const activeRows = rows.filter(({ table, row }) => isActiveSupplyRow(table, row))
      const positions = rows.length
      const reservedPositions = rows.filter(({ table, row }) => getReservedForRow(table, row) > 0).length
      const toOrderPositions = activeRows.length
      cards.push({
        id: request.id,
        machine_id: request.machine_id,
        machine_name: machineName,
        created_at: request.created_at,
        status: request.status,
        positions,
        reserved_positions: reservedPositions,
        to_order_positions: toOrderPositions,
      })
    }

    return { data: cards, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð·Ð°ÑÐ²ÐºÐ¸ ÑÐ½Ð°Ð±Ð¶ÐµÐ½Ð¸Ñ' }
  }
}
