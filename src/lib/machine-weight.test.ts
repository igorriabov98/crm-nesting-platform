import assert from 'node:assert/strict'
import test from 'node:test'
import { machineTotalWeightTonnes } from './machine-weight'

test('converts item weights stored in kilograms to the machine total in tonnes', () => {
  assert.equal(machineTotalWeightTonnes([{ weight: 206.37, quantity: 1 }]), 0.20637)
  assert.equal(machineTotalWeightTonnes([
    { weight: 125, quantity: 2 },
    { weight: 50, quantity: 1 },
  ]), 0.3)
})
