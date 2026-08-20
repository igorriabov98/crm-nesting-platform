import { PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'

export const LONG_STOCK_CUTTING_PLAN_PDF_BUCKET = 'product-files'
export const LONG_STOCK_CUTTING_PLAN_PDF_SCHEMA_VERSION = 1

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const OBJECT_PATH_PATTERN = new RegExp(`^long-stock-cutting-plans/(${UUID_PATTERN})/(${UUID_PATTERN})/(${UUID_PATTERN})\\.pdf$`, 'u')

export type LongStockCuttingPlanPdfMetadata = {
  schema_version: 1
  bucket_id: typeof LONG_STOCK_CUTTING_PLAN_PDF_BUCKET
  object_path: string
  file_name: string
  mime_type: 'application/pdf'
  size_bytes: number
  sha256: string
  generated_by: string
  generated_at: string
}

export type LongStockCuttingPlanPdfCut = {
  cutNumber: number
  lengthMm: number
}

export type LongStockCuttingPlanPdfBar = {
  barNumber: number
  stockLengthMm: number
  cuts: LongStockCuttingPlanPdfCut[]
  remainderMm: number
}

export type LongStockCuttingPlanPdfData = {
  planNumber: number
  versionNumber: number
  generatedAt: string
  requestNumber: number
  factoryName: string
  technologistName: string
  materialName: string
  materialVariantLabel: string
  metalType: string
  knifeBevel: string | null
  kerfMm: number
  endTrimMm: number
  bars: LongStockCuttingPlanPdfBar[]
  totals: Array<{ lengthMm: number; quantity: number }>
}

export type LongStockMaterialVariantDescriptor = {
  category: string
  material_grade: string | null
  knife_material: string | null
  knife_bevel_count: number | null
  knife_dimensions: string | null
  standard_length_mm: number | null
  width_mm: number | null
  height_mm: number | null
  diameter_mm: number | null
  is_calibrated: boolean | null
  pipe_type: string | null
  piece_description: string | null
  wall_thickness_mm: number | null
}

export function longStockCuttingPlanPdfObjectPath(
  planId: string,
  versionId: string,
  artifactId: string,
) {
  return `long-stock-cutting-plans/${planId}/${versionId}/${artifactId}.pdf`
}

export function longStockCuttingPlanPdfFileName(planNumber: number, versionNumber: number) {
  return `cutting-plan-${planNumber}-v${versionNumber}.pdf`
}

export function parseLongStockCuttingPlanPdfMetadata(
  value: unknown,
  expected?: { planId?: string; versionId?: string },
): LongStockCuttingPlanPdfMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.schema_version !== LONG_STOCK_CUTTING_PLAN_PDF_SCHEMA_VERSION
    || row.bucket_id !== LONG_STOCK_CUTTING_PLAN_PDF_BUCKET
    || row.mime_type !== 'application/pdf') return null

  const objectPath = String(row.object_path ?? '')
  const pathMatch = objectPath.match(OBJECT_PATH_PATTERN)
  const fileName = String(row.file_name ?? '')
  const sizeBytes = Number(row.size_bytes)
  const sha256 = String(row.sha256 ?? '')
  const generatedBy = String(row.generated_by ?? '')
  const generatedAt = String(row.generated_at ?? '')
  if (!pathMatch
    || (expected?.planId && pathMatch[1] !== expected.planId)
    || (expected?.versionId && pathMatch[2] !== expected.versionId)
    || !/^cutting-plan-[1-9][0-9]*-v[1-9][0-9]*\.pdf$/u.test(fileName)
    || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0
    || !/^[0-9a-f]{64}$/u.test(sha256)
    || !new RegExp(`^${UUID_PATTERN}$`, 'u').test(generatedBy)
    || !Number.isFinite(Date.parse(generatedAt))) return null

  return {
    schema_version: 1,
    bucket_id: LONG_STOCK_CUTTING_PLAN_PDF_BUCKET,
    object_path: objectPath,
    file_name: fileName,
    mime_type: 'application/pdf',
    size_bytes: sizeBytes,
    sha256,
    generated_by: generatedBy,
    generated_at: generatedAt,
  }
}

export function longStockCuttingPlanPdfDecision(
  status: string,
  pdfMetadata: unknown,
  expected?: { planId?: string; versionId?: string },
) {
  if (status === 'invalid') return { kind: 'unavailable' as const, reason: 'recalculation_required' as const }
  const metadata = parseLongStockCuttingPlanPdfMetadata(pdfMetadata, expected)
  if (status === 'approved' && metadata) return { kind: 'stored' as const, metadata }
  if (status === 'draft' || status === 'approved') return { kind: 'generate' as const }
  return { kind: 'unavailable' as const, reason: 'not_approved' as const }
}

export function calculateLongStockPdfRemainder(
  stockLengthMm: number,
  cuts: Array<{ lengthMm: number }>,
  kerfMm: number,
  endTrimMm: number,
) {
  return stockLengthMm
    - endTrimMm
    - cuts.reduce((sum, cut) => sum + cut.lengthMm, 0)
    - cuts.length * kerfMm
}

export function summarizeLongStockPdfCuts(bars: LongStockCuttingPlanPdfBar[]) {
  const counts = new Map<number, number>()
  for (const bar of bars) {
    for (const cut of bar.cuts) counts.set(cut.lengthMm, (counts.get(cut.lengthMm) ?? 0) + 1)
  }
  return Array.from(counts, ([lengthMm, quantity]) => ({ lengthMm, quantity }))
    .sort((left, right) => right.lengthMm - left.lengthMm)
}

export function longStockBarComposition(bars: LongStockCuttingPlanPdfBar[]) {
  const counts = new Map<number, number>()
  for (const bar of bars) counts.set(bar.stockLengthMm, (counts.get(bar.stockLengthMm) ?? 0) + 1)
  return Array.from(counts, ([lengthMm, quantity]) => ({ lengthMm, quantity }))
    .sort((left, right) => right.lengthMm - left.lengthMm)
}

export function formatLongStockMaterialVariant(
  variant: LongStockMaterialVariantDescriptor,
) {
  if (variant.category === 'circle') {
    return [
      variant.diameter_mm && `Ø${formatPdfNumber(variant.diameter_mm)} мм`,
      variant.is_calibrated ? 'калиброванный' : null,
    ].filter(Boolean).join(' · ') || 'Точный вариант'
  }
  if (variant.category === 'pipe') {
    return [
      variant.pipe_type ? PIPE_SUBTYPE_LABELS[variant.pipe_type] ?? variant.pipe_type : null,
      variant.piece_description,
      variant.wall_thickness_mm && `стенка ${formatPdfNumber(variant.wall_thickness_mm)} мм`,
    ].filter(Boolean).join(' · ') || 'Точный вариант'
  }
  if (variant.category === 'knives') {
    const dimensions = variant.knife_dimensions
      || [variant.standard_length_mm, variant.width_mm, variant.height_mm]
        .filter((value) => Number(value) > 0)
        .map((value) => formatPdfNumber(Number(value)))
        .join('×')
    return dimensions || 'Точный вариант'
  }
  return 'Точный вариант'
}

export function formatPdfNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
}
