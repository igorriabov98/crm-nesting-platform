"use server"

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirePermission } from '@/lib/permissions/server'
import { DIRECTOR_ROLES } from '@/lib/constants/roles'
import { ROUTES } from '@/lib/constants/routes'
import { dispatchPendingTelegramDeliveries } from '@/lib/services/task-notifications'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import type { MachineLayoutRequest } from '@/lib/types'

type DbError = { message?: string; code?: string } | null
type DbResult = { data: unknown; error: DbError }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
}
type LooseDb = { from: (table: string) => LooseQuery }
type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>
}

type ActionResult<T> = {
  success: boolean
  data?: T
  error?: string
}

type DrawingFileSource = 'product' | 'project'

export type MachineLayoutSnapshotItem = {
  machineItemId: string
  productId: string | null
  productProjectId: string | null
  productProjectVersionId: string | null
  productName: string
  drawingNumber: string
  quantity: number
  sortOrder: number
  drawingFileSource: DrawingFileSource | null
  drawingFileId: string | null
  drawingFileName: string | null
  drawingUrl: string | null
}

export type MachineLayoutDiffItem = {
  type: 'added' | 'removed' | 'changed'
  item: MachineLayoutSnapshotItem
  previousItem?: MachineLayoutSnapshotItem | null
  changes: Array<'productName' | 'drawingNumber' | 'quantity'>
}

export type MachineLayoutVersion = {
  id: string
  machineId: string
  departmentRequestId: string | null
  departmentRequestStatus: 'new' | 'in_progress' | 'done' | 'rejected' | 'cancelled' | null
  taskId: string | null
  versionNo: number
  status: 'requested' | 'completed'
  isSupersededBeforePdf: boolean
  requestedBy: string | null
  assignedTo: string | null
  assignedToName: string | null
  items: MachineLayoutSnapshotItem[]
  diff: MachineLayoutDiffItem[]
  pdfFileName: string | null
  pdfUrl: string | null
  uploadedAt: string | null
  completedAt: string | null
  createdAt: string
}

export type MachineLayoutPayload = {
  currentItems: MachineLayoutSnapshotItem[]
  latest: MachineLayoutVersion | null
  versions: MachineLayoutVersion[]
}

type MachineItemRow = {
  id: string
  product_id: string | null
  product_project_id: string | null
  product_project_version_id: string | null
  product_name: string | null
  drawing_number: string | null
  quantity: number | string | null
  is_sample: boolean | null
  sort_order: number | null
}

type MachineRow = {
  id: string
  name: string | null
  created_by: string | null
  is_archived: boolean | null
  machine_items?: MachineItemRow[] | null
}

type ProductFileRow = {
  id: string
  product_id?: string | null
  project_id?: string | null
  version_id?: string | null
  file_kind: string
  file_name: string
}

type LayoutUploadMachineRow = Pick<MachineRow, 'id' | 'name' | 'created_by'>
type Relation<T> = T | T[] | null
type MachineLayoutRow = MachineLayoutRequest & {
  assignee: Relation<{ full_name: string | null }>
  department_request: Relation<{
    status: 'new' | 'in_progress' | 'done' | 'rejected' | 'cancelled'
  }>
}

const MAX_PDF_SIZE = 50 * 1024 * 1024

function dbFrom(client: unknown): LooseDb {
  return client as LooseDb
}

function rpcFrom(client: unknown): RpcClient {
  return client as RpcClient
}

function relationOne<T>(value: Relation<T> | undefined) {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function normalizeQuantity(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function isDrawingFile(file: ProductFileRow) {
  const name = file.file_name.toLowerCase()
  return file.file_kind === 'drawing' || file.file_kind === 'pdf' || name.endsWith('.pdf')
}

function chooseDrawingFile(files: ProductFileRow[]) {
  return files
    .filter(isDrawingFile)
    .sort((left, right) => {
      const leftRank = left.file_kind === 'drawing' ? 0 : left.file_kind === 'pdf' ? 1 : 2
      const rightRank = right.file_kind === 'drawing' ? 0 : right.file_kind === 'pdf' ? 1 : 2
      return leftRank - rightRank || left.file_name.localeCompare(right.file_name, 'ru')
    })[0] || null
}

function drawingUrl(
  item: Pick<MachineLayoutSnapshotItem, 'drawingFileSource' | 'drawingFileId'>,
  machineId?: string,
) {
  if (!item.drawingFileSource || !item.drawingFileId) return null
  const machineQuery = machineId ? `?machineId=${encodeURIComponent(machineId)}` : ''
  return `/api/machine-layout/drawings/${item.drawingFileSource}/${item.drawingFileId}${machineQuery}`
}

function normalizeStoredItem(raw: unknown, machineId?: string): MachineLayoutSnapshotItem | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<MachineLayoutSnapshotItem>
  const machineItemId = typeof item.machineItemId === 'string' ? item.machineItemId : null
  if (!machineItemId) return null
  const source = item.drawingFileSource === 'product' || item.drawingFileSource === 'project'
    ? item.drawingFileSource
    : null
  const normalized = {
    machineItemId,
    productId: typeof item.productId === 'string' ? item.productId : null,
    productProjectId: typeof item.productProjectId === 'string' ? item.productProjectId : null,
    productProjectVersionId: typeof item.productProjectVersionId === 'string' ? item.productProjectVersionId : null,
    productName: typeof item.productName === 'string' ? item.productName : '',
    drawingNumber: typeof item.drawingNumber === 'string' ? item.drawingNumber : '',
    quantity: normalizeQuantity(item.quantity),
    sortOrder: normalizeQuantity(item.sortOrder),
    drawingFileSource: source,
    drawingFileId: typeof item.drawingFileId === 'string' ? item.drawingFileId : null,
    drawingFileName: typeof item.drawingFileName === 'string' ? item.drawingFileName : null,
    drawingUrl: null,
  } satisfies MachineLayoutSnapshotItem
  return { ...normalized, drawingUrl: drawingUrl(normalized, machineId) }
}

function normalizeStoredItems(value: unknown, machineId?: string): MachineLayoutSnapshotItem[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => normalizeStoredItem(item, machineId))
    .filter((item): item is MachineLayoutSnapshotItem => Boolean(item))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.productName.localeCompare(right.productName, 'ru'))
}

async function loadMachine(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machines')
    .select(`
      id,
      name,
      created_by,
      is_archived,
      machine_items(
        id,
        product_id,
        product_project_id,
        product_project_version_id,
        product_name,
        drawing_number,
        quantity,
        is_sample,
        sort_order
      )
    `)
    .eq('id', machineId)
    .single()

  if (error || !data) throw new Error(error?.message || 'Машина не найдена')
  return data as MachineRow
}

async function resolveDrawingFiles(db: LooseDb, items: MachineItemRow[]) {
  const productIds = Array.from(new Set(items.map((item) => item.product_id).filter((id): id is string => Boolean(id))))
  const versionIds = Array.from(new Set(items.map((item) => item.product_project_version_id).filter((id): id is string => Boolean(id))))

  const productFileByProductId = new Map<string, ProductFileRow>()
  const projectFileByVersionId = new Map<string, ProductFileRow>()

  if (productIds.length > 0) {
    const filesResult = await db
      .from('product_files')
      .select('id, product_id, file_kind, file_name')
      .in('product_id', productIds)

    if (filesResult.error) throw new Error(filesResult.error.message || 'Не удалось загрузить чертежи товаров')
    const grouped = new Map<string, ProductFileRow[]>()
    for (const file of (filesResult.data || []) as ProductFileRow[]) {
      if (!file.product_id) continue
      grouped.set(file.product_id, [...(grouped.get(file.product_id) || []), file])
    }
    for (const [productId, files] of grouped.entries()) {
      const file = chooseDrawingFile(files)
      if (file) productFileByProductId.set(productId, file)
    }
  }

  if (versionIds.length > 0) {
    const { data, error } = await db
      .from('product_project_files')
      .select('id, project_id, version_id, file_kind, file_name')
      .in('version_id', versionIds)

    if (error) throw new Error(error.message || 'Не удалось загрузить чертежи проектов')
    const grouped = new Map<string, ProductFileRow[]>()
    for (const file of (data || []) as ProductFileRow[]) {
      if (!file.version_id) continue
      grouped.set(file.version_id, [...(grouped.get(file.version_id) || []), file])
    }
    for (const [versionId, files] of grouped.entries()) {
      const file = chooseDrawingFile(files)
      if (file) projectFileByVersionId.set(versionId, file)
    }
  }

  return { productFileByProductId, projectFileByVersionId }
}

async function buildCurrentSnapshot(db: LooseDb, machine: MachineRow) {
  const goods = (machine.machine_items || [])
    .filter((item) => !item.is_sample)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))

  const { productFileByProductId, projectFileByVersionId } = await resolveDrawingFiles(db, goods)

  return goods.map((item, index) => {
    const projectFile = item.product_project_version_id
      ? projectFileByVersionId.get(item.product_project_version_id) || null
      : null
    const productFile = item.product_id
      ? productFileByProductId.get(item.product_id) || null
      : null
    const file = projectFile || productFile
    const source: DrawingFileSource | null = projectFile ? 'project' : productFile ? 'product' : null
    const snapshot = {
      machineItemId: item.id,
      productId: item.product_id,
      productProjectId: item.product_project_id,
      productProjectVersionId: item.product_project_version_id,
      productName: item.product_name || 'Без названия',
      drawingNumber: item.drawing_number || '',
      quantity: normalizeQuantity(item.quantity),
      sortOrder: item.sort_order ?? index,
      drawingFileSource: source,
      drawingFileId: file?.id || null,
      drawingFileName: file?.file_name || null,
      drawingUrl: null,
    } satisfies MachineLayoutSnapshotItem

    return { ...snapshot, drawingUrl: drawingUrl(snapshot, machine.id) }
  })
}

function buildDiff(current: MachineLayoutSnapshotItem[], previous: MachineLayoutSnapshotItem[]) {
  const previousById = new Map(previous.map((item) => [item.machineItemId, item]))
  const currentById = new Map(current.map((item) => [item.machineItemId, item]))
  const diff: MachineLayoutDiffItem[] = []

  for (const item of current) {
    const previousItem = previousById.get(item.machineItemId)
    if (!previousItem) {
      diff.push({ type: 'added', item, previousItem: null, changes: [] })
      continue
    }

    const changes: MachineLayoutDiffItem['changes'] = []
    if (item.productName !== previousItem.productName) changes.push('productName')
    if (item.drawingNumber !== previousItem.drawingNumber) changes.push('drawingNumber')
    if (item.quantity !== previousItem.quantity) changes.push('quantity')
    if (changes.length > 0) {
      diff.push({ type: 'changed', item, previousItem, changes })
    }
  }

  for (const item of previous) {
    if (!currentById.has(item.machineItemId)) {
      diff.push({ type: 'removed', item, previousItem: item, changes: [] })
    }
  }

  return diff
}

function snapshotComparableItem(item: MachineLayoutSnapshotItem) {
  return [
    item.machineItemId,
    item.productId || '',
    item.productProjectId || '',
    item.productProjectVersionId || '',
    item.productName,
    item.drawingNumber,
    item.quantity,
    item.sortOrder,
    item.drawingFileSource || '',
    item.drawingFileId || '',
  ].join('|')
}

function snapshotsEqual(left: MachineLayoutSnapshotItem[], right: MachineLayoutSnapshotItem[]) {
  if (left.length !== right.length) return false
  const leftKeys = left.map(snapshotComparableItem).sort()
  const rightKeys = right.map(snapshotComparableItem).sort()
  return leftKeys.every((key, index) => key === rightKeys[index])
}

function isPreparedLayout(row: MachineLayoutRequest) {
  return row.status === 'completed' && Boolean(row.pdf_file_path)
}

function normalizeVersion(row: MachineLayoutRow, diff: MachineLayoutDiffItem[]): MachineLayoutVersion {
  const items = normalizeStoredItems(row.item_snapshot, row.machine_id)
  return {
    id: row.id,
    machineId: row.machine_id,
    departmentRequestId: row.department_request_id,
    departmentRequestStatus: relationOne(row.department_request)?.status || null,
    taskId: row.task_id,
    versionNo: row.version_no,
    status: row.status,
    isSupersededBeforePdf: row.status === 'completed' && !row.pdf_file_path,
    requestedBy: row.requested_by,
    assignedTo: row.assigned_to,
    assignedToName: relationOne(row.assignee)?.full_name || null,
    items,
    diff,
    pdfFileName: row.pdf_file_name,
    pdfUrl: row.pdf_file_path ? `/api/machine-layout/files/${row.id}` : null,
    uploadedAt: row.uploaded_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  }
}

function serializeSnapshotItem(item: MachineLayoutSnapshotItem) {
  return {
    machineItemId: item.machineItemId,
    productId: item.productId,
    productProjectId: item.productProjectId,
    productProjectVersionId: item.productProjectVersionId,
    productName: item.productName,
    drawingNumber: item.drawingNumber,
    quantity: item.quantity,
    sortOrder: item.sortOrder,
    drawingFileSource: item.drawingFileSource,
    drawingFileId: item.drawingFileId,
    drawingFileName: item.drawingFileName,
  }
}

async function loadLayoutRows(db: LooseDb, machineId: string) {
  const { data, error } = await db
    .from('machine_layout_requests')
    .select(`
      *,
      assignee:users!machine_layout_requests_assigned_to_fkey(full_name),
      department_request:department_requests!machine_layout_requests_department_request_id_fkey(status)
    `)
    .eq('machine_id', machineId)
    .order('version_no', { ascending: false })

  if (error) throw new Error(error.message || 'Не удалось загрузить расстановки машины')
  return (data || []) as MachineLayoutRow[]
}

async function loadLayoutPayload(db: LooseDb, machineId: string): Promise<MachineLayoutPayload> {
  const machine = await loadMachine(db, machineId)
  const currentItems = await buildCurrentSnapshot(db, machine)
  const rows = machine.is_archived
    ? await loadLayoutRows(db, machineId)
    : await syncOpenLayoutRequest(db, machine, currentItems, await loadLayoutRows(db, machineId))

  const rowsAsc = [...rows].sort((left, right) => left.version_no - right.version_no)
  const diffById = new Map<string, MachineLayoutDiffItem[]>()
  let previousItems: MachineLayoutSnapshotItem[] = []
  let previousPreparedItems: MachineLayoutSnapshotItem[] = []

  for (let index = 0; index < rowsAsc.length; index += 1) {
    const current = normalizeStoredItems(rowsAsc[index].item_snapshot, rowsAsc[index].machine_id)
    const baseline = previousPreparedItems.length > 0
      ? previousPreparedItems
      : previousItems
    diffById.set(rowsAsc[index].id, baseline.length > 0 ? buildDiff(current, baseline) : [])
    if (isPreparedLayout(rowsAsc[index])) previousPreparedItems = current
    previousItems = current
  }

  const currentById = new Map(currentItems.map((item) => [item.machineItemId, item]))
  const versions = rows.map((row) => {
    const version = normalizeVersion(row, diffById.get(row.id) || [])
    return {
      ...version,
      items: version.items.map((item) => {
        if (item.drawingUrl) return item
        const current = currentById.get(item.machineItemId)
        const sameProduct = current
          && current.productId === item.productId
          && current.productProjectVersionId === item.productProjectVersionId
        if (!sameProduct || !current.drawingUrl) return item
        return {
          ...item,
          drawingFileSource: current.drawingFileSource,
          drawingFileId: current.drawingFileId,
          drawingFileName: current.drawingFileName,
          drawingUrl: current.drawingUrl,
        }
      }),
    }
  })
  return {
    currentItems,
    latest: versions[0] || null,
    versions,
  }
}

async function syncOpenLayoutRequest(
  db: LooseDb,
  machine: MachineRow,
  currentItems: MachineLayoutSnapshotItem[],
  rows: MachineLayoutRow[],
) {
  if (currentItems.length === 0) return rows

  const openRows = rows
    .filter((row) => row.status === 'requested')
    .sort((left, right) => right.version_no - left.version_no)
  if (openRows.length === 0) return rows

  const latestOpen = openRows[0]
  if (snapshotsEqual(currentItems, normalizeStoredItems(latestOpen.item_snapshot, machine.id))) return rows

  const { error } = await rpcFrom(createAdminClient()).rpc('sync_machine_layout_request_version', {
    p_machine_id: machine.id,
    p_item_snapshot: currentItems.map(serializeSnapshotItem),
  })
  if (error) throw new Error(error.message || 'Не удалось обновить версию расстановки')

  return loadLayoutRows(db, machine.id)
}

function assertPdfFile(file: File) {
  if (!file || file.size === 0) throw new Error('Выберите PDF расстановки')
  const name = file.name.toLowerCase()
  if (file.size > MAX_PDF_SIZE) throw new Error('PDF расстановки не должен превышать 50 МБ')
  if (file.type !== 'application/pdf' && !name.endsWith('.pdf')) {
    throw new Error('Загрузите файл в формате PDF')
  }
}

function fileExtension(name: string) {
  const match = name.match(/\.([A-Za-z0-9]{1,12})$/)
  return match ? `.${match[1].toLowerCase()}` : '.pdf'
}

function revalidateLayout(machineId: string) {
  revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.REQUESTS)
  revalidatePath(ROUTES.TECHNOLOGIST_DEPARTMENT_REQUESTS)
  revalidatePath(ROUTES.NOTIFICATIONS)
}

async function notifyManagerAboutLayoutUpload(db: LooseDb, input: {
  requestId: string
  machineId: string
  requestedBy: string | null
  uploadedBy: string
  versionNo: number
  fileName: string
}) {
  try {
    const { data: machineData, error: machineError } = await db
      .from('machines')
      .select('id, name, created_by')
      .eq('id', input.machineId)
      .single()

    if (machineError || !machineData) {
      throw new Error(machineError?.message || 'Машина не найдена для уведомления')
    }

    const machine = machineData as LayoutUploadMachineRow
    const managerId = input.requestedBy || machine.created_by
    const machineName = machine.name || 'машине'
    const body = `Расстановка машины загружена в систему: версия ${input.versionNo}${input.fileName ? ` (${input.fileName})` : ''}.`
    const eventKey = `machine_layout_pdf_uploaded:${input.requestId}`

    const { error: updateError } = await db.from('machine_updates').insert({
      machine_id: input.machineId,
      body,
      created_by: input.uploadedBy,
      updated_by: input.uploadedBy,
      message_kind: 'system',
      system_event_key: eventKey,
    })
    if (updateError) throw new Error(updateError.message || 'Не удалось добавить событие о расстановке в последние обновления')

    if (managerId && managerId !== input.uploadedBy) {
      const { error: notificationError } = await db.from('notifications').insert({
        user_id: managerId,
        type: 'machine_layout_uploaded',
        title: 'Расстановка машины загружена',
        message: `По машине "${machineName}" загружена расстановка версии ${input.versionNo}.`,
        related_machine_id: input.machineId,
      })
      if (notificationError) throw new Error(notificationError.message || 'Не удалось создать уведомление менеджеру')

      await dispatchPendingTelegramDeliveries({ machineId: input.machineId, userId: managerId })
    }
  } catch (error) {
    console.error('[MachineLayout] Не удалось отправить уведомление о загруженной расстановке:', error)
  }
}

export async function getMachineLayout(machineId: string): Promise<ActionResult<MachineLayoutPayload>> {
  try {
    await requirePermission('sales_plan', 'view')
    const db = dbFrom(createAdminClient())
    const data = await loadLayoutPayload(db, machineId)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function requestMachineLayout(machineId: string): Promise<ActionResult<MachineLayoutPayload>> {
  try {
    const { userId } = await requirePermission('sales_plan', 'manage')

    const db = dbFrom(createAdminClient())
    const machine = await loadMachine(db, machineId)
    if (machine.is_archived) throw new Error('Машина архивирована. Действия с ней остановлены.')

    const snapshot = await buildCurrentSnapshot(db, machine)
    if (snapshot.length === 0) throw new Error('Добавьте хотя бы один товар перед запросом расстановки')

    const rows = await loadLayoutRows(db, machineId)
    const openRows = rows
      .filter((row) => row.status === 'requested')
      .sort((left, right) => right.version_no - left.version_no)
    const latestOpen = openRows[0] || null

    if (latestOpen && snapshotsEqual(snapshot, normalizeStoredItems(latestOpen.item_snapshot, machineId))) {
      throw new Error(`Расстановка версии ${latestOpen.version_no} уже ожидает PDF. Загрузите PDF перед новым запросом.`)
    }

    if (openRows.length > 0) {
      throw new Error('По машине уже есть открытый запрос на расстановку')
    }

    const { error } = await rpcFrom(createAdminClient()).rpc('create_machine_layout_department_request', {
      p_machine_id: machineId,
      p_requested_by: userId,
      p_item_snapshot: snapshot.map(serializeSnapshotItem),
    })
    if (error) throw new Error(error.message || 'Не удалось создать заявку на расстановку')

    revalidateLayout(machineId)
    const data = await loadLayoutPayload(db, machineId)
    return { success: true, data }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function uploadMachineLayoutPdf(formData: FormData): Promise<ActionResult<MachineLayoutPayload>> {
  let uploadedPath: string | null = null

  try {
    const { userId, role } = await requirePermission('department_requests', 'manage')

    const requestId = String(formData.get('request_id') || '')
    const file = formData.get('file')
    if (!requestId) throw new Error('Не найдена версия расстановки')
    if (!(file instanceof File)) throw new Error('Выберите PDF расстановки')
    assertPdfFile(file)

    const admin = createAdminClient()
    const db = dbFrom(admin)

    const { data: requestData, error: requestError } = await db
      .from('machine_layout_requests')
      .select('id, machine_id, task_id, requested_by, assigned_to, status, version_no')
      .eq('id', requestId)
      .single()

    if (requestError || !requestData) throw new Error(requestError?.message || 'Версия расстановки не найдена')
    const request = requestData as Pick<MachineLayoutRequest, 'id' | 'machine_id' | 'task_id' | 'requested_by' | 'assigned_to' | 'status' | 'version_no'>
    if (request.status === 'completed') throw new Error('Эта версия уже закрыта. Создайте новый запрос на расстановку.')
    if (!DIRECTOR_ROLES.includes(role) && request.assigned_to !== userId) {
      throw new Error('Загрузить PDF может только назначенный технолог')
    }

    uploadedPath = `machine-layouts/${request.machine_id}/${request.version_no}-${Date.now()}-${randomUUID()}${fileExtension(file.name)}`
    const { error: uploadError } = await admin.storage.from('product-files').upload(uploadedPath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/pdf',
    })
    if (uploadError) throw new Error(uploadError.message || 'Не удалось загрузить PDF')

    const { error: completeError } = await rpcFrom(admin).rpc('complete_machine_layout_request', {
      p_request_id: request.id,
      p_uploaded_by: userId,
      p_file_name: file.name,
      p_file_path: uploadedPath,
      p_mime_type: file.type || 'application/pdf',
      p_file_size: file.size,
    })
    if (completeError) throw new Error(completeError.message || 'Не удалось сохранить PDF расстановки')

    await notifyManagerAboutLayoutUpload(db, {
      requestId: request.id,
      machineId: request.machine_id,
      requestedBy: request.requested_by,
      uploadedBy: userId,
      versionNo: request.version_no,
      fileName: file.name,
    })

    revalidateLayout(request.machine_id)
    const data = await loadLayoutPayload(db, request.machine_id)
    return { success: true, data }
  } catch (error) {
    if (uploadedPath) {
      await createAdminClient().storage.from('product-files').remove([uploadedPath]).catch(() => undefined)
    }
    return { success: false, error: getErrorMessage(error) }
  }
}
