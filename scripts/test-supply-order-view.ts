import assert from 'node:assert/strict'
import type { SupplyOrderAggregate, SupplyOrderHistoryItem, SupplyOrderItem } from '@/lib/actions/supply-orders'
import {
  filterAndSortAggregates,
  filterAndSortHistory,
  filterSupplyOrderItems,
  groupSupplyOrderItems,
  partitionSupplyOrderAggregatesBySchedule,
  summarizeSupplyOrderMachineRoutes,
  summarizeSupplyOrderUnscheduledMachineRoutes,
  sortSupplyOrderItems,
  type OrderFiltersState,
} from '@/components/features/supply-orders/supply-order-view'

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
assert.equal(filterAndSortAggregates([aggregate], {
  query: 'машина а', supplier: 'all', category: 'all', status: 'all', sort: 'date_asc',
}).length, 1, 'aggregate search must include nested machine names')
assert.equal(filterAndSortAggregates([aggregate], {
  query: '', supplier: 'supplier-a', category: 'all', status: 'ordered', sort: 'date_asc',
}).length, 1, 'aggregate filters must inspect nested supplier and status data')
assert.equal(filterAndSortAggregates([{ ...aggregate, unscheduled_quantity: 3 }], {
  query: '', supplier: 'all', category: 'all', status: 'unscheduled', sort: 'date_asc',
}).length, 1, 'partial receipt remainder must appear under the no-arrival-date tab')
assert.equal(filterAndSortAggregates([{ ...aggregate, ordered_count: 0, delivered_count: 1 }], {
  query: '', supplier: 'all', category: 'all', status: 'closed', sort: 'date_asc',
}).length, 1, 'fully accepted material must appear under closed deliveries')

const partiallyAccepted = {
  ...aggregate,
  id: 'partially-accepted',
  quantity: 10,
  planned_schedule_quantity: 1,
  delivered_schedule_quantity: 1,
  unscheduled_quantity: 9,
}
const prioritized = partitionSupplyOrderAggregatesBySchedule([
  aggregate,
  partiallyAccepted,
  { ...aggregate, id: 'later-date', planned_material_date: '2026-08-01' },
])
assert.deepEqual(
  prioritized.unscheduled.map((row) => row.id),
  ['partially-accepted'],
  'a partially accepted material with nine units left must be placed in the no-schedule section'
)
assert.deepEqual(
  prioritized.scheduled.map((row) => row.id),
  ['aggregate', 'later-date'],
  'only fully scheduled materials may remain in the dated sections'
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
      }],
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
