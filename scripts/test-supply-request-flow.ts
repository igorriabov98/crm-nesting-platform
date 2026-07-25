import assert from 'node:assert/strict'
import {
  getSupplyOrdersForRequestHref,
  isBusinessScrapReservationStatus,
  isSupplyWarehouseReservationStatus,
  normalizeSupplyRequestId,
} from '../src/lib/supply-request-flow'

const requestId = 'b92eee1c-a07f-49cd-b2aa-b21fa8b56622'

assert.equal(isBusinessScrapReservationStatus('pending_stock_check'), true)
assert.equal(isBusinessScrapReservationStatus('stock_checked'), true)
assert.equal(isBusinessScrapReservationStatus('submitted_to_supply'), false)
assert.equal(isBusinessScrapReservationStatus('completed'), false)

assert.equal(isSupplyWarehouseReservationStatus('submitted_to_supply'), true)
assert.equal(isSupplyWarehouseReservationStatus('pending_stock_check'), false)
assert.equal(isSupplyWarehouseReservationStatus('completed'), false)

assert.equal(normalizeSupplyRequestId(requestId), requestId)
assert.equal(normalizeSupplyRequestId('not-a-request'), null)
assert.equal(
  getSupplyOrdersForRequestHref(requestId),
  `/supply/orders?view=details&request=${requestId}`,
)

console.log('Supply request flow regression passed')
