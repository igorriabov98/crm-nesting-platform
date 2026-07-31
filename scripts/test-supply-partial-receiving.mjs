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
const wholeBarCirclePipeMigration = await readFile(
  new URL('../supabase/migrations/20260731120000_whole_bar_circle_pipe_lifecycle.sql', import.meta.url),
  'utf8',
)
const inventoryPage = await readFile(
  new URL('../src/components/features/inventory/InventoryPage.tsx', import.meta.url),
  'utf8',
)
const receivingPage = await readFile(
  new URL('../src/components/features/inventory/MaterialReceivingPage.tsx', import.meta.url),
  'utf8',
)
const circleTable = await readFile(
  new URL('../src/components/features/supply-request/SupplyCircleTable.tsx', import.meta.url),
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
  supplyOrderActions,
  /item\.category === 'pipe' && \(item\.raw\?\.pipe_type \?\? item\.pipe_type\) !== 'wire'/,
  'whole-bar receiving must include every non-wire pipe subtype and exclude wire',
)
assert.match(
  wholeBarCirclePipeMigration,
  /logical_reserved_quantity[\s\S]*reservation_source[\s\S]*'whole_bar_stock'/,
  'whole-bar reservations must preserve logical demand separately from physical length',
)
assert.match(
  inventoryPage,
  /receiptNeedsPieceLength[\s\S]{0,250}category === 'circle'/,
  'manual circle receipt must request a piece length and derive a whole piece count',
)
assert.match(
  receivingPage,
  /const isBar = item\.is_whole_bar/,
  'receiving UI must use the server whole-bar predicate for circles and pipes',
)
assert.match(
  circleTable,
  /Старый количественный остаток[\s\S]*available_secondary_quantity/,
  'circle stock UI must show legacy rows and physical piece availability',
)
assert.match(
  wholeBarCirclePipeMigration,
  /fn_reserve_whole_bar_inventory_row_for_machine[\s\S]*ceil\(p_logical_quantity \/ v_inventory\.piece_length_mm\)/,
  'local reservation must atomically round logical demand up to whole bars',
)
assert.match(
  wholeBarCirclePipeMigration,
  /inventory_transfer_items[\s\S]*logical_requested_quantity[\s\S]*logical_received_quantity/,
  'transfer items must store physical and logical quantities',
)
assert.match(
  wholeBarCirclePipeMigration,
  /Факт Заготовки заблокирован до полной приёмки межзаводской перевозки/,
  'cutting must remain blocked until the transfer is fully received',
)
assert.match(
  wholeBarCirclePipeMigration,
  /logical_requested_quantity IS NOT NULL[\s\S]*v_remaining <= 0[\s\S]*CONTINUE/,
  'repeated whole-bar transfer receipt must be idempotent',
)
assert.match(
  wholeBarCirclePipeMigration,
  /FOR UPDATE[\s\S]*Недостаточно целых хлыстов/,
  'whole-bar stock rows must be locked before availability is checked',
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
