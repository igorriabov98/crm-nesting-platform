import 'server-only'

import { canAccessAllFactoriesFromMatrixOrAdmin } from '@/lib/permissions/factory-scope'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  projectProductionLocalShipments,
  visibleProductionShipmentNeedKeys,
  type ProductionShipmentNeedSource,
  type ProductionShipmentNeedState,
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
  need_source: ProductionShipmentNeedSource
  need_id: string
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
type TransferSourceRow = { id: string; status: string; machine_id: string }
type OutsourcingNeedSourceRow = { id: string; status: string; operation_id: string }
type OutsourcingOperationSourceRow = { id: string; machine_id: string }
type SupplyScheduleSourceRow = {
  id: string
  status: string
  supplier_id: string | null
  receipt_parent_schedule_id: string | null
  request_item_table: string
  request_item_id: string
}
type RequestItemSourceRow = { id: string; request_id: string }
type RequestSourceRow = { id: string; machine_id: string }
type MachineSourceRow = { id: string; factory_id: string | null; is_archived: boolean | null }
type SupplierSourceRow = { id: string }

const SUPPLY_REQUEST_ITEM_TABLES = new Set([
  'request_sheet_metal',
  'request_round_tube',
  'request_circle',
  'request_pipe',
  'request_knives',
  'request_components',
  'request_paint',
  'request_mesh',
  'request_chain_cord',
])

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
    needSource: link.need_source,
    needId: link.need_id,
    sourcePointKey: link.source_point_key,
    destinationPointLabel: link.destination_point_label,
    title: link.need_title,
    subtitle: link.need_subtitle,
    pickupStopId: link.pickup_stop_id,
    releasedAt: link.released_at,
    cargoSnapshot: link.cargo_snapshot,
  }
}

function needIdsBySource(links: LinkRow[], source: ProductionShipmentNeedSource) {
  return Array.from(new Set(
    links.filter((link) => link.need_source === source).map((link) => link.need_id),
  ))
}

async function rowsByIds(db: Db, table: string, columns: string, ids: string[], errorMessage: string) {
  if (ids.length === 0) return []
  const result = await db.from(table).select(columns).in('id', ids)
  if (result.error) throw new Error(result.error.message || errorMessage)
  return (result.data || []) as unknown[]
}

async function loadVisibleActiveNeedKeys(db: Db, trips: TripRow[], links: LinkRow[]) {
  const activeTripIds = new Set(
    trips.filter((trip) => trip.status !== 'completed' && trip.status !== 'cancelled').map((trip) => trip.id),
  )
  const activeLinks = links.filter((link) => activeTripIds.has(link.transport_order_id) && !link.released_at)
  if (activeLinks.length === 0) return new Set<string>()

  const inventoryIds = needIdsBySource(activeLinks, 'inventory_transfer')
  const detailingIds = needIdsBySource(activeLinks, 'detailing_transfer')
  const outsourcingIds = needIdsBySource(activeLinks, 'outsourcing')
  const supplyIds = needIdsBySource(activeLinks, 'supply_schedule')
  const [inventoryRows, detailingRows, outsourcingRows, supplyRows] = await Promise.all([
    rowsByIds(db, 'inventory_transfers', 'id, status, machine_id', inventoryIds, 'Не удалось проверить перевозки материалов'),
    rowsByIds(db, 'detailing_transfers', 'id, status, machine_id', detailingIds, 'Не удалось проверить перевозки деталировки'),
    rowsByIds(db, 'machine_outsourcing_transport_needs', 'id, status, operation_id', outsourcingIds, 'Не удалось проверить перевозки аутсорсинга'),
    rowsByIds(db, 'supply_order_delivery_schedules', 'id, status, supplier_id, receipt_parent_schedule_id, request_item_table, request_item_id', supplyIds, 'Не удалось проверить поставки материалов'),
  ])

  const inventory = inventoryRows as TransferSourceRow[]
  const detailing = detailingRows as TransferSourceRow[]
  const outsourcing = outsourcingRows as OutsourcingNeedSourceRow[]
  const supply = supplyRows as SupplyScheduleSourceRow[]
  const operationRows = await rowsByIds(
    db,
    'machine_outsourcing_operations',
    'id, machine_id',
    Array.from(new Set(outsourcing.map((row) => row.operation_id))),
    'Не удалось проверить операции аутсорсинга',
  ) as OutsourcingOperationSourceRow[]
  const operationById = new Map(operationRows.map((row) => [row.id, row]))

  const itemGroups = new Map<string, string[]>()
  for (const schedule of supply) {
    if (!SUPPLY_REQUEST_ITEM_TABLES.has(schedule.request_item_table)) continue
    itemGroups.set(schedule.request_item_table, [
      ...(itemGroups.get(schedule.request_item_table) || []),
      schedule.request_item_id,
    ])
  }
  const itemResults = await Promise.all(Array.from(itemGroups.entries()).map(async ([table, ids]) => ({
    table,
    rows: await rowsByIds(
      db,
      table,
      'id, request_id',
      Array.from(new Set(ids)),
      'Не удалось проверить позиции поставки',
    ) as RequestItemSourceRow[],
  })))
  const itemByKey = new Map(
    itemResults.flatMap(({ table, rows }) => rows.map((row) => [`${table}:${row.id}`, row] as const)),
  )
  const requestRows = await rowsByIds(
    db,
    'technologist_requests',
    'id, machine_id',
    Array.from(new Set(itemResults.flatMap(({ rows }) => rows.map((row) => row.request_id)))),
    'Не удалось проверить заявки поставок',
  ) as RequestSourceRow[]
  const requestById = new Map(requestRows.map((row) => [row.id, row]))

  const machineIds = Array.from(new Set([
    ...inventory.map((row) => row.machine_id),
    ...detailing.map((row) => row.machine_id),
    ...operationRows.map((row) => row.machine_id),
    ...requestRows.map((row) => row.machine_id),
  ]))
  const [machineRows, supplierRows] = await Promise.all([
    rowsByIds(
      db,
      'machines',
      'id, factory_id, is_archived',
      machineIds,
      'Не удалось проверить производственные заказы перевозок',
    ) as Promise<MachineSourceRow[]>,
    rowsByIds(
      db,
      'suppliers',
      'id',
      Array.from(new Set(supply.map((row) => row.supplier_id).filter((id): id is string => Boolean(id)))),
      'Не удалось проверить поставщиков перевозок',
    ) as Promise<SupplierSourceRow[]>,
  ])
  const machineById = new Map(machineRows.map((row) => [row.id, row]))
  const supplierIds = new Set(supplierRows.map((row) => row.id))

  const states: ProductionShipmentNeedState[] = [
    ...inventory.map((row) => ({
      id: row.id,
      source: 'inventory_transfer' as const,
      status: row.status,
      hasRequiredRelations: true,
      machineArchived: machineById.get(row.machine_id)?.is_archived === true,
    })),
    ...detailing.map((row) => ({
      id: row.id,
      source: 'detailing_transfer' as const,
      status: row.status,
      hasRequiredRelations: true,
      machineArchived: machineById.get(row.machine_id)?.is_archived === true,
    })),
    ...outsourcing.map((row) => {
      const operation = operationById.get(row.operation_id)
      return {
        id: row.id,
        source: 'outsourcing' as const,
        status: row.status,
        hasRequiredRelations: Boolean(operation && machineById.has(operation.machine_id)),
        machineArchived: operation ? machineById.get(operation.machine_id)?.is_archived === true : false,
      }
    }),
    ...supply.map((row) => {
      const item = itemByKey.get(`${row.request_item_table}:${row.request_item_id}`)
      const request = item ? requestById.get(item.request_id) : null
      const machine = request ? machineById.get(request.machine_id) : null
      return {
        id: row.id,
        source: 'supply_schedule' as const,
        status: row.status,
        hasRequiredRelations: Boolean(machine?.factory_id && row.supplier_id && supplierIds.has(row.supplier_id)),
        machineArchived: machine?.is_archived === true,
        supplierId: row.supplier_id && supplierIds.has(row.supplier_id) ? row.supplier_id : null,
        receiptParentScheduleId: row.receipt_parent_schedule_id,
      }
    }),
  ]
  return visibleProductionShipmentNeedKeys(states)
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
      .select('id, transport_order_id, need_kind, need_source, need_id, source_point_key, destination_point_label, need_title, need_subtitle, pickup_stop_id, released_at, cargo_snapshot')
      .in('transport_order_id', tripIds),
  ])
  const firstError = [tripsResult, stopsResult, linksResult].find((result) => result.error)?.error
  if (firstError) throw new Error(firstError.message || 'Не удалось загрузить локальные отгрузки')

  const tripRows = (tripsResult.data || []) as TripRow[]
  const linkRows = (linksResult.data || []) as LinkRow[]
  const visibleActiveNeedKeys = await loadVisibleActiveNeedKeys(db, tripRows, linkRows)
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
  for (const link of linkRows) {
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
  const projected = projectProductionLocalShipments({
    factoryId: selectedFactoryId,
    trips,
    visibleActiveNeedKeys,
  })

  return {
    factories,
    selectedFactoryId,
    canViewAllFactories: canViewAll,
    ...projected,
    generatedAt,
  }
}
