import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertRouteStartsAt,
  buildTransportRoute,
  getTransportNeedConflict,
  routeStartsAt,
  type TransportRouteNeed,
} from '../src/lib/transport/trip-rules'

const baseNeed: TransportRouteNeed = {
  sourcePointKey: 'factory:berehove',
  sourcePointLabel: 'Берегово',
  destinationPointLabel: 'Ужгород',
  direction: 'outbound',
}

assert.equal(getTransportNeedConflict(baseNeed, {
  ...baseNeed,
  destinationPointLabel: 'Львов',
}), null)
assert.equal(getTransportNeedConflict(baseNeed, {
  ...baseNeed,
  sourcePointKey: 'factory:uzhhorod',
}), 'source')
assert.equal(getTransportNeedConflict(baseNeed, {
  ...baseNeed,
  direction: 'return',
}), 'direction')

assert.equal(
  buildTransportRoute([
    baseNeed,
    { ...baseNeed, destinationPointLabel: 'Львов' },
    { ...baseNeed, destinationPointLabel: 'Ужгород' },
  ]),
  'Берегово → Ужгород → Львов',
)
assert.equal(routeStartsAt('  берегово   → Ужгород', 'Берегово'), true)
assert.equal(routeStartsAt('Ужгород → Берегово', 'Берегово'), false)
assert.doesNotThrow(() => assertRouteStartsAt('Берегово → Ужгород', 'Берегово'))
assert.throws(
  () => assertRouteStartsAt('Ужгород → Берегово', 'Берегово'),
  /Маршрут должен начинаться/,
)

const migration = readFileSync(
  resolve('supabase/migrations/20260724193812_transport_trip_workspace.sql'),
  'utf8',
)
assert.match(migration, /route_start_key text/)
assert.match(migration, /route_prefix_check/)
assert.match(migration, /idx_transport_trip_need_links_one_active/)
assert.match(migration, /v_route_start_key IS DISTINCT FROM NEW\.source_point_key/)
assert.match(migration, /fn_create_transport_trip/)
assert.match(migration, /fn_update_transport_trip/)
assert.match(migration, /v_trip\.status IN \('completed', 'cancelled'\)/)

console.log('Transport trip rules: OK')
