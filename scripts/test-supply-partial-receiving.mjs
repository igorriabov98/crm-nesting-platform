import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  committedScheduleQuantity,
  outstandingReceivingQuantity,
} from '../src/lib/supply-orders/receiving-quantity.mjs'

const supplyOrderActions = await readFile(
  new URL('../src/lib/actions/supply-orders.ts', import.meta.url),
  'utf8',
)
const receivingMigration = await readFile(
  new URL('../supabase/migrations/20260714101554_supply_receipt_priority_allocation.sql', import.meta.url),
  'utf8',
)
const barLifecycleMigration = await readFile(
  new URL('../supabase/migrations/20260730133000_bar_receiving_lifecycle.sql', import.meta.url),
  'utf8',
)

assert.match(
  supplyOrderActions,
  /requireReceivingAccess\('manage'\)[\s\S]*const receivingRpcDb = createAdminClient\(\) as unknown as RpcDb[\s\S]*receivingRpcDb\.rpc\('fn_receive_supply_order_schedule_v2'/,
  'receiving must authorize the user before invoking the service-role-only RPC',
)
assert.doesNotMatch(
  supplyOrderActions,
  /db\.rpc\('fn_receive_supply_order_schedule_v2'/,
  'the authenticated client must not invoke the service-role-only receiving RPC',
)
assert.match(
  receivingMigration,
  /REVOKE ALL ON FUNCTION public\.fn_receive_supply_order_schedule_v2\([^)]+\) FROM anon, authenticated;/,
  'the receiving RPC must remain unavailable to browser-authenticated roles',
)
assert.match(
  receivingMigration,
  /GRANT EXECUTE ON FUNCTION public\.fn_receive_supply_order_schedule_v2\([^)]+\) TO service_role;/,
  'the receiving RPC must remain restricted to the server service role',
)
assert.match(
  supplyOrderActions,
  /previewMaterialDeliveryAllocation[\s\S]*requireReceivingAccess\('manage'\)[\s\S]*buildBarAllocationPreview/,
  'whole-bar preview must be authorized and calculated on the server',
)
assert.match(
  supplyOrderActions,
  /confirmedBarAllocations\(preview, input\.confirmed_bar_allocations\)/,
  'receipt confirmation must revalidate the operator allocation against a fresh preview',
)
assert.match(
  barLifecycleMigration,
  /request_item_table IN \('request_knives', 'request_circle'\)/,
  'the database lifecycle must cover both knife and circle requests',
)
assert.match(
  barLifecycleMigration,
  /fn_prepare_supply_knife_future_scrap[\s\S]*fn_prepare_supply_bar_future_scrap/,
  'the legacy knife function must remain as a wrapper around the generic lifecycle',
)
assert.match(
  barLifecycleMigration,
  /fn_block_supply_bar_future_scrap_reservation[\s\S]*станет доступен только после факта Заготовки/,
  'future supply-bar scrap must be blocked from preliminary reservations',
)

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
