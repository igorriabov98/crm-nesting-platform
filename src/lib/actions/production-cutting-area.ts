'use server'

/* eslint-disable @typescript-eslint/no-explicit-any -- Tables are generated after the migration is applied. */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import {
  assertFactoryAccess,
  canAccessAllFactories,
} from '@/lib/permissions/factory-scope'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { loadTechnologistRequestPayload } from '@/lib/technologist-requests/request-payload'
import type { TechnologistRequest } from '@/lib/types'
import {
  cuttingAreaFileCategory,
  isCuttingAreaFileForItem,
  type CuttingAreaFileBinding,
  type CuttingAreaFileCategory,
  type CuttingAreaItemFileBinding,
} from '@/lib/production-cutting-area/files'

export type CuttingAreaQueueStatus = 'waiting' | 'in_progress' | 'completed'

export type CuttingAreaSectionOption = {
  id: string
  factoryId: string
  label: string
}

export type CuttingAreaOrder = {
  machineId: string
  name: string
  factoryId: string
  factoryName: string
  productionMonth: string | null
  plannedStartDate: string | null
  completedRequestCount: number
  requestCount: number
  totalActualMinutes: number
  queueStatus: CuttingAreaQueueStatus
  cycleId: string | null
  cycleNumber: number | null
  canStart: boolean
  startBlocker: string | null
}

export type CuttingAreaWorkspace = {
  orders: CuttingAreaOrder[]
  sections: CuttingAreaSectionOption[]
  canManage: boolean
  today: string
}

export type CuttingAreaArchive = {
  id: string
  fileName: string
  fileSize: number
  uploadedAt: string
  uploadedByName: string
  downloadUrl: string
}

export type CuttingAreaRequestDetails = {
  id: string
  number: number
  createdAt: string
  authorName: string
  status: string
  completion: null | { enteredMinutes: number; addedMinutes: number; actualMinutes: number; finalizedAt: string }
  archives: CuttingAreaArchive[]
}

export type CuttingAreaOrderFile = {
  id: string
  kind: 'product' | 'project' | 'production_drawing'
  category: CuttingAreaFileCategory
  label: string
  fileName: string
  downloadUrl: string
}

export type CuttingAreaOrderDetails = {
  requests: CuttingAreaRequestDetails[]
  items: Array<{
    id: string
    productName: string
    drawingNumber: string
    quantity: number
    files: CuttingAreaOrderFile[]
  }>
}

function admin() { return createAdminClient() as any }
const CUTTING_AREA_RESOURCE = 'production_cutting_area' as const

function kyivDateOnly() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

async function loadCoveredRequestIds(db: any, requestIds: string[]) {
  if (requestIds.length === 0) return new Set<string>()
  const snapshots = await db
    .from('production_cutting_cycle_requests')
    .select('request_id,production_cutting_cycles!inner(status)')
    .in('request_id', requestIds)
    .neq('production_cutting_cycles.status', 'cancelled')
  if (snapshots.error) throw new Error(snapshots.error.message)
  return new Set((snapshots.data || []).map((row: any) => row.request_id as string))
}

export async function getProductionCuttingAreaRequest(machineId: string, requestId: string) {
  try {
    const parsed = z.object({
      machineId: z.string().uuid(),
      requestId: z.string().uuid(),
    }).parse({ machineId, requestId })
    const permission = await requirePermission('production_cutting_area', 'view')
    const db = admin()

    const machineResult = await db
      .from('machines')
      .select('id,name,factory_id')
      .eq('id', parsed.machineId)
      .eq('is_confirmed', true)
      .eq('is_archived', false)
      .maybeSingle()
    if (machineResult.error) throw new Error(machineResult.error.message)
    if (!machineResult.data) throw new Error('Заказ не найден')
    assertFactoryAccess(permission, CUTTING_AREA_RESOURCE, 'view', machineResult.data.factory_id)

    const [stageResult, requestResult, steelTypesResult] = await Promise.all([
      db.from('production_stages').select('id').eq('machine_id', parsed.machineId).eq('stage_type', 'cutting').eq('is_skipped', false).limit(1).maybeSingle(),
      db.from('technologist_requests').select('*').eq('id', parsed.requestId).eq('machine_id', parsed.machineId).maybeSingle(),
      db.from('steel_types').select('*').order('name'),
    ])
    for (const result of [stageResult, requestResult, steelTypesResult]) {
      if (result.error) throw new Error(result.error.message)
    }
    if (!stageResult.data) throw new Error('Заказ не относится к участку заготовки')
    if (!requestResult.data) throw new Error('Заявка не найдена')

    const request = requestResult.data as TechnologistRequest
    const payload = await loadTechnologistRequestPayload(db, request)
    return {
      success: true as const,
      data: {
        machine: { id: machineResult.data.id as string, name: machineResult.data.name as string },
        request: payload,
        steelTypes: steelTypesResult.data || [],
      },
      error: null,
    }
  } catch (error) {
    return { success: false as const, data: null, error: getErrorMessage(error) }
  }
}

export async function getProductionCuttingAreaWorkspace(): Promise<CuttingAreaWorkspace> {
  const permission = await requirePermission('production_cutting_area', 'view')
  const db = admin()
  const canSeeAllFactories = canAccessAllFactories(permission, CUTTING_AREA_RESOURCE, 'view')
  if (!canSeeAllFactories && !permission.factoryId) {
    return {
      orders: [],
      sections: [],
      canManage: permission.permissions.production_cutting_area?.canManage || false,
      today: kyivDateOnly(),
    }
  }
  let machineQuery = db.from('machines')
    .select('id,name,factory_id,status,production_month,factories(name)')
    .eq('is_confirmed', true)
    .eq('is_archived', false)
  if (!canSeeAllFactories) machineQuery = machineQuery.eq('factory_id', permission.factoryId)
  const machineResult = await machineQuery.order('name')
  if (machineResult.error) throw new Error(machineResult.error.message)
  const machines = machineResult.data || []
  const machineIds = machines.map((machine: any) => machine.id as string)
  if (machineIds.length === 0) return { orders: [], sections: [], canManage: permission.permissions.production_cutting_area?.canManage || false, today: kyivDateOnly() }

  const [stageResult, requestResult, completionResult, cycleResult, sectionResult] = await Promise.all([
    db.from('production_stages').select('machine_id,date_start,is_skipped').in('machine_id', machineIds).eq('stage_type', 'cutting'),
    db.from('technologist_requests').select('id,machine_id,created_at,status').in('machine_id', machineIds).order('created_at'),
    db.from('technologist_request_completions').select('id,request_id,machine_id,actual_plasma_minutes,state').in('machine_id', machineIds).eq('state', 'finalized'),
    db.from('production_cutting_cycles').select('id,machine_id,cycle_number,status,started_at').in('machine_id', machineIds).order('started_at', { ascending: false }),
    db.from('production_fact_sections').select('id,factory_id,parent_id,name,is_active,archived_at,production_stage_type').eq('is_active', true).is('archived_at', null).order('sort_order'),
  ])
  for (const result of [stageResult, requestResult, completionResult, cycleResult, sectionResult]) {
    if (result.error) throw new Error(result.error.message)
  }

  const stageByMachine = new Map((stageResult.data || []).filter((stage: any) => !stage.is_skipped).map((stage: any) => [stage.machine_id, stage]))
  const visibleMachines = machines.filter((machine: any) => stageByMachine.has(machine.id))
  const requests = requestResult.data || []
  const completions = completionResult.data || []
  const completionByRequest = new Map(completions.map((completion: any) => [completion.request_id, completion]))
  const covered = await loadCoveredRequestIds(db, requests.map((request: any) => request.id))
  const cyclesByMachine = new Map<string, any[]>()
  for (const cycle of cycleResult.data || []) {
    const rows = cyclesByMachine.get(cycle.machine_id) || []
    rows.push(cycle)
    cyclesByMachine.set(cycle.machine_id, rows)
  }

  const orders = visibleMachines.map((machine: any): CuttingAreaOrder => {
    const machineRequests = requests.filter((request: any) => request.machine_id === machine.id)
    const unprocessed = machineRequests.filter((request: any) => !covered.has(request.id))
    const machineCycles = cyclesByMachine.get(machine.id) || []
    const active = machineCycles.find((cycle) => cycle.status === 'in_progress') || null
    const latest = machineCycles[0] || null
    const unfinished = unprocessed.filter((request: any) => !completionByRequest.has(request.id))
    const stage = stageByMachine.get(machine.id) as any
    let queueStatus: CuttingAreaQueueStatus = 'waiting'
    if (active) queueStatus = 'in_progress'
    else if (unprocessed.length === 0 && latest?.status === 'completed') queueStatus = 'completed'
    const startBlocker = active
      ? 'Машина уже находится в работе'
      : !stage?.date_start
        ? 'Не указана дата начала Заготовки'
        : unprocessed.length === 0
          ? 'Нет новых заявок для цикла'
          : unfinished.length > 0
            ? `Не завершено заявок: ${unfinished.length}`
            : null
    const factory = Array.isArray(machine.factories) ? machine.factories[0] : machine.factories
    return {
      machineId: machine.id,
      name: machine.name,
      factoryId: machine.factory_id,
      factoryName: factory?.name || 'Завод',
      productionMonth: machine.production_month || null,
      plannedStartDate: stage?.date_start || null,
      completedRequestCount: machineRequests.filter((request: any) => completionByRequest.has(request.id)).length,
      requestCount: machineRequests.length,
      totalActualMinutes: completions.filter((completion: any) => completion.machine_id === machine.id).reduce((sum: number, completion: any) => sum + Number(completion.actual_plasma_minutes || 0), 0),
      queueStatus,
      cycleId: active?.id || latest?.id || null,
      cycleNumber: active?.cycle_number || latest?.cycle_number || null,
      canStart: !startBlocker,
      startBlocker,
    }
  })

  const rawSections = sectionResult.data || []
  const sectionById = new Map(rawSections.map((section: any) => [section.id, section]))
  const sections = rawSections.filter((section: any) => {
    if (!canSeeAllFactories && section.factory_id !== permission.factoryId) return false
    if (!section.parent_id) return false
    const parent = sectionById.get(section.parent_id) as any
    return (section.production_stage_type || parent?.production_stage_type) === 'cutting'
  }).map((section: any): CuttingAreaSectionOption => {
    const parent = sectionById.get(section.parent_id) as any
    return { id: section.id, factoryId: section.factory_id, label: parent ? `${parent.name} · ${section.name}` : section.name }
  })

  return { orders, sections, canManage: permission.permissions.production_cutting_area?.canManage || false, today: kyivDateOnly() }
}

export async function getProductionCuttingAreaDetails(machineId: string) {
  try {
    const id = z.string().uuid().parse(machineId)
    const permission = await requirePermission('production_cutting_area', 'view')
    const db = admin()
    const machine = await db.from('machines').select('id,factory_id').eq('id', id).eq('is_archived', false).maybeSingle()
    if (machine.error || !machine.data) throw new Error('Заказ не найден')
    assertFactoryAccess(permission, CUTTING_AREA_RESOURCE, 'view', machine.data.factory_id)
    const [requestResult, itemResult] = await Promise.all([
      db.from('technologist_requests').select('id,created_by,created_at,status').eq('machine_id', id).order('created_at').order('id'),
      db.from('machine_items').select('id,product_id,product_version_id,product_project_id,product_project_version_id,product_name,product_name_uk,product_drawing_number,drawing_number,quantity,is_sample').eq('machine_id', id).eq('is_sample', false).order('sort_order'),
    ])
    if (requestResult.error) throw new Error(requestResult.error.message)
    if (itemResult.error) throw new Error(itemResult.error.message)
    const requests = requestResult.data || []
    const items = itemResult.data || []
    const requestIds = requests.map((request: any) => request.id)
    const productIds = Array.from(new Set(items.map((item: any) => item.product_id).filter(Boolean))) as string[]
    const projectIds = Array.from(new Set(items.map((item: any) => item.product_project_id).filter(Boolean))) as string[]
    const [completionResult, archiveResult, currentVersionResult, projectResult] = await Promise.all([
      requestIds.length ? db.from('technologist_request_completions').select('id,request_id,entered_plasma_minutes,added_plasma_minutes,actual_plasma_minutes,finalized_at,state').in('request_id', requestIds).eq('state', 'finalized') : { data: [], error: null },
      requestIds.length ? db.from('machine_cutting_archives').select('id,request_id,file_name,file_size,uploaded_at,uploaded_by').in('request_id', requestIds).order('uploaded_at', { ascending: false }) : { data: [], error: null },
      productIds.length ? db.from('product_versions').select('id,product_id').in('product_id', productIds).eq('status', 'current') : { data: [], error: null },
      projectIds.length ? db.from('product_projects').select('id,approved_version_id').in('id', projectIds) : { data: [], error: null },
    ])
    for (const result of [completionResult, archiveResult, currentVersionResult, projectResult]) if (result.error) throw new Error(result.error.message)

    const currentVersionByProduct = new Map((currentVersionResult.data || []).map((version: any) => [version.product_id, version.id]))
    const approvedVersionByProject = new Map((projectResult.data || []).map((project: any) => [project.id, project.approved_version_id]))
    const itemBindings = new Map<string, CuttingAreaItemFileBinding>(items.map((item: any) => [item.id, {
      productId: item.product_id || null,
      productVersionId: item.product_version_id || currentVersionByProduct.get(item.product_id) || null,
      productProjectId: item.product_project_id || null,
      productProjectVersionId: item.product_project_version_id || approvedVersionByProject.get(item.product_project_id) || null,
    }]))
    const productVersionIds = Array.from(new Set(Array.from(itemBindings.values()).map((item) => item.productVersionId).filter(Boolean))) as string[]
    const [productFileResult, projectFileResult, drawingResult] = await Promise.all([
      productIds.length ? db.from('product_files').select('id,product_id,product_version_id,file_name,file_kind,created_at').in('product_id', productIds).in('file_kind', ['drawing','step','pdf']).order('created_at', { ascending: false }) : { data: [], error: null },
      projectIds.length ? db.from('product_project_files').select('id,project_id,version_id,file_name,file_kind,created_at').in('project_id', projectIds).neq('file_kind', 'photo').order('created_at', { ascending: false }) : { data: [], error: null },
      productVersionIds.length ? db.from('product_production_drawings').select('id,file_name,product_version_id,created_at').in('product_version_id', productVersionIds).order('created_at', { ascending: false }) : { data: [], error: null },
    ])
    for (const result of [productFileResult, projectFileResult, drawingResult]) if (result.error) throw new Error(result.error.message)

    type FileCandidate = CuttingAreaOrderFile & { binding: CuttingAreaFileBinding; createdAt: string }
    const fileCandidates: FileCandidate[] = [
      ...(productFileResult.data || []).map((file: any): FileCandidate => {
        const binding: CuttingAreaFileBinding = { kind: 'product', productId: file.product_id, productVersionId: file.product_version_id, fileKind: file.file_kind }
        return { id: file.id, kind: 'product', category: cuttingAreaFileCategory(binding), label: 'Файл изделия', fileName: file.file_name, downloadUrl: `/api/production/cutting-area/files/product/${file.id}?machineId=${id}`, binding, createdAt: file.created_at }
      }),
      ...(projectFileResult.data || []).map((file: any): FileCandidate => {
        const binding: CuttingAreaFileBinding = { kind: 'project', productProjectId: file.project_id, productProjectVersionId: file.version_id, fileKind: file.file_kind }
        return { id: file.id, kind: 'project', category: cuttingAreaFileCategory(binding), label: 'Файл проекта', fileName: file.file_name, downloadUrl: `/api/production/cutting-area/files/project/${file.id}?machineId=${id}`, binding, createdAt: file.created_at }
      }),
      ...(drawingResult.data || []).map((file: any): FileCandidate => {
        const binding: CuttingAreaFileBinding = { kind: 'production_drawing', productVersionId: file.product_version_id, fileKind: 'pdf' }
        return { id: file.id, kind: 'production_drawing', category: cuttingAreaFileCategory(binding), label: 'Комплект для производства', fileName: file.file_name, downloadUrl: `/api/production/cutting-area/files/production_drawing/${file.id}?machineId=${id}`, binding, createdAt: file.created_at }
      }),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

    const userIds = Array.from(new Set([...requests.map((request: any) => request.created_by), ...(archiveResult.data || []).map((archive: any) => archive.uploaded_by)]))
    const users = userIds.length ? await db.from('users').select('id,full_name,email').in('id', userIds) : { data: [], error: null }
    if (users.error) throw new Error(users.error.message)
    const userNames = new Map((users.data || []).map((user: any) => [user.id, user.full_name || user.email || 'Пользователь']))
    const completionByRequest = new Map((completionResult.data || []).map((completion: any) => [completion.request_id, completion]))
    const details: CuttingAreaOrderDetails = {
      requests: requests.map((request: any, index: number) => {
        const completion = completionByRequest.get(request.id) as any
        return {
          id: request.id, number: index + 1, createdAt: request.created_at,
          authorName: userNames.get(request.created_by) || 'Технолог', status: request.status,
          completion: completion ? { enteredMinutes: completion.entered_plasma_minutes, addedMinutes: completion.added_plasma_minutes, actualMinutes: completion.actual_plasma_minutes, finalizedAt: completion.finalized_at } : null,
          archives: (archiveResult.data || []).filter((archive: any) => archive.request_id === request.id).map((archive: any) => ({
            id: archive.id, fileName: archive.file_name, fileSize: Number(archive.file_size), uploadedAt: archive.uploaded_at,
            uploadedByName: userNames.get(archive.uploaded_by) || 'Пользователь',
            downloadUrl: `/api/production/cutting-area/archives/${archive.id}?machineId=${id}`,
          })),
        }
      }),
      items: items.map((item: any) => {
        const binding = itemBindings.get(item.id)!
        return {
          id: item.id,
          productName: item.product_name_uk || item.product_name,
          drawingNumber: item.product_drawing_number || item.drawing_number,
          quantity: item.quantity,
          files: fileCandidates
            .filter((file) => isCuttingAreaFileForItem(binding, file.binding))
            .map((file) => ({
              id: file.id,
              kind: file.kind,
              category: file.category,
              label: file.label,
              fileName: file.fileName,
              downloadUrl: file.downloadUrl,
            })),
        }
      }),
    }
    return { success: true as const, data: details, error: null }
  } catch (error) { return { success: false as const, data: null, error: getErrorMessage(error) } }
}

const startSchema = z.object({
  machineId: z.string().uuid(), factoryId: z.string().uuid(), sectionId: z.string().uuid(),
  shift: z.enum(['day','night']), factDate: z.string().date(),
})

async function unprocessedRequestIds(db: any, machineId: string) {
  const requests = await db.from('technologist_requests').select('id,created_at').eq('machine_id', machineId).order('created_at').order('id')
  if (requests.error) throw new Error(requests.error.message)
  const rows = requests.data || []
  const covered = await loadCoveredRequestIds(db, rows.map((request: any) => request.id))
  return rows.filter((request: any) => !covered.has(request.id)).map((request: any) => request.id)
}

export async function startProductionCuttingCycle(input: z.input<typeof startSchema>) {
  try {
    const parsed = startSchema.parse(input)
    const permission = await requirePermission('production_cutting_area', 'manage')
    const { userId } = permission
    if (parsed.factDate !== kyivDateOnly()) throw new Error('Фактическая дата должна быть сегодняшней')
    const db = admin()
    const machine = await db.from('machines').select('factory_id').eq('id', parsed.machineId).eq('is_archived', false).maybeSingle()
    if (machine.error || !machine.data) throw new Error('Заказ не найден')
    if (machine.data.factory_id !== parsed.factoryId) throw new Error('Заказ не принадлежит выбранному заводу')
    assertFactoryAccess(permission, CUTTING_AREA_RESOURCE, 'manage', machine.data.factory_id)
    const requestIds = await unprocessedRequestIds(db, parsed.machineId)
    const { data, error } = await db.rpc('fn_start_production_cutting_cycle', {
      p_machine_id: parsed.machineId, p_factory_id: parsed.factoryId, p_section_id: parsed.sectionId,
      p_fact_date: parsed.factDate, p_shift: parsed.shift, p_request_ids: requestIds, p_actor: userId,
    })
    if (error) throw new Error(error.message)
    revalidatePath(ROUTES.PRODUCTION_CUTTING_AREA)
    revalidatePath(ROUTES.PRODUCTION_FACT)
    revalidatePath(`${ROUTES.SALES_PLAN}/${parsed.machineId}`)
    return { success: true as const, data, error: null }
  } catch (error) { return { success: false as const, data: null, error: getErrorMessage(error) } }
}

export async function completeProductionCuttingCycle(cycleId: string) {
  try {
    const id = z.string().uuid().parse(cycleId)
    const permission = await requirePermission('production_cutting_area', 'manage')
    const db = admin()
    const cycle = await db.from('production_cutting_cycles').select('factory_id').eq('id', id).maybeSingle()
    if (cycle.error || !cycle.data) throw new Error('Цикл не найден')
    assertFactoryAccess(permission, CUTTING_AREA_RESOURCE, 'manage', cycle.data.factory_id)
    const { error } = await db.rpc('fn_complete_production_cutting_cycle', { p_cycle_id: id, p_actor: permission.userId })
    if (error) throw new Error(error.message)
    revalidatePath(ROUTES.PRODUCTION_CUTTING_AREA)
    return { success: true as const, error: null }
  } catch (error) { return { success: false as const, error: getErrorMessage(error) } }
}

export async function reopenProductionCuttingCycle(input: { cycleId: string; reason: string }) {
  try {
    const parsed = z.object({ cycleId: z.string().uuid(), reason: z.string().trim().min(3).max(500) }).parse(input)
    const permission = await requirePermission('production_cutting_area', 'manage')
    const db = admin()
    const cycle = await db.from('production_cutting_cycles').select('factory_id').eq('id', parsed.cycleId).maybeSingle()
    if (cycle.error || !cycle.data) throw new Error('Цикл не найден')
    assertFactoryAccess(permission, CUTTING_AREA_RESOURCE, 'manage', cycle.data.factory_id)
    const { error } = await db.rpc('fn_reopen_production_cutting_cycle', { p_cycle_id: parsed.cycleId, p_reason: parsed.reason, p_actor: permission.userId })
    if (error) throw new Error(error.message)
    revalidatePath(ROUTES.PRODUCTION_CUTTING_AREA)
    return { success: true as const, error: null }
  } catch (error) { return { success: false as const, error: getErrorMessage(error) } }
}
