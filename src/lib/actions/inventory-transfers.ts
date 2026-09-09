'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { ACTIVE_TRANSFER_STATUSES, isMachineWorkVisible } from '@/lib/machine-work-visibility'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateInventoryTransferMaterialWeight,
  inventoryTransferMaterialCharacteristics,
  type InventoryTransferMaterialCharacteristic,
  type InventoryTransferMaterialVariant,
} from '@/lib/transport/inventory-transfer-materials'
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
  weightKg: number | null
  characteristics: InventoryTransferMaterialCharacteristic[]
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
      .select('id, transfer_id, source_inventory_id, material_id, material_variant_id, request_item_table, request_item_id, requested_quantity, received_quantity, requested_secondary_quantity, received_secondary_quantity, unit, secondary_unit, piece_length_mm, is_business_scrap')
      .in('transfer_id', transferIds)
      .order('created_at', { ascending: true }),
    db.from('machines').select('id, name, is_archived').in('id', machineIds),
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
  const materialVariantIds = Array.from(new Set(itemRows
    .map((row) => row.material_variant_id ? String(row.material_variant_id) : null)
    .filter((id): id is string => Boolean(id))))
  const sourceInventoryIds = Array.from(new Set(itemRows
    .map((row) => row.source_inventory_id ? String(row.source_inventory_id) : null)
    .filter((id): id is string => Boolean(id))))
  const [materialsResult, materialVariantsResult, sourceInventoriesResult] = await Promise.all([
    materialIds.length > 0
      ? db.from('materials').select('id, name, category').in('id', materialIds)
      : { data: [], error: null },
    materialVariantIds.length > 0
      ? db.from('material_variants')
        .select('id, category, steel_type_id, material_grade, thickness_mm, sheet_size, weight_per_unit_kg, length_m, weight_per_m_kg, piece_description, knife_dimensions, knife_material, knife_bevel_count, specification, default_unit, ral_code, finish, diameter_mm, is_calibrated, pipe_type, wall_thickness_mm, width_mm, height_mm, mesh_description, mesh_length_mm, mesh_width_mm, chain_cord_type, chain_cord_parameters, unit_weight_kg')
        .in('id', materialVariantIds)
      : { data: [], error: null },
    sourceInventoryIds.length > 0
      ? db.from('inventory').select('id, total_quantity, calculated_weight_kg').in('id', sourceInventoryIds)
      : { data: [], error: null },
  ])
  for (const result of [materialsResult, materialVariantsResult, sourceInventoriesResult]) {
    if (result.error) {
      throw new Error(result.error.message || 'Не удалось загрузить материалы перевозки')
    }
  }

  const materialVariants = new Map(((materialVariantsResult.data || []) as Array<InventoryTransferMaterialVariant & { id: string }>).map((row) => [row.id, row]))
  const steelTypeIds = Array.from(new Set(Array.from(materialVariants.values())
    .map((variant) => variant.steel_type_id)
    .filter((id): id is string => Boolean(id))))
  const steelTypesResult = steelTypeIds.length > 0
    ? await db.from('steel_types').select('id, name, density_kg_mm3').in('id', steelTypeIds)
    : { data: [], error: null }
  if (steelTypesResult.error) {
    throw new Error(steelTypesResult.error.message || 'Не удалось загрузить марки стали перевозки')
  }

  const materials = new Map(((materialsResult.data || []) as Array<{ id: string; name: string; category: string | null }>).map((row) => [row.id, row]))
  const steelTypes = new Map(((steelTypesResult.data || []) as Array<{
    id: string
    name: string
    density_kg_mm3: number
  }>).map((row) => [row.id, row]))
  const sourceInventories = new Map(((sourceInventoriesResult.data || []) as Array<{
    id: string
    total_quantity: number
    calculated_weight_kg: number | null
  }>).map((row) => [row.id, row]))
  const machines = new Map(((machinesResult.data || []) as Array<{ id: string; name: string; is_archived: boolean | null }>).map((row) => [row.id, row]))
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

  return transferRows.flatMap((row): InventoryTransferCard[] => {
    const machine = machines.get(String(row.machine_id))
    if (!isMachineWorkVisible(machine?.is_archived, String(row.status), ACTIVE_TRANSFER_STATUSES)) return []
    const items = (itemsByTransfer.get(String(row.id)) || [])
      .map((item): InventoryTransferItemCard => {
        const requested = numberValue(item.requested_quantity)
        const received = numberValue(item.received_quantity)
        const requestedSecondary = item.requested_secondary_quantity === null ? null : numberValue(item.requested_secondary_quantity)
        const receivedSecondary = item.received_secondary_quantity === null ? null : numberValue(item.received_secondary_quantity)
        const material = materials.get(String(item.material_id))
        const variant = item.material_variant_id
          ? materialVariants.get(String(item.material_variant_id)) || null
          : null
        const category = material?.category || variant?.category || null
        const steelType = variant?.steel_type_id ? steelTypes.get(variant.steel_type_id) : null
        const sourceInventory = sourceInventories.get(String(item.source_inventory_id))
        const remainingQuantity = Math.max(requested - received, 0)
        return {
          id: String(item.id),
          materialId: String(item.material_id),
          materialName: material?.name || 'Материал',
          materialCategory: category,
          requestItemTable: String(item.request_item_table),
          requestItemId: String(item.request_item_id),
          requestedQuantity: requested,
          receivedQuantity: received,
          remainingQuantity,
          requestedSecondaryQuantity: requestedSecondary,
          receivedSecondaryQuantity: receivedSecondary,
          remainingSecondaryQuantity: requestedSecondary === null
            ? null
            : Math.max(requestedSecondary - numberValue(receivedSecondary), 0),
          unit: String(item.unit || ''),
          secondaryUnit: item.secondary_unit ? String(item.secondary_unit) : null,
          pieceLengthMm: item.piece_length_mm === null ? null : numberValue(item.piece_length_mm),
          isBusinessScrap: Boolean(item.is_business_scrap),
          weightKg: calculateInventoryTransferMaterialWeight({
            remainingQuantity,
            unit: String(item.unit || ''),
            variant,
            densityKgMm3: steelType?.density_kg_mm3 ?? null,
            sourceStock: sourceInventory ? {
              totalQuantity: numberValue(sourceInventory.total_quantity),
              calculatedWeightKg: sourceInventory.calculated_weight_kg === null
                ? null
                : numberValue(sourceInventory.calculated_weight_kg),
            } : null,
          }),
          characteristics: inventoryTransferMaterialCharacteristics({
            category,
            variant,
            steelTypeName: steelType?.name || null,
          }),
        }
      })

    const task = taskByTransfer.get(String(row.id))
    const expectedArrivalDate = row.expected_arrival_date ? String(row.expected_arrival_date) : null
    const deadline = task?.deadline || null

    return [{
      id: String(row.id),
      machineId: String(row.machine_id),
      machineName: machine?.name || 'Заказ',
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
    }]
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
