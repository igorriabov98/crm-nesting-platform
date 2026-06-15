import { addMonths, format } from 'date-fns'
import { ru } from 'date-fns/locale'

export type ProductionMonthOption = {
  value: string
  label: string
}

export function monthStartValue(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

export function normalizeProductionMonthValue(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null

  return `${year}-${String(month).padStart(2, '0')}-01`
}

function productionMonthDate(value: string) {
  const normalized = normalizeProductionMonthValue(value)
  if (!normalized) return new Date(value)

  const [year, month] = normalized.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

export function getProductionMonthOptions(startDate = new Date(), monthsAhead = 6): ProductionMonthOption[] {
  return Array.from({ length: monthsAhead + 1 }, (_, index) => {
    const date = addMonths(startDate, index)
    const value = monthStartValue(date)

    return {
      value,
      label: format(date, 'LLLL yyyy', { locale: ru }),
    }
  })
}

export function formatProductionMonth(value: string) {
  return format(productionMonthDate(value), 'LLLL yyyy', { locale: ru })
}
