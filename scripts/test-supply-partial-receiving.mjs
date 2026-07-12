import assert from 'node:assert/strict'
import {
  committedScheduleQuantity,
  outstandingReceivingQuantity,
} from '../src/lib/supply-orders/receiving-quantity.mjs'

assert.equal(outstandingReceivingQuantity(10, []), 10)

const firstPartialReceipt = {
  quantity: 10,
  status: 'delivered',
  received_quantity: 1,
}
assert.equal(committedScheduleQuantity(firstPartialReceipt), 1)
assert.equal(outstandingReceivingQuantity(10, [firstPartialReceipt]), 9)

const remainingDelivery = {
  quantity: 9,
  status: 'planned',
  received_quantity: null,
}
assert.equal(outstandingReceivingQuantity(10, [firstPartialReceipt, remainingDelivery]), 0)

const secondPartialReceipt = {
  quantity: 9,
  status: 'delivered',
  received_quantity: 4,
}
assert.equal(outstandingReceivingQuantity(10, [firstPartialReceipt, secondPartialReceipt]), 5)

assert.equal(outstandingReceivingQuantity(10, [{
  quantity: 10,
  status: 'delivered',
  received_quantity: 12,
}]), 0)

assert.equal(committedScheduleQuantity({
  quantity: 3,
  status: 'delivered',
  received_quantity: null,
}), 3)

const cancelledDelivery = {
  quantity: 7,
  status: 'cancelled',
  received_quantity: null,
}
assert.equal(committedScheduleQuantity(cancelledDelivery), 0)
assert.equal(outstandingReceivingQuantity(10, [firstPartialReceipt, cancelledDelivery]), 9)

console.log('Supply partial receiving tests passed')
