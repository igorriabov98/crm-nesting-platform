import assert from 'node:assert/strict'
import test from 'node:test'
import { groupWeightTrendByWeek, historyStockWeightKg, isHistoryMetalCategory } from './warehouse-history'

test('metal weight excludes paint and other categories while accepting the displayed circle category', () => {
  assert.equal(isHistoryMetalCategory('sheet_metal'), true)
  assert.equal(isHistoryMetalCategory('circle'), true)
  assert.equal(isHistoryMetalCategory('pipe'), true)
  assert.equal(isHistoryMetalCategory('paint'), false)
  assert.equal(isHistoryMetalCategory('components'), false)
})

test('paint uses kg stock quantity when calculated weight is unavailable', () => {
  assert.equal(historyStockWeightKg('paint', { calculated_weight_kg: null, total_quantity: 12.5, unit: 'кг' }), 12.5)
  assert.equal(historyStockWeightKg('paint', { calculated_weight_kg: null, total_quantity: 12.5, unit: 'шт' }), 0)
  assert.equal(historyStockWeightKg('paint', { calculated_weight_kg: 10, total_quantity: 12.5, unit: 'кг' }), 10)
  assert.equal(historyStockWeightKg('sheet_metal', { calculated_weight_kg: null, total_quantity: 12.5, unit: 'шт' }), 0)
})

test('week totals use selected partial weeks and preserve negative changes', () => {
  const weeks = groupWeightTrendByWeek([
    { date: '2026-09-25', weightKg: 90, deltaWeightKg: -10 },
    { date: '2026-09-26', weightKg: 100, deltaWeightKg: 10 },
    { date: '2026-09-28', weightKg: 95, deltaWeightKg: -5 },
    { date: '2026-09-29', weightKg: 95, deltaWeightKg: 0 },
  ])
  assert.deepEqual(weeks.map(({ from, to, deltaWeightKg, closingWeightKg }) => ({ from, to, deltaWeightKg, closingWeightKg })), [
    { from: '2026-09-25', to: '2026-09-26', deltaWeightKg: 0, closingWeightKg: 100 },
    { from: '2026-09-28', to: '2026-09-29', deltaWeightKg: -5, closingWeightKg: 95 },
  ])
})
