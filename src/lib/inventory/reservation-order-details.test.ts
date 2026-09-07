import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateReservationOrders, groupInventoryReservationOrders } from './reservation-order-details'

test('aggregates several physical reservations under one order', () => {
  const result = aggregateReservationOrders([
    {
      reservationId: 'reservation-1',
      machineId: 'machine-1',
      machineName: 'тест 5/09',
      quantity: 6_000,
      secondaryQuantity: 1,
      reservedAt: '2026-09-07T08:00:34.000Z',
    },
    {
      reservationId: 'reservation-2',
      machineId: 'machine-1',
      machineName: 'тест 5/09',
      quantity: 6_000,
      secondaryQuantity: 1,
      reservedAt: '2026-09-07T08:00:35.000Z',
    },
  ])

  assert.deepEqual(result, [{
    machineId: 'machine-1',
    machineName: 'тест 5/09',
    quantity: 12_000,
    secondaryQuantity: 2,
    reservationCount: 2,
    reservedAt: '2026-09-07T08:00:34.000Z',
  }])
})

test('keeps different orders separate and ignores empty reservation rows', () => {
  const result = aggregateReservationOrders([
    { reservationId: 'a', machineId: 'machine-b', machineName: 'Заказ Б', quantity: 3, secondaryQuantity: null, reservedAt: '2026-09-07T10:00:00Z' },
    { reservationId: 'b', machineId: 'machine-a', machineName: 'Заказ А', quantity: 2, secondaryQuantity: null, reservedAt: '2026-09-07T11:00:00Z' },
    { reservationId: 'c', machineId: 'machine-c', machineName: 'Пустая бронь', quantity: 0, secondaryQuantity: null, reservedAt: '2026-09-07T12:00:00Z' },
  ])

  assert.deepEqual(result.map((item) => [item.machineName, item.quantity]), [['Заказ А', 2], ['Заказ Б', 3]])
})

test('maps one reservation to its main row and future business remainder', () => {
  const result = groupInventoryReservationOrders(
    ['main-inventory', 'future-scrap'],
    [{
      reservationId: 'reservation-1',
      inventoryId: 'other-inventory',
      sourceInventoryId: 'main-inventory',
      businessScrapInventoryId: 'future-scrap',
      businessScrapQuantity: 350,
      machineId: 'machine-1',
      quantity: 6_000,
      secondaryQuantity: 1,
      reservedAt: '2026-09-07T08:00:34.000Z',
    }],
    new Map([['machine-1', 'Заказ с будущим остатком']]),
  )

  assert.equal(result.get('main-inventory')?.[0].quantity, 6_000)
  assert.equal(result.get('main-inventory')?.[0].secondaryQuantity, 1)
  assert.equal(result.get('future-scrap')?.[0].quantity, 350)
  assert.equal(result.get('future-scrap')?.[0].secondaryQuantity, null)
  assert.equal(result.get('future-scrap')?.[0].machineName, 'Заказ с будущим остатком')
})

test('maps a transferred reservation to the destination row when its source is outside the current warehouse page', () => {
  const result = groupInventoryReservationOrders(
    ['destination-inventory'],
    [{
      reservationId: 'reservation-1',
      inventoryId: 'destination-inventory',
      sourceInventoryId: 'source-inventory-from-another-factory',
      businessScrapInventoryId: null,
      businessScrapQuantity: null,
      machineId: 'machine-1',
      quantity: 12_000,
      secondaryQuantity: 2,
      reservedAt: '2026-09-07T08:00:34.000Z',
    }],
    new Map([['machine-1', 'тест 5/09']]),
  )

  assert.deepEqual(result.get('destination-inventory')?.map((item) => [item.machineName, item.quantity, item.secondaryQuantity]), [
    ['тест 5/09', 12_000, 2],
  ])
})
