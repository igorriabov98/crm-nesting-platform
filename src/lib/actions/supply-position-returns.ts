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
    const { data, error } = await (createAdminClient() as unknown as ReturnRpcClient).rpc('fn_cancel_returned_supply_position_v1', {
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

    revalidatePath(ROUTES.REQUESTS)
    revalidatePath(ROUTES.TECHNOLOGIST_DEPARTMENT_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_ORDERS)
    if (result.department_request_id) revalidatePath(`/requests/detail/${result.department_request_id}`)
    return { success: true, data: result }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Не удалось отменить возвращённую позицию',
    }
  }
}
