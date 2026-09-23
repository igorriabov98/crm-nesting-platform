import assert from 'node:assert/strict'
import test from 'node:test'
import { rectangularDimensions, sameRectangularDimensions } from './rotatable-dimensions'

test('rectangular sheet and pipe dimensions match after a quarter turn', () => {
  assert.equal(sameRectangularDimensions('2500х1250', '1250×2500'), true)
  assert.equal(sameRectangularDimensions('100 x 50', '50*100'), true)
  assert.equal(sameRectangularDimensions('40×40', '40x40'), true)
  assert.equal(sameRectangularDimensions('100x50', '100x60'), false)
})

test('invalid and incomplete dimensions never become a match', () => {
  assert.equal(rectangularDimensions('100x50x20'), null)
  assert.equal(sameRectangularDimensions('', ''), false)
  assert.equal(sameRectangularDimensions('100x0', '0x100'), false)
  assert.equal(sameRectangularDimensions('100xabc', 'abcx100'), false)
})
