import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReservationOrdersList, formatReservationQuantity } from './ReservationOrdersDialog'

test('renders each reserved order with a link and aggregated quantity', () => {
  const html = renderToStaticMarkup(
    <ReservationOrdersList
      unit="мм"
      secondaryUnit="шт"
      reservations={[{
        machineId: 'machine-1',
        machineName: 'тест 5/09',
        quantity: 12_000,
        secondaryQuantity: 2,
        reservationCount: 2,
        reservedAt: '2026-09-07T08:00:34.000Z',
      }]}
    />,
  ).replaceAll('\u00a0', ' ')

  assert.match(html, /Заказы с активной бронью/)
  assert.match(html, /href="\/sales-plan\/machine-1"/)
  assert.match(html, /тест 5\/09/)
  assert.match(html, /12 000 мм \/ 2 шт/)
  assert.match(html, /записей: 2/)
})

test('formats a detailing reservation without a secondary unit', () => {
  assert.equal(formatReservationQuantity(4, 'шт'), '4 шт')
})
