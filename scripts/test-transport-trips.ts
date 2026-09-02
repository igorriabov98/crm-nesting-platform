import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertRouteStartsAt,
  buildTransportStopPlan,
  buildTransportRoute,
  getTransportStopOrderError,
  getTransportNeedConflict,
  reconcileTransportStopPlan,
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
assert.equal(multiPickupPlan.stops[0].kind, 'service')
assert.equal(multiPickupPlan.stops.some((stop) => stop.kind === 'start'), false)
assert.deepEqual(
  multiPickupPlan.stops.map((stop) => stop.pointKey),
  ['supplier:uzhhorod-a', 'supplier:uzhhorod-b', 'supplier:berehove-c', 'factory:berehove'],
)
assert.equal(getTransportStopOrderError(multiPickupPlan.stops, multiPickupPlan.assignments), null)

const cityBlockNeeds: TransportRouteNeed[] = [
  { key: 'need:agro', sourcePointKey: 'supplier:agro', sourcePointLabel: 'Агрострой', sourcePointCity: 'Берегово', destinationPointKey: 'supplier:varian', destinationPointLabel: 'Varian', destinationPointCity: ' УЖГОРОД ', direction: 'outbound' },
  { key: 'need:metal', sourcePointKey: 'supplier:metal', sourcePointLabel: 'АВ Метал', sourcePointCity: 'Мукачево', destinationPointKey: 'factory:2', destinationPointLabel: 'Завод 2', destinationPointCity: 'ужгород', direction: 'outbound' },
]
const cityBlockPlan = buildTransportStopPlan(cityBlockNeeds)
assert.deepEqual(cityBlockPlan.stops.map((stop) => stop.pointLabel), ['Агрострой', 'АВ Метал', 'Varian', 'Завод 2'])
assert.notEqual(cityBlockPlan.stops[2].clientId, cityBlockPlan.stops[3].clientId)
assert.equal(getTransportStopOrderError(cityBlockPlan.stops, cityBlockPlan.assignments), null)

const manuallyReordered = [cityBlockPlan.stops[1], cityBlockPlan.stops[0], cityBlockPlan.stops[2], cityBlockPlan.stops[3]]
const extendedPlan = reconcileTransportStopPlan(manuallyReordered, cityBlockPlan.assignments, [
  ...cityBlockNeeds,
  { key: 'need:lviv', sourcePointKey: 'supplier:lviv-pickup', sourcePointLabel: 'Львов склад', sourcePointCity: 'Львов', destinationPointKey: 'factory:lviv', destinationPointLabel: 'Львов завод', destinationPointCity: 'Львов', direction: 'outbound' },
])
assert.deepEqual(extendedPlan.stops.slice(0, 4).map((stop) => stop.pointLabel), ['АВ Метал', 'Агрострой', 'Varian', 'Завод 2'])
assert.deepEqual(extendedPlan.stops.slice(-2).map((stop) => stop.pointLabel), ['Львов склад', 'Львов завод'])
assert.equal(extendedPlan.stops[0].plannedTime, manuallyReordered[0].plannedTime)

const planWithoutLegacyStart = reconcileTransportStopPlan([
  {
    ...cityBlockPlan.stops[0],
    clientId: 'legacy-start',
    kind: 'start',
  },
  ...cityBlockPlan.stops,
], cityBlockPlan.assignments, cityBlockNeeds)
assert.equal(planWithoutLegacyStart.stops.some((stop) => stop.kind === 'start'), false)

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
assert.match(transportActions, /itemDetails: need\.item_details\.map/)
assert.match(transportActions, /productHref: item\.product_id \? `\$\{ROUTES\.PRODUCTS\}\/\$\{item\.product_id\}` : null/)
assert.match(transportActions, /\.from\('product_files'\)/)
assert.match(transportActions, /\.eq\('status', 'current'\)/)
assert.match(transportActions, /`\/api\/supply\/transport\/drawings\/\$\{need\.source\}\/\$\{need\.id\}\/\$\{drawingFileId\}`/)
assert.match(transportActions, /К перевозке:/)
assert.match(transportActions, /remainingSecondaryQuantity/)
assert.match(transportActions, /quantityLabel: `\$\{numberLabel\(need\.quantity\)\} \$\{need\.unit\}`/)

const outsourcingActions = readFileSync(resolve('src/lib/actions/outsourcing.ts'), 'utf8')
assert.match(outsourcingActions, /item_details: \(operation\?\.items \|\| \[\]\)\.map/)
assert.match(outsourcingActions, /drawing_number: item\.drawing_number \|\| null/)
assert.match(outsourcingActions, /product_id: item\.product_id \|\| null/)
assert.match(outsourcingActions, /product_version_id: item\.product_version_id \|\| null/)
assert.match(outsourcingActions, /weight_unit: operation\?\.operation_kind === 'vrb_mesh' \? 'kg' : 'т'/)

const transportDrawingRoute = readFileSync(
  resolve('src/app/api/supply/transport/drawings/[needSource]/[needId]/[fileId]/route.ts'),
  'utf8',
)
assert.match(transportDrawingRoute, /requirePermission\('supply_transport', 'view'\)/)
assert.match(transportDrawingRoute, /machine_outsourcing_transport_needs/)
assert.match(transportDrawingRoute, /detailing_transfer_items/)
assert.match(transportDrawingRoute, /belongsToNeed/)
assert.match(transportDrawingRoute, /resolveFileResponse/)

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

const dateApprovalMigration = readFileSync(resolve('supabase/migrations/20260728130100_transport_trip_date_approval.sql'), 'utf8')
assert.match(dateApprovalMigration, /transport_trip_date_change_requests/)
assert.match(dateApprovalMigration, /fn_create_transport_trip_v3/)
assert.match(dateApprovalMigration, /fn_decide_transport_trip_date_change/)
assert.match(dateApprovalMigration, /date_change_state NOT IN \('not_required', 'approved'\)/)
assert.match(dateApprovalMigration, /UPDATE public\.factories SET city = name/)

const needDateFallbackMigration = readFileSync(
  resolve('supabase/migrations/20260731160000_transport_need_date_task_fallback.sql'),
  'utf8',
)
assert.match(needDateFallbackMigration, /CREATE OR REPLACE FUNCTION public\.transport_need_current_date/)
assert.match(needDateFallbackMigration, /transfer\.expected_arrival_date/)
assert.match(needDateFallbackMigration, /task\.inventory_transfer_id = p_need_id/)
assert.match(needDateFallbackMigration, /task\.detailing_transfer_id = p_need_id/)
assert.match(needDateFallbackMigration, /task\.status IN \('pending', 'in_progress'\)/)

const pickupStartMigration = readFileSync(
  resolve('supabase/migrations/20260730130000_transport_trip_starts_at_pickup.sql'),
  'utf8',
)
assert.match(pickupStartMigration, /v_first_stop->>'kind' IS DISTINCT FROM 'service'/)
assert.match(pickupStartMigration, /Отдельная точка выезда больше не используется/)
assert.match(pickupStartMigration, /'planned', NULL/)

const transportWorkspace = readFileSync(resolve('src/components/features/supply/TransportWorkspacePage.tsx'), 'utf8')
assert.doesNotMatch(transportWorkspace, />Точка выезда</)
assert.match(transportWorkspace, /aria-label=\{title\}/)
assert.match(transportWorkspace, /Подробнее о потребности/)
assert.match(transportWorkspace, /function NeedDetailsDialog/)
assert.match(transportWorkspace, /Полная информация о потребности в перевозке/)
assert.match(transportWorkspace, /Состав перевозки/)
assert.match(transportWorkspace, /href=\{item\.productHref\}/)
assert.match(transportWorkspace, /href=\{item\.drawingHref\}/)
assert.match(transportWorkspace, /открыть актуальный сборочный чертёж/)
assert.match(transportWorkspace, /target="_blank"/)
assert.match(transportWorkspace, /locationDetails\(need\.sourcePointCity, need\.sourcePointAddress\)/)
assert.match(transportWorkspace, /locationDetails\(need\.destinationPointCity, need\.destinationPointAddress\)/)
assert.match(transportWorkspace, /Отменить рейс/)
assert.match(transportWorkspace, /Причина исключения/)
assert.match(transportWorkspace, /reconcileTransportStopPlan/)
assert.match(transportWorkspace, /editingNeeds\.length === 1/)
assert.match(transportWorkspace, /collapsible/)
assert.match(transportWorkspace, /Подтвердить начало рейса/)
assert.match(transportWorkspace, /Подтвердить: рейс выполнен/)
assert.match(transportWorkspace, /onLifecycle\(trip, 'start'\)/)
assert.match(transportWorkspace, /onLifecycle\(trip, 'complete'\)/)
assert.match(transportWorkspace, /await refreshWorkspaceData\(\)/)
assert.doesNotMatch(transportWorkspace, /function AgreementsPanel/)
assert.doesNotMatch(transportWorkspace, /router\.refresh\(\)/)
assert.doesNotMatch(transportWorkspace, /<SelectItem value="cancelled"/)

const editCancelMigration = readFileSync(
  resolve('supabase/migrations/20260730160000_transport_trip_edit_cancel.sql'),
  'utf8',
)
assert.match(editCancelMigration, /fn_cancel_transport_trip_v1/)
assert.match(editCancelMigration, /fn_update_transport_trip_v4/)
assert.match(editCancelMigration, /FOR UPDATE/)
assert.match(editCancelMigration, /released_reason = btrim\(p_remove_reason\)/)
assert.match(editCancelMigration, /pickup\.status <> 'planned'/)
assert.match(editCancelMigration, /Конфликт освобождённых потребностей активных рейсов/)
assert.match(editCancelMigration, /date_change_state = CASE/)
assert.match(transportActions, /releasedAt: link\.released_at/)
assert.match(transportActions, /fn_cancel_transport_trip_v1/)
assert.match(transportActions, /fn_update_transport_trip_v4/)

const manualLifecycleMigration = readFileSync(
  resolve('supabase/migrations/20260731193000_transport_trip_manual_lifecycle.sql'),
  'utf8',
)
assert.match(manualLifecycleMigration, /ADD COLUMN IF NOT EXISTS started_at timestamptz/)
assert.match(manualLifecycleMigration, /ADD COLUMN IF NOT EXISTS completed_at timestamptz/)
assert.match(manualLifecycleMigration, /fn_start_transport_trip_v1/)
assert.match(manualLifecycleMigration, /fn_complete_transport_trip_v1/)
assert.match(manualLifecycleMigration, /v_trip\.status <> 'in_transit'/)
assert.match(manualLifecycleMigration, /Запланированное время завершения рейса ещё не наступило/)
assert.match(manualLifecycleMigration, /UPDATE public\.transport_trip_stops/)
assert.match(manualLifecycleMigration, /Сначала подтвердите начало рейса/)
assert.doesNotMatch(manualLifecycleMigration, /IF v_trip\.status = 'found'/)
assert.match(transportActions, /fn_start_transport_trip_v1/)
assert.match(transportActions, /fn_complete_transport_trip_v1/)
assert.doesNotMatch(transportActions, /revalidatePath\(ROUTES\.SUPPLY_TRANSPORT\)/)

console.log('Transport trip rules: OK')
