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
const receivingPageStart = supplyOrderActions.indexOf('export async function getMaterialReceivingPageData')
const receivingPageEnd = supplyOrderActions.indexOf('function confirmedMaterialAllocations', receivingPageStart)
const receivingPageActions = supplyOrderActions.slice(receivingPageStart, receivingPageEnd)
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
const manualAllocationMigration = await readFile(
  new URL('../supabase/migrations/20260803130000_supply_receipt_manual_allocation_guard.sql', import.meta.url),
  'utf8',
)
const arrivalBatchMigration = await readFile(
  new URL('../supabase/migrations/20260907120000_material_receiving_arrival_batches.sql', import.meta.url),
  'utf8',
)
const manualQuantityReconciliationMigration = await readFile(
  new URL('../supabase/migrations/20260910160000_manual_quantity_receipt_reconciliation.sql', import.meta.url),
  'utf8',
)
const receivingBatches = await readFile(
  new URL('../src/lib/supply-orders/receiving-batches.ts', import.meta.url),
  'utf8',
)
const ganttActions = await readFile(
  new URL('../src/app/(protected)/production/gantt/actions.ts', import.meta.url),
  'utf8',
)
const planFactMigration = await readFile(
  new URL('../supabase/migrations/20260818120000_supply_receiving_plan_fact_piece_fields.sql', import.meta.url),
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
const receivingAllocationDialog = await readFile(
  new URL('../src/components/features/inventory/MaterialReceivingAllocationDialog.tsx', import.meta.url),
  'utf8',
)
const orderItemRow = await readFile(
  new URL('../src/components/features/supply-orders/OrderItemRow.tsx', import.meta.url),
  'utf8',
)
const circleTable = await readFile(
  new URL('../src/components/features/supply-request/SupplyCircleTable.tsx', import.meta.url),
  'utf8',
)

assert.match(
  supplyOrderActions,
  /requireReceivingAccess\('manage'\)[\s\S]*const receivingRpcDb = createAdminClient\(\) as unknown as RpcDb[\s\S]*fn_receive_supply_order_schedule_v3/,
  'receiving must authorize the user before invoking the service-role-only manual quantity RPC',
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
  /previewMaterialDeliveryAllocation[\s\S]*requireReceivingAccess\('manage'\)[\s\S]*buildMaterialAllocationPreview/,
  'allocation preview for every category must be authorized and calculated on the server',
)
assert.match(
  supplyOrderActions,
  /buildMaterialAllocationPreview\([\s\S]*confirmedMaterialAllocations\(preview, input\.confirmed_allocations\)/,
  'receipt confirmation must revalidate the operator allocation against a fresh preview',
)
assert.match(
  supplyOrderActions,
  /mode: 'quantity'[\s\S]*quantity: number[\s\S]*mode: 'whole_bar'[\s\S]*piece_count: number/,
  'operator confirmation must use one discriminated allocation field for quantity and whole-bar modes',
)
assert.match(
  supplyOrderActions,
  /item\.factory_id === sourceItem\.factory_id[\s\S]*item\.table === sourceItem\.table[\s\S]*item\.material_id === sourceItem\.material_id[\s\S]*item\.material_variant_id === sourceItem\.material_variant_id[\s\S]*getAggregateIdentityKey/,
  'preview candidates must match factory, request type, material, variant, and characteristics',
)
assert.match(
  supplyOrderActions,
  /futureSchedules[\s\S]*hasOtherPlannedSchedule[\s\S]*isEligible: outstandingQuantity > 0/,
  'a machine with a separate future delivery must stay visible and selectable',
)
assert.doesNotMatch(
  supplyOrderActions,
  /loadActiveReservationKeys|По заявке уже действует складской резерв/,
  'an active stock reservation must reduce to_order instead of blocking the remaining supplier need',
)
assert.match(
  supplyOrderActions,
  /outstandingAllocationQuantity\(\{[\s\S]*requestedQuantity: item\.requested_quantity,[\s\S]*reservedQuantity: item\.reserved_quantity,[\s\S]*purchaseQuantity: item\.to_order,[\s\S]*deliveredQuantity: delivered,[\s\S]*isEligible: outstandingQuantity > 0/,
  'whole-bar allocation eligibility must keep logical demand separate from its rounded purchase plan',
)
assert.match(
  supplyOrderActions,
  /quantity > row\.outstanding_quantity[\s\S]*totalPhysical > preview\.received_quantity[\s\S]*preview\.mode === 'whole_bar' && allocations\.length === 0/,
  'fresh server validation must reject overflows while accepting an explicit all-zero quantity allocation',
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
assert.doesNotMatch(
  receivingPage,
  /preview\.mode === 'quantity' && !preview\.has_shortage[\s\S]*performReceipt\(item, values\)/,
  'ordinary material must never bypass the manual allocation dialog',
)
assert.match(
  receivingPage,
  /MaterialReceivingAllocationDialog[\s\S]*confirmed_allocations: confirmedAllocations/,
  'shortages and whole bars must confirm through the shared allocation dialog',
)
assert.match(
  manualQuantityReconciliationMigration,
  /fn_reconcile_quantity_receipt_schedules_v1[\s\S]*delivery_date DESC, schedule\.created_at DESC, schedule\.id DESC/,
  'future schedules must be reduced from the latest row first',
)
assert.match(
  manualQuantityReconciliationMigration,
  /fn_receive_supply_order_schedule_v3[\s\S]*SELECT public\.fn_reconcile_quantity_receipt_schedules_v1/,
  'ordinary material must use a dedicated atomic receipt and reconciliation RPC',
)
assert.match(
  manualQuantityReconciliationMigration,
  /trip\.status IN \('in_transit', 'completed'\)[\s\S]*supply_schedule_reconciliation_review/,
  'started trips must remain protected and create a supply review task',
)
assert.match(
  receivingAllocationDialog,
  /<Dialog open=[\s\S]*<DialogContent[\s\S]*finalFocus=[\s\S]*max-h-\[calc\(100dvh-1rem\)\][\s\S]*overflow-y-auto/,
  'the allocation list must use the existing focus-managed dialog, restore focus, and remain scrollable on small screens',
)
assert.match(
  receivingAllocationDialog,
  /<label[\s\S]*htmlFor=[\s\S]*aria-describedby=[\s\S]*aria-invalid=/,
  'allocation inputs must be labelled and expose validation state',
)
assert.match(
  receivingAllocationDialog,
  /lg:grid-cols[\s\S]*aria-live="polite"/,
  'allocation errors must use a live region and rows must have a responsive layout',
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
assert.match(
  manualAllocationMigration,
  /jsonb_array_elements\(p_allocations\)[\s\S]*GROUP BY[\s\S]*HAVING count\(\*\) > 1/,
  'the receiving RPC must reject duplicate allocation targets',
)
assert.match(
  manualAllocationMigration,
  /Распределение превышает актуальный остаток потребности[\s\S]*FOR UPDATE/,
  'the migration must preserve current-outstanding and row-lock concurrency guards',
)
assert.match(
  manualAllocationMigration,
  /v_source_status_replacement text := 'status = ''delivered'','/,
  'a real source receipt must remain delivered even when its machine receives zero allocation',
)
assert.match(
  receivingMigration,
  /v_delivered_total >= v_required[\s\S]*USING 'delivered'[\s\S]*ELSIF[\s\S]*USING 'ordered'/,
  'fully covered requests must become delivered while partial requests remain ordered',
)
assert.match(
  manualAllocationMigration,
  /REVOKE ALL ON FUNCTION public\.fn_receive_supply_order_schedule_v2\([^)]+\) FROM anon, authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.fn_receive_supply_order_schedule_v2\([^)]+\) TO service_role;/,
  'the hardened RPC must remain service-role-only',
)
assert.match(
  supplyOrderActions,
  /resolved\.scheduleIds\.length > 1[\s\S]*fn_receive_supply_order_schedule_batch_v1[\s\S]*buildMaterialReceiptBatchCalls/,
  'aggregated technical schedules must use the atomic batch RPC',
)
assert.match(
  arrivalBatchMigration,
  /ORDER BY schedule\.id[\s\S]*FOR UPDATE OF schedule[\s\S]*set_config\('app\.receiving_batch_mode', 'on', true\)[\s\S]*fn_receive_supply_order_schedule_v2/,
  'the batch RPC must lock every schedule before reusing the established receiving lifecycle',
)
assert.match(
  arrivalBatchMigration,
  /status = 'delivered' THEN RAISE EXCEPTION 'Поставка уже принята'[\s\S]*status = 'cancelled' THEN RAISE EXCEPTION 'Поставка отменена'/,
  'a concurrent repeated receipt must stop after acquiring the locked schedules',
)
assert.match(
  arrivalBatchMigration,
  /v_active_batch_count > 1[\s\S]*разных рейсов или точек разгрузки[\s\S]*Поставки без рейса должны относиться к одному поставщику/,
  'one atomic receipt must be restricted to one physical arrival or one unlinked supplier batch',
)
assert.match(
  arrivalBatchMigration,
  /material_receipt_batch_variance:[\s\S]*v_total_received < v_total_plan[\s\S]*supply_material_receipt_shortage/,
  'shortage and excess escalation must be calculated once for the aggregated batch',
)
assert.match(
  arrivalBatchMigration,
  /REVOKE ALL ON FUNCTION public\.fn_receive_supply_order_schedule_batch_v1\(jsonb, uuid\) FROM anon, authenticated;[\s\S]*GRANT EXECUTE ON FUNCTION public\.fn_receive_supply_order_schedule_batch_v1\(jsonb, uuid\) TO service_role;/,
  'the batch RPC must be callable only by the server service role',
)
assert.match(
  receivingBatches,
  /receivingDate\(row, context\)[\s\S]*trip:\$\{transportSignature\(context\)\}[\s\S]*unlinked:\$\{effectiveDate\}:\$\{row\.supplier_id/,
  'receiving projection must split linked arrivals by trip and stop and unlinked arrivals by supplier',
)
assert.match(
  receivingPage,
  /Фактическое прибытие:[\s\S]*Время не указано[\s\S]*Акт партии/,
  'the receiving UI must show transport timing and create an act for one physical batch',
)
assert.match(
  ganttActions,
  /ganttMaterialIdentityKey\(table, row, unit\)[\s\S]*planned_piece_length_mm:[\s\S]*aggregateGanttMaterialItems\(markers\)/,
  'production Gantt must aggregate exact schedule fragments while preserving one-piece bar length',
)
assert.match(
  supplyOrderActions,
  /const pieceLengthMm = schedule\.piece_length_mm[\s\S]*planned_piece_length_mm: pieceLengthMm[\s\S]*planned_piece_count: pieceCount/,
  'delivery planning must write the ordered bar composition to planned fields',
)
assert.match(
  receivingPageActions,
  /plannedItemKeys\.has\(itemKey\(item\)\)[\s\S]*schedule\.status === 'planned'/,
  'receiving must list only real supplier schedules that are still planned',
)
assert.doesNotMatch(
  receivingPageActions,
  /virtualReceivingQuantities|effectiveSupplyDeliveryDate/,
  'receiving must not synthesize supplier arrivals from unscheduled material needs',
)
assert.doesNotMatch(
  supplyOrderActions,
  /received_piece_length_mm: schedule\.piece_length_mm[\s\S]*received_piece_count: schedule\.piece_count/,
  'delivery planning must never populate receiving fact fields',
)
assert.match(
  planFactMigration,
  /create table public\.supply_order_delivery_length_discrepancies[\s\S]*planned_piece_length_mm[\s\S]*received_piece_length_mm[\s\S]*received_by[\s\S]*received_at/,
  'length differences must be stored as a standalone record with plan, fact, actor, and timestamp',
)
assert.match(
  planFactMigration,
  /before update or delete on public\.supply_order_delivery_length_discrepancies/,
  'length discrepancy records must be immutable at database level',
)
assert.match(
  planFactMigration,
  /received_piece_length_mm <> new\.planned_piece_length_mm[\s\S]*insert into public\.supply_order_delivery_length_discrepancies/,
  'a database trigger must create a discrepancy only when bar lengths differ',
)
assert.match(
  planFactMigration,
  /deferrable initially deferred[\s\S]*fn_assert_supply_order_delivery_piece_fact/,
  'database validation must reject a completed planned bar receipt without actual bar fields',
)
assert.match(
  planFactMigration,
  /add constraint supply_order_delivery_schedules_piece_values_check[\s\S]*\) not valid;/,
  'the stronger piece-value constraint must preserve legacy rows while enforcing new writes',
)
assert.doesNotMatch(
  supplyOrderActions,
  /export async function receiveOrderDeliverySchedule|rpc\('fn_receive_supply_order_schedule'/,
  'the legacy receiving action and RPC call must be removed',
)
assert.doesNotMatch(
  orderItemRow,
  /receiveOrderDeliverySchedule|>Принять<|Принять<\/span>/,
  'OrderItemRow must not offer direct receiving without actual values',
)
assert.match(
  receivingPage,
  /Длина отличается:[\s\S]*заказано[\s\S]*принято/,
  'the receiving row must highlight the ordered and accepted lengths',
)
assert.match(
  receivingAllocationDialog,
  /role="alert"[\s\S]*Длина отличается:[\s\S]*заказано[\s\S]*принято/,
  'the final receiving confirmation must repeat both differing lengths',
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
