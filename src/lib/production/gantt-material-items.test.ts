import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateGanttMaterialItems, type AggregateableGanttMaterialItem } from './gantt-material-items'

function item(overrides: Partial<AggregateableGanttMaterialItem> = {}): AggregateableGanttMaterialItem {
  return {
    id: 'schedule-1',
    nomenclature: 'Листовой металл · Hardox · 1000x1000 · 20 мм',
    planned_delivery_date: '2026-09-10',
    actual_delivery_date: null,
    supply_status: 'ordered',
    unit: 'шт',
    quantity: 1,
    supplier: 'Varian',
    price_per_unit: null,
    comment: 'График снабжения',
    source: 'supply_order',
    aggregation_key: 'request_sheet_metal|material-1|Hardox|1000x1000|20',
    planned_piece_length_mm: null,
    ...overrides,
  }
}

test('production marker combines identical 1+1 sheet schedule rows', () => {
  const result = aggregateGanttMaterialItems([
    item(),
    item({ id: 'schedule-2' }),
  ])

  assert.equal(result.length, 1)
  assert.equal(result[0].quantity, 2)
  assert.deepEqual(result[0].source_ids, ['schedule-1', 'schedule-2'])
  assert.equal(result[0].technical_position_count, 2)
})

test('production markers keep different material details, supplier, status, dates and bar lengths separate', () => {
  const result = aggregateGanttMaterialItems([
    item(),
    item({ id: 'schedule-2', aggregation_key: 'different-thickness' }),
    item({ id: 'schedule-3', supplier: 'АВ метал груп' }),
    item({ id: 'schedule-4', supply_status: 'received', actual_delivery_date: '2026-09-10' }),
    item({ id: 'schedule-5', planned_delivery_date: '2026-09-11' }),
    item({ id: 'schedule-6', unit: 'мм', quantity: 6_000, planned_piece_length_mm: 6_000 }),
    item({ id: 'schedule-7', unit: 'мм', quantity: 8_000, planned_piece_length_mm: 8_000 }),
  ])

  assert.equal(result.length, 7)
})

test('legacy supply rows are not merged without an explicit exact identity', () => {
  const result = aggregateGanttMaterialItems([
    item({ id: 'legacy-1', source: 'legacy_supply', aggregation_key: null }),
    item({ id: 'legacy-2', source: 'legacy_supply', aggregation_key: null }),
  ])
  assert.equal(result.length, 2)
})
