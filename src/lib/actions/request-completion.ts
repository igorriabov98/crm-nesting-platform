'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase generated types are updated only after this migration is applied. */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { completeStockReservation } from '@/lib/actions/technologist-requests'
import { resolveCompletionWorkspaceNavigation } from '@/lib/request-completion-navigation'
import type { RequestStatus } from '@/lib/types'
import {
  MACHINE_CUTTING_BUCKET,
  validateMachineCuttingRegistration,
  type DirectMachineCuttingUpload,
} from '@/lib/machine-cutting/files'
import { isLongStockPlanReadyForSupply } from '@/lib/request-completion-material-scope'
import { roundPipeOuterDiameterMm } from '@/lib/materials/pipe-profile'
import { formatMetalScrapMaterialName } from '@/lib/metal-scrap'
import type { CompletionFutureBusinessScrap } from '@/lib/request-completion-future-scrap'

const stagedArchiveSchema = z.object({
  requestId: z.string().uuid(),
  completionId: z.string().uuid().nullable(),
  objectPath: z.string().min(1).max(700),
  fileName: z.string().min(1).max(240),
  mimeType: z.string().max(160).nullable(),
  fileSize: z.number().int().positive(),
})

const wasteSchema = z.object({
  sourceTable: z.enum(['request_sheet_metal', 'request_pipe', 'request_circle', 'request_knives']),
  sourceId: z.string().uuid(),
  itemName: z.string().trim().min(1),
  materialId: z.string().uuid().nullable().optional(),
  materialVariantId: z.string().uuid().nullable().optional(),
  materialName: z.string().trim().min(1),
  materialGrade: z.string().trim().nullable().optional(),
  wastePercent: z.coerce.number().min(0).max(100).refine((value) => Math.round(value * 10) === value * 10, 'Точность — до 0,1%'),
})

const compatibilitySchema = z.object({
  productId: z.string().uuid(),
  allVersions: z.boolean(),
  versionIds: z.array(z.string().uuid()).default([]),
}).refine((value) => value.allVersions || value.versionIds.length > 0, 'Выберите версию изделия')

const futureItemSchema = z.object({
  partId: z.string().uuid().nullable().optional(),
  quantity: z.coerce.number().int().positive(),
  name: z.string().trim().optional(),
  drawingNumber: z.string().trim().optional(),
  unitWeightKg: z.coerce.number().positive().optional(),
  compatibilities: z.array(compatibilitySchema).default([]),
}).superRefine((value, ctx) => {
  if (!value.partId && (!value.name || !value.drawingNumber || !value.unitWeightKg || value.compatibilities.length === 0)) {
    ctx.addIssue({ code: 'custom', message: 'Заполните карточку новой детали и совместимость' })
  }
})

const finalizeSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(['has_items', 'none']),
  hours: z.coerce.number().int().min(0).max(999),
  minutes: z.coerce.number().int().min(0).max(59),
  wasteItems: z.array(wasteSchema),
  futureItems: z.array(futureItemSchema),
  archives: z.array(stagedArchiveSchema).max(20).default([]),
}).refine((value) => value.decision === 'none' ? value.futureItems.length === 0 : value.futureItems.length > 0, 'Добавьте деталировку или выберите «нет»')

type RawWasteRow = Record<string, unknown>
type RawPlanFactRow = Record<string, unknown>

export type CompletionPlanSummary = {
  planId: string
  versionId: string | null
  planStatus: string
  plannedBarCount: number
  readyForSupply: boolean
  futureBusinessScraps: CompletionFutureBusinessScrap[]
}

export type CompletionWasteItem = {
  sourceTable: z.infer<typeof wasteSchema>['sourceTable']
  sourceId: string
  itemName: string
  materialId: string | null
  materialVariantId: string | null
  materialName: string
  materialGrade: string | null
  quantityLabel: string
  weightKg: number | null
  accountingMode: 'manual_percent' | 'approved_plan'
  planSummary: CompletionPlanSummary | null
}

export type CompletionWorkspace = {
  requestId: string
  machineId: string
  machineName: string
  factoryId: string
  factoryName: string
  wasteItems: CompletionWasteItem[]
}

function db() { return createAdminClient() as any }
function num(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }

function planFactKey(sourceTable: string, sourceId: string) {
  return `${sourceTable}:${sourceId}`
}

function mapPlanSummary(
  row: RawPlanFactRow,
  futureBusinessScraps: CompletionFutureBusinessScrap[] = [],
): CompletionPlanSummary {
  const planStatus = String(row.plan_status || '')
  const plannedBarCount = Number(row.planned_bar_count || 0)
  const versionId = row.version_id ? String(row.version_id) : null
  return {
    planId: String(row.plan_id),
    versionId,
    planStatus,
    plannedBarCount,
    readyForSupply: isLongStockPlanReadyForSupply({ versionId, planStatus, plannedBarCount }),
    futureBusinessScraps,
  }
}

function mapWaste(sourceTable: CompletionWasteItem['sourceTable'], row: RawWasteRow): CompletionWasteItem {
  const fallbackName = sourceTable === 'request_circle' ? `Круг Ø${row.diameter_mm || '—'} мм` : 'Металл'
  const materialName = formatMetalScrapMaterialName(String(row.material_name || row.pipe_type || row.knife_type || fallbackName))
  const grade = row.material_grade || row.steel_grade || null
  const pipeProfile = sourceTable === 'request_pipe' && row.pipe_type === 'round'
    ? `Ø${roundPipeOuterDiameterMm(row) ?? '—'} мм`
    : row.size
  const quantity = sourceTable === 'request_sheet_metal'
    ? `${row.quantity_sheets || 0} лист.`
    : sourceTable === 'request_circle'
      ? `${row.remainder_mm || 0} мм`
      : sourceTable === 'request_pipe'
        ? `${row.remainder_qty || 0} шт.`
        : `${row.remainder_qty || row.quantity || 0} шт.`
  return {
    sourceTable,
    sourceId: String(row.id),
    itemName: [materialName, grade, row.sheet_size || pipeProfile].filter(Boolean).join(' · '),
    materialId: row.material_id ? String(row.material_id) : null,
    materialVariantId: row.material_variant_id ? String(row.material_variant_id) : null,
    materialName,
    materialGrade: grade ? String(grade) : null,
    quantityLabel: quantity,
    weightKg: num(row.calculated_weight_kg),
    accountingMode: 'manual_percent',
    planSummary: null,
  }
}

type CompletionWorkspaceResult = {
  data: CompletionWorkspace | null
  error: string | null
  redirectTo: string | null
}

export async function getCompletionWorkspace(requestId: string): Promise<CompletionWorkspaceResult> {
  try {
    const id = z.string().uuid().parse(requestId)
    const { userId } = await requirePermission('technologist_requests', 'manage')
    const client = db()
    const requestResult = await client.from('technologist_requests').select('id,machine_id,created_by,status').eq('id', id).single()
    if (requestResult.error || !requestResult.data) throw new Error('Заявка не найдена')
    if (requestResult.data.created_by !== userId) throw new Error('Завершить заявку может только её автор')
    const navigation = resolveCompletionWorkspaceNavigation(requestResult.data.status as RequestStatus)
    if (navigation.kind === 'redirect') return { data: null, error: null, redirectTo: navigation.href }
    if (navigation.kind === 'unavailable') throw new Error('Заявка не находится на этапе бронирования')
    const [machineResult, sheet, pipe, circle, knives, planFactsResult] = await Promise.all([
      client.from('machines').select('id,name,factory_id,factories(id,name)').eq('id', requestResult.data.machine_id).single(),
      client.from('request_sheet_metal').select('id,material_id,material_variant_id,material_name,material_grade,sheet_size,quantity_sheets,calculated_weight_kg').eq('request_id', id).order('sort_order'),
      client.from('request_pipe').select('id,material_id,material_variant_id,pipe_type,size,remainder_qty,calculated_weight_kg').eq('request_id', id).order('sort_order'),
      client.from('request_circle').select('id,material_id,material_variant_id,steel_grade,diameter_mm,remainder_mm,calculated_weight_kg').eq('request_id', id).order('sort_order'),
      client.from('request_knives').select('id,material_id,material_variant_id,knife_type,steel_grade,remainder_qty,calculated_weight_kg').eq('request_id', id).order('sort_order'),
      client.rpc('fn_get_long_stock_completion_plan_facts_v1', { p_request_id: id }),
    ])
    if (machineResult.error || !machineResult.data) throw new Error('Не удалось определить завод машины')
    const factory = Array.isArray(machineResult.data.factories) ? machineResult.data.factories[0] : machineResult.data.factories
    if (!machineResult.data.factory_id || !factory) throw new Error('У машины не указан завод')
    if (planFactsResult.error) throw new Error(planFactsResult.error.message || 'Не удалось загрузить факты карт раскроя')
    const planFactRows = (planFactsResult.data || []) as RawPlanFactRow[]
    const planVersionIds = [...new Set(planFactRows
      .filter((row) => row.version_id)
      .map((row) => String(row.version_id)))]
    const futureScrapsByVersion = new Map<string, CompletionFutureBusinessScrap[]>()
    if (planVersionIds.length > 0) {
      const scrapLinksResult = await client
        .from('long_stock_cutting_business_scraps')
        .select('version_id,inventory_id')
        .in('version_id', planVersionIds)
      if (scrapLinksResult.error) throw new Error(scrapLinksResult.error.message || 'Не удалось загрузить будущие деловые остатки')

      const inventoryIds = [...new Set((scrapLinksResult.data || []).map((row: RawWasteRow) => String(row.inventory_id)))]
      const inventoryResult = inventoryIds.length > 0
        ? await client
          .from('inventory')
          .select('id,piece_length_mm,business_scrap_state,deleted_at')
          .in('id', inventoryIds)
        : { data: [], error: null }
      if (inventoryResult.error) throw new Error(inventoryResult.error.message || 'Не удалось загрузить складские строки будущих деловых остатков')

      const inventoryById = new Map<string, RawWasteRow>((inventoryResult.data || []).map((row: RawWasteRow) => [String(row.id), row]))
      ;(scrapLinksResult.data || []).forEach((link: RawWasteRow) => {
        const inventory = inventoryById.get(String(link.inventory_id))
        const lengthMm = num(inventory?.piece_length_mm)
        if (!inventory || inventory.deleted_at || !lengthMm || lengthMm <= 0) return
        const versionId = String(link.version_id)
        const scraps = futureScrapsByVersion.get(versionId) || []
        scraps.push({
          inventoryId: String(link.inventory_id),
          lengthMm,
          state: inventory.business_scrap_state === 'available' ? 'available' : 'future',
        })
        futureScrapsByVersion.set(versionId, scraps)
      })
    }
    const planSummaries = new Map<string, CompletionPlanSummary>(planFactRows.map((row) => {
      const versionId = row.version_id ? String(row.version_id) : null
      return [
        planFactKey(String(row.request_item_table), String(row.request_item_id)),
        mapPlanSummary(row, versionId ? futureScrapsByVersion.get(versionId) || [] : []),
      ]
    }))
    const wasteItems = [
      ...(sheet.data || []).map((row: RawWasteRow) => mapWaste('request_sheet_metal', row)),
      ...(pipe.data || []).map((row: RawWasteRow) => mapWaste('request_pipe', row)),
      ...(circle.data || []).map((row: RawWasteRow) => mapWaste('request_circle', row)),
      ...(knives.data || []).map((row: RawWasteRow) => mapWaste('request_knives', row)),
    ].map((item) => {
      const planSummary = planSummaries.get(planFactKey(item.sourceTable, item.sourceId)) || null
      return planSummary ? { ...item, accountingMode: 'approved_plan' as const, planSummary } : item
    })
    return { data: { requestId: id, machineId: machineResult.data.id, machineName: machineResult.data.name, factoryId: machineResult.data.factory_id, factoryName: factory.name, wasteItems }, error: null, redirectTo: null }
  } catch (error) { return { data: null, error: getErrorMessage(error), redirectTo: null } }
}

export async function searchFutureDetailingParts(query: string, page = 0) {
  try {
    await requirePermission('technologist_requests', 'manage')
    const parsed = z.string().trim().max(100).parse(query)
    const safePage = Math.max(0, Math.trunc(page))
    let request = db().from('detailing_parts').select('id,name,drawing_number,unit_weight_kg', { count: 'exact' }).eq('is_active', true)
    if (parsed) request = request.or(`name.ilike.%${parsed.replaceAll(',', '')}%,drawing_number.ilike.%${parsed.replaceAll(',', '')}%`)
    const { data, error, count } = await request.order('name').range(safePage * 20, safePage * 20 + 19)
    if (error) throw error
    return { success: true, data: data || [], total: count || 0 }
  } catch (error) { return { success: false, error: getErrorMessage(error), data: [], total: 0 } }
}

export async function getFutureDetailingCompatibilityOptions(query = '') {
  try {
    await requirePermission('technologist_requests', 'manage')
    let products = db().from('products').select('id,name_uk,name_en,drawing_number').neq('status', 'archived')
    if (query.trim()) products = products.or(`name_uk.ilike.%${query.replaceAll(',', '')}%,drawing_number.ilike.%${query.replaceAll(',', '')}%`)
    const productResult = await products.order('name_uk').limit(20)
    const ids = (productResult.data || []).map((item: any) => item.id)
    const versions = ids.length ? await db().from('product_versions').select('id,product_id,version_number,drawing_number,status').in('product_id', ids).neq('status', 'archived').order('version_number', { ascending: false }) : { data: [] }
    return { success: true, data: (productResult.data || []).map((product: any) => ({ ...product, versions: (versions.data || []).filter((version: any) => version.product_id === product.id) })) }
  } catch (error) { return { success: false, error: getErrorMessage(error), data: [] } }
}

export async function finalizeTechnologistRequest(input: z.input<typeof finalizeSchema>) {
  let stagedArchives: DirectMachineCuttingUpload[] = []
  try {
    const parsed = finalizeSchema.parse(input)
    stagedArchives = parsed.archives
    const { supabase, userId } = await requirePermission('technologist_requests', 'manage')
    const client = db()
    const [machineResult, sheetResult] = await Promise.all([
      client.from('technologist_requests').select('machine_id,created_by').eq('id', parsed.requestId).single(),
      client.from('request_sheet_metal').select('id', { count: 'exact', head: true }).eq('request_id', parsed.requestId),
    ])
    if (machineResult.error || !machineResult.data) throw new Error('Заявка не найдена')
    if (sheetResult.error) throw new Error('Не удалось проверить состав заявки')
    if (machineResult.data.created_by !== userId) throw new Error('Завершить заявку может только её автор')
    const hasSheetMetal = (sheetResult.count || 0) > 0
    if (!hasSheetMetal && stagedArchives.length > 0) throw new Error('Программа порезки доступна только для листового металла')
    if (!hasSheetMetal && (parsed.hours > 0 || parsed.minutes > 0)) throw new Error('Время плазмы доступно только для листового металла')
    for (const archive of stagedArchives) {
      if (archive.requestId !== parsed.requestId) throw new Error('Архив относится к другой заявке')
      if (archive.completionId !== null) throw new Error('Архив уже относится к завершённой заявке')
      validateMachineCuttingRegistration({ machineId: machineResult.data.machine_id, ...archive })
    }
    const readiness = await completeStockReservation(parsed.requestId)
    if (!readiness.success) throw new Error(readiness.error || 'Заявка не готова к завершению')
    const enteredMinutes = parsed.hours * 60 + parsed.minutes
    const { data, error } = await (supabase as any).rpc('fn_finalize_technologist_request_with_archives', {
      p_request_id: parsed.requestId,
      p_actor: userId,
      p_decision: parsed.decision,
      p_entered_plasma_minutes: enteredMinutes,
      p_waste_items: parsed.wasteItems,
      p_future_items: parsed.futureItems,
      p_archives: stagedArchives,
    })
    if (error) throw error
    // Notification is deliberately queued after the transaction so Telegram
    // delivery cannot delay or roll back the finalization button.
    const request = machineResult
    if (request.data?.machine_id) {
      try {
        await db().rpc('notify_users_by_role', {
          p_role: 'supply_manager', p_type: 'technologist_request', p_title: 'Заявка готова для снабжения',
          p_message: 'Бронь и мастер технолога завершены. Заявка передана в снабжение.', p_machine_id: request.data.machine_id,
        })
      } catch {
        // Finalization is already committed; notification delivery is best-effort.
      }
    }
    revalidatePath(ROUTES.MATERIAL_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_MATERIAL_REQUESTS)
    revalidatePath(`${ROUTES.SUPPLY_REQUEST}/${parsed.requestId}`)
    revalidatePath(`${ROUTES.SALES_PLAN}/${machineResult.data.machine_id}`)
    return { success: true, data }
  } catch (error) {
    if (stagedArchives.length > 0) {
      const admin = createAdminClient()
      const paths = stagedArchives.map((archive) => archive.objectPath)
      const { data: registered } = await (admin as any).from('machine_cutting_archives').select('storage_path').in('storage_path', paths)
      const registeredPaths = new Set((registered || []).map((row: { storage_path: string }) => row.storage_path))
      const orphanPaths = paths.filter((path) => !registeredPaths.has(path))
      if (orphanPaths.length > 0) await admin.storage.from(MACHINE_CUTTING_BUCKET).remove(orphanPaths)
    }
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getCompletionCorrectionWorkspace(requestId: string) {
  try {
    const id = z.string().uuid().parse(requestId); const { userId } = await requirePermission('technologist_requests', 'manage'); const client = db()
    const completion = await client.from('technologist_request_completions').select('request_id,machine_id,created_by,entered_plasma_minutes,actual_plasma_minutes,machines(name)').eq('request_id', id).single()
    if (completion.error || !completion.data || completion.data.created_by !== userId) throw new Error('Корректировка недоступна')
    const waste = await client.from('technologist_request_waste_items').select('id,item_name,weight_snapshot_kg,waste_percent,scrap_weight_kg,useful_weight_kg').eq('request_id', id).order('created_at')
    return { data: { completion: completion.data, wasteItems: waste.data || [] }, error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
}

export async function correctTechnologistCompletion(input: { requestId: string; hours: number; minutes: number; reason: string; wasteItems: Array<{ wasteItemId: string; wastePercent: number }> }) {
  try {
    const parsed = z.object({ requestId: z.string().uuid(), hours: z.coerce.number().int().nonnegative(), minutes: z.coerce.number().int().min(0).max(59), reason: z.string().trim().min(1), wasteItems: z.array(z.object({ wasteItemId: z.string().uuid(), wastePercent: z.coerce.number().min(0).max(100) })) }).parse(input)
    const { supabase, userId } = await requirePermission('technologist_requests', 'manage')
    const { error } = await (supabase as any).rpc('fn_correct_technologist_completion', { p_request_id: parsed.requestId, p_entered_plasma_minutes: parsed.hours * 60 + parsed.minutes, p_waste_items: parsed.wasteItems, p_reason: parsed.reason, p_actor: userId })
    if (error) throw error
    const request = await db().from('technologist_requests').select('machine_id').eq('id', parsed.requestId).single()
    revalidatePath(`${ROUTES.INVENTORY_METAL_SCRAP}`); revalidatePath(`/technologist/requests/${parsed.requestId}/correction`)
    revalidatePath(ROUTES.PRODUCTION_CUTTING_AREA)
    if (request.data?.machine_id) revalidatePath(`${ROUTES.SALES_PLAN}/${request.data.machine_id}`)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
