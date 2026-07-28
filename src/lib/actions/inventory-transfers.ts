'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/utils/get-error-message'

type DbResult<T = unknown> = { data: T | null; error: { message?: string } | null }
type TransferQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => TransferQuery
  eq: (column: string, value: unknown) => TransferQuery
  in: (column: string, values: unknown[]) => TransferQuery
  order: (column: string, options?: { ascending?: boolean }) => TransferQuery
}
type TransferDb = {
  from: (table: string) => TransferQuery
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>
}

export type InventoryTransferStatus =
  | 'needs_date'
  | 'scheduled'
  | 'partially_received'
  | 'completed'
  | 'cancelled'

export type InventoryTransferItemCard = {
  id: string
  materialId: string
  materialName: string
  materialCategory: string | null
  requestItemTable: string
  requestItemId: string
  requestedQuantity: number
  receivedQuantity: number
  remainingQuantity: number
  requestedSecondaryQuantity: number | null
  receivedSecondaryQuantity: number | null
  remainingSecondaryQuantity: number | null
  unit: string
  secondaryUnit: string | null
  pieceLengthMm: number | null
  isBusinessScrap: boolean
}

export type InventoryTransferCard = {
  id: string
  machineId: string
  machineName: string
  sourceFactoryId: string
  sourceFactoryName: string
  sourceFactoryCity: string | null
  sourceFactoryAddress: string | null
  destinationFactoryId: string
  destinationFactoryName: string
  destinationFactoryCity: string | null
  destinationFactoryAddress: string | null
  status: InventoryTransferStatus
  expectedArrivalDate: string | null
  deadline: string | null
  taskId: string | null
  taskStatus: string | null
  deliveryRisk: boolean
  items: InventoryTransferItemCard[]
}

function transferDb(client: unknown): TransferDb {
  return client as TransferDb
}

function adminDb() {
  return transferDb(createAdminClient())
}

function numberValue(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function revalidateInventoryTransfers() {
  revalidatePath(ROUTES.SUPPLY_TRANSPORT)
  revalidatePath(ROUTES.INVENTORY_RECEIVING)
  revalidatePath(ROUTES.INVENTORY)
  revalidatePath(ROUTES.TASKS)
}

async function loadTransferCards(db: TransferDb, activeOnly: boolean): Promise<InventoryTransferCard[]> {
  let transfersQuery = db
    .from('inventory_transfers')
    .select('id, machine_id, source_factory_id, destination_factory_id, status, expected_arrival_date, created_at')
    .order('created_at', { ascending: false })
  if (activeOnly) transfersQuery = transfersQuery.in('status', ['needs_date', 'scheduled', 'partially_received'])

  const transfersResult = await transfersQuery
  if (transfersResult.error) {
    throw new Error(transfersResult.error.message || 'Не удалось загрузить межскладские перевозки')
  }
  const transferRows = (transfersResult.data || []) as Array<Record<string, unknown>>
  if (transferRows.length === 0) return []

  const transferIds = transferRows.map((row) => String(row.id))
  const machineIds = Array.from(new Set(transferRows.map((row) => String(row.machine_id))))
  const factoryIds = Array.from(new Set(transferRows.flatMap((row) => [
    String(row.source_factory_id),
    String(row.destination_factory_id),
  ])))

  const [itemsResult, machinesResult, factoriesResult, tasksResult] = await Promise.all([
    db
      .from('inventory_transfer_items')
      .select('id, transfer_id, material_id, material_variant_id, request_item_table, request_item_id, requested_quantity, received_quantity, requested_secondary_quantity, received_secondary_quantity, unit, secondary_unit, piece_length_mm, is_business_scrap')
      .in('transfer_id', transferIds)
      .order('created_at', { ascending: true }),
    db.from('machines').select('id, name').in('id', machineIds),
    db.from('factories').select('id, name, city, address').in('id', factoryIds),
    db
      .from('tasks')
      .select('id, inventory_transfer_id, status, deadline')
      .eq('task_type', 'inventory_transfer')
      .in('inventory_transfer_id', transferIds)
      .order('created_at', { ascending: false }),
  ])

  for (const result of [itemsResult, machinesResult, factoriesResult, tasksResult]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось загрузить межскладские перевозки')
  }

  const itemRows = (itemsResult.data || []) as Array<Record<string, unknown>>
  const materialIds = Array.from(new Set(itemRows.map((row) => String(row.material_id))))
  const materialsResult = materialIds.length > 0
    ? await db.from('materials').select('id, name, category').in('id', materialIds)
    : { data: [], error: null }
  if (materialsResult.error) {
    throw new Error(materialsResult.error.message || 'Не удалось загрузить материалы перевозки')
  }

  const materials = new Map(((materialsResult.data || []) as Array<{ id: string; name: string; category: string | null }>).map((row) => [row.id, row]))
  const machines = new Map(((machinesResult.data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]))
  const factories = new Map(((factoriesResult.data || []) as Array<{ id: string; name: string; city: string | null; address: string | null }>).map((row) => [row.id, row]))
  const tasks = (tasksResult.data || []) as Array<{ id: string; inventory_transfer_id: string; status: string; deadline: string | null }>
  const itemsByTransfer = new Map<string, Array<Record<string, unknown>>>()
  for (const item of itemRows) {
    const transferId = String(item.transfer_id)
    const transferItems = itemsByTransfer.get(transferId)
    if (transferItems) transferItems.push(item)
    else itemsByTransfer.set(transferId, [item])
  }
  const taskByTransfer = new Map<string, (typeof tasks)[number]>()
  for (const task of tasks) {
    const current = taskByTransfer.get(task.inventory_transfer_id)
    if (!current || (
      !['pending', 'in_progress'].includes(current.status)
      && ['pending', 'in_progress'].includes(task.status)
    )) {
      taskByTransfer.set(task.inventory_transfer_id, task)
    }
  }

  return transferRows.map((row) => {
    const items = (itemsByTransfer.get(String(row.id)) || [])
      .map((item): InventoryTransferItemCard => {
        const requested = numberValue(item.requested_quantity)
        const received = numberValue(item.received_quantity)
        const requestedSecondary = item.requested_secondary_quantity === null ? null : numberValue(item.requested_secondary_quantity)
        const receivedSecondary = item.received_secondary_quantity === null ? null : numberValue(item.received_secondary_quantity)
        const material = materials.get(String(item.material_id))
        return {
          id: String(item.id),
          materialId: String(item.material_id),
          materialName: material?.name || 'Материал',
          materialCategory: material?.category || null,
          requestItemTable: String(item.request_item_table),
          requestItemId: String(item.request_item_id),
          requestedQuantity: requested,
          receivedQuantity: received,
          remainingQuantity: Math.max(requested - received, 0),
          requestedSecondaryQuantity: requestedSecondary,
          receivedSecondaryQuantity: receivedSecondary,
          remainingSecondaryQuantity: requestedSecondary === null
            ? null
            : Math.max(requestedSecondary - numberValue(receivedSecondary), 0),
          unit: String(item.unit || ''),
          secondaryUnit: item.secondary_unit ? String(item.secondary_unit) : null,
          pieceLengthMm: item.piece_length_mm === null ? null : numberValue(item.piece_length_mm),
          isBusinessScrap: Boolean(item.is_business_scrap),
        }
      })

    const task = taskByTransfer.get(String(row.id))
    const expectedArrivalDate = row.expected_arrival_date ? String(row.expected_arrival_date) : null
    const deadline = task?.deadline || null

    return {
      id: String(row.id),
      machineId: String(row.machine_id),
      machineName: machines.get(String(row.machine_id)) || 'Заказ',
      sourceFactoryId: String(row.source_factory_id),
      sourceFactoryName: factories.get(String(row.source_factory_id))?.name || 'Неизвестный завод',
      sourceFactoryCity: factories.get(String(row.source_factory_id))?.city || null,
      sourceFactoryAddress: factories.get(String(row.source_factory_id))?.address || null,
      destinationFactoryId: String(row.destination_factory_id),
      destinationFactoryName: factories.get(String(row.destination_factory_id))?.name || 'Неизвестный завод',
      destinationFactoryCity: factories.get(String(row.destination_factory_id))?.city || null,
      destinationFactoryAddress: factories.get(String(row.destination_factory_id))?.address || null,
      status: String(row.status) as InventoryTransferStatus,
      expectedArrivalDate,
      deadline,
      taskId: task?.id || null,
      taskStatus: task?.status || null,
      deliveryRisk: Boolean(expectedArrivalDate && deadline && expectedArrivalDate > deadline),
      items,
    }
  })
}

export async function getInventoryTransportWorkspace() {
  try {
    await requirePermission('supply_transport', 'view')
    return { data: await loadTransferCards(adminDb(), false), error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function setInventoryTransferDate(transferId: string, expectedArrivalDate: string) {
  try {
    const parsed = z.object({
      transferId: z.string().uuid(),
      expectedArrivalDate: z.string().date(),
    }).parse({ transferId, expectedArrivalDate })
    const { supabase, userId } = await requirePermission('supply_transport', 'manage')
    const { error } = await transferDb(supabase).rpc('fn_set_inventory_transfer_date', {
      p_transfer_id: parsed.transferId,
      p_expected_arrival_date: parsed.expectedArrivalDate,
      p_actor: userId,
    })
    if (error) throw error
    revalidateInventoryTransfers()
    return { success: true }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getInventoryTransferReceivingItems() {
  try {
    await requirePermission('inventory_detailing_receiving', 'view')
    return { data: await loadTransferCards(adminDb(), true), error: null }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function receiveInventoryTransfer(
  transferId: string,
  items: Array<{ itemId: string; quantity: number }>,
) {
  try {
    const parsed = z.object({
      transferId: z.string().uuid(),
      items: z.array(z.object({
        itemId: z.string().uuid(),
        quantity: z.coerce.number().nonnegative(),
      })).min(1),
    }).parse({ transferId, items })
    const { supabase, userId } = await requirePermission('inventory_detailing_receiving', 'manage')
    const { error } = await transferDb(supabase).rpc('fn_receive_inventory_transfer', {
      p_transfer_id: parsed.transferId,
      p_items: parsed.items.map((item) => ({ item_id: item.itemId, quantity: item.quantity })),
      p_actor: userId,
    })
    if (error) throw error
    revalidateInventoryTransfers()
    return { success: true }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
