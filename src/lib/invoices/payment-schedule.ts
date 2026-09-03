import { normalizeScheduledDays } from '@/lib/payments/terms'

export type InvoicePaymentPart = 'full' | 'prepayment' | 'final' | 'scheduled' | 'scheduled_overdue'
export type ScheduledPaymentAmountMode = 'full_balance' | 'fixed_amount'

export type InvoicePaymentSchedule = {
  key: string
  part: InvoicePaymentPart
  sequence: number | null
  label: string
  amount: number
  paidAmount: number
  remainingAmount: number
  dueDate: string | null
  isForecast: boolean
  isOverdue: boolean
  forecastBasis: 'actual_delivery' | 'actual_shipping' | 'planned_shipping' | 'invoice' | null
}

export type InvoiceScheduleInput = {
  amount: number
  paidAmount: number
  invoiceDate: string
  paymentTermsType?: string | null
  paymentDueDays?: number | null
  prepaymentPercent?: number | null
  finalPaymentDueDays?: number | null
  estimatedDeliveryDays?: number | null
  deliveryToClientDate?: string | null
  actualShippingDate?: string | null
  desiredShippingDate?: string | null
  scheduledPaymentWeekdays?: number[] | null
  scheduledPaymentMonthDays?: number[] | null
  scheduledPaymentAmountMode?: string | null
  scheduledPaymentMinimumAmount?: number | null
  scheduleRangeStart?: string | null
  scheduleRangeEnd?: string | null
  scheduledFutureLimit?: number
  today?: string
}

function dateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

function utcDate(value: string) {
  const { year, month, day } = dateParts(value)
  return new Date(Date.UTC(year, month - 1, day))
}

export function addCalendarDays(value: string, days: number) {
  const date = utcDate(value)
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.trunc(days)))
  return date.toISOString().slice(0, 10)
}

export function todayDateOnly(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Uzhgorod',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function money(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function isoWeekday(value: string) {
  const weekday = utcDate(value).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

function monthLastDay(value: string) {
  const { year, month } = dateParts(value)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function nextScheduledPaymentDate(
  afterDate: string,
  weekdays: number[] | null | undefined,
  monthDays: number[] | null | undefined,
) {
  const normalizedWeekdays = normalizeScheduledDays(weekdays, 1, 7)
  const normalizedMonthDays = normalizeScheduledDays(monthDays, 1, 31)
  if (normalizedWeekdays.length + normalizedMonthDays.length === 0) return null

  for (let offset = 1; offset <= 370; offset += 1) {
    const candidate = addCalendarDays(afterDate, offset)
    const day = dateParts(candidate).day
    const lastDay = monthLastDay(candidate)
    if (
      normalizedWeekdays.includes(isoWeekday(candidate))
      || normalizedMonthDays.some((selectedDay) => Math.min(selectedDay, lastDay) === day)
    ) {
      return candidate
    }
  }
  return null
}

function deliveryAnchor(input: InvoiceScheduleInput) {
  if (input.deliveryToClientDate) {
    return { date: input.deliveryToClientDate, isForecast: false, forecastBasis: 'actual_delivery' as const }
  }
  const shippingDate = input.actualShippingDate || input.desiredShippingDate || null
  if (!shippingDate) return { date: null, isForecast: true, forecastBasis: null }
  return {
    date: addCalendarDays(shippingDate, Number(input.estimatedDeliveryDays ?? 7)),
    isForecast: true,
    forecastBasis: input.actualShippingDate ? 'actual_shipping' as const : 'planned_shipping' as const,
  }
}

function deliveryDueDate(input: InvoiceScheduleInput, offsetDays: number) {
  const anchor = deliveryAnchor(input)
  return {
    dueDate: anchor.date ? addCalendarDays(anchor.date, offsetDays) : null,
    isForecast: anchor.isForecast,
    forecastBasis: anchor.forecastBasis,
  }
}

function schedulePart(
  part: Omit<InvoicePaymentSchedule, 'paidAmount' | 'remainingAmount' | 'isOverdue'>,
  paidAmount: number,
  today: string,
): InvoicePaymentSchedule {
  const partPaid = money(Math.min(part.amount, Math.max(0, paidAmount)))
  const remainingAmount = money(Math.max(0, part.amount - partPaid))
  return {
    ...part,
    paidAmount: partPaid,
    remainingAmount,
    isOverdue: Boolean(part.dueDate && !part.isForecast && part.dueDate < today && remainingAmount > 0),
  }
}

function installmentAmount(amount: number, minimumAmount: number, sequence: number) {
  return money(Math.max(0, Math.min(minimumAmount, amount - minimumAmount * (sequence - 1))))
}

function paidForInstallment(paidAmount: number, minimumAmount: number, sequence: number, partAmount: number) {
  return money(Math.min(partAmount, Math.max(0, paidAmount - minimumAmount * (sequence - 1))))
}

function dateAtSequence(anchor: string, weekdays: number[], monthDays: number[], targetSequence: number) {
  let date = anchor
  for (let sequence = 1; sequence <= Math.min(targetSequence, 10000); sequence += 1) {
    const next = nextScheduledPaymentDate(date, weekdays, monthDays)
    if (!next) return null
    date = next
  }
  return targetSequence > 10000 ? null : date
}

function buildScheduledRange(
  input: InvoiceScheduleInput,
  anchor: string,
  isForecast: boolean,
  forecastBasis: InvoicePaymentSchedule['forecastBasis'],
  amount: number,
  paidAmount: number,
  minimumAmount: number,
  totalParts: number,
  weekdays: number[],
  monthDays: number[],
  today: string,
) {
  const start = input.scheduleRangeStart || '0000-01-01'
  const end = input.scheduleRangeEnd || '9999-12-31'
  const result: InvoicePaymentSchedule[] = []
  let date = anchor

  for (let sequence = 1; sequence <= Math.min(totalParts, 10000); sequence += 1) {
    const next = nextScheduledPaymentDate(date, weekdays, monthDays)
    if (!next || next > end) break
    date = next
    if (next < start) continue
    const partAmount = installmentAmount(amount, minimumAmount, sequence)
    result.push(schedulePart({
      key: `scheduled-${sequence}`,
      part: 'scheduled',
      sequence,
      label: `Платёж по расписанию №${sequence}`,
      amount: partAmount,
      dueDate: next,
      isForecast,
      forecastBasis,
    }, paidForInstallment(paidAmount, minimumAmount, sequence, partAmount), today))
  }
  return result
}

function buildScheduledSummary(
  input: InvoiceScheduleInput,
  anchor: string,
  isForecast: boolean,
  forecastBasis: InvoicePaymentSchedule['forecastBasis'],
  amount: number,
  paidAmount: number,
  minimumAmount: number,
  totalParts: number,
  weekdays: number[],
  monthDays: number[],
  today: string,
) {
  const result: InvoicePaymentSchedule[] = []
  let pastCount = 0
  let date = anchor

  if (!isForecast) {
    for (let sequence = 1; sequence <= Math.min(totalParts, 10000); sequence += 1) {
      const next = nextScheduledPaymentDate(date, weekdays, monthDays)
      if (!next || next >= today) break
      date = next
      pastCount = sequence
    }
  }

  const expectedByToday = money(Math.min(amount, pastCount * minimumAmount))
  const overdueAmount = money(Math.max(0, expectedByToday - paidAmount))
  if (overdueAmount > 0) {
    const firstUncoveredSequence = Math.min(pastCount, Math.floor(paidAmount / minimumAmount) + 1)
    result.push({
      key: `scheduled-overdue-${firstUncoveredSequence}-${pastCount}`,
      part: 'scheduled_overdue',
      sequence: firstUncoveredSequence,
      label: pastCount === firstUncoveredSequence ? 'Просроченный платёж' : `Просроченные платежи (${pastCount - firstUncoveredSequence + 1})`,
      amount: expectedByToday,
      paidAmount: money(Math.min(paidAmount, expectedByToday)),
      remainingAmount: overdueAmount,
      dueDate: dateAtSequence(anchor, weekdays, monthDays, firstUncoveredSequence),
      isForecast: false,
      isOverdue: true,
      forecastBasis,
    })
  }

  const firstUnpaidSequence = Math.floor(paidAmount / minimumAmount) + 1
  let sequence = Math.max(pastCount + 1, firstUnpaidSequence)
  const futureLimit = Math.max(1, Math.min(24, Math.trunc(input.scheduledFutureLimit ?? 6)))
  let addedFutureParts = 0
  while (sequence <= totalParts && addedFutureParts < futureLimit) {
    const dueDate = dateAtSequence(anchor, weekdays, monthDays, sequence)
    if (!dueDate) break
    const partAmount = installmentAmount(amount, minimumAmount, sequence)
    result.push(schedulePart({
      key: `scheduled-${sequence}`,
      part: 'scheduled',
      sequence,
      label: `Платёж по расписанию №${sequence}`,
      amount: partAmount,
      dueDate,
      isForecast,
      forecastBasis,
    }, paidForInstallment(paidAmount, minimumAmount, sequence, partAmount), today))
    sequence += 1
    addedFutureParts += 1
  }
  return result
}

function buildScheduledPaymentSchedule(input: InvoiceScheduleInput, amount: number, paidAmount: number, today: string) {
  const anchor = deliveryAnchor(input)
  const weekdays = normalizeScheduledDays(input.scheduledPaymentWeekdays, 1, 7)
  const monthDays = normalizeScheduledDays(input.scheduledPaymentMonthDays, 1, 31)
  const mode: ScheduledPaymentAmountMode = input.scheduledPaymentAmountMode === 'fixed_amount' ? 'fixed_amount' : 'full_balance'

  if (!anchor.date || weekdays.length + monthDays.length === 0) {
    return [schedulePart({
      key: 'scheduled-missing-date',
      part: 'scheduled',
      sequence: 1,
      label: 'Оплата по расписанию',
      amount,
      dueDate: null,
      isForecast: true,
      forecastBasis: anchor.forecastBasis,
    }, paidAmount, today)]
  }

  if (mode === 'full_balance') {
    const dueDate = nextScheduledPaymentDate(anchor.date, weekdays, monthDays)
    const part = schedulePart({
      key: 'scheduled-1',
      part: 'scheduled',
      sequence: 1,
      label: 'Полная оплата по расписанию',
      amount,
      dueDate,
      isForecast: anchor.isForecast,
      forecastBasis: anchor.forecastBasis,
    }, paidAmount, today)
    if (input.scheduleRangeStart && dueDate && dueDate < input.scheduleRangeStart) return []
    if (input.scheduleRangeEnd && dueDate && dueDate > input.scheduleRangeEnd) return []
    return [part]
  }

  const configuredMinimumAmount = Number(input.scheduledPaymentMinimumAmount || 0)
  if (!Number.isFinite(configuredMinimumAmount) || configuredMinimumAmount <= 0) {
    return [schedulePart({
      key: 'scheduled-missing-amount',
      part: 'scheduled',
      sequence: 1,
      label: 'Укажите минимальную сумму оплаты',
      amount,
      dueDate: null,
      isForecast: anchor.isForecast,
      forecastBasis: anchor.forecastBasis,
    }, paidAmount, today)]
  }
  const minimumAmount = money(configuredMinimumAmount)
  const totalParts = Math.ceil(amount / minimumAmount)
  if (input.scheduleRangeStart || input.scheduleRangeEnd) {
    return buildScheduledRange(input, anchor.date, anchor.isForecast, anchor.forecastBasis, amount, paidAmount, minimumAmount, totalParts, weekdays, monthDays, today)
  }
  return buildScheduledSummary(input, anchor.date, anchor.isForecast, anchor.forecastBasis, amount, paidAmount, minimumAmount, totalParts, weekdays, monthDays, today)
}

export function buildInvoicePaymentSchedule(input: InvoiceScheduleInput): InvoicePaymentSchedule[] {
  const amount = money(Math.max(0, Number(input.amount || 0)))
  const paidAmount = money(Math.max(0, Number(input.paidAmount || 0)))
  const today = input.today || todayDateOnly()
  const termsType = input.paymentTermsType || 'invoice_days'
  const dueDays = Math.max(0, Math.trunc(Number(input.paymentDueDays ?? 0)))
  const finalDueDays = Math.max(0, Math.trunc(Number(input.finalPaymentDueDays ?? dueDays)))

  if (termsType === 'scheduled_after_delivery') return buildScheduledPaymentSchedule(input, amount, paidAmount, today)

  const rawParts = termsType === 'prepayment_full'
    ? (() => {
        const percent = Math.min(100, Math.max(0, Number(input.prepaymentPercent ?? 50)))
        const prepaymentAmount = money(amount * percent / 100)
        const finalAmount = money(Math.max(0, amount - prepaymentAmount))
        const finalDue = deliveryDueDate(input, finalDueDays)
        return [
          { key: 'prepayment', part: 'prepayment' as const, sequence: null, label: `Предоплата ${percent}%`, amount: prepaymentAmount, dueDate: addCalendarDays(input.invoiceDate, dueDays), isForecast: false, forecastBasis: 'invoice' as const },
          { key: 'final', part: 'final' as const, sequence: null, label: 'Окончательный платёж', amount: finalAmount, ...finalDue },
        ]
      })()
    : termsType === 'delivery_days'
      ? [{ key: 'full', part: 'full' as const, sequence: null, label: 'Полная оплата', amount, ...deliveryDueDate(input, dueDays) }]
      : [{ key: 'full', part: 'full' as const, sequence: null, label: 'Полная оплата', amount, dueDate: addCalendarDays(input.invoiceDate, dueDays), isForecast: false, forecastBasis: 'invoice' as const }]

  let allocated = paidAmount
  return rawParts.filter((part) => part.amount > 0).map((part) => {
    const result = schedulePart(part, allocated, today)
    allocated = money(Math.max(0, allocated - result.paidAmount))
    return result
  })
}

export function invoiceDisplayStatus(input: { amount: number; paidAmount: number; cancelled?: boolean; schedule: InvoicePaymentSchedule[] }) {
  if (input.cancelled) return 'cancelled' as const
  if (input.amount > 0 && input.paidAmount >= input.amount) return 'paid' as const
  if (input.schedule.some((part) => part.isOverdue)) return 'overdue' as const
  if (input.paidAmount > 0) return 'partially_paid' as const
  return 'not_paid' as const
}

export function nextPaymentSchedulePart(schedule: InvoicePaymentSchedule[]) {
  return schedule.find((part) => part.remainingAmount > 0) || null
}
