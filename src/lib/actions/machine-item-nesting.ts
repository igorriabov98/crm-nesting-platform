'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { fetchNestingService as fetch, getNestingServiceUrl, getResult, type SheetResult } from '@/lib/nesting/api'
import { resolveSheetMetalMaterialForRequestRow } from '@/lib/actions/request-sheet-metal-materials'
import type { Database } from '@/lib/types/database'
import type { PermissionOperation } from '@/lib/permissions/resources'
import type { MachineItemNestingRun } from '@/lib/types'

type ActionResult<T = unknown> = {
  success: boolean
  error?: string
  data?: T
}

type MachineItemRow = Pick<Database['public']['Tables']['machine_items']['Row'], 'id' | 'machine_id' | 'product_id' | 'drawing_number' | 'product_name' | 'quantity'>
type ProductRow = Pick<Database['public']['Tables']['products']['Row'], 'id' | 'name_uk' | 'drawing_number' | 'status'>
type ProductFileRow = Pick<Database['public']['Tables']['product_files']['Row'], 'id' | 'product_id' | 'file_kind' | 'file_name' | 'file_path' | 'mime_type'>
type MachineRow = Pick<Database['public']['Tables']['machines']['Row'], 'id' | 'name' | 'is_archived'>
type RequestRow = Pick<Database['public']['Tables']['technologist_requests']['Row'], 'id' | 'machine_id' | 'status'>
type SheetMetalInsert = Database['public']['Tables']['request_sheet_metal']['Insert']
type DbError = { message?: string } | null
type DbSingleResult<T> = { data: T | null; error: DbError }
type DbListResult<T> = { data: T[] | null; error: DbError; count?: number | null }
type LooseResult = { data: unknown; error: DbError; count?: number | null }
type LooseQuery = PromiseLike<LooseResult> & {
  select: (columns?: string, options?: { count?: 'exact'; head?: boolean }) => LooseQuery
  eq: (column: string, value: unknown) => LooseQuery
  in: (column: string, values: unknown[]) => LooseQuery
  order: (column: string, options?: { ascending?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<LooseResult>
  maybeSingle: () => Promise<LooseResult>
  insert: (values: unknown) => LooseQuery
  update: (values: unknown) => LooseQuery
  delete: () => LooseQuery
}
type LooseDb = { from: (table: string) => LooseQuery }

export type MachineItemNestingRunSummary = Pick<
  MachineItemNestingRun,
  'id' | 'machine_id' | 'machine_item_id' | 'product_id' | 'nesting_project_id' | 'status' | 'quantity_multiplier' | 'error_message' | 'updated_at'
>

export type MachineItemNestingState = {
  machineItemId: string
  productId: string | null
  productStatus: ProductRow['status'] | null
  stepFileCount: number
  drawingPdfFileCount: number
  fileIssue: string | null
  run: MachineItemNestingRunSummary | null
}

export type MachineItemNestingContext = MachineItemNestingRunSummary & {
  machineName: string
  productName: string
  machineItemName: string
  drawingNumber: string
  stepFileName: string
  drawingFileName: string
}

type CreatedNestingProject = {
  id: string
  status?: string
}

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

function summarizeRun(run: MachineItemNestingRun): MachineItemNestingRunSummary {
  return {
    id: run.id,
    machine_id: run.machine_id,
    machine_item_id: run.machine_item_id,
    product_id: run.product_id,
    nesting_project_id: run.nesting_project_id,
    status: run.status,
    quantity_multiplier: run.quantity_multiplier,
    error_message: run.error_message,
    updated_at: run.updated_at,
  }
}

function revalidateMachine(machineId: string, nestingProjectId?: string) {
  revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
  revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}/request`)
  revalidatePath(ROUTES.NESTING)
  if (nestingProjectId) {
    revalidatePath(`${ROUTES.NESTING}/${nestingProjectId}/parts`)
    revalidatePath(`${ROUTES.NESTING}/${nestingProjectId}/result`)
  }
}

async function requireEngineerConfirmation(
  db: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  machineId: string,
) {
  const { data, error } = await db
    .from('tasks')
    .select('id')
    .eq('machine_id', machineId)
    .eq('task_type', 'engineer_confirm')
    .eq('status', 'completed')
    .limit(1)

  if (error) throw new Error(error.message || 'Не удалось проверить подтверждение инженера')
  if (!data || data.length === 0) {
    throw new Error('Инженер еще не подтвердил правильность чертежей')
  }
}

async function loadStartContext(machineId: string, machineItemId: string) {
  const { supabase, userId } = await requireNestingPermission('manage')

  const [
    machineResult,
    itemResult,
    existingRunResult,
    requestResult,
  ] = await Promise.all([
    supabase.from('machines').select('id, name, is_archived').eq('id', machineId).single(),
    supabase.from('machine_items').select('id, machine_id, product_id, drawing_number, product_name, quantity').eq('id', machineItemId).eq('machine_id', machineId).single(),
    supabase.from('machine_item_nesting_runs').select('*').eq('machine_item_id', machineItemId).maybeSingle(),
    supabase.from('technologist_requests').select('id, machine_id, status').eq('machine_id', machineId).maybeSingle(),
  ]) as [
    DbSingleResult<MachineRow>,
    DbSingleResult<MachineItemRow>,
    DbSingleResult<MachineItemNestingRun>,
    DbSingleResult<RequestRow>,
  ]

  if (machineResult.error || !machineResult.data) throw new Error('Машина не найдена')
  if (itemResult.error || !itemResult.data) throw new Error('Строка товара не найдена')
  if (existingRunResult.error) throw new Error(existingRunResult.error.message || 'Не удалось проверить предыдущую раскладку')
  if (requestResult.error) throw new Error(requestResult.error.message || 'Не удалось проверить заявку технолога')

  const machine = machineResult.data
  const item = itemResult.data
  const existingRun = existingRunResult.data
  const request = requestResult.data

  if (machine.is_archived) throw new Error('Машина архивирована. Запуск раскладки остановлен.')
  if (!item.product_id) throw new Error('Строка машины не привязана к товару из базы')

  await requireEngineerConfirmation(supabase, machineId)

  const [productResult, filesResult] = await Promise.all([
    supabase.from('products').select('id, name_uk, drawing_number, status').eq('id', item.product_id).single(),
    supabase.from('product_files').select('id, product_id, file_kind, file_name, file_path, mime_type').eq('product_id', item.product_id),
  ]) as [DbSingleResult<ProductRow>, DbListResult<ProductFileRow>]

  if (productResult.error || !productResult.data) throw new Error('Товар не найден в базе продукции')
  if (filesResult.error) throw new Error(filesResult.error.message || 'Не удалось загрузить файлы товара')

  const product = productResult.data
  const files = filesResult.data || []
  if (product.status !== 'active') throw new Error('Товар не активен и не может быть отправлен в раскладку')

  const stepFiles = files.filter(isStepFile)
  const drawingFiles = files.filter(isPdfDrawing)
  const issue = fileIssue(stepFiles.length, drawingFiles.length)
  if (issue) throw new Error(issue)

  return {
    supabase,
    userId,
    machine,
    item,
    product,
    stepFile: stepFiles[0],
    drawingFile: drawingFiles[0],
    existingRun,
    request,
  }
}

async function deleteImportedRowsForRun(
  db: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  request: RequestRow | null,
  runId: string,
) {
  if (!request) return
  const looseDb = db as unknown as LooseDb

  const { count, error: countError } = await looseDb
    .from('request_sheet_metal')
    .select('id', { count: 'exact', head: true })
    .eq('source_nesting_run_id', runId)

  if (countError) throw new Error(countError.message || 'Не удалось проверить импортированные строки заявки')
  if (!count) return

  if (request.status !== 'draft') {
    throw new Error('Заявка уже передана дальше. Повторная раскладка с заменой импортированных строк доступна только в черновике.')
  }

  const { error } = await looseDb
    .from('request_sheet_metal')
    .delete()
    .eq('source_nesting_run_id', runId)

  if (error) throw new Error(error.message || 'Не удалось удалить старые импортированные строки')
}

async function downloadProductFile(file: ProductFileRow) {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from('product-files').download(file.file_path)
  if (error || !data) throw new Error(error?.message || `Не удалось скачать файл "${file.file_name}"`)
  return data
}

async function createNestingProject(input: {
  orderNumber: string
  quantity: number
  stepFile: ProductFileRow
  drawingFile: ProductFileRow
  createdBy: string
}) {
  let res: Response
  try {
    res = await fetch(`${getNestingServiceUrl()}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderNumber: input.orderNumber,
        quantity: input.quantity,
        stepStorageUri: `supabase://product-files/${input.stepFile.file_path}`,
        pdfStorageUri: `supabase://product-files/${input.drawingFile.file_path}`,
        createdBy: input.createdBy,
      }),
    })
  } catch (error) {
    const details = error instanceof Error ? error.message : 'неизвестная ошибка'
    throw new Error(`Сервис раскладки недоступен (${details})`)
  }

  const payload = await res.json().catch(async () => {
    const text = await res.text().catch(() => '')
    return { error: text || 'Не удалось создать проект раскладки' }
  }) as { data?: CreatedNestingProject; error?: string; message?: string }

  if (!res.ok || !payload.data?.id) {
    throw new Error(payload.error || payload.message || 'Не удалось создать проект раскладки')
  }

  return payload.data
}

async function deleteServiceProject(projectId: string) {
  await fetch(`${getNestingServiceUrl()}/api/projects/${projectId}`, { method: 'DELETE' }).catch(() => undefined)
}

export async function getMachineItemNestingStates(machineId: string): Promise<ActionResult<MachineItemNestingState[]>> {
  try {
    const { supabase } = await requireNestingPermission('view')

    const [itemsResult, runsResult] = await Promise.all([
      supabase.from('machine_items').select('id, product_id').eq('machine_id', machineId),
      supabase.from('machine_item_nesting_runs').select('*').eq('machine_id', machineId),
    ]) as [
      DbListResult<Pick<MachineItemRow, 'id' | 'product_id'>>,
      DbListResult<MachineItemNestingRun>,
    ]

    if (itemsResult.error) throw new Error(itemsResult.error.message || 'Не удалось загрузить товары машины')
    if (runsResult.error) throw new Error(runsResult.error.message || 'Не удалось загрузить раскладки машины')

    const items = itemsResult.data || []
    const productIds = Array.from(new Set(items.map((item) => item.product_id).filter(Boolean))) as string[]
    let productRows: Pick<ProductRow, 'id' | 'status'>[] = []
    let fileRows: ProductFileRow[] = []

    if (productIds.length > 0) {
      const [productsResult, filesResult] = await Promise.all([
        supabase.from('products').select('id, status').in('id', productIds),
        supabase.from('product_files').select('id, product_id, file_kind, file_name, file_path, mime_type').in('product_id', productIds),
      ]) as [
        DbListResult<Pick<ProductRow, 'id' | 'status'>>,
        DbListResult<ProductFileRow>,
      ]

      if (productsResult.error) throw new Error(productsResult.error.message || 'Не удалось загрузить товары')
      if (filesResult.error) throw new Error(filesResult.error.message || 'Не удалось загрузить файлы товаров')
      productRows = productsResult.data || []
      fileRows = filesResult.data || []
    }

    const products = new Map(productRows.map((product) => [product.id, product.status]))
    const filesByProduct = new Map<string, ProductFileRow[]>()
    for (const file of fileRows) {
      filesByProduct.set(file.product_id, [...(filesByProduct.get(file.product_id) || []), file])
    }
    const runs = new Map((runsResult.data || []).map((run) => [run.machine_item_id, summarizeRun(run)]))

    return {
      success: true,
      data: items.map((item) => {
        const files = item.product_id ? filesByProduct.get(item.product_id) || [] : []
        const stepFileCount = files.filter(isStepFile).length
        const drawingPdfFileCount = files.filter(isPdfDrawing).length
        return {
          machineItemId: item.id,
          productId: item.product_id,
          productStatus: item.product_id ? products.get(item.product_id) || null : null,
          stepFileCount,
          drawingPdfFileCount,
          fileIssue: item.product_id ? fileIssue(stepFileCount, drawingPdfFileCount) : 'Строка не привязана к товару из базы',
          run: runs.get(item.id) || null,
        }
      }),
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось загрузить состояния раскладки' }
  }
}

export async function getMachineItemNestingContext(projectId: string): Promise<ActionResult<MachineItemNestingContext | null>> {
  try {
    const { supabase } = await requireNestingPermission('view')

    const { data: runData, error: runError } = await supabase
      .from('machine_item_nesting_runs')
      .select('*')
      .eq('nesting_project_id', projectId)
      .maybeSingle() as DbSingleResult<MachineItemNestingRun>

    if (runError) throw new Error(runError.message || 'Не удалось загрузить связь раскладки')
    if (!runData) return { success: true, data: null }

    const run = runData
    const [machineResult, itemResult, productResult, stepResult, drawingResult] = await Promise.all([
      supabase.from('machines').select('id, name').eq('id', run.machine_id).single(),
      supabase.from('machine_items').select('id, drawing_number, product_name').eq('id', run.machine_item_id).single(),
      supabase.from('products').select('id, name_uk, drawing_number').eq('id', run.product_id).single(),
      supabase.from('product_files').select('id, file_name').eq('id', run.step_file_id).single(),
      supabase.from('product_files').select('id, file_name').eq('id', run.drawing_file_id).single(),
    ]) as [
      DbSingleResult<Pick<MachineRow, 'id' | 'name'>>,
      DbSingleResult<Pick<MachineItemRow, 'id' | 'drawing_number' | 'product_name'>>,
      DbSingleResult<Pick<ProductRow, 'id' | 'name_uk' | 'drawing_number'>>,
      DbSingleResult<Pick<ProductFileRow, 'id' | 'file_name'>>,
      DbSingleResult<Pick<ProductFileRow, 'id' | 'file_name'>>,
    ]

    if (machineResult.error || !machineResult.data) throw new Error('Машина раскладки не найдена')
    if (itemResult.error || !itemResult.data) throw new Error('Строка товара раскладки не найдена')
    if (productResult.error || !productResult.data) throw new Error('Товар раскладки не найден')
    if (stepResult.error || !stepResult.data) throw new Error('STEP-файл раскладки не найден')
    if (drawingResult.error || !drawingResult.data) throw new Error('PDF-чертеж раскладки не найден')

    return {
      success: true,
      data: {
        ...summarizeRun(run),
        machineName: machineResult.data.name,
        productName: productResult.data.name_uk,
        machineItemName: itemResult.data.product_name,
        drawingNumber: itemResult.data.drawing_number,
        stepFileName: stepResult.data.file_name,
        drawingFileName: drawingResult.data.file_name,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось загрузить контекст раскладки' }
  }
}

export async function startMachineItemNesting(machineId: string, machineItemId: string): Promise<ActionResult<MachineItemNestingRunSummary>> {
  let createdProjectId: string | null = null

  try {
    const context = await loadStartContext(machineId, machineItemId)
    if (context.existingRun) {
      await deleteImportedRowsForRun(context.supabase, context.request, context.existingRun.id)
    }

    const quantity = Math.max(1, Math.trunc(Number(context.item.quantity) || 1))
    const orderNumber = `${context.machine.name} / ${context.product.drawing_number || context.item.drawing_number}`
    const project = await createNestingProject({
      orderNumber,
      quantity,
      stepFile: context.stepFile,
      drawingFile: context.drawingFile,
      createdBy: context.userId,
    })
    createdProjectId = project.id

    const payload = {
      machine_id: context.machine.id,
      machine_item_id: context.item.id,
      product_id: context.product.id,
      step_file_id: context.stepFile.id,
      drawing_file_id: context.drawingFile.id,
      nesting_project_id: project.id,
      status: 'draft' as const,
      quantity_multiplier: quantity,
      error_message: null,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    }

    const db = context.supabase as unknown as LooseDb
    const result = (context.existingRun
      ? await db
          .from('machine_item_nesting_runs')
          .update(payload)
          .eq('id', context.existingRun.id)
          .select('*')
          .single()
      : await db
          .from('machine_item_nesting_runs')
          .insert({ ...payload, created_by: context.userId })
          .select('*')
          .single()) as DbSingleResult<MachineItemNestingRun>

    if (result.error || !result.data) throw new Error(result.error?.message || 'Не удалось сохранить связь раскладки')

    revalidateMachine(machineId, project.id)
    return { success: true, data: summarizeRun(result.data) }
  } catch (error) {
    if (createdProjectId) {
      await deleteServiceProject(createdProjectId)
    }
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось запустить раскладку' }
  }
}

function sheetNumber(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
}

function sheetSize(sheet: SheetResult) {
  return `${sheetNumber(sheet.width)}x${sheetNumber(sheet.height)}`
}

type SheetGroup = {
  key: string
  material: string
  steelTypeId: string | null
  steelTypeName: string | null
  thickness: number
  size: string
  count: number
}

function groupSheets(sheets: SheetResult[]) {
  const groups = new Map<string, SheetGroup>()
  for (const sheet of sheets) {
    const material = sheet.material || 'Листовой металл'
    const steelTypeId = sheet.steelTypeId || null
    const steelTypeName = sheet.steelTypeName || null
    const thickness = sheetNumber(sheet.thickness)
    const size = sheetSize(sheet)
    const key = [material, steelTypeId || '', steelTypeName || '', thickness, size, sheet.isRemnant ? 'remnant' : 'sheet'].join('|')
    const current = groups.get(key)
    if (current) {
      current.count += 1
    } else {
      groups.set(key, { key, material, steelTypeId, steelTypeName, thickness, size, count: 1 })
    }
  }
  return Array.from(groups.values())
}

async function ensureDraftRequest(
  db: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  machineId: string,
  userId: string,
) {
  const looseDb = db as unknown as LooseDb
  const { data: existing, error } = await looseDb
    .from('technologist_requests')
    .select('id, machine_id, status')
    .eq('machine_id', machineId)
    .maybeSingle() as DbSingleResult<RequestRow>

  if (error) throw new Error(error.message || 'Не удалось проверить заявку технолога')
  if (existing) {
    const request = existing
    if (request.status !== 'draft') {
      throw new Error('Импорт раскладки доступен только в черновик заявки технолога')
    }
    return request
  }

  const { data, error: insertError } = await looseDb
    .from('technologist_requests')
    .insert({ machine_id: machineId, created_by: userId, status: 'draft' })
    .select('id, machine_id, status')
    .single() as DbSingleResult<RequestRow>

  if (insertError || !data) throw new Error(insertError?.message || 'Не удалось создать заявку технолога')
  return data
}

async function assertMachineEditable(
  db: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  machineId: string,
) {
  const { data, error } = await db.from('machines').select('id, is_archived').eq('id', machineId).single() as DbSingleResult<Pick<MachineRow, 'id' | 'is_archived'>>
  if (error || !data) throw new Error('Машина не найдена')
  if (data.is_archived) throw new Error('Машина архивирована. Импорт остановлен.')
}

export async function importMachineItemNestingResult(projectId: string): Promise<ActionResult<{ machineId: string; requestId: string; rowsInserted: number }>> {
  try {
    const { supabase, userId } = await requireNestingPermission('manage')

    const { data: runData, error: runError } = await supabase
      .from('machine_item_nesting_runs')
      .select('*')
      .eq('nesting_project_id', projectId)
      .single() as DbSingleResult<MachineItemNestingRun>

    if (runError || !runData) throw new Error('Связь раскладки с товаром машины не найдена')
    const run = runData
    await assertMachineEditable(supabase, run.machine_id)
    await requireEngineerConfirmation(supabase, run.machine_id)

    const request = await ensureDraftRequest(supabase, run.machine_id, userId)
    const result = await getResult(projectId)
    const groups = groupSheets(result.data.sheets)
    if (groups.length === 0) throw new Error('В результате раскладки нет листов для импорта')

    const { data: sortRows, error: sortError } = await supabase
      .from('request_sheet_metal')
      .select('sort_order')
      .eq('request_id', request.id)
      .order('sort_order', { ascending: false })
      .limit(1) as DbListResult<{ sort_order: number }>

    if (sortError) throw new Error(sortError.message || 'Не удалось определить порядок строк заявки')
    const baseSortOrder = Number(sortRows?.[0]?.sort_order || 0)

    const db = supabase as unknown as LooseDb
    const { error: deleteError } = await db
      .from('request_sheet_metal')
      .delete()
      .eq('request_id', request.id)
      .eq('source_nesting_run_id', run.id)

    if (deleteError) throw new Error(deleteError.message || 'Не удалось заменить старые строки раскладки')

    const resolvedMaterials = await Promise.all(groups.map((group) => (
      resolveSheetMetalMaterialForRequestRow(db, userId, {
        materialName: group.material,
        materialGrade: group.steelTypeName,
        steelTypeId: group.steelTypeId,
        sheetSize: group.size,
        thicknessMm: group.thickness,
      })
    )))

    const rows: SheetMetalInsert[] = groups.map((group, index) => {
      const resolvedMaterial = resolvedMaterials[index]
      return {
        request_id: request.id,
        material_name: resolvedMaterial.materialName,
        material_grade: group.steelTypeName,
        steel_type_id: group.steelTypeId,
        sheet_size: group.size,
        thickness_mm: group.thickness,
        quantity_sheets: group.count,
        remainder_qty: group.count,
        material_id: resolvedMaterial.materialId,
        material_variant_id: resolvedMaterial.materialVariantId,
        is_custom_material_variant: false,
        sort_order: baseSortOrder + index + 1,
        source_nesting_run_id: run.id,
        source_machine_item_id: run.machine_item_id,
        source_product_id: run.product_id,
        source_nesting_project_id: run.nesting_project_id,
        source_nesting_sheet_id: group.key,
      }
    })

    const { error: insertError } = await db.from('request_sheet_metal').insert(rows)
    if (insertError) throw new Error(insertError.message || 'Не удалось импортировать листы в заявку')

    const { error: updateError } = await db
      .from('machine_item_nesting_runs')
      .update({
        status: 'imported',
        error_message: null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id)

    if (updateError) throw new Error(updateError.message || 'Не удалось обновить статус импорта')

    revalidateMachine(run.machine_id, projectId)
    return { success: true, data: { machineId: run.machine_id, requestId: request.id, rowsInserted: rows.length } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось импортировать результат раскладки' }
  }
}
