'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { getCommercialPermissionContext, requireOrderPriceManagement } from '@/lib/permissions/commercial-visibility'
import { getErrorMessage } from '@/lib/utils/get-error-message'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  single: () => Promise<DbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
  rpc: (fn: string, args: Record<string, unknown>) => Promise<DbResult>
}

const submitSchema = z.object({
  machineId: z.string().uuid(),
  discountPercent: z.coerce.number().min(0.01, 'Скидка должна быть не меньше 0,01%').max(50, 'Скидка не может превышать 50%'),
  reason: z.string().trim().min(3, 'Опишите причину скидки').max(2000),
})
const requestSchema = z.string().uuid()
const rejectSchema = z.object({
  requestId: z.string().uuid(),
  comment: z.string().trim().min(3, 'Укажите причину отклонения').max(2000),
})

function adminDb() {
  return createAdminClient() as unknown as LooseDb
}

async function requireMachinePriceManagement(machineId: string) {
  const context = await getCommercialPermissionContext()
  const { data, error } = await adminDb().from('machines').select('id, client_id').eq('id', machineId).single()
  if (error || !data) throw new Error('Заказ не найден')
  const machine = data as { id: string; client_id: string | null }
  if (!machine.client_id) throw new Error('У заказа не указан клиент')
  await requireOrderPriceManagement(machine.client_id, context)
  return context
}

async function requireDiscountDecisionAccess() {
  const context = await getCommercialPermissionContext()
  if (context.role !== 'financial_director' && !context.permissionDetails.isAdminPosition) {
    throw new Error('Решение по скидке доступно финансовому директору или администратору CRM')
  }
  return context
}

function revalidateDiscount(machineId?: string) {
  if (machineId) revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
  revalidatePath(ROUTES.SALES_PLAN)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.NOTIFICATIONS)
}

export async function submitMachineDiscountRequest(input: unknown) {
  try {
    const parsed = submitSchema.parse(input)
    const context = await requireMachinePriceManagement(parsed.machineId)
    const { data, error } = await adminDb().rpc('fn_submit_machine_discount_request', {
      p_machine_id: parsed.machineId,
      p_discount_percent: parsed.discountPercent,
      p_reason: parsed.reason,
      p_actor: context.userId,
    })
    if (error) throw new Error(error.message || 'Не удалось отправить скидку на согласование')
    revalidateDiscount(parsed.machineId)
    return { success: true as const, requestId: String(data), error: null }
  } catch (error) {
    return { success: false as const, requestId: null, error: getErrorMessage(error) }
  }
}

export type MachineDiscountApprovalPayload = {
  request: {
    id: string
    machine_id: string
    revision_number: number
    status: 'pending' | 'approved' | 'rejected' | 'superseded'
    discount_percent: number
    reason: string
    items_total_before_discount: number
    discount_amount: number
    discounted_items_total: number
    expenses_total: number
    total_before_discount: number
    total_after_discount: number
    submitted_at: string
    decision_comment: string | null
    machine: { id: string; name: string }
    client: { id: string; name: string }
    submitted_by_user: { id: string; full_name: string } | null
  }
}

export async function getMachineDiscountApproval(requestId: string) {
  try {
    const parsed = requestSchema.parse(requestId)
    await requireDiscountDecisionAccess()
    const { data, error } = await adminDb().from('machine_discount_requests').select(`
      id, machine_id, revision_number, status, discount_percent, reason,
      items_total_before_discount, discount_amount, discounted_items_total,
      expenses_total, total_before_discount, total_after_discount,
      submitted_at, decision_comment,
      machine:machines!machine_discount_requests_machine_id_fkey(id, name, client:clients(id, name)),
      submitted_by_user:users!machine_discount_requests_submitted_by_fkey(id, full_name)
    `).eq('id', parsed).single()
    if (error || !data) throw new Error(error?.message || 'Заявка на скидку не найдена')
    const raw = data as Record<string, unknown> & {
      machine: { id: string; name: string; client: { id: string; name: string } | Array<{ id: string; name: string }> } | Array<{ id: string; name: string; client: { id: string; name: string } | Array<{ id: string; name: string }> }>
      submitted_by_user: { id: string; full_name: string } | Array<{ id: string; full_name: string }> | null
    }
    const machine = Array.isArray(raw.machine) ? raw.machine[0] : raw.machine
    const client = Array.isArray(machine.client) ? machine.client[0] : machine.client
    const submitter = Array.isArray(raw.submitted_by_user) ? raw.submitted_by_user[0] : raw.submitted_by_user
    return {
      data: { request: {
        ...raw,
        machine: { id: machine.id, name: machine.name },
        client,
        submitted_by_user: submitter,
        discount_percent: Number(raw.discount_percent),
        items_total_before_discount: Number(raw.items_total_before_discount),
        discount_amount: Number(raw.discount_amount),
        discounted_items_total: Number(raw.discounted_items_total),
        expenses_total: Number(raw.expenses_total),
        total_before_discount: Number(raw.total_before_discount),
        total_after_discount: Number(raw.total_after_discount),
      } } as MachineDiscountApprovalPayload,
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function approveMachineDiscountRequest(requestId: string) {
  try {
    const parsed = requestSchema.parse(requestId)
    const context = await requireDiscountDecisionAccess()
    const details = await getMachineDiscountApproval(parsed)
    if (!details.data) throw new Error(details.error || 'Заявка на скидку не найдена')
    const { data, error } = await adminDb().rpc('fn_approve_machine_discount_request', {
      p_request_id: parsed,
      p_actor: context.userId,
    })
    if (error) throw new Error(error.message || 'Не удалось одобрить скидку')
    if (!data) {
      revalidateDiscount(details.data.request.machine_id)
      throw new Error('Заказ изменился. Заявка снята, требуется новое согласование')
    }
    revalidateDiscount(details.data.request.machine_id)
    return { success: true as const, error: null }
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error) }
  }
}

export async function rejectMachineDiscountRequest(input: unknown) {
  try {
    const parsed = rejectSchema.parse(input)
    const context = await requireDiscountDecisionAccess()
    const details = await getMachineDiscountApproval(parsed.requestId)
    if (!details.data) throw new Error(details.error || 'Заявка на скидку не найдена')
    const { error } = await adminDb().rpc('fn_reject_machine_discount_request', {
      p_request_id: parsed.requestId,
      p_actor: context.userId,
      p_comment: parsed.comment,
    })
    if (error) throw new Error(error.message || 'Не удалось отклонить скидку')
    revalidateDiscount(details.data.request.machine_id)
    return { success: true as const, error: null }
  } catch (error) {
    return { success: false as const, error: getErrorMessage(error) }
  }
}
