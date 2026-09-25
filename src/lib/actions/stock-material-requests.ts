'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- migration-bound Supabase RPCs and relations */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { assertFactoryAccess, canAccessAllFactories } from '@/lib/permissions/factory-scope'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestNumbers } from '@/lib/server/technologist-request-numbers'
import { loadTechnologistRequestPayload } from '@/lib/technologist-requests/request-payload'
import { snapshotFromSource, withSheetSteelTypeNames } from '@/lib/server/technologist-approval-snapshot'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { TechnologistRequest } from '@/lib/types'

const uuid = z.string().uuid()
const inputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  factoryId: uuid,
  neededBy: z.iso.date().nullable(),
})

type StockRequest = Pick<TechnologistRequest,
  'id' | 'title' | 'factory_id' | 'needed_by' | 'created_by' | 'status' | 'created_at'> & {
  request_number: number
  display_revision_number: number
}

function refresh(requestId?: string) {
  revalidatePath(ROUTES.MATERIAL_REQUESTS)
  revalidatePath(ROUTES.TECHNOLOGIST_REQUEST_RESULTS)
  revalidatePath(ROUTES.SUPPLY_ORDERS)
  if (requestId) revalidatePath(`${ROUTES.MATERIAL_REQUESTS}/stock/${requestId}`)
}

async function requireStockAccess(requestId: string, operation: 'view' | 'manage') {
  const admin = createAdminClient() as any
  const { data, error } = await admin.from('technologist_requests').select('*')
    .eq('id', uuid.parse(requestId)).eq('request_kind', 'stock').maybeSingle()
  if (error || !data) throw new Error('Заявка на склад не найдена')
  const techAccess = await requirePermission('technologist_requests', operation).catch(() => null)
  let assigned = false
  if (techAccess && !techAccess.permissionDetails.isAdminPosition && data.created_by !== techAccess.userId) {
    const { data: tasks, error: taskError } = await admin.from('tasks')
      .select('technologist_request_approval_id')
      .eq('assigned_to', techAccess.userId).eq('task_type', 'technologist_request_revision')
      .in('status', ['pending', 'in_progress'])
    if (taskError) throw taskError
    const versionIds = ((tasks || []) as Array<{ technologist_request_approval_id: string | null }>)
      .flatMap((task) => task.technologist_request_approval_id ? [task.technologist_request_approval_id] : [])
    const versions = versionIds.length ? await admin.from('technologist_request_approval_versions')
      .select('id').eq('request_id', data.id).in('id', versionIds).limit(1) : { data: [], error: null }
    if (versions.error) throw versions.error
    assigned = Boolean(versions.data?.length)
  }
  let access = techAccess
  if (techAccess && (techAccess.permissionDetails.isAdminPosition || data.created_by === techAccess.userId || assigned)) {
    assertFactoryAccess(techAccess, 'technologist_requests', operation, data.factory_id)
  } else if (operation === 'view' && ['submitted_to_supply', 'completed'].includes(data.status)) {
    access = await requirePermission('supply_orders', 'view')
    assertFactoryAccess(access, 'supply_orders', 'view', data.factory_id)
  } else throw new Error('Заявка недоступна')
  if (!access) throw new Error('Заявка недоступна')
  return { access, admin, request: data as TechnologistRequest, assigned }
}

export async function getStockMaterialRequests() {
  try {
    const access = await requirePermission('material_request_queue', 'view')
    const admin = createAdminClient() as any
    let query = admin.from('technologist_requests')
      .select('id,title,factory_id,needed_by,created_by,status,created_at')
      .eq('request_kind', 'stock').order('created_at', { ascending: false })
    if (!access.permissionDetails.isAdminPosition) query = query.eq('created_by', access.userId)
    const { data, error } = await query
    if (error) throw error
    const rows = (data || []) as StockRequest[]
    const numbers = await getRequestNumbers(rows.map((row) => row.id))
    const factoriesQuery = admin.from('factories').select('id,name').order('name')
    const canCreate = Boolean(access.permissionDetails.permissions.technologist_requests?.canManage)
    const factories = !canCreate ? { data: [], error: null }
      : canAccessAllFactories(access, 'technologist_requests', 'manage')
      ? await factoriesQuery
      : access.factoryId ? await factoriesQuery.eq('id', access.factoryId) : { data: [], error: null }
    if (factories.error) throw factories.error
    return {
      data: {
        items: rows.map((row) => ({
          ...row,
          request_number: numbers.get(row.id)!.request_number,
          display_revision_number: Math.max(...Object.values(numbers.get(row.id)!.revision_numbers)),
        })) as StockRequest[],
        factories: factories.data || [],
        canCreate,
      },
      error: null,
    }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function getStockMaterialRequest(requestId: string) {
  try {
    const { request, admin, access, assigned } = await requireStockAccess(requestId, 'view')
    const [payload, numbering, latest, factory] = await Promise.all([
      loadTechnologistRequestPayload(admin, request),
      getRequestNumbers([request.id]),
      admin.from('technologist_request_approval_versions').select('state')
        .eq('request_id', request.id).order('revision_number', { ascending: false }).limit(1),
      admin.from('factories').select('name').eq('id', request.factory_id!).single(),
    ])
    if (latest.error) throw latest.error
    if (factory.error) throw factory.error
    const number = numbering.get(request.id)!
    return { data: {
      payload,
      number: number.request_number,
      revision: Math.max(...Object.values(number.revision_numbers)),
      approvalState: latest.data?.[0]?.state || null,
      factoryName: factory.data?.name || 'Завод',
      canManage: Boolean(access && access.permissionDetails.permissions.technologist_requests?.canManage
        && (request.created_by === access.userId || access.permissionDetails.isAdminPosition || assigned)),
    }, error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function createStockMaterialRequest(input: z.input<typeof inputSchema>) {
  try {
    const values = inputSchema.parse(input)
    const access = await requirePermission('technologist_requests', 'manage')
    assertFactoryAccess(access, 'technologist_requests', 'manage', values.factoryId)
    const { data, error } = await (access.supabase as any).from('technologist_requests').insert({
      request_kind: 'stock', machine_id: null, factory_id: values.factoryId,
      title: values.title, needed_by: values.neededBy,
      created_by: access.userId, status: 'draft',
    }).select('id').single()
    if (error || !data) throw new Error(error?.message || 'Не удалось создать заявку')
    refresh(data.id)
    return { success: true, requestId: data.id }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function updateStockMaterialRequest(requestId: string, input: z.input<typeof inputSchema>) {
  try {
    const values = inputSchema.parse(input)
    const { request, admin } = await requireStockAccess(requestId, 'manage')
    if (request.status !== 'draft') throw new Error('Изменить можно только черновик')
    if (request.factory_id !== values.factoryId) throw new Error('Завод заявки нельзя менять')
    const { error } = await admin.from('technologist_requests')
      .update({ title: values.title, needed_by: values.neededBy }).eq('id', requestId)
    if (error) throw error
    refresh(requestId)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}

export async function submitStockMaterialRequest(requestId: string) {
  try {
    const { access, admin, request } = await requireStockAccess(requestId, 'manage')
    if (request.status !== 'draft') throw new Error('Отправить можно только черновик')
    const { data: source, error: sourceError } = await admin.rpc('fn_technologist_approval_source', { p_request_id: request.id })
    if (sourceError) throw sourceError
    const completion = { decision: 'none' as const, enteredPlasmaMinutes: 0, wasteItems: [], futureItems: [], archives: [] }
    const base = snapshotFromSource(source as Record<string, Array<Record<string, unknown>>>, request.id,
      { id: '', name: request.title, material_type: 'standard' }, completion)
    const summary = await withSheetSteelTypeNames(admin, {
      ...base, requestKind: 'stock', machineId: '', factoryId: request.factory_id,
      neededBy: request.needed_by,
    })
    const { error } = await (access.supabase as any).rpc('fn_submit_stock_request_for_approval', {
      p_request_id: request.id, p_actor: access.userId, p_summary_snapshot: summary,
    })
    if (error) throw error
    refresh(requestId)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
