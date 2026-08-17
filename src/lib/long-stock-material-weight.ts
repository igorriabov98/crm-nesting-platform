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

function longStockCrossSectionMm2(variant: LongStockWeightVariant) {
  if (variant.category === 'circle') {
    const diameter = positiveNumber(variant.diameter_mm)
    return diameter === null ? null : Math.PI * (diameter / 2) ** 2
  }

  if (variant.category === 'knives') {
    const dimensions = parseDimensions(variant.knife_dimensions)
    const width = positiveNumber(variant.width_mm) ?? dimensions?.[1] ?? null
    const height = positiveNumber(variant.height_mm) ?? dimensions?.[2] ?? null
    return width === null || height === null ? null : width * height
  }

  if (variant.category !== 'pipe' || variant.pipe_type === 'wire') return null
  const wall = positiveNumber(variant.wall_thickness_mm)
  if (wall === null) return null

  if (variant.pipe_type === 'round') {
    const diameter = positiveNumber(variant.diameter_mm) ?? positiveNumber(variant.piece_description)
    if (diameter === null || wall * 2 >= diameter) return null
    return Math.PI * ((diameter / 2) ** 2 - ((diameter - 2 * wall) / 2) ** 2)
  }

  const dimensions = parsePipeDimensions(variant.piece_description)
  if (!dimensions) return null
  const [first, second] = dimensions
  const width = first
  const height = variant.pipe_type === 'square' ? first : second
  if (wall * 2 >= Math.min(width, height)) return null
  return width * height - (width - 2 * wall) * (height - 2 * wall)
}

function parsePipeDimensions(value: string | null) {
  const dimensions = parseDimensions(value)
  return dimensions && dimensions.length >= 2
    ? [dimensions[0], dimensions[1]] as [number, number]
    : null
}

function parseDimensions(value: string | null) {
  const dimensions = String(value ?? '')
    .replace(/[хХ×*]/g, 'x')
    .split('x')
    .map((part) => positiveNumber(part.trim().replace(',', '.')))
  return dimensions.length > 0 && dimensions.every((part) => part !== null)
    ? dimensions as number[]
    : null
}

function positiveNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
