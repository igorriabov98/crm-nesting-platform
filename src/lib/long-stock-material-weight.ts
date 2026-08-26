import { knifeProfileDimensions } from '@/lib/materials/knife-profile'
import { pipeSectionDimensions, roundPipeOuterDiameterMm } from '@/lib/materials/pipe-profile'

export type LongStockWeightVariant = {
  category: string
  weight_per_m_kg: number | null
  diameter_mm: number | null
  pipe_type: string | null
  wall_thickness_mm: number | null
  piece_description: string | null
  knife_dimensions: string | null
  width_mm: number | null
  height_mm: number | null
}

export function calculateLongStockWeightPerMeterKg(
  variant: LongStockWeightVariant,
  densityKgMm3: number | null,
) {
  const explicitWeight = positiveNumber(variant.weight_per_m_kg)
  if (explicitWeight !== null) return explicitWeight

  const density = positiveNumber(densityKgMm3)
  if (density === null) return null

  const crossSectionMm2 = longStockCrossSectionMm2(variant)
  return crossSectionMm2 === null ? null : crossSectionMm2 * 1000 * density
}

export function calculateLongStockWeightForLength(
  requiredWeightKg: number | null,
  requiredLengthMm: number,
  targetLengthMm: number,
) {
  if (requiredWeightKg === null) return null
  if (!Number.isFinite(requiredWeightKg) || requiredWeightKg < 0) return null
  if (!Number.isFinite(requiredLengthMm) || requiredLengthMm <= 0) return null
  if (!Number.isFinite(targetLengthMm) || targetLengthMm < 0) return null
  return requiredWeightKg * targetLengthMm / requiredLengthMm
}

function longStockCrossSectionMm2(variant: LongStockWeightVariant) {
  if (variant.category === 'circle') {
    const diameter = positiveNumber(variant.diameter_mm)
    return diameter === null ? null : Math.PI * (diameter / 2) ** 2
  }

  if (variant.category === 'knives') {
    const { widthMm: width, heightMm: height } = knifeProfileDimensions(variant)
    return width === null || height === null ? null : width * height
  }

  if (variant.category !== 'pipe' || variant.pipe_type === 'wire') return null
  const wall = positiveNumber(variant.wall_thickness_mm)
  if (wall === null) return null

  if (variant.pipe_type === 'round') {
    const diameter = roundPipeOuterDiameterMm(variant)
    if (diameter === null || wall * 2 >= diameter) return null
    return Math.PI * ((diameter / 2) ** 2 - ((diameter - 2 * wall) / 2) ** 2)
  }

  const dimensions = pipeSectionDimensions(variant.piece_description)
  if (!dimensions) return null
  const [first, second] = dimensions
  const width = first
  const height = variant.pipe_type === 'square' ? first : second
  if (wall * 2 >= Math.min(width, height)) return null
  return width * height - (width - 2 * wall) * (height - 2 * wall)
}

function positiveNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
