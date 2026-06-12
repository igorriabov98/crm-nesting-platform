'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import {
  bulkUpdateComponentStock,
  bulkUpdateKnifeStock,
  bulkUpdatePaintStock,
} from '@/lib/actions/technologist-requests'
import type { RequestComponents, RequestKnives, RequestPaint, RequestStatus, UserRole } from '@/lib/types'
import type { AvailabilityInput } from '@/lib/types/request-schemas'

type DbResult = { data: unknown; error: { message?: string } | null }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  single: () => Promise<DbResult>
  update: (values: Record<string, unknown>) => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

export type ProcurementCheckListItem = {
  requestId: string
  machineId: string
  machineName: string
  status: RequestStatus
  totalKnives: number
  uncheckedKnives: number
  totalComponents: number
  uncheckedComponents: number
}

export type PaintingCheckListItem = {
  requestId: string
  machineId: string
  machineName: string
  status: RequestStatus
  totalPaint: number
  uncheckedPaint: number
}

async function requireStockRole(allowed: UserRole[]) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('ÐÐµÐ¾Ð±Ñ…Ð¾Ð´Ð¸Ð¼Ð° Ð°Ð²Ñ‚Ð¾Ñ€Ð¸Ð·Ð°Ñ†Ð¸Ñ')

  const { data: profile, error } = await supabase
    .from('users')
    .select('id, role, full_name')
    .eq('id', user.id)
    .single()

  if (error || !profile) throw new Error('ÐŸÑ€Ð¾Ñ„Ð¸Ð»ÑŒ Ð¿Ð¾Ð»ÑŒÐ·Ð¾Ð²Ð°Ñ‚ÐµÐ»Ñ Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½')
  const current = profile as unknown as { id: string; role: UserRole; full_name: string }
  const roleAllowed = allowed.includes(current.role) || DIRECTOR_ROLES.includes(current.role)
  if (!roleAllowed) throw new Error('ÐÐµÐ´Ð¾ÑÑ‚Ð°Ñ‚Ð¾Ñ‡Ð½Ð¾ Ð¿Ñ€Ð°Ð²')

  return { db: supabase as unknown as LooseDb, user: current }
}

async function getRequests(db: LooseDb) {
  const { data, error } = await db
    .from('technologist_requests')
    .select('id, machine_id, status, machines(name)')
    .in('status', ['pending_stock_check', 'stock_checked'])
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð·Ð°ÑÐ²ÐºÐ¸')
  return (data || []) as { id: string; machine_id: string; status: RequestStatus; machines: { name: string } | null }[]
}

async function getSectionRows<T>(db: LooseDb, table: string, requestId: string) {
  const { data, error } = await db
    .from(table)
    .select('*')
    .eq('request_id', requestId)
    .order('sort_order')
    .order('created_at')

  if (error) throw new Error(error.message || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¿Ð¾Ð·Ð¸Ñ†Ð¸Ð¸')
  return (data || []) as T[]
}

async function getRequestHeader(db: LooseDb, requestId: string) {
  const { data, error } = await db
    .from('technologist_requests')
    .select('id, machine_id, status, machines(name)')
    .eq('id', requestId)
    .single()

  if (error || !data) throw new Error('Ð—Ð°ÑÐ²ÐºÐ° Ð½Ðµ Ð½Ð°Ð¹Ð´ÐµÐ½Ð°')
  return data as { id: string; machine_id: string; status: RequestStatus; machines: { name: string } | null }
}


export async function getProcurementCheckList() {
  try {
    const { db } = await requireStockRole(['procurement_head'])
    const requests = await getRequests(db)
    const result: ProcurementCheckListItem[] = []

    for (const request of requests) {
      const [knives, components] = await Promise.all([
        getSectionRows<RequestKnives>(db, 'request_knives', request.id),
        getSectionRows<RequestComponents>(db, 'request_components', request.id),
      ])

      if (knives.length === 0 && components.length === 0) continue
      result.push({
        requestId: request.id,
        machineId: request.machine_id,
        machineName: request.machines?.name || 'ÐœÐ°ÑˆÐ¸Ð½Ð°',
        status: request.status,
        totalKnives: knives.length,
        uncheckedKnives: knives.filter((item) => item.stock_remainder_mm === null).length,
        totalComponents: components.length,
        uncheckedComponents: components.filter((item) => item.stock_remainder === null || !item.availability || item.availability === 'unknown').length,
      })
    }

    return { data: result, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÐ¸' }
  }
}

export async function getProcurementCheckDetail(requestId: string) {
  try {
    const { db } = await requireStockRole(['procurement_head'])
    const request = await getRequestHeader(db, requestId)
    const [knives, components] = await Promise.all([
      getSectionRows<RequestKnives>(db, 'request_knives', requestId),
      getSectionRows<RequestComponents>(db, 'request_components', requestId),
    ])

    return {
      data: {
        request,
        machine: { id: request.machine_id, name: request.machines?.name || 'ÐœÐ°ÑˆÐ¸Ð½Ð°' },
        knives,
        components,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÑƒ' }
  }
}

export async function saveProcurementCheck(
  requestId: string,
  knives: { id: string; stock_remainder_mm: number }[],
  components: { id: string; stock_remainder: number; availability: AvailabilityInput }[]
) {
  try {
    const { db } = await requireStockRole(['procurement_head'])
    const request = await getRequestHeader(db, requestId)

    const knifeResult = await bulkUpdateKnifeStock(knives)
    if (!knifeResult.success) throw new Error(knifeResult.error || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ Ð½Ð¾Ð¶Ð¸')
    const componentResult = await bulkUpdateComponentStock(components)
    if (!componentResult.success) throw new Error(componentResult.error || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ ÐºÐ¾Ð¼Ð¿Ð»ÐµÐºÑ‚Ð°Ñ†Ð¸ÑŽ')

    revalidatePath('/stock-check/procurement')
    revalidatePath(`/stock-check/procurement/${requestId}`)
    revalidatePath(`/sales-plan/${request.machine_id}/request`)
    return { success: true, data: { complete: false } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÑƒ' }
  }
}

export async function getPaintingCheckList() {
  try {
    const { db } = await requireStockRole(['painting_head'])
    const requests = await getRequests(db)
    const result: PaintingCheckListItem[] = []

    for (const request of requests) {
      const paint = await getSectionRows<RequestPaint>(db, 'request_paint', request.id)
      if (paint.length === 0) continue
      result.push({
        requestId: request.id,
        machineId: request.machine_id,
        machineName: request.machines?.name || 'ÐœÐ°ÑˆÐ¸Ð½Ð°',
        status: request.status,
        totalPaint: paint.length,
        uncheckedPaint: paint.filter((item) => item.stock_remainder_kg === null).length,
      })
    }

    return { data: result, error: null }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÐ¸' }
  }
}

export async function getPaintingCheckDetail(requestId: string) {
  try {
    const { db } = await requireStockRole(['painting_head'])
    const request = await getRequestHeader(db, requestId)
    const paint = await getSectionRows<RequestPaint>(db, 'request_paint', requestId)

    return {
      data: {
        request,
        machine: { id: request.machine_id, name: request.machines?.name || 'ÐœÐ°ÑˆÐ¸Ð½Ð°' },
        paint,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ Ð·Ð°Ð³Ñ€ÑƒÐ·Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÑƒ' }
  }
}

export async function savePaintingCheck(requestId: string, paint: { id: string; stock_remainder_kg: number }[]) {
  try {
    const { db } = await requireStockRole(['painting_head'])
    const request = await getRequestHeader(db, requestId)

    const paintResult = await bulkUpdatePaintStock(paint)
    if (!paintResult.success) throw new Error(paintResult.error || 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ ÐºÑ€Ð°ÑÐºÑƒ')

    revalidatePath('/stock-check/painting')
    revalidatePath(`/stock-check/painting/${requestId}`)
    revalidatePath(`/sales-plan/${request.machine_id}/request`)
    return { success: true, data: { complete: false } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'ÐÐµ ÑƒÐ´Ð°Ð»Ð¾ÑÑŒ ÑÐ¾Ñ…Ñ€Ð°Ð½Ð¸Ñ‚ÑŒ Ð¿Ñ€Ð¾Ð²ÐµÑ€ÐºÑƒ' }
  }
}
