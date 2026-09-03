import type { PaymentTermsType, ScheduledPaymentAmountMode } from '@/lib/types'

export const PAYMENT_TERMS_TYPE_LABELS: Record<PaymentTermsType, string> = {
  invoice_days: 'От даты инвойса',
  delivery_days: 'От даты доставки',
  prepayment_full: 'Предоплата + полная оплата',
  scheduled_after_delivery: 'По расписанию после доставки',
}

export const SCHEDULED_PAYMENT_AMOUNT_MODE_LABELS: Record<ScheduledPaymentAmountMode, string> = {
  full_balance: 'Весь остаток',
  fixed_amount: 'Минимальная сумма',
}

export const SCHEDULED_WEEKDAYS = [
  { value: 1, shortLabel: 'Пн', label: 'Понедельник' },
  { value: 2, shortLabel: 'Вт', label: 'Вторник' },
  { value: 3, shortLabel: 'Ср', label: 'Среда' },
  { value: 4, shortLabel: 'Чт', label: 'Четверг' },
  { value: 5, shortLabel: 'Пт', label: 'Пятница' },
  { value: 6, shortLabel: 'Сб', label: 'Суббота' },
  { value: 7, shortLabel: 'Вс', label: 'Воскресенье' },
] as const

const euro = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR' })

export type PaymentTermsDescriptionInput = {
  type: string
  days?: number | null
  prepaymentPercent?: number | null
  finalDays?: number | null
  scheduledWeekdays?: number[] | null
  scheduledMonthDays?: number[] | null
  scheduledAmountMode?: string | null
  scheduledMinimumAmount?: number | null
}

export function normalizeScheduledDays(values: number[] | null | undefined, min: number, max: number) {
  return Array.from(new Set((values || []).map(Number).filter((value) => Number.isInteger(value) && value >= min && value <= max)))
    .sort((left, right) => left - right)
}

export function scheduledPaymentDatesLabel(weekdays?: number[] | null, monthDays?: number[] | null) {
  const normalizedWeekdays = normalizeScheduledDays(weekdays, 1, 7)
  const normalizedMonthDays = normalizeScheduledDays(monthDays, 1, 31)
  const parts: string[] = []
  if (normalizedWeekdays.length > 0) {
    parts.push(normalizedWeekdays.map((day) => SCHEDULED_WEEKDAYS.find((item) => item.value === day)?.shortLabel).filter(Boolean).join(', '))
  }
  if (normalizedMonthDays.length > 0) {
    parts.push(`числа месяца: ${normalizedMonthDays.join(', ')}`)
  }
  return parts.join('; ') || 'дни не выбраны'
}

export function paymentTermsLabel(input: PaymentTermsDescriptionInput) {
  const days = Number(input.days || 0)
  if (input.type === 'delivery_days') return `Через ${days} дн. от доставки клиенту`
  if (input.type === 'prepayment_full') {
    return `Предоплата ${input.prepaymentPercent ?? 50}%, остаток через ${input.finalDays ?? days} дн. от доставки`
  }
  if (input.type === 'scheduled_after_delivery') {
    const dates = scheduledPaymentDatesLabel(input.scheduledWeekdays, input.scheduledMonthDays)
    const amount = input.scheduledAmountMode === 'fixed_amount'
      ? `не менее ${euro.format(Number(input.scheduledMinimumAmount || 0))} на каждую дату`
      : 'весь остаток в первую дату'
    return `После доставки: ${dates}; ${amount}`
  }
  return `Через ${days} дн. от даты инвойса`
}
