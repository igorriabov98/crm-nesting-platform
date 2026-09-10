import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./MaterialReceivingAllocationDialog.tsx', import.meta.url), 'utf8')

test('receiving dialog shows physical supplier progress', () => {
  assert.match(source, /Заявлено к поставке/u)
  assert.match(source, /Принято ранее/u)
  assert.match(source, /Осталось принять/u)
  assert.match(source, /supply_requested_quantity/u)
  assert.match(source, /supply_delivered_quantity/u)
  assert.match(source, /supply_outstanding_quantity/u)
})

test('receiving dialog does not present cutting need or future waste as receipt progress', () => {
  assert.doesNotMatch(source, /Заявлено технологом/u)
  assert.doesNotMatch(source, /Открытый остаток/u)
  assert.doesNotMatch(source, /будущий отход/iu)
  assert.doesNotMatch(source, /Потребность по раскрою/iu)
})

test('receipt confirmation remains protected by server-side preview rebuild', () => {
  const actionSource = readFileSync(
    new URL('../../../lib/actions/supply-orders.ts', import.meta.url),
    'utf8',
  )
  const receiveStart = actionSource.indexOf('export async function receiveMaterialDelivery')
  const receiveSource = actionSource.slice(receiveStart)

  assert.match(receiveSource, /buildMaterialAllocationPreview\(/u)
  assert.match(receiveSource, /confirmedMaterialAllocations\(preview, input\.confirmed_allocations\)/u)
  assert.match(receiveSource, /fn_receive_supply_order_schedule_v3/u)
})

test('ordinary receipt shows future coverage, protected trips, and reason validation', () => {
  assert.match(source, /Будущий график/u)
  assert.match(source, /Защищено в начатом рейсе/u)
  assert.match(source, /Причина изменения будущего графика/u)
  assert.match(source, /можно уменьшить до/u)
  assert.match(source, /minLength=\{3\}/u)
  assert.match(source, /maxLength=\{2000\}/u)
})
