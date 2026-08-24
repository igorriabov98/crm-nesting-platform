import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type {
  SupplyOrderAggregate,
  SupplyOrderDeliverySchedule,
  SupplyOrderHistoryItem,
  SupplyOrderItem,
} from '@/lib/actions/supply-orders'
import {
  filterAndSortAggregates,
  filterAndSortHistory,
  filterSupplyOrderItems,
  getSupplyOrderRedeliveryDates,
  groupSupplyOrderAggregatesBySupplyDate,
  groupSupplyOrderItems,
  isSupplyOrderBarMaterial,
  isSupplyOrderRedeliveryItem,
  partitionSupplyOrderAggregatesByRedelivery,
  summarizeSupplyOrderMachineRoutes,
  summarizeSupplyOrderRedeliveryMachineRoutes,
  summarizeSupplyOrderUnscheduledMachineRoutes,
  sortSupplyOrderItems,
  type OrderFiltersState,
} from '@/components/features/supply-orders/supply-order-view'
import { getRequestItemSelect, withPipeSteelGrade } from '@/lib/supply-orders/pipe-steel-grade'
import { formatSupplyOrderCharacteristicValue } from '@/lib/supply-orders/characteristic-labels'

const supplyOrdersAction = readFileSync(new URL('../src/lib/actions/supply-orders.ts', import.meta.url), 'utf8')
const getSupplyOrdersSource = supplyOrdersAction.slice(
  supplyOrdersAction.indexOf('export async function getSupplyOrders('),
  supplyOrdersAction.indexOf('export async function getSupplyOrderHistory('),
)
const scopedAccessIndex = getSupplyOrdersSource.indexOf('const { db } = await requireAccess()')
const scopedRequestsIndex = getSupplyOrdersSource.indexOf(".from('technologist_requests')")
const scopedItemsIndex = getSupplyOrdersSource.indexOf('const rawItems: RawOrderItem[] =')
const trustedReadIndex = getSupplyOrdersSource.indexOf('loadLongStockPurchasePlanMap(createTrustedLongStockReadDb(), rawItems)')

assert.ok(scopedAccessIndex >= 0, 'Supply-order reads must authorize supply_orders:view before database access')
assert.ok(
  scopedAccessIndex < scopedRequestsIndex && scopedRequestsIndex < scopedItemsIndex && scopedItemsIndex < trustedReadIndex,
  'The service-role cutting-plan read must happen only after RLS scopes the accessible requests and items',
)
assert.match(
  getSupplyOrdersSource,
  /loadLongStockPurchasePlanMap\(createTrustedLongStockReadDb\(\), rawItems\)/u,
  'Closed cutting-plan tables must be read through the trusted server client',
)

assert.equal(
  supplyOrdersAction.match(/loadLongStockPurchasePlanMap\(createTrustedLongStockReadDb\(\), rawItems\)/gu)?.length,
  3,
  'Every supply-order cutting-plan read must use the trusted server client',
)
assert.doesNotMatch(
  supplyOrdersAction,
  /loadLongStockPurchasePlanMap\(db, rawItems\)/u,
  'Authenticated supply-order clients must never read closed cutting-plan tables directly',
)

const aggregateOrdersSource = supplyOrdersAction.slice(
  supplyOrdersAction.indexOf('export async function getSupplyOrderAggregates('),
  supplyOrdersAction.indexOf('type LongStockPlanItemRow ='),
)
assert.match(
  aggregateOrdersSource,
  /const \{ db \} = await requireAccess\(\)[\s\S]*await loadAggregateInputItems\(db, factoryId\)/u,
  'The aggregate supply-order view must authorize supply_orders:view before loading scoped items',
)

const longStockPlanReaderSource = supplyOrdersAction.slice(
  supplyOrdersAction.indexOf('async function loadLongStockPurchasePlanMap('),
)
assert.match(
  longStockPlanReaderSource,
  /\.in\('request_item_id', Array\.from\(new Set\(eligibleItems\.map\(\(item\) => item\.id\)\)\)\)/u,
  'The trusted cutting-plan query must remain constrained to already-authorized request-item ids',
)
assert.match(
  longStockPlanReaderSource,
  /eligibleKeys\.has\(`\$\{item\.request_item_table\}:\$\{item\.request_item_id\}`\)/u,
  'The trusted cutting-plan result must be filtered by table and item id',
)

const longStockSchemaMigration = readFileSync(
  new URL('../supabase/migrations/20260816160000_long_stock_cutting_plan_schema.sql', import.meta.url),
  'utf8',
)
assert.match(
  longStockSchemaMigration,
  /revoke all on table public\.long_stock_cutting_plan_items from public, anon, authenticated;/u,
  'The fix must not expose cutting-plan items directly to authenticated users',
)
assert.doesNotMatch(
  longStockSchemaMigration,
  /grant select on table public\.long_stock_cutting_plan_items to authenticated;/u,
  'Authenticated users must not receive a direct cutting-plan table grant',
)

assert.equal(
  getRequestItemSelect('request_pipe'),
  '*, materials(id, name), steel_types(name)',
  'pipe order rows must load the human-readable steel grade'
)
assert.equal(
  getRequestItemSelect('request_knives'),
  '*, materials(id, name)',
  'the steel type relation must only be added to pipe order queries'
)
assert.deepEqual(
  withPipeSteelGrade(
    'request_pipe',
    { steel_types: { name: 'S355' } },
    [
      { label: 'Тип трубы', value: 'square' },
      { label: 'Размер', value: '40x40' },
      { label: 'Стенка', value: '10' },
    ]
  ),
  [
    { label: 'Тип трубы', value: 'square' },
    { label: 'Марка', value: 'S355' },
    { label: 'Размер', value: '40x40' },
    { label: 'Стенка', value: '10' },
  ],
  'pipe cards must show the steel grade selected in the request'
)

assert.equal(formatSupplyOrderCharacteristicValue('request_pipe', 'pipe_type', 'square'), 'Квадратная')
assert.equal(formatSupplyOrderCharacteristicValue('request_pipe', 'pipe_type', 'rectangular'), 'Прямоугольная')
assert.equal(formatSupplyOrderCharacteristicValue('request_pipe', 'pipe_type', 'round'), 'Круглая')
assert.equal(formatSupplyOrderCharacteristicValue('request_pipe', 'pipe_type', 'wire'), 'Проволока')
assert.equal(formatSupplyOrderCharacteristicValue('request_pipe', 'pipe_type', 'legacy-value'), 'Не указан')
assert.equal(formatSupplyOrderCharacteristicValue('request_knives', 'knife_type', 'standard'), null)
assert.equal(formatSupplyOrderCharacteristicValue('request_knives', 'knife_bevel_count', 1), '1 скос')
assert.equal(formatSupplyOrderCharacteristicValue('request_knives', 'knife_bevel_count', 2), '2 скоса')
assert.equal(formatSupplyOrderCharacteristicValue('request_knives', 'knife_bevel_count', null), 'не указан')
assert.match(
  supplyOrdersAction,
  /request_knives:\s*\[[\s\S]*\['Скос', 'knife_bevel_count'\]/u,
  'knife bevel must be part of supply aggregation and visible characteristics',
)

const baseFilters: OrderFiltersState = {
  query: '',
  period: 'all',
  supplier: 'all',
  category: 'all',
  status: 'all',
  attention: 'all',
  sort: 'delivery_asc',
}

const items = [
  makeItem({ id: 'late', item_name: 'Лист 8 мм', machine_name: 'Машина Б', supplier_id: 'supplier-b', supplier_name: 'Металл Б', target_delivery_date: '2026-07-24', to_order: 8 }),
  makeItem({ id: 'early', item_name: 'Труба 40×20', machine_name: 'Машина А', category: 'pipe', supplier_id: 'supplier-a', supplier_name: 'Металл А', target_delivery_date: '2026-07-15', to_order: 3 }),
  makeItem({ id: 'missing', item_name: 'Сетка', machine_name: 'Машина В', category: 'mesh', supplier_id: null, supplier_name: null, target_delivery_date: null, to_order: 5 }),
]

assert.deepEqual(
  filterSupplyOrderItems(items, { ...baseFilters, query: 'машина а' }, new Date('2026-07-14T12:00:00')).map((item) => item.id),
  ['early'],
  'search must match machine names without changing DTOs'
)
assert.deepEqual(
  filterSupplyOrderItems(items, { ...baseFilters, period: 'this_week' }, new Date('2026-07-14T12:00:00')).map((item) => item.id),
  ['early'],
  'week filter must use target delivery date'
)
assert.deepEqual(
  filterSupplyOrderItems(items, { ...baseFilters, attention: 'needs_supplier' }).map((item) => item.id),
  ['missing'],
  'attention filter must surface rows without supplier'
)

const originalIds = items.map((item) => item.id)
const sorted = sortSupplyOrderItems(items, 'delivery_desc')
assert.deepEqual(sorted.map((item) => item.id), ['late', 'early', 'missing'], 'date sorting must keep undated rows last')
assert.deepEqual(items.map((item) => item.id), originalIds, 'sorting must never mutate server DTO order')
assert.deepEqual(
  groupSupplyOrderItems(sortSupplyOrderItems(items, 'delivery_asc'), 'delivery_asc').map((group) => group.dateKey),
  ['2026-07-15', '2026-07-24', 'no_supplier'],
  'special business groups must remain after sorting'
)

const aggregate = makeAggregate()
const closedAggregate = { ...aggregate, id: 'closed', ordered_count: 0, delivered_count: 1 }
assert.deepEqual(filterAndSortAggregates([aggregate, closedAggregate], {
  query: '', supplier: 'all', category: 'all', status: 'open', sort: 'date_asc',
}).map((row) => row.id), ['aggregate'], 'the default open view must hide fully accepted deliveries')
assert.deepEqual(filterAndSortAggregates([aggregate, closedAggregate], {
  query: '', supplier: 'all', category: 'all', status: 'all', sort: 'date_asc',
}).map((row) => row.id), ['aggregate', 'closed'], 'the all view must preserve open and closed deliveries')
assert.equal(filterAndSortAggregates([aggregate], {
  query: 'машина а', supplier: 'all', category: 'all', status: 'all', sort: 'date_asc',
}).length, 1, 'aggregate search must include nested machine names')
assert.equal(filterAndSortAggregates([aggregate], {
  query: '', supplier: 'supplier-a', category: 'all', status: 'ordered', sort: 'date_asc',
}).length, 1, 'aggregate filters must inspect nested supplier and status data')
assert.equal(filterAndSortAggregates([{ ...aggregate, unscheduled_quantity: 3 }], {
  query: '', supplier: 'all', category: 'all', status: 'unscheduled', sort: 'date_asc',
}).length, 0, 'an ordinary unscheduled request must not appear under redelivery')
assert.equal(filterAndSortAggregates([closedAggregate], {
  query: '', supplier: 'all', category: 'all', status: 'closed', sort: 'date_asc',
}).length, 1, 'fully accepted material must appear under closed deliveries')

const partiallyAccepted = makePartiallyAcceptedAggregate()
assert.equal(filterAndSortAggregates([partiallyAccepted], {
  query: '', supplier: 'all', category: 'all', status: 'unscheduled', sort: 'date_asc',
}).length, 1, 'a receipt of one sheet from ten must appear under redelivery')

const prioritized = partitionSupplyOrderAggregatesByRedelivery([
  aggregate,
  partiallyAccepted,
  { ...aggregate, id: 'later-date', planned_material_date: '2026-08-01' },
])
assert.deepEqual(
  prioritized.redeliveries.map((row) => row.id),
  ['partially-accepted|redelivery'],
  'a partially accepted material with nine units left must be placed in redelivery'
)
assert.deepEqual(
  prioritized.regular.map((row) => row.id),
  ['aggregate', 'later-date'],
  'ordinary materials must remain in the dated sections'
)

const splitScheduleAggregate = makeDateScheduleAggregate([
  makeDeliverySchedule({
    id: 'planned-july',
    delivery_date: '2026-07-31',
    quantity: 3_000,
    status: 'planned',
    received_quantity: null,
    allocated_quantity: null,
    allocated_physical_quantity: null,
    delivered_at: null,
  }),
  makeDeliverySchedule({
    id: 'delivered-august',
    delivery_date: '2026-08-02',
    quantity: 5_000,
    received_quantity: 5_000,
    allocated_quantity: 4_000,
    allocated_physical_quantity: 5_000,
  }),
  makeDeliverySchedule({
    id: 'cancelled-july',
    delivery_date: '2026-07-29',
    quantity: 9_000,
    status: 'cancelled',
    received_quantity: null,
    allocated_quantity: null,
    allocated_physical_quantity: null,
    delivered_at: null,
  }),
], { plannedMaterialDate: '2026-08-28', unscheduledQuantity: 1_000 })
const supplyDateGroups = groupSupplyOrderAggregatesBySupplyDate([splitScheduleAggregate], 'date_asc')
assert.deepEqual(
  supplyDateGroups.map((group) => group.dateKey),
  ['2026-07-31', '2026-08-02', '2026-08-28'],
  'supplier schedule dates must replace the production date, while an uncovered remainder falls back to production plan',
)
assert.deepEqual(
  supplyDateGroups.map((group) => ({
    quantity: group.rows[0].quantity,
    planned: group.rows[0].plannedQuantity,
    delivered: group.rows[0].deliveredQuantity,
    unscheduled: group.rows[0].unscheduledQuantity,
  })),
  [
    { quantity: 3_000, planned: 3_000, delivered: 0, unscheduled: 0 },
    { quantity: 5_000, planned: 0, delivered: 4_000, unscheduled: 0 },
    { quantity: 1_000, planned: 0, delivered: 0, unscheduled: 1_000 },
  ],
  'every date card must expose only its scheduled, accepted, and uncovered quantities',
)
assert.equal(
  new Set(supplyDateGroups.flatMap((group) => group.rows.map((row) => row.id))).size,
  3,
  'date slices of the same aggregate must have distinct stable ids',
)
assert.equal(
  supplyDateGroups.every((group) => group.rows[0].aggregate === splitScheduleAggregate),
  true,
  'date slicing must keep the original aggregate for totals and full-schedule editing',
)

const mergedDateGroups = groupSupplyOrderAggregatesBySupplyDate([
  makeDateScheduleAggregate([
    makeDeliverySchedule({
      id: 'same-date-planned',
      delivery_date: '2026-08-28',
      quantity: 2_000,
      status: 'planned',
      received_quantity: null,
      allocated_quantity: null,
      allocated_physical_quantity: null,
      delivered_at: null,
    }),
    makeDeliverySchedule({
      id: 'same-date-delivered',
      delivery_date: '2026-08-28',
      quantity: 3_000,
      received_quantity: 2_500,
      allocated_quantity: 2_500,
      allocated_physical_quantity: 2_500,
    }),
  ], { plannedMaterialDate: '2026-08-28', unscheduledQuantity: 1_000 }),
], 'date_asc')
assert.equal(mergedDateGroups.length, 1, 'schedules and fallback remainder on the same date must share one card')
assert.deepEqual(
  {
    quantity: mergedDateGroups[0].rows[0].quantity,
    planned: mergedDateGroups[0].rows[0].plannedQuantity,
    delivered: mergedDateGroups[0].rows[0].deliveredQuantity,
    unscheduled: mergedDateGroups[0].rows[0].unscheduledQuantity,
  },
  { quantity: 6_000, planned: 2_000, delivered: 2_500, unscheduled: 1_000 },
  'same-date schedule parts must be merged without losing their separate states',
)

assert.deepEqual(
  groupSupplyOrderAggregatesBySupplyDate([
    makeDateScheduleAggregate([], { plannedMaterialDate: null, unscheduledQuantity: 4 }),
  ], 'date_asc').map((group) => group.dateKey),
  ['no_supply_date'],
  'an unscheduled material without production date must stay visible in the no-date group',
)

const aggregateBatchSchedule = makeAggregate()
const aggregateBatchDelivery = makeDeliverySchedule({
  id: 'aggregate-batch-delivery',
  delivery_date: '2026-08-24',
  quantity: 16_000,
  status: 'planned',
  received_quantity: null,
  allocated_quantity: null,
  allocated_physical_quantity: null,
  planned_piece_length_mm: 8_000,
  planned_piece_count: 2,
  delivered_at: null,
})
aggregateBatchSchedule.planned_material_date = '2026-08-27'
aggregateBatchSchedule.category = 'circle'
aggregateBatchSchedule.quantity = 16_000
aggregateBatchSchedule.requested_quantity = 16_000
aggregateBatchSchedule.weight_kg = 160
aggregateBatchSchedule.item_count = 2
aggregateBatchSchedule.machine_count = 2
aggregateBatchSchedule.planned_schedule_quantity = 16_000
aggregateBatchSchedule.unscheduled_quantity = 0
aggregateBatchSchedule.factories = [{
  ...aggregateBatchSchedule.factories[0],
  quantity: 16_000,
  requested_quantity: 16_000,
  weight_kg: 160,
  item_count: 2,
  machine_count: 2,
  planned_schedule_quantity: 16_000,
  unscheduled_quantity: 0,
  production_date: '2026-08-27',
  supply_delivery_date: '2026-08-24',
  delivery_schedule_count: 1,
  has_delivery_schedules: true,
  items: [
    makeAggregateSourceItem({
      id: 'aggregate-anchor',
      machine_id: 'machine-a',
      machine_name: 'Машина А',
      quantity: 8_000,
      weight_kg: 80,
      order_status: 'ordered',
      supply_delivery_date: '2026-08-24',
      planned_schedule_quantity: 16_000,
      unscheduled_quantity: 0,
      delivery_schedules: [aggregateBatchDelivery],
    }),
    makeAggregateSourceItem({
      id: 'aggregate-follower',
      machine_id: 'machine-b',
      machine_name: 'Машина Б',
      quantity: 8_000,
      weight_kg: 80,
      order_status: 'ordered',
      supply_delivery_date: '2026-08-27',
      planned_schedule_quantity: 0,
      unscheduled_quantity: 8_000,
      delivery_schedules: [],
    }),
  ],
}]
const aggregateBatchGroups = groupSupplyOrderAggregatesBySupplyDate([aggregateBatchSchedule], 'date_asc')
assert.deepEqual(
  aggregateBatchGroups.map((group) => group.dateKey),
  ['2026-08-24'],
  'a fully covered aggregate schedule must not repeat an anchor follower as unscheduled on production date',
)
assert.deepEqual(
  aggregateBatchGroups.map((group) => ({
    quantity: group.rows[0].quantity,
    planned: group.rows[0].plannedQuantity,
    unscheduled: group.rows[0].unscheduledQuantity,
  })),
  [{ quantity: 16_000, planned: 16_000, unscheduled: 0 }],
  'the aggregate schedule date must remain fully covered when one anchor row represents several requests',
)

assert.equal(isSupplyOrderBarMaterial({ category: 'knives', unit: 'мм' }), true)
assert.equal(isSupplyOrderBarMaterial({ category: 'circle', unit: 'мм' }), true)
assert.equal(isSupplyOrderBarMaterial({ category: 'pipe', unit: 'мм' }), true)
assert.equal(isSupplyOrderBarMaterial({ category: 'pipe', unit: 'кг' }), false)

const partialItem = partiallyAccepted.factories[0].items[0]
assert.equal(isSupplyOrderRedeliveryItem(partialItem), true, 'partial receipt must be recognized from actual schedule quantities')
assert.deepEqual(getSupplyOrderRedeliveryDates(partialItem), ['2026-07-21'], 'the original promised date must be preserved')
assert.deepEqual(summarizeSupplyOrderRedeliveryMachineRoutes([partialItem]), [{
  machineId: 'machine-a',
  machineName: 'Машина А',
  quantity: 9,
  weightKg: 90,
  itemCount: 1,
  pendingCount: 0,
  orderedCount: 1,
  originalDeliveryDates: ['2026-07-21'],
}], 'redelivery card must show the uncovered quantity and original date for its machine')

const mixed = makeMixedRedeliveryAggregate()
const splitMixed = partitionSupplyOrderAggregatesByRedelivery([mixed])
assert.deepEqual(
  splitMixed.redeliveries[0].factories[0].items.map((item) => item.machine_id),
  ['machine-a'],
  'redelivery projection must contain only the machine that received less than promised'
)
assert.deepEqual(
  splitMixed.regular[0].factories[0].items.map((item) => item.machine_id),
  ['machine-b'],
  'a machine that never had a partial receipt must stay outside redelivery'
)
assert.equal(
  isSupplyOrderRedeliveryItem(makeAggregateSourceItem({
    quantity: 10,
    unscheduled_quantity: 9,
    delivery_schedules: [makeDeliverySchedule({ quantity: 1, received_quantity: 1, allocated_quantity: 1 })],
  })),
  false,
  'a fully received one-unit schedule must not turn the other nine unscheduled units into redelivery'
)
assert.equal(
  isSupplyOrderRedeliveryItem(makeAggregateSourceItem({
    quantity: 10,
    unscheduled_quantity: 4,
    delivery_schedules: [makeDeliverySchedule({
      quantity: 9,
      received_quantity: 5,
      allocated_quantity: 5,
      receipt_parent_schedule_id: 'parent-schedule',
    })],
  })),
  false,
  'receipt allocation child rows must not be mistaken for a supplier promise'
)

const machineRoutes = summarizeSupplyOrderMachineRoutes([
  makeAggregateSourceItem({ id: 'machine-a-1', machine_id: 'machine-a', machine_name: 'Машина А', quantity: 3, weight_kg: 30, order_status: 'pending' }),
  makeAggregateSourceItem({ id: 'machine-a-2', machine_id: 'machine-a', machine_name: 'Машина А', quantity: 2, weight_kg: 20, order_status: 'ordered' }),
  makeAggregateSourceItem({ id: 'machine-b-1', machine_id: 'machine-b', machine_name: 'Машина Б', quantity: 3, weight_kg: 30, order_status: 'ordered' }),
  makeAggregateSourceItem({ id: 'machine-b-2', machine_id: 'machine-b', machine_name: 'Машина Б', quantity: 1, weight_kg: null, order_status: 'ordered' }),
])
assert.deepEqual(machineRoutes, [
  { machineId: 'machine-a', machineName: 'Машина А', quantity: 5, weightKg: 50, itemCount: 2, pendingCount: 1, orderedCount: 1 },
  { machineId: 'machine-b', machineName: 'Машина Б', quantity: 4, weightKg: null, itemCount: 2, pendingCount: 0, orderedCount: 2 },
], 'material card must show every destination machine and avoid displaying partial weight as a full machine total')

const unscheduledMachineRoutes = summarizeSupplyOrderUnscheduledMachineRoutes([
  makeAggregateSourceItem({ id: 'machine-a', machine_id: 'machine-a', machine_name: 'Машина А', quantity: 10, unscheduled_quantity: 9, weight_kg: 100, order_status: 'ordered' }),
  makeAggregateSourceItem({ id: 'machine-b', machine_id: 'machine-b', machine_name: 'Машина Б', quantity: 4, unscheduled_quantity: 0, weight_kg: 40, order_status: 'ordered' }),
  makeAggregateSourceItem({ id: 'machine-c', machine_id: 'machine-c', machine_name: 'Машина В', quantity: 3, unscheduled_quantity: 2, weight_kg: 30, order_status: 'pending' }),
])
assert.deepEqual(unscheduledMachineRoutes, [
  { machineId: 'machine-a', machineName: 'Машина А', quantity: 9, weightKg: 90, itemCount: 1, pendingCount: 0, orderedCount: 1 },
  { machineId: 'machine-c', machineName: 'Машина В', quantity: 2, weightKg: 20, itemCount: 1, pendingCount: 1, orderedCount: 0 },
], 'no-schedule section must preserve the uncovered quantity and proportional weight for each destination machine')

assert.deepEqual(
  summarizeSupplyOrderUnscheduledMachineRoutes([
    makeAggregateSourceItem({
      id: 'aggregate-follower',
      machine_id: 'machine-b',
      machine_name: 'Машина Б',
      quantity: 8_000,
      unscheduled_quantity: 8_000,
      weight_kg: 80,
      order_status: 'ordered',
    }),
  ], 4_000),
  [{
    machineId: 'machine-b',
    machineName: 'Машина Б',
    quantity: 4_000,
    weightKg: 40,
    itemCount: 1,
    pendingCount: 0,
    orderedCount: 1,
  }],
  'machine hints must be capped by the authoritative aggregate remainder',
)
assert.deepEqual(
  summarizeSupplyOrderUnscheduledMachineRoutes(aggregateBatchSchedule.factories[0].items, 0),
  [],
  'fully covered aggregate bar schedules must not leave a false machine remainder',
)

const history = [
  makeHistory({ id: 'old', accepted_at: '2026-07-12T10:00:00Z', supplier_name: 'Металл А', quantity: 2 }),
  makeHistory({ id: 'new', accepted_at: '2026-07-14T10:00:00Z', supplier_name: 'Металл Б', quantity: 4 }),
]
assert.deepEqual(filterAndSortHistory(history, {
  query: '', supplier: 'all', category: 'all', sort: 'accepted_desc',
}).map((item) => item.id), ['new', 'old'], 'history must default to newest acceptance first')
assert.deepEqual(filterAndSortHistory(history, {
  query: '', supplier: 'Металл А', category: 'all', sort: 'accepted_desc',
}).map((item) => item.id), ['old'], 'history supplier filter must preserve accepted record')

console.log('supply order view regression: ok')

function makeItem(patch: Partial<SupplyOrderItem>): SupplyOrderItem {
  return {
    table: 'request_sheet',
    id: 'item',
    machine_name: 'Машина',
    machine_id: 'machine-id',
    category: 'sheet_metal',
    item_name: 'Лист',
    to_order: 1,
    requested_quantity: 1,
    reserved_quantity: 0,
    secondary_requested_quantity: null,
    secondary_reserved_quantity: null,
    unit: 'шт.',
    supplier_name: null,
    supplier_id: null,
    material_id: 'material-id',
    material_variant_id: null,
    planned_material_date: '2026-07-20',
    target_delivery_date: null,
    is_custom_delivery_date: false,
    request_id: 'request-id',
    order_status: 'pending',
    delivered_at: null,
    stock_available: 0,
    stock_unit: 'шт.',
    stock_items: [],
    calculated_weight_kg: null,
    reservation_id: null,
    selected_piece_length_mm: null,
    delivery_schedules: [],
    ...patch,
    long_stock_purchase_plan: patch.long_stock_purchase_plan ?? null,
  }
}

function makeAggregate(): SupplyOrderAggregate {
  return {
    id: 'aggregate',
    planned_material_date: '2026-07-20',
    category: 'sheet_metal',
    item_name: 'Лист 8 мм',
    unit: 'шт.',
    material_id: 'material-id',
    material_variant_id: null,
    characteristics: [{ label: 'Толщина', value: '8 мм' }],
    quantity: 8,
    requested_quantity: 8,
    reserved_quantity: 0,
    weight_kg: 100,
    item_count: 1,
    machine_count: 1,
    pending_count: 0,
    ordered_count: 1,
    delivered_count: 0,
    planned_schedule_quantity: 8,
    delivered_schedule_quantity: 0,
    unscheduled_quantity: 0,
    factories: [{
      factory_id: 'factory-id',
      factory_name: 'Берегово',
      quantity: 8,
      requested_quantity: 8,
      reserved_quantity: 0,
      weight_kg: 100,
      item_count: 1,
      machine_count: 1,
      pending_count: 0,
      ordered_count: 1,
      delivered_count: 0,
      planned_schedule_quantity: 8,
      delivered_schedule_quantity: 0,
      unscheduled_quantity: 0,
      delivery_schedule_count: 1,
      has_delivery_schedules: true,
      production_date: '2026-07-20',
      supply_delivery_date: '2026-07-18',
      has_mixed_supply_delivery_dates: false,
      suppliers: [{ id: 'supplier-a', name: 'Металл А', item_count: 1, pending_count: 0, ordered_count: 1, delivered_count: 0 }],
      items: [{
        table: 'request_sheet', id: 'item', request_id: 'request-id', machine_id: 'machine-id', machine_name: 'Машина А',
        quantity: 8, unit: 'шт.', supplier_id: 'supplier-a', supplier_name: 'Металл А', weight_kg: 100,
        order_status: 'ordered', supply_delivery_date: '2026-07-18', planned_schedule_quantity: 8,
        delivered_schedule_quantity: 0, unscheduled_quantity: 0, delivery_schedules: [],
        long_stock_purchase_plan: null,
      }],
    }],
  }
}

function makePartiallyAcceptedAggregate(): SupplyOrderAggregate {
  const base = makeAggregate()
  const item = makeAggregateSourceItem({
    id: 'partially-accepted-item',
    machine_id: 'machine-a',
    machine_name: 'Машина А',
    quantity: 10,
    supplier_id: 'supplier-a',
    supplier_name: 'Металл А',
    weight_kg: 100,
    order_status: 'ordered',
    planned_schedule_quantity: 0,
    delivered_schedule_quantity: 1,
    unscheduled_quantity: 9,
    delivery_schedules: [makeDeliverySchedule({
      delivery_date: '2026-07-21',
      quantity: 10,
      received_quantity: 1,
      allocated_quantity: 1,
      allocated_physical_quantity: 1,
    })],
  })

  return {
    ...base,
    id: 'partially-accepted',
    quantity: 10,
    requested_quantity: 10,
    weight_kg: 100,
    planned_schedule_quantity: 0,
    delivered_schedule_quantity: 1,
    unscheduled_quantity: 9,
    factories: [{
      ...base.factories[0],
      quantity: 10,
      requested_quantity: 10,
      weight_kg: 100,
      planned_schedule_quantity: 0,
      delivered_schedule_quantity: 1,
      unscheduled_quantity: 9,
      supply_delivery_date: null,
      items: [item],
    }],
  }
}

function makeDateScheduleAggregate(
  schedules: SupplyOrderDeliverySchedule[],
  options: { plannedMaterialDate: string | null; unscheduledQuantity: number },
): SupplyOrderAggregate {
  const base = makeAggregate()
  const plannedQuantity = schedules
    .filter((schedule) => schedule.status === 'planned')
    .reduce((sum, schedule) => sum + Number(schedule.quantity || 0), 0)
  const deliveredQuantity = schedules
    .filter((schedule) => schedule.status === 'delivered')
    .reduce((sum, schedule) => sum + Number(schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity ?? 0), 0)
  const activeDates = Array.from(new Set(schedules
    .filter((schedule) => schedule.status !== 'cancelled')
    .map((schedule) => schedule.delivery_date)))
  const quantity = schedules
    .filter((schedule) => schedule.status !== 'cancelled')
    .reduce((sum, schedule) => sum + Number(schedule.quantity || 0), options.unscheduledQuantity)
  const item = makeAggregateSourceItem({
    id: 'date-schedule-item',
    machine_id: 'machine-a',
    machine_name: 'Машина А',
    quantity,
    supplier_id: 'supplier-a',
    supplier_name: 'Металл А',
    weight_kg: quantity,
    order_status: plannedQuantity > 0 ? 'ordered' : 'delivered',
    supply_delivery_date: activeDates.length === 1 ? activeDates[0] : null,
    planned_schedule_quantity: plannedQuantity,
    delivered_schedule_quantity: deliveredQuantity,
    unscheduled_quantity: options.unscheduledQuantity,
    delivery_schedules: schedules,
  })

  return {
    ...base,
    id: `date-schedule:${options.plannedMaterialDate || 'none'}`,
    planned_material_date: options.plannedMaterialDate,
    quantity,
    requested_quantity: quantity,
    weight_kg: quantity,
    planned_schedule_quantity: plannedQuantity,
    delivered_schedule_quantity: deliveredQuantity,
    unscheduled_quantity: options.unscheduledQuantity,
    factories: [{
      ...base.factories[0],
      quantity,
      requested_quantity: quantity,
      weight_kg: quantity,
      planned_schedule_quantity: plannedQuantity,
      delivered_schedule_quantity: deliveredQuantity,
      unscheduled_quantity: options.unscheduledQuantity,
      delivery_schedule_count: activeDates.length,
      has_delivery_schedules: activeDates.length > 0,
      production_date: options.plannedMaterialDate,
      supply_delivery_date: activeDates.length === 1 ? activeDates[0] : null,
      has_mixed_supply_delivery_dates: activeDates.length > 1,
      items: [item],
    }],
  }
}

function makeMixedRedeliveryAggregate(): SupplyOrderAggregate {
  const partial = makePartiallyAcceptedAggregate()
  const regularItem = makeAggregateSourceItem({
    id: 'ordinary-unscheduled-item',
    machine_id: 'machine-b',
    machine_name: 'Машина Б',
    quantity: 5,
    supplier_id: null,
    supplier_name: null,
    weight_kg: 50,
    order_status: 'pending',
    planned_schedule_quantity: 0,
    delivered_schedule_quantity: 0,
    unscheduled_quantity: 5,
    delivery_schedules: [],
  })

  return {
    ...partial,
    id: 'mixed',
    quantity: 15,
    requested_quantity: 15,
    weight_kg: 150,
    item_count: 2,
    machine_count: 2,
    pending_count: 1,
    unscheduled_quantity: 14,
    factories: [{
      ...partial.factories[0],
      quantity: 15,
      requested_quantity: 15,
      weight_kg: 150,
      item_count: 2,
      machine_count: 2,
      pending_count: 1,
      unscheduled_quantity: 14,
      suppliers: [
        ...partial.factories[0].suppliers,
        { id: null, name: 'Без поставщика', item_count: 1, pending_count: 1, ordered_count: 0, delivered_count: 0 },
      ],
      items: [...partial.factories[0].items, regularItem],
    }],
  }
}

function makeAggregateSourceItem(
  patch: Partial<SupplyOrderAggregate['factories'][number]['items'][number]>
): SupplyOrderAggregate['factories'][number]['items'][number] {
  return {
    table: 'request_sheet',
    id: 'item',
    request_id: 'request-id',
    machine_id: 'machine-id',
    machine_name: 'Машина',
    quantity: 1,
    unit: 'шт.',
    supplier_id: null,
    supplier_name: null,
    weight_kg: null,
    order_status: 'pending',
    supply_delivery_date: null,
    planned_schedule_quantity: 0,
    delivered_schedule_quantity: 0,
    unscheduled_quantity: 1,
    delivery_schedules: [],
    ...patch,
    long_stock_purchase_plan: patch.long_stock_purchase_plan ?? null,
  }
}

function makeDeliverySchedule(patch: Partial<SupplyOrderDeliverySchedule>): SupplyOrderDeliverySchedule {
  return {
    id: 'schedule-id',
    delivery_date: '2026-07-21',
    quantity: 1,
    unit: 'шт.',
    supplier_id: 'supplier-a',
    supplier_name: 'Металл А',
    change_reason: null,
    status: 'delivered',
    received_quantity: 1,
    allocated_quantity: 1,
    allocated_physical_quantity: 1,
    planned_piece_length_mm: null,
    planned_piece_count: null,
    received_piece_length_mm: null,
    received_piece_count: null,
    allocated_piece_count: null,
    excess_quantity: 0,
    receipt_parent_schedule_id: null,
    delivered_at: '2026-07-21T10:00:00Z',
    received_by: 'user-id',
    created_at: '2026-07-20T10:00:00Z',
    updated_at: '2026-07-21T10:00:00Z',
    ...patch,
  }
}

function makeHistory(patch: Partial<SupplyOrderHistoryItem>): SupplyOrderHistoryItem {
  return {
    id: 'history', source: 'item', table: 'request_sheet', item_id: 'item', schedule_id: null,
    machine_id: 'machine-id', machine_name: 'Машина', request_id: 'request-id', category: 'sheet_metal',
    item_name: 'Лист', characteristics: [], supplier_name: null, planned_material_date: '2026-07-20',
    planned_delivery_date: '2026-07-18', accepted_at: null, quantity: 1, unit: 'шт.', weight_kg: null,
    ...patch,
  }
}
