import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatLongStockPurchaseComposition,
  mergeLongStockPurchasePlans,
  summarizeLongStockPurchaseBars,
  type LongStockPurchasePlan,
} from './long-stock-purchase-plan'

test('показывает только закупаемые хлысты и исключает складские остатки', () => {
  const summary = summarizeLongStockPurchaseBars([
    { stock_length_mm: 12_000, length_group: 'standard', source_type: 'new_stock' },
    { stock_length_mm: 12_000, length_group: 'standard', source_type: 'new_stock' },
    { stock_length_mm: 6_000, length_group: 'standard', source_type: 'new_stock' },
    { stock_length_mm: 3_699, length_group: null, source_type: 'business_remnant' },
  ])

  assert.deepEqual(summary.components, [
    { length_mm: 12_000, piece_count: 2, is_nonstandard: false },
    { length_mm: 6_000, piece_count: 1, is_nonstandard: false },
  ])
  assert.equal(summary.total_piece_count, 3)
  assert.equal(summary.total_length_mm, 30_000)
  assert.equal(formatLongStockPurchaseComposition(summary.components), '12 000 × 2 + 6 000 × 1')
})

test('нестандартная длина сохраняет явную пометку', () => {
  const summary = summarizeLongStockPurchaseBars([
    { stock_length_mm: 8_500, length_group: 'nonstandard', source_type: 'new_stock' },
  ])

  assert.equal(summary.uses_nonstandard_length, true)
  assert.deepEqual(summary.components, [
    { length_mm: 8_500, piece_count: 1, is_nonstandard: true },
  ])
})

test('объединяет закупочный состав нескольких позиций одного материала', () => {
  const makePlan = (components: LongStockPurchasePlan['components']): LongStockPurchasePlan => ({
    plan_id: crypto.randomUUID(),
    plan_number: 1,
    version_id: crypto.randomUUID(),
    version_number: 1,
    version_status: 'approved',
    cutting_status: 'plan_approved',
    components,
    total_piece_count: 0,
    total_length_mm: 0,
    uses_nonstandard_length: false,
  })

  const summary = mergeLongStockPurchasePlans([
    makePlan([{ length_mm: 12_000, piece_count: 2, is_nonstandard: false }]),
    makePlan([
      { length_mm: 12_000, piece_count: 1, is_nonstandard: false },
      { length_mm: 6_000, piece_count: 2, is_nonstandard: false },
    ]),
  ])

  assert.deepEqual(summary.components, [
    { length_mm: 12_000, piece_count: 3, is_nonstandard: false },
    { length_mm: 6_000, piece_count: 2, is_nonstandard: false },
  ])
})
