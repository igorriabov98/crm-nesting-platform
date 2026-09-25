'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- approval schema is introduced by the accompanying migration */

import { getRequestNumbers } from '@/lib/server/technologist-request-numbers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { snapshotFromSource, withSheetSteelTypeNames, withApprovalProcurement } from '@/lib/server/technologist-approval-snapshot'
import {
  compareApprovalSnapshots,
} from '@/lib/technologist-request-approval'

const requestIdSchema = z.string().uuid()
const versionIdSchema = z.string().uuid()
const returnSchema = z.object({ versionId: versionIdSchema, reason: z.string().trim().min(3).max(2000) })

function db() { return createAdminClient() as any }

export async function getTechnologistApprovalList() {
  try {
    const { userId, permissionDetails } = await requirePermission('technologist_request_results', 'view')
    const head = await db().rpc('fn_technologist_approval_department_head', { p_name: 'Финансовый отдел' })
    if (head.error) throw head.error
    const reviewer = head.data === userId
    const isAdmin = permissionDetails.isAdminPosition
    const assigned = !reviewer && !isAdmin ? await db().from('tasks')
      .select('approval_version:technologist_request_approval_versions!tasks_technologist_request_approval_id_fkey(request_id)')
      .eq('assigned_to', userId).eq('task_type', 'technologist_request_revision') : { data: [], error: null }
    if (assigned.error) throw assigned.error
    const assignedIds = new Set((assigned.data || []).map((row: any) => row.approval_version?.request_id).filter(Boolean))
    const requests = db().from('technologist_requests')
      .select('id,machine_id,request_kind,title,factory_id,needed_by,created_by,status,created_at,machines(id,name,material_type)')
      .order('created_at', { ascending: false })
    if (!reviewer && !isAdmin) {
      if (assignedIds.size > 0) requests.or(`created_by.eq.${userId},id.in.(${[...assignedIds].join(',')})`)
      else requests.eq('created_by', userId)
    }
    const requestResult = await requests
    if (requestResult.error) throw requestResult.error
    const visibleRequests = requestResult.data || []
    const requestIds = visibleRequests.map((row: any) => row.id)
    const versions = requestIds.length
      ? await db().from('technologist_request_approval_versions').select('id,request_id,revision_number,state,material_type_snapshot:summary_snapshot->>materialType,sheet_scrap_items:summary_snapshot->items').in('request_id', requestIds).order('revision_number', { ascending: false })
      : { data: [], error: null }
    if (versions.error) throw versions.error
    const numbering = await getRequestNumbers(requestIds)
    return {
      data: visibleRequests.map((request: any) => {
        const numbers = numbering.get(request.id)!
        const current = (versions.data || []).find((version: any) => version.request_id === request.id)
        return {
          ...request,
          request_number: numbers.request_number,
          display_revision_number: Math.max(...Object.values(numbers.revision_numbers)),
          currentVersion: current ? { ...current, display_revision_number: numbers.revision_numbers[current.revision_number],
            sheetScrapSummary: (Array.isArray(current.sheet_scrap_items) ? current.sheet_scrap_items : []).reduce((sum: { quantity: number; weightKg: number }, item: any) => {
              if (item.category !== 'request_sheet_metal') return sum
              for (const scrap of item.futureSheetScraps || []) {
                sum.quantity += Number(scrap.quantity || 0)
                sum.weightKg += Number(scrap.weightKg || 0)
              }
              return sum
            }, { quantity: 0, weightKg: 0 }),
          } : null,
        }
      }),
      error: null,
    }
  } catch (error) {
    return { data: [], error: getErrorMessage(error) }
  }
}

export async function getTechnologistApprovalDetail(requestId: string) {
  try {
    const id = requestIdSchema.parse(requestId)
    const { userId, permissionDetails } = await requirePermission('technologist_request_results', 'view')
    const requestResult = await db().from('technologist_requests')
      .select('id,machine_id,request_kind,title,factory_id,needed_by,created_by,status,created_at,machines(id,name,material_type),users!technologist_requests_created_by_fkey(full_name)')
      .eq('id', id).maybeSingle()
    if (requestResult.error) throw new Error(requestResult.error.message || 'Не удалось прочитать заявку')
    if (!requestResult.data) throw new Error('Заявка не найдена')
    const head = await db().rpc('fn_technologist_approval_department_head', { p_name: 'Финансовый отдел' })
    if (head.error) throw head.error
    const reviewer = head.data === userId
    const isAdmin = permissionDetails.isAdminPosition
    const revisionTasks = await db().from('tasks').select('technologist_request_approval_id').eq('assigned_to', userId)
      .eq('task_type', 'technologist_request_revision').in('status', ['pending', 'in_progress'])
    if (revisionTasks.error) throw revisionTasks.error
    const assignedVersionIds = (revisionTasks.data || []).map((task: any) => task.technologist_request_approval_id).filter(Boolean)
    const assignedVersion = assignedVersionIds.length ? await db().from('technologist_request_approval_versions')
      .select('id').eq('request_id', id).in('id', assignedVersionIds).limit(1) : { data: [], error: null }
    if (assignedVersion.error) throw assignedVersion.error
    const assignedRevision = (assignedVersion.data || []).length > 0
    if (!isAdmin && !reviewer && requestResult.data.created_by !== userId && !assignedRevision) throw new Error('Недостаточно прав для просмотра заявки')
    const versionsResult = await db().from('technologist_request_approval_versions')
      .select('id,revision_number,state,is_legacy,submitted_by')
      .eq('request_id', id).order('revision_number', { ascending: false })
    if (versionsResult.error) throw versionsResult.error
    const order = Array.isArray(requestResult.data.machines) ? requestResult.data.machines[0] : requestResult.data.machines
    const latestId = versionsResult.data?.[0]?.id
    const latestResult = latestId ? await db().from('technologist_request_approval_versions').select('*').eq('id', latestId).single() : { data: null, error: null }
    if (latestResult.error) throw latestResult.error
    const latest = latestResult.data
    const storedSummary = latest?.summary_snapshot
    if (latest?.summary_snapshot?.sourceData && order) {
      const stored = latest.summary_snapshot
      latest.summary_snapshot = snapshotFromSource(stored.sourceData, id, { id: stored.machineId, name: stored.orderName, material_type: stored.materialType }, latest.completion_payload)
    }
    const currentDraft = ['returned','superseded'].includes(latest?.state)
    let currentSnapshot = latest?.summary_snapshot || null
    if (currentDraft && (order || requestResult.data.request_kind === 'stock')) {
      const source = await db().rpc('fn_technologist_approval_source', { p_request_id: id })
      if (source.error) throw source.error
      const request = requestResult.data
      currentSnapshot = request.request_kind === 'stock'
        ? {
          ...snapshotFromSource(source.data, id, { id: '', name: request.title, material_type: 'standard' },
            { decision: 'none', enteredPlasmaMinutes: 0, wasteItems: [], futureItems: [], archives: [] }),
          requestKind: 'stock', factoryId: request.factory_id, neededBy: request.needed_by,
        }
        : snapshotFromSource(source.data, id, order!, latest.completion_payload)
    }
    currentSnapshot = await withApprovalProcurement(db(), await withSheetSteelTypeNames(db(), currentSnapshot, currentDraft ? null : storedSummary), currentDraft ? null : storedSummary)
    const sheetPlans = !currentDraft && latest?.state === 'approved'
      ? await db().from('technologist_sheet_scrap_plans').select('source_item_id,line_number,inventory_id').eq('request_id', id)
      : { data: [], error: null }
    if (sheetPlans.error) throw sheetPlans.error
    const inventoryIds = (sheetPlans.data || []).map((row: any) => row.inventory_id)
    const sheetInventories = inventoryIds.length
      ? await db().from('inventory').select('id,business_scrap_state').in('id', inventoryIds)
      : { data: [], error: null }
    if (sheetInventories.error) throw sheetInventories.error
    const statesByInventory = new Map((sheetInventories.data || []).map((row: any) => [row.id, row.business_scrap_state]))
    const sheetScrapStates = Object.fromEntries((sheetPlans.data || []).map((row: any) => [
      `${row.source_item_id}:${row.line_number}`, statesByInventory.get(row.inventory_id),
    ]))
    const versions = versionsResult.data || []
    const draft = await db().from('technologist_request_revision_drafts')
      .select('revision_number,editor_id').eq('request_id', id).maybeSingle()
    if (draft.error) throw draft.error
    const numbering = (await getRequestNumbers([id])).get(id)!
    const firstSubmitter = versions.find((version: any) => version.revision_number === 0)?.submitted_by
    return {
      data: {
        request: { ...requestResult.data, request_number: numbering.request_number },
        versions: versions.map((version: any) => ({ id: version.id, revision_number: version.revision_number, display_revision_number: numbering.revision_numbers[version.revision_number], state: version.state, is_legacy: version.is_legacy })),
        currentSnapshot,
        sheetScrapStates,
        currentDraft,
        canReview: reviewer || isAdmin,
        revisionDraft: draft.data
          ? { ...draft.data, display_revision_number: numbering.revision_numbers[draft.data.revision_number] }
          : !versions.length && numbering.revision_numbers[0] > 0
            ? { revision_number: 0, display_revision_number: numbering.revision_numbers[0], editor_id: requestResult.data.created_by }
            : null,
        canEdit: (isAdmin || firstSubmitter === userId || requestResult.data.created_by === userId || assignedRevision)
          && (requestResult.data.request_kind === 'stock'
            ? ['pending_financial_approval', 'draft'].includes(requestResult.data.status)
            : ['pending_financial_approval', 'pending_stock_check', 'stock_checked'].includes(requestResult.data.status))
          && versions.length > 0,
      },
      error: null,
    }
  } catch (error) {
    return { data: null, error: getErrorMessage(error) }
  }
}

export async function getTechnologistApprovalHistoryVersion(requestId: string, versionId: string) {
  try {
    const id = requestIdSchema.parse(requestId)
    const version = versionIdSchema.parse(versionId)
    const detail = await getTechnologistApprovalDetail(id)
    if (!detail.data) throw new Error(detail.error || 'Заявка недоступна')
    const result = await db().from('technologist_request_approval_versions').select('*').eq('id', version).eq('request_id', id).single()
    if (result.error || !result.data) throw new Error('Версия не найдена')
    const stored = result.data
    const machine = Array.isArray(detail.data.request.machines) ? detail.data.request.machines[0] : detail.data.request.machines
    const summary = stored.summary_snapshot?.sourceData && machine
      ? snapshotFromSource(stored.summary_snapshot.sourceData, id, { id: stored.summary_snapshot.machineId, name: stored.summary_snapshot.orderName, material_type: stored.summary_snapshot.materialType }, stored.completion_payload)
      : stored.summary_snapshot
    const enrichedSummary = await withApprovalProcurement(db(), await withSheetSteelTypeNames(db(), summary, stored.summary_snapshot), stored.summary_snapshot)
    return { data: {
      summary: enrichedSummary,
      reason: stored.return_reason as string | null,
      diff: enrichedSummary?.items && detail.data.currentSnapshot?.items ? compareApprovalSnapshots(enrichedSummary, detail.data.currentSnapshot) : null,
    }, error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

function revalidateApproval(requestId: string) {
  revalidatePath(ROUTES.TECHNOLOGIST_REQUEST_RESULTS)
  revalidatePath(`${ROUTES.TECHNOLOGIST_REQUEST_RESULTS}/${requestId}`)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.MATERIAL_REQUESTS)
  revalidatePath(ROUTES.SUPPLY_MATERIAL_REQUESTS)
  revalidatePath(ROUTES.SUPPLY_ORDERS)
  revalidatePath(ROUTES.REQUESTS)
  revalidatePath(ROUTES.TECHNOLOGIST_DEPARTMENT_REQUESTS)
  revalidatePath(ROUTES.NOTIFICATIONS)
}

export async function beginTechnologistRequestRevision(requestId: string) {
  try {
    const id = requestIdSchema.parse(requestId)
    const { userId, supabase } = await requirePermission('technologist_request_results', 'view')
    const request = await db().from('technologist_requests').select('machine_id,request_kind').eq('id', id).single()
    if (request.error || !request.data) throw new Error('Заявка не найдена')
    if (request.data?.request_kind === 'stock') {
      const { error } = await (supabase as any).rpc('fn_begin_stock_request_revision', { p_request_id: id, p_actor: userId })
      if (error) throw error
      revalidateApproval(id)
      return { success: true, href: `${ROUTES.MATERIAL_REQUESTS}/stock/${id}` }
    }
    const { error } = await (supabase as any).rpc('fn_begin_technologist_request_revision', { p_request_id: id, p_actor: userId })
    if (error) throw error
    revalidateApproval(id)
    return { success: true, href: `${ROUTES.SALES_PLAN}/${request.data?.machine_id}/request/${id}` }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function returnTechnologistRequest(input: z.input<typeof returnSchema>) {
  try {
    const parsed = returnSchema.parse(input)
    const { userId, supabase } = await requirePermission('technologist_request_results', 'view')
    const version = await db().from('technologist_request_approval_versions').select('request_id,technologist_requests(request_kind)').eq('id', parsed.versionId).single()
    if (version.error || !version.data) throw new Error('Версия не найдена')
    const stock = (version.data.technologist_requests as { request_kind?: string } | null)?.request_kind === 'stock'
    const { error } = await (supabase as any).rpc(stock ? 'fn_return_stock_request_for_revision' : 'fn_return_technologist_request_for_revision', {
      [stock ? 'p_version_id' : 'p_approval_version_id']: parsed.versionId, p_actor: userId, p_reason: parsed.reason,
    })
    if (error) throw error
    revalidateApproval(version.data.request_id)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function approveTechnologistRequest(versionId: string) {
  try {
    const id = versionIdSchema.parse(versionId)
    const { userId, supabase } = await requirePermission('technologist_request_results', 'view')
    const version = await db().from('technologist_request_approval_versions').select('request_id,technologist_requests(request_kind)').eq('id', id).single()
    if (version.error || !version.data) throw new Error('Версия не найдена')
    const stock = (version.data.technologist_requests as { request_kind?: string } | null)?.request_kind === 'stock'
    const { error } = await (supabase as any).rpc(stock ? 'fn_approve_stock_request' : 'fn_approve_technologist_request', {
      [stock ? 'p_version_id' : 'p_approval_version_id']: id, p_actor: userId,
    })
    if (error) throw error
    revalidateApproval(version.data.request_id)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
