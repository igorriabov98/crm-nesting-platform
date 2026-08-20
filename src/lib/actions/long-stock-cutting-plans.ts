'use server'

import {
  DEFAULT_LONG_STOCK_SEARCH_BUDGET,
  solveLongStockCutting,
  type LongStockCuttingCandidate,
} from '@/lib/long-stock-cutting-solver'
import {
  createLongStockMaterialDraft,
  longStockDraftDemandPatch,
  longStockMaterialCharacteristics,
  validateLongStockMaterialDraft,
  type LongStockMaterialCategory,
  type LongStockNewMaterialDraft,
} from '@/lib/long-stock-material-draft'
import {
  normalizeLongStockPlanSegments,
  serializeLongStockCandidates,
  solverModeForPlan,
  validateManualLongStockLayout,
  type LongStockManualBarInput,
  type LongStockPlanCalculationInput,
  type LongStockPlanSegmentInput,
  type LongStockRequestItemRef,
} from '@/lib/long-stock-cutting-plan'
import {
  calculateLongStockWeightPerMeterKg,
  type LongStockWeightVariant,
} from '@/lib/long-stock-material-weight'
import { createMaterial, recordMaterialUsage } from '@/lib/actions/materials'
import {
  addCircle,
  addKnife,
  addPipe,
  updateCircle,
  updateKnife,
  updatePipe,
} from '@/lib/actions/technologist-requests'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  prepareLongStockCuttingPlanPdf,
  removePreparedLongStockCuttingPlanPdf,
} from '@/lib/long-stock-cutting-plan-pdf-server'

type DbError = { message: string }
type DbResult<T> = { data: T | null; error: DbError | null }
type DbQuery<T> = PromiseLike<DbResult<T[]>> & {
  select(columns: string): DbQuery<T>
  eq(column: string, value: unknown): DbQuery<T>
  is(column: string, value: null): DbQuery<T>
  gt(column: string, value: number): DbQuery<T>
  order(column: string, options?: { ascending?: boolean }): DbQuery<T>
  maybeSingle(): Promise<DbResult<T>>
  single(): Promise<DbResult<T>>
}
type LongStockDb = {
  from<T>(table: string): DbQuery<T>
  rpc<T>(name: string, args?: Record<string, unknown>): Promise<DbResult<T>>
}

type RequestItemRow = {
  id: string
  request_id: string
  material_id: string | null
  material_variant_id: string | null
  steel_grade?: string | null
  steel_type_id: string | null
  pipe_type: string | null
}

type MaterialVariantRow = LongStockWeightVariant & {
  id: string
  material_id: string
  material_grade: string | null
  knife_material: string | null
  steel_type_id: string | null
  knife_bevel_count: number | null
  standard_length_mm: number | null
  is_calibrated: boolean | null
}

type MaterialRow = {
  id: string
  name: string
  category: string
  comment: string | null
}

type SteelTypeRow = {
  id: string
  density_kg_mm3: number
}

type LayoutCategorySnapshot = {
  key: string
  material_category: string
  knife_bevel_count: number | null
  minimum_useful_length_mm: number
  standard_lengths: number[]
  nonstandard_lengths: number[]
}

type LayoutSettingsSnapshot = {
  schema_version: number
  revision: number
  kerf_mm: number
  end_trim_mm: number
  optimization_hint_threshold_percent: number
  categories: LayoutCategorySnapshot[]
}

type InventoryRemnantRow = {
  id: string
  piece_length_mm: number | string | null
  available_quantity: number | string
  available_secondary_quantity: number | string | null
  created_at: string
}

type CalculationContext = {
  requestItem: LongStockRequestItemRef
  requestId: string
  machineId: string
  factoryId: string
  materialId: string
  materialVariantId: string
  gradeKey: string
  weightPerMeterKg: number | null
  layoutCategory: LayoutCategorySnapshot
  settingsSnapshot: LayoutSettingsSnapshot
  mode: NonNullable<LongStockPlanCalculationInput['mode']>
  searchBudget: number
  workpieces: ReturnType<typeof normalizeLongStockPlanSegments>
  businessRemnants: Array<{ id: string; lengthMm: number; createdAt: string }>
  purchaseLengths: Array<{ lengthMm: number; kind: 'standard' | 'nonstandard' }>
  recalculation: LongStockRecalculationState | null
  solverResult: ReturnType<typeof solveLongStockCutting>
}

type LongStockRecalculationState = {
  planId: string
  planItemId: string
  invalidVersionId: string
  invalidVersionNumber: number
  invalidationReason: string
  remainingSegments: LongStockPlanSegmentInput[]
  acceptedLengthsMm: number[]
}

export type LongStockRecalculationDraft = LongStockRecalculationState & {
  requestItem: LongStockRequestItemRef
  materialName: string
  variantDescription: string
}

export type LongStockCuttingPlanItemStatus = 'none' | 'active' | 'requires_recalculation'

type PrepareLongStockRequestItemDraftInput = {
  requestId: string
  requestItem?: LongStockRequestItemRef | null
  table: LongStockRequestItemRef['table']
  materialVariantId: string
  totalLengthMm: number
  pieceCount: number
}

export async function createLongStockMaterialVariant(input: LongStockNewMaterialDraft) {
  await requirePermission('materials', 'manage')
  const category = normalizeLongStockMaterialCategory(input?.category)
  const draft = createLongStockMaterialDraft(String(input?.name ?? ''), category)
  draft.fields = { ...draft.fields, ...(input?.fields ?? {}) }
  const validationError = validateLongStockMaterialDraft(draft)
  if (validationError) throw new Error(validationError)

  const steelTypeId = String(draft.fields.steel_type_id ?? '').trim()
  const steelType = await one<{ id: string; name: string }>(
    database().from<{ id: string; name: string }>('steel_types')
      .select('id,name')
      .eq('id', requireUuid(steelTypeId, 'Тип металла'))
      .maybeSingle(),
    'Тип металла не найден',
  )
  const materialResult = await createMaterial({ name: draft.name, category })
  if (!materialResult.success || !materialResult.data) {
    throw new Error(materialResult.error || 'Не удалось создать материал')
  }
  const variantResult = await recordMaterialUsage({
    material_id: materialResult.data.id,
    category,
    characteristics: longStockMaterialCharacteristics(draft, steelType.name),
  })
  if (!variantResult.success || !variantResult.data) {
    throw new Error(variantResult.error || 'Не удалось создать вариант материала')
  }
  return {
    material: { ...materialResult.data, supplier_name: null },
    variant: variantResult.data,
  }
}

export async function prepareLongStockRequestItemDraft(input: PrepareLongStockRequestItemDraftInput) {
  await requirePermission('technologist_requests', 'manage')
  const requestId = requireUuid(input?.requestId, 'Идентификатор заявки')
  const materialVariantId = requireUuid(input?.materialVariantId, 'Идентификатор варианта материала')
  const totalLengthMm = Number(input?.totalLengthMm)
  const pieceCount = Number(input?.pieceCount)
  if (!Number.isFinite(totalLengthMm) || totalLengthMm <= 0) {
    throw new Error('Суммарная длина отрезков должна быть больше 0 мм')
  }
  if (!Number.isSafeInteger(pieceCount) || pieceCount <= 0) {
    throw new Error('Количество отрезков должно быть положительным целым числом')
  }

  const table = input?.table
  if (table !== 'request_circle' && table !== 'request_pipe' && table !== 'request_knives') {
    throw new Error('Позиция не относится к кругу, трубе или ножам')
  }
  const db = database()
  const variant = await one<MaterialVariantRow>(
    db.from<MaterialVariantRow>('material_variants')
      .select('id,material_id,category,material_grade,knife_material,steel_type_id,pipe_type,knife_bevel_count,weight_per_m_kg,diameter_mm,wall_thickness_mm,piece_description,knife_dimensions,standard_length_mm,width_mm,height_mm,is_calibrated')
      .eq('id', materialVariantId)
      .maybeSingle(),
    'Вариант материала не найден',
  )
  const material = await one<MaterialRow>(
    db.from<MaterialRow>('materials').select('id,name,category,comment').eq('id', variant.material_id).maybeSingle(),
    'Материал варианта не найден',
  )
  validateDraftVariant(table, material, variant)

  if (input.requestItem) {
    const requestItem = normalizeRequestItemRef(input.requestItem)
    if (requestItem.table !== table) throw new Error('Категория черновика позиции не совпадает')
    const current = await loadRequestItem(db, requestItem)
    if (current.request_id !== requestId) throw new Error('Черновик относится к другой заявке')
    if (current.material_variant_id !== materialVariantId) {
      throw new Error('Выбранный вариант изменился — создайте черновик позиции заново')
    }
    const demandPatch = longStockDraftDemandPatch(table, totalLengthMm, pieceCount)
    const result = table === 'request_circle'
      ? await updateCircle(requestItem.id, demandPatch)
      : table === 'request_pipe'
        ? await updatePipe(requestItem.id, demandPatch)
        : await updateKnife(requestItem.id, demandPatch)
    if (!result.success || !result.data) throw new Error(result.error || 'Не удалось обновить черновик позиции')
    return { table, id: requestItem.id, row: result.data, materialVariantId }
  }

  const data = newDraftData(table, material, variant, totalLengthMm, pieceCount)
  const result = table === 'request_circle'
    ? await addCircle(requestId, data)
    : table === 'request_pipe'
      ? await addPipe(requestId, data)
      : await addKnife(requestId, data)
  if (!result.success || !result.data) throw new Error(result.error || 'Не удалось создать черновик позиции')
  return {
    table,
    id: String((result.data as { id: string }).id),
    row: result.data,
    materialVariantId,
  }
}

export async function calculateLongStockCuttingPlan(input: LongStockPlanCalculationInput) {
  await requirePermission('technologist_requests', 'view')
  const context = await calculateContext(input)
  return calculationResult(context)
}

export async function getLongStockCuttingPlanItemStatuses(
  requestItems: LongStockRequestItemRef[],
) {
  await requirePermission('technologist_requests', 'view')
  const db = database()
  const normalized = requestItems.map(normalizeRequestItemRef)
  const entries = await Promise.all(normalized.map(async (requestItem) => {
    const result = await db.from<{ cutting_status: string }>('long_stock_cutting_plan_items')
      .select('cutting_status')
      .eq('request_item_table', requestItem.table)
      .eq('request_item_id', requestItem.id)
      .order('linked_at', { ascending: false })
    if (result.error) throw new Error(result.error.message || 'Не удалось прочитать статус карты раскроя')
    const cuttingStatus = result.data?.[0]?.cutting_status
    const status: LongStockCuttingPlanItemStatus = cuttingStatus === 'requires_recalculation'
      ? 'requires_recalculation'
      : cuttingStatus ? 'active' : 'none'
    return [`${requestItem.table}:${requestItem.id}`, status] as const
  }))
  return Object.fromEntries(entries) as Record<string, LongStockCuttingPlanItemStatus>
}

export async function loadLongStockRecalculationDraft(
  requestItemInput: LongStockRequestItemRef,
): Promise<LongStockRecalculationDraft> {
  await requirePermission('technologist_requests', 'view')
  const requestItem = normalizeRequestItemRef(requestItemInput)
  const db = database()
  const state = await loadLongStockRecalculationState(db, requestItem)
  if (!state) throw new Error('Позиция не требует пересчёта')
  const item = await loadRequestItem(db, requestItem)
  if (!item.material_id || !item.material_variant_id) {
    throw new Error('Для пересчёта не найден точный вариант материала')
  }
  const [material, variant] = await Promise.all([
    one<MaterialRow>(
      db.from<MaterialRow>('materials')
        .select('id,name,category,comment')
        .eq('id', item.material_id)
        .maybeSingle(),
      'Материал позиции не найден',
    ),
    one<MaterialVariantRow>(
      db.from<MaterialVariantRow>('material_variants')
        .select('id,material_id,category,material_grade,knife_material,steel_type_id,pipe_type,knife_bevel_count,weight_per_m_kg,diameter_mm,wall_thickness_mm,piece_description,knife_dimensions,width_mm,height_mm')
        .eq('id', item.material_variant_id)
        .maybeSingle(),
      'Вариант материала позиции не найден',
    ),
  ])
  return {
    ...state,
    requestItem,
    materialName: material.name,
    variantDescription: recalculationVariantDescription(variant),
  }
}

export async function createLongStockCuttingPlanVersion(input: LongStockPlanCalculationInput & {
  selectedCandidateKey: string
}) {
  const { userId } = await requirePermission('technologist_requests', 'manage')
  const context = await calculateContext(input)
  const selectedIndex = context.solverResult.candidates.findIndex(
    (candidate) => candidate.key === input.selectedCandidateKey,
  )
  if (selectedIndex < 0) throw new Error('Выбранный вариант отсутствует в результате расчёта')

  return persistVersion({
    context,
    candidates: context.solverResult.candidates,
    selectedIndex,
    actorId: userId,
    selectedCandidateKey: input.selectedCandidateKey,
    manualEditReason: null,
    manualLayout: null,
  })
}

export async function createManualLongStockCuttingPlanVersion(
  input: LongStockPlanCalculationInput & {
    bars: LongStockManualBarInput[]
    reason: string
  },
) {
  const { userId } = await requirePermission('technologist_requests', 'manage')
  const reason = String(input.reason ?? '').trim()
  if (!reason) throw new Error('Для ручной правки обязательна причина')
  const context = await calculateContext(input)
  const eligiblePurchaseLengths = context.mode === 'with_nonstandard'
    ? context.purchaseLengths
    : context.purchaseLengths.filter((length) => length.kind === 'standard')
  const manualCandidate = validateManualLongStockLayout({
    workpieces: context.workpieces,
    businessRemnants: context.businessRemnants,
    purchaseLengths: eligiblePurchaseLengths,
    bars: input.bars,
    kerfMm: context.settingsSnapshot.kerf_mm,
    endTrimMm: context.settingsSnapshot.end_trim_mm,
  })

  return persistVersion({
    context,
    candidates: [manualCandidate],
    selectedIndex: 0,
    actorId: userId,
    selectedCandidateKey: manualCandidate.key,
    manualEditReason: reason,
    manualLayout: input.bars,
  })
}

export async function recalculateLongStockCuttingPlanVersion(input: LongStockPlanCalculationInput & {
  selectedCandidateKey: string
}) {
  const { userId } = await requirePermission('technologist_requests', 'manage')
  const context = await calculateContext(input)
  const selectedIndex = context.solverResult.candidates.findIndex(
    (candidate) => candidate.key === input.selectedCandidateKey,
  )
  if (selectedIndex < 0) throw new Error('Выбранный вариант отсутствует в результате пересчёта')

  return persistVersion({
    context,
    candidates: context.solverResult.candidates,
    selectedIndex,
    actorId: userId,
    selectedCandidateKey: input.selectedCandidateKey,
    manualEditReason: null,
    manualLayout: null,
  })
}

export async function approveLongStockCuttingPlanVersion(versionId: string) {
  const { userId } = await requirePermission('technologist_requests', 'manage')
  const normalizedVersionId = requireUuid(versionId, 'Идентификатор версии')
  const preparedPdf = await prepareLongStockCuttingPlanPdf(normalizedVersionId, userId)
  if (preparedPdf.kind === 'stored') {
    return {
      version_id: normalizedVersionId,
      status: 'approved',
      pdf_metadata: preparedPdf.metadata,
    }
  }
  try {
    const { data, error } = await database().rpc<Record<string, unknown>>(
      'fn_approve_long_stock_cutting_plan_version_v2',
      {
        p_version_id: normalizedVersionId,
        p_actor: userId,
        p_pdf_metadata: preparedPdf.metadata,
      },
    )
    if (error) throw new Error(error.message || 'Не удалось утвердить версию карты раскроя')
    return data
  } catch (error) {
    await removePreparedLongStockCuttingPlanPdf(preparedPdf.metadata)
    throw error
  }
}

async function calculateContext(input: LongStockPlanCalculationInput): Promise<CalculationContext> {
  const requestItem = normalizeRequestItemRef(input.requestItem)
  const workpieces = normalizeLongStockPlanSegments(input.segments)
  const mode = input.mode ?? 'standard'
  const searchBudget = input.searchBudget ?? DEFAULT_LONG_STOCK_SEARCH_BUDGET
  if (!Number.isSafeInteger(searchBudget) || searchBudget <= 0) {
    throw new Error('Бюджет поиска должен быть положительным целым числом')
  }

  const db = database()
  const item = await loadRequestItem(db, requestItem)
  const recalculation = await loadLongStockRecalculationState(db, requestItem)
  if (recalculation) {
    assertRecalculationSegments(workpieces, recalculation.remainingSegments)
  }
  if (!item.material_variant_id) {
    throw new Error('Для расчёта раскроя обязателен точный material_variant_id')
  }
  if (!item.material_id) throw new Error('Для позиции заявки не выбран материал')
  if (requestItem.table === 'request_pipe' && item.pipe_type === 'wire') {
    throw new Error('Проволока не участвует в раскрое длинномера')
  }

  const variant = await one<MaterialVariantRow>(
    db.from<MaterialVariantRow>('material_variants')
      .select('id,material_id,category,material_grade,knife_material,steel_type_id,pipe_type,knife_bevel_count,weight_per_m_kg,diameter_mm,wall_thickness_mm,piece_description,knife_dimensions,width_mm,height_mm')
      .eq('id', item.material_variant_id)
      .maybeSingle(),
    'Вариант материала не найден',
  )
  validateItemIdentity(requestItem, item, variant)

  let densityKgMm3: number | null = null
  if (!(Number(variant.weight_per_m_kg) > 0) && variant.steel_type_id) {
    const steelTypeResult = await db.from<SteelTypeRow>('steel_types')
      .select('id,density_kg_mm3')
      .eq('id', variant.steel_type_id)
      .maybeSingle()
    if (steelTypeResult.error) {
      throw new Error(steelTypeResult.error.message || 'Не удалось прочитать плотность марки стали')
    }
    densityKgMm3 = steelTypeResult.data?.density_kg_mm3 ?? null
  }
  const weightPerMeterKg = calculateLongStockWeightPerMeterKg(variant, densityKgMm3)

  const request = await one<{ id: string; machine_id: string }>(
    db.from<{ id: string; machine_id: string }>('technologist_requests')
      .select('id,machine_id')
      .eq('id', item.request_id)
      .maybeSingle(),
    'Заявка технолога не найдена',
  )
  const machine = await one<{ id: string; factory_id: string | null }>(
    db.from<{ id: string; factory_id: string | null }>('machines')
      .select('id,factory_id')
      .eq('id', request.machine_id)
      .maybeSingle(),
    'Машина позиции заявки не найдена',
  )
  if (!machine.factory_id) throw new Error('Для машины не определён завод')

  const settingsResult = await db.rpc<LayoutSettingsSnapshot>('fn_get_long_stock_layout_settings_snapshot')
  if (settingsResult.error || !settingsResult.data) {
    throw new Error(settingsResult.error?.message || 'Настройки раскладки хлыстов не найдены')
  }
  const settingsSnapshot = normalizeSettingsSnapshot(settingsResult.data)
  const categoryKey = layoutCategoryKey(variant)
  const layoutCategory = settingsSnapshot.categories.find((category) => category.key === categoryKey)
  if (!layoutCategory) throw new Error(`Настройки категории ${categoryKey} не найдены`)

  const remnantsResult = await db.from<InventoryRemnantRow>('inventory')
    .select('id,piece_length_mm,available_quantity,available_secondary_quantity,created_at')
    .eq('material_id', item.material_id)
    .eq('material_variant_id', item.material_variant_id)
    .eq('is_business_scrap', true)
    .eq('business_scrap_state', 'available')
    .is('deleted_at', null)
    .gt('available_quantity', 0)
    .order('created_at', { ascending: true })
  if (remnantsResult.error) {
    throw new Error(remnantsResult.error.message || 'Не удалось прочитать деловые остатки')
  }
  const businessRemnants = (remnantsResult.data ?? []).flatMap((row) => {
    const lengthMm = Number(row.piece_length_mm)
    const availableQuantity = Number(row.available_quantity)
    const availablePieces = Number(row.available_secondary_quantity)
    return Number.isFinite(lengthMm) && lengthMm > 0
      && availableQuantity >= lengthMm
      && Number.isFinite(availablePieces) && availablePieces >= 1
      ? [{ id: row.id, lengthMm, createdAt: row.created_at }]
      : []
  })
  const purchaseLengths = recalculation
    ? recalculation.acceptedLengthsMm.map((lengthMm) => ({
        lengthMm,
        kind: 'standard' as const,
      }))
    : [
        ...layoutCategory.standard_lengths.map((lengthMm) => ({
          lengthMm,
          kind: 'standard' as const,
        })),
        ...layoutCategory.nonstandard_lengths.map((lengthMm) => ({
          lengthMm,
          kind: 'nonstandard' as const,
        })),
      ]
  const solverMode = solverModeForPlan(mode)
  const solverResult = solveLongStockCutting({
    workpieces,
    businessRemnants,
    purchaseLengths,
    kerfMm: settingsSnapshot.kerf_mm,
    endTrimMm: settingsSnapshot.end_trim_mm,
    mode: solverMode.mode,
    allowMixedLengths: solverMode.allowMixedLengths,
    searchBudget,
  })

  return {
    requestItem,
    requestId: request.id,
    machineId: machine.id,
    factoryId: machine.factory_id,
    materialId: item.material_id,
    materialVariantId: item.material_variant_id,
    gradeKey: gradeKey(item, variant),
    weightPerMeterKg,
    layoutCategory,
    settingsSnapshot,
    mode,
    searchBudget,
    workpieces,
    businessRemnants,
    purchaseLengths,
    recalculation,
    solverResult,
  }
}

async function persistVersion(input: {
  context: CalculationContext
  candidates: LongStockCuttingCandidate[]
  selectedIndex: number
  actorId: string
  selectedCandidateKey: string
  manualEditReason: string | null
  manualLayout: LongStockManualBarInput[] | null
}) {
  const db = database()
  const requestItems = [{
    request_item_table: input.context.requestItem.table,
    request_item_id: input.context.requestItem.id,
  }]
  const planResult = await db.rpc<string>('fn_create_long_stock_cutting_plan', {
    p_material_variant_id: input.context.materialVariantId,
    p_request_items: requestItems,
    p_created_by: input.actorId,
  })
  if (planResult.error || !planResult.data) {
    throw new Error(planResult.error?.message || 'Не удалось создать карту раскроя')
  }

  const planItem = await one<{ id: string }>(
    db.from<{ id: string }>('long_stock_cutting_plan_items')
      .select('id')
      .eq('plan_id', planResult.data)
      .eq('request_item_table', input.context.requestItem.table)
      .eq('request_item_id', input.context.requestItem.id)
      .maybeSingle(),
    'Позиция не связана с картой раскроя',
  )
  const weightPerMm = Math.max(Number(input.context.weightPerMeterKg) || 0, 0) / 1000
  const segments = input.context.workpieces.map((workpiece, index) => ({
    plan_item_id: planItem.id,
    segment_number: index + 1,
    required_length_mm: workpiece.lengthMm,
    required_weight_kg: workpiece.lengthMm * weightPerMm,
  }))
  const candidates = serializeLongStockCandidates({
    candidates: input.candidates,
    workpieces: input.context.workpieces,
    weightPerMeterKg: input.context.weightPerMeterKg,
  })
  const inputSnapshot = {
    schema_version: 1,
    solver_contract_version: 1,
    request_item: input.context.requestItem,
    request_id: input.context.requestId,
    machine_id: input.context.machineId,
    factory_id: input.context.factoryId,
    material_id: input.context.materialId,
    material_variant_id: input.context.materialVariantId,
    grade_key: input.context.gradeKey,
    mode: input.context.mode,
    search_budget: input.context.searchBudget,
    segments: input.context.workpieces,
    available_business_remnants: input.context.businessRemnants,
    selected_candidate_key: input.selectedCandidateKey,
    manual_edit_reason: input.manualEditReason,
    manual_layout: input.manualLayout,
    recalculation: input.context.recalculation ? {
      source_version_id: input.context.recalculation.invalidVersionId,
      source_version_number: input.context.recalculation.invalidVersionNumber,
      accepted_lengths_mm: input.context.recalculation.acceptedLengthsMm,
    } : null,
  }
  const versionResult = await db.rpc<string>('fn_get_or_create_long_stock_cutting_plan_version_v2', {
    p_plan_id: planResult.data,
    p_input_snapshot: inputSnapshot,
    p_settings_snapshot: input.context.settingsSnapshot,
    p_segments: segments,
    p_candidates: candidates,
    p_selected_candidate_number: input.selectedIndex + 1,
    p_created_by: input.actorId,
    p_manual_edit_reason: input.manualEditReason,
    p_pdf_metadata: {},
  })
  if (versionResult.error || !versionResult.data) {
    throw new Error(versionResult.error?.message || 'Не удалось сохранить версию карты раскроя')
  }

  const version = await one<{ id: string; plan_id: string; version_number: number; status: string }>(
    db.from<{ id: string; plan_id: string; version_number: number; status: string }>('long_stock_cutting_plan_versions')
      .select('id,plan_id,version_number,status')
      .eq('id', versionResult.data)
      .maybeSingle(),
    'Сохранённая версия карты раскроя не найдена',
  )
  return version
}

function calculationResult(context: CalculationContext) {
  return {
    requestItem: context.requestItem,
    requestId: context.requestId,
    machineId: context.machineId,
    factoryId: context.factoryId,
    materialId: context.materialId,
    materialVariantId: context.materialVariantId,
    gradeKey: context.gradeKey,
    weightPerMeterKg: context.weightPerMeterKg,
    settingsSnapshot: context.settingsSnapshot,
    layoutCategoryKey: context.layoutCategory.key,
    searchBudget: context.searchBudget,
    candidates: context.solverResult.candidates,
    recommendedCandidateKey: context.solverResult.recommendedCandidateKey,
    recalculation: context.recalculation ? {
      sourceVersionId: context.recalculation.invalidVersionId,
      sourceVersionNumber: context.recalculation.invalidVersionNumber,
      acceptedLengthsMm: context.recalculation.acceptedLengthsMm,
    } : null,
  }
}

async function loadLongStockRecalculationState(
  db: LongStockDb,
  requestItem: LongStockRequestItemRef,
): Promise<LongStockRecalculationState | null> {
  const itemResult = await db.from<{
    id: string
    plan_id: string
    cutting_status: string
  }>('long_stock_cutting_plan_items')
    .select('id,plan_id,cutting_status')
    .eq('request_item_table', requestItem.table)
    .eq('request_item_id', requestItem.id)
    .order('linked_at', { ascending: false })
  if (itemResult.error) throw new Error(itemResult.error.message || 'Не удалось прочитать карту раскроя')
  const planItem = itemResult.data?.[0]
  if (!planItem || planItem.cutting_status !== 'requires_recalculation') return null

  const versionResult = await db.from<{
    id: string
    version_number: number
    selected_candidate_number: number
    invalidation_reason: string | null
  }>('long_stock_cutting_plan_versions')
    .select('id,version_number,selected_candidate_number,invalidation_reason')
    .eq('plan_id', planItem.plan_id)
    .eq('status', 'invalid')
    .order('invalidated_at', { ascending: false })
  if (versionResult.error) throw new Error(versionResult.error.message || 'Не удалось прочитать недействительную версию')
  const invalidVersion = versionResult.data?.[0]
  if (!invalidVersion) throw new Error('Недействительная версия карты раскроя не найдена')

  const candidate = await one<{ id: string }>(
    db.from<{ id: string }>('long_stock_cutting_candidates')
      .select('id')
      .eq('version_id', invalidVersion.id)
      .eq('candidate_number', invalidVersion.selected_candidate_number)
      .maybeSingle(),
    'Утверждённый вариант недействительной версии не найден',
  )
  const [segmentsResult, barsResult, cutsResult, schedulesResult, transfersResult] = await Promise.all([
    db.from<{ segment_number: number; required_length_mm: number | string }>('long_stock_cutting_segments')
      .select('segment_number,required_length_mm')
      .eq('version_id', invalidVersion.id)
      .order('segment_number', { ascending: true }),
    db.from<{ id: string; status: string }>('long_stock_cutting_candidate_bars')
      .select('id,status')
      .eq('candidate_id', candidate.id),
    db.from<{ bar_id: string; segment_id: string }>('long_stock_cutting_bar_cuts')
      .select('bar_id,segment_id')
      .eq('candidate_id', candidate.id),
    db.from<{
      status: string
      receipt_parent_schedule_id: string | null
      received_piece_length_mm: number | string | null
      received_piece_count: number | string | null
    }>('supply_order_delivery_schedules')
      .select('status,receipt_parent_schedule_id,received_piece_length_mm,received_piece_count')
      .eq('request_item_table', requestItem.table)
      .eq('request_item_id', requestItem.id),
    db.from<{
      piece_length_mm: number | string | null
      received_quantity: number | string
      received_secondary_quantity: number | string | null
    }>('inventory_transfer_items')
      .select('piece_length_mm,received_quantity,received_secondary_quantity')
      .eq('request_item_table', requestItem.table)
      .eq('request_item_id', requestItem.id),
  ])
  for (const result of [segmentsResult, barsResult, cutsResult, schedulesResult, transfersResult]) {
    if (result.error) throw new Error(result.error.message || 'Не удалось подготовить данные пересчёта')
  }

  const cutBarIds = new Set((barsResult.data ?? [])
    .filter((bar) => bar.status === 'cut')
    .map((bar) => bar.id))
  const cutSegmentIds = new Set((cutsResult.data ?? [])
    .filter((cut) => cutBarIds.has(cut.bar_id))
    .map((cut) => cut.segment_id))
  const segmentIdsResult = await db.from<{ id: string; segment_number: number; required_length_mm: number | string }>('long_stock_cutting_segments')
    .select('id,segment_number,required_length_mm')
    .eq('version_id', invalidVersion.id)
    .order('segment_number', { ascending: true })
  if (segmentIdsResult.error) throw new Error(segmentIdsResult.error.message || 'Не удалось прочитать заготовки пересчёта')
  const remainingSegments = (segmentIdsResult.data ?? [])
    .filter((segment) => !cutSegmentIds.has(segment.id))
    .map((segment) => ({
      id: `recalculation-segment-${segment.segment_number}`,
      lengthMm: Number(segment.required_length_mm),
    }))
  if (remainingSegments.length === 0) {
    throw new Error('Все хлысты версии уже порезаны; пересчёт не требуется')
  }

  const acceptedLengths = [
    ...(schedulesResult.data ?? []).flatMap((schedule) => {
      const lengthMm = Number(schedule.received_piece_length_mm)
      const pieceCount = Number(schedule.received_piece_count)
      return schedule.status === 'delivered'
        && schedule.receipt_parent_schedule_id === null
        && Number.isSafeInteger(lengthMm) && lengthMm > 0
        && pieceCount > 0
        ? [lengthMm]
        : []
    }),
    ...(transfersResult.data ?? []).flatMap((transfer) => {
      const lengthMm = Number(transfer.piece_length_mm)
      const receivedQuantity = Number(transfer.received_quantity)
      const receivedPieces = transfer.received_secondary_quantity === null
        ? receivedQuantity / lengthMm
        : Number(transfer.received_secondary_quantity)
      return Number.isSafeInteger(lengthMm) && lengthMm > 0 && receivedPieces > 0
        ? [lengthMm]
        : []
    }),
  ]
  const acceptedLengthsMm = [...new Set(acceptedLengths)].sort((left, right) => left - right)
  if (acceptedLengthsMm.length === 0) {
    throw new Error('Для пересчёта не найдены фактически принятые длины хлыстов')
  }

  return {
    planId: planItem.plan_id,
    planItemId: planItem.id,
    invalidVersionId: invalidVersion.id,
    invalidVersionNumber: invalidVersion.version_number,
    invalidationReason: invalidVersion.invalidation_reason || 'Фактическая поставка отличается от карты',
    remainingSegments,
    acceptedLengthsMm,
  }
}

function assertRecalculationSegments(
  actual: Array<{ id: string; lengthMm: number }>,
  expected: LongStockPlanSegmentInput[],
) {
  const actualSignature = actual.map((segment) => `${segment.id}:${segment.lengthMm}`).sort().join('|')
  const expectedSignature = expected.map((segment) => `${segment.id}:${segment.lengthMm}`).sort().join('|')
  if (actualSignature !== expectedSignature) {
    throw new Error('Состав непорезанных заготовок изменился. Обновите пересчёт')
  }
}

function recalculationVariantDescription(variant: MaterialVariantRow) {
  const grade = variant.material_grade ?? variant.knife_material
  if (variant.category === 'circle') {
    return [grade, variant.diameter_mm ? `Ø ${variant.diameter_mm} мм` : null]
      .filter(Boolean).join(' · ')
  }
  if (variant.category === 'pipe') {
    return [grade, variant.piece_description, variant.wall_thickness_mm ? `стенка ${variant.wall_thickness_mm} мм` : null]
      .filter(Boolean).join(' · ')
  }
  return [grade, variant.knife_dimensions, variant.knife_bevel_count ? `скос ${variant.knife_bevel_count}` : null]
    .filter(Boolean).join(' · ')
}

function normalizeLongStockMaterialCategory(value: unknown): LongStockMaterialCategory {
  if (value === 'circle' || value === 'pipe' || value === 'knives') return value
  throw new Error('Материал не относится к кругу, трубе или ножам')
}

function validateDraftVariant(
  table: LongStockRequestItemRef['table'],
  material: MaterialRow,
  variant: MaterialVariantRow,
) {
  const expectedCategory = table === 'request_circle'
    ? 'circle'
    : table === 'request_pipe' ? 'pipe' : 'knives'
  if (material.id !== variant.material_id || material.category !== variant.category) {
    throw new Error('Вариант материала не относится к выбранному материалу')
  }
  if (variant.category !== expectedCategory) {
    throw new Error('Категория варианта не соответствует позиции заявки')
  }
  if (table === 'request_pipe' && variant.pipe_type === 'wire') {
    throw new Error('Проволока остаётся в прежнем интерфейсе')
  }
}

function newDraftData(
  table: LongStockRequestItemRef['table'],
  material: MaterialRow,
  variant: MaterialVariantRow,
  totalLengthMm: number,
  pieceCount: number,
) {
  const common = {
    material_id: material.id,
    material_variant_id: variant.id,
    is_custom_material_variant: false,
  }
  if (table === 'request_circle') {
    return {
      ...common,
      diameter_mm: variant.diameter_mm,
      steel_grade: variant.material_grade ?? material.comment,
      steel_type_id: variant.steel_type_id,
      is_calibrated: variant.is_calibrated ?? false,
      remainder_mm: totalLengthMm,
    }
  }
  if (table === 'request_pipe') {
    return {
      ...common,
      pipe_type: variant.pipe_type,
      steel_type_id: variant.steel_type_id,
      size: variant.piece_description,
      wall_thickness_mm: variant.wall_thickness_mm,
      diameter_mm: variant.diameter_mm,
      remainder_length_mm: totalLengthMm,
      remainder_qty: pieceCount,
      remainder_kg: 0,
    }
  }
  const dimensions = knifeVariantDimensions(variant)
  return {
    ...common,
    knife_type: material.name,
    steel_grade: variant.material_grade ?? variant.knife_material,
    steel_type_id: variant.steel_type_id,
    length_mm: dimensions.lengthMm,
    width_mm: dimensions.widthMm,
    height_mm: dimensions.heightMm,
    knife_bevel_count: variant.knife_bevel_count,
    remainder_meters: totalLengthMm / 1000,
    remainder_qty: pieceCount,
  }
}

function knifeVariantDimensions(variant: MaterialVariantRow) {
  const parsed = String(variant.knife_dimensions ?? '')
    .trim()
    .toLowerCase()
    .replace(/[х×*]/g, 'x')
    .split('x')
    .map((part) => Number(part.trim().replace(',', '.')))
  return {
    lengthMm: variant.standard_length_mm ?? (Number.isFinite(parsed[0]) ? parsed[0] : null),
    widthMm: variant.width_mm ?? (Number.isFinite(parsed[1]) ? parsed[1] : null),
    heightMm: variant.height_mm ?? (Number.isFinite(parsed[2]) ? parsed[2] : null),
  }
}

function database() {
  return createAdminClient() as unknown as LongStockDb
}

async function loadRequestItem(db: LongStockDb, ref: LongStockRequestItemRef) {
  const columns = ref.table === 'request_pipe'
    ? 'id,request_id,material_id,material_variant_id,steel_type_id,pipe_type'
    : 'id,request_id,material_id,material_variant_id,steel_grade,steel_type_id'
  return one<RequestItemRow>(
    db.from<RequestItemRow>(ref.table).select(columns).eq('id', ref.id).maybeSingle(),
    'Позиция заявки не найдена',
  )
}

function validateItemIdentity(
  ref: LongStockRequestItemRef,
  item: RequestItemRow,
  variant: MaterialVariantRow,
) {
  if (variant.material_id !== item.material_id) {
    throw new Error('Вариант материала не относится к материалу позиции')
  }
  const expectedCategory = ref.table === 'request_circle'
    ? 'circle'
    : ref.table === 'request_pipe' ? 'pipe' : 'knives'
  if (variant.category !== expectedCategory) {
    throw new Error('Категория варианта не соответствует позиции заявки')
  }
  if (ref.table === 'request_pipe' && variant.pipe_type === 'wire') {
    throw new Error('Проволока не участвует в раскрое длинномера')
  }
  if (item.steel_type_id && variant.steel_type_id
    && item.steel_type_id !== variant.steel_type_id) {
    throw new Error('Марка стали позиции не соответствует точному варианту материала')
  }
  const itemGrade = normalizedGrade(item.steel_grade)
  const variantGrade = normalizedGrade(variant.material_grade ?? variant.knife_material)
  if (itemGrade && variantGrade && itemGrade !== variantGrade) {
    throw new Error('Марка материала позиции не соответствует точному варианту')
  }
}

function layoutCategoryKey(variant: MaterialVariantRow) {
  if (variant.category === 'circle') return 'circle'
  if (variant.category === 'pipe' && variant.pipe_type !== 'wire') return 'pipe'
  if (variant.category === 'knives' && variant.knife_bevel_count === 1) return 'knife_bevel_1'
  if (variant.category === 'knives' && variant.knife_bevel_count === 2) return 'knife_bevel_2'
  throw new Error('Вариант материала не относится к раскрою длинномера')
}

function gradeKey(item: RequestItemRow, variant: MaterialVariantRow) {
  return item.steel_type_id
    ?? variant.steel_type_id
    ?? normalizedGrade(item.steel_grade)
    ?? normalizedGrade(variant.material_grade ?? variant.knife_material)
    ?? 'without_grade'
}

function normalizedGrade(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, '')
  return normalized || null
}

function normalizeSettingsSnapshot(value: LayoutSettingsSnapshot): LayoutSettingsSnapshot {
  const kerf = Number(value.kerf_mm)
  const endTrim = Number(value.end_trim_mm)
  const threshold = Number(value.optimization_hint_threshold_percent)
  if (!Number.isFinite(kerf) || kerf < 0 || !Number.isFinite(endTrim) || endTrim < 0
    || !Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    throw new Error('Настройки пропила или торцовки повреждены')
  }
  if (!Array.isArray(value.categories)) throw new Error('Категории раскладки хлыстов не найдены')
  return {
    ...value,
    kerf_mm: kerf,
    end_trim_mm: endTrim,
    optimization_hint_threshold_percent: threshold,
    categories: value.categories.map((category) => ({
      ...category,
      minimum_useful_length_mm: Number(category.minimum_useful_length_mm),
      standard_lengths: category.standard_lengths.map(Number),
      nonstandard_lengths: category.nonstandard_lengths.map(Number),
    })),
  }
}

function normalizeRequestItemRef(value: LongStockRequestItemRef) {
  const table = value?.table
  if (!['request_circle', 'request_pipe', 'request_knives'].includes(table)) {
    throw new Error('Позиция не относится к кругу, трубе или ножам')
  }
  return { table, id: requireUuid(value.id, 'Идентификатор позиции') } as LongStockRequestItemRef
}

function requireUuid(value: string, label: string) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${label} должен быть UUID`)
  }
  return normalized
}

async function one<T>(resultPromise: Promise<DbResult<T>>, notFoundMessage: string) {
  const result = await resultPromise
  if (result.error) throw new Error(result.error.message || notFoundMessage)
  if (!result.data) throw new Error(notFoundMessage)
  return result.data
}
