import type { MaterialVariant } from '@/lib/types'
import { sameRectangularDimensions } from '@/lib/materials/rotatable-dimensions'

type SheetMetalCharacteristics = {
  steel_type_id?: unknown
  sheet_size?: unknown
  thickness_mm?: unknown
}

function numbersMatch(left: unknown, right: unknown) {
  const a = Number(left ?? 0)
  const b = Number(right ?? 0)
  if (!a && !b) return true
  return Math.abs(a - b) < 0.001
}

export function sheetMetalVariantMatchesRequest(
  row: SheetMetalCharacteristics,
  variant: Pick<MaterialVariant, 'steel_type_id' | 'sheet_size' | 'thickness_mm'>,
) {
  const requestSteelTypeId = String(row.steel_type_id ?? '').trim()
  const variantSteelTypeId = String(variant.steel_type_id ?? '').trim()
  return Boolean(requestSteelTypeId)
    && requestSteelTypeId === variantSteelTypeId
    && Number(row.thickness_mm) > 0
    && Number(variant.thickness_mm) > 0
    && sameRectangularDimensions(row.sheet_size, variant.sheet_size)
    && numbersMatch(row.thickness_mm, variant.thickness_mm)
}

export function sheetBusinessScrapMatchesRequest(
  row: SheetMetalCharacteristics,
  variant: Pick<MaterialVariant, 'category' | 'steel_type_id' | 'thickness_mm'>,
) {
  const steelTypeId = String(row.steel_type_id ?? '').trim()
  return variant.category === 'sheet_metal'
    && Boolean(steelTypeId)
    && steelTypeId === String(variant.steel_type_id ?? '').trim()
    && Number(row.thickness_mm) > 0
    && Number(variant.thickness_mm) > 0
    && numbersMatch(row.thickness_mm, variant.thickness_mm)
}
