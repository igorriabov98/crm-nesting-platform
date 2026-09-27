import type { MaterialCategory } from '@/lib/types'

export const HISTORY_METAL_CATEGORIES = ['sheet_metal', 'knives', 'circle', 'pipe'] as const satisfies readonly MaterialCategory[]
export const HISTORY_SUMMARY_CATEGORIES = [...HISTORY_METAL_CATEGORIES, 'paint'] as const satisfies readonly MaterialCategory[]

const metalCategories = new Set<MaterialCategory>(HISTORY_METAL_CATEGORIES)

export function isHistoryMetalCategory(category: MaterialCategory): boolean {
  return metalCategories.has(category)
}

export function historyStockWeightKg(
  category: MaterialCategory,
  stock: { calculated_weight_kg: number | null; total_quantity: number; unit: string },
): number {
  const calculated = Number(stock.calculated_weight_kg)
  if (Number.isFinite(calculated) && calculated > 0) return calculated
  if (category === 'paint' && ['кг', 'kg'].includes(stock.unit.trim().toLowerCase())) {
    const quantity = Number(stock.total_quantity)
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
  }
  return 0
}

export type WeightTrendPoint = { date: string; weightKg: number; deltaWeightKg: number }

export type WeightWeek = {
  from: string
  to: string
  deltaWeightKg: number
  closingWeightKg: number
  days: WeightTrendPoint[]
}

/** The dates are UTC day keys. Partial boundary weeks contain only selected days. */
export function groupWeightTrendByWeek(points: WeightTrendPoint[]): WeightWeek[] {
  const weeks: WeightWeek[] = []
  for (const point of points) {
    const date = new Date(`${point.date}T00:00:00.000Z`)
    const monday = new Date(date)
    monday.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
    const weekKey = monday.toISOString().slice(0, 10)
    const last = weeks.at(-1)
    if (last && last.days.length && weekKey === mondayOf(last.from)) {
      last.to = point.date
      last.deltaWeightKg += point.deltaWeightKg
      last.closingWeightKg = point.weightKg
      last.days.push(point)
    } else {
      weeks.push({
        from: point.date,
        to: point.date,
        deltaWeightKg: point.deltaWeightKg,
        closingWeightKg: point.weightKg,
        days: [point],
      })
    }
  }
  return weeks
}

function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7)
  return date.toISOString().slice(0, 10)
}
