'use server'

import { solveLongStockCutting, type LongStockCuttingCandidate } from '@/lib/long-stock-cutting-solver'
import {
  normalizeLongStockPlanSegments,
  serializeLongStockCandidates,
  solverModeForPlan,
  validateManualLongStockLayout,
  type LongStockManualBarInput,
  type LongStockPlanCalculationInput,
  type LongStockRequestItemRef,
} from '@/lib/long-stock-cutting-plan'
import {
  calculateLongStockWeightPerMeterKg,
  type LongStockWeightVariant,
} from '@/lib/long-stock-material-weight'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
  solverResult: ReturnType<typeof solveLongStockCutting>
}

export async function calculateLongStockCuttingPlan(input: LongStockPlanCalculationInput) {
  await requirePermission('technologist_requests', 'view')
  const context = await calculateContext(input)
  return calculationResult(context)
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
  const eligiblePurchaseLengths = context.mode === 'standard'
    ? context.purchaseLengths.filter((length) => length.kind === 'standard')
    : context.purchaseLengths
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
  const { data, error } = await database().rpc<Record<string, unknown>>(
    'fn_approve_long_stock_cutting_plan_version_v1',
    { p_version_id: normalizedVersionId, p_actor: userId },
  )
  if (error) throw new Error(error.message || 'Не удалось утвердить версию карты раскроя')
  return data
}

async function calculateContext(input: LongStockPlanCalculationInput): Promise<CalculationContext> {
  const requestItem = normalizeRequestItemRef(input.requestItem)
  const workpieces = normalizeLongStockPlanSegments(input.segments)
  const mode = input.mode ?? 'standard'
  const searchBudget = input.searchBudget ?? 50_000
  if (!Number.isSafeInteger(searchBudget) || searchBudget <= 0) {
    throw new Error('Бюджет поиска должен быть положительным целым числом')
  }

  const db = database()
  const item = await loadRequestItem(db, requestItem)
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
  const purchaseLengths = [
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
    candidates: context.solverResult.candidates,
    recommendedCandidateKey: context.solverResult.recommendedCandidateKey,
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
