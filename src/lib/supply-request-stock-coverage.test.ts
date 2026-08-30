import assert from 'node:assert/strict'
import test from 'node:test'
import {
  displayedStockCoverage,
  hasLayoutStockCoverage,
  summarizeDisplayedStockCoverage,
} from './supply-request-stock-coverage'

test('shows approved layout coverage when the current workflow scope has no reservation', () => {
  const coverage = { reservedQuantity: 0, coveredQuantity: 11_728 }

  assert.equal(displayedStockCoverage(coverage), 11_728)
  assert.equal(hasLayoutStockCoverage(coverage), true)
})

test('never hides a newer scoped reservation behind an older covered quantity', () => {
  const coverage = { reservedQuantity: 13_000, coveredQuantity: 11_728 }

  assert.equal(displayedStockCoverage(coverage), 13_000)
  assert.equal(hasLayoutStockCoverage(coverage), false)
})

test('normalizes invalid and negative quantities without producing NaN', () => {
  assert.equal(displayedStockCoverage({ reservedQuantity: -1, coveredQuantity: Number.NaN }), 0)
  assert.equal(displayedStockCoverage({ reservedQuantity: undefined, coveredQuantity: null }), 0)
})

test('summary reports layout stock and only the genuinely uncovered requirement', () => {
  assert.deepEqual(summarizeDisplayedStockCoverage(13_000, [
    { reservedQuantity: 0, coveredQuantity: 11_728 },
  ]), {
    reserved: 11_728,
    toOrder: 1_272,
  })
})
