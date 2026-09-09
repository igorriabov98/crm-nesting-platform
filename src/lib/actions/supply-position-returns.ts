'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import {
  SUPPLY_POSITION_TABLES,
  supplyPositionReturnError,
  type SupplyPositionTable,
} from '@/lib/supply-orders/position-revisions'
import { syncActualMaterialDatesForMachines } from '@/lib/actions/supply-orders'

const cancelSchema = z.object({
  table: z.enum(SUPPLY_POSITION_TABLES),
  itemId: z.string().uuid(),
  reason: z.string().trim().min(3, 'Укажите причину отмены').max(2000, 'Не больше 2000 символов'),
})

type CancelReturnedSupplyPositionResult = {
  success: boolean
  error?: string
  data?: {
    status: 'cancelled'
    idempotent: boolean
    mode: 'standard' | 'long_stock_recalculation'
    department_request_id?: string | null
  }
}

type ReturnRpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>
}

export async function cancelReturnedSupplyPosition(input: {
  table: SupplyPositionTable
  itemId: string
  reason: string
}): Promise<CancelReturnedSupplyPositionResult> {
  try {
    const parsed = cancelSchema.parse(input)
    const { userId } = await requirePermission('technologist_requests', 'view')
    const adminDb = createAdminClient()
    const { data: itemData, error: itemError } = await adminDb
      .from(parsed.table)
      .select('request_id')
      .eq('id', parsed.itemId)
      .single()
    if (itemError || !itemData) throw new Error(itemError?.message || 'Позиция снабжения не найдена')
    const item = itemData as unknown as { request_id: string }

    const { data: requestData, error: requestError } = await adminDb
      .from('technologist_requests')
      .select('machine_id')
      .eq('id', item.request_id)
      .single()
    if (requestError || !requestData) throw new Error(requestError?.message || 'Заявка снабжения не найдена')
    const request = requestData as unknown as { machine_id: string }

    const { data, error } = await (adminDb as unknown as ReturnRpcClient).rpc('fn_cancel_returned_supply_position_v1', {
      p_request_item_table: parsed.table,
      p_request_item_id: parsed.itemId,
      p_reason: parsed.reason,
      p_actor: userId,
    })
    if (error) {
      throw new Error(supplyPositionReturnError(error, 'Не удалось отменить возвращённую позицию').message)
    }
    const result = data as CancelReturnedSupplyPositionResult['data']
    if (!result || result.status !== 'cancelled') throw new Error('Сервер не подтвердил отмену позиции')
    await syncActualMaterialDatesForMachines([request.machine_id])

    revalidatePath(ROUTES.REQUESTS)
    revalidatePath(ROUTES.TECHNOLOGIST_DEPARTMENT_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${request.machine_id}`)
    if (result.department_request_id) revalidatePath(`/requests/detail/${result.department_request_id}`)
    return { success: true, data: result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось отменить возвращённую позицию',
    }
  }
}
