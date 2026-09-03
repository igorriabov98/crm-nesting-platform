export type InvoicePaymentPart = 'full' | 'prepayment' | 'final'

export type InvoicePaymentSchedule = {
  part: InvoicePaymentPart
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
  today?: string
}

function dateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

export function addCalendarDays(value: string, days: number) {
  const { year, month, day } = dateParts(value)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.trunc(days)))
  return date.toISOString().slice(0, 10)
}

export function todayDateOnly(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function money(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function deliveryDueDate(input: InvoiceScheduleInput, offsetDays: number) {
  if (input.deliveryToClientDate) {
    return {
      dueDate: addCalendarDays(input.deliveryToClientDate, offsetDays),
      isForecast: false,
      forecastBasis: 'actual_delivery' as const,
    }
  }

  const shippingDate = input.actualShippingDate || input.desiredShippingDate || null
  if (!shippingDate) return { dueDate: null, isForecast: true, forecastBasis: null }
  const estimatedDelivery = addCalendarDays(shippingDate, Number(input.estimatedDeliveryDays ?? 7))
  return {
    dueDate: addCalendarDays(estimatedDelivery, offsetDays),
    isForecast: true,
    forecastBasis: input.actualShippingDate ? 'actual_shipping' as const : 'planned_shipping' as const,
  }
}

export function buildInvoicePaymentSchedule(input: InvoiceScheduleInput): InvoicePaymentSchedule[] {
  const amount = money(Math.max(0, Number(input.amount || 0)))
  const paidAmount = money(Math.max(0, Number(input.paidAmount || 0)))
  const today = input.today || todayDateOnly()
  const termsType = input.paymentTermsType || 'invoice_days'
  const dueDays = Math.max(0, Math.trunc(Number(input.paymentDueDays ?? 0)))
  const finalDueDays = Math.max(0, Math.trunc(Number(input.finalPaymentDueDays ?? dueDays)))

  const rawParts = termsType === 'prepayment_full'
    ? (() => {
        const percent = Math.min(100, Math.max(0, Number(input.prepaymentPercent ?? 50)))
        const prepaymentAmount = money(amount * percent / 100)
        const finalAmount = money(Math.max(0, amount - prepaymentAmount))
        const finalDue = deliveryDueDate(input, finalDueDays)
        return [
          {
            part: 'prepayment' as const,
            label: `Предоплата ${percent}%`,
            amount: prepaymentAmount,
            dueDate: addCalendarDays(input.invoiceDate, dueDays),
            isForecast: false,
            forecastBasis: 'invoice' as const,
          },
          {
            part: 'final' as const,
            label: 'Окончательный платёж',
            amount: finalAmount,
            ...finalDue,
          },
        ]
      })()
    : termsType === 'delivery_days'
      ? [{
          part: 'full' as const,
          label: 'Полная оплата',
          amount,
          ...deliveryDueDate(input, dueDays),
        }]
      : [{
          part: 'full' as const,
          label: 'Полная оплата',
          amount,
          dueDate: addCalendarDays(input.invoiceDate, dueDays),
          isForecast: false,
          forecastBasis: 'invoice' as const,
        }]

  let allocated = paidAmount
  return rawParts
    .filter((part) => part.amount > 0)
    .map((part) => {
      const partPaid = money(Math.min(part.amount, allocated))
      allocated = money(Math.max(0, allocated - partPaid))
      const remainingAmount = money(Math.max(0, part.amount - partPaid))
      return {
        ...part,
        paidAmount: partPaid,
        remainingAmount,
        isOverdue: Boolean(part.dueDate && !part.isForecast && part.dueDate < today && remainingAmount > 0),
      }
    })
}

export function invoiceDisplayStatus(input: {
  amount: number
  paidAmount: number
  cancelled?: boolean
  schedule: InvoicePaymentSchedule[]
}) {
  if (input.cancelled) return 'cancelled' as const
  if (input.amount > 0 && input.paidAmount >= input.amount) return 'paid' as const
  if (input.schedule.some((part) => part.isOverdue)) return 'overdue' as const
  if (input.paidAmount > 0) return 'partially_paid' as const
  return 'not_paid' as const
}

export function nextPaymentSchedulePart(schedule: InvoicePaymentSchedule[]) {
  return schedule.find((part) => part.remainingAmount > 0) || null
}
