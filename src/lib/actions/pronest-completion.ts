'use server'
/* eslint-disable @typescript-eslint/no-explicit-any -- migration-backed report table */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { requireTechnologistRequestAccess } from '@/lib/technologist-request-access'
import { rectangularDimensions } from '@/lib/materials/rotatable-dimensions'
import {
  PRONEST_MAX_BYTES, PRONEST_MAX_PAGES, PRONEST_PARSER_VERSION,
  calculateProNestPosition, expandProNestSheets, parseProNestPages,
  suggestProNestRectangle, validateProNestForPosition, validateProNestLayouts,
  type ProNestParsedReport, type ProNestSheet, type ProNestPage,
} from '@/lib/pronest/report'

const inputSchema = z.object({
  requestId: z.string().uuid(), sourceId: z.string().uuid(),
  objectPath: z.string().min(1).max(700), fileName: z.string().min(1).max(240),
  fileSize: z.number().int().positive().max(PRONEST_MAX_BYTES), sha256: z.string().regex(/^[0-9a-f]{64}$/),
  pageCount: z.number().int().min(1).max(PRONEST_MAX_PAGES),
  report: z.any(), sheets: z.any(), materialConfirmed: z.boolean(),
  weightDifferenceReason: z.string().trim().max(2000).default(''),
})

const sourceFields = ['page','layoutNumber','layoutCount','timesCut','material','thicknessMm','equipment','process','sheetWidthMm','sheetLengthMm','cropWidthMm','cropLengthMm','sheetWeightKg','actualUtilizationPercent','cropUtilizationPercent','kerfWidthMm','cutLengthMm','pierces','productionSeconds','sheetName','heatNumber','inventoryNumber','location'] as const
function sourceMatches(left: Record<string, unknown>, right: Record<string, unknown>) {
  return sourceFields.every(key => left[key] === right[key])
}
function sourceIdentityMatches(left: Record<string, unknown>, right: Record<string, unknown>) {
  return (['page','layoutNumber','layoutCount','timesCut'] as const).every(key => left[key] === right[key])
}

export async function registerProNestReport(input: unknown) {
  try {
    const parsed = inputSchema.parse(input)
    const report = parsed.report as ProNestParsedReport
    const sheets = parsed.sheets as ProNestSheet[]
    if (!report || !Array.isArray(report.layouts) || !Array.isArray(sheets) || !Array.isArray(report.issues)) throw new Error('Некорректные данные PDF')
    const access = await requireTechnologistRequestAccess(parsed.requestId, { workflowOperation: 'manage', inventoryOperation: 'manage', allowedStatuses: ['stock_checked'] })
    const admin = createAdminClient() as any
    const { data: sheet, error: sheetError } = await admin.from('request_sheet_metal')
      .select('id,request_id,quantity_sheets,sheet_size,thickness_mm,calculated_weight_kg,material_id,steel_type_id')
      .eq('id', parsed.sourceId).eq('request_id', parsed.requestId).maybeSingle()
    if (sheetError || !sheet) throw new Error('Листовая позиция не относится к заявке')
    const correctedLayouts = sheets.filter(row => row.instanceNumber === 1).map(row => row.source)
    const correctedReport = { ...report, layouts: correctedLayouts, issues: validateProNestLayouts(correctedLayouts, report.unrecognizedPages) }
    const issues = validateProNestForPosition(correctedReport, { quantity: Number(sheet.quantity_sheets), sheetSize: String(sheet.sheet_size), thicknessMm: Number(sheet.thickness_mm), materialConfirmed: parsed.materialConfirmed })
    if (issues.length) throw new Error(issues.join('; '))
    if (sheets.length !== Number(sheet.quantity_sheets)) throw new Error('Количество экземпляров листов не совпадает с позицией')
    const expected = expandProNestSheets(report.layouts)
    if (expected.length !== sheets.length) throw new Error('Кратность раскроев не совпадает с листами')
    for (let i = 0; i < sheets.length; i++) {
      const actual = sheets[i]
      const original = expected[i]
      if (!actual || !sourceIdentityMatches(actual.source as unknown as Record<string, unknown>, original.source as unknown as Record<string, unknown>) || actual.instanceNumber !== original.instanceNumber || actual.layoutNumber !== original.layoutNumber || actual.page !== original.page) throw new Error('Номер экземпляра листа не совпадает с PDF')
      if (!actual.reviewed) throw new Error(`Подтвердите лист ${i + 1}`)
      if (Object.entries(actual.source.evidence || {}).some(([key, evidence]) => evidence.reviewRequired && !actual.reviewedFields?.includes(key))) throw new Error(`Проверьте сомнительные поля OCR на листе ${i + 1}`)
      if (!sourceMatches(actual.source as unknown as Record<string, unknown>, original.source as unknown as Record<string, unknown>) && !actual.reason?.trim()) throw new Error(`Укажите причину исправления данных PDF для листа ${i + 1}`)
      if (Math.abs(actual.source.thicknessMm - Number(sheet.thickness_mm)) > 0.01) throw new Error('Толщина листа не совпадает с позицией')
      const sourceSize = [actual.source.sheetWidthMm, actual.source.sheetLengthMm].sort((a,b)=>a-b)
      const crmSize = rectangularDimensions(String(sheet.sheet_size))?.sort((a,b)=>a-b)
      if (!crmSize || sourceSize.some((value, side) => Math.abs(value - crmSize[side]) > 0.1)) throw new Error('Размер листа не совпадает с позицией')
      const suggestion = suggestProNestRectangle(original.source)
      const proposed = suggestion?.rectangle
      const edited = Math.abs(actual.usefulWeightKg - original.usefulWeightKg) > 0.001 || actual.kerfWidthMm !== original.kerfWidthMm || actual.cutLengthMm !== original.cutLengthMm || actual.productionSeconds !== original.productionSeconds
        || (actual.decision === 'preserve' && (actual.remnants.length !== 1 || !proposed || actual.remnants[0].lengthMm !== proposed.lengthMm || actual.remnants[0].widthMm !== proposed.widthMm || (actual.remnants[0].weightKg != null && Math.abs(actual.remnants[0].weightKg - (proposed.weightKg || 0)) > 0.001)))
      if (edited && !actual.reason?.trim()) throw new Error(`Укажите причину исправления для листа ${i + 1}`)
    }
    const calculated = calculateProNestPosition(sheets)
    const crmPerSheet = Number(sheet.calculated_weight_kg) / sheets.length
    if (sheets.some(row => Math.abs(row.source.sheetWeightKg - crmPerSheet) > 0.01) && !parsed.weightDifferenceReason) throw new Error('Укажите причину расхождения веса PDF и CRM')
    if (parsed.objectPath !== `pronest/${parsed.requestId}/${parsed.sourceId}/${parsed.objectPath.split('/').pop()}` || !/\/[0-9a-f-]{36}\.pdf$/.test(parsed.objectPath)) throw new Error('Некорректный путь PDF')
    const { data: blob, error: downloadError } = await admin.storage.from('nesting-files').download(parsed.objectPath)
    if (downloadError || !blob) throw new Error('PDF не найден в приватном хранилище')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.byteLength !== parsed.fileSize || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Размер или формат PDF не совпадает')
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== parsed.sha256) throw new Error('Контрольная сумма PDF не совпадает')
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true }).promise
    try {
      if (pdf.numPages !== parsed.pageCount || pdf.numPages > PRONEST_MAX_PAGES) throw new Error('Количество страниц PDF не совпадает')
      const pages: ProNestPage[] = []
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber)
        const text = await page.getTextContent()
        pages.push({ page: pageNumber, width: page.view[2], height: page.view[3], method: 'text', items: text.items.flatMap(item => 'str' in item && item.str.trim() ? [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }] : []) })
      }
      const extracted = parseProNestPages(pages)
      for (const layout of report.layouts) {
        if (layout.page < 1 || layout.page > pdf.numPages) throw new Error('Некорректная страница раскроя')
        const verified = extracted.layouts.find(row => row.page === layout.page)
        if (verified && !sourceMatches(layout as unknown as Record<string, unknown>, verified as unknown as Record<string, unknown>)) throw new Error(`Данные страницы ${layout.page} не совпадают с исходным PDF`)
        if (!verified && layout.evidence && !Object.values(layout.evidence).every(value => value.method === 'ocr' || value.method === 'operator')) throw new Error(`Не удалось подтвердить страницу ${layout.page}`)
      }
    } finally { await pdf.destroy() }
    const latest = await admin.from('technologist_pronest_reports').select('import_version').eq('request_id', parsed.requestId).eq('source_item_id', parsed.sourceId).order('import_version', { ascending: false }).limit(1)
    if (latest.error) throw latest.error
    const { data: saved, error } = await admin.from('technologist_pronest_reports').insert({
      request_id: parsed.requestId, source_item_id: parsed.sourceId,
      import_version: Number(latest.data?.[0]?.import_version || 0) + 1,
      storage_path: parsed.objectPath, file_name: parsed.fileName, file_size: parsed.fileSize, sha256,
      parser_version: PRONEST_PARSER_VERSION, page_count: parsed.pageCount,
      original_layouts: report.layouts, ocr_raw_pages: report.unrecognizedText || {}, confirmed_sheets: sheets,
      material_confirmed: true, weight_difference_reason: parsed.weightDifferenceReason || null,
      created_by: access.userId,
    }).select('id,import_version').single()
    if (error || !saved) throw new Error(error?.message || 'Не удалось сохранить отчёт')
    return { success: true as const, data: { reportId: saved.id as string, importVersion: saved.import_version as number, totals: calculated }, error: null }
  } catch (error) {
    return { success: false as const, data: null, error: getErrorMessage(error) }
  }
}

export async function cloneProNestReport(requestId: string, sourceId: string, reportId: string) {
  try {
    const ids = z.object({ requestId: z.string().uuid(), sourceId: z.string().uuid(), reportId: z.string().uuid() }).parse({ requestId, sourceId, reportId })
    const access = await requireTechnologistRequestAccess(ids.requestId, { workflowOperation: 'manage', inventoryOperation: 'manage', allowedStatuses: ['stock_checked'] })
    const admin = createAdminClient() as any
    const { data: source, error: sourceError } = await admin.from('technologist_pronest_reports').select('*')
      .eq('id', ids.reportId).eq('request_id', ids.requestId).eq('source_item_id', ids.sourceId).maybeSingle()
    if (sourceError || !source) throw new Error('Исходная версия отчёта не найдена')
    const sheet = await admin.from('request_sheet_metal').select('quantity_sheets,sheet_size,thickness_mm,calculated_weight_kg').eq('id', ids.sourceId).eq('request_id', ids.requestId).single()
    if (sheet.error || !sheet.data) throw new Error('Позиция не найдена')
    const confirmedSheets = source.confirmed_sheets as ProNestSheet[]
    const correctedLayouts = confirmedSheets.filter(row => row.instanceNumber === 1).map(row => row.source)
    const report: ProNestParsedReport = { layouts: correctedLayouts, extraPages: [], unrecognizedPages: [], issues: validateProNestLayouts(correctedLayouts) }
    const issues = validateProNestForPosition(report, { quantity: Number(sheet.data.quantity_sheets), sheetSize: String(sheet.data.sheet_size), thicknessMm: Number(sheet.data.thickness_mm), materialConfirmed: true })
    if (issues.length) throw new Error('Позиция изменилась: ' + issues.join('; '))
    if (confirmedSheets.length !== Number(sheet.data.quantity_sheets)) throw new Error('Количество листов изменилось')
    const latest = await admin.from('technologist_pronest_reports').select('import_version').eq('request_id', ids.requestId).eq('source_item_id', ids.sourceId).order('import_version', { ascending: false }).limit(1)
    if (latest.error) throw latest.error
    const { data: saved, error } = await admin.from('technologist_pronest_reports').insert({
      request_id: ids.requestId, source_item_id: ids.sourceId, import_version: Number(latest.data?.[0]?.import_version || 0) + 1,
      storage_path: source.storage_path, file_name: source.file_name, file_size: source.file_size, sha256: source.sha256,
      parser_version: source.parser_version, page_count: source.page_count, original_layouts: source.original_layouts, ocr_raw_pages: source.ocr_raw_pages,
      confirmed_sheets: source.confirmed_sheets, material_confirmed: source.material_confirmed,
      weight_difference_reason: source.weight_difference_reason, created_by: access.userId,
    }).select('id,import_version').single()
    if (error || !saved) throw new Error(error?.message || 'Не удалось скопировать PDF')
    return { success: true as const, data: { reportId: saved.id as string, importVersion: saved.import_version as number, totals: calculateProNestPosition(confirmedSheets) }, error: null }
  } catch (error) { return { success: false as const, data: null, error: getErrorMessage(error) } }
}
