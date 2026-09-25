import type { MaterialCategory } from '@/lib/types'

/** Wire keeps its historical pipe storage and kg accounting, but belongs to Circle in the UI. */
export function displayMaterialCategory(
  category: MaterialCategory | null | undefined,
  pipeType: string | null | undefined,
  unit?: string | null,
): MaterialCategory | null {
  if (!category) return null
  return isWireMaterial(category, pipeType, unit) ? 'circle' : category
}

export function isWireMaterial(category: MaterialCategory | null | undefined, pipeType: string | null | undefined, unit?: string | null) {
  return category === 'pipe' && (pipeType === 'wire' || (!pipeType && unit === 'кг'))
}
