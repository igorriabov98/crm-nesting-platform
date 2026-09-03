import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  /INVOICE_STATUSES\[invoice\.status\]\?\.label/u,
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

for (const label of ['Не назначен', 'От даты инвойса', 'От даты доставки', 'Предоплата + полная оплата']) {
  assert.ok(clientFormFields.includes(label), `Нет русской подписи поля клиента: ${label}`)
}

console.log('client-ui-localization: OK')
