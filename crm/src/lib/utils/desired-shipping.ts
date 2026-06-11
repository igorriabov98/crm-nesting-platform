import { differenceInCalendarDays, format, startOfToday } from 'date-fns'

export function formatDesiredShippingDate(date: string | null | undefined, pattern = 'dd.MM.yyyy') {
  if (!date) return null
  return format(new Date(date), pattern)
}

export function getDesiredShippingInfo(date: string | null | undefined) {
  if (!date) return null

  const target = new Date(date)
  const days = differenceInCalendarDays(target, startOfToday())

  if (days < 0) {
    return {
      date: format(target, 'dd.MM.yyyy'),
      shortDate: format(target, 'dd.MM'),
      days,
      tone: 'overdue' as const,
      label: `просрочено на ${Math.abs(days)} дн.`,
    }
  }

  return {
    date: format(target, 'dd.MM.yyyy'),
    shortDate: format(target, 'dd.MM'),
    days,
    tone: days <= 7 ? ('soon' as const) : ('normal' as const),
    label: days === 0 ? 'сегодня' : `осталось ${days} дн.`,
  }
}
