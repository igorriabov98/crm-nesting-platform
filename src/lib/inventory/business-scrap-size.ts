import type { MaterialCategory } from '@/lib/types'

export type LongStockLayoutCategoryKey = 'circle' | 'pipe' | 'knife_bevel_1' | 'knife_bevel_2'
export type BusinessScrapSizeClass = 'useful' | 'small'

export function getLongStockLayoutCategoryKey(input: {
  category: MaterialCategory | null | undefined
  pipeType?: string | null
  knifeBevelCount?: number | null
}): LongStockLayoutCategoryKey | null {
  if (input.category === 'circle') return 'circle'
  if (input.category === 'pipe' && input.pipeType !== 'wire') return 'pipe'
  if (input.category === 'knives' && input.knifeBevelCount === 1) return 'knife_bevel_1'
  if (input.category === 'knives' && input.knifeBevelCount === 2) return 'knife_bevel_2'
  return null
}

export function classifyBusinessScrapLength(
  pieceLengthMm: number | null | undefined,
  minimumUsefulLengthMm: number | null | undefined,
): BusinessScrapSizeClass | null {
  if (pieceLengthMm === null || pieceLengthMm === undefined || !Number.isFinite(pieceLengthMm) || pieceLengthMm <= 0) {
    return null
  }
  if (minimumUsefulLengthMm === null
    || minimumUsefulLengthMm === undefined
    || !Number.isFinite(minimumUsefulLengthMm)
    || minimumUsefulLengthMm < 0) {
    return null
  }
  return pieceLengthMm < minimumUsefulLengthMm ? 'small' : 'useful'
}
