import assert from 'node:assert/strict'
import test from 'node:test'
import { formatKnifeProfileDimensions, knifeProfileDimensions } from './knife-profile'

test('explicit knife profile never includes a stock length', () => {
  assert.deepEqual(knifeProfileDimensions({
    width_mm: 200,
    height_mm: 20,
    knife_dimensions: '12000×100×10',
  }), { widthMm: 200, heightMm: 20 })
  assert.equal(formatKnifeProfileDimensions({ width_mm: 200, height_mm: 20 }), '200×20')
})

test('legacy D×W×H value contributes only width and height', () => {
  assert.deepEqual(knifeProfileDimensions({ knife_dimensions: '6 000×200×20' }), {
    widthMm: 200,
    heightMm: 20,
  })
  assert.equal(formatKnifeProfileDimensions({ knife_dimensions: '200x20' }, 'x'), '200x20')
})
