'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- approval schema is introduced by the accompanying migration */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import {
  compareApprovalSnapshots,
  isFinancialApprovalReviewer,
  type ApprovalSummaryItem,
  type ApprovalSummarySnapshot,
} from '@/lib/technologist-request-approval'

const requestIdSchema = z.string().uuid()
const versionIdSchema = z.string().uuid()
const returnSchema = z.object({ versionId: versionIdSchema, reason: z.string().trim().min(3).max(2000) })

const CATEGORY_TABLES = [
  ['request_sheet_metal', 'Листовой металл'],
  ['request_round_tube', 'Круглая труба'],
  ['request_circle', 'Круг'],
  ['request_pipe', 'Труба, профиль и проволока'],
  ['request_knives', 'Ножи'],
  ['request_components', 'Комплектующие'],
  ['request_paint', 'Краска'],
  ['request_mesh', 'Сетка'],
  ['request_chain_cord', 'Цепь и шнур'],
] as const

type CompletionInput = {
  decision: 'has_items' | 'none'
  enteredPlasmaMinutes: number
  wasteItems: Array<{ sourceTable: string; sourceId: string; wastePercent: number }>
  futureItems: unknown[]
  archives: Array<{ objectPath: string; fileName: string; mimeType: string | null; fileSize: number }>
}

function numberOrNull(value: unknown) {
  const parsed = Number(value)
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null
}

function describeRow(table: string, row: Record<string, unknown>) {
  const name = [
    row.material_name, row.material_grade, row.steel_grade, row.pipe_type, row.knife_type,
    row.component_name, row.paint_name, row.mesh_type, row.chain_cord_type, row.size, row.sheet_size,
  ].filter(Boolean).join(' · ')
  const candidates: Array<[string, string]> = table === 'request_sheet_metal'
    ? [['quantity_sheets', 'лист.'], ['remainder_qty', 'лист.'], ['weight_order_kg', 'кг']]
    : table === 'request_components'
      ? [['quantity_needed', 'шт.']]
      : table === 'request_circle'
        ? [['remainder_mm', 'мм']]
        : table === 'request_pipe'
          ? [['remainder_length_mm', 'мм'], ['remainder_kg', 'кг'], ['remainder_qty', 'шт.']]
          : table === 'request_knives'
            ? [['to_order_mm', 'мм'], ['remainder_qty', 'шт.']]
            : table === 'request_chain_cord'
              ? [['remainder_meters', 'м']]
              : [['remainder_qty', 'шт.'], ['remainder_kg', 'кг'], ['order_kg', 'кг']]
  const selected = candidates.find(([field]) => numberOrNull(row[field]) !== null)
  return {
    name: name || `Позиция ${String(row.id).slice(0, 8)}`,
    quantity: selected ? numberOrNull(row[selected[0]]) : null,
    unit: selected?.[1] || '',
    weightKg: numberOrNull(row.calculated_weight_kg ?? row.weight_order_kg ?? row.order_kg),
  }
}

export async function buildTechnologistApprovalSnapshot(
  client: any,
  requestId: string,
  machine: { id: string; name: string | null; material_type: string | null },
  completion: CompletionInput,
): Promise<ApprovalSummarySnapshot> {
  const [tableResults, reservationsResult] = await Promise.all([
    Promise.all(CATEGORY_TABLES.map(async ([table]) => {
      const result = await client.from(table).select('*').eq('request_id', requestId).order('sort_order')
      if (result.error) throw result.error
      return result.data || []
    })),
    client.from('inventory_reservations')
      .select('request_item_table,request_item_id,reserved_quantity,logical_reserved_quantity,inventory_id,source_inventory_id,consumed_at,reservation_source')
      .eq('machine_id', machine.id)
      .is('consumed_at', null),
  ])
  if (reservationsResult.error) throw reservationsResult.error
  const inventoryIds = [...new Set((reservationsResult.data || []).flatMap((row: any) => [row.inventory_id, row.source_inventory_id]).filter(Boolean))]
  const inventoryResult = inventoryIds.length
    ? await client.from('inventory').select('id,is_business_scrap').in('id', inventoryIds)
    : { data: [], error: null }
  if (inventoryResult.error) throw inventoryResult.error
  const inventoryById = new Map((inventoryResult.data || []).map((row: any) => [row.id, Boolean(row.is_business_scrap)]))
  const wasteByKey = new Map(completion.wasteItems.map((item) => [`${item.sourceTable}:${item.sourceId}`, item.wastePercent]))
  const reservations = reservationsResult.data || []

  const items: ApprovalSummaryItem[] = []
  CATEGORY_TABLES.forEach(([table, categoryLabel], index) => {
    for (const raw of tableResults[index] as Record<string, unknown>[]) {
      if (raw.order_status === 'cancelled' || raw.is_cutting_plan_draft === true) continue
      const key = `${table}:${raw.id}`
      const rowReservations = reservations.filter((reservation: any) => `${reservation.request_item_table}:${reservation.request_item_id}` === key && reservation.reservation_source !== 'correction_hold')
      const reservationTotal = (business: boolean) => rowReservations
        .filter((reservation: any) => Boolean(inventoryById.get(reservation.source_inventory_id || reservation.inventory_id)) === business)
        .reduce((sum: number, reservation: any) => sum + Number(reservation.logical_reserved_quantity ?? reservation.reserved_quantity ?? 0), 0)
      const described = describeRow(table, raw)
      items.push({
        key, category: table, categoryLabel, ...described,
        businessScrapReserved: reservationTotal(true),
        regularStockReserved: reservationTotal(false),
        wastePercent: wasteByKey.get(key) ?? null,
      })
    }
  })
  return {
    schemaVersion: 1,
    requestId,
    machineId: machine.id,
    orderName: machine.name || 'Без названия',
    materialType: machine.material_type,
    items,
    futureItems: completion.futureItems,
    enteredPlasmaMinutes: completion.enteredPlasmaMinutes,
    archives: completion.archives,
  }
}

function db() { return createAdminClient() as any }

export async function getTechnologistApprovalList() {
  try {
    const { userId, role, permissionDetails } = await requirePermission('technologist_request_results', 'view')
    const reviewer = isFinancialApprovalReviewer(role, permissionDetails.isAdminPosition)
    let requests = db().from('technologist_requests')
      .select('id,machine_id,created_by,status,created_at,machines(id,name,material_type)')
      .order('created_at', { ascending: false })
    if (!reviewer) requests = requests.eq('created_by', userId)
    const requestResult = await requests
    if (requestResult.error) throw requestResult.error
    const requestIds = (requestResult.data || []).map((row: any) => row.id)
    const machineIds = [...new Set((requestResult.data || []).map((row: any) => row.machine_id))]
    const numberRows = machineIds.length
      ? await db().from('technologist_requests').select('id,machine_id,created_at').in('machine_id', machineIds).order('created_at', { ascending: true }).order('id', { ascending: true })
      : { data: [], error: null }
    if (numberRows.error) throw numberRows.error
    const requestNumberById = new Map<string, number>()
    const indexByMachine = new Map<string, number>()
    for (const row of numberRows.data || []) {
      const next = (indexByMachine.get(row.machine_id) || 0) + 1
      indexByMachine.set(row.machine_id, next)
      requestNumberById.set(row.id, next)
    }
    const versions = requestIds.length
      ? await db().from('technologist_request_approval_versions').select('*').in('request_id', requestIds).order('revision_number', { ascending: false })
      : { data: [], error: null }
    if (versions.error) throw versions.error
    return {
      data: (requestResult.data || []).map((request: any) => ({
        ...request,
        request_number: requestNumberById.get(request.id) || 1,
        currentVersion: (versions.data || []).find((version: any) => version.request_id === request.id) || null,
      })).filter((request: any) => request.currentVersion !== null),
      error: null,
    }
  } catch (error) {
    return { data: [], error: getErrorMessage(error) }
  }
}

export async function getTechnologistApprovalDetail(requestId: string) {
  try {
    const id = requestIdSchema.parse(requestId)
    const { userId, role, permissionDetails } = await requirePermission('technologist_request_results', 'view')
    const requestResult = await db().from('technologist_requests')
      .select('id,machine_id,created_by,status,created_at,machines(id,name,material_type),users!technologist_requests_created_by_fkey(full_name)')
      .eq('id', id).single()
    if (requestResult.error || !requestResult.data) throw new Error('Заявка не найдена')
    const reviewer = isFinancialApprovalReviewer(role, permissionDetails.isAdminPosition)
    if (!reviewer && requestResult.data.created_by !== userId) throw new Error('Заявка недоступна')
    const numberRows = await db().from('technologist_requests').select('id').eq('machine_id', requestResult.data.machine_id).order('created_at', { ascending: true }).order('id', { ascending: true })
    if (numberRows.error) throw numberRows.error
    const requestNumber = (numberRows.data || []).findIndex((row: any) => row.id === id) + 1
    const versionsResult = await db().from('technologist_request_approval_versions')
      .select('*,decider:users!technologist_request_approval_versions_decided_by_fkey(full_name)')
      .eq('request_id', id).order('revision_number', { ascending: false })
    if (versionsResult.error) throw versionsResult.error
    const versions = (versionsResult.data || []).map((version: any, index: number, all: any[]) => ({
      ...version,
      diffToCurrent: index === 0 || !version.summary_snapshot?.items || !all[0]?.summary_snapshot?.items
        ? null
        : compareApprovalSnapshots(version.summary_snapshot, all[0].summary_snapshot),
    }))
    return {
      data: {
        request: { ...requestResult.data, request_number: Math.max(requestNumber, 1) },
        versions,
        canReview: reviewer,
        canEdit: requestResult.data.created_by === userId
          && ['pending_financial_approval', 'pending_stock_check', 'stock_checked'].includes(requestResult.data.status)
          && versions.length > 0,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

function revalidateApproval(requestId: string) {
  revalidatePath(ROUTES.TECHNOLOGIST_REQUEST_RESULTS)
  revalidatePath(`${ROUTES.TECHNOLOGIST_REQUEST_RESULTS}/${requestId}`)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.MATERIAL_REQUESTS)
  revalidatePath(ROUTES.SUPPLY_MATERIAL_REQUESTS)
}

export async function beginTechnologistRequestRevision(requestId: string) {
  try {
    const id = requestIdSchema.parse(requestId)
    const { userId } = await requirePermission('technologist_request_results', 'view')
    const { error } = await db().rpc('fn_begin_technologist_request_revision', { p_request_id: id, p_actor: userId })
    if (error) throw error
    const request = await db().from('technologist_requests').select('machine_id').eq('id', id).single()
    revalidateApproval(id)
    return { success: true, href: `${ROUTES.BUSINESS_SCRAP_RESERVATIONS}/${request.data?.machine_id}` }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function returnTechnologistRequest(input: z.input<typeof returnSchema>) {
  try {
    const parsed = returnSchema.parse(input)
    const { userId, role, permissionDetails } = await requirePermission('technologist_request_results', 'manage')
    if (!isFinancialApprovalReviewer(role, permissionDetails.isAdminPosition)) throw new Error('Недостаточно прав')
    const version = await db().from('technologist_request_approval_versions').select('request_id').eq('id', parsed.versionId).single()
    if (version.error || !version.data) throw new Error('Версия не найдена')
    const { error } = await db().rpc('fn_return_technologist_request_for_revision', {
      p_approval_version_id: parsed.versionId, p_actor: userId, p_reason: parsed.reason,
    })
    if (error) throw error
    revalidateApproval(version.data.request_id)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function approveTechnologistRequest(versionId: string) {
  try {
    const id = versionIdSchema.parse(versionId)
    const { userId, role, permissionDetails } = await requirePermission('technologist_request_results', 'manage')
    if (!isFinancialApprovalReviewer(role, permissionDetails.isAdminPosition)) throw new Error('Недостаточно прав')
    const version = await db().from('technologist_request_approval_versions').select('request_id').eq('id', id).single()
    if (version.error || !version.data) throw new Error('Версия не найдена')
    const { error } = await db().rpc('fn_approve_technologist_request', { p_approval_version_id: id, p_actor: userId })
    if (error) throw error
    const request = await db().from('technologist_requests').select('machine_id').eq('id', version.data.request_id).single()
    if (request.data?.machine_id) {
      try {
        await db().rpc('notify_users_by_role', {
          p_role: 'supply_manager', p_type: 'technologist_request', p_title: 'Заявка одобрена и готова для снабжения',
          p_message: 'Финансовый директор одобрил итоговую версию заявки.', p_machine_id: request.data.machine_id,
        })
      } catch { /* decision is committed; notification is best-effort */ }
    }
    revalidateApproval(version.data.request_id)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
