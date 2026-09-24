'use server'

import { getDetailingCheckState } from '@/lib/server/detailing-request-check'
import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { reserveForMachine, unreserveFromMachine } from '@/lib/actions/inventory'
import {
  filterReservationsByStockScope,
} from '@/lib/inventory/reservation-stock-scope'
import { requireAnyPermission, requirePermission } from '@/lib/permissions/server'
import { hasPermission, type PermissionMap, type PermissionOperation } from '@/lib/permissions/resources'
import { knifeBevelCharacteristicLabel } from '@/lib/materials/knife-bevel'
import { formatKnifeProfileDimensions } from '@/lib/materials/knife-profile'
import { roundPipeOuterDiameterMm } from '@/lib/materials/pipe-profile'
import { sameRectangularDimensions } from '@/lib/materials/rotatable-dimensions'
import { sheetBusinessScrapMatchesRequest, sheetMetalVariantMatchesRequest } from '@/lib/supply-request-sheet-metal'
import { summarizeDisplayedStockCoverage } from '@/lib/supply-request-stock-coverage'
import { evaluateReservationCapability } from '@/lib/supply-request-access'
import {
  assertManualSupplyRequestReservationAllowed,
  getReservationStockSourceForStatus,
  isActiveWarehouseReservationStatus,
  isLayoutManagedSupplyRequestItem,
  type ReservationStockSource,
  type SupplyRequestItemTable,
} from '@/lib/supply-request-reservation-policy'
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
  MaterialVariant,
} from '@/lib/types'
import type { SupplyPositionRevisionSummary } from '@/lib/supply-orders/position-revisions'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  is: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  gt: (column: string, value: number) => LooseQuery
  range: (from: number, to: number) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  maybeSingle: () => Promise<DbResult>
  single: () => Promise<DbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
  rpc: (name: string, args?: Record<string, unknown>) => Promise<DbResult>
}

type RequestItemTable = SupplyRequestItemTable

type RequestWithRelations = TechnologistRequest & {
  machine: Pick<Machine, 'id' | 'name' | 'factory_id' | 'planned_material_date' | 'created_at' | 'is_archived'>
  technologist_name: string | null
}

export type SupplyRequestRow<T> = T & {
  materials?: { id: string; name: string } | null
  steel_type_name?: string | null
  available_stock: number | null
  available_secondary_stock?: number | null
  stock_unit: string | null
  secondary_stock_unit?: string | null
  stock_items: SupplyStockItem[]
  reservation_id: string | null
  reserved_quantity: number
  covered_quantity: number
  reserved_secondary_quantity: number | null
  layout_coverage: LayoutCoverage | null
}

export type LayoutCoverage = {
  request_item_table: RequestItemTable
  request_item_id: string
  plan_id: string
  plan_number: number
  version_id: string | null
  version_number: number | null
  status: 'approved' | 'needs_recalculation' | 'not_approved'
  warehouse_mm: number
  business_scrap_mm: number
  purchase_covered_mm: number
  purchase_total_mm: number
  purchase_bars: Array<{ length_mm: number; quantity: number }>
  source_factories: string[]
  warehouse_factories: string[]
  business_scrap_factories: string[]
}

export type SupplyStockItem = {
  id: string
  factory_id: string
  factory_name: string
  is_local_factory: boolean
  material_variant_id: string | null
  piece_length_mm: number | null
  is_business_scrap: boolean
  is_legacy_bar_stock: boolean
  label: string | null
  material_name: string | null
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
  can_reserve: boolean
  can_unreserve: boolean
  can_complete_reservation: boolean
  completion_block_reason?: string | null
  reservation_block_reason: string | null
  can_manage_detailing: boolean
  request: RequestWithRelations
  positionRevision?: SupplyPositionRevisionSummary | null
  factories: Array<{
    id: string
    name: string
    is_destination: boolean
    available_position_count: number
  }>
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
  material_name?: string | null
  factory_name?: string
  is_local_factory?: boolean
}

type ReservationRow = {
  id: string | null
  inventory_id: string | null
  source_inventory_id: string | null
  request_item_table: string
  request_item_id: string
  reserved_quantity: number
  logical_reserved_quantity?: number | null
  reserved_secondary_quantity: number | null
  consumed_at: string | null
  reservation_source?: string | null
}

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
  const permission = await requirePermission('supply', operation)
  return { ...permission, db: permission.supabase as unknown as LooseDb }
}

async function requireReservationAccess() {
  const permission = await requireAnyPermission([
    { resourceKey: 'supply', operation: 'manage' },
    { resourceKey: 'technologist_requests', operation: 'manage' },
    { resourceKey: 'business_scrap_reservations', operation: 'manage' },
  ])
  if (!hasPermission(permission.permissions, 'inventory', 'manage')) {
    throw new Error('Для бронирования требуется право управления складом')
  }
  return { ...permission, db: permission.supabase as unknown as LooseDb }
}

function assertReservationWorkflowPermission(
  permissions: PermissionMap,
  source: ReservationStockSource,
) {
  const allowed = hasPermission(permissions, 'supply', 'manage')
    || hasPermission(permissions, 'technologist_requests', 'manage')
    || (source === 'business_scrap' && hasPermission(permissions, 'business_scrap_reservations', 'manage'))
  if (!allowed) {
    throw new Error(
      source === 'business_scrap'
        ? 'Нет права бронировать деловой остаток'
        : 'Нет права управлять складским этапом заявки технолога',
    )
  }
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
  if (table === 'request_sheet_metal') return asNumber(row.reserved_from_stock_kg)
  if (row.reserved_quantity !== undefined && row.reserved_quantity !== null) return asNumber(row.reserved_quantity)
  if (table === 'request_pipe' && row.pipe_type === 'wire') return asNumber(row.reserved_from_stock_kg)
  if (table === 'request_chain_cord') return asNumber(row[getTableRequestField(table)]) * 1000
  return asNumber(row[getTableRequestField(table)])
}

function isActiveSupplyRow(table: RequestItemTable, row: Record<string, unknown>) {
  if (row.order_status === 'delivered' || row.order_status === 'cancelled') return false
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

function requiresExactVariant(table: RequestItemTable) {
  return table === 'request_sheet_metal'
    || table === 'request_circle'
    || table === 'request_pipe'
    || table === 'request_knives'
    || table === 'request_round_tube'
}

function isWholeBarRequest(table: RequestItemTable, row: Record<string, unknown>) {
  return table === 'request_knives'
    || table === 'request_circle'
    || (table === 'request_pipe' && row.pipe_type !== 'wire')
}

function usesWholeBarStock(table: RequestItemTable, row: Record<string, unknown>, item: InventoryRow) {
  return isWholeBarRequest(table, row) && Number(item.piece_length_mm || 0) > 0
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

function exactTextMatches(left: unknown, right: unknown) {
  return normalizeText(left) === normalizeText(right)
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
  if (row.pipe_type === 'round') {
    const requestDiameter = roundPipeOuterDiameterMm(row)
    const variantDiameter = roundPipeOuterDiameterMm(variant)
    return requestDiameter !== null && variantDiameter !== null && numbersMatch(requestDiameter, variantDiameter)
  }
  return true
}

function knifeDimensionMatches(row: Record<string, unknown>, variant: MaterialVariant) {
  const variantTextDimensions = dimensionParts(variant.knife_dimensions)
  const legacyWidth = variantTextDimensions.length >= 3 ? variantTextDimensions[1] : variantTextDimensions[0]
  const legacyHeight = variantTextDimensions.length >= 3 ? variantTextDimensions[2] : variantTextDimensions[1]
  return numbersMatch(row.width_mm, variant.width_mm ?? legacyWidth)
    && numbersMatch(row.height_mm, variant.height_mm ?? legacyHeight)
}

function variantMatchesRequest(table: RequestItemTable, row: Record<string, unknown>, variant?: MaterialVariant | null) {
  if (!variant) return false
  if (table === 'request_sheet_metal') {
    return sheetMetalVariantMatchesRequest(row, variant)
  }
  if (table === 'request_pipe') {
    const sameBaseProfile = exactTextMatches(row.pipe_type, variant.pipe_type)
      && numbersMatch(row.wall_thickness_mm, variant.wall_thickness_mm)
      && exactTextMatches(row.steel_type_id, variant.steel_type_id)
    if (row.pipe_type === 'round') return sameBaseProfile && pipeDiameterMatches(row, variant)
    return sameBaseProfile
      && (row.pipe_type === 'square' || row.pipe_type === 'rectangular'
        ? sameRectangularDimensions(row.size, variant.piece_description)
        : exactTextMatches(row.size, variant.piece_description))
      && pipeDiameterMatches(row, variant)
  }
  if (table === 'request_knives') {
    return knifeDimensionMatches(row, variant)
      && optionalTextMatches(row.steel_type_id, variant.steel_type_id)
      && optionalTextMatches(row.steel_grade, variant.material_grade ?? variant.knife_material)
      && numbersMatch(row.knife_bevel_count, variant.knife_bevel_count)
  }
  if (table === 'request_circle') {
    return numbersMatch(row.diameter_mm, variant.diameter_mm)
      && exactTextMatches(row.steel_type_id, variant.steel_type_id)
      && exactTextMatches(row.steel_grade, variant.material_grade)
      && Boolean(row.is_calibrated) === Boolean(variant.is_calibrated)
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
  if (usesWholeBarStock(table, row, item)) {
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

function getReservationStockSource(request: Pick<TechnologistRequest, 'status'>): ReservationStockSource | null {
  return getReservationStockSourceForStatus(request.status)
}

function assertReservationAllowedForRequest(request: Pick<TechnologistRequest, 'status'>) {
  const source = getReservationStockSource(request)
  if (!source || !isActiveWarehouseReservationStatus(request.status)) {
    throw new Error('Бронирование доступно только на активном складском этапе заявки')
  }
  return source
}

function inventoryMatchesReservationSource(item: Pick<InventoryRow, 'is_business_scrap'>, source: ReservationStockSource) {
  return source === 'business_scrap'
    ? Boolean(item.is_business_scrap)
    : !Boolean(item.is_business_scrap)
}

function getReservationSourceError(source: ReservationStockSource) {
  return source === 'business_scrap'
    ? 'На этом этапе можно бронировать только деловой остаток'
    : 'На этом этапе можно бронировать только обычный склад'
}

function describeStockItem(table: RequestItemTable, variant?: MaterialVariant | null) {
  if (!variant) return null
  const parts: string[] = []
  if (table === 'request_sheet_metal') {
    if (variant.sheet_size) parts.push(String(variant.sheet_size))
    if (variant.thickness_mm) parts.push(`${variant.thickness_mm} мм`)
  } else if (table === 'request_pipe') {
    if (variant.pipe_type) parts.push(String(variant.pipe_type))
    if (variant.piece_description) parts.push(String(variant.piece_description))
    if (variant.wall_thickness_mm) parts.push(`стенка ${variant.wall_thickness_mm} мм`)
    if (variant.diameter_mm) parts.push(`диаметр ${variant.diameter_mm} мм`)
  } else if (table === 'request_knives') {
    const profile = formatKnifeProfileDimensions(variant, 'x')
    if (profile) parts.push(profile)
    if (variant.material_grade) parts.push(String(variant.material_grade))
    parts.push(`скос: ${knifeBevelCharacteristicLabel(variant.knife_bevel_count)}`)
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
  sheetScrapRows: InventoryRow[],
  reservationSource: ReservationStockSource,
) {
  if (table === 'request_sheet_metal' && reservationSource === 'business_scrap') {
    return sheetScrapRows.filter((item) => item.variant && sheetBusinessScrapMatchesRequest(rowRecord, item.variant))
  }
  if (!row.material_id) return []

  const exactItems = row.material_variant_id
    ? inventoryGroupMap.get(stockGroupKey(row.material_id, row.material_variant_id)) || []
    : []
  const matchingExactItems = ['request_sheet_metal', 'request_circle', 'request_pipe', 'request_knives'].includes(table)
    ? exactItems.filter((item) => variantMatchesRequest(table, rowRecord, item.variant))
    : exactItems

  const allMaterialItems = materialInventoryMap.get(row.material_id) || []
  const matchedByCharacteristics = allMaterialItems.filter((item) => {
    if (!item.material_variant_id) return false
    return variantMatchesRequest(table, rowRecord, item.variant)
  })
  if (requiresExactVariant(table)) {
    const matchingItems = uniqueInventoryRows([
      ...matchingExactItems,
      ...matchedByCharacteristics,
    ])
    if (hasAvailableStock(table, rowRecord, matchingItems)) return matchingItems
    return matchingItems
  }

  if (hasAvailableStock(table, rowRecord, matchingExactItems)) return matchingExactItems
  if (hasAvailableStock(table, rowRecord, matchedByCharacteristics)) return matchedByCharacteristics

  const legacyItems = inventoryGroupMap.get(stockGroupKey(row.material_id, null)) || []
  if (hasAvailableStock(table, rowRecord, legacyItems)) return legacyItems
  return matchingExactItems.length ? matchingExactItems : legacyItems.length ? legacyItems : matchedByCharacteristics
}

async function loadRows<T>(db: LooseDb, table: RequestItemTable, requestId: string) {
  let query = db.from(table).select('*, materials(id, name)').eq('request_id', requestId)
  if (table === 'request_circle' || table === 'request_pipe' || table === 'request_knives') {
    query = query.eq('is_cutting_plan_draft', false)
  }
  const { data, error } = await query.order('sort_order', { ascending: true })
  if (error) throw new Error(error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸ Ð·Ð°ÑÐ²ÐºÐ¸')
  return (data || []) as T[]
}

async function loadSheetBusinessScrapRows(db: LooseDb, requests: RequestSheetMetal[]): Promise<InventoryRow[]> {
  const steelTypeIds = [...new Set(requests.map((row) => row.steel_type_id).filter((id): id is string => Boolean(id)))]
  const thicknesses = [...new Set(requests.map((row) => Number(row.thickness_mm)).filter((value) => Number.isFinite(value) && value > 0))]
  if (!steelTypeIds.length || !thicknesses.length) return []

  const variants: MaterialVariant[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from('material_variants').select('*')
      .eq('category', 'sheet_metal').in('steel_type_id', steelTypeIds).in('thickness_mm', thicknesses)
      .order('id').range(offset, offset + 499)
    if (error) throw new Error(error.message || 'Не удалось загрузить характеристики листовых остатков')
    const page = (data || []) as MaterialVariant[]
    variants.push(...page)
    if (page.length < 500) break
  }
  const matchingVariants = variants.filter((variant) => requests.some((row) => sheetBusinessScrapMatchesRequest(row, variant)))
  if (!matchingVariants.length) return []
  const variantsById = new Map(matchingVariants.map((variant) => [variant.id, variant]))

  const rows: InventoryRow[] = []
  const ids = [...variantsById.keys()]
  for (let start = 0; start < ids.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from('inventory')
        .select('id, factory_id, material_id, material_variant_id, total_quantity, available_quantity, unit, total_secondary_quantity, available_secondary_quantity, secondary_unit, piece_length_mm, is_business_scrap, business_scrap_state, deleted_at')
        .in('material_variant_id', ids.slice(start, start + 100))
        .eq('is_business_scrap', true).eq('unit', 'шт')
        .is('deleted_at', null).gt('available_quantity', 0)
        .order('id').range(offset, offset + 499)
      if (error) throw new Error(error.message || 'Не удалось загрузить листовой деловой остаток')
      const page = (data || []) as InventoryRow[]
      rows.push(...page.filter((row) => (row.business_scrap_state || 'available') === 'available'
        && Math.floor(Number(row.available_quantity || 0)) > 0))
      if (page.length < 500) break
    }
  }
  const materialIds = [...new Set(rows.map((row) => row.material_id))]
  const materialNames = new Map<string, string>()
  for (let start = 0; start < materialIds.length; start += 100) {
    const { data, error } = await db.from('materials').select('id, name').in('id', materialIds.slice(start, start + 100))
    if (error) throw new Error(error.message || 'Не удалось загрузить названия листовых материалов')
    for (const item of (data || []) as Array<{ id: string; name: string }>) materialNames.set(item.id, item.name)
  }
  for (const row of rows) {
    row.variant = row.material_variant_id ? variantsById.get(row.material_variant_id) || null : null
    row.material_name = materialNames.get(row.material_id) || null
  }
  return rows
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

function assertSupplyRequestVisibleForPermissions(request: TechnologistRequest, permissions: PermissionMap) {
  const visibleStatuses = ['pending_stock_check', 'stock_checked', 'submitted_to_supply', 'completed']
  if (!visibleStatuses.includes(request.status)) {
    throw new Error('Заявка ещё не передана на проверку склада')
  }
  const isSupplyOnly = hasPermission(permissions, 'supply_material_requests', 'view')
    && !hasPermission(permissions, 'technologist_requests', 'manage')
  if (isSupplyOnly && request.status !== 'submitted_to_supply' && request.status !== 'completed') {
    throw new Error('Заявка ещё не передана в снабжение')
  }
}

async function assertActiveReservationActor(
  db: LooseDb,
  request: RequestWithRelations,
  userId: string,
  isAdminPosition: boolean,
) {
  if (!isActiveWarehouseReservationStatus(request.status)) {
    throw new Error('Эта заявка доступна только для ознакомления')
  }
  if (request.created_by === userId || isAdminPosition) return

  const { data, error } = await db
    .from('tasks')
    .select('id')
    .eq('machine_id', request.machine_id)
    .eq('task_type', 'technologist_request')
    .eq('assigned_to', userId)
    .in('status', ['pending', 'in_progress', 'completed'])
    .limit(1)
  if (error) throw new Error(error.message || 'Не удалось проверить назначенного технолога')
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Бронировать склад может автор, назначенный технолог или руководитель')
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
      map.set(key, {
        ...row,
        id: row.consumed_at ? null : row.id,
        reserved_quantity: Number(row.logical_reserved_quantity ?? row.reserved_quantity ?? 0),
      })
      continue
    }
    if (!current.id && !row.consumed_at) current.id = row.id
    current.reserved_quantity = Number(current.reserved_quantity || 0)
      + Number(row.logical_reserved_quantity ?? row.reserved_quantity ?? 0)
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
  layoutCoverageMap: Map<string, LayoutCoverage>,
  sheetScrapRows: InventoryRow[] = [],
) {
  return rows.map((row) => {
    const rowRecord = row as Record<string, unknown>
    const stockItems = findStockItems(table, row, rowRecord, inventoryGroupMap, materialInventoryMap, sheetScrapRows, reservationSource)
      .filter((item) => inventoryMatchesReservationSource(item, reservationSource))
    const exactVariantRequired = requiresExactVariant(table)
    const inventory = row.material_id
      ? exactVariantRequired
        ? stockItems[0] || null
        : inventoryMap.get(stockKey(row.material_id, row.material_variant_id, null)) ||
          inventoryMap.get(stockKey(row.material_id, null, null)) ||
          stockItems[0] ||
          null
      : null
    const reservation = reservationMap.get(reservationKey(table, row.id))
    const coveredQuantity = getReservedForRow(table, rowRecord)
    const availableStock = stockItems.length
      ? stockItems.reduce((sum, item) => sum + getReservableQuantity(table, rowRecord, item), 0)
      : exactVariantRequired ? 0 : inventory?.available_quantity ?? null
    const availableSecondaryStock = stockItems.length
      ? stockItems.reduce((sum, item) => sum + Number(item.available_secondary_quantity || 0), 0)
      : inventory?.available_secondary_quantity ?? null
    return {
      ...row,
      steel_type_name: typeof rowRecord.steel_type_id === 'string' ? steelTypeMap.get(rowRecord.steel_type_id) || null : null,
      available_stock: availableStock,
      available_secondary_stock: availableSecondaryStock,
      stock_unit: inventory?.unit ?? null,
      secondary_stock_unit: inventory?.secondary_unit ?? null,
      stock_items: stockItems.map((item) => ({
        id: item.id || stockKey(item.material_id, item.material_variant_id, item.piece_length_mm),
        factory_id: item.factory_id,
        factory_name: item.factory_name || 'Неизвестный завод',
        is_local_factory: Boolean(item.is_local_factory),
        material_variant_id: item.material_variant_id,
        piece_length_mm: item.piece_length_mm,
        is_business_scrap: Boolean(item.is_business_scrap),
        is_legacy_bar_stock: isWholeBarRequest(table, rowRecord) && !Number(item.piece_length_mm || 0),
        label: describeStockItem(table, item.variant),
        material_name: item.material_name || null,
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
      layout_coverage: layoutCoverageMap.get(reservationKey(table, row.id)) || null,
    }
  })
}

function summarize(rows: Array<Record<string, unknown>>, table: RequestItemTable, unit?: string): SupplyRequestSectionSummary {
  const needed = rows.reduce((sum, row) => sum + getNeededForRow(table, row), 0)
  const coverage = summarizeDisplayedStockCoverage(needed, rows.map((row) => ({
    reservedQuantity: getReservedForRow(table, row),
    coveredQuantity: row.covered_quantity,
  })))
  return {
    positions: rows.length,
    needed,
    reserved: coverage.reserved,
    toOrder: coverage.toOrder,
    unit,
  }
}

function summarizeComponents(rows: RequestComponents[]): SupplyRequestSectionSummary {
  const needed = rows.reduce((sum, row) => sum + getNeededForRow('request_components', row as unknown as Record<string, unknown>), 0)
  const coverage = summarizeDisplayedStockCoverage(needed, rows.map((row) => {
    const rowRecord = row as unknown as Record<string, unknown>
    return {
      reservedQuantity: getReservedForRow('request_components', rowRecord),
      coveredQuantity: rowRecord.covered_quantity,
    }
  }))
  return {
    positions: rows.length,
    needed,
    reserved: coverage.reserved,
    toOrder: coverage.toOrder,
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
  permissions: PermissionMap,
  requestId: string,
  stockSourceOverride?: ReservationStockSource,
): Promise<{ data: SupplyRequestPayload | null; error: string | null }> {
  try {
    const request = await getRequestMeta(db, requestId)
    assertSupplyRequestVisibleForPermissions(request, permissions)
    const [sheetMetal, roundTube, circles, pipes, knives, components, paint, meshItems, chainCords, revision] = await Promise.all([
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
      db.from('supply_position_revisions')
        .select('id, source_request_item_table, source_request_item_id, category, status, reason, department_request_id, replacement_request_id, replacement_request_item_id')
        .eq('replacement_request_id', requestId),
    ])

    if (revision.error) throw new Error(revision.error.message || 'Не удалось загрузить сведения о возврате позиции')

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
      ...sheetMetal.map((row) => row.steel_type_id).filter(Boolean),
      ...circles.map((row) => row.steel_type_id).filter(Boolean),
      ...pipes.map((row) => row.steel_type_id).filter(Boolean),
      ...knives.map((row) => row.steel_type_id).filter(Boolean),
    ])) as string[]

    const reservationSource = stockSourceOverride || getReservationStockSource(request)
    if (!reservationSource) throw new Error('Заявка не находится на складском этапе')

    const [inventoryRes, reservationsRes, steelTypesRes, factoriesRes, layoutCoverageRes, sheetScrapRows] = await Promise.all([
      materialIds.length && request.machine.factory_id
        ? db.from('inventory').select('id, factory_id, material_id, material_variant_id, total_quantity, available_quantity, unit, total_secondary_quantity, available_secondary_quantity, secondary_unit, piece_length_mm, is_business_scrap, business_scrap_state, deleted_at').in('material_id', materialIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
      itemIds.length
        ? db.from('inventory_reservations').select('id, inventory_id, source_inventory_id, request_item_table, request_item_id, reserved_quantity, logical_reserved_quantity, reserved_secondary_quantity, consumed_at, reservation_source').in('request_item_id', itemIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
      steelTypeIds.length
        ? db.from('steel_types').select('id, name').in('id', steelTypeIds)
        : Promise.resolve({ data: [], error: null } as DbResult),
      db.from('factories').select('id, name').order('name', { ascending: true }),
      db.rpc('crm_supply_request_layout_coverage', { p_request_id: requestId }),
      reservationSource === 'business_scrap' ? loadSheetBusinessScrapRows(db, sheetMetal) : Promise.resolve([] as InventoryRow[]),
    ])
    if (inventoryRes.error) throw new Error(inventoryRes.error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¾ÑÑ‚Ð°Ñ‚ÐºÐ¸')
    if (reservationsRes.error) throw new Error(reservationsRes.error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð±Ñ€Ð¾Ð½Ð¸Ñ€Ð¾Ð²Ð°Ð½Ð¸Ñ')
    if (steelTypesRes.error) throw new Error(steelTypesRes.error.message || 'Не удалось загрузить типы стали')
    if (factoriesRes.error) throw new Error(factoriesRes.error.message || 'Не удалось загрузить заводы складских остатков')
    if (layoutCoverageRes.error) throw new Error(layoutCoverageRes.error.message || 'Не удалось загрузить обеспечение по раскладке')
    const steelTypeMap = new Map(((steelTypesRes.data || []) as { id: string; name: string }[]).map((steelType) => [steelType.id, steelType.name]))
    const factoryMap = new Map(((factoriesRes.data || []) as { id: string; name: string }[]).map((factory) => [factory.id, factory.name]))
    const layoutCoverageMap = new Map(
      ((layoutCoverageRes.data || []) as LayoutCoverage[]).map((coverage) => [
        reservationKey(coverage.request_item_table, coverage.request_item_id),
        coverage,
      ]),
    )

    const allInventoryRows = [...new Map([
      ...((inventoryRes.data || []) as InventoryRow[]),
      ...sheetScrapRows,
    ].map((row) => [row.id, row])).values()]
    const inventoryRows = allInventoryRows.filter((row) => !row.deleted_at && (row.business_scrap_state || 'available') !== 'future')
    for (const row of inventoryRows) {
      row.factory_name = factoryMap.get(row.factory_id) || 'Неизвестный завод'
      row.is_local_factory = row.factory_id === request.machine.factory_id
    }
    const inventoryVariantIds = Array.from(new Set(inventoryRows.map((row) => row.material_variant_id).filter(Boolean))) as string[]
    const variantMap = new Map<string, MaterialVariant>(sheetScrapRows.flatMap((row) =>
      row.material_variant_id && row.variant ? [[row.material_variant_id, row.variant] as const] : []))
    const missingVariantIds = inventoryVariantIds.filter((id) => !variantMap.has(id))
    for (let start = 0; start < missingVariantIds.length; start += 100) {
      const { data: variantsData, error: variantsError } = await db
        .from('material_variants').select('*').in('id', missingVariantIds.slice(start, start + 100))
      if (variantsError) throw new Error(variantsError.message || 'Не удалось загрузить характеристики складских остатков')
      for (const variant of (variantsData || []) as MaterialVariant[]) variantMap.set(variant.id, variant)
    }
    for (const row of inventoryRows) row.variant = row.material_variant_id ? variantMap.get(row.material_variant_id) || null : null
    const visibleInventoryRows = inventoryRows
      .filter((row) => inventoryMatchesReservationSource(row, reservationSource))
      .sort((a, b) => Number(Boolean(b.is_local_factory)) - Number(Boolean(a.is_local_factory)))
    const inventoryMap = new Map(visibleInventoryRows.map((row) => [stockKey(row.material_id, row.material_variant_id, row.piece_length_mm), row]))
    const inventoryGroupMap = new Map<string, InventoryRow[]>()
    const materialInventoryMap = new Map<string, InventoryRow[]>()
    for (const row of visibleInventoryRows) {
      const groupKey = stockGroupKey(row.material_id, row.material_variant_id)
      inventoryGroupMap.set(groupKey, [...(inventoryGroupMap.get(groupKey) || []), row])
      materialInventoryMap.set(row.material_id, [...(materialInventoryMap.get(row.material_id) || []), row])
    }
    for (const rows of inventoryGroupMap.values()) {
      rows.sort((a, b) => Number(Boolean(b.is_local_factory)) - Number(Boolean(a.is_local_factory)) || Number(Boolean(b.is_business_scrap)) - Number(Boolean(a.is_business_scrap)) || Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
    }
    for (const rows of materialInventoryMap.values()) {
      rows.sort((a, b) => Number(Boolean(b.is_local_factory)) - Number(Boolean(a.is_local_factory)) || Number(Boolean(b.is_business_scrap)) - Number(Boolean(a.is_business_scrap)) || Number(a.piece_length_mm ?? 0) - Number(b.piece_length_mm ?? 0))
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
      sheetMetal: withStock('request_sheet_metal', sheetMetal, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap, sheetScrapRows),
      // @deprecated — round_tube excluded from new UI
      roundTube: withStock('request_round_tube', roundTube, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
      circles: withStock('request_circle', circles.filter((row) => row.order_status !== 'cancelled'), inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
      pipes: withStock('request_pipe', pipes.filter((row) => row.order_status !== 'cancelled'), inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
      knives: withStock('request_knives', knives.filter((row) => row.order_status !== 'cancelled'), inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
      components: withStock('request_components', components, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
      paint: withStock('request_paint', paint, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
      meshItems: withStock('request_mesh', meshItems, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
      chainCords: withStock('request_chain_cord', chainCords, inventoryMap, inventoryGroupMap, materialInventoryMap, reservationMap, steelTypeMap, reservationSource, layoutCoverageMap),
    }

    const sectionRows = Object.values(sections).flat() as Array<SupplyRequestRow<Record<string, unknown>>>
    const factories = ((factoriesRes.data || []) as { id: string; name: string }[]).map((factory) => ({
      id: factory.id,
      name: factory.name,
      is_destination: factory.id === request.machine.factory_id,
      available_position_count: sectionRows.filter((row) => row.stock_items.some(
        (item) => item.factory_id === factory.id && Number(item.available_quantity || 0) > 0,
      )).length,
    }))

    return {
      data: {
        can_reserve: hasPermission(permissions, 'supply', 'manage'),
        can_unreserve: hasPermission(permissions, 'supply', 'manage'),
        can_complete_reservation: hasPermission(permissions, 'technologist_requests', 'manage'),
        reservation_block_reason: null,
        can_manage_detailing: hasPermission(permissions, 'inventory_detailing', 'manage'),
        request,
        positionRevision: ((revision.data || []) as SupplyPositionRevisionSummary[])[0] || null,
        factories,
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
    const permission = await requireAnyPermission([
      { resourceKey: 'supply', operation: 'view' },
      { resourceKey: 'technologist_requests', operation: 'view' },
    ])
    const { userId, permissions, permissionDetails, factoryId } = permission
    const db = permission.supabase as unknown as LooseDb
    const request = await getRequestMeta(db, requestId)
    if (!['submitted_to_supply', 'completed'].includes(request.status)) {
      await assertActiveReservationActor(db, request, userId, permissionDetails.isAdminPosition)
    }
    const result = await loadRequestForStockSource(db, permissions, requestId)
    if (!result.data) return result
    const canUseWorkflow = hasPermission(permissions, 'supply', 'manage')
      || hasPermission(permissions, 'technologist_requests', 'manage')
    const reservationCapability = evaluateReservationCapability({
      hasWorkflowPermission: canUseWorkflow,
      hasInventoryManage: hasPermission(permissions, 'inventory', 'manage'),
      isAdmin: permissionDetails.isAdminPosition,
      inventoryFactoryScope: permissionDetails.factoryScopes.inventory?.manage || 'own',
      userFactoryId: factoryId,
      targetFactoryId: request.machine.factory_id,
      workflowDeniedReason: 'Нет права управлять заявкой технолога или снабжением',
    })
    result.data.can_reserve = reservationCapability.allowed
    result.data.can_unreserve = reservationCapability.allowed
    result.data.can_complete_reservation = reservationCapability.allowed
    result.data.reservation_block_reason = reservationCapability.reason
    if (['pending_stock_check', 'stock_checked'].includes(request.status)) {
      const detailingCheck = await getDetailingCheckState(requestId)
      result.data.completion_block_reason = reservationCapability.reason || (detailingCheck.ready ? null : detailingCheck.message)
      result.data.can_complete_reservation = reservationCapability.allowed && detailingCheck.ready
    }
    return result
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить заявку' }
  }
}

export async function getRequestForBusinessScrap(requestId: string): Promise<{ data: SupplyRequestPayload | null; error: string | null }> {
  try {
    const permission = await requirePermission('business_scrap_reservations', 'view')
    const { supabase, userId, permissions, permissionDetails, factoryId } = permission
    const db = supabase as unknown as LooseDb
    const request = await getRequestMeta(db, requestId)
    if (!permissionDetails.isAdminPosition) {
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
    const result = await loadRequestForStockSource(db, permissions, requestId, 'business_scrap')
    if (!result.data) return result
    const canUseWorkflow = hasPermission(permissions, 'supply', 'manage')
      || hasPermission(permissions, 'technologist_requests', 'manage')
      || hasPermission(permissions, 'business_scrap_reservations', 'manage')
    const reservationCapability = evaluateReservationCapability({
      hasWorkflowPermission: canUseWorkflow,
      hasInventoryManage: hasPermission(permissions, 'inventory', 'manage'),
      isAdmin: permissionDetails.isAdminPosition,
      inventoryFactoryScope: permissionDetails.factoryScopes.inventory?.manage || 'own',
      userFactoryId: factoryId,
      targetFactoryId: request.machine.factory_id,
      workflowDeniedReason: 'Нет права бронировать деловой остаток или управлять заявкой технолога',
    })
    result.data.can_reserve = reservationCapability.allowed
    result.data.can_unreserve = reservationCapability.allowed
    result.data.can_complete_reservation = reservationCapability.allowed
    result.data.reservation_block_reason = reservationCapability.reason
    if (['pending_stock_check', 'stock_checked'].includes(request.status)) {
      const detailingCheck = await getDetailingCheckState(requestId)
      result.data.completion_block_reason = reservationCapability.reason || (detailingCheck.ready ? null : detailingCheck.message)
      result.data.can_complete_reservation = reservationCapability.allowed && detailingCheck.ready
    }
    return result
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Не удалось загрузить деловой остаток' }
  }
}

export async function reserveItemFromStock(data: {
  request_item_table: RequestItemTable
  request_item_id: string
  inventory_id: string
  factory_id: string
  material_id: string
  material_variant_id?: string | null
  piece_length_mm?: number | null
  machine_id: string
  quantity: number
}) {
  try {
    const { db, userId, permissionDetails, permissions } = await requireReservationAccess()
    if (!REQUEST_TABLES.includes(data.request_item_table)) throw new Error('ÐÐµÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ð°Ñ Ñ‚Ð°Ð±Ð»Ð¸Ñ†Ð° Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸')
    const requestId = await getRequestIdForItem(db, data.request_item_table, data.request_item_id)
    const request = await getRequestMeta(db, requestId)
    await assertActiveReservationActor(db, request, userId, permissionDetails.isAdminPosition)
    const reservationSource = assertReservationAllowedForRequest(request)
    assertReservationWorkflowPermission(permissions, reservationSource)
    const { data: rowData, error } = await db.from(data.request_item_table).select('*').eq('id', data.request_item_id).single()
    if (error || !rowData) throw new Error(error?.message || 'ÐŸÐ¾Ð·Ð¸Ñ†Ð¸Ñ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')

    const row = rowData as Record<string, unknown>
    assertManualSupplyRequestReservationAllowed(data.request_item_table, row)
    if (row.order_status === 'cancelled') {
      throw new Error('Отменённую позицию нельзя резервировать')
    }
    const { data: selectedInventoryData, error: selectedInventoryError } = await db
      .from('inventory')
      .select('id, factory_id, material_id, material_variant_id, total_quantity, available_quantity, unit, total_secondary_quantity, available_secondary_quantity, secondary_unit, piece_length_mm, is_business_scrap, business_scrap_state, deleted_at')
      .eq('id', data.inventory_id)
      .maybeSingle()
    if (selectedInventoryError) throw new Error(selectedInventoryError.message || 'Не удалось проверить выбранный складской остаток')
    const selectedInventory = selectedInventoryData as InventoryRow | null
    if (!selectedInventory?.id || selectedInventory.deleted_at) throw new Error('Выбранный складской остаток не найден')
    if (selectedInventory.factory_id !== data.factory_id) throw new Error('Завод складского остатка не совпадает с выбранным заводом')
    if (!request.machine.factory_id) throw new Error('Для машины не определён завод назначения')
    const requiresInventoryTransfer = selectedInventory.factory_id !== request.machine.factory_id
    if (selectedInventory.is_business_scrap && (selectedInventory.business_scrap_state || 'available') !== 'available') {
      throw new Error('Этот деловой остаток недоступен для бронирования')
    }
    if (!inventoryMatchesReservationSource(selectedInventory, reservationSource)) {
      throw new Error(getReservationSourceError(reservationSource))
    }
    if (data.material_id !== row.material_id) throw new Error('Материал позиции заявки изменился')
    if ((data.material_variant_id ?? null) !== (selectedInventory.material_variant_id ?? null)) {
      throw new Error('Выбранная характеристика не соответствует складской строке')
    }
    if ((data.piece_length_mm ?? null) !== (selectedInventory.piece_length_mm ?? null)) {
      throw new Error('Выбранная длина складского куска не соответствует складской строке')
    }

    const selectedVariantId = selectedInventory.material_variant_id ?? null
    const isSheetBusinessScrap = data.request_item_table === 'request_sheet_metal'
      && reservationSource === 'business_scrap'
      && Boolean(selectedInventory.is_business_scrap)
    if (!isSheetBusinessScrap && selectedInventory.material_id !== row.material_id) {
      throw new Error('Выбранный складской остаток не относится к материалу позиции заявки')
    }
    if (selectedVariantId) {
      const { data: selectedVariantData, error: selectedVariantError } = await db
        .from('material_variants')
        .select('*')
        .eq('id', selectedVariantId)
        .maybeSingle()
      if (selectedVariantError) throw new Error(selectedVariantError.message || 'Не удалось проверить характеристику складского остатка')
      if (!selectedVariantData) throw new Error('Характеристика складского остатка не найдена.')
      const selectedVariant = selectedVariantData as MaterialVariant
      if (selectedVariant.material_id !== selectedInventory.material_id) {
        throw new Error('Материал складского остатка не совпадает с его характеристикой')
      }
      const matches = isSheetBusinessScrap
        ? sheetBusinessScrapMatchesRequest(row, selectedVariant)
        : selectedInventory.material_id === row.material_id
          && variantMatchesRequest(data.request_item_table, row, selectedVariant)
      if (!matches) {
        throw new Error('Выбранный складской остаток не совпадает с характеристикой позиции заявки.')
      }
    } else if (
      requiresExactVariant(data.request_item_table)
      && !(isWholeBarRequest(data.request_item_table, row) && !Number(selectedInventory.piece_length_mm || 0))
    ) {
      throw new Error('Выберите складской остаток с точной характеристикой материала.')
    }
    const needed = getNeededForRow(data.request_item_table, row)
    const reserved = getReservedForRow(data.request_item_table, row)
    const maxQuantity = isSheetBusinessScrap ? Number(selectedInventory.available_quantity || 0) : Math.max(needed - reserved, 0)
    const quantity = isSheetBusinessScrap ? Number(data.quantity || 0) : Math.min(Number(data.quantity || 0), maxQuantity)
    if (quantity <= 0) throw new Error('ÐÐµÑ‡ÐµÐ³Ð¾ Ð±Ñ€Ð¾Ð½Ð¸Ñ€Ð¾Ð²Ð°Ñ‚ÑŒ')
    if (isSheetBusinessScrap && (!Number.isSafeInteger(Number(data.quantity)) || needed <= 0 || selectedInventory.unit !== 'шт')) {
      throw new Error('Для листового делового остатка укажите целое число штук')
    }
    if (quantity > maxQuantity) throw new Error(`Недостаточно на выбранной складской строке. Доступно: ${maxQuantity} шт`)
    const available = getReservableQuantity(data.request_item_table, row, selectedInventory)
    if (available <= 0) throw new Error('В выбранной складской строке нет доступного остатка')
    if (quantity > available) throw new Error(`Недостаточно на выбранной складской строке. Доступно: ${available} ${selectedInventory.unit}`)

    const secondaryQuantity = data.request_item_table === 'request_round_tube'
      ? getRoundSecondaryReserve(quantity, row)
      : null

    const result = await reserveForMachine({
      inventory_id: selectedInventory.id,
      material_id: selectedInventory.material_id,
      material_variant_id: selectedVariantId,
      piece_length_mm: selectedInventory.piece_length_mm ?? null,
      machine_id: request.machine_id,
      quantity,
      secondary_quantity: secondaryQuantity,
      use_cut_reservation: false,
      use_whole_bar_reservation: usesWholeBarStock(data.request_item_table, row, selectedInventory),
      use_inventory_transfer: requiresInventoryTransfer,
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
    const { db, userId, permissionDetails, permissions } = await requireReservationAccess()
    if (!REQUEST_TABLES.includes(data.request_item_table)) throw new Error('ÐÐµÐºÐ¾Ñ€Ñ€ÐµÐºÑ‚Ð½Ð°Ñ Ñ‚Ð°Ð±Ð»Ð¸Ñ†Ð° Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸')
    const requestId = await getRequestIdForItem(db, data.request_item_table, data.request_item_id)
    const request = await getRequestMeta(db, requestId)
    await assertActiveReservationActor(db, request, userId, permissionDetails.isAdminPosition)
    const reservationSource = assertReservationAllowedForRequest(request)
    assertReservationWorkflowPermission(permissions, reservationSource)
    const { data: rowData, error: rowError } = await db.from(data.request_item_table).select('*').eq('id', data.request_item_id).single()
    if (rowError || !rowData) throw new Error(rowError?.message || 'Позиция заявки не найдена')
    assertManualSupplyRequestReservationAllowed(data.request_item_table, rowData as Record<string, unknown>)
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

export async function reserveAllAvailable(requestId: string, factoryId: string) {
  try {
    const { db, userId, permissionDetails, permissions } = await requireReservationAccess()
    const { data, error } = await getRequestForSupply(requestId)
    if (error || !data) throw new Error(error || 'Ð—Ð°ÑÐ²ÐºÐ° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')
    await assertActiveReservationActor(db, data.request, userId, permissionDetails.isAdminPosition)
    assertReservationWorkflowPermission(permissions, assertReservationAllowedForRequest(data.request))
    if (!data.factories.some((factory) => factory.id === factoryId)) throw new Error('Выбранный завод не найден')

    let reservedCount = 0
    let skippedCount = 0
    const machineId = data.request.machine_id
    const reserveRow = async (
      table: RequestItemTable,
      row: SupplyRequestRow<Record<string, unknown> & { id: string; material_id: string | null }>,
    ) => {
      if (table === 'request_sheet_metal' && getReservationStockSource(data.request) === 'business_scrap') {
        skippedCount += 1
        return
      }
      if (isLayoutManagedSupplyRequestItem(table, row)) {
        skippedCount += 1
        return
      }
      if (!row.material_id || row.reservation_id) {
        skippedCount += 1
        return
      }
      const needed = getNeededForRow(table, row)
      const remaining = Math.max(needed - row.covered_quantity, 0)
      const reservableStockItems = row.stock_items.filter((item) =>
        item.factory_id === factoryId
        && Number(item.available_quantity || 0) > 0,
      )
      if (reservableStockItems.length !== 1) {
        skippedCount += 1
        return
      }
      const available = Number(reservableStockItems[0]?.available_quantity || 0)
      const quantity = Math.min(remaining, available)
      if (quantity <= 0) {
        skippedCount += 1
        return
      }
      const result = await reserveItemFromStock({
        request_item_table: table,
        request_item_id: row.id,
        inventory_id: reservableStockItems[0].id,
        factory_id: factoryId,
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
    const { db, permissions } = await requireAccess()
    const isSupplyOnly = hasPermission(permissions, 'supply_material_requests', 'view')
      && !hasPermission(permissions, 'technologist_requests', 'manage')
    const statuses = isSupplyOnly
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
