import { rectangularDimensions } from '@/lib/materials/rotatable-dimensions'

export const PRONEST_PARSER_VERSION = 1
export const PRONEST_MAX_BYTES = 50 * 1024 * 1024
export const PRONEST_MAX_PAGES = 100

export type ExtractionMethod = 'text' | 'ocr' | 'operator'
export type FieldEvidence = { page: number; raw: string; method: ExtractionMethod; confidence: number; reviewRequired: boolean }
export type PageTextItem = { text: string; x: number; y: number; confidence?: number }
export type ProNestPage = { page: number; width: number; height: number; method: 'text' | 'ocr'; items: PageTextItem[] }
export type ProNestLayout = {
  page: number
  layoutNumber: number
  layoutCount: number
  timesCut: number
  material: string
  thicknessMm: number
  equipment: string | null
  process: string | null
  sheetWidthMm: number
  sheetLengthMm: number
  cropWidthMm: number
  cropLengthMm: number
  sheetWeightKg: number
  actualUtilizationPercent: number
  cropUtilizationPercent: number
  kerfWidthMm: number
  cutLengthMm: number
  pierces: number
  productionSeconds: number
  sheetName: string | null
  heatNumber: string | null
  inventoryNumber: string | null
  location: string | null
  evidence: Record<string, FieldEvidence>
  reviewRequired: boolean
}
export type ProNestParsedReport = { layouts: ProNestLayout[]; extraPages: number[]; unrecognizedPages: number[]; issues: string[]; unrecognizedText?: Record<number, string[]> }
export type ProNestRemnant = { lengthMm: number; widthMm: number; weightKg?: number }
export type ProNestSheet = {
  layoutNumber: number
  instanceNumber: number
  page: number
  source: ProNestLayout
  decision: 'preserve' | 'scrap' | 'none'
  remnants: ProNestRemnant[]
  usefulWeightKg: number
  kerfWidthMm: number
  cutLengthMm: number
  productionSeconds: number
  reason: string
  reviewed: boolean
  reviewedFields: string[]
}

const roundKg = (n: number) => Math.round(n * 1000) / 1000
const number = (raw: string) => Number(raw.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''))
const pair = (raw: string) => {
  const match = raw.match(/([\d\s.,]+)\s*[×xх*]\s*([\d\s.,]+)/i)
  return match ? [number(match[1]), number(match[2])] as const : null
}
const normalize = (s: string) => s.toLocaleLowerCase().replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim()
const labels: Record<string, RegExp> = {
  layout: /^(?:раскрой|nest)\s*:/i,
  timesCut: /^(?:резка\s*[-–—]\s*количество раз|times cut)\s*:/i,
  material: /^(?:материал|material)\s*:/i,
  equipment: /^(?:оборудование|machine)\s*:/i,
  process: /^(?:использованные процессы|processes used)\s*:/i,
  sheetSize: /^(?:размер листа|sheet size)\s*:/i,
  cropSize: /^(?:размер раскроя|crop size)\s*:/i,
  sheetWeight: /^(?:вес листа|sheet weight)\s*:/i,
  actualUtilization: /^(?:коэффициент фактического использования площади|actual utilization)\s*:/i,
  cropUtilization: /^(?:коэффициент использования обрезки|crop utilization)\s*:/i,
  kerfWidth: /^(?:базовый пропил|base kerf)\s*:/i,
  cutLength: /^(?:общая длина разреза|total cut length)\s*:/i,
  pierces: /^(?:проколов\s*\(всего\)|total pierces)\s*:/i,
  time: /^(?:время производства|production time)\s*:/i,
  sheetName: /^(?:название листа|sheet name)\s*:/i,
  heatNumber: /^(?:номер плавки|heat number)\s*:/i,
  inventoryNumber: /^(?:идентификационный номер инвентаря|inventory id)\s*:/i,
  location: /^(?:местоположение|location)\s*:/i,
}

function field(page: ProNestPage, name: string): { raw: string; evidence: FieldEvidence } | null {
  const matcher = labels[name]
  const matches = page.items.filter(item => matcher.test(normalize(item.text)))
  for (const label of matches) {
    const embedded = label.text.slice(label.text.indexOf(':') + 1).trim()
    const tolerance = page.method === 'ocr' ? Math.max(12, page.height * 0.015) : 3.5
    const candidates = page.items.filter(item => item !== label && Math.abs(item.y - label.y) <= tolerance && item.x > label.x + 1 && !/^[\s:]*$/.test(item.text))
      .sort((a, b) => a.x - b.x)
    const value = embedded || candidates.find(item => !Object.values(labels).some(regex => regex.test(normalize(item.text))))?.text.trim()
    if (!value) continue
    const confidence = Math.min(label.confidence ?? 100, candidates[0]?.confidence ?? 100)
    return { raw: value, evidence: { page: page.page, raw: value, method: page.method, confidence, reviewRequired: page.method === 'ocr' && confidence < 90 } }
  }
  return null
}

function parseTime(raw: string) {
  const match = raw.match(/(\d+):(\d{1,2}):(\d{1,2})/)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN
}

function parseLayout(page: ProNestPage): ProNestLayout | null {
  const found = Object.fromEntries(Object.keys(labels).map(key => [key, field(page, key)])) as Record<string, ReturnType<typeof field>>
  if (!found.layout) return null
  const layoutText = page.method === 'ocr' ? found.layout.raw.replace(/^[Зз]/, '3') : found.layout.raw
  const nest = layoutText.match(/(\d+)\s*(?:из|of|\/)\s*(\d+)/i)
    || (page.method === 'ocr' ? layoutText.match(/(\d+)\s*u3\s*(\d+)/i) || layoutText.match(/^([1-9]\d?)1[з3]([1-9]\d?)$/i) : null)
  const material = (found.material?.raw || '').replace(/\$\$/g, 'SS').replace(/тт/gi, 'mm')
  const thickness = material.match(/(\d+(?:[,.]\d+)?)\s*(?:mm|мм)/i)
  const size = pair(found.sheetSize?.raw || '')
  const crop = pair(found.cropSize?.raw || '')
  const required = ['layout', 'timesCut', 'material', 'sheetSize', 'cropSize', 'sheetWeight', 'actualUtilization', 'cropUtilization', 'kerfWidth', 'cutLength', 'time']
  if (!nest || !thickness || !size || !crop || required.some(key => !found[key])) return null
  const values = [number(found.timesCut!.raw), number(thickness[1]), ...size, ...crop, number(found.sheetWeight!.raw), number(found.actualUtilization!.raw), number(found.cropUtilization!.raw), number(found.kerfWidth!.raw), number(found.cutLength!.raw), parseTime(found.time!.raw)]
  if (values.some(value => !Number.isFinite(value))) return null
  const [timesCut, thicknessMm, sheetWidthMm, sheetLengthMm, cropWidthMm, cropLengthMm, sheetWeightKg, actualUtilizationPercent, cropUtilizationPercent, kerfWidthMm, cutLengthMm, productionSeconds] = values
  const evidence = Object.fromEntries(Object.entries(found).filter((entry): entry is [string, NonNullable<ReturnType<typeof field>>] => Boolean(entry[1])).map(([key, value]) => [key, value.evidence]))
  const uncertainOcr = page.method === 'ocr' && (!/(?:из|of|\/)/i.test(found.layout.raw) || material !== found.material?.raw)
  if (page.method === 'ocr' && !/(?:из|of|\/)/i.test(found.layout.raw) && evidence.layout) evidence.layout.reviewRequired = true
  if (page.method === 'ocr' && material !== found.material?.raw && evidence.material) evidence.material.reviewRequired = true
  return {
    page: page.page, layoutNumber: Number(nest[1]), layoutCount: Number(nest[2]), timesCut, material,
    thicknessMm, equipment: found.equipment?.raw || null, process: found.process?.raw || null,
    sheetWidthMm, sheetLengthMm, cropWidthMm, cropLengthMm, sheetWeightKg,
    actualUtilizationPercent, cropUtilizationPercent, kerfWidthMm, cutLengthMm,
    pierces: found.pierces ? number(found.pierces.raw) : 0, productionSeconds,
    sheetName: found.sheetName?.raw || null, heatNumber: found.heatNumber?.raw || null,
    inventoryNumber: found.inventoryNumber?.raw || null, location: found.location?.raw || null,
    evidence, reviewRequired: uncertainOcr || Object.values(evidence).some(entry => entry.reviewRequired),
  }
}

export function parseProNestPages(pages: ProNestPage[]): ProNestParsedReport {
  const layouts: ProNestLayout[] = []
  const extraPages: number[] = []
  const unrecognizedPages: number[] = []
  const unrecognizedText: Record<number, string[]> = {}
  for (const page of pages) {
    const layout = parseLayout(page)
    if (layout) layouts.push(layout)
    else if (page.items.some(item => /(?:раскрой|nest)\s*:/i.test(item.text)) || page.items.filter(item => Object.values(labels).some(regex => regex.test(normalize(item.text)))).length >= 3) { unrecognizedPages.push(page.page); unrecognizedText[page.page] = page.items.map(item => item.text) }
    else extraPages.push(page.page)
  }
  const issues = validateProNestLayouts(layouts, unrecognizedPages)
  return { layouts, extraPages, unrecognizedPages, issues, unrecognizedText }
}

export function validateProNestLayouts(layouts: ProNestLayout[], unrecognizedPages: number[] = []) {
  const issues: string[] = []
  if (!layouts.length) issues.push('В отчёте не найден ни один полный раскрой ProNest')
  if (unrecognizedPages.length) issues.push(`Не распознаны обязательные поля на страницах: ${unrecognizedPages.join(', ')}`)
  const total = layouts[0]?.layoutCount
  if (layouts.some(layout => layout.layoutCount !== total)) issues.push('В отчёте различается общее количество раскроев')
  if (layouts.some(layout => !Number.isInteger(layout.timesCut) || layout.timesCut <= 0 || layout.timesCut > 1000)) issues.push('Проверьте количество выполнений раскроя')
  if (layouts.some(layout => !layout.material.trim() || ![layout.thicknessMm,layout.sheetWeightKg,layout.sheetWidthMm,layout.sheetLengthMm,layout.cropWidthMm,layout.cropLengthMm,layout.kerfWidthMm,layout.cutLengthMm,layout.productionSeconds,layout.actualUtilizationPercent,layout.cropUtilizationPercent].every(Number.isFinite) || layout.thicknessMm <= 0 || layout.sheetWeightKg <= 0 || layout.sheetWidthMm <= 0 || layout.sheetLengthMm <= 0 || layout.cropWidthMm <= 0 || layout.cropLengthMm <= 0 || !((layout.cropWidthMm <= layout.sheetWidthMm && layout.cropLengthMm <= layout.sheetLengthMm) || (layout.cropWidthMm <= layout.sheetLengthMm && layout.cropLengthMm <= layout.sheetWidthMm)) || layout.kerfWidthMm < 0 || layout.cutLengthMm < 0 || !Number.isInteger(layout.productionSeconds) || layout.productionSeconds < 0 || layout.actualUtilizationPercent < 0 || layout.actualUtilizationPercent > 100 || layout.cropUtilizationPercent <= 0 || layout.cropUtilizationPercent > 100 || layout.actualUtilizationPercent > layout.cropUtilizationPercent + 0.02)) issues.push('В отчёте есть недопустимые размеры, вес, время или коэффициенты')
  const numbers = layouts.map(layout => layout.layoutNumber)
  if (!Number.isInteger(total) || !total || new Set(numbers).size !== numbers.length || layouts.some(layout => !Number.isInteger(layout.layoutNumber) || layout.layoutNumber < 1 || layout.layoutNumber > (total || 0)) || (total && layouts.length !== total)) issues.push('Нумерация раскроев неполная или повторяется')
  return issues
}

export function expandProNestSheets(layouts: ProNestLayout[]): ProNestSheet[] {
  const sheets = layouts.flatMap(source => Array.from({ length: Math.max(0, Math.min(1000, source.timesCut)) }, (_, index) => ({
    layoutNumber: source.layoutNumber, instanceNumber: index + 1, page: source.page, source,
    decision: 'none' as const, remnants: [], usefulWeightKg: roundKg(source.sheetWeightKg * source.actualUtilizationPercent / 100),
    kerfWidthMm: source.kerfWidthMm, cutLengthMm: source.cutLengthMm, productionSeconds: source.productionSeconds,
    reason: '', reviewed: false, reviewedFields: [],
  })))
  if (sheets.length) {
    const target = roundKg(layouts.reduce((sum, row) => sum + row.sheetWeightKg * row.actualUtilizationPercent / 100 * row.timesCut, 0))
    const current = roundKg(sheets.reduce((sum, row) => sum + row.usefulWeightKg, 0))
    sheets[sheets.length - 1].usefulWeightKg = roundKg(sheets[sheets.length - 1].usefulWeightKg + target - current)
  }
  return sheets
}

export function suggestProNestRectangle(layout: ProNestLayout): { rectangle: ProNestRemnant; estimatedFreeAreaMm2: number } | null {
  if (Math.abs(layout.actualUtilizationPercent - layout.cropUtilizationPercent) < 0.01) return null
  const sheetArea = layout.sheetWidthMm * layout.sheetLengthMm
  const estimatedFreeAreaMm2 = sheetArea * (1 - layout.actualUtilizationPercent / layout.cropUtilizationPercent)
  const candidates = [
    { lengthMm: layout.sheetLengthMm - layout.cropLengthMm, widthMm: layout.sheetWidthMm },
    { lengthMm: layout.sheetWidthMm - layout.cropWidthMm, widthMm: layout.sheetLengthMm },
  ].filter(row => row.lengthMm > 0 && row.widthMm > 0 && row.lengthMm * row.widthMm <= estimatedFreeAreaMm2 + sheetArea * 0.01)
  const rectangle = candidates.sort((a, b) => b.lengthMm * b.widthMm - a.lengthMm * a.widthMm)[0]
  return rectangle ? { rectangle: { ...rectangle, weightKg: roundKg(layout.sheetWeightKg * rectangle.lengthMm * rectangle.widthMm / sheetArea) }, estimatedFreeAreaMm2 } : null
}

export function calculateProNestSheet(sheet: ProNestSheet) {
  const source = sheet.source
  const area = source.sheetWidthMm * source.sheetLengthMm
  if (!Number.isFinite(area) || area <= 0 || !Number.isFinite(source.sheetWeightKg) || source.sheetWeightKg <= 0) throw new Error('Некорректный исходный лист')
  let usedArea = 0
  const remnants = sheet.decision === 'preserve' ? sheet.remnants.map(remnant => {
    const { lengthMm, widthMm } = remnant
    if (![lengthMm, widthMm].every(n => Number.isFinite(n) && n > 0 && Math.round(n * 100) === n * 100)
      || !((lengthMm <= source.sheetLengthMm && widthMm <= source.sheetWidthMm) || (lengthMm <= source.sheetWidthMm && widthMm <= source.sheetLengthMm))) throw new Error('Размер остатка не помещается в этот лист')
    usedArea += lengthMm * widthMm
    const expected = roundKg(source.sheetWeightKg * lengthMm * widthMm / area)
    const weightKg = remnant.weightKg ?? expected
    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg >= source.sheetWeightKg) throw new Error('Некорректный вес остатка')
    return { lengthMm, widthMm, weightKg, expectedWeightKg: expected }
  }) : []
  if (usedArea >= area) throw new Error('Суммарная площадь остатков превышает площадь листа')
  const remnantKg = roundKg(remnants.reduce((sum, row) => sum + row.weightKg, 0))
  const usefulKg = roundKg(sheet.usefulWeightKg)
  const kerfKg = roundKg(source.sheetWeightKg * sheet.kerfWidthMm * sheet.cutLengthMm / area)
  const metalScrapKg = roundKg(source.sheetWeightKg - usefulKg - remnantKg - kerfKg)
  const wasteBasisKg = roundKg(source.sheetWeightKg - remnantKg)
  if (![usefulKg, kerfKg, metalScrapKg, wasteBasisKg].every(Number.isFinite) || usefulKg < 0 || kerfKg < 0 || metalScrapKg < 0 || wasteBasisKg <= 0) throw new Error('Весовой баланс листа не сходится')
  if (!Number.isInteger(sheet.productionSeconds) || sheet.productionSeconds < 0) throw new Error('Некорректное время резки')
  return { sourceWeightKg: source.sheetWeightKg, usefulKg, remnantKg, kerfKg, metalScrapKg, wasteBasisKg, wastePercent: (source.sheetWeightKg - usefulKg - remnantKg) / wasteBasisKg * 100, metalScrapPercent: metalScrapKg / wasteBasisKg * 100, usefulWithRemnantKg: roundKg(usefulKg + remnantKg), remnants }
}

export function calculateProNestPosition(sheets: ProNestSheet[]) {
  const rows = sheets.map(calculateProNestSheet)
  const sum = (key: 'sourceWeightKg' | 'usefulKg' | 'remnantKg' | 'kerfKg' | 'metalScrapKg' | 'wasteBasisKg') => roundKg(rows.reduce((n, row) => n + row[key], 0))
  const sourceWeightKg = sum('sourceWeightKg'), usefulKg = sum('usefulKg'), remnantKg = sum('remnantKg'), kerfKg = sum('kerfKg'), metalScrapKg = sum('metalScrapKg'), wasteBasisKg = sum('wasteBasisKg')
  const enteredSeconds = sheets.reduce((n, sheet) => n + sheet.productionSeconds, 0)
  return { sourceWeightKg, usefulKg, remnantKg, kerfKg, metalScrapKg, wasteBasisKg, usefulWithRemnantKg: roundKg(usefulKg + remnantKg), wastePercent: wasteBasisKg ? (metalScrapKg + kerfKg) / wasteBasisKg * 100 : 0, metalScrapPercent: wasteBasisKg ? metalScrapKg / wasteBasisKg * 100 : 0, enteredSeconds, actualSeconds: Math.ceil(enteredSeconds * 1.25), rows }
}

export function validateProNestForPosition(report: ProNestParsedReport, input: { quantity: number; sheetSize: string; thicknessMm: number | null; materialConfirmed: boolean }) {
  const issues = [...report.issues]
  const count = report.layouts.reduce((n, row) => n + row.timesCut, 0)
  if (count !== input.quantity) issues.push(`В позиции ${input.quantity} лист., в отчёте ${count} лист.`)
  const sides = rectangularDimensions(input.sheetSize)
  if (!sides || report.layouts.some(row => !([row.sheetWidthMm, row.sheetLengthMm].every((n, i) => Math.abs(n - sides[i]) <= 0.1) || [row.sheetLengthMm, row.sheetWidthMm].every((n, i) => Math.abs(n - sides[i]) <= 0.1)))) issues.push('Размер листа в отчёте не совпадает с позицией')
  if (!input.thicknessMm || report.layouts.some(row => Math.abs(row.thicknessMm - input.thicknessMm!) > 0.01)) issues.push('Толщина в отчёте не совпадает с позицией')
  if (!input.materialConfirmed) issues.push('Подтвердите соответствие материала и деталей заявке')
  return issues
}
