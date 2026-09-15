import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateDiscountTotals, normalizeDiscountDocumentTotals, roundCurrency } from './order-discounts'

test('rounds every monetary discount result to cents', () => {
  assert.equal(roundCurrency(10.005), 10.01)
  assert.deepEqual(calculateDiscountTotals(333.33, 20, 7.5), {
    itemsTotalBeforeDiscount: 333.33,
    discountAmount: 25,
    discountedItemsTotal: 308.33,
    expensesTotal: 20,
    totalBeforeDiscount: 353.33,
    totalCost: 328.33,
  })
})

test('discount changes goods only and leaves expenses unchanged', () => {
  const result = calculateDiscountTotals(1000, 275.45, 50)
  assert.equal(result.discountAmount, 500)
  assert.equal(result.discountedItemsTotal, 500)
  assert.equal(result.expensesTotal, 275.45)
  assert.equal(result.totalCost, 775.45)
})

test('supports the minimum and maximum allowed discount boundaries', () => {
  assert.equal(calculateDiscountTotals(100, 10, 0.01).discountAmount, 0.01)
  assert.deepEqual(calculateDiscountTotals(100, 10, 50), {
    itemsTotalBeforeDiscount: 100,
    discountAmount: 50,
    discountedItemsTotal: 50,
    expensesTotal: 10,
    totalBeforeDiscount: 110,
    totalCost: 60,
  })
})

test('treats legacy invoice snapshots as a zero-discount document', () => {
  assert.deepEqual(normalizeDiscountDocumentTotals({
    goods_total: 500,
    expenses_total: 75,
    grand_total: 575,
  }), {
    goods_total: 500,
    expenses_total: 75,
    grand_total: 575,
    discount_status: 'none',
    discount_percent: 0,
    discount_amount: 0,
    goods_total_after_discount: 500,
    total_before_discount: 575,
  })
})
