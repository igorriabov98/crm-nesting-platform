import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { createAdminClient } from '@/lib/supabase/admin'
import { knifeBevelLabel } from '@/lib/materials/knife-bevel'
import {
  LONG_STOCK_CUTTING_PLAN_PDF_BUCKET,
  calculateLongStockPdfRemainder,
  formatLongStockMaterialVariant,
  longStockCuttingPlanPdfDecision,
  longStockCuttingPlanPdfFileName,
  longStockCuttingPlanPdfObjectPath,
  parseLongStockCuttingPlanPdfMetadata,
  summarizeLongStockPdfCuts,
  type LongStockCuttingPlanPdfBar,
  type LongStockCuttingPlanPdfData,
  type LongStockCuttingPlanPdfMetadata,
  type LongStockMaterialVariantDescriptor,
} from '@/lib/long-stock-cutting-plan-pdf'
import { LongStockCuttingPlanDocument } from '@/lib/pdf/LongStockCuttingPlanDocument'

/* eslint-disable @typescript-eslint/no-explicit-any -- Long-stock tables are generated after migrations are applied. */

type VersionRow = {
  id: string
  plan_id: string
  version_number: number
  status: string
  selected_candidate_number: number
  settings_snapshot: Record<string, unknown>
  pdf_metadata: unknown
  definition_sealed: boolean
}

type PlanRow = {
  id: string
  plan_number: number
  material_variant_id: string
}

type PreparedLongStockCuttingPlanPdf =
  | { kind: 'stored'; metadata: LongStockCuttingPlanPdfMetadata }
  | { kind: 'generated'; metadata: LongStockCuttingPlanPdfMetadata }

function rowData<T>(result: { data: T | null; error: { message: string } | null }, message: string) {
  if (result.error) throw new Error(result.error.message || message)
  if (!result.data) throw new Error(message)
  return result.data
}

function numeric(value: unknown, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Некорректное значение ${label} в snapshot карты раскроя`)
  return parsed
}

async function loadLongStockCuttingPlanPdfData(
  db: any,
  version: VersionRow,
  plan: PlanRow,
  generatedAt: string,
): Promise<LongStockCuttingPlanPdfData> {
  if (!version.definition_sealed) throw new Error('Определение версии карты раскроя ещё не зафиксировано')

  const [planItemsResult, candidateResult, variantResult] = await Promise.all([
    db.from('long_stock_cutting_plan_items')
      .select('id,request_id,request_item_table,request_item_id')
      .eq('plan_id', plan.id)
      .order('linked_at')
      .order('id'),
    db.from('long_stock_cutting_candidates')
      .select('id')
      .eq('version_id', version.id)
      .eq('candidate_number', version.selected_candidate_number)
      .maybeSingle(),
    db.from('material_variants')
      .select('id,material_id,category,steel_type_id,material_grade,knife_material,knife_bevel_count,knife_dimensions,standard_length_mm,width_mm,height_mm,diameter_mm,is_calibrated,pipe_type,piece_description,wall_thickness_mm')
      .eq('id', plan.material_variant_id)
      .maybeSingle(),
  ])
  if (planItemsResult.error) throw new Error(planItemsResult.error.message)
  const planItems = planItemsResult.data || []
  if (planItems.length === 0) throw new Error('В карте раскроя нет позиции заявки')
  const requestIds = Array.from(new Set(planItems.map((item: any) => item.request_id))) as string[]
  if (requestIds.length !== 1) throw new Error('PDF текущей версии поддерживает одну заявку технолога')
  const candidate = rowData(candidateResult, 'Выбранный вариант раскроя не найден') as { id: string }
  const variant = rowData(variantResult, 'Вариант материала карты раскроя не найден') as LongStockMaterialVariantDescriptor & {
    id: string
    material_id: string
    steel_type_id: string | null
  }

  const [requestResult, materialResult, steelTypeResult, barsResult] = await Promise.all([
    db.from('technologist_requests').select('id,machine_id,created_by,created_at').eq('id', requestIds[0]).maybeSingle(),
    db.from('materials').select('id,name').eq('id', variant.material_id).maybeSingle(),
    variant.steel_type_id
      ? db.from('steel_types').select('id,name').eq('id', variant.steel_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('long_stock_cutting_candidate_bars')
      .select('id,bar_number,stock_length_mm')
      .eq('candidate_id', candidate.id)
      .order('bar_number'),
  ])
  const request = rowData(requestResult, 'Заявка технолога карты раскроя не найдена') as {
    id: string
    machine_id: string
    created_by: string
    created_at: string
  }
  const material = rowData(materialResult, 'Материал карты раскроя не найден') as { id: string; name: string }
  if (steelTypeResult.error) throw new Error(steelTypeResult.error.message)
  if (barsResult.error) throw new Error(barsResult.error.message)
  const rawBars = barsResult.data || []
  if (rawBars.length === 0) throw new Error('В выбранной раскладке нет хлыстов')

  const [machineResult, technologistResult, cutsResult] = await Promise.all([
    db.from('machines').select('id,factory_id').eq('id', request.machine_id).maybeSingle(),
    db.from('users').select('id,full_name,email').eq('id', request.created_by).maybeSingle(),
    db.from('long_stock_cutting_bar_cuts')
      .select('id,bar_id,cut_number,cut_length_mm')
      .eq('candidate_id', candidate.id)
      .order('cut_number'),
  ])
  const machine = rowData(machineResult, 'Заказ карты раскроя не найден') as { id: string; factory_id: string | null }
  if (!machine.factory_id) throw new Error('Для заказа карты раскроя не указан завод')
  const technologist = rowData(technologistResult, 'Технолог карты раскроя не найден') as {
    full_name: string
    email: string
  }
  if (cutsResult.error) throw new Error(cutsResult.error.message)
  const [factoryResult, requestOrderResult] = await Promise.all([
    db.from('factories').select('id,name').eq('id', machine.factory_id).maybeSingle(),
    db.from('technologist_requests').select('id,created_at').eq('machine_id', machine.id).order('created_at').order('id'),
  ])
  const factory = rowData(factoryResult, 'Завод карты раскроя не найден') as { name: string }
  if (requestOrderResult.error) throw new Error(requestOrderResult.error.message)
  const requestIndex = (requestOrderResult.data || []).findIndex((entry: any) => entry.id === request.id)
  if (requestIndex < 0) throw new Error('Не удалось определить номер заявки технолога')

  const kerfMm = numeric(version.settings_snapshot.kerf_mm, 'пропила')
  const endTrimMm = numeric(version.settings_snapshot.end_trim_mm, 'торцовки')
  const cutsByBar = new Map<string, Array<{ cutNumber: number; lengthMm: number }>>()
  for (const cut of cutsResult.data || []) {
    const list = cutsByBar.get(cut.bar_id) || []
    list.push({ cutNumber: Number(cut.cut_number), lengthMm: numeric(cut.cut_length_mm, 'длины реза') })
    cutsByBar.set(cut.bar_id, list)
  }
  const bars: LongStockCuttingPlanPdfBar[] = rawBars.map((bar: any) => {
    const stockLengthMm = numeric(bar.stock_length_mm, 'длины хлыста')
    const cuts = (cutsByBar.get(bar.id) || []).sort((left, right) => left.cutNumber - right.cutNumber)
    const remainderMm = calculateLongStockPdfRemainder(stockLengthMm, cuts, kerfMm, endTrimMm)
    if (remainderMm < -0.0001) {
      throw new Error(`Хлыст №${bar.bar_number}: расчётная раскладка превышает длину на ${Math.abs(remainderMm)} мм`)
    }
    return {
      barNumber: Number(bar.bar_number),
      stockLengthMm,
      cuts,
      remainderMm: Math.max(remainderMm, 0),
    }
  })
  const metalType = String((steelTypeResult.data as { name?: string } | null)?.name
    || variant.material_grade || variant.knife_material || 'Не указан')

  return {
    planNumber: Number(plan.plan_number),
    versionNumber: Number(version.version_number),
    generatedAt,
    requestNumber: requestIndex + 1,
    factoryName: factory.name,
    technologistName: technologist.full_name || technologist.email,
    materialName: material.name,
    materialVariantLabel: formatLongStockMaterialVariant(variant),
    metalType,
    knifeBevel: variant.category === 'knives' ? knifeBevelLabel(variant.knife_bevel_count) : null,
    kerfMm,
    endTrimMm,
    bars,
    totals: summarizeLongStockPdfCuts(bars),
  }
}

async function loadVersionAndPlan(db: any, versionId: string) {
  const version = rowData(await db.from('long_stock_cutting_plan_versions')
    .select('id,plan_id,version_number,status,selected_candidate_number,settings_snapshot,pdf_metadata,definition_sealed')
    .eq('id', versionId)
    .maybeSingle(), 'Версия карты раскроя не найдена') as VersionRow
  const plan = rowData(await db.from('long_stock_cutting_plans')
    .select('id,plan_number,material_variant_id')
    .eq('id', version.plan_id)
    .maybeSingle(), 'Карта раскроя не найдена') as PlanRow
  return { version, plan }
}

export async function prepareLongStockCuttingPlanPdf(
  versionId: string,
  actorId: string,
): Promise<PreparedLongStockCuttingPlanPdf> {
  const admin = createAdminClient()
  const db = admin as any
  const { version, plan } = await loadVersionAndPlan(db, versionId)
  const decision = longStockCuttingPlanPdfDecision(version.status, version.pdf_metadata, {
    planId: plan.id,
    versionId: version.id,
  })
  if (decision.kind === 'stored') return decision
  if (decision.kind === 'unavailable') {
    throw new Error(decision.reason === 'recalculation_required'
      ? 'Недействительная версия требует пересчёта; PDF недоступен'
      : 'PDF доступен только для утверждаемой версии карты раскроя')
  }

  const generatedAt = new Date().toISOString()
  const data = await loadLongStockCuttingPlanPdfData(db, version, plan, generatedAt)
  const element = createElement(LongStockCuttingPlanDocument, { data }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)
  const artifactId = randomUUID()
  const objectPath = longStockCuttingPlanPdfObjectPath(plan.id, version.id, artifactId)
  const metadata: LongStockCuttingPlanPdfMetadata = {
    schema_version: 1,
    bucket_id: LONG_STOCK_CUTTING_PLAN_PDF_BUCKET,
    object_path: objectPath,
    file_name: longStockCuttingPlanPdfFileName(data.planNumber, data.versionNumber),
    mime_type: 'application/pdf',
    size_bytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    generated_by: actorId,
    generated_at: generatedAt,
  }
  const { error } = await admin.storage.from(LONG_STOCK_CUTTING_PLAN_PDF_BUCKET).upload(objectPath, buffer, {
    cacheControl: '31536000',
    contentType: metadata.mime_type,
    upsert: false,
  })
  if (error) throw new Error(error.message || 'Не удалось сохранить PDF карты раскроя')
  return { kind: 'generated', metadata }
}

export async function removePreparedLongStockCuttingPlanPdf(metadata: LongStockCuttingPlanPdfMetadata) {
  const admin = createAdminClient()
  const versionId = metadata.object_path.split('/')[2]
  const storedResult = await (admin as any).from('long_stock_cutting_plan_versions')
    .select('plan_id,pdf_metadata')
    .eq('id', versionId)
    .maybeSingle()
  if (storedResult.error) return
  const storedMetadata = storedResult.data
    ? parseLongStockCuttingPlanPdfMetadata(storedResult.data.pdf_metadata, {
      planId: storedResult.data.plan_id,
      versionId,
    })
    : null
  if (storedMetadata?.object_path === metadata.object_path
    && storedMetadata.sha256 === metadata.sha256) return
  await admin.storage.from(metadata.bucket_id).remove([metadata.object_path]).catch(() => undefined)
}
