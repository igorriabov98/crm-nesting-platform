export const METAL_SCRAP_PAGE_SIZE = 25

export const METAL_SCRAP_STATUSES = ['future', 'available', 'review_required'] as const

export type MetalScrapStatus = typeof METAL_SCRAP_STATUSES[number]

const METAL_SCRAP_MATERIAL_LABELS: Record<string, string> = {
  square: 'Труба квадратная',
  rectangular: 'Труба прямоугольная',
  round: 'Труба круглая',
  wire: 'Проволока',
}

export function normalizeMetalScrapStatus(value: string | null | undefined, fallback: MetalScrapStatus = 'available') {
  return METAL_SCRAP_STATUSES.includes(value as MetalScrapStatus) ? value as MetalScrapStatus : fallback
}

export function formatMetalScrapMaterialName(value: string) {
  const normalized = value.trim().toLowerCase()
  return METAL_SCRAP_MATERIAL_LABELS[normalized] || value
}

export function normalizeMetalScrapPage(page: number) {
  return Number.isInteger(page) && page >= 0 ? page : 0
}

export function formatFactoryDateInput(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function isMetalScrapSaleWeightValid(rawValue: string, availableWeightKg: number) {
  if (rawValue.trim() === '') return true
  const value = Number(rawValue)
  return Number.isFinite(value) && value > 0 && value <= availableWeightKg
}

export function metalScrapReviewNeedsReason(actualWeightKg: number, expectedWeightKg: number) {
  return Number.isFinite(actualWeightKg) && Math.abs(actualWeightKg - expectedWeightKg) > 0.0005
}
