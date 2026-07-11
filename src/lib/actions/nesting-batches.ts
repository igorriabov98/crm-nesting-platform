'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { NESTING_QUEUE_LIMIT } from '@/lib/constants/performance-limits'
import { requirePermission } from '@/lib/permissions/server'
import { fetchNestingService as fetch, getNestingServiceUrl, getProjectStatus, markProjectSuperseded } from '@/lib/nesting/api'
import { isCompletedNestingStatus } from '@/lib/nesting/status'
import { getProductVersionNestingGuards, type ProductVersionNestingDb } from '@/lib/actions/product-version-nesting-guard'
import type { PermissionOperation } from '@/lib/permissions/resources'

type ActionResult<T> = {
  success: boolean
  data?: T
  error?: string
}

type DbResult = {
  data: unknown
  error: { message?: string } | null
}

type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string, options?: { count?: 'exact'; head?: boolean }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  upsert: (values: unknown, options?: { onConflict?: string }) => LooseQuery
}

type LooseDb = {
  from: (table: string) => LooseQuery
}

type MachineRow = {
  id: string
  name: string
  desired_shipping_date: string | null
  production_month: string | null
  created_at: string
  client?: { name?: string | null } | null
}

type MachineItemRow = {
  id: string
  machine_id: string
  product_id: string | null
  drawing_number: string | null
  product_name: string | null
  quantity: number
  is_sample: boolean
  sort_order: number
}

type ProductRow = {
  id: string
  name_uk: string
  drawing_number: string | null
  status: 'draft' | 'active' | 'archived'
}

type ProductFileRow = {
  id: string
  product_id: string
  file_kind: string
  file_name: string
  file_path: string
  mime_type: string | null
}

type TaskRow = {
  id: string
  machine_id: string | null
  deadline: string
  status: string
}

type RunRow = {
  id: string
  machine_id: string
  machine_item_id: string
  product_id: string
  step_file_id: string
  drawing_file_id: string
  nesting_project_id: string
  batch_id: string | null
  status: 'draft' | 'calculated' | 'imported' | 'error'
  error_message: string | null
  quantity_multiplier: number
  updated_at: string
}

type BatchRow = {
  id: string
  nesting_project_id: string
  order_number: string
  status: 'draft' | 'parsing' | 'parsed' | 'calculating' | 'done' | 'completed_with_warnings' | 'error'
  error_message: string | null
  source_nesting_project_id?: string | null
  is_future_fill?: boolean
}

type PrecutRow = {
  machine_item_id: string
  quantity: number
}

type ExistingRunLinkRow = Pick<RunRow, 'machine_item_id' | 'nesting_project_id'>

export type NestingQueueItem = {
  id: string
  productId: string | null
  drawingNumber: string | null
  productName: string
  quantity: number
  precutQuantity: number
  remainingQuantity: number
  productStatus: ProductRow['status'] | null
  stepFileCount: number
  drawingPdfFileCount: number
  run: {
    id: string
    nestingProjectId: string
    batchId: string | null
    status: RunRow['status']
    serviceStatus: string | null
    errorMessage: string | null
    updatedAt: string
  } | null
  selectable: boolean
  disabledReason: string | null
}

export type NestingQueueMachine = {
  id: string
  name: string
  clientName: string | null
  desiredShippingDate: string | null
  productionMonth: string | null
  createdAt: string
  taskDeadline: string | null
  taskStatus: string | null
  hasTechnologistTask: boolean
  drawingsConfirmed: boolean
  progress: {
    total: number
    done: number
    blocked: number
    selectable: number
  }
  items: NestingQueueItem[]
}

export type NestingQueueData = {
  scope: 'tasks' | 'all'
  machines: NestingQueueMachine[]
  totals: {
    machines: number
    items: number
    selectable: number
    done: number
    blocked: number
  }
}

const startBatchSchema = z.object({
  machineItemIds: z.array(z.string().uuid()).min(1).max(100),
  sourceNestingProjectId: z.string().min(1).optional().nullable(),
  futureMachineItemIds: z.array(z.string().uuid()).max(100).optional(),
})

async function requireNestingPermission(operation: PermissionOperation = 'view') {
  const { supabase, userId } = await requirePermission('nesting', operation)
  return { supabase, userId }
}

function isStepFile(file: ProductFileRow) {
  const name = file.file_name.toLowerCase()
  return file.file_kind === 'step' && (name.endsWith('.step') || name.endsWith('.stp'))
}

function isPdfDrawing(file: ProductFileRow) {
  const name = file.file_name.toLowerCase()
  const isPdfFile = name.endsWith('.pdf') || file.mime_type === 'application/pdf'
  return isPdfFile && (file.file_kind === 'pdf' || file.file_kind === 'drawing')
}

function fileIssue(stepCount: number, pdfCount: number) {
  if (stepCount !== 1 && pdfCount !== 1) return 'В карточке товара должен быть ровно один STEP и один PDF-чертеж'
  if (stepCount !== 1) return 'В карточке товара должен быть ровно один STEP-файл'
  if (pdfCount !== 1) return 'В карточке товара должен быть ровно один PDF-чертеж'
  return null
}

function serviceStatusToRunStatus(status: string): RunRow['status'] {
  if (isCompletedNestingStatus(status)) return 'calculated'
  if (status === 'error') return 'error'
  return 'draft'
}

function serviceStatusToBatchStatus(status: string): BatchRow['status'] {
  if (status === 'done' || status === 'completed_with_warnings' || status === 'error' || status === 'parsed' || status === 'calculating' || status === 'parsing') {
    return status
  }
  return 'draft'
}

async function readServiceError(response: Response) {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => '')
    return { error: text }
  }) as { error?: string; message?: string }
  return payload.error || payload.message || `Сервис раскладки вернул ошибку ${response.status}`
}

async function syncProjectStatuses(db: LooseDb, runs: RunRow[]) {
  const projectIds = Array.from(new Set(runs.map((run) => run.nesting_project_id).filter(Boolean)))
  const statusByProject = new Map<string, { status: string; errorMessage: string | null }>()

  await Promise.all(projectIds.map(async (projectId) => {
    try {
      const status = await getProjectStatus(projectId)
      statusByProject.set(projectId, {
        status: status.status,
        errorMessage: status.errorMessage,
      })
      await db
        .from('machine_item_nesting_runs')
        .update({
          status: serviceStatusToRunStatus(status.status),
          error_message: status.errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('nesting_project_id', projectId)

      await db
        .from('nesting_batches')
        .update({
          status: serviceStatusToBatchStatus(status.status),
          error_message: status.errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('nesting_project_id', projectId)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Сервис раскладки недоступен'
      statusByProject.set(projectId, { status: 'unavailable', errorMessage: message })
      await Promise.all([
        db
          .from('machine_item_nesting_runs')
          .update({
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq('nesting_project_id', projectId),
        db
          .from('nesting_batches')
          .update({
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq('nesting_project_id', projectId),
      ]).catch(() => undefined)
    }
  }))

  return statusByProject
}

async function fetchQueueRows(scope: 'tasks' | 'all') {
  const { supabase } = await requireNestingPermission('view')
  const db = supabase as unknown as LooseDb

  const activeTasksResult = await db
    .from('tasks')
    .select('id, machine_id, deadline, status')
    .eq('task_type', 'technologist_request')
    .in('status', ['pending', 'in_progress'])
    .order('deadline', { ascending: true })
    .limit(NESTING_QUEUE_LIMIT)

  if (activeTasksResult.error) throw new Error(activeTasksResult.error.message || 'Не удалось загрузить задачи технолога')
  const activeTasks = ((activeTasksResult.data || []) as TaskRow[]).filter((task) => task.machine_id)
  const taskMachineIds = Array.from(new Set(activeTasks.map((task) => task.machine_id).filter(Boolean))) as string[]

  let machineQuery = db
    .from('machines')
    .select('id, name, desired_shipping_date, production_month, created_at, client:clients(name)')
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(NESTING_QUEUE_LIMIT)

  if (scope === 'tasks') {
    if (taskMachineIds.length === 0) {
      return {
        db,
        machines: [] as MachineRow[],
        activeTasks,
        items: [] as MachineItemRow[],
        products: [] as ProductRow[],
        files: [] as ProductFileRow[],
        runs: [] as RunRow[],
        engineerTasks: [] as TaskRow[],
        precuts: [] as PrecutRow[],
        productVersionGuards: new Map(),
      }
    }
    machineQuery = machineQuery.in('id', taskMachineIds)
  }

  const machineResult = await machineQuery
  if (machineResult.error) throw new Error(machineResult.error.message || 'Не удалось загрузить машины')
  const machines = (machineResult.data || []) as MachineRow[]
  const machineIds = machines.map((machine) => machine.id)

  if (machineIds.length === 0) {
    return {
      db,
      machines,
      activeTasks,
      items: [] as MachineItemRow[],
      products: [] as ProductRow[],
      files: [] as ProductFileRow[],
      runs: [] as RunRow[],
      engineerTasks: [] as TaskRow[],
      precuts: [] as PrecutRow[],
      productVersionGuards: new Map(),
    }
  }

  const [itemsResult, engineerTasksResult] = await Promise.all([
    db
      .from('machine_items')
      .select('id, machine_id, product_id, drawing_number, product_name, quantity, is_sample, sort_order')
      .in('machine_id', machineIds)
      .order('sort_order', { ascending: true }),
    db
      .from('tasks')
      .select('id, machine_id, deadline, status')
      .eq('task_type', 'engineer_confirm')
      .eq('status', 'completed')
      .in('machine_id', machineIds),
  ])

  if (itemsResult.error) throw new Error(itemsResult.error.message || 'Не удалось загрузить позиции машин')
  if (engineerTasksResult.error) throw new Error(engineerTasksResult.error.message || 'Не удалось загрузить подтверждения инженера')

  const items = ((itemsResult.data || []) as MachineItemRow[]).filter((item) => !item.is_sample)
  const productIds = Array.from(new Set(items.map((item) => item.product_id).filter(Boolean))) as string[]
  const itemIds = items.map((item) => item.id)

  const [productsResult, filesResult, runsResult, precutsResult, productVersionGuards] = await Promise.all([
    productIds.length
      ? db.from('products').select('id, name_uk, drawing_number, status').in('id', productIds)
      : Promise.resolve({ data: [], error: null } as DbResult),
    productIds.length
      ? db.from('product_files').select('id, product_id, file_kind, file_name, file_path, mime_type').in('product_id', productIds)
      : Promise.resolve({ data: [], error: null } as DbResult),
    itemIds.length
      ? db.from('machine_item_nesting_runs').select('*').in('machine_item_id', itemIds)
      : Promise.resolve({ data: [], error: null } as DbResult),
    itemIds.length
      ? db.from('nesting_precut_parts').select('machine_item_id, quantity').in('machine_item_id', itemIds)
      : Promise.resolve({ data: [], error: null } as DbResult),
    productIds.length
      ? getProductVersionNestingGuards(db as ProductVersionNestingDb, productIds)
      : Promise.resolve(new Map()),
  ])

  if (productsResult.error) throw new Error(productsResult.error.message || 'Не удалось загрузить товары')
  if (filesResult.error) throw new Error(filesResult.error.message || 'Не удалось загрузить файлы товаров')
  if (runsResult.error) throw new Error(runsResult.error.message || 'Не удалось загрузить статусы раскладки')

  return {
    db,
    machines,
    activeTasks,
    items,
    products: (productsResult.data || []) as ProductRow[],
    files: (filesResult.data || []) as ProductFileRow[],
    runs: (runsResult.data || []) as RunRow[],
    engineerTasks: (engineerTasksResult.data || []) as TaskRow[],
    precuts: (precutsResult.data || []) as PrecutRow[],
    productVersionGuards,
  }
}

export async function getNestingQueue(scope: 'tasks' | 'all' = 'all'): Promise<ActionResult<NestingQueueData>> {
  try {
    const rows = await fetchQueueRows(scope)
    const statusByProject = await syncProjectStatuses(rows.db, rows.runs)
    const tasksByMachine = new Map<string, TaskRow>()
    for (const task of rows.activeTasks) {
      if (!task.machine_id) continue
      const current = tasksByMachine.get(task.machine_id)
      if (!current || task.deadline < current.deadline) {
        tasksByMachine.set(task.machine_id, task)
      }
    }

    const engineerConfirmed = new Set(rows.engineerTasks.map((task) => task.machine_id).filter(Boolean))
    const productById = new Map(rows.products.map((product) => [product.id, product]))
    const filesByProduct = new Map<string, ProductFileRow[]>()
    for (const file of rows.files) {
      filesByProduct.set(file.product_id, [...(filesByProduct.get(file.product_id) || []), file])
    }
    const runByItem = new Map(rows.runs.map((run) => [run.machine_item_id, run]))
    const precutByItem = new Map<string, number>()
    for (const row of rows.precuts) {
      precutByItem.set(row.machine_item_id, (precutByItem.get(row.machine_item_id) || 0) + Number(row.quantity || 0))
    }
    const itemsByMachine = new Map<string, MachineItemRow[]>()
    for (const item of rows.items) {
      itemsByMachine.set(item.machine_id, [...(itemsByMachine.get(item.machine_id) || []), item])
    }

    const machines = rows.machines.map((machine): NestingQueueMachine => {
      const task = tasksByMachine.get(machine.id) || null
      const drawingsConfirmed = engineerConfirmed.has(machine.id)
      const items = (itemsByMachine.get(machine.id) || []).map((item): NestingQueueItem => {
        const product = item.product_id ? productById.get(item.product_id) || null : null
        const files = item.product_id ? filesByProduct.get(item.product_id) || [] : []
        const stepFileCount = files.filter(isStepFile).length
        const drawingPdfFileCount = files.filter(isPdfDrawing).length
        const versionGuard = item.product_id ? rows.productVersionGuards.get(item.product_id) || null : null
        const run = runByItem.get(item.id) || null
        const service = run ? statusByProject.get(run.nesting_project_id) || null : null
        const serviceUnavailable = service?.status === 'unavailable'
        const quantity = Math.max(0, Number(item.quantity || 0))
        const precutQuantity = Math.min(quantity, precutByItem.get(item.id) || 0)
        const remainingQuantity = Math.max(quantity - precutQuantity, 0)
        const isPrecutDone = quantity > 0 && remainingQuantity <= 0
        const isDone = isCompletedNestingStatus(service?.status) || ((!service || serviceUnavailable) && (run?.status === 'calculated' || run?.status === 'imported'))
        const issue = item.product_id ? fileIssue(stepFileCount, drawingPdfFileCount) : 'Строка не привязана к товару из базы'
        let disabledReason: string | null = null

        if (isDone) disabledReason = 'Раскладка уже готова'
        else if (!item.product_id) disabledReason = 'Строка не привязана к товару из базы'
        else if (!drawingsConfirmed) disabledReason = 'Инженер еще не подтвердил чертежи'
        else if (product && product.status !== 'active') disabledReason = 'Товар не активен'
        else if (versionGuard?.message) disabledReason = versionGuard.message
        else if (issue) disabledReason = issue

        return {
          id: item.id,
          productId: item.product_id,
          drawingNumber: item.drawing_number,
          productName: item.product_name || product?.name_uk || 'Без названия',
          quantity,
          precutQuantity,
          remainingQuantity,
          productStatus: product?.status || null,
          stepFileCount,
          drawingPdfFileCount,
          run: run ? {
            id: run.id,
            nestingProjectId: run.nesting_project_id,
            batchId: run.batch_id,
            status: service && !serviceUnavailable ? serviceStatusToRunStatus(service.status) : run.status,
            serviceStatus: service?.status || null,
            errorMessage: service?.errorMessage || run.error_message,
            updatedAt: run.updated_at,
          } : null,
          selectable: remainingQuantity > 0 && !disabledReason,
          disabledReason,
        }
      })

      const progress = {
        total: items.length,
        done: items.filter((item) => item.remainingQuantity <= 0 || isCompletedNestingStatus(item.run?.serviceStatus) || item.run?.status === 'calculated' || item.run?.status === 'imported').length,
        blocked: items.filter((item) => item.disabledReason && item.disabledReason !== 'Раскладка уже готова').length,
        selectable: items.filter((item) => item.selectable).length,
      }

      return {
        id: machine.id,
        name: machine.name,
        clientName: machine.client?.name || null,
        desiredShippingDate: machine.desired_shipping_date,
        productionMonth: machine.production_month,
        createdAt: machine.created_at,
        taskDeadline: task?.deadline || null,
        taskStatus: task?.status || null,
        hasTechnologistTask: Boolean(task),
        drawingsConfirmed,
        progress,
        items,
      }
    }).filter((machine) => scope === 'all' || machine.hasTechnologistTask)

    machines.sort((a, b) => {
      const aTask = a.taskDeadline || '9999-12-31'
      const bTask = b.taskDeadline || '9999-12-31'
      if (aTask !== bTask) return aTask.localeCompare(bTask)
      const aDesired = a.desiredShippingDate || '9999-12-31'
      const bDesired = b.desiredShippingDate || '9999-12-31'
      if (aDesired !== bDesired) return aDesired.localeCompare(bDesired)
      const aProduction = a.productionMonth || '9999-12-31'
      const bProduction = b.productionMonth || '9999-12-31'
      if (aProduction !== bProduction) return aProduction.localeCompare(bProduction)
      return b.createdAt.localeCompare(a.createdAt)
    })

    const allItems = machines.flatMap((machine) => machine.items)
    return {
      success: true,
      data: {
        scope,
        machines,
        totals: {
          machines: machines.length,
          items: allItems.length,
          selectable: allItems.filter((item) => item.selectable).length,
          done: machines.reduce((sum, machine) => sum + machine.progress.done, 0),
          blocked: machines.reduce((sum, machine) => sum + machine.progress.blocked, 0),
        },
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось загрузить очередь раскладки' }
  }
}

async function downloadProductFile(file: ProductFileRow) {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from('product-files').download(file.file_path)
  if (error || !data) throw new Error(error?.message || `Не удалось скачать файл ${file.file_name}`)
  return data
}

async function deleteServiceProject(projectId: string) {
  await fetch(`${getNestingServiceUrl()}/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => undefined)
}

export async function createNestingBatch(input: {
  machineItemIds: string[]
  sourceNestingProjectId?: string | null
  futureMachineItemIds?: string[]
}): Promise<ActionResult<{ nestingProjectId: string }>> {
  let createdProjectId: string | null = null

  try {
    const parsed = startBatchSchema.parse(input)
    const uniqueItemIds = Array.from(new Set(parsed.machineItemIds))
    const futureItemIds = new Set(parsed.futureMachineItemIds || [])
    const { supabase, userId } = await requireNestingPermission('manage')
    const db = supabase as unknown as LooseDb

    const itemsResult = await db
      .from('machine_items')
      .select('id, machine_id, product_id, drawing_number, product_name, quantity, is_sample, sort_order')
      .in('id', uniqueItemIds)

    if (itemsResult.error) throw new Error(itemsResult.error.message || 'Не удалось загрузить выбранные позиции')
    const items = (itemsResult.data || []) as MachineItemRow[]
    if (items.length !== uniqueItemIds.length) throw new Error('Часть выбранных позиций не найдена')

    const machineIds = Array.from(new Set(items.map((item) => item.machine_id)))
    const productIds = Array.from(new Set(items.filter((item) => !item.is_sample).map((item) => item.product_id).filter(Boolean))) as string[]

    const [machinesResult, engineerTasksResult, productsResult, filesResult, precutsResult, existingRunsResult, productVersionGuards] = await Promise.all([
      db.from('machines').select('id, name, is_archived, desired_shipping_date, production_month, created_at').in('id', machineIds),
      db.from('tasks').select('id, machine_id, deadline, status').eq('task_type', 'engineer_confirm').eq('status', 'completed').in('machine_id', machineIds),
      productIds.length ? db.from('products').select('id, name_uk, drawing_number, status').in('id', productIds) : Promise.resolve({ data: [], error: null } as DbResult),
      productIds.length ? db.from('product_files').select('id, product_id, file_kind, file_name, file_path, mime_type').in('product_id', productIds) : Promise.resolve({ data: [], error: null } as DbResult),
      uniqueItemIds.length ? db.from('nesting_precut_parts').select('machine_item_id, quantity').in('machine_item_id', uniqueItemIds) : Promise.resolve({ data: [], error: null } as DbResult),
      uniqueItemIds.length ? db.from('machine_item_nesting_runs').select('machine_item_id, nesting_project_id').in('machine_item_id', uniqueItemIds) : Promise.resolve({ data: [], error: null } as DbResult),
      productIds.length ? getProductVersionNestingGuards(db as ProductVersionNestingDb, productIds) : Promise.resolve(new Map()),
    ])

    if (machinesResult.error) throw new Error(machinesResult.error.message || 'Не удалось загрузить машины')
    if (engineerTasksResult.error) throw new Error(engineerTasksResult.error.message || 'Не удалось проверить подтверждение инженера')
    if (productsResult.error) throw new Error(productsResult.error.message || 'Не удалось загрузить товары')
    if (filesResult.error) throw new Error(filesResult.error.message || 'Не удалось загрузить файлы товаров')
    if (existingRunsResult.error) throw new Error(existingRunsResult.error.message || 'Не удалось проверить предыдущие раскладки')
    const previousProjectIds = new Set(
      ((existingRunsResult.data || []) as ExistingRunLinkRow[])
        .map((run) => run.nesting_project_id)
        .filter(Boolean)
    )

    const machines = new Map(((machinesResult.data || []) as Array<MachineRow & { is_archived?: boolean }>).map((machine) => [machine.id, machine]))
    const engineerConfirmed = new Set(((engineerTasksResult.data || []) as TaskRow[]).map((task) => task.machine_id).filter(Boolean))
    const products = new Map(((productsResult.data || []) as ProductRow[]).map((product) => [product.id, product]))
    const filesByProduct = new Map<string, ProductFileRow[]>()
    for (const file of (filesResult.data || []) as ProductFileRow[]) {
      filesByProduct.set(file.product_id, [...(filesByProduct.get(file.product_id) || []), file])
    }
    const precutByItem = new Map<string, number>()
    if (!precutsResult.error) {
      for (const row of (precutsResult.data || []) as PrecutRow[]) {
        precutByItem.set(row.machine_item_id, (precutByItem.get(row.machine_item_id) || 0) + Number(row.quantity || 0))
      }
    }

    const prepared = items.map((item, index) => {
      const machine = machines.get(item.machine_id)
      if (!machine || machine.is_archived) throw new Error(`Машина для позиции ${item.product_name || item.id} не найдена или архивирована`)
      if (item.is_sample) throw new Error(`Образец ${item.product_name || item.id} нельзя отправить в пакетную раскладку`)
      if (!item.product_id) throw new Error(`Позиция ${item.product_name || item.id} не привязана к товару из базы`)
      if (!engineerConfirmed.has(item.machine_id)) throw new Error(`Инженер еще не подтвердил чертежи по машине ${machine.name}`)
      const product = products.get(item.product_id)
      if (!product || product.status !== 'active') throw new Error(`Товар ${item.product_name || item.id} не активен`)
      const versionGuard = productVersionGuards.get(item.product_id)
      if (versionGuard?.message) throw new Error(`${item.product_name || product.name_uk}: ${versionGuard.message}`)
      const files = filesByProduct.get(item.product_id) || []
      const stepFiles = files.filter(isStepFile)
      const drawingFiles = files.filter(isPdfDrawing)
      const issue = fileIssue(stepFiles.length, drawingFiles.length)
      if (issue) throw new Error(`${item.product_name || product.name_uk}: ${issue}`)
      const requestedQuantity = Math.max(1, Math.trunc(Number(item.quantity) || 1))
      const quantityToNest = Math.max(0, requestedQuantity - Math.trunc(precutByItem.get(item.id) || 0))
      if (quantityToNest <= 0) throw new Error(`${item.product_name || product.name_uk}: деталь уже вырезана заранее`)

      return {
        item,
        machine,
        product,
        stepFile: stepFiles[0],
        drawingFile: drawingFiles[0],
        quantityToNest,
        fillRole: futureItemIds.has(item.id) ? 'future' as const : 'original' as const,
        sortOrder: index,
      }
    })

    const orderNumber = `Batch ${new Date().toISOString().slice(0, 10)} / ${prepared.length} поз.`
    const servicePayload = {
      orderNumber,
      createdBy: userId,
      inputs: prepared.map((row) => ({
        sourceId: row.item.id,
        sourceType: 'crm_machine_item',
        machineId: row.machine.id,
        machineName: row.machine.name,
        machineItemId: row.item.id,
        productId: row.product.id,
        productName: row.item.product_name || row.product.name_uk,
        drawingNumber: row.item.drawing_number || row.product.drawing_number || '',
        quantity: row.quantityToNest,
        stepStorageUri: `supabase://product-files/${row.stepFile.file_path}`,
        pdfStorageUri: `supabase://product-files/${row.drawingFile.file_path}`,
        sortOrder: row.sortOrder,
      })),
    }

    const response = await fetch(`${getNestingServiceUrl()}/api/projects/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(servicePayload),
    })

    if (!response.ok) {
      throw new Error(await readServiceError(response))
    }

    const payload = await response.json() as { data?: { id?: string; status?: string; orderNumber?: string } }
    const nestingProjectId = payload.data?.id
    if (!nestingProjectId) throw new Error('Сервис раскладки не вернул id пакетного проекта')
    createdProjectId = nestingProjectId

    const batchResult = await db
      .from('nesting_batches')
      .insert({
        nesting_project_id: nestingProjectId,
        order_number: payload.data?.orderNumber || orderNumber,
        status: serviceStatusToBatchStatus(payload.data?.status || 'parsing'),
        error_message: null,
        source_nesting_project_id: parsed.sourceNestingProjectId || null,
        is_future_fill: Boolean(parsed.sourceNestingProjectId),
        created_by: userId,
        updated_by: userId,
      })
      .select('*')
      .single()

    if (batchResult.error || !batchResult.data) throw new Error(batchResult.error?.message || 'Не удалось сохранить пакет раскладки')
    const batch = batchResult.data as BatchRow

    const batchItems = prepared.map((row) => ({
      batch_id: batch.id,
      machine_id: row.machine.id,
      machine_item_id: row.item.id,
      product_id: row.product.id,
      step_file_id: row.stepFile.id,
      drawing_file_id: row.drawingFile.id,
      quantity_multiplier: row.quantityToNest,
      fill_role: row.fillRole,
      sort_order: row.sortOrder,
    }))
    const batchItemsResult = await db.from('nesting_batch_items').insert(batchItems)
    if (batchItemsResult.error) throw new Error(batchItemsResult.error.message || 'Не удалось сохранить позиции пакета')

    const runRows = prepared.map((row) => ({
      machine_id: row.machine.id,
      machine_item_id: row.item.id,
      product_id: row.product.id,
      step_file_id: row.stepFile.id,
      drawing_file_id: row.drawingFile.id,
      nesting_project_id: nestingProjectId,
      batch_id: batch.id,
      status: 'draft',
      quantity_multiplier: row.quantityToNest,
      error_message: null,
      created_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }))
    const runsResult = await db
      .from('machine_item_nesting_runs')
      .upsert(runRows, { onConflict: 'machine_item_id' })
    if (runsResult.error) throw new Error(runsResult.error.message || 'Не удалось сохранить связи раскладки')

    await Promise.all(
      Array.from(previousProjectIds)
        .filter((projectId) => projectId !== nestingProjectId)
        .map((projectId) =>
          markProjectSuperseded(projectId, nestingProjectId).catch((supersedeError) => {
            console.warn('[nesting] Failed to mark previous batch project as superseded:', supersedeError)
          })
        )
    )

    revalidatePath(ROUTES.NESTING)
    for (const machineId of machineIds) {
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    }

    return { success: true, data: { nestingProjectId } }
  } catch (error) {
    if (createdProjectId) {
      await deleteServiceProject(createdProjectId)
    }
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось создать пакетную раскладку' }
  }
}

export async function syncNestingBatchProjectStatus(projectId: string): Promise<ActionResult<{ status: string }>> {
  try {
    const { supabase } = await requireNestingPermission('manage')
    const db = supabase as unknown as LooseDb
    const status = await getProjectStatus(projectId)
    await db
      .from('machine_item_nesting_runs')
      .update({
        status: serviceStatusToRunStatus(status.status),
        error_message: status.errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('nesting_project_id', projectId)
    await db
      .from('nesting_batches')
      .update({
        status: serviceStatusToBatchStatus(status.status),
        error_message: status.errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('nesting_project_id', projectId)
    revalidatePath(ROUTES.NESTING)
    return { success: true, data: { status: status.status } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось синхронизировать статус раскладки'
    try {
      const { supabase } = await requireNestingPermission('manage')
      const db = supabase as unknown as LooseDb
      await db
        .from('machine_item_nesting_runs')
        .update({ error_message: message, updated_at: new Date().toISOString() })
        .eq('nesting_project_id', projectId)
      await db
        .from('nesting_batches')
        .update({ error_message: message, updated_at: new Date().toISOString() })
        .eq('nesting_project_id', projectId)
    } catch {
      // Best-effort only: the original sync error is returned below.
    }
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось синхронизировать статус раскладки' }
  }
}
