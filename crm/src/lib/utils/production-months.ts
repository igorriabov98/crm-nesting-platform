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

export function getProductionMonthOptions(startDate = new Date(), monthsAhead = 6): ProductionMonthOption[] {
  return Array.from({ length: monthsAhead + 1 }, (_, index) => {
    const date = addMonths(startDate, index)
    const value = monthStartValue(date)

    return {
      value,
      label: format(new Date(value), 'LLLL yyyy', { locale: ru }),
    }
  })
}

export function formatProductionMonth(value: string) {
  return format(new Date(value), 'LLLL yyyy', { locale: ru })
}
