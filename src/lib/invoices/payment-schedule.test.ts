import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addCalendarDays, buildInvoicePaymentSchedule, invoiceDisplayStatus, nextScheduledPaymentDate, todayDateOnly } from './payment-schedule'

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
  assert.equal(todayDateOnly(new Date('2026-09-03T22:30:00.000Z')), '2026-09-04', 'Сегодня определяется в часовом поясе Ужгорода')
})

test('scheduled dates are strictly after delivery and support weekdays plus month days', () => {
  assert.equal(nextScheduledPaymentDate('2026-09-02', [3], []), '2026-09-09', 'Доставка в среду переносит оплату на следующую среду')
  assert.equal(nextScheduledPaymentDate('2026-09-03', [3], [10]), '2026-09-09')
  assert.equal(nextScheduledPaymentDate('2026-09-09', [3], [10]), '2026-09-10')
})

test('month days 29-31 clamp to month end and coincident dates are de-duplicated', () => {
  assert.equal(nextScheduledPaymentDate('2026-01-31', [], [30, 31]), '2026-02-28')
  assert.equal(nextScheduledPaymentDate('2028-01-31', [], [29, 30, 31]), '2028-02-29')
  assert.equal(nextScheduledPaymentDate('2026-02-28', [], [30, 31]), '2026-03-30')
  assert.equal(nextScheduledPaymentDate('2026-12-31', [5], [1]), '2027-01-01', 'Расписание переходит через границу года')
  assert.equal(nextScheduledPaymentDate('2027-01-01', [5], [1]), '2027-01-08', 'Совпавший день недели и число месяца не дублируются')
})

test('full-balance schedule uses the first selected date after actual delivery', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    paymentTermsType: 'scheduled_after_delivery',
    deliveryToClientDate: '2026-09-02',
    scheduledPaymentWeekdays: [3],
    scheduledPaymentAmountMode: 'full_balance',
  })
  assert.equal(schedule.length, 1)
  assert.equal(schedule[0].dueDate, '2026-09-09')
  assert.equal(schedule[0].amount, 1_000)
  assert.equal(schedule[0].isOverdue, true)
})

test('fixed schedule reports only the cumulative shortfall as overdue', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    paidAmount: 300,
    today: '2026-09-10',
    paymentTermsType: 'scheduled_after_delivery',
    deliveryToClientDate: '2026-09-01',
    scheduledPaymentWeekdays: [3],
    scheduledPaymentAmountMode: 'fixed_amount',
    scheduledPaymentMinimumAmount: 500,
  })
  assert.deepEqual({
    part: schedule[0].part,
    dueDate: schedule[0].dueDate,
    amount: schedule[0].amount,
    paidAmount: schedule[0].paidAmount,
    remainingAmount: schedule[0].remainingAmount,
    isOverdue: schedule[0].isOverdue,
  }, {
    part: 'scheduled_overdue',
    dueDate: '2026-09-02',
    amount: 1_000,
    paidAmount: 300,
    remainingAmount: 700,
    isOverdue: true,
  })
  assert.equal(invoiceDisplayStatus({ amount: 1_000, paidAmount: 300, schedule }), 'overdue')
})

test('a scheduled obligation becomes overdue only on the following day', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    paidAmount: 500,
    today: '2026-09-09',
    paymentTermsType: 'scheduled_after_delivery',
    deliveryToClientDate: '2026-09-01',
    scheduledPaymentWeekdays: [3],
    scheduledPaymentAmountMode: 'fixed_amount',
    scheduledPaymentMinimumAmount: 500,
  })
  assert.equal(schedule.some((part) => part.isOverdue), false)
  assert.equal(schedule[0].dueDate, '2026-09-09')
})

test('early payments carry forward and the final scheduled payment is capped by the balance', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    amount: 1_200,
    paidAmount: 1_200,
    today: '2026-09-03',
    paymentTermsType: 'scheduled_after_delivery',
    deliveryToClientDate: '2026-09-01',
    scheduledPaymentWeekdays: [3],
    scheduledPaymentAmountMode: 'fixed_amount',
    scheduledPaymentMinimumAmount: 500,
    scheduleRangeStart: '2026-09-01',
    scheduleRangeEnd: '2026-09-30',
  })
  assert.deepEqual(schedule.map((part) => ({ amount: part.amount, paidAmount: part.paidAmount, remainingAmount: part.remainingAmount })), [
    { amount: 500, paidAmount: 500, remainingAmount: 0 },
    { amount: 500, paidAmount: 500, remainingAmount: 0 },
    { amount: 200, paidAmount: 200, remainingAmount: 0 },
  ])
})

test('finance range returns only individual scheduled obligations inside the requested period', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    amount: 2_000,
    today: '2026-09-20',
    paymentTermsType: 'scheduled_after_delivery',
    deliveryToClientDate: '2026-09-01',
    scheduledPaymentWeekdays: [3],
    scheduledPaymentAmountMode: 'fixed_amount',
    scheduledPaymentMinimumAmount: 500,
    scheduleRangeStart: '2026-09-08',
    scheduleRangeEnd: '2026-09-17',
  })
  assert.deepEqual(schedule.map((part) => [part.key, part.dueDate]), [
    ['scheduled-2', '2026-09-09'],
    ['scheduled-3', '2026-09-16'],
  ])
  assert.equal(schedule.some((part) => part.part === 'scheduled_overdue'), false)
})

test('scheduled delivery forecast never creates official overdue', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    today: '2026-10-01',
    paymentTermsType: 'scheduled_after_delivery',
    actualShippingDate: '2026-09-01',
    estimatedDeliveryDays: 7,
    scheduledPaymentMonthDays: [10],
    scheduledPaymentAmountMode: 'full_balance',
  })
  assert.equal(schedule[0].dueDate, '2026-09-10')
  assert.equal(schedule[0].isForecast, true)
  assert.equal(schedule[0].isOverdue, false)
})

test('scheduled summary is bounded to six nearest future dates', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    amount: 10_000,
    today: '2026-09-02',
    paymentTermsType: 'scheduled_after_delivery',
    deliveryToClientDate: '2026-09-01',
    scheduledPaymentWeekdays: [3],
    scheduledPaymentAmountMode: 'fixed_amount',
    scheduledPaymentMinimumAmount: 100,
  })
  assert.equal(schedule.length, 6)
  assert.deepEqual(schedule.map((part) => part.sequence), [1, 2, 3, 4, 5, 6])
})

test('scheduled terms preserve a missing delivery forecast without an official deadline', () => {
  const schedule = buildInvoicePaymentSchedule({
    ...base,
    paymentTermsType: 'scheduled_after_delivery',
    scheduledPaymentWeekdays: [1],
    scheduledPaymentAmountMode: 'full_balance',
  })
  assert.equal(schedule[0].dueDate, null)
  assert.equal(schedule[0].isForecast, true)
  assert.equal(schedule[0].isOverdue, false)
})
