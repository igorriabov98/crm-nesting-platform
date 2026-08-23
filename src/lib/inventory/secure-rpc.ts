import 'server-only'

import { getCurrentUserContext } from '@/lib/auth/current-user'
import { createAdminClient } from '@/lib/supabase/admin'

type RpcResult = {
  data: unknown
  error: { message?: string } | null
}

type SecureRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>
}

function secureRpcClient() {
  return createAdminClient() as unknown as SecureRpcClient
}

export async function reserveWholeBarInventoryForMachine(input: {
  inventoryId: string
  machineId: string
  logicalQuantity: number
  requestItemTable: string
  requestItemId: string
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc(
    'fn_reserve_whole_bar_inventory_row_for_machine',
    {
      p_inventory_id: input.inventoryId,
      p_machine_id: input.machineId,
      p_logical_quantity: input.logicalQuantity,
      p_request_item_table: input.requestItemTable,
      p_request_item_id: input.requestItemId,
      p_reserved_by: actorId,
    },
  )
  if (error) throw new Error(error.message || 'Не удалось забронировать целые хлысты')
}

export async function reserveWholeBarInventoryForMachineTransfer(input: {
  inventoryId: string
  machineId: string
  logicalQuantity: number
  requestItemTable: string
  requestItemId: string
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc(
    'fn_reserve_whole_bar_inventory_row_for_machine_transfer',
    {
      p_inventory_id: input.inventoryId,
      p_machine_id: input.machineId,
      p_logical_quantity: input.logicalQuantity,
      p_request_item_table: input.requestItemTable,
      p_request_item_id: input.requestItemId,
      p_reserved_by: actorId,
    },
  )
  if (error) throw new Error(error.message || 'Не удалось забронировать хлысты для перемещения')
}

export async function reserveInventoryRowForMachine(input: {
  inventoryId: string
  machineId: string
  quantity: number
  requestItemTable: string
  requestItemId: string
  secondaryQuantity?: number | null
  isCutReservation?: boolean | null
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc('fn_reserve_inventory_row_for_machine', {
    p_inventory_id: input.inventoryId,
    p_machine_id: input.machineId,
    p_quantity: input.quantity,
    p_request_item_table: input.requestItemTable,
    p_request_item_id: input.requestItemId,
    p_reserved_by: actorId,
    p_secondary_quantity: input.secondaryQuantity ?? null,
    p_is_cut_reservation: input.isCutReservation ?? null,
  })
  if (error) throw new Error(error.message || 'Не удалось забронировать складскую строку')
}

export async function reserveInventoryRowForMachineTransfer(input: {
  inventoryId: string
  machineId: string
  quantity: number
  requestItemTable: string
  requestItemId: string
  secondaryQuantity?: number | null
  isCutReservation?: boolean | null
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc(
    'fn_reserve_inventory_row_for_machine_transfer',
    {
      p_inventory_id: input.inventoryId,
      p_machine_id: input.machineId,
      p_quantity: input.quantity,
      p_request_item_table: input.requestItemTable,
      p_request_item_id: input.requestItemId,
      p_reserved_by: actorId,
      p_secondary_quantity: input.secondaryQuantity ?? null,
      p_is_cut_reservation: input.isCutReservation ?? null,
    },
  )
  if (error) throw new Error(error.message || 'Не удалось забронировать материал для перемещения')
}

export async function reserveInventoryForMachine(input: {
  materialId: string
  machineId: string
  quantity: number
  requestItemTable: string
  requestItemId: string
  secondaryQuantity?: number | null
  materialVariantId?: string | null
  pieceLengthMm?: number | null
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc('fn_reserve_inventory_for_machine', {
    p_material_id: input.materialId,
    p_machine_id: input.machineId,
    p_quantity: input.quantity,
    p_request_item_table: input.requestItemTable,
    p_request_item_id: input.requestItemId,
    p_reserved_by: actorId,
    p_secondary_quantity: input.secondaryQuantity ?? null,
    p_material_variant_id: input.materialVariantId ?? null,
    p_piece_length_mm: input.pieceLengthMm ?? null,
  })
  if (error) throw new Error(error.message || 'Не удалось забронировать материал')
}

export async function adjustInventoryRecord(input: {
  inventoryId: string
  newTotal: number
  comment: string
  newSecondaryTotal?: number | null
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc('fn_adjust_inventory_record', {
    p_inventory_id: input.inventoryId,
    p_new_total: input.newTotal,
    p_performed_by: actorId,
    p_comment: input.comment,
    p_new_secondary_total: input.newSecondaryTotal ?? null,
  })
  if (error) throw new Error(error.message || 'Не удалось скорректировать остаток')
}

export async function archiveInventoryItem(input: {
  inventoryId: string
  comment: string
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc('fn_archive_inventory_item', {
    p_inventory_id: input.inventoryId,
    p_performed_by: actorId,
    p_comment: input.comment,
  })
  if (error) throw new Error(error.message || 'Не удалось удалить материал со склада')
}

export async function unreserveInventoryReservation(input: {
  reservationId: string
  comment: string
}) {
  const { userId: actorId } = await getCurrentUserContext()
  const { error } = await secureRpcClient().rpc('fn_unreserve_inventory_reservation', {
    p_reservation_id: input.reservationId,
    p_performed_by: actorId,
    p_comment: input.comment,
  })
  if (error) throw new Error(error.message || 'Не удалось снять складскую бронь')
}

export async function promoteDueFutureBusinessScrap() {
  const { data, error } = await secureRpcClient().rpc(
    'fn_promote_due_future_business_scrap',
    {},
  )
  if (error) throw new Error(error.message || 'Не удалось актуализировать будущие деловые остатки')
  return Number(data || 0)
}
