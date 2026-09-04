'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { assertFactoryAccess, canAccessAllFactories } from '@/lib/permissions/factory-scope'
import { requirePermission } from '@/lib/permissions/server'
import type { CustomsClearanceMachine, CustomsDocument, CustomsDocumentKind } from '@/lib/customs-clearance'
import {
  type CustomsClearanceDirectUpload,
  validateCustomsClearanceUploads,
} from '@/lib/customs-clearance-files'

type DbError = { message?: string } | null
type DbResult = { data: unknown; error: DbError }
type LooseQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
  delete: () => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  or: (filters: string) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  range: (from: number, to: number) => LooseQuery
  maybeSingle: () => Promise<DbResult>
}
type LooseDb = {
  from: (table: string) => LooseQuery
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>
}

type MachineRow = {
  id: string
  name: string | null
  factory_id: string | null
  customs_clearance_date: string | null
  delivery_to_client_date: string | null
  factory: { id: string; name: string | null } | Array<{ id: string; name: string | null }> | null
}
type StageRow = {
  id: string
  machine_id: string
  date_end: string | null
  planned_date_end: string | null
  created_at: string | null
}
type DocumentRow = {
  id: string
  machine_id: string
  document_kind: CustomsDocumentKind
  file_name: string
  mime_type: string
  file_size: number
  uploaded_by: string
  created_at: string
  uploader: { full_name: string | null } | Array<{ full_name: string | null }> | null
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

async function getMachineForAccess(
  db: LooseDb,
  machineId: string,
  context: Awaited<ReturnType<typeof requirePermission>>,
  operation: 'view' | 'manage',
) {
  const { data, error } = await db
    .from('machines')
    .select('id, name, factory_id, is_archived')
    .eq('id', machineId)
    .maybeSingle()
  if (error || !data) throw new Error('Машина не найдена')
  const machine = data as { id: string; name: string | null; factory_id: string | null; is_archived: boolean | null }
  assertFactoryAccess(context, 'customs_clearance', operation, machine.factory_id)
  if (machine.is_archived) throw new Error('Архивную машину нельзя изменять')
  return machine
}

export async function loadCustomsClearanceWorkspace() {
  const context = await requirePermission('customs_clearance', 'view')
  const db = createAdminClient() as unknown as LooseDb
  const allFactories = canAccessAllFactories(context, 'customs_clearance', 'view')
  const machineRows: MachineRow[] = []
  const pageSize = 500
  for (let page = 0; ; page += 1) {
    let machineQuery = db
      .from('machines')
      .select(`
        id,
        name,
        factory_id,
        customs_clearance_date,
        delivery_to_client_date,
        factory:factories(id, name)
      `)
      .or('is_archived.eq.false,is_archived.is.null')
      .order('created_at', { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (!allFactories) {
      if (!context.factoryId) break
      machineQuery = machineQuery.eq('factory_id', context.factoryId)
    }
    const { data, error } = await machineQuery
    if (error) throw new Error(error.message || 'Не удалось загрузить машины')
    const rows = (data || []) as MachineRow[]
    machineRows.push(...rows)
    if (rows.length < pageSize) break
  }
  const machineIds = machineRows.map((machine) => machine.id)

  const machineIdChunks: string[][] = []
  for (let offset = 0; offset < machineIds.length; offset += 200) {
    machineIdChunks.push(machineIds.slice(offset, offset + 200))
  }

  const [stageResults, documentResults, brokerDepartmentResult] = await Promise.all([
    Promise.all(machineIdChunks.map((ids) => db.from('production_stages')
        .select('id, machine_id, date_end, planned_date_end, created_at')
        .in('machine_id', ids)
        .eq('stage_type', 'shipping')
        .order('created_at', { ascending: false }))),
    Promise.all(machineIdChunks.map((ids) => db.from('machine_customs_documents')
        .select(`
          id,
          machine_id,
          document_kind,
          file_name,
          mime_type,
          file_size,
          uploaded_by,
          created_at,
          uploader:users!machine_customs_documents_uploaded_by_fkey(full_name)
        `)
        .in('machine_id', ids)
        .order('created_at', { ascending: false }))),
    db.from('departments')
      .select('id, head_user_id, head:users!head_user_id(is_active, is_service_account)')
      .eq('name', 'Брокерский')
      .eq('is_active', true)
      .limit(1),
  ])

  const stageError = stageResults.find((result) => result.error)?.error
  const documentError = documentResults.find((result) => result.error)?.error
  if (stageError) throw new Error(stageError.message || 'Не удалось загрузить готовность к погрузке')
  if (documentError) throw new Error(documentError.message || 'Не удалось загрузить документы')
  if (brokerDepartmentResult.error) throw new Error(brokerDepartmentResult.error.message || 'Не удалось проверить начальника отдела')

  const stageRows = stageResults.flatMap((result) => (result.data || []) as StageRow[])
  const documentRows = documentResults.flatMap((result) => (result.data || []) as DocumentRow[])

  const readinessByMachine = new Map<string, string>()
  for (const stage of stageRows) {
    if (readinessByMachine.has(stage.machine_id)) continue
    const readiness = stage.date_end || stage.planned_date_end
    if (readiness) readinessByMachine.set(stage.machine_id, readiness.slice(0, 10))
  }

  const documentsByMachine = new Map<string, CustomsDocument[]>()
  for (const document of documentRows) {
    const uploader = relationOne(document.uploader)
    const normalized: CustomsDocument = {
      id: document.id,
      documentKind: document.document_kind,
      fileName: document.file_name,
      mimeType: document.mime_type,
      fileSize: Number(document.file_size),
      uploadedBy: document.uploaded_by,
      uploadedByName: uploader?.full_name || 'Сотрудник',
      createdAt: document.created_at,
    }
    const current = documentsByMachine.get(document.machine_id) || []
    current.push(normalized)
    documentsByMachine.set(document.machine_id, current)
  }

  const machines = machineRows.flatMap<CustomsClearanceMachine>((machine) => {
    const readiness = readinessByMachine.get(machine.id)
    const factory = relationOne(machine.factory)
    if (!readiness || !machine.factory_id || !factory) return []
    return [{
      id: machine.id,
      name: machine.name || 'Машина без названия',
      factoryId: machine.factory_id,
      factoryName: factory.name || 'Завод',
      shippingReadinessDate: readiness,
      customsClearanceDate: machine.customs_clearance_date,
      deliveryToClientDate: machine.delivery_to_client_date,
      documents: documentsByMachine.get(machine.id) || [],
    }]
  })

  const factories = Array.from(new Map(
    machines.map((machine) => [machine.factoryId, { id: machine.factoryId, name: machine.factoryName }]),
  ).values()).sort((left, right) => left.name.localeCompare(right.name, 'ru'))
  const brokerDepartment = ((brokerDepartmentResult.data || []) as Array<{
    head_user_id: string | null
    head: { is_active: boolean | null; is_service_account: boolean | null }
      | Array<{ is_active: boolean | null; is_service_account: boolean | null }>
      | null
  }>)[0]
  const brokerHead = relationOne(brokerDepartment?.head)

  return {
    machines,
    factories,
    canManage: Boolean(context.permissions.customs_clearance?.canManage),
    headAssigned: Boolean(
      brokerDepartment?.head_user_id
      && brokerHead
      && brokerHead.is_active !== false
      && !brokerHead.is_service_account,
    ),
  }
}

export async function updateCustomsClearanceDate(machineId: string, value: string | null) {
  try {
    const parsed = z.string().uuid().parse(machineId)
    const date = value ? z.string().date().parse(value) : null
    const context = await requirePermission('customs_clearance', 'manage')
    const db = createAdminClient() as unknown as LooseDb
    await getMachineForAccess(db, parsed, context, 'manage')
    const { error } = await db
      .from('machines')
      .update({ customs_clearance_date: date })
      .eq('id', parsed)
    if (error) throw new Error(error.message || 'Не удалось сохранить дату затаможивания')
    revalidatePath(ROUTES.CUSTOMS_CLEARANCE)
    revalidatePath(`${ROUTES.SALES_PLAN}/${parsed}`)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'Не удалось сохранить дату затаможивания') }
  }
}

export async function registerCustomsClearanceDocuments(input: {
  machineId: string
  documentKind: CustomsDocumentKind
  uploads: CustomsClearanceDirectUpload[]
}) {
  try {
    const machineId = z.string().uuid().parse(input.machineId)
    const context = await requirePermission('customs_clearance', 'manage')
    const db = createAdminClient() as unknown as LooseDb
    await getMachineForAccess(db, machineId, context, 'manage')
    const uploads = validateCustomsClearanceUploads(
      machineId,
      context.userId,
      input.documentKind,
      input.uploads,
    )
    const { error } = await db.rpc('fn_finalize_customs_clearance_documents', {
      p_machine_id: machineId,
      p_user_id: context.userId,
      p_document_kind: input.documentKind,
      p_documents: uploads,
    })
    if (error) throw new Error(error.message || 'Не удалось прикрепить документы')
    revalidatePath(ROUTES.CUSTOMS_CLEARANCE)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'Не удалось прикрепить документы') }
  }
}

export async function deleteCustomsClearanceDocument(documentId: string) {
  try {
    const id = z.string().uuid().parse(documentId)
    const context = await requirePermission('customs_clearance', 'manage')
    const db = createAdminClient() as unknown as LooseDb
    const { data, error } = await db
      .from('machine_customs_documents')
      .select('id, machine_id, storage_path')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) throw new Error('Документ не найден')
    const document = data as { machine_id: string; storage_path: string }
    await getMachineForAccess(db, document.machine_id, context, 'manage')
    const { error: deleteError } = await db.from('machine_customs_documents').delete().eq('id', id)
    if (deleteError) throw new Error(deleteError.message || 'Не удалось удалить документ')

    const { error: storageError } = await createAdminClient().storage
      .from('customs-clearance-files')
      .remove([document.storage_path])
    if (storageError) console.error('[Customs clearance] Orphaned storage object:', document.storage_path, storageError)

    revalidatePath(ROUTES.CUSTOMS_CLEARANCE)
    revalidatePath(ROUTES.TASKS)
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error, 'Не удалось удалить документ') }
  }
}
