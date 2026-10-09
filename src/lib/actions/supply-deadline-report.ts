'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'

const ITEM_TABLES = new Set([
  'request_sheet_metal', 'request_round_tube', 'request_circle', 'request_pipe',
  'request_knives', 'request_components', 'request_paint', 'request_mesh', 'request_chain_cord',
])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SupplyDeadlineExclusionInput = {
  targetKind: 'item' | 'schedule'
  requestItemTable: string
  requestItemId: string
  scheduleId: string | null
  active: boolean
  reason: string
}

export async function setSupplyDeadlineExclusion(input: SupplyDeadlineExclusionInput) {
  try {
    const context = await requirePermission('supply_deadline_report', 'manage')
    const reason = input.reason.trim()
    if (!ITEM_TABLES.has(input.requestItemTable) || !UUID.test(input.requestItemId)
      || (input.targetKind !== 'item' && input.targetKind !== 'schedule')
      || (input.targetKind === 'schedule') !== Boolean(input.scheduleId)
      || (input.scheduleId && !UUID.test(input.scheduleId))
      || typeof input.active !== 'boolean' || reason.length < 3 || reason.length > 2000) {
      throw new Error('Укажите корректную позицию и причину от 3 до 2000 символов')
    }
    const { data, error } = await (context.supabase as unknown as {
      rpc: (name: string, params: Record<string, unknown>) => Promise<{
        data: unknown; error: { message?: string } | null
      }>
    }).rpc('fn_set_supply_deadline_exclusion', {
      p_target_kind: input.targetKind,
      p_request_item_table: input.requestItemTable,
      p_request_item_id: input.requestItemId,
      p_schedule_id: input.scheduleId,
      p_active: input.active,
      p_reason: reason,
    })
    if (error) throw new Error(error.message || 'Не удалось сохранить исключение')
    const result = data as { id?: string; active?: boolean } | null
    if (!result?.id || result.active !== input.active) throw new Error('Сервер не подтвердил изменение исключения')
    revalidatePath(ROUTES.REPORTS_SUPPLY_DEADLINES)
    return { success: true as const }
  } catch (error) {
    console.error('[supply-deadline-report] exclusion failed', {
      targetKind: input.targetKind, itemTable: input.requestItemTable, itemId: input.requestItemId,
      scheduleId: input.scheduleId, error,
    })
    return { success: false as const, error: error instanceof Error ? error.message : 'Не удалось сохранить исключение' }
  }
}
