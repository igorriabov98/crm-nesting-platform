import assert from 'node:assert/strict'
import test from 'node:test'
import { receiptLengthMm } from './receipt-length'

test('physical bar receipt derives stored millimetres from whole bars', () => {
  assert.equal(receiptLengthMm(3, 4000), 12000)
  assert.equal(receiptLengthMm('2', '6000'), 12000)
})

test('physical bar receipt rejects fractional, zero and missing inputs', () => {
  for (const [count, length] of [[1.5, 4000], [0, 4000], [-1, 4000], [3, 0], [3, ''], [3, null]]) {
    assert.equal(receiptLengthMm(count, length), null)
  }
})
