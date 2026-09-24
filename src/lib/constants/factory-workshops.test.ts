import assert from 'node:assert/strict'
import test from 'node:test'
import { getFactoryWorkshopOptions, isFactoryWorkshopAllowed } from './factory-workshops'

test('Berehovo offers only workshop 1', () => {
  assert.deepEqual(getFactoryWorkshopOptions('Берегово'), [{ value: 1, label: 'Цех 1' }])
  assert.equal(isFactoryWorkshopAllowed('Берегово', 1), true)
  assert.equal(isFactoryWorkshopAllowed('Берегово', 2), false)
})
