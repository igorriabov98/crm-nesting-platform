'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requireAnyPermission, requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/lib/types/database'
import { getErrorMessage } from '@/lib/utils/get-error-message'

type DetailingFunctionName =
  | 'fn_create_detailing_part'
  | 'fn_receive_detailing_stock'
  | 'fn_adjust_detailing_stock'
  | 'fn_validate_detailing_request_check'
  | 'fn_decline_detailing_for_request'
  | 'fn_reserve_detailing'
  | 'fn_release_detailing_reservation'
  | 'fn_set_detailing_transfer_date'
  | 'fn_receive_detailing_transfer'
  | 'fn_archive_detailing_part'

type DetailingReadTable =
  | 'detailing_parts'
  | 'detailing_part_products'
  | 'detailing_part_product_versions'
  | 'detailing_balances'
  | 'detailing_movements'
  | 'detailing_reservations'
  | 'detailing_reservation_allocations'
  | 'detailing_request_checks'
  | 'detailing_transfers'
  | 'detailing_transfer_items'
  | 'factories'
  | 'products'
  | 'product_versions'
  | 'users'
  | 'technologist_requests'
  | 'machines'
  | 'machine_items'
  | 'tasks'

type DbResult<T = unknown> = { data: T | null; error: { message?: string; code?: string } | null }
type DetailingReadQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => DetailingReadQuery
  eq: (column: string, value: unknown) => DetailingReadQuery
  neq: (column: string, value: unknown) => DetailingReadQuery
  in: (column: string, values: unknown[]) => DetailingReadQuery
  gt: (column: string, value: unknown) => DetailingReadQuery
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => DetailingReadQuery
  limit: (count: number) => DetailingReadQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
}
type DetailingDb = {
  from: (table: DetailingReadTable) => DetailingReadQuery
  rpc: <Name extends DetailingFunctionName>(
    fn: Name,
    args: Database['public']['Functions'][Name]['Args'],
  ) => Promise<DbResult<Database['public']['Functions'][Name]['Returns']>>
}

export type DetailingFactory = { id: string; name: string }
export type DetailingProductVersion = { id: string; versionNumber: number; drawingNumber: string; status: string }
export type DetailingProductOption = {
  id: string
  name: string
  drawingNumber: string
  versions: DetailingProductVersion[]
}
export type DetailingCompatibility = {
  productId: string
  productName: string
  productDrawingNumber: string
  allVersions: boolean
  versions: DetailingProductVersion[]
}
export type DetailingBalance = {
  id: string
  factoryId: string
  factoryName: string
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
  onHandWeightKg: number
  reservedWeightKg: number
  availableWeightKg: number
}
export type DetailingMovement = {
  id: string
  partId: string
  factoryId: string
  movementType: string
  quantityDelta: number
  reservedDelta: number
  onHandAfter: number
  reservedAfter: number
  comment: string | null
  createdAt: string
  performedByName: string | null
}
export type DetailingPartCard = {
  id: string
  name: string
  drawingNumber: string
  unitWeightKg: number
  isActive: boolean
  compatibilities: DetailingCompatibility[]
  balances: DetailingBalance[]
  movements: DetailingMovement[]
}
export type DetailingWarehouseData = {
  factories: DetailingFactory[]
  products: DetailingProductOption[]
  parts: DetailingPartCard[]
}

export type DetailingRequestMatch = {
  machineItemId: string
  productLabel: string
  quantityInOrder: number
  partId: string
  partName: string
  drawingNumber: string
  unitWeightKg: number
  sourceFactoryId: string
  sourceFactoryName: string
  destinationFactoryId: string | null
  availableQuantity: number
  availableWeightKg: number
  requiresTransfer: boolean
}
export type DetailingRequestReservation = {
  id: string
  machineItemId: string | null
  partId: string
  partName: string
  drawingNumber: string
  unitWeightKg: number
  requestedQuantity: number
  consumedQuantity: number
  releasedQuantity: number
  status: string
  allocations: Array<{ factoryId: string; factoryName: string; quantity: number }>
}
export type DetailingRequestWorkspace = {
  requestId: string
  machineId: string
  machineName: string
  destinationFactoryId: string | null
  destinationFactoryName: string | null
  decision: 'auto_no_matches' | 'reserved' | 'declined' | null
  matches: DetailingRequestMatch[]
  reservations: DetailingRequestReservation[]
}

export type DetailingTransferItem = {
  id: string
  reservationId: string
  partId: string
  partName: string
  drawingNumber: string
  unitWeightKg: number
  requestedQuantity: number
  receivedQuantity: number
  remainingQuantity: number
  requestedWeightKg: number
  receivedWeightKg: number
}
export type DetailingTransferCard = {
  id: string
  machineId: string
  machineName: string
  sourceFactoryId: string
  sourceFactoryName: string
  destinationFactoryId: string
  destinationFactoryName: string
  status: 'needs_date' | 'scheduled' | 'partially_received' | 'completed' | 'cancelled'
  expectedArrivalDate: string | null
  deadline: string | null
  taskId: string | null
  taskStatus: string | null
  deliveryRisk: boolean
  items: DetailingTransferItem[]
  totalQuantity: number
  totalWeightKg: number
  receivedQuantity: number
}

type RawPart = {
  id: string
  name: string
  drawing_number: string
  unit_weight_kg: number | string
  is_active: boolean
}

const compatibilitySchema = z.object({
  productId: z.string().uuid(),
  allVersions: z.boolean(),
  versionIds: z.array(z.string().uuid()).default([]),
}).refine((value) => value.allVersions || value.versionIds.length > 0, 'Выберите версии изделия')

const createPartSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название детали'),
  drawingNumber: z.string().trim().min(1, 'Укажите номер чертежа'),
  unitWeightKg: z.coerce.number().positive('Вес должен быть больше 0'),
  factoryId: z.string().uuid(),
  initialQuantity: z.coerce.number().int().positive('Количество должно быть целым и больше 0'),
  compatibilities: z.array(compatibilitySchema).min(1, 'Выберите хотя бы одно изделие'),
})

function detailingDb(client: unknown): DetailingDb {
  return client as DetailingDb
}

function adminDb(): DetailingDb {
  return detailingDb(createAdminClient())
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function revalidateDetailing() {
  revalidatePath(ROUTES.INVENTORY_DETAILING)
  revalidatePath(ROUTES.INVENTORY_RECEIVING)
  revalidatePath(ROUTES.SUPPLY_TRANSPORT)
  revalidatePath(ROUTES.TASKS)
}

async function loadWarehouse(db: DetailingDb, includeArchived = false): Promise<DetailingWarehouseData> {
  let partsQuery = db.from('detailing_parts').select('id, name, drawing_number, unit_weight_kg, is_active')
  if (!includeArchived) partsQuery = partsQuery.eq('is_active', true)

  const [partsResult, factoriesResult, productsResult, versionsResult, linksResult, linkVersionsResult, balancesResult, movementsResult, usersResult] = await Promise.all([
    partsQuery.order('name', { ascending: true }),
    db.from('factories').select('id, name').order('name', { ascending: true }),
    db.from('products').select('id, name_uk, name_en, drawing_number, status').neq('status', 'archived').order('name_uk', { ascending: true }),
    db.from('product_versions').select('id, product_id, version_number, drawing_number, status').order('version_number', { ascending: false }),
    db.from('detailing_part_products').select('id, part_id, product_id, applies_to_all_versions'),
    db.from('detailing_part_product_versions').select('part_product_id, product_version_id'),
    db.from('detailing_balances').select('id, part_id, factory_id, on_hand_quantity, reserved_quantity, available_quantity'),
    db.from('detailing_movements').select('id, part_id, factory_id, movement_type, quantity_delta, reserved_delta, on_hand_after, reserved_after, comment, created_at, performed_by').order('created_at', { ascending: false }).limit(500),
    db.from('users').select('id, full_name'),
  ])

  for (const result of [partsResult, factoriesResult, productsResult, versionsResult, linksResult, linkVersionsResult, balancesResult, movementsResult, usersResult]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось загрузить данные деталировки')
  }

  const factories = (factoriesResult.data || []) as Array<{ id: string; name: string }>
  const factoryMap = new Map(factories.map((item) => [item.id, item.name]))
  const products = (productsResult.data || []) as Array<{ id: string; name_uk: string; name_en: string; drawing_number: string }>
  const productMap = new Map(products.map((item) => [item.id, item]))
  const versions = (versionsResult.data || []) as Array<{ id: string; product_id: string; version_number: number; drawing_number: string; status: string }>
  const versionMap = new Map(versions.map((item) => [item.id, item]))
  const versionsByProduct = new Map<string, DetailingProductVersion[]>()
  for (const version of versions) {
    const list = versionsByProduct.get(version.product_id) || []
    list.push({ id: version.id, versionNumber: version.version_number, drawingNumber: version.drawing_number, status: version.status })
    versionsByProduct.set(version.product_id, list)
  }
  const users = new Map(((usersResult.data || []) as Array<{ id: string; full_name: string }>).map((item) => [item.id, item.full_name]))
  const linkVersionIds = new Map<string, string[]>()
  for (const row of (linkVersionsResult.data || []) as Array<{ part_product_id: string; product_version_id: string }>) {
    linkVersionIds.set(row.part_product_id, [...(linkVersionIds.get(row.part_product_id) || []), row.product_version_id])
  }
  const compatibilitiesByPart = new Map<string, DetailingCompatibility[]>()
  for (const row of (linksResult.data || []) as Array<{ id: string; part_id: string; product_id: string; applies_to_all_versions: boolean }>) {
    const product = productMap.get(row.product_id)
    if (!product) continue
    const selectedVersions = (linkVersionIds.get(row.id) || []).map((id) => versionMap.get(id)).filter(Boolean) as typeof versions
    const list = compatibilitiesByPart.get(row.part_id) || []
    list.push({
      productId: row.product_id,
      productName: product.name_uk || product.name_en,
      productDrawingNumber: product.drawing_number,
      allVersions: row.applies_to_all_versions,
      versions: selectedVersions.map((item) => ({ id: item.id, versionNumber: item.version_number, drawingNumber: item.drawing_number, status: item.status })),
    })
    compatibilitiesByPart.set(row.part_id, list)
  }

  const balancesByPart = new Map<string, DetailingBalance[]>()
  const partWeightMap = new Map(((partsResult.data || []) as RawPart[]).map((part) => [part.id, numberValue(part.unit_weight_kg)]))
  for (const row of (balancesResult.data || []) as Array<Record<string, unknown>>) {
    const weight = partWeightMap.get(String(row.part_id)) || 0
    const onHand = numberValue(row.on_hand_quantity)
    const reserved = numberValue(row.reserved_quantity)
    const available = numberValue(row.available_quantity)
    const partId = String(row.part_id)
    const list = balancesByPart.get(partId) || []
    list.push({
      id: String(row.id), factoryId: String(row.factory_id), factoryName: factoryMap.get(String(row.factory_id)) || 'Неизвестный завод',
      onHandQuantity: onHand, reservedQuantity: reserved, availableQuantity: available,
      onHandWeightKg: onHand * weight, reservedWeightKg: reserved * weight, availableWeightKg: available * weight,
    })
    balancesByPart.set(partId, list)
  }

  const movementsByPart = new Map<string, DetailingMovement[]>()
  for (const row of (movementsResult.data || []) as Array<Record<string, unknown>>) {
    const partId = String(row.part_id)
    const list = movementsByPart.get(partId) || []
    list.push({
      id: String(row.id), partId, factoryId: String(row.factory_id), movementType: String(row.movement_type),
      quantityDelta: numberValue(row.quantity_delta), reservedDelta: numberValue(row.reserved_delta),
      onHandAfter: numberValue(row.on_hand_after), reservedAfter: numberValue(row.reserved_after),
      comment: row.comment ? String(row.comment) : null, createdAt: String(row.created_at),
      performedByName: users.get(String(row.performed_by)) || null,
    })
    movementsByPart.set(partId, list.slice(0, 25))
  }

  return {
    factories,
    products: products.map((product) => ({
      id: product.id,
      name: product.name_uk || product.name_en,
      drawingNumber: product.drawing_number,
      versions: versionsByProduct.get(product.id) || [],
    })),
    parts: ((partsResult.data || []) as RawPart[]).map((part) => ({
      id: part.id,
      name: part.name,
      drawingNumber: part.drawing_number,
      unitWeightKg: numberValue(part.unit_weight_kg),
      isActive: part.is_active,
      compatibilities: compatibilitiesByPart.get(part.id) || [],
      balances: (balancesByPart.get(part.id) || []).sort((a, b) => a.factoryName.localeCompare(b.factoryName, 'ru')),
      movements: movementsByPart.get(part.id) || [],
    })),
  }
}

export async function getDetailingWarehouse(): Promise<{ data: DetailingWarehouseData | null; error: string | null }> {
  try {
    await requireAnyPermission([
      { resourceKey: 'inventory_detailing', operation: 'view' },
      { resourceKey: 'technologist_requests', operation: 'view' },
      { resourceKey: 'supply', operation: 'view' },
    ])
    return { data: await loadWarehouse(adminDb()), error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function createDetailingPart(input: z.input<typeof createPartSchema>) {
  try {
    const parsed = createPartSchema.parse(input)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { data, error } = await detailingDb(supabase).rpc('fn_create_detailing_part', {
      p_name: parsed.name,
      p_drawing_number: parsed.drawingNumber,
      p_unit_weight_kg: parsed.unitWeightKg,
      p_factory_id: parsed.factoryId,
      p_initial_quantity: parsed.initialQuantity,
      p_compatibilities: parsed.compatibilities.map((item) => ({ product_id: item.productId, all_versions: item.allVersions, version_ids: item.versionIds })),
      p_actor: userId,
    })
    if (error) throw error
    revalidateDetailing()
    return { success: true, data: data as string }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function receiveDetailingStock(input: { partId: string; factoryId: string; quantity: number; comment?: string }) {
  try {
    const parsed = z.object({ partId: z.string().uuid(), factoryId: z.string().uuid(), quantity: z.coerce.number().int().positive(), comment: z.string().trim().optional() }).parse(input)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_receive_detailing_stock', {
      p_part_id: parsed.partId, p_factory_id: parsed.factoryId, p_quantity: parsed.quantity, p_comment: parsed.comment || null, p_actor: userId,
    })
    if (error) throw error
    revalidateDetailing()
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function adjustDetailingStock(input: { partId: string; factoryId: string; onHandQuantity: number; comment: string }) {
  try {
    const parsed = z.object({ partId: z.string().uuid(), factoryId: z.string().uuid(), onHandQuantity: z.coerce.number().int().nonnegative(), comment: z.string().trim().min(1) }).parse(input)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_adjust_detailing_stock', {
      p_part_id: parsed.partId, p_factory_id: parsed.factoryId, p_on_hand_quantity: parsed.onHandQuantity, p_comment: parsed.comment, p_actor: userId,
    })
    if (error) throw error
    revalidateDetailing()
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function archiveDetailingPart(partId: string) {
  try {
    const id = z.string().uuid().parse(partId)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_archive_detailing_part', { p_part_id: id, p_actor: userId })
    if (error) throw error
    revalidateDetailing()
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function getDetailingRequestWorkspace(requestId: string): Promise<{ data: DetailingRequestWorkspace | null; error: string | null }> {
  try {
    const id = z.string().uuid().parse(requestId)
    await requirePermission('inventory_detailing', 'view')
    const db = adminDb()
    const requestResult = await db.from('technologist_requests').select('id, machine_id').eq('id', id).single()
    if (requestResult.error || !requestResult.data) throw new Error(requestResult.error?.message || 'Заявка технолога не найдена')
    const request = requestResult.data as { id: string; machine_id: string }
    const [machineResult, itemsResult, warehouse, reservationsResult, allocationsResult, checkResult] = await Promise.all([
      db.from('machines').select('id, name, factory_id').eq('id', request.machine_id).single(),
      db.from('machine_items').select('id, product_id, product_version_id, product_name, product_name_uk, drawing_number, quantity').eq('machine_id', request.machine_id).order('sort_order', { ascending: true }),
      loadWarehouse(db),
      db.from('detailing_reservations').select('id, request_id, machine_item_id, part_id, requested_quantity, consumed_quantity, released_quantity, status').eq('request_id', id).order('created_at', { ascending: true }),
      db.from('detailing_reservation_allocations').select('id, reservation_id, factory_id, quantity').gt('quantity', 0),
      db.from('detailing_request_checks').select('decision, machine_item_signature').eq('request_id', id).maybeSingle(),
    ])
    if (machineResult.error || itemsResult.error || reservationsResult.error || allocationsResult.error) throw new Error('Не удалось загрузить проверку деталировки')
    const machine = machineResult.data as { id: string; name: string; factory_id: string | null }
    const factoryMap = new Map(warehouse.factories.map((factory) => [factory.id, factory.name]))
    const rawItems = (itemsResult.data || []) as Array<Record<string, unknown>>
    const matches: DetailingRequestMatch[] = []
    for (const item of rawItems) {
      const productId = item.product_id ? String(item.product_id) : null
      if (!productId) continue
      for (const part of warehouse.parts) {
        const compatibility = part.compatibilities.find((entry) => entry.productId === productId)
        if (!compatibility) continue
        if (!compatibility.allVersions && !compatibility.versions.some((version) => version.id === String(item.product_version_id))) continue
        for (const balance of part.balances.filter((entry) => entry.availableQuantity > 0)) {
          matches.push({
            machineItemId: String(item.id),
            productLabel: String(item.product_name_uk || item.product_name || item.drawing_number || 'Изделие'),
            quantityInOrder: numberValue(item.quantity),
            partId: part.id, partName: part.name, drawingNumber: part.drawingNumber, unitWeightKg: part.unitWeightKg,
            sourceFactoryId: balance.factoryId, sourceFactoryName: balance.factoryName,
            destinationFactoryId: machine.factory_id, availableQuantity: balance.availableQuantity, availableWeightKg: balance.availableWeightKg,
            requiresTransfer: Boolean(machine.factory_id && machine.factory_id !== balance.factoryId),
          })
        }
      }
    }
    matches.sort((a, b) => Number(a.requiresTransfer) - Number(b.requiresTransfer) || a.partName.localeCompare(b.partName, 'ru'))

    const partMap = new Map(warehouse.parts.map((part) => [part.id, part]))
    const allocationRows = (allocationsResult.data || []) as Array<{ reservation_id: string; factory_id: string; quantity: number }>
    const reservations = ((reservationsResult.data || []) as Array<Record<string, unknown>>).map((row): DetailingRequestReservation => {
      const part = partMap.get(String(row.part_id))
      return {
        id: String(row.id), machineItemId: row.machine_item_id ? String(row.machine_item_id) : null,
        partId: String(row.part_id), partName: part?.name || 'Деталь', drawingNumber: part?.drawingNumber || '—', unitWeightKg: part?.unitWeightKg || 0,
        requestedQuantity: numberValue(row.requested_quantity), consumedQuantity: numberValue(row.consumed_quantity), releasedQuantity: numberValue(row.released_quantity), status: String(row.status),
        allocations: allocationRows.filter((item) => item.reservation_id === row.id).map((entry) => ({ factoryId: entry.factory_id, factoryName: factoryMap.get(entry.factory_id) || 'Неизвестный завод', quantity: numberValue(entry.quantity) })),
      }
    })
    return {
      data: {
        requestId: id, machineId: machine.id, machineName: machine.name,
        destinationFactoryId: machine.factory_id, destinationFactoryName: machine.factory_id ? factoryMap.get(machine.factory_id) || null : null,
        decision: ((checkResult.data as { decision?: DetailingRequestWorkspace['decision'] } | null)?.decision || null),
        matches, reservations,
      },
      error: null,
    }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function reserveDetailingForRequest(input: { requestId: string; machineItemId: string; partId: string; sourceFactoryId: string; quantity: number }) {
  try {
    const parsed = z.object({ requestId: z.string().uuid(), machineItemId: z.string().uuid(), partId: z.string().uuid(), sourceFactoryId: z.string().uuid(), quantity: z.coerce.number().int().positive() }).parse(input)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_reserve_detailing', {
      p_request_id: parsed.requestId, p_machine_item_id: parsed.machineItemId, p_part_id: parsed.partId,
      p_source_factory_id: parsed.sourceFactoryId, p_quantity: parsed.quantity, p_actor: userId,
    })
    if (error) throw error
    revalidateDetailing()
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function declineDetailingForRequest(requestId: string) {
  try {
    const id = z.string().uuid().parse(requestId)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_decline_detailing_for_request', { p_request_id: id, p_actor: userId })
    if (error) throw error
    revalidatePath(`${ROUTES.SALES_PLAN}`)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function validateDetailingRequestCheck(requestId: string) {
  try {
    const id = z.string().uuid().parse(requestId)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { data, error } = await detailingDb(supabase).rpc('fn_validate_detailing_request_check', { p_request_id: id, p_actor: userId })
    if (error) throw error
    return { success: true, data: data as { ready: boolean; has_matches: boolean; decision: string | null; message?: string } }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function releaseDetailingReservation(reservationId: string) {
  try {
    const id = z.string().uuid().parse(reservationId)
    const { supabase, userId } = await requirePermission('inventory_detailing', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_release_detailing_reservation', { p_reservation_id: id, p_reason: 'Бронь отменена технологом', p_actor: userId })
    if (error) throw error
    revalidateDetailing()
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

async function loadTransferCards(db: DetailingDb, activeOnly: boolean): Promise<DetailingTransferCard[]> {
  let transferQuery = db.from('detailing_transfers').select('id, machine_id, source_factory_id, destination_factory_id, status, expected_arrival_date, created_at').order('created_at', { ascending: false })
  if (activeOnly) transferQuery = transferQuery.in('status', ['needs_date', 'scheduled', 'partially_received'])
  const [transfersResult, itemsResult, partsResult, machinesResult, factoriesResult, tasksResult] = await Promise.all([
    transferQuery,
    db.from('detailing_transfer_items').select('id, transfer_id, reservation_id, part_id, requested_quantity, received_quantity'),
    db.from('detailing_parts').select('id, name, drawing_number, unit_weight_kg'),
    db.from('machines').select('id, name'),
    db.from('factories').select('id, name'),
    db.from('tasks').select('id, detailing_transfer_id, status, deadline').eq('task_type', 'detailing_transfer').order('created_at', { ascending: false }),
  ])
  for (const result of [transfersResult, itemsResult, partsResult, machinesResult, factoriesResult, tasksResult]) if (result.error) throw new Error(result.error.message || 'Не удалось загрузить перевозки деталировки')
  const parts = new Map(((partsResult.data || []) as RawPart[]).map((part) => [part.id, part]))
  const machines = new Map(((machinesResult.data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]))
  const factories = new Map(((factoriesResult.data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]))
  const tasks = (tasksResult.data || []) as Array<{ id: string; detailing_transfer_id: string; status: string; deadline: string | null }>
  const itemRows = (itemsResult.data || []) as Array<Record<string, unknown>>
  return ((transfersResult.data || []) as Array<Record<string, unknown>>).map((row) => {
    const items = itemRows.filter((item) => item.transfer_id === row.id).map((item): DetailingTransferItem => {
      const part = parts.get(String(item.part_id))
      const requested = numberValue(item.requested_quantity)
      const received = numberValue(item.received_quantity)
      const weight = numberValue(part?.unit_weight_kg)
      return {
        id: String(item.id), reservationId: String(item.reservation_id), partId: String(item.part_id),
        partName: part?.name || 'Деталь', drawingNumber: part?.drawing_number || '—', unitWeightKg: weight,
        requestedQuantity: requested, receivedQuantity: received, remainingQuantity: Math.max(requested - received, 0),
        requestedWeightKg: requested * weight, receivedWeightKg: received * weight,
      }
    })
    const task = tasks.find((entry) => entry.detailing_transfer_id === row.id && ['pending', 'in_progress'].includes(entry.status))
      || tasks.find((entry) => entry.detailing_transfer_id === row.id)
    const expected = row.expected_arrival_date ? String(row.expected_arrival_date) : null
    const deadline = task?.deadline || null
    return {
      id: String(row.id), machineId: String(row.machine_id), machineName: machines.get(String(row.machine_id)) || 'Заказ',
      sourceFactoryId: String(row.source_factory_id), sourceFactoryName: factories.get(String(row.source_factory_id)) || 'Неизвестный завод',
      destinationFactoryId: String(row.destination_factory_id), destinationFactoryName: factories.get(String(row.destination_factory_id)) || 'Неизвестный завод',
      status: String(row.status) as DetailingTransferCard['status'], expectedArrivalDate: expected,
      deadline, taskId: task?.id || null, taskStatus: task?.status || null,
      deliveryRisk: Boolean(expected && deadline && expected > deadline), items,
      totalQuantity: items.reduce((sum, item) => sum + item.requestedQuantity, 0),
      totalWeightKg: items.reduce((sum, item) => sum + item.requestedWeightKg, 0),
      receivedQuantity: items.reduce((sum, item) => sum + item.receivedQuantity, 0),
    }
  })
}

export async function getDetailingTransportWorkspace() {
  try {
    await requirePermission('supply_transport', 'view')
    return { data: await loadTransferCards(adminDb(), false), error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function setDetailingTransferDate(transferId: string, expectedArrivalDate: string) {
  try {
    const parsed = z.object({ transferId: z.string().uuid(), expectedArrivalDate: z.string().date() }).parse({ transferId, expectedArrivalDate })
    const { supabase, userId } = await requirePermission('supply_transport', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_set_detailing_transfer_date', { p_transfer_id: parsed.transferId, p_expected_arrival_date: parsed.expectedArrivalDate, p_actor: userId })
    if (error) throw error
    revalidateDetailing()
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function getDetailingReceivingItems() {
  try {
    await requirePermission('inventory_detailing_receiving', 'view')
    return { data: await loadTransferCards(adminDb(), true), error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function receiveDetailingTransfer(transferId: string, items: Array<{ itemId: string; quantity: number }>) {
  try {
    const parsed = z.object({ transferId: z.string().uuid(), items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().nonnegative() })).min(1) }).parse({ transferId, items })
    const { supabase, userId } = await requirePermission('inventory_detailing_receiving', 'manage')
    const { error } = await detailingDb(supabase).rpc('fn_receive_detailing_transfer', {
      p_transfer_id: parsed.transferId,
      p_items: parsed.items.map((item) => ({ item_id: item.itemId, quantity: item.quantity })),
      p_actor: userId,
    })
    if (error) throw error
    revalidateDetailing()
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
