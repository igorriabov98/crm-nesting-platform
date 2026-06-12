'use server'

import { revalidatePath } from 'next/cache'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import type { MachineStatus } from '@/lib/types'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  single: () => Promise<DbResult>
  update: (values: Record<string, unknown>) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

const STATUS_ORDER: MachineStatus[] = [
  'created',
  'confirmed',
  'planned',
  'request_ready',
  'purchasing',
  'material_received',
  'in_production',
  'shipped',
]

function canTransitionInternal(currentStatus: MachineStatus, targetStatus: MachineStatus) {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus)
  const targetIdx = STATUS_ORDER.indexOf(targetStatus)
  return currentIdx >= 0 && targetIdx > currentIdx
}

async function requireProductionManage() {
  const { supabase } = await requirePermission('production', 'manage')
  return { db: supabase as unknown as LooseDb }
}

export async function canTransitionTo(currentStatus: MachineStatus, targetStatus: MachineStatus) {
  return canTransitionInternal(currentStatus, targetStatus)
}

export async function getStatusHistory(machineId: string) {
  void machineId
  return { data: [], error: null }
}

export async function manualStatusUpdate(machineId: string, newStatus: MachineStatus) {
  try {
    const { db } = await requireProductionManage()
    const { data, error } = await db
      .from('machines')
      .select('id, status')
      .eq('id', machineId)
      .single()

    if (error || !data) throw new Error('Машина не найдена')
    const machine = data as { id: string; status: MachineStatus }

    if (!canTransitionInternal(machine.status, newStatus)) {
      throw new Error('Статус можно менять только вперёд по цепочке')
    }

    const { error: updateError } = await db
      .from('machines')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', machineId)

    if (updateError) throw new Error(updateError.message || 'Не удалось обновить статус машины')

    revalidatePath(ROUTES.SALES_PLAN)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)

    return { success: true }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось обновить статус машины' }
  }
}
