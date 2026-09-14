'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- approval schema is introduced by the accompanying migration */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { snapshotFromSource } from '@/lib/server/technologist-approval-snapshot'
import {
  compareApprovalSnapshots,
  isFinancialApprovalReviewer,
} from '@/lib/technologist-request-approval'

const requestIdSchema = z.string().uuid()
const versionIdSchema = z.string().uuid()
const returnSchema = z.object({ versionId: versionIdSchema, reason: z.string().trim().min(3).max(2000) })

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
      ? await db().from('technologist_request_approval_versions').select('id,request_id,revision_number,state,material_type_snapshot:summary_snapshot->>materialType').in('request_id', requestIds).order('revision_number', { ascending: false })
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
      .select('id,revision_number,state,is_legacy')
      .eq('request_id', id).order('revision_number', { ascending: false })
    if (versionsResult.error) throw versionsResult.error
    const order = Array.isArray(requestResult.data.machines) ? requestResult.data.machines[0] : requestResult.data.machines
    const latestId = versionsResult.data?.[0]?.id
    const latestResult = latestId ? await db().from('technologist_request_approval_versions').select('*').eq('id', latestId).single() : { data: null, error: null }
    if (latestResult.error) throw latestResult.error
    const latest = latestResult.data
    if (latest?.is_legacy && latest.summary_snapshot?.sourceData && order) {
      const stored = latest.summary_snapshot
      latest.summary_snapshot = snapshotFromSource(stored.sourceData, id, { id: stored.machineId, name: stored.orderName, material_type: stored.materialType }, latest.completion_payload)
    }
    const currentDraft = ['returned','superseded'].includes(latest?.state)
    let currentSnapshot = latest?.summary_snapshot || null
    if (currentDraft && order) {
      const source = await db().rpc('fn_technologist_approval_source', { p_request_id: id })
      if (source.error) throw source.error
      currentSnapshot = snapshotFromSource(source.data, id, order, latest.completion_payload)
    }
    const versions = versionsResult.data || []
    return {
      data: {
        request: { ...requestResult.data, request_number: Math.max(requestNumber, 1) },
        versions: versions.map((version: any) => ({ id: version.id, revision_number: version.revision_number, state: version.state, is_legacy: version.is_legacy })),
        currentSnapshot,
        currentDraft,
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
    const summary = stored.is_legacy && stored.summary_snapshot?.sourceData && machine
      ? snapshotFromSource(stored.summary_snapshot.sourceData, id, { id: stored.summary_snapshot.machineId, name: stored.summary_snapshot.orderName, material_type: stored.summary_snapshot.materialType }, stored.completion_payload)
      : stored.summary_snapshot
    return { data: {
      summary,
      reason: stored.return_reason as string | null,
      diff: summary?.items && detail.data.currentSnapshot?.items ? compareApprovalSnapshots(summary, detail.data.currentSnapshot) : null,
    }, error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
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
    revalidateApproval(version.data.request_id)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
