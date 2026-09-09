import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTransportCargoSnapshot,
  parseTransportCargoSnapshot,
} from './cargo-snapshot'
import {
  formatProductionShipmentDateTime,
  projectProductionLocalShipments,
  visibleProductionShipmentNeedKeys,
  type ProductionShipmentLinkRow,
  type ProductionShipmentStopRow,
  type ProductionShipmentTripRow,
} from './production-local-shipments'

const factoryId = 'factory-uzhhorod'
const factoryPointKey = `factory:${factoryId}`

function stop(input: Partial<ProductionShipmentStopRow> & Pick<ProductionShipmentStopRow, 'id'>): ProductionShipmentStopRow {
  return {
    sequence: 0,
    kind: 'service',
    pointKey: factoryPointKey,
    pointLabel: 'Завод Ужгород',
    city: 'Ужгород',
    plannedArrivalAt: '2026-09-08T09:00:00.000Z',
    status: 'planned',
    arrivedAt: null,
    completedAt: null,
    ...input,
  }
}

function link(input: Partial<ProductionShipmentLinkRow> & Pick<ProductionShipmentLinkRow, 'id'>): ProductionShipmentLinkRow {
  return {
    needKind: 'materials',
    needSource: 'inventory_transfer',
    needId: input.id,
    sourcePointKey: factoryPointKey,
    destinationPointLabel: 'Аутсорсинг Берегово',
    title: 'Заказ 42',
    subtitle: 'Материалы',
    pickupStopId: 'pickup',
    releasedAt: null,
    cargoSnapshot: createTransportCargoSnapshot({
      title: 'Заказ 42',
      subtitle: 'Материалы',
      itemLabels: ['Лист 10 мм'],
      itemDetails: [{
        title: 'Лист 10 мм',
        drawingLabel: null,
        description: 'Сталь S355',
        quantityLabel: '2 шт.',
        quantity: 2,
        requiredQuantity: 2,
        excessQuantity: 0,
        unit: 'шт.',
        weightKg: 120,
        pieceLengthMm: 6_000,
        pieceCount: 2,
        machineLabel: 'Заказ 42',
        characteristics: [{ label: 'Размер', value: '1500×6000' }],
      }],
      volumeLabel: '2 шт.',
      weightKg: 120,
    }),
    ...input,
  }
}

test('hides active cargo whose source need is no longer visible in transport', () => {
  const currentTrip = trip({
    id: 'stale-trip',
    links: [
      link({ id: 'completed-transfer', needId: 'completed-transfer' }),
      link({ id: 'active-transfer', needId: 'active-transfer' }),
    ],
  })
  const visibleActiveNeedKeys = visibleProductionShipmentNeedKeys([
    {
      id: 'completed-transfer',
      source: 'inventory_transfer',
      status: 'completed',
      hasRequiredRelations: true,
      machineArchived: false,
    },
    {
      id: 'active-transfer',
      source: 'inventory_transfer',
      status: 'scheduled',
      hasRequiredRelations: true,
      machineArchived: false,
    },
  ])

  const active = projectProductionLocalShipments({
    factoryId,
    trips: [currentTrip],
    visibleActiveNeedKeys,
  })
  assert.deepEqual(active.active[0]?.cargo.map((cargo) => cargo.linkId), ['active-transfer'])

  const staleOnly = projectProductionLocalShipments({
    factoryId,
    trips: [{ ...currentTrip, links: [link({ id: 'completed-transfer', needId: 'completed-transfer' })] }],
    visibleActiveNeedKeys,
  })
  assert.deepEqual(staleOnly.active, [])

  const historical = projectProductionLocalShipments({
    factoryId,
    trips: [{ ...currentTrip, status: 'completed', completedAt: '2026-09-08T12:00:00.000Z' }],
    visibleActiveNeedKeys,
  })
  assert.deepEqual(historical.history[0]?.cargo.map((cargo) => cargo.linkId), ['completed-transfer', 'active-transfer'])
})

test('matches active source eligibility used by the transport workspace', () => {
  const visible = visibleProductionShipmentNeedKeys([
    { id: 'inventory', source: 'inventory_transfer', status: 'partially_received', hasRequiredRelations: true, machineArchived: false },
    { id: 'detailing', source: 'detailing_transfer', status: 'scheduled', hasRequiredRelations: true, machineArchived: false },
    { id: 'outsourcing', source: 'outsourcing', status: 'linked', hasRequiredRelations: true, machineArchived: false },
    { id: 'supply', source: 'supply_schedule', status: 'planned', hasRequiredRelations: true, machineArchived: false, supplierId: 'supplier' },
    { id: 'archived', source: 'inventory_transfer', status: 'scheduled', hasRequiredRelations: true, machineArchived: true },
    { id: 'missing', source: 'outsourcing', status: 'linked', hasRequiredRelations: false, machineArchived: false },
    { id: 'received', source: 'supply_schedule', status: 'delivered', hasRequiredRelations: true, machineArchived: false, supplierId: 'supplier' },
    { id: 'receipt-child', source: 'supply_schedule', status: 'planned', hasRequiredRelations: true, machineArchived: false, supplierId: 'supplier', receiptParentScheduleId: 'parent' },
  ])

  assert.deepEqual([...visible].sort(), [
    'detailing_transfer:detailing',
    'inventory_transfer:inventory',
    'outsourcing:outsourcing',
    'supply_schedule:supply',
  ])
})

function trip(input: Partial<ProductionShipmentTripRow> & Pick<ProductionShipmentTripRow, 'id'>): ProductionShipmentTripRow {
  return {
    status: 'found',
    scheduledDate: '2026-09-08',
    carrierName: 'Перевозчик',
    route: 'Завод Ужгород → Аутсорсинг Берегово',
    updatedAt: '2026-09-08T10:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    stops: [
      stop({ id: 'pickup' }),
      stop({
        id: 'delivery',
        sequence: 1,
        kind: 'finish',
        pointKey: 'supplier:berehove',
        pointLabel: 'Аутсорсинг Берегово',
        city: 'Берегово',
        plannedArrivalAt: '2026-09-08T11:00:00.000Z',
      }),
    ],
    links: [link({ id: `${input.id}:cargo` })],
    ...input,
  }
}

test('keeps only active cargo picked up at the selected factory', () => {
  const currentTrip = trip({
    id: 'mixed-cargo',
    links: [
      link({ id: 'materials' }),
      link({ id: 'detailing', needKind: 'detailing', title: 'Детали' }),
      link({ id: 'outsourcing', needKind: 'outsourcing', title: 'Аутсорсинг' }),
      link({ id: 'incoming', sourcePointKey: 'supplier:incoming', destinationPointLabel: 'Завод Ужгород' }),
      link({ id: 'other-factory', sourcePointKey: 'factory:other' }),
      link({ id: 'released', releasedAt: '2026-09-08T08:00:00.000Z' }),
    ],
  })

  const result = projectProductionLocalShipments({
    factoryId,
    trips: [currentTrip],
    now: new Date('2026-09-08T08:30:00.000Z'),
  })

  assert.equal(result.active.length, 1)
  assert.deepEqual(result.active[0].cargo.map((cargo) => cargo.kind), ['materials', 'detailing', 'outsourcing'])
  assert.equal(result.active[0].tripNumber, '0809УЖБЕ')
  assert.equal(result.history.length, 0)
})

test('maps stop and trip lifecycle states, overdue events, and active sorting', () => {
  const result = projectProductionLocalShipments({
    factoryId,
    now: new Date('2026-09-08T12:00:00.000Z'),
    trips: [
      trip({ id: 'future', stops: [stop({ id: 'pickup', plannedArrivalAt: '2026-09-08T13:00:00.000Z' })] }),
      trip({ id: 'overdue', stops: [stop({ id: 'pickup', plannedArrivalAt: '2026-09-08T08:00:00.000Z' })] }),
      trip({ id: 'onsite', status: 'in_transit', stops: [stop({ id: 'pickup', status: 'arrived', arrivedAt: '2026-09-08T09:05:00.000Z' })] }),
      trip({ id: 'completed-stop', status: 'in_transit', stops: [stop({ id: 'pickup', status: 'completed', completedAt: '2026-09-08T10:00:00.000Z' })] }),
      trip({
        id: 'cancelled-trip',
        status: 'cancelled',
        cancelledAt: '2026-09-08T11:00:00.000Z',
        updatedAt: '2026-09-08T11:00:00.000Z',
        stops: [stop({ id: 'pickup' })],
        links: [link({ id: 'cancelled-cargo', releasedAt: '2026-09-08T11:00:00.000Z' })],
      }),
      trip({ id: 'completed-trip', status: 'completed', completedAt: '2026-09-08T12:00:00.000Z', updatedAt: '2026-09-08T12:00:00.000Z', stops: [stop({ id: 'pickup' })] }),
    ],
  })

  assert.deepEqual(result.active.map((shipment) => shipment.tripId), ['overdue', 'onsite', 'future'])
  assert.equal(result.active[0].overdue, true)
  assert.equal(result.active[1].state, 'onsite')
  assert.deepEqual(result.history.map((shipment) => shipment.tripId), ['completed-trip', 'cancelled-trip', 'completed-stop'])
  assert.deepEqual(result.history.map((shipment) => shipment.state), ['completed', 'cancelled', 'completed'])
})

test('limits history to 50 newest events', () => {
  const trips = Array.from({ length: 55 }, (_, index) => trip({
    id: `history-${index}`,
    status: 'completed',
    completedAt: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, 1, index)).toISOString(),
    stops: [stop({ id: 'pickup' })],
  }))
  const result = projectProductionLocalShipments({ factoryId, trips })

  assert.equal(result.history.length, 50)
  assert.equal(result.history[0].tripId, 'history-54')
  assert.equal(result.history.at(-1)?.tripId, 'history-5')
})

test('supports legacy fallback and validates versioned snapshots', () => {
  const snapshot = link({ id: 'snapshot' }).cargoSnapshot
  assert.equal(parseTransportCargoSnapshot(snapshot)?.version, 1)
  assert.equal(parseTransportCargoSnapshot({ version: 2 }), null)

  const result = projectProductionLocalShipments({
    factoryId,
    trips: [trip({ id: 'legacy', links: [link({ id: 'legacy-link', cargoSnapshot: null })] })],
  })
  assert.equal(result.active[0].cargo[0].snapshot, null)
  assert.equal(result.active[0].cargo[0].title, 'Заказ 42')
})

test('formats loading time in Europe/Uzhgorod', () => {
  const formatted = formatProductionShipmentDateTime('2026-09-08T21:30:00.000Z')
  assert.equal(formatted.time, '00:30')
  assert.match(formatted.date, /09/u)
})
