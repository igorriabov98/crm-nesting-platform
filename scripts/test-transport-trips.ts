import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertRouteStartsAt,
  buildTransportStopPlan,
  buildTransportRoute,
  getTransportStopOrderError,
  getTransportNeedConflict,
  routeStartsAt,
  type TransportRouteNeed,
} from '../src/lib/transport/trip-rules'
import { formatCompanyLocation } from '../src/lib/transport/company-location'

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
assert.equal(
  formatCompanyLocation({ name: 'Varian', city: 'Ужгород', address: 'вул. Собранецька, 10' }),
  'Varian — Ужгород, вул. Собранецька, 10',
)
assert.equal(formatCompanyLocation({ name: 'Varian', city: '', address: '' }), 'Varian')

const multiPickupPlan = buildTransportStopPlan([
  {
    key: 'materials:1',
    sourcePointKey: 'supplier:uzhhorod-a',
    sourcePointLabel: 'Компания A',
    sourcePointCity: 'Ужгород',
    destinationPointKey: 'factory:berehove',
    destinationPointLabel: 'Завод Берегово',
    direction: 'outbound',
  },
  {
    key: 'materials:2',
    sourcePointKey: 'supplier:uzhhorod-b',
    sourcePointLabel: 'Компания B',
    sourcePointCity: 'Ужгород',
    destinationPointKey: 'factory:berehove',
    destinationPointLabel: 'Завод Берегово',
    direction: 'outbound',
  },
  {
    key: 'materials:3',
    sourcePointKey: 'supplier:berehove-c',
    sourcePointLabel: 'Компания C',
    sourcePointCity: 'Берегово',
    destinationPointKey: 'factory:berehove',
    destinationPointLabel: 'Завод Берегово',
    direction: 'outbound',
  },
])
assert.deepEqual(
  multiPickupPlan.stops.map((stop) => stop.pointKey),
  ['supplier:uzhhorod-a', 'supplier:uzhhorod-b', 'supplier:berehove-c', 'factory:berehove'],
)
assert.equal(getTransportStopOrderError(multiPickupPlan.stops, multiPickupPlan.assignments), null)

const mixedPlan = buildTransportStopPlan([
  {
    key: 'outsourcing:out',
    sourcePointKey: 'factory:berehove',
    sourcePointLabel: 'Берегово',
    destinationPointKey: 'supplier:uzhhorod',
    destinationPointLabel: 'Ужгород',
    direction: 'outbound',
  },
  {
    key: 'outsourcing:return',
    sourcePointKey: 'supplier:uzhhorod',
    sourcePointLabel: 'Ужгород',
    destinationPointKey: 'factory:berehove',
    destinationPointLabel: 'Берегово',
    direction: 'return',
  },
])
assert.deepEqual(
  mixedPlan.stops.map((stop) => stop.pointKey),
  ['factory:berehove', 'supplier:uzhhorod', 'factory:berehove'],
)
assert.equal(getTransportStopOrderError(mixedPlan.stops, mixedPlan.assignments), null)
const invalidMixedStops = [mixedPlan.stops[0], mixedPlan.stops[2], mixedPlan.stops[1]]
assert.match(
  getTransportStopOrderError(invalidMixedStops, mixedPlan.assignments) || '',
  /Доставка не может быть раньше забора/,
)
assert.match(
  getTransportStopOrderError(
    mixedPlan.stops.map((stop) => ({ ...stop, plannedTime: '09:00' })),
    mixedPlan.assignments,
  ) || '',
  /Время остановок должно идти по порядку/,
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

const transportActions = readFileSync(resolve('src/lib/actions/transport-trips.ts'), 'utf8')
assert.match(transportActions, /getSupplyTransportNeeds/)
assert.match(transportActions, /supplyResult\.data\.map\(mapSupplyNeed\)/)
assert.match(transportActions, /sourcePointKey: `supplier:\$\{need\.supplierId\}`/)

const multiStopMigration = readFileSync(
  resolve('supabase/migrations/20260728120000_transport_multistop_routes.sql'),
  'utf8',
)
assert.match(multiStopMigration, /CREATE TABLE IF NOT EXISTS public\.transport_trip_stops/)
assert.match(multiStopMigration, /pickup_stop_id uuid/)
assert.match(multiStopMigration, /delivery_stop_id uuid/)
assert.match(multiStopMigration, /need_source text/)
assert.match(multiStopMigration, /fn_create_transport_trip_v2/)
assert.match(multiStopMigration, /fn_update_transport_trip_plan/)
assert.match(multiStopMigration, /fn_update_transport_trip_v2/)
assert.match(multiStopMigration, /fn_update_transport_trip_stop_status/)
assert.match(multiStopMigration, /Delivery stop must be after pickup stop/)
assert.match(multiStopMigration, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/)
assert.match(multiStopMigration, /v_need_source = 'supply_schedule'/)

console.log('Transport trip rules: OK')
