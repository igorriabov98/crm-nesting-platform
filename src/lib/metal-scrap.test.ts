import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatFactoryDateInput,
  isMetalScrapSaleWeightValid,
  metalScrapReviewNeedsReason,
  normalizeMetalScrapPage,
} from './metal-scrap'

test('normalizes invalid lot pages to the first page', () => {
  assert.equal(normalizeMetalScrapPage(-1), 0)
  assert.equal(normalizeMetalScrapPage(Number.NaN), 0)
  assert.equal(normalizeMetalScrapPage(1.5), 0)
  assert.equal(normalizeMetalScrapPage(3), 3)
})

test('uses the factory timezone for the sale date', () => {
  assert.equal(formatFactoryDateInput(new Date('2026-08-23T21:30:00.000Z')), '2026-08-24')
})

test('validates sale weight against the live available balance', () => {
  assert.equal(isMetalScrapSaleWeightValid('', 31.2), true)
  assert.equal(isMetalScrapSaleWeightValid('31.2', 31.2), true)
  assert.equal(isMetalScrapSaleWeightValid('31.201', 31.2), false)
  assert.equal(isMetalScrapSaleWeightValid('0', 31.2), false)
  assert.equal(isMetalScrapSaleWeightValid('-1', 31.2), false)
})

test('requires a reason only when review weight changes', () => {
  assert.equal(metalScrapReviewNeedsReason(31.2, 31.2), false)
  assert.equal(metalScrapReviewNeedsReason(31.201, 31.2), true)
})
