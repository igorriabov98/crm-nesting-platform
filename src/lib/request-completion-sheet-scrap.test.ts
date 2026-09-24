import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateSheetScrap } from './request-completion-sheet-scrap'

test('sheet remnant uses processed sheet as waste base and conserves weight', () => {
  const result = calculateSheetScrap('1200x300', 1, 168.48,
    [{ lengthMm: 500, widthMm: 300, quantity: 1 }], 10)
  assert.equal(result.scrapWeightKg, 70.2)
  assert.equal(result.wasteBasisKg, 98.28)
  assert.equal(result.metalScrapKg, 9.828)
  assert.equal(result.usefulKg, 88.452)
  assert.equal(Number((result.scrapWeightKg + result.metalScrapKg + result.usefulKg).toFixed(3)), 168.48)
})

test('several rotated remnants use source sheet count and area', () => {
  const result = calculateSheetScrap('300x1200', 2, 336.96, [
    { lengthMm: 500, widthMm: 300, quantity: 2 },
    { lengthMm: 200, widthMm: 300, quantity: 1 },
  ], 5)
  assert.equal(result.rows.length, 2)
  assert.equal(result.scrapWeightKg, 168.48)
  assert.equal(result.wasteBasisKg, 168.48)
  assert.equal(Number((result.metalScrapKg + result.usefulKg + result.scrapWeightKg).toFixed(3)), 336.96)
})

test('rejects oversized, full-sized, excess area and excess piece count', () => {
  const calculate = (rows: Parameters<typeof calculateSheetScrap>[3]) => calculateSheetScrap('1200x300', 1, 168.48, rows, 10)
  assert.throws(() => calculate([{ lengthMm: 1300, widthMm: 100, quantity: 1 }]))
  assert.throws(() => calculate([{ lengthMm: 1200, widthMm: 300, quantity: 1 }]))
  assert.throws(() => calculate([{ lengthMm: 500, widthMm: 300, quantity: 2 }]))
  assert.throws(() => calculate([
    { lengthMm: 700, widthMm: 300, quantity: 1 },
    { lengthMm: 600, widthMm: 300, quantity: 1 },
  ]))
})

test('allows remnants to cover the full area when each piece is smaller than the source', () => {
  const result = calculateSheetScrap('1200x300', 1, 168.48, [
    { lengthMm: 600, widthMm: 300, quantity: 1 },
    { lengthMm: 300, widthMm: 600, quantity: 1 },
  ], 15)
  assert.equal(result.scrapWeightKg, 168.48)
  assert.equal(result.wasteBasisKg, 0)
  assert.equal(result.metalScrapKg, 0)
  assert.equal(result.usefulKg, 0)
})

test('rejects a remnant whose rounded weight would be zero', () => {
  assert.throws(() => calculateSheetScrap('1000x1000', 1, 1,
    [{ lengthMm: 0.1, widthMm: 0.1, quantity: 1 }], 10))
})
