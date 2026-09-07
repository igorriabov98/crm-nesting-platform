import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMaterialReceiptBatchCalls,
  projectMaterialReceivingGroups,
  type MaterialReceivingProjectionRow,
  type ReceivingTransportContext,
} from './receiving-batches'

function row(overrides: Partial<MaterialReceivingProjectionRow> = {}): MaterialReceivingProjectionRow {
  return {
    key: 'request_paint:item-1:schedule-1',
    aggregate_identity: 'request_paint|paint|material-1|кг|Тип краски:ral 6050|RAL:6050|Финиш:матовый',
    schedule_id: 'schedule-1',
    table: 'request_paint',
    id: 'item-1',
    request_id: 'request-1',
    machine_id: 'machine-1',
    machine_name: 'тест 5/09',
    machine_specification_number: '5/09',
    supplier_id: 'supplier-1',
    supplier_name: 'Varian',
    planned_quantity: 22,
    weight_kg: null,
    is_virtual_schedule: false,
    factory_id: 'factory-1',
    factory_name: 'Ужгород',
    delivery_date: '2026-09-10',
    unit: 'кг',
    category: 'paint',
    is_whole_bar: false,
    item_name: 'ral 6050',
    material_id: 'material-1',
    material_variant_id: null,
    characteristics: [
      { label: 'Тип краски', value: 'ral 6050' },
      { label: 'RAL', value: '6050' },
      { label: 'Финиш', value: 'матовый' },
    ],
    planned_piece_length_mm: null,
    planned_piece_count: null,
    purchase_components: [],
    ...overrides,
  }
}

function transport(scheduleId: string, overrides: Partial<ReceivingTransportContext> = {}): ReceivingTransportContext {
  return {
    schedule_id: scheduleId,
    trip_id: 'trip-1009',
    delivery_stop_id: 'stop-uzhhorod',
    trip_name: '1009УЖУЖ',
    planned_arrival_at: '2026-09-10T07:00:00.000Z',
    arrived_at: null,
    ...overrides,
  }
}

test('one arrival combines the technical 22+3 kg paint rows', () => {
  const groups = projectMaterialReceivingGroups([
    row(),
    row({ key: 'request_paint:item-1:schedule-2', schedule_id: 'schedule-2', planned_quantity: 3 }),
  ], [transport('schedule-1')])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].arrivals.length, 1)
  assert.equal(groups[0].arrivals[0].items.length, 1)
  assert.equal(groups[0].arrivals[0].items[0].planned_quantity, 25)
  assert.deepEqual(groups[0].arrivals[0].items[0].schedule_ids, ['schedule-1', 'schedule-2'])
})

test('one arrival combines the technical 1+1 sheet rows', () => {
  const sheetIdentity = 'request_sheet_metal|sheet_metal|sheet-1|шт|S235|1200x1200|30'
  const groups = projectMaterialReceivingGroups([
    row({
      key: 'sheet:item-1:schedule-3', aggregate_identity: sheetIdentity, schedule_id: 'schedule-3',
      table: 'request_sheet_metal', id: 'sheet-item-1', category: 'sheet_metal', item_name: 'Листовой металл',
      unit: 'шт', planned_quantity: 1,
    }),
    row({
      key: 'sheet:item-1:schedule-4', aggregate_identity: sheetIdentity, schedule_id: 'schedule-4',
      table: 'request_sheet_metal', id: 'sheet-item-1', category: 'sheet_metal', item_name: 'Листовой металл',
      unit: 'шт', planned_quantity: 1,
    }),
  ], [transport('schedule-3')])

  assert.equal(groups[0].arrivals[0].items[0].planned_quantity, 2)
  assert.equal(groups[0].arrivals[0].items[0].sources.length, 2)
})

test('different trips or unloading stops remain separate physical arrivals', () => {
  const groups = projectMaterialReceivingGroups([
    row(),
    row({ key: 'request_paint:item-1:schedule-2', schedule_id: 'schedule-2', planned_quantity: 3 }),
  ], [
    transport('schedule-1'),
    transport('schedule-2', { trip_id: 'trip-1010', delivery_stop_id: 'stop-2', trip_name: '1010УЖУЖ' }),
  ])

  assert.equal(groups[0].arrivals.length, 2)
  assert.deepEqual(groups[0].arrivals.map((arrival) => arrival.items[0].planned_quantity), [22, 3])
})

test('actual arrival enriches the batch without changing its composition', () => {
  const groups = projectMaterialReceivingGroups([
    row(),
    row({ key: 'request_paint:item-1:schedule-2', schedule_id: 'schedule-2', planned_quantity: 3 }),
  ], [
    transport('schedule-1', { arrived_at: '2026-09-10T07:12:00.000Z' }),
    transport('schedule-2', { arrived_at: '2026-09-10T07:12:00.000Z' }),
  ])

  assert.equal(groups[0].arrivals.length, 1)
  assert.equal(groups[0].arrivals[0].arrived_at, '2026-09-10T07:12:00.000Z')
  assert.equal(groups[0].arrivals[0].items[0].planned_quantity, 25)
})

test('different suppliers combine only when both are linked to the same arrival', () => {
  const linked = projectMaterialReceivingGroups([
    row(),
    row({
      key: 'request_paint:item-2:schedule-2', schedule_id: 'schedule-2', id: 'item-2',
      supplier_id: 'supplier-2', supplier_name: 'АВ метал груп', planned_quantity: 3,
    }),
  ], [transport('schedule-1'), transport('schedule-2')])
  assert.equal(linked[0].arrivals.length, 1)
  assert.deepEqual(linked[0].arrivals[0].items[0].supplier_names, ['АВ метал груп', 'Varian'])

  const unlinked = projectMaterialReceivingGroups([
    row({ schedule_id: 'schedule-1' }),
    row({ schedule_id: 'schedule-2', supplier_id: 'supplier-2', supplier_name: 'АВ метал груп' }),
  ], [])
  assert.equal(unlinked[0].arrivals.length, 2)
})

test('exact characteristics and one-piece length prevent incorrect aggregation', () => {
  const groups = projectMaterialReceivingGroups([
    row(),
    row({ key: 'paint-2', schedule_id: 'schedule-2', aggregate_identity: 'different-finish' }),
    row({
      key: 'knife-1', schedule_id: 'schedule-3', aggregate_identity: 'knife-hardox', table: 'request_knives',
      category: 'knives', unit: 'мм', item_name: 'Ножи', planned_quantity: 6_000,
      planned_piece_length_mm: 6_000, planned_piece_count: 1, is_whole_bar: true,
    }),
    row({
      key: 'knife-2', schedule_id: 'schedule-4', aggregate_identity: 'knife-hardox', table: 'request_knives',
      category: 'knives', unit: 'мм', item_name: 'Ножи', planned_quantity: 8_000,
      planned_piece_length_mm: 8_000, planned_piece_count: 1, is_whole_bar: true,
    }),
  ], [transport('schedule-1'), transport('schedule-2'), transport('schedule-3'), transport('schedule-4')])

  assert.equal(groups[0].arrivals[0].items.length, 4)
})

test('batch distribution preserves a full, partial and excess quantity receipt', () => {
  const schedules = [
    { id: 'schedule-22', quantity: 22, planned_piece_count: null, created_at: '2026-09-01T08:00:00Z' },
    { id: 'schedule-3', quantity: 3, planned_piece_count: null, created_at: '2026-09-01T09:00:00Z' },
  ]
  const allocation = [{ table: 'request_paint', id: 'item-1', quantity: 22, physical_quantity: 22, piece_count: null }]

  const full = buildMaterialReceiptBatchCalls({
    schedules, received_quantity: 25, received_piece_length_mm: null, received_piece_count: null, allocations: allocation,
  })
  assert.deepEqual(full.map((call) => call.received_quantity), [22, 3])
  assert.equal(full.reduce((sum, call) => sum + call.allocations.reduce((inner, row) => inner + row.quantity, 0), 0), 22)

  const partial = buildMaterialReceiptBatchCalls({
    schedules, received_quantity: 20, received_piece_length_mm: null, received_piece_count: null,
    allocations: [{ ...allocation[0], quantity: 20, physical_quantity: 20 }],
  })
  assert.deepEqual(partial.map((call) => call.received_quantity), [20, 0])

  const excess = buildMaterialReceiptBatchCalls({
    schedules, received_quantity: 30, received_piece_length_mm: null, received_piece_count: null, allocations: allocation,
  })
  assert.deepEqual(excess.map((call) => call.received_quantity), [22, 8])
})

test('whole-bar distribution keeps physical pieces and logical coverage', () => {
  const calls = buildMaterialReceiptBatchCalls({
    schedules: [
      { id: 'bar-1', quantity: 6_000, planned_piece_count: 1, created_at: '2026-09-01T08:00:00Z' },
      { id: 'bar-2', quantity: 6_000, planned_piece_count: 1, created_at: '2026-09-01T09:00:00Z' },
    ],
    received_quantity: 12_000,
    received_piece_length_mm: 6_000,
    received_piece_count: 2,
    allocations: [{
      table: 'request_knives', id: 'knife-1', quantity: 10_000,
      physical_quantity: 12_000, piece_count: 2,
    }],
  })

  assert.deepEqual(calls.map((call) => call.received_piece_count), [1, 1])
  assert.deepEqual(calls.map((call) => call.allocations[0].quantity), [6_000, 4_000])
  assert.deepEqual(calls.map((call) => call.allocations[0].physical_quantity), [6_000, 6_000])
})
