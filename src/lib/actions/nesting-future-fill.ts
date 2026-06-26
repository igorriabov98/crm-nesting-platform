'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { ROUTES } from '@/lib/constants/routes'
import { createNestingBatch } from '@/lib/actions/nesting-batches'
import { resolveSheetMetalMaterialForRequestRow } from '@/lib/actions/request-sheet-metal-materials'
import { getResult, type NestingResult, type RemnantGeom, type SheetResult } from '@/lib/nesting/api'
import { requirePermission } from '@/lib/permissions/server'
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
  gt: (column: string, value: unknown) => LooseQuery
  lte: (column: string, value: unknown) => LooseQuery
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => LooseQuery
  limit: (count: number) => LooseQuery
  single: () => Promise<DbResult>
  maybeSingle: () => Promise<DbResult>
  insert: (values: unknown) => LooseQuery
  update: (values: Record<string, unknown>) => LooseQuery
}

type LooseDb = {
  from: (table: string) => LooseQuery
}

type BatchRow = {
  id: string
  nesting_project_id: string
  source_nesting_project_id: string | null
  is_future_fill: boolean
  status: string
}

type BatchItemRow = {
  machine_id: string
  machine_item_id: string
  fill_role?: 'original' | 'future' | null
}

type CuttingStageRow = {
  id: string
  machine_id: string
  date_start: string | null
  machines?: { factory_id: string | null } | null
}

type CandidateStageRow = {
  id: string
  machine_id: string
  date_start: string | null
  machines?: {
    id: string
    name: string
    is_archived?: boolean | null
    client?: { name?: string | null } | null
  } | null
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

type RunRow = {
  machine_item_id: string
  status: 'draft' | 'calculated' | 'imported' | 'error'
}

type PrecutRow = {
  machine_item_id: string
  quantity: number
}

type FutureFillBatchContext = {
  batch: BatchRow
  items: BatchItemRow[]
  originalItemIds: string[]
  futureItemIds: string[]
  originalMachineIds: string[]
}

export type FutureFillRemnant = {
  sheetId: string
  sheetIndex: number
  material: string
  steelTypeId: string | null
  steelTypeName: string | null
  thickness: number
  width: number
  height: number
  area: number
}

export type FutureFillCandidate = {
  machineId: string
  machineName: string
  clientName: string | null
  cuttingDate: string
  machineItemId: string
  productName: string
  drawingNumber: string | null
  quantity: number
  precutQuantity: number
  remainingQuantity: number
  note: string
}

export type FutureFillContext = {
  projectId: string
  sourceProjectId: string | null
  isFutureFillProject: boolean
  batchDate: string | null
  eligible: boolean
  reason: string | null
  usableRemnants: FutureFillRemnant[]
  candidates: FutureFillCandidate[]
  originalItemIds: string[]
  futureItemIds: string[]
  finalized: boolean
  canFinalize: boolean
}

const createFutureFillSchema = z.object({
  sourceProjectId: z.string().min(1),
  futureMachineItemIds: z.array(z.string().uuid()).min(1).max(50),
})

const finalizeFutureFillSchema = z.object({
  projectId: z.string().min(1),
})

async function requireNestingAccess(operation: PermissionOperation = 'view') {
  const { supabase, userId } = await requirePermission('nesting', operation)
  return { db: supabase as unknown as LooseDb, userId }
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

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function sheetRemnant(sheet: SheetResult): FutureFillRemnant | null {
  const remnant = sheet.remnantGeom
  if (!remnant?.isUsable) return null
  return {
    sheetId: sheet.id,
    sheetIndex: sheet.sheetIndex,
    material: sheet.material,
    steelTypeId: sheet.steelTypeId,
    steelTypeName: sheet.steelTypeName,
    thickness: sheet.thickness,
    width: remnant.width,
    height: remnant.height,
    area: remnant.area,
  }
}

function usableRemnants(result: NestingResult) {
  return result.sheets.map(sheetRemnant).filter((item): item is FutureFillRemnant => Boolean(item))
}

async function loadBatchContext(db: LooseDb, projectId: string): Promise<FutureFillBatchContext | null> {
  const { data: batchData, error } = await db
    .from('nesting_batches')
    .select('id, nesting_project_id, source_nesting_project_id, is_future_fill, status')
    .eq('nesting_project_id', projectId)
    .maybeSingle()
  if (error || !batchData) return null

  const batch = batchData as BatchRow
  const { data: itemData, error: itemError } = await db
    .from('nesting_batch_items')
    .select('machine_id, machine_item_id, fill_role')
    .eq('batch_id', batch.id)

  if (itemError) throw new Error(itemError.message || 'Не удалось загрузить строки batch раскладки')

  const items = (itemData || []) as BatchItemRow[]
  const originalItems = items.filter((item) => !batch.is_future_fill || item.fill_role !== 'future')
  const futureItems = items.filter((item) => batch.is_future_fill && item.fill_role === 'future')

  return {
    batch,
    items,
    originalItemIds: originalItems.map((item) => item.machine_item_id),
    futureItemIds: futureItems.map((item) => item.machine_item_id),
    originalMachineIds: Array.from(new Set(originalItems.map((item) => item.machine_id))),
  }
}

async function loadCuttingContext(db: LooseDb, machineIds: string[]) {
  if (machineIds.length === 0) return null
  const { data, error } = await db
    .from('production_stages')
    .select('id, machine_id, date_start, machines!inner(factory_id)')
    .eq('stage_type', 'cutting')
    .in('machine_id', machineIds)

  if (error) throw new Error(error.message || 'Не удалось загрузить даты заготовки')
  const stages = ((data || []) as CuttingStageRow[]).filter((stage) => stage.date_start)
  if (stages.length === 0) return null
  stages.sort((a, b) => String(a.date_start).localeCompare(String(b.date_start)))
  const latest = stages[stages.length - 1]
  return {
    date: latest.date_start as string,
    stageId: latest.id,
    machineId: latest.machine_id,
    factoryId: latest.machines?.factory_id || null,
  }
}

function placementCounts(result: NestingResult, itemIds: Set<string>) {
  const counts = new Map<string, number>()
  for (const sheet of result.sheets) {
    for (const placement of sheet.placements) {
      const itemId = placement.sourceMachineItemId
      if (!itemId || !itemIds.has(itemId)) continue
      counts.set(itemId, (counts.get(itemId) || 0) + 1)
    }
  }
  return counts
}

async function loadFinalizedState(db: LooseDb, projectId: string) {
  const [precutResult, scrapResult] = await Promise.all([
    db.from('nesting_precut_parts').select('id').eq('source_nesting_project_id', projectId).limit(1),
    db.from('inventory').select('id').eq('source_nesting_project_id', projectId).limit(1),
  ])
  return Boolean((precutResult.data as unknown[] | null)?.length || (scrapResult.data as unknown[] | null)?.length)
}

async function loadCandidates(db: LooseDb, batchDate: string, originalMachineIds: string[]) {
  const until = addDays(batchDate, 30)
  const { data: stageData, error: stageError } = await db
    .from('production_stages')
    .select('id, machine_id, date_start, machines!inner(id, name, is_archived, client:clients(name))')
    .eq('stage_type', 'cutting')
    .gt('date_start', batchDate)
    .lte('date_start', until)
    .order('date_start', { ascending: true })

  if (stageError) throw new Error(stageError.message || 'Не удалось загрузить будущие машины')
  const stages = ((stageData || []) as CandidateStageRow[])
    .filter((stage) => stage.date_start && stage.machines && !stage.machines.is_archived && !originalMachineIds.includes(stage.machine_id))
  const machineIds = Array.from(new Set(stages.map((stage) => stage.machine_id)))
  if (machineIds.length === 0) return []

  const [itemsResult, tasksResult] = await Promise.all([
    db
      .from('machine_items')
      .select('id, machine_id, product_id, drawing_number, product_name, quantity, is_sample, sort_order')
      .in('machine_id', machineIds)
      .order('sort_order', { ascending: true }),
    db
      .from('tasks')
      .select('machine_id')
      .eq('task_type', 'engineer_confirm')
      .eq('status', 'completed')
      .in('machine_id', machineIds),
  ])

  if (itemsResult.error) throw new Error(itemsResult.error.message || 'Не удалось загрузить будущие детали')
  if (tasksResult.error) throw new Error(tasksResult.error.message || 'Не удалось проверить подтверждение инженера')

  const items = ((itemsResult.data || []) as MachineItemRow[]).filter((item) => !item.is_sample)
  const productIds = Array.from(new Set(items.map((item) => item.product_id).filter(Boolean))) as string[]
  const itemIds = items.map((item) => item.id)

  const [productsResult, filesResult, runsResult, precutsResult] = await Promise.all([
    productIds.length ? db.from('products').select('id, name_uk, drawing_number, status').in('id', productIds) : Promise.resolve({ data: [], error: null } as DbResult),
    productIds.length ? db.from('product_files').select('id, product_id, file_kind, file_name, file_path, mime_type').in('product_id', productIds) : Promise.resolve({ data: [], error: null } as DbResult),
    itemIds.length ? db.from('machine_item_nesting_runs').select('machine_item_id, status').in('machine_item_id', itemIds) : Promise.resolve({ data: [], error: null } as DbResult),
    itemIds.length ? db.from('nesting_precut_parts').select('machine_item_id, quantity').in('machine_item_id', itemIds) : Promise.resolve({ data: [], error: null } as DbResult),
  ])

  if (productsResult.error) throw new Error(productsResult.error.message || 'Не удалось загрузить товары будущих машин')
  if (filesResult.error) throw new Error(filesResult.error.message || 'Не удалось загрузить файлы будущих товаров')
  if (runsResult.error) throw new Error(runsResult.error.message || 'Не удалось загрузить статусы будущих раскладок')

  const engineerConfirmed = new Set(((tasksResult.data || []) as { machine_id: string }[]).map((task) => task.machine_id))
  const productById = new Map(((productsResult.data || []) as ProductRow[]).map((product) => [product.id, product]))
  const filesByProduct = new Map<string, ProductFileRow[]>()
  for (const file of (filesResult.data || []) as ProductFileRow[]) {
    filesByProduct.set(file.product_id, [...(filesByProduct.get(file.product_id) || []), file])
  }
  const runByItem = new Map(((runsResult.data || []) as RunRow[]).map((run) => [run.machine_item_id, run]))
  const precutByItem = new Map<string, number>()
  if (!precutsResult.error) {
    for (const row of (precutsResult.data || []) as PrecutRow[]) {
      precutByItem.set(row.machine_item_id, (precutByItem.get(row.machine_item_id) || 0) + Number(row.quantity || 0))
    }
  }
  const stageByMachine = new Map(stages.map((stage) => [stage.machine_id, stage]))
  const candidates: FutureFillCandidate[] = []

  for (const item of items) {
    const stage = stageByMachine.get(item.machine_id)
    if (!stage?.date_start || !stage.machines) continue
    if (!engineerConfirmed.has(item.machine_id)) continue
    if (!item.product_id) continue
    const product = productById.get(item.product_id)
    if (!product || product.status !== 'active') continue
    const files = filesByProduct.get(item.product_id) || []
    if (files.filter(isStepFile).length !== 1 || files.filter(isPdfDrawing).length !== 1) continue
    const run = runByItem.get(item.id)
    if (run?.status === 'calculated' || run?.status === 'imported') continue
    const quantity = Math.max(0, Number(item.quantity || 0))
    const precutQuantity = Math.min(quantity, precutByItem.get(item.id) || 0)
    const remainingQuantity = Math.max(quantity - precutQuantity, 0)
    if (remainingQuantity <= 0) continue

    candidates.push({
      machineId: item.machine_id,
      machineName: stage.machines.name,
      clientName: stage.machines.client?.name || null,
      cuttingDate: stage.date_start,
      machineItemId: item.id,
      productName: item.product_name || product.name_uk,
      drawingNumber: item.drawing_number || product.drawing_number || null,
      quantity,
      precutQuantity,
      remainingQuantity,
      note: 'Материал будет проверен после пересчета раскладки',
    })
  }

  return candidates
}

export async function getFutureFillContext(projectId: string): Promise<ActionResult<FutureFillContext>> {
  try {
    const { db } = await requireNestingAccess('view')
    const context = await loadBatchContext(db, projectId)
    if (!context) {
      return {
        success: true,
        data: {
          projectId,
          sourceProjectId: null,
          isFutureFillProject: false,
          batchDate: null,
          eligible: false,
          reason: 'Batch раскладки не найден в CRM',
          usableRemnants: [],
          candidates: [],
          originalItemIds: [],
          futureItemIds: [],
          finalized: false,
          canFinalize: false,
        },
      }
    }

    const result = (await getResult(projectId)).data
    const remnants = usableRemnants(result)
    const cutting = await loadCuttingContext(db, context.originalMachineIds)
    const finalized = await loadFinalizedState(db, projectId)
    const base: FutureFillContext = {
      projectId,
      sourceProjectId: context.batch.source_nesting_project_id,
      isFutureFillProject: context.batch.is_future_fill,
      batchDate: cutting?.date || null,
      eligible: false,
      reason: null,
      usableRemnants: remnants,
      candidates: [],
      originalItemIds: context.originalItemIds,
      futureItemIds: context.futureItemIds,
      finalized,
      canFinalize: context.batch.is_future_fill && !finalized && result.sheets.length > 0,
    }

    if (context.batch.is_future_fill) {
      return { success: true, data: { ...base, eligible: false, reason: null } }
    }
    if (remnants.length === 0) {
      return { success: true, data: { ...base, reason: 'В результате нет пригодного остатка на листах' } }
    }
    if (!cutting?.date) {
      return { success: true, data: { ...base, reason: 'У исходных машин не указана дата начала заготовки' } }
    }

    const candidates = await loadCandidates(db, cutting.date, context.originalMachineIds)
    return {
      success: true,
      data: {
        ...base,
        eligible: candidates.length > 0,
        reason: candidates.length > 0 ? null : 'Нет готовых будущих деталей в ближайшие 30 дней',
        candidates,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось загрузить будущие детали для заполнения остатка' }
  }
}

export async function createFutureFillBatch(input: {
  sourceProjectId: string
  futureMachineItemIds: string[]
}): Promise<ActionResult<{ nestingProjectId: string }>> {
  try {
    const parsed = createFutureFillSchema.parse(input)
    const contextResult = await getFutureFillContext(parsed.sourceProjectId)
    if (!contextResult.success || !contextResult.data) throw new Error(contextResult.error || 'Не удалось подготовить future-fill batch')
    const context = contextResult.data
    if (!context.eligible) throw new Error(context.reason || 'Нет доступных будущих деталей')

    const candidateIds = new Set(context.candidates.map((candidate) => candidate.machineItemId))
    const selectedFutureIds = Array.from(new Set(parsed.futureMachineItemIds))
    const invalid = selectedFutureIds.filter((id) => !candidateIds.has(id))
    if (invalid.length) throw new Error('В выборе есть будущие детали, которые уже нельзя добавить')

    const result = await createNestingBatch({
      machineItemIds: [...context.originalItemIds, ...selectedFutureIds],
      sourceNestingProjectId: parsed.sourceProjectId,
      futureMachineItemIds: selectedFutureIds,
    })
    if (!result.success || !result.data) throw new Error(result.error || 'Не удалось создать future-fill batch')
    return { success: true, data: result.data }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось создать batch с будущими деталями' }
  }
}

function futurePlacementRows(projectId: string, result: NestingResult, futureItemIds: Set<string>, userId: string) {
  const rows = new Map<string, {
    machine_id: string
    machine_item_id: string
    product_id: string | null
    part_id: string | null
    part_name: string
    quantity: number
    source_nesting_project_id: string
    source_nesting_sheet_id: string
    source_nesting_placement: unknown
    created_by: string
  }>()

  for (const sheet of result.sheets) {
    for (const placement of sheet.placements) {
      if (!placement.sourceMachineItemId || !futureItemIds.has(placement.sourceMachineItemId)) continue
      if (!placement.sourceMachineId) continue
      const key = [placement.sourceMachineItemId, sheet.id, placement.partId, placement.name].join('|')
      const current = rows.get(key)
      const placementPayload = {
        sheetId: sheet.id,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        placedW: placement.placedW,
        placedH: placement.placedH,
      }
      if (current) {
        current.quantity += 1
        current.source_nesting_placement = {
          placements: [...(((current.source_nesting_placement as { placements?: unknown[] })?.placements) || []), placementPayload],
        }
      } else {
        rows.set(key, {
          machine_id: placement.sourceMachineId,
          machine_item_id: placement.sourceMachineItemId,
          product_id: placement.sourceProductId || null,
          part_id: placement.partId || null,
          part_name: placement.name,
          quantity: 1,
          source_nesting_project_id: projectId,
          source_nesting_sheet_id: sheet.id,
          source_nesting_placement: { placements: [placementPayload] },
          created_by: userId,
        })
      }
    }
  }

  return Array.from(rows.values())
}

function sourceRemnantPayload(remnant: RemnantGeom) {
  return {
    x: remnant.x,
    y: remnant.y,
    width: remnant.width,
    height: remnant.height,
    area: remnant.area,
    isUsable: remnant.isUsable,
  }
}

function sheetSizeFromRemnant(remnant: RemnantGeom) {
  return `${Math.round(remnant.width)}x${Math.round(remnant.height)}`
}

export async function finalizeFutureFill(input: {
  projectId: string
}): Promise<ActionResult<{ precutRows: number; futureScrapRows: number }>> {
  try {
    const parsed = finalizeFutureFillSchema.parse(input)
    const { db, userId } = await requireNestingAccess('manage')
    const context = await loadBatchContext(db, parsed.projectId)
    if (!context?.batch.is_future_fill || !context.batch.source_nesting_project_id) {
      throw new Error('Это не batch заполнения будущими деталями')
    }

    const alreadyFinalized = await loadFinalizedState(db, parsed.projectId)
    if (alreadyFinalized) return { success: true, data: { precutRows: 0, futureScrapRows: 0 } }

    const [currentResult, sourceResult] = await Promise.all([
      getResult(parsed.projectId),
      getResult(context.batch.source_nesting_project_id),
    ])

    if (currentResult.data.totalSheets > sourceResult.data.totalSheets) {
      throw new Error('Future-fill результат добавил новые листы. Такой результат нельзя применить.')
    }
    if (currentResult.data.unplacedParts.length > 0) {
      throw new Error('В future-fill результате есть неразмещенные детали. Такой результат нельзя применить.')
    }

    const originalIds = new Set(context.originalItemIds)
    const sourceOriginalCounts = placementCounts(sourceResult.data, originalIds)
    const currentOriginalCounts = placementCounts(currentResult.data, originalIds)
    for (const [itemId, sourceCount] of sourceOriginalCounts) {
      if ((currentOriginalCounts.get(itemId) || 0) < sourceCount) {
        throw new Error('Future-fill результат потерял часть исходных деталей. Такой результат нельзя применить.')
      }
    }

    const futureIds = new Set(context.futureItemIds)
    const precutRows = futurePlacementRows(parsed.projectId, currentResult.data, futureIds, userId)
    if (precutRows.length === 0) throw new Error('В результате нет размещенных будущих деталей для фиксации')

    const precutInsert = await db.from('nesting_precut_parts').insert(precutRows)
    if (precutInsert.error) throw new Error(precutInsert.error.message || 'Не удалось записать уже вырезанные будущие детали')

    const cutting = await loadCuttingContext(db, context.originalMachineIds)
    if (!cutting?.date) throw new Error('У исходной машины не указана дата начала заготовки')
    if (!cutting.factoryId) throw new Error('У исходной машины не указан завод для будущего делового остатка')

    const { data: existingScrapData } = await db
      .from('inventory')
      .select('source_nesting_sheet_id')
      .eq('source_nesting_project_id', parsed.projectId)
    const existingSheetIds = new Set(((existingScrapData || []) as { source_nesting_sheet_id: string | null }[]).map((row) => row.source_nesting_sheet_id).filter(Boolean))
    const futureScrapRows: Array<Record<string, unknown>> = []

    for (const sheet of currentResult.data.sheets) {
      if (!sheet.remnantGeom?.isUsable || existingSheetIds.has(sheet.id)) continue
      const resolved = await resolveSheetMetalMaterialForRequestRow(db, userId, {
        materialName: sheet.material,
        materialGrade: sheet.steelTypeName,
        steelTypeId: sheet.steelTypeId,
        sheetSize: sheetSizeFromRemnant(sheet.remnantGeom),
        thicknessMm: sheet.thickness,
      })

      futureScrapRows.push({
        factory_id: cutting.factoryId,
        material_id: resolved.materialId,
        material_variant_id: resolved.materialVariantId,
        total_quantity: 1,
        reserved_quantity: 0,
        unit: 'шт',
        total_secondary_quantity: null,
        reserved_secondary_quantity: null,
        secondary_unit: null,
        is_business_scrap: true,
        business_scrap_state: 'future',
        available_from_date: cutting.date,
        available_from_stage_id: cutting.stageId,
        source_machine_id: cutting.machineId,
        source_nesting_project_id: parsed.projectId,
        source_nesting_sheet_id: sheet.id,
        source_remnant_geom: sourceRemnantPayload(sheet.remnantGeom),
        last_updated_by: userId,
      })
    }

    let insertedScrapRows = 0
    if (futureScrapRows.length > 0) {
      const insertResult = await db
        .from('inventory')
        .insert(futureScrapRows)
        .select('id, factory_id, material_id, material_variant_id')
      if (insertResult.error) throw new Error(insertResult.error.message || 'Не удалось записать будущий деловой остаток')
      const inventoryRows = (insertResult.data || []) as Array<{ id: string; factory_id: string; material_id: string; material_variant_id: string | null }>
      insertedScrapRows = inventoryRows.length
      const transactions = inventoryRows.map((row) => ({
        factory_id: row.factory_id,
        inventory_id: row.id,
        material_id: row.material_id,
        material_variant_id: row.material_variant_id,
        transaction_type: 'receipt',
        quantity: 1,
        secondary_quantity: null,
        machine_id: cutting.machineId,
        performed_by: userId,
        comment: 'Будущий деловой остаток после future-fill раскладки',
      }))
      if (transactions.length) {
        const txResult = await db.from('inventory_transactions').insert(transactions)
        if (txResult.error) throw new Error(txResult.error.message || 'Не удалось записать историю будущего делового остатка')
      }
    }

    revalidatePath(ROUTES.NESTING)
    revalidatePath(ROUTES.INVENTORY)
    for (const machineId of new Set(context.items.map((item) => item.machine_id))) {
      revalidatePath(`${ROUTES.SALES_PLAN}/${machineId}`)
    }

    return { success: true, data: { precutRows: precutRows.length, futureScrapRows: insertedScrapRows } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Не удалось зафиксировать future-fill результат' }
  }
}
