'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase generated types are updated only after this migration is applied. */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ROUTES } from '@/lib/constants/routes'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { completeStockReservation } from '@/lib/actions/technologist-requests'

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
  wasteItems: z.array(wasteSchema).min(1),
  futureItems: z.array(futureItemSchema),
}).refine((value) => value.decision === 'none' ? value.futureItems.length === 0 : value.futureItems.length > 0, 'Добавьте деталировку или выберите «нет»')

type RawWasteRow = Record<string, unknown>
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

function mapWaste(sourceTable: CompletionWasteItem['sourceTable'], row: RawWasteRow): CompletionWasteItem {
  const fallbackName = sourceTable === 'request_circle' ? `Круг Ø${row.diameter_mm || '—'} мм` : 'Металл'
  const materialName = String(row.material_name || row.pipe_type || row.knife_type || fallbackName)
  const grade = row.material_grade || row.steel_grade || null
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
    itemName: [materialName, grade, row.sheet_size || row.size].filter(Boolean).join(' · '),
    materialId: row.material_id ? String(row.material_id) : null,
    materialVariantId: row.material_variant_id ? String(row.material_variant_id) : null,
    materialName,
    materialGrade: grade ? String(grade) : null,
    quantityLabel: quantity,
    weightKg: num(row.calculated_weight_kg),
  }
}

export async function getCompletionWorkspace(requestId: string): Promise<{ data: CompletionWorkspace | null; error: string | null }> {
  try {
    const id = z.string().uuid().parse(requestId)
    const { userId } = await requirePermission('technologist_requests', 'manage')
    const client = db()
    const requestResult = await client.from('technologist_requests').select('id,machine_id,created_by,status').eq('id', id).single()
    if (requestResult.error || !requestResult.data) throw new Error('Заявка не найдена')
    if (requestResult.data.created_by !== userId) throw new Error('Завершить заявку может только её автор')
    if (!['pending_stock_check', 'stock_checked'].includes(requestResult.data.status)) throw new Error('Заявка не находится на этапе бронирования')
    const [machineResult, sheet, pipe, circle, knives] = await Promise.all([
      client.from('machines').select('id,name,factory_id,factories(id,name)').eq('id', requestResult.data.machine_id).single(),
      client.from('request_sheet_metal').select('id,material_id,material_variant_id,material_name,material_grade,sheet_size,quantity_sheets,calculated_weight_kg').eq('request_id', id).order('sort_order'),
      client.from('request_pipe').select('id,material_id,material_variant_id,pipe_type,size,remainder_qty,calculated_weight_kg').eq('request_id', id).order('sort_order'),
      client.from('request_circle').select('id,material_id,material_variant_id,steel_grade,diameter_mm,remainder_mm,calculated_weight_kg').eq('request_id', id).order('sort_order'),
      client.from('request_knives').select('id,material_id,material_variant_id,knife_type,steel_grade,remainder_qty,calculated_weight_kg').eq('request_id', id).order('sort_order'),
    ])
    if (machineResult.error || !machineResult.data) throw new Error('Не удалось определить завод машины')
    const factory = Array.isArray(machineResult.data.factories) ? machineResult.data.factories[0] : machineResult.data.factories
    if (!machineResult.data.factory_id || !factory) throw new Error('У машины не указан завод')
    const wasteItems = [
      ...(sheet.data || []).map((row: RawWasteRow) => mapWaste('request_sheet_metal', row)),
      ...(pipe.data || []).map((row: RawWasteRow) => mapWaste('request_pipe', row)),
      ...(circle.data || []).map((row: RawWasteRow) => mapWaste('request_circle', row)),
      ...(knives.data || []).map((row: RawWasteRow) => mapWaste('request_knives', row)),
    ]
    return { data: { requestId: id, machineId: machineResult.data.id, machineName: machineResult.data.name, factoryId: machineResult.data.factory_id, factoryName: factory.name, wasteItems }, error: null }
  } catch (error) { return { data: null, error: getErrorMessage(error) } }
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
  try {
    const parsed = finalizeSchema.parse(input)
    const readiness = await completeStockReservation(parsed.requestId)
    if (!readiness.success) throw new Error(readiness.error || 'Заявка не готова к завершению')
    const { supabase, userId } = await requirePermission('technologist_requests', 'manage')
    const enteredMinutes = parsed.hours * 60 + parsed.minutes
    const { data, error } = await (supabase as any).rpc('fn_finalize_technologist_request', {
      p_request_id: parsed.requestId,
      p_actor: userId,
      p_decision: parsed.decision,
      p_entered_plasma_minutes: enteredMinutes,
      p_waste_items: parsed.wasteItems,
      p_future_items: parsed.futureItems,
    })
    if (error) throw error
    // Notification is deliberately queued after the transaction so Telegram
    // delivery cannot delay or roll back the finalization button.
    const request = await db().from('technologist_requests').select('machine_id').eq('id', parsed.requestId).single()
    if (request.data?.machine_id) {
      await db().rpc('notify_users_by_role', {
        p_role: 'supply_manager', p_type: 'technologist_request', p_title: 'Заявка готова для снабжения',
        p_message: 'Бронь и мастер технолога завершены. Заявка передана в снабжение.', p_machine_id: request.data.machine_id,
      })
    }
    revalidatePath(ROUTES.MATERIAL_REQUESTS)
    revalidatePath(ROUTES.SUPPLY_MATERIAL_REQUESTS)
    revalidatePath(`${ROUTES.SUPPLY_REQUEST}/${parsed.requestId}`)
    return { success: true, data }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
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
    const parsed = z.object({ requestId: z.string().uuid(), hours: z.coerce.number().int().nonnegative(), minutes: z.coerce.number().int().min(0).max(59), reason: z.string().trim().min(1), wasteItems: z.array(z.object({ wasteItemId: z.string().uuid(), wastePercent: z.coerce.number().min(0).max(100) })).min(1) }).parse(input)
    const { supabase, userId } = await requirePermission('technologist_requests', 'manage')
    const { error } = await (supabase as any).rpc('fn_correct_technologist_completion', { p_request_id: parsed.requestId, p_entered_plasma_minutes: parsed.hours * 60 + parsed.minutes, p_waste_items: parsed.wasteItems, p_reason: parsed.reason, p_actor: userId })
    if (error) throw error
    revalidatePath(`${ROUTES.INVENTORY_METAL_SCRAP}`); revalidatePath(`/technologist/requests/${parsed.requestId}/correction`)
    return { success: true }
  } catch (error) { return { success: false, error: getErrorMessage(error) } }
}
