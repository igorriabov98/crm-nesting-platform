import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getSupplyOrdersForRequestHref,
  isBusinessScrapReservationStatus,
  isSupplyWarehouseReservationStatus,
  normalizeSupplyRequestId,
} from '../src/lib/supply-request-flow'

const requestId = 'b92eee1c-a07f-49cd-b2aa-b21fa8b56622'

assert.equal(isBusinessScrapReservationStatus('pending_stock_check'), true)
assert.equal(isBusinessScrapReservationStatus('stock_checked'), false)
assert.equal(isBusinessScrapReservationStatus('submitted_to_supply'), false)
assert.equal(isBusinessScrapReservationStatus('completed'), false)

assert.equal(isSupplyWarehouseReservationStatus('stock_checked'), true)
assert.equal(isSupplyWarehouseReservationStatus('submitted_to_supply'), false)
assert.equal(isSupplyWarehouseReservationStatus('pending_stock_check'), false)
assert.equal(isSupplyWarehouseReservationStatus('completed'), false)

assert.equal(normalizeSupplyRequestId(requestId), requestId)
assert.equal(normalizeSupplyRequestId('not-a-request'), null)
assert.equal(
  getSupplyOrdersForRequestHref(requestId),
  `/supply/orders?view=details&request=${requestId}`,
)

const supplyAction = readFileSync('src/lib/actions/supply-request.ts', 'utf8')
assert.ok(supplyAction.includes("...sheetMetal.map((row) => row.steel_type_id).filter(Boolean)"))
assert.ok(supplyAction.includes("...circles.map((row) => row.steel_type_id).filter(Boolean)"))
assert.ok(supplyAction.includes("table === 'request_sheet_metal'"))
assert.ok(supplyAction.includes('sheetMetalVariantMatchesRequest(row, variant)'))
assert.ok(supplyAction.includes('assertManualSupplyRequestReservationAllowed(data.request_item_table, row)'))
assert.ok(supplyAction.includes('isLayoutManagedSupplyRequestItem(table, row)'))

const inventoryAction = readFileSync('src/lib/actions/inventory.ts', 'utf8')
assert.ok(inventoryAction.includes('assertManualSupplyRequestReservationAllowed(input.requestItemTable, requestItem)'))
assert.ok(inventoryAction.includes('isActiveWarehouseReservationStatus(request.status)'))

const sheetTable = readFileSync('src/components/features/supply-request/SupplySheetMetalTable.tsx', 'utf8')
assert.ok(sheetTable.includes("row.steel_type_name || row.material_grade || '—'"))
assert.ok(!sheetTable.includes('Есть остаток по материалу'))

const supplyPage = readFileSync('src/components/features/supply-request/SupplyRequestPage.tsx', 'utf8')
for (const required of ['Бронь основного склада', 'Завершить бронь склада и продолжить', 'Открыть заказ']) {
  assert.ok(supplyPage.includes(required), `supply page is missing ${required}`)
}

const sharedTable = readFileSync('src/components/features/supply-request/SupplyRequestTableShared.tsx', 'utf8')
assert.ok(!sharedTable.includes('Отметить заказано'))
assert.ok(!sharedTable.includes('Принять на склад'))

for (const file of ['SupplyCircleTable.tsx', 'SupplyKnivesTable.tsx']) {
  const source = readFileSync(`src/components/features/supply-request/${file}`, 'utf8')
  assert.ok(!source.includes('<ReserveButton'), `${file} must not expose manual reservation`)
  assert.ok(!source.includes('<UnreserveButton'), `${file} must not expose manual unreserve`)
}
const pipeTable = readFileSync('src/components/features/supply-request/SupplyPipeTable.tsx', 'utf8')
assert.ok(pipeTable.includes('isWire && (canReserve || (canUnreserve && row.reservation_id))'))
assert.ok(pipeTable.includes('Деловой остаток'))

const supplyResources = readFileSync('src/lib/permissions/resources.ts', 'utf8')
const warehouseResource = supplyResources.slice(supplyResources.indexOf("key: 'supply_material_requests'"), supplyResources.indexOf("key: 'supply_consumable_requests'"))
assert.ok(!warehouseResource.includes('sidebar:'), 'warehouse reservation must be hidden from supply sidebar')

const regularStockStageMigration = readFileSync('supabase/migrations/20260913190000_regular_stock_reservation_stage.sql', 'utf8')
for (const required of [
  'fn_complete_business_scrap_stage_v1',
  "set status = 'stock_checked'",
  'fn_guard_regular_stock_stage_submission_v1',
  "old.status is distinct from 'stock_checked'",
  '[REGULAR_STOCK_CHECK_REQUIRED]',
]) assert.ok(regularStockStageMigration.includes(required), `regular-stock stage migration is missing ${required}`)

const readinessAction = readFileSync('src/lib/actions/technologist-requests.ts', 'utf8')
assert.ok(readinessAction.includes("select('id, material_id, steel_type_id, remainder_qty')"))
assert.ok(readinessAction.includes('выберите "Тип стали"'))

const steelTypeGuard = readFileSync('supabase/migrations/20260909170000_guard_request_steel_type_handoff.sql', 'utf8')
for (const required of [
  'guard_request_steel_type_handoff',
  "new.status not in ('pending_stock_check', 'stock_checked', 'submitted_to_supply')",
  'sheet.steel_type_id is null',
  'guard_request_sheet_metal_steel_type_removal',
  "v_status in ('pending_stock_check', 'stock_checked', 'submitted_to_supply')",
  'guard_sheet_inventory_reservation',
  "new.request_item_table is distinct from 'request_sheet_metal'",
  'v_variant.steel_type_id is distinct from v_sheet.steel_type_id',
  'v_variant.thickness_mm is distinct from v_sheet.thickness_mm',
]) assert.ok(steelTypeGuard.includes(required), `steel-type handoff guard is missing ${required}`)

console.log('Supply request flow regression passed')
