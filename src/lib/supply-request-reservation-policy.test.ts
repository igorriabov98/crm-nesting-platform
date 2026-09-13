import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertManualSupplyRequestReservationAllowed,
  getReservationStockSourceForStatus,
  getSupplyRequestPositionStatus,
  isLayoutManagedSupplyRequestItem,
} from './supply-request-reservation-policy'

test('warehouse source follows the request stage', () => {
  assert.equal(getReservationStockSourceForStatus('pending_stock_check'), 'business_scrap')
  assert.equal(getReservationStockSourceForStatus('stock_checked'), 'regular_stock')
  assert.equal(getReservationStockSourceForStatus('submitted_to_supply'), 'regular_stock')
})

test('layout-managed categories reject manual reservation while wire stays available', () => {
  assert.equal(isLayoutManagedSupplyRequestItem('request_circle'), true)
  assert.equal(isLayoutManagedSupplyRequestItem('request_knives'), true)
  assert.equal(isLayoutManagedSupplyRequestItem('request_round_tube'), true)
  assert.equal(isLayoutManagedSupplyRequestItem('request_pipe', { pipe_type: 'round' }), true)
  assert.equal(isLayoutManagedSupplyRequestItem('request_pipe', { pipe_type: 'wire' }), false)
  assert.throws(() => assertManualSupplyRequestReservationAllowed('request_circle'), /программе раскладки/)
  assert.doesNotThrow(() => assertManualSupplyRequestReservationAllowed('request_pipe', { pipe_type: 'wire' }))
  assert.doesNotThrow(() => assertManualSupplyRequestReservationAllowed('request_sheet_metal'))
})

test('position status is derived from actual full coverage', () => {
  assert.equal(getSupplyRequestPositionStatus({ table: 'request_circle', status: 'pending', needed: 3000, reserved: 0, covered: 3022 }), 'Забронировано по раскладке')
  assert.equal(getSupplyRequestPositionStatus({ table: 'request_sheet_metal', status: 'pending', needed: 5, reserved: 5, covered: 5 }), 'Закрыто со склада')
  assert.equal(getSupplyRequestPositionStatus({ table: 'request_pipe', pipeType: 'wire', status: 'pending', needed: 10, reserved: 10, covered: 10 }), 'Закрыто со склада')
  assert.equal(getSupplyRequestPositionStatus({ table: 'request_circle', status: 'ordered', needed: 3000, reserved: 0, covered: 2000 }), 'Заказано')
  assert.equal(getSupplyRequestPositionStatus({ table: 'request_circle', status: 'cancelled', needed: 3000, reserved: 0, covered: 3022 }), 'Отменено')
})
