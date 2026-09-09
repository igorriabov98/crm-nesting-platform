import 'server-only'

import { canAccessAllFactoriesFromMatrixOrAdmin } from '@/lib/permissions/factory-scope'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  projectProductionLocalShipments,
  type ProductionLocalShipmentsWorkspace,
  type ProductionShipmentLinkRow,
  type ProductionShipmentStopRow,
  type ProductionShipmentTripRow,
} from '@/lib/transport/production-local-shipments'

type DbResult = { data: unknown; error: { message?: string } | null }
type Query = PromiseLike<DbResult> & {
  select: (columns?: string) => Query
  eq: (column: string, value: unknown) => Query
  in: (column: string, values: unknown[]) => Query
  is: (column: string, value: unknown) => Query
  order: (column: string, options?: { ascending?: boolean }) => Query
}
type Db = { from: (table: string) => Query }

type FactoryRow = { id: string; name: string }
type StopRow = {
  id: string
  transport_order_id: string
  sequence_no: number
  stop_kind: 'start' | 'service' | 'finish'
  point_key: string
  point_label: string
  city: string | null
  planned_arrival_at: string | null
  status: 'planned' | 'arrived' | 'completed'
  arrived_at: string | null
  completed_at: string | null
}
type LinkRow = {
  id: string
  transport_order_id: string
  need_kind: 'materials' | 'detailing' | 'outsourcing'
  source_point_key: string
  destination_point_label: string
  need_title: string
  need_subtitle: string | null
  pickup_stop_id: string | null
  released_at: string | null
  cargo_snapshot: unknown
}
type TripRow = {
  id: string
  status: 'needed' | 'found' | 'in_transit' | 'completed' | 'cancelled'
  carrier_supplier_id: string | null
  scheduled_date: string | null
  route: string | null
  completed_at: string | null
  cancelled_at: string | null
  updated_at: string | null
}
type CarrierRow = { id: string; name: string }

function asDb(value: unknown): Db {
  return value as Db
}

function mapStop(stop: StopRow): ProductionShipmentStopRow {
  return {
    id: stop.id,
    sequence: stop.sequence_no,
    kind: stop.stop_kind,
    pointKey: stop.point_key,
    pointLabel: stop.point_label,
    city: stop.city,
    plannedArrivalAt: stop.planned_arrival_at,
    status: stop.status,
    arrivedAt: stop.arrived_at,
    completedAt: stop.completed_at,
  }
}

function mapLink(link: LinkRow): ProductionShipmentLinkRow {
  return {
    id: link.id,
    needKind: link.need_kind,
    sourcePointKey: link.source_point_key,
    destinationPointLabel: link.destination_point_label,
    title: link.need_title,
    subtitle: link.need_subtitle,
    pickupStopId: link.pickup_stop_id,
    releasedAt: link.released_at,
    cargoSnapshot: link.cargo_snapshot,
  }
}

export async function getProductionLocalShipmentsWorkspace(input: {
  factoryId?: string | null
} = {}): Promise<ProductionLocalShipmentsWorkspace> {
  const auth = await requirePermission('production_fact', 'view')
  const canViewAll = canAccessAllFactoriesFromMatrixOrAdmin(auth, 'production_fact', 'view')
  const db = asDb(createAdminClient())
  const factoryResult = canViewAll
    ? await db.from('factories').select('id, name').order('name', { ascending: true })
    : auth.factoryId
      ? await db.from('factories').select('id, name').eq('id', auth.factoryId)
      : { data: [], error: null }
  if (factoryResult.error) throw new Error(factoryResult.error.message || 'Не удалось загрузить заводы')

  const factories = (factoryResult.data || []) as FactoryRow[]
  const selectedFactoryId = factories.some((factory) => factory.id === input.factoryId)
    ? input.factoryId!
    : factories.some((factory) => factory.id === auth.factoryId)
      ? auth.factoryId
      : factories[0]?.id || null
  const generatedAt = new Date().toISOString()
  if (!selectedFactoryId) {
    return {
      factories,
      selectedFactoryId: null,
      canViewAllFactories: canViewAll,
      active: [],
      history: [],
      generatedAt,
    }
  }

  const factoryPointKey = `factory:${selectedFactoryId}`
  const pickupStopsResult = await db
    .from('transport_trip_stops')
    .select('id, transport_order_id')
    .eq('point_key', factoryPointKey)
  if (pickupStopsResult.error) {
    throw new Error(pickupStopsResult.error.message || 'Не удалось загрузить остановки транспорта')
  }
  const tripIds = Array.from(new Set(
    ((pickupStopsResult.data || []) as Array<{ transport_order_id: string }>)
      .map((stop) => stop.transport_order_id),
  ))
  if (tripIds.length === 0) {
    return {
      factories,
      selectedFactoryId,
      canViewAllFactories: canViewAll,
      active: [],
      history: [],
      generatedAt,
    }
  }

  const [tripsResult, stopsResult, linksResult] = await Promise.all([
    db.from('machine_outsourcing_transport_orders')
      .select('id, status, carrier_supplier_id, scheduled_date, route, completed_at, cancelled_at, updated_at')
      .in('id', tripIds),
    db.from('transport_trip_stops')
      .select('id, transport_order_id, sequence_no, stop_kind, point_key, point_label, city, planned_arrival_at, status, arrived_at, completed_at')
      .in('transport_order_id', tripIds)
      .order('sequence_no', { ascending: true }),
    db.from('transport_trip_need_links')
      .select('id, transport_order_id, need_kind, source_point_key, destination_point_label, need_title, need_subtitle, pickup_stop_id, released_at, cargo_snapshot')
      .in('transport_order_id', tripIds),
  ])
  const firstError = [tripsResult, stopsResult, linksResult].find((result) => result.error)?.error
  if (firstError) throw new Error(firstError.message || 'Не удалось загрузить локальные отгрузки')

  const tripRows = (tripsResult.data || []) as TripRow[]
  const carrierIds = Array.from(new Set(
    tripRows.map((trip) => trip.carrier_supplier_id).filter((id): id is string => Boolean(id)),
  ))
  const carriersResult = carrierIds.length > 0
    ? await db.from('suppliers').select('id, name').in('id', carrierIds)
    : { data: [], error: null }
  if (carriersResult.error) throw new Error(carriersResult.error.message || 'Не удалось загрузить перевозчиков')
  const carrierById = new Map(
    ((carriersResult.data || []) as CarrierRow[]).map((carrier) => [carrier.id, carrier.name]),
  )

  const stopsByTrip = new Map<string, ProductionShipmentStopRow[]>()
  for (const stop of (stopsResult.data || []) as StopRow[]) {
    stopsByTrip.set(stop.transport_order_id, [
      ...(stopsByTrip.get(stop.transport_order_id) || []),
      mapStop(stop),
    ])
  }
  const linksByTrip = new Map<string, ProductionShipmentLinkRow[]>()
  for (const link of (linksResult.data || []) as LinkRow[]) {
    linksByTrip.set(link.transport_order_id, [
      ...(linksByTrip.get(link.transport_order_id) || []),
      mapLink(link),
    ])
  }
  const trips: ProductionShipmentTripRow[] = tripRows.map((trip) => ({
    id: trip.id,
    status: trip.status,
    scheduledDate: trip.scheduled_date,
    carrierName: trip.carrier_supplier_id ? carrierById.get(trip.carrier_supplier_id) || null : null,
    route: trip.route,
    completedAt: trip.completed_at,
    cancelledAt: trip.cancelled_at,
    updatedAt: trip.updated_at,
    stops: stopsByTrip.get(trip.id) || [],
    links: linksByTrip.get(trip.id) || [],
  }))
  const projected = projectProductionLocalShipments({ factoryId: selectedFactoryId, trips })

  return {
    factories,
    selectedFactoryId,
    canViewAllFactories: canViewAll,
    ...projected,
    generatedAt,
  }
}
