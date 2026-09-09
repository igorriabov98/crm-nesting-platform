import assert from 'node:assert/strict'
import test from 'node:test'
import { isTransportTripStartAvailable } from './trip-lifecycle'

test('trip can start from the beginning of its business day before the planned stop time', () => {
  assert.equal(
    isTransportTripStartAvailable('2026-09-10', Date.parse('2026-09-09T21:00:00.000Z')),
    true,
  )
})

test('trip cannot start before its business day', () => {
  assert.equal(
    isTransportTripStartAvailable('2026-09-10', Date.parse('2026-09-09T20:59:59.999Z')),
    false,
  )
})

test('overdue trip remains startable', () => {
  assert.equal(
    isTransportTripStartAvailable('2026-09-09', Date.parse('2026-09-10T06:00:00.000Z')),
    true,
  )
})

test('missing or invalid dates fail closed', () => {
  assert.equal(isTransportTripStartAvailable(null, Date.now()), false)
  assert.equal(isTransportTripStartAvailable('10.09.2026', Date.now()), false)
  assert.equal(isTransportTripStartAvailable('2026-09-10', null), false)
})
