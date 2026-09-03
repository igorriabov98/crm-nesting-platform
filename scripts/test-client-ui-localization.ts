import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROUTES } from '../src/lib/constants/routes'
import { BREADCRUMB_SEGMENT_LABELS, breadcrumbLabelForSegment } from '../src/lib/navigation/breadcrumbs'
import { paymentTermsLabel } from '../src/lib/payments/terms'
import { clientSchema } from '../src/lib/types/schemas'

const root = process.cwd()
const clientDetail = readFileSync(
  join(root, 'src/components/features/clients/ClientDetail.tsx'),
  'utf8'
)
const clientFormFields = readFileSync(
  join(root, 'src/components/features/clients/ClientFormFields.tsx'),
  'utf8'
)
const machineStatusBadge = readFileSync(
  join(root, 'src/components/features/machines/MachineStatusBadge.tsx'),
  'utf8'
)
const invoiceStatuses = readFileSync(
  join(root, 'src/lib/constants/statuses.ts'),
  'utf8'
)

assert.match(
  clientDetail,
  /<MachineStatusBadge status=\{machine\.status\} \/>/u,
  'Карточка клиента должна показывать локализованный статус машины'
)
assert.doesNotMatch(
  clientDetail,
  /<Badge[^>]*>\{machine\.status\}<\/Badge>/u,
  'Карточка клиента не должна показывать технический код статуса машины'
)
assert.match(
  clientDetail,
  /INVOICE_STATUSES\[invoiceSummary\?\.status \|\| invoice\.status\]\?\.label/u,
  'Карточка клиента должна показывать локализованный статус инвойса'
)
assert.doesNotMatch(
  clientDetail,
  /\$\{invoice\.status\}/u,
  'Карточка клиента не должна показывать технический код статуса инвойса'
)
assert.match(
  clientFormFields,
  /<SelectValue>\{responsibleName\}<\/SelectValue>/u,
  'Выбор ответственного должен показывать имя или русскую подпись'
)
assert.match(
  clientFormFields,
  /if \(!managerAccess\.canAssign && managerAccess\.currentUserName\) return managerAccess\.currentUserName\s+return 'Не назначен'/u,
  'Неназначенная компания не должна отображать текущего администратора как ответственного'
)
assert.match(
  clientFormFields,
  /<SelectValue>\{PAYMENT_TERMS_TYPE_LABELS\[field\.value\]\}<\/SelectValue>/u,
  'Выбор условий оплаты должен показывать русскую подпись'
)

for (const label of ['Назначен завод', 'Материал получен', 'Отгружена']) {
  assert.ok(machineStatusBadge.includes(label), `Нет русской подписи статуса машины: ${label}`)
}

for (const label of ['Не оплачено', 'Частично оплачено', 'Оплачено', 'Аннулировано']) {
  assert.ok(invoiceStatuses.includes(label), `Нет русской подписи статуса инвойса: ${label}`)
}

for (const label of ['Не назначен', 'От даты инвойса', 'От даты доставки', 'Предоплата + полная оплата', 'По расписанию после доставки']) {
  assert.ok(clientFormFields.includes(label), `Нет русской подписи поля клиента: ${label}`)
}

for (const [segment, expected] of Object.entries({
  clients: 'База клиентов',
  tasks: 'Задачи',
  fact: 'Факт производства',
  people: 'Планирование людей',
  workers: 'Работники',
  'material-requests': 'Бронь склада',
  orders: 'Заказы снабжения',
  detailing: 'Деталировка',
  future: 'Будущая деталировка',
  history: 'История склада',
  detail: 'Детали',
  complete: 'Завершение',
  correction: 'Исправление',
})) {
  assert.equal(breadcrumbLabelForSegment(segment), expected)
}

const staticSegments = new Set(Object.values(ROUTES).flatMap((route) => route.split('/').filter(Boolean)))
const collectProtectedSegments = (directory: string) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith('[') && !entry.name.startsWith('(')) staticSegments.add(entry.name)
    collectProtectedSegments(join(directory, entry.name))
  }
}
collectProtectedSegments(join(root, 'src/app/(protected)'))
for (const segment of staticSegments) {
  assert.ok(BREADCRUMB_SEGMENT_LABELS[segment], `Для статического сегмента ROUTES нет русской подписи: ${segment}`)
  assert.notEqual(breadcrumbLabelForSegment(segment), segment, `Хлебные крошки не должны показывать сырой сегмент: ${segment}`)
}
assert.equal(breadcrumbLabelForSegment('2eb453c5-f7cb-4d3c-9d6a-971e2839116e'), 'Детали')
assert.equal(breadcrumbLabelForSegment('mystery'), 'Раздел')

const scheduledBase = {
  name: 'Клиент с расписанием',
  payment_terms_type: 'scheduled_after_delivery' as const,
  payment_due_days: 14,
  estimated_delivery_days: 7,
  scheduled_payment_weekdays: [],
  scheduled_payment_month_days: [],
  scheduled_payment_amount_mode: 'full_balance' as const,
  scheduled_payment_minimum_amount: null,
}
assert.equal(clientSchema.safeParse(scheduledBase).success, false, 'Для расписания нужен хотя бы один выбранный день')
assert.equal(clientSchema.safeParse({ ...scheduledBase, scheduled_payment_weekdays: [3] }).success, true)
assert.equal(clientSchema.safeParse({
  ...scheduledBase,
  scheduled_payment_month_days: [10],
  scheduled_payment_amount_mode: 'fixed_amount',
}).success, false, 'Для фиксированного режима нужна положительная сумма')
assert.equal(clientSchema.safeParse({
  ...scheduledBase,
  scheduled_payment_month_days: [10],
  scheduled_payment_amount_mode: 'fixed_amount',
  scheduled_payment_minimum_amount: 500.25,
}).success, true)
assert.equal(
  paymentTermsLabel({
    type: 'scheduled_after_delivery',
    scheduledWeekdays: [1, 3],
    scheduledMonthDays: [10, 31],
    scheduledAmountMode: 'fixed_amount',
    scheduledMinimumAmount: 500,
  }),
  'После доставки: Пн, Ср; числа месяца: 10, 31; не менее 500,00 € на каждую дату',
)

console.log('client-ui-localization: OK')
