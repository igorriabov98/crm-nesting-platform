import assert from 'node:assert/strict'
import test from 'node:test'
import { displayMaterialCategory } from './display-category'

test('wire appears under Circle while retaining pipe storage and kg units', () => {
  assert.equal(displayMaterialCategory('pipe', 'wire', 'кг'), 'circle')
  assert.equal(displayMaterialCategory('pipe', null, 'кг'), 'circle')
  assert.equal(displayMaterialCategory('pipe', 'round', 'мм'), 'pipe')
  assert.equal(displayMaterialCategory('circle', null, 'мм'), 'circle')
})
