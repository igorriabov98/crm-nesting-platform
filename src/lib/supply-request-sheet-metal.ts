import type { MaterialVariant } from '@/lib/types'

type SheetMetalCharacteristics = {
  steel_type_id?: unknown
  sheet_size?: unknown
  thickness_mm?: unknown
}

function normalizeSheetSize(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u0445\u00d7*]/g, 'x')
    .replace(/\s+/g, '')
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
    && normalizeSheetSize(row.sheet_size) === normalizeSheetSize(variant.sheet_size)
    && numbersMatch(row.thickness_mm, variant.thickness_mm)
}
