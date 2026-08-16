import assert from 'node:assert/strict'
import test from 'node:test'
import { knifeBevelLabel, parseKnifeBevelCount, requireKnifeBevelCount } from './knife-bevel'

test('accepts only an explicitly selected knife bevel', () => {
  assert.equal(parseKnifeBevelCount(1), 1)
  assert.equal(parseKnifeBevelCount('2'), 2)
  assert.equal(knifeBevelLabel(1), '1 скос')
  assert.equal(knifeBevelLabel(2), '2 скоса')
})

test('does not default a missing or invalid knife bevel', () => {
  assert.equal(parseKnifeBevelCount(null), null)
  assert.equal(parseKnifeBevelCount(''), null)
  assert.equal(parseKnifeBevelCount(0), null)
  assert.equal(parseKnifeBevelCount(3), null)
  assert.throws(() => requireKnifeBevelCount(undefined), /Выберите скос ножа/u)
})
