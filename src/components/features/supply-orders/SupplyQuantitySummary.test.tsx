import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SupplyQuantitySummary } from './SupplyQuantitySummary'
import type { SupplyOrderDateSlice, SupplyOrderQuantitySummary } from './supply-order-view'

const summary: SupplyOrderQuantitySummary = {
  requestedQuantity: 20, stockQuantity: 0, demandQuantity: 20, deliveryQuantity: 15, allocatedQuantity: 10, physicalReceivedQuantity: 10,
  outstandingQuantity: 10, plannedQuantity: 15, remainingToOrder: 0, deliveryExcess: 5,
}
function render(slice: Partial<SupplyOrderDateSlice>, totals = summary) {
  return renderToStaticMarkup(<SupplyQuantitySummary summary={totals} unit="шт"
    dateSlice={slice as SupplyOrderDateSlice} productionDate="2026-10-07" weight={null} itemCount={1} />)
}

test('a date shows its shipment amount, with overall demand separately', () => {
  const received = render({ kind: 'delivery', quantity: 10, deliveredQuantity: 10, plannedQuantity: 0, deliveredScheduleCount: 1 })
  assert.match(received, /Принято по этой поставке<\/p><p[^>]*>10 шт<\/p>/)
  const future = render({ kind: 'delivery', quantity: 15, plannedQuantity: 15, plannedScheduleCount: 1 })
  assert.match(future, /Ожидается по этой поставке<\/p><p[^>]*>15 шт<\/p>/)
  for (const html of [received, future]) {
    assert.match(html, /По всем поставкам этой потребности/)
    assert.match(html, /Потребность в закупке<\/dt><dd[^>]*>20 шт/)
    assert.match(html, /Осталось получить для заявок<\/dt><dd[^>]*>10 шт/)
    assert.match(html, /Запланировано сверх потребности<\/dt><dd[^>]*>5 шт/)
    assert.match(html, /Ещё не заказано<\/dt><dd[^>]*>0 шт/)
  }
})
test('an unscheduled remainder is a separate requirement on the production date', () => {
  const html = render({ kind: 'unscheduled', quantity: 10, unscheduledQuantity: 10 },
    { ...summary, plannedQuantity: 0, remainingToOrder: 10, deliveryExcess: 0 })
  assert.match(html, /Не заказано<\/p><p[^>]*>10 шт/)
  assert.match(html, /Требуется к 07.10.2026/)
  assert.doesNotMatch(html, /Ожидается по этой поставке|Принято по этой поставке/)
})
