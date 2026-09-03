import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addCalendarDays, buildInvoicePaymentSchedule, invoiceDisplayStatus } from './payment-schedule'

const base = {
  amount: 1_000,
  paidAmount: 0,
  invoiceDate: '2026-09-03',
  today: '2026-09-20',
}

test('invoice-days terms use the immutable invoice date', () => {
  const schedule = buildInvoicePaymentSchedule({ ...base, paymentTermsType: 'invoice_days', paymentDueDays: 14 })
  assert.equal(schedule.length, 1)
  assert.equal(schedule[0].dueDate, '2026-09-17')
  assert.equal(schedule[0].isForecast, false)
  assert.equal(schedule[0].isOverdue, true)
})

test('delivery terms become exact only after actual client delivery', () => {
  const exact = buildInvoicePaymentSchedule({
    ...base,
    paymentTermsType: 'delivery_days',
    paymentDueDays: 10,
    deliveryToClientDate: '2026-09-08',
  })
  assert.equal(exact[0].dueDate, '2026-09-18')
  assert.equal(exact[0].isForecast, false)
  assert.equal(exact[0].isOverdue, true)

  const forecast = buildInvoicePaymentSchedule({
    ...base,
    paymentTermsType: 'delivery_days',
    paymentDueDays: 10,
    actualShippingDate: '2026-09-05',
    estimatedDeliveryDays: 7,
  })
  assert.equal(forecast[0].dueDate, '2026-09-22')
  assert.equal(forecast[0].isForecast, true)
  assert.equal(forecast[0].forecastBasis, 'actual_shipping')
  assert.equal(forecast[0].isOverdue, false, 'Прогноз не создаёт официальную просрочку')
})

test('delivery forecast falls back to planned shipping and preserves missing forecast data', () => {
  const planned = buildInvoicePaymentSchedule({
    ...base,
    paymentTermsType: 'delivery_days',
    paymentDueDays: 5,
    desiredShippingDate: '2026-09-10',
    estimatedDeliveryDays: 9,
  })
  assert.equal(planned[0].dueDate, '2026-09-24')
  assert.equal(planned[0].forecastBasis, 'planned_shipping')

  const missing = buildInvoicePaymentSchedule({ ...base, paymentTermsType: 'delivery_days', paymentDueDays: 5 })
  assert.equal(missing[0].dueDate, null)
  assert.equal(missing[0].isForecast, true)
  assert.equal(missing[0].isOverdue, false)
})

test('prepayment schedule allocates partial payments in FIFO order', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    paidAmount: 650,
    paymentTermsType: 'prepayment_full',
    paymentDueDays: 3,
    prepaymentPercent: 40,
    finalPaymentDueDays: 12,
    deliveryToClientDate: '2026-09-10',
  })
  assert.deepEqual(schedule.map((part) => ({
    part: part.part,
    amount: part.amount,
    paidAmount: part.paidAmount,
    remainingAmount: part.remainingAmount,
    dueDate: part.dueDate,
  })), [
    { part: 'prepayment', amount: 400, paidAmount: 400, remainingAmount: 0, dueDate: '2026-09-06' },
    { part: 'final', amount: 600, paidAmount: 250, remainingAmount: 350, dueDate: '2026-09-22' },
  ])
  assert.equal(invoiceDisplayStatus({ amount: 1_000, paidAmount: 650, schedule }), 'partially_paid')
})

test('calendar day arithmetic crosses month and leap-year boundaries', () => {
  assert.equal(addCalendarDays('2028-02-28', 2), '2028-03-01')
})
