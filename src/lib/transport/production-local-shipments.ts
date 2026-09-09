import type { TransportCargoSnapshotV1 } from '@/lib/transport/cargo-snapshot'
import { parseTransportCargoSnapshot } from '@/lib/transport/cargo-snapshot'
import { transportTripDisplayName } from '@/lib/transport/trip-display-name'

const shipmentDateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: 'short',
  timeZone: 'Europe/Uzhgorod',
})
const shipmentTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Europe/Uzhgorod',
})

export type ProductionLocalShipmentState = 'waiting' | 'onsite' | 'completed' | 'cancelled'
export type ProductionShipmentNeedSource = 'inventory_transfer' | 'supply_schedule' | 'detailing_transfer' | 'outsourcing'

export type ProductionShipmentNeedState = {
  id: string
  source: ProductionShipmentNeedSource
  status: string
  hasRequiredRelations: boolean
  machineArchived: boolean
  supplierId?: string | null
  receiptParentScheduleId?: string | null
}

export type ProductionLocalShipmentCargo = {
  linkId: string
  kind: 'materials' | 'detailing' | 'outsourcing'
  title: string
  subtitle: string | null
  destinationLabel: string
  snapshot: TransportCargoSnapshotV1 | null
}

export type ProductionLocalShipment = {
  id: string
  tripId: string
  pickupStopId: string
  tripNumber: string
  state: ProductionLocalShipmentState
  scheduledAt: string | null
  arrivedAt: string | null
  completedAt: string | null
  eventAt: string | null
  overdue: boolean
  carrierName: string | null
  route: string | null
  cargo: ProductionLocalShipmentCargo[]
}

export type ProductionLocalShipmentsWorkspace = {
  factories: Array<{ id: string; name: string }>
  selectedFactoryId: string | null
  canViewAllFactories: boolean
  active: ProductionLocalShipment[]
  history: ProductionLocalShipment[]
  generatedAt: string
}

export type ProductionShipmentStopRow = {
  id: string
  sequence: number
  kind: 'start' | 'service' | 'finish'
  pointKey: string
  pointLabel: string
  city: string | null
  plannedArrivalAt: string | null
  status: 'planned' | 'arrived' | 'completed'
  arrivedAt: string | null
  completedAt: string | null
}

export type ProductionShipmentLinkRow = {
  id: string
  needKind: 'materials' | 'detailing' | 'outsourcing'
  needSource: ProductionShipmentNeedSource
  needId: string
  sourcePointKey: string
  destinationPointLabel: string
  title: string
  subtitle: string | null
  pickupStopId: string | null
  releasedAt: string | null
  cargoSnapshot: unknown
}

export function productionShipmentNeedKey(input: Pick<ProductionShipmentNeedState, 'source' | 'id'>) {
  return `${input.source}:${input.id}`
}

export function visibleProductionShipmentNeedKeys(states: ProductionShipmentNeedState[]) {
  const visible = states.filter((state) => {
    if (!state.hasRequiredRelations || state.machineArchived) return false
    if (state.source === 'inventory_transfer' || state.source === 'detailing_transfer') {
      return ['needs_date', 'scheduled', 'partially_received'].includes(state.status)
    }
    if (state.source === 'outsourcing') return ['open', 'linked'].includes(state.status)
    return state.status === 'planned'
      && Boolean(state.supplierId)
      && !state.receiptParentScheduleId
  })
  return new Set(visible.map(productionShipmentNeedKey))
}

export type ProductionShipmentTripRow = {
  id: string
  status: 'needed' | 'found' | 'in_transit' | 'completed' | 'cancelled'
  scheduledDate: string | null
  carrierName: string | null
  route: string | null
  updatedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
  stops: ProductionShipmentStopRow[]
  links: ProductionShipmentLinkRow[]
}

export function formatProductionShipmentDateTime(value: string | null) {
  if (!value) return { date: 'Дата не указана', time: 'Время не указано' }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: 'Дата не указана', time: 'Время не указано' }
  return {
    date: shipmentDateFormatter.format(date),
    time: shipmentTimeFormatter.format(date),
  }
}

function timestamp(value: string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

function historyTimestamp(value: string | null) {
  const parsed = timestamp(value)
  return parsed === Number.POSITIVE_INFINITY ? Number.NEGATIVE_INFINITY : parsed
}

function eventState(trip: ProductionShipmentTripRow, stop: ProductionShipmentStopRow): ProductionLocalShipmentState {
  if (stop.status === 'completed') return 'completed'
  if (trip.status === 'cancelled') return 'cancelled'
  if (trip.status === 'completed') return 'completed'
  if (stop.status === 'arrived') return 'onsite'
  return 'waiting'
}

function belongsToCancelledTrip(link: ProductionShipmentLinkRow, trip: ProductionShipmentTripRow) {
  if (trip.status !== 'cancelled' || !trip.cancelledAt || !link.releasedAt) return false
  const cancelledAt = Date.parse(trip.cancelledAt)
  const releasedAt = Date.parse(link.releasedAt)
  return !Number.isNaN(cancelledAt) && !Number.isNaN(releasedAt) && Math.abs(cancelledAt - releasedAt) < 1_000
}

export function projectProductionLocalShipments(input: {
  factoryId: string
  trips: ProductionShipmentTripRow[]
  visibleActiveNeedKeys?: ReadonlySet<string>
  now?: Date
  historyLimit?: number
}) {
  const factoryPointKey = `factory:${input.factoryId}`
  const nowMs = (input.now || new Date()).getTime()
  const events = input.trips.flatMap((trip) => {
    const factoryStops = trip.stops
      .filter((stop) => stop.pointKey === factoryPointKey)
      .sort((left, right) => left.sequence - right.sequence)

    return factoryStops.flatMap((stop): ProductionLocalShipment[] => {
      const cargo = trip.links
        .filter((link) => (
          (trip.status === 'completed'
            || trip.status === 'cancelled'
            || !input.visibleActiveNeedKeys
            || input.visibleActiveNeedKeys.has(productionShipmentNeedKey({ source: link.needSource, id: link.needId })))
          && (!link.releasedAt || belongsToCancelledTrip(link, trip))
          && link.sourcePointKey === factoryPointKey
          && (link.pickupStopId === stop.id || (!link.pickupStopId && stop === factoryStops[0]))
        ))
        .map((link): ProductionLocalShipmentCargo => ({
          linkId: link.id,
          kind: link.needKind,
          title: link.title,
          subtitle: link.subtitle,
          destinationLabel: link.destinationPointLabel,
          snapshot: parseTransportCargoSnapshot(link.cargoSnapshot),
        }))
      if (cargo.length === 0) return []

      const state = eventState(trip, stop)
      const terminal = state === 'completed' || state === 'cancelled'
      const eventAt = terminal
        ? stop.completedAt || trip.completedAt || trip.cancelledAt || trip.updatedAt || stop.plannedArrivalAt
        : stop.plannedArrivalAt
      return [{
        id: `${trip.id}:${stop.id}`,
        tripId: trip.id,
        pickupStopId: stop.id,
        tripNumber: transportTripDisplayName({
          scheduledDate: trip.scheduledDate,
          stops: trip.stops,
        }),
        state,
        scheduledAt: stop.plannedArrivalAt,
        arrivedAt: stop.arrivedAt,
        completedAt: stop.completedAt,
        eventAt,
        overdue: state === 'waiting'
          && Boolean(stop.plannedArrivalAt)
          && timestamp(stop.plannedArrivalAt) < nowMs,
        carrierName: trip.carrierName,
        route: trip.route || trip.stops.map((entry) => entry.pointLabel).join(' → '),
        cargo,
      }]
    })
  })

  return {
    active: events
      .filter((event) => event.state === 'waiting' || event.state === 'onsite')
      .sort((left, right) => timestamp(left.scheduledAt) - timestamp(right.scheduledAt) || left.tripNumber.localeCompare(right.tripNumber, 'ru')),
    history: events
      .filter((event) => event.state === 'completed' || event.state === 'cancelled')
      .sort((left, right) => historyTimestamp(right.eventAt) - historyTimestamp(left.eventAt) || right.tripNumber.localeCompare(left.tripNumber, 'ru'))
      .slice(0, input.historyLimit ?? 50),
  }
}
