import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSingleLengthReceipt } from '@/lib/supply-orders/single-length-receipt'

test('one measured receipt accepts one length and calculates total millimetres', () => {
  assert.deepEqual(normalizeSingleLengthReceipt({
    receivedPieceLengthMm: 6000,
    receivedPieceCount: 2,
  }), {
    pieceLengthMm: 6000,
    pieceCount: 2,
    receivedQuantity: 12000,
  })
})

test('measured receipt rejects fractional and non-positive piece counts', () => {
  assert.throws(
    () => normalizeSingleLengthReceipt({ receivedPieceLengthMm: 12000, receivedPieceCount: 1.5 }),
    /положительным целым/,
  )
  assert.throws(
    () => normalizeSingleLengthReceipt({ receivedPieceLengthMm: 12000, receivedPieceCount: 0 }),
    /положительным целым/,
  )
})

test('measured receipt rejects invalid physical length', () => {
  assert.throws(
    () => normalizeSingleLengthReceipt({ receivedPieceLengthMm: -1, receivedPieceCount: 1 }),
    /длина хлыста должна быть больше 0/,
  )
})
