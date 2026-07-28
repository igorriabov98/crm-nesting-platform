'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import {
  getOutsourcingTransportWorkspace,
  type OutsourcingSupplierOption,
  type SupplyOutsourcingAgreement,
  type TransportWorkspaceNeed,
} from '@/lib/actions/outsourcing'
import {
  getDetailingTransportWorkspace,
  type DetailingTransferCard,
} from '@/lib/actions/detailing'
import {
  getInventoryTransportWorkspace,
  type InventoryTransferCard,
} from '@/lib/actions/inventory-transfers'
import {
  getSupplyTransportNeeds,
  type SupplyTransportNeed,
} from '@/lib/actions/supply-orders'
import { ROUTES } from '@/lib/constants/routes'
import { requirePermission } from '@/lib/permissions/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTransportStopOrderError } from '@/lib/transport/trip-rules'
import { getErrorMessage } from '@/lib/utils/get-error-message'
import { isDirector } from '@/lib/utils/permissions'

export type TransportNeedKind = 'materials' | 'detailing' | 'outsourcing'
export type TransportNeedSource = 'inventory_transfer' | 'supply_schedule' | 'detailing_transfer' | 'outsourcing'
export type TransportTripStatus = 'needed' | 'found' | 'in_transit' | 'completed' | 'cancelled'
export type TransportTripDirection = 'outbound' | 'return' | 'mixed'
export type TransportTripStopStatus = 'planned' | 'arrived' | 'completed'
export type TransportTripDateChangeState = 'not_required' | 'pending' | 'approved' | 'rejected' | 'conflicted'
export type TransportNeedPlanState = 'preliminary' | 'confirmed'

export type UnifiedTransportNeed = {
  key: string
  id: string
  kind: TransportNeedKind
  source: TransportNeedSource
  direction: 'outbound' | 'return'
  planState: TransportNeedPlanState
  status: string
  title: string
  subtitle: string
  sourcePointKey: string
  sourcePointLabel: string
  sourcePointCity: string | null
  sourcePointAddress: string | null
  destinationPointKey: string
  destinationPointLabel: string
  destinationPointCity: string | null
  destinationPointAddress: string | null
  neededDate: string | null
  deadline: string | null
  itemLabels: string[]
  volumeLabel: string | null
  deliveryRisk: boolean
  selectable: boolean
  unavailableReason: string | null
}

export type TransportTripNeed = Omit<
  UnifiedTransportNeed,
  'planState' | 'status' | 'deadline' | 'itemLabels' | 'volumeLabel' | 'deliveryRisk' | 'selectable' | 'unavailableReason'
> & {
  linkId: string | null
  pickupStopId: string | null
  deliveryStopId: string | null
  released: boolean
}

export type TransportTripStop = {
  id: string
  clientKey: string
  sequence: number
  kind: 'start' | 'service' | 'finish'
  pointKey: string
  pointLabel: string
  city: string | null
  address: string | null
  plannedArrivalAt: string | null
  serviceDurationMinutes: number
  status: TransportTripStopStatus
  arrivedAt: string | null
  completedAt: string | null
}

export type TransportTrip = {
  id: string
  direction: TransportTripDirection
  status: TransportTripStatus
  carrierSupplierId: string | null
  carrierName: string | null
  scheduledDate: string | null
  price: number | null
  routeStartKey: string | null
  routeStart: string | null
  route: string | null
  comment: string | null
  dateChangeState: TransportTripDateChangeState
  dateChangeRequests: TransportTripDateChangeRequest[]
  needs: TransportTripNeed[]
  stops: TransportTripStop[]
}

export type TransportTripDateChangeRequest = {
  id: string
  status: Exclude<TransportTripDateChangeState, 'not_required'>
  reason: string
  decisionComment: string | null
  requestedByName: string | null
  decidedByName: string | null
  createdAt: string
  decidedAt: string | null
  items: Array<{
    id: string
    needSource: TransportNeedSource
    needId: string
    oldDate: string
    newDate: string
    status: Exclude<TransportTripDateChangeState, 'not_required'>
  }>
}

export type TransportWorkspace = {
  needs: UnifiedTransportNeed[]
  trips: TransportTrip[]
  carriers: OutsourcingSupplierOption[]
  agreements: SupplyOutsourcingAgreement[]
  errors: Partial<Record<TransportNeedKind | 'trips', string>>
}

type DbError = { code?: string; message?: string }
type DbResult<T = unknown> = { data: T | null; error: DbError | null }
type TransportQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => TransportQuery
  in: (column: string, values: unknown[]) => TransportQuery
  is: (column: string, value: unknown) => TransportQuery
  eq: (column: string, value: unknown) => TransportQuery
  order: (column: string, options?: { ascending?: boolean }) => TransportQuery
}
type TransportDb = {
  from: (table: string) => TransportQuery
  rpc: (name: string, args: Record<string, unknown>) => Promise<DbResult>
}

type TripLinkRow = {
  id: string
  transport_order_id: string
  need_kind: TransportNeedKind
  need_source: TransportNeedSource
  need_id: string
  direction: 'outbound' | 'return'
  source_point_key: string
  source_point_label: string
  destination_point_key: string
  destination_point_label: string
  need_title: string
  need_subtitle: string | null
  needed_date: string | null
  pickup_stop_id: string | null
  delivery_stop_id: string | null
  released_at: string | null
}

type TripStopRow = {
  id: string
  transport_order_id: string
  client_key: string
  sequence_no: number
  stop_kind: 'start' | 'service' | 'finish'
  point_key: string
  point_label: string
  city: string | null
  address: string | null
  planned_arrival_at: string | null
  service_duration_minutes: number
  status: TransportTripStopStatus
  arrived_at: string | null
  completed_at: string | null
}

type TripDateRequestRow = {
  id: string
  transport_order_id: string
  status: Exclude<TransportTripDateChangeState, 'not_required'>
  reason: string
  decision_comment: string | null
  created_at: string
  decided_at: string | null
  requested_by_user?: { full_name: string } | { full_name: string }[] | null
  decided_by_user?: { full_name: string } | { full_name: string }[] | null
}

type TripDateItemRow = {
  id: string
  request_id: string
  need_source: TransportNeedSource
  need_id: string
  old_date: string
  new_date: string
  status: Exclude<TransportTripDateChangeState, 'not_required'>
}

const needReferenceSchema = z.object({
  source: z.enum(['inventory_transfer', 'supply_schedule', 'detailing_transfer', 'outsourcing']),
  id: z.string().uuid(),
})

const createTripSchema = z.object({
  needs: z.array(needReferenceSchema).min(1).max(50),
  carrierSupplierId: z.string().uuid(),
  scheduledDate: z.string().date(),
  price: z.coerce.number().nonnegative(),
  stops: z.array(z.object({
    clientId: z.string().trim().min(1).max(120),
    pointKey: z.string().trim().min(1).max(240),
    pointLabel: z.string().trim().min(1).max(240),
    city: z.string().trim().max(160).nullable().optional(),
    address: z.string().trim().max(300).nullable().optional(),
    kind: z.enum(['start', 'service', 'finish']),
    plannedArrivalAt: z.string().datetime(),
    serviceDurationMinutes: z.coerce.number().int().min(0).max(1440),
  })).min(2).max(120),
  assignments: z.array(z.object({
    needKey: z.string().trim().min(1),
    pickupStopClientId: z.string().trim().min(1),
    deliveryStopClientId: z.string().trim().min(1),
  })).min(1).max(50),
  comment: z.string().trim().max(1000).nullable().optional(),
  dateChangeReason: z.string().trim().max(1000).nullable().optional(),
})

const updateTripSchema = z.object({
  tripId: z.string().uuid(),
  status: z.enum(['found', 'in_transit', 'completed', 'cancelled']),
  carrierSupplierId: z.string().uuid(),
  scheduledDate: z.string().date(),
  price: z.coerce.number().nonnegative(),
  route: z.string().trim().min(1).max(4000),
  comment: z.string().trim().max(1000).nullable().optional(),
  dateChangeReason: z.string().trim().max(1000).nullable().optional(),
  stops: z.array(z.object({
    id: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    plannedArrivalAt: z.string().datetime().nullable(),
    serviceDurationMinutes: z.coerce.number().int().min(0).max(1440),
  })).min(1).max(120).nullable().optional(),
})

const updateStopStatusSchema = z.object({
  stopId: z.string().uuid(),
  status: z.enum(['arrived', 'completed']),
})

function transportDb(value: unknown): TransportDb {
  return value as TransportDb
}

function needKey(source: TransportNeedSource, id: string) {
  return `${source}:${id}`
}

function numberLabel(value: number, maximumFractionDigits = 3) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value)
}

function isActiveTransfer(status: string) {
  return !['completed', 'cancelled'].includes(status)
}

function supplierPointMissingCity(pointKey: string, city: string | null) {
  return (pointKey.startsWith('supplier:') || pointKey.startsWith('factory:')) && !city?.trim()
}

function mapOutsourcingNeed(need: TransportWorkspaceNeed): UnifiedTransportNeed {
  return {
    key: needKey('outsourcing', need.id),
    id: need.id,
    kind: 'outsourcing',
    source: 'outsourcing',
    direction: need.direction,
    planState: need.plan_state,
    status: need.status,
    title: need.machine_name,
    subtitle: need.work_type_name,
    sourcePointKey: need.source_point_key,
    sourcePointLabel: need.source_point_label,
    sourcePointCity: need.source_point_city,
    sourcePointAddress: need.source_point_address,
    destinationPointKey: need.destination_point_key,
    destinationPointLabel: need.destination_point_label,
    destinationPointCity: need.destination_point_city,
    destinationPointAddress: need.destination_point_address,
    neededDate: need.needed_date,
    deadline: need.needed_date,
    itemLabels: need.item_labels,
    volumeLabel: need.item_labels.length > 0 ? `${need.item_labels.length} поз.` : null,
    deliveryRisk: false,
    selectable: need.plan_state === 'confirmed'
      && !supplierPointMissingCity(need.source_point_key, need.source_point_city)
      && !supplierPointMissingCity(need.destination_point_key, need.destination_point_city),
    unavailableReason: need.plan_state !== 'confirmed'
      ? 'Ожидает подтверждения'
      : supplierPointMissingCity(need.source_point_key, need.source_point_city)
        || supplierPointMissingCity(need.destination_point_key, need.destination_point_city)
        ? 'У компании не указан город'
        : null,
  }
}

function mapDetailingNeed(card: DetailingTransferCard): UnifiedTransportNeed {
  return {
    key: needKey('detailing_transfer', card.id),
    id: card.id,
    kind: 'detailing',
    source: 'detailing_transfer',
    direction: 'outbound',
    planState: 'confirmed',
    status: card.status,
    title: card.machineName,
    subtitle: 'Деталировка',
    sourcePointKey: `factory:${card.sourceFactoryId}`,
    sourcePointLabel: card.sourceFactoryName,
    sourcePointCity: card.sourceFactoryCity,
    sourcePointAddress: card.sourceFactoryAddress,
    destinationPointKey: `factory:${card.destinationFactoryId}`,
    destinationPointLabel: card.destinationFactoryName,
    destinationPointCity: card.destinationFactoryCity,
    destinationPointAddress: card.destinationFactoryAddress,
    neededDate: card.expectedArrivalDate || card.deadline,
    deadline: card.deadline,
    itemLabels: card.items.map((item) => `${item.partName} · ${item.drawingNumber}`),
    volumeLabel: `${numberLabel(card.totalQuantity, 0)} шт. · ${numberLabel(card.totalWeightKg)} кг`,
    deliveryRisk: card.deliveryRisk,
    selectable: Boolean(card.sourceFactoryCity?.trim() && card.destinationFactoryCity?.trim()),
    unavailableReason: card.sourceFactoryCity?.trim() && card.destinationFactoryCity?.trim() ? null : 'У площадки не указан город',
  }
}

function mapMaterialNeed(card: InventoryTransferCard): UnifiedTransportNeed {
  return {
    key: needKey('inventory_transfer', card.id),
    id: card.id,
    kind: 'materials',
    source: 'inventory_transfer',
    direction: 'outbound',
    planState: 'confirmed',
    status: card.status,
    title: card.machineName,
    subtitle: 'Материалы',
    sourcePointKey: `factory:${card.sourceFactoryId}`,
    sourcePointLabel: card.sourceFactoryName,
    sourcePointCity: card.sourceFactoryCity,
    sourcePointAddress: card.sourceFactoryAddress,
    destinationPointKey: `factory:${card.destinationFactoryId}`,
    destinationPointLabel: card.destinationFactoryName,
    destinationPointCity: card.destinationFactoryCity,
    destinationPointAddress: card.destinationFactoryAddress,
    neededDate: card.expectedArrivalDate || card.deadline,
    deadline: card.deadline,
    itemLabels: card.items.map((item) => item.materialName),
    volumeLabel: `${card.items.length} поз.`,
    deliveryRisk: card.deliveryRisk,
    selectable: Boolean(card.sourceFactoryCity?.trim() && card.destinationFactoryCity?.trim()),
    unavailableReason: card.sourceFactoryCity?.trim() && card.destinationFactoryCity?.trim() ? null : 'У площадки не указан город',
  }
}

function mapSupplyNeed(need: SupplyTransportNeed): UnifiedTransportNeed {
  return {
    key: needKey('supply_schedule', need.id),
    id: need.id,
    kind: 'materials',
    source: 'supply_schedule',
    direction: 'outbound',
    planState: 'confirmed',
    status: 'planned',
    title: need.machineName,
    subtitle: need.supplierName,
    sourcePointKey: `supplier:${need.supplierId}`,
    sourcePointLabel: need.supplierLocation,
    sourcePointCity: need.supplierCity,
    sourcePointAddress: need.supplierAddress,
    destinationPointKey: `factory:${need.factoryId}`,
    destinationPointLabel: need.factoryName,
    destinationPointCity: need.factoryCity,
    destinationPointAddress: need.factoryAddress,
    neededDate: need.deliveryDate,
    deadline: need.deliveryDate,
    itemLabels: [need.itemName],
    volumeLabel: `${numberLabel(need.quantity)} ${need.unit}`,
    deliveryRisk: false,
    selectable: Boolean(need.supplierCity?.trim() && need.factoryCity?.trim()),
    unavailableReason: need.supplierCity?.trim() && need.factoryCity?.trim() ? null : 'У площадки не указан город',
  }
}

function mapLink(link: TripLinkRow): TransportTripNeed {
  return {
    linkId: link.id,
    key: needKey(link.need_source, link.need_id),
    id: link.need_id,
    kind: link.need_kind,
    source: link.need_source,
    direction: link.direction,
    title: link.need_title,
    subtitle: link.need_subtitle || '',
    sourcePointKey: link.source_point_key,
    sourcePointLabel: link.source_point_label,
    sourcePointCity: null,
    sourcePointAddress: null,
    destinationPointKey: link.destination_point_key,
    destinationPointLabel: link.destination_point_label,
    destinationPointCity: null,
    destinationPointAddress: null,
    neededDate: link.needed_date,
    pickupStopId: link.pickup_stop_id,
    deliveryStopId: link.delivery_stop_id,
    released: Boolean(link.released_at),
  }
}

function mapLegacyOutsourcingNeed(need: TransportWorkspaceNeed): TransportTripNeed {
  return {
    linkId: null,
    key: needKey('outsourcing', need.id),
    id: need.id,
    kind: 'outsourcing',
    source: 'outsourcing',
    direction: need.direction,
    title: need.machine_name,
    subtitle: need.work_type_name,
    sourcePointKey: need.source_point_key,
    sourcePointLabel: need.source_point_label,
    sourcePointCity: need.source_point_city,
    sourcePointAddress: need.source_point_address,
    destinationPointKey: need.destination_point_key,
    destinationPointLabel: need.destination_point_label,
    destinationPointCity: need.destination_point_city,
    destinationPointAddress: need.destination_point_address,
    neededDate: need.needed_date,
    pickupStopId: null,
    deliveryStopId: null,
    released: false,
  }
}

function isMissingLinksTable(error: DbError | null) {
  const message = error?.message || ''
  return error?.code === '42P01'
    || /transport_trip_need_links/i.test(message) && /does not exist|schema cache/i.test(message)
}

async function loadTripLinks(db: TransportDb, tripIds: string[]) {
  const activeLinksQuery = db
    .from('transport_trip_need_links')
    .select('*')
    .is('released_at', null)
    .order('created_at', { ascending: true })
  const results = await Promise.all([
    activeLinksQuery,
    ...(tripIds.length > 0
      ? [
          db
            .from('transport_trip_need_links')
            .select('*')
            .in('transport_order_id', tripIds)
            .order('created_at', { ascending: true }),
        ]
      : []),
  ])
  const links = new Map<string, TripLinkRow>()
  for (const { data, error } of results) {
    if (error && !isMissingLinksTable(error)) {
      throw new Error(error.message || 'Не удалось загрузить состав рейсов')
    }
    for (const row of (data || []) as TripLinkRow[]) links.set(row.id, row)
  }
  return Array.from(links.values())
}

function isMissingStopsTable(error: DbError | null) {
  const message = error?.message || ''
  return error?.code === '42P01'
    || /transport_trip_stops/i.test(message) && /does not exist|schema cache/i.test(message)
}

async function loadTripStops(db: TransportDb, tripIds: string[]) {
  if (tripIds.length === 0) return [] as TripStopRow[]
  const { data, error } = await db
    .from('transport_trip_stops')
    .select('*')
    .in('transport_order_id', tripIds)
    .order('sequence_no', { ascending: true })
  if (error) {
    if (isMissingStopsTable(error)) return []
    throw new Error(error.message || 'Не удалось загрузить остановки рейсов')
  }
  return (data || []) as TripStopRow[]
}

function relationName(value: TripDateRequestRow['requested_by_user']) {
  const row = Array.isArray(value) ? value[0] : value
  return row?.full_name || null
}

async function loadTripDateChanges(db: TransportDb, tripIds: string[]) {
  if (tripIds.length === 0) return { requests: [] as TripDateRequestRow[], items: [] as TripDateItemRow[] }
  const { data: requestData, error: requestError } = await db
    .from('transport_trip_date_change_requests')
    .select('*, requested_by_user:users!transport_trip_date_change_requests_requested_by_fkey(full_name), decided_by_user:users!transport_trip_date_change_requests_decided_by_fkey(full_name)')
    .in('transport_order_id', tripIds)
    .order('created_at', { ascending: false })
  if (requestError) {
    if (requestError.code === '42P01' || /schema cache|does not exist/i.test(requestError.message || '')) {
      return { requests: [] as TripDateRequestRow[], items: [] as TripDateItemRow[] }
    }
    throw new Error(requestError.message || 'Не удалось загрузить согласования дат')
  }
  const requests = (requestData || []) as TripDateRequestRow[]
  if (requests.length === 0) return { requests, items: [] as TripDateItemRow[] }
  const { data: itemData, error: itemError } = await db
    .from('transport_trip_date_change_items')
    .select('*')
    .in('request_id', requests.map((request) => request.id))
    .order('sort_order', { ascending: true })
  if (itemError) throw new Error(itemError.message || 'Не удалось загрузить историю переносов')
  return { requests, items: (itemData || []) as TripDateItemRow[] }
}

function mapStop(stop: TripStopRow): TransportTripStop {
  return {
    id: stop.id,
    clientKey: stop.client_key,
    sequence: stop.sequence_no,
    kind: stop.stop_kind,
    pointKey: stop.point_key,
    pointLabel: stop.point_label,
    city: stop.city,
    address: stop.address,
    plannedArrivalAt: stop.planned_arrival_at,
    serviceDurationMinutes: stop.service_duration_minutes,
    status: stop.status,
    arrivedAt: stop.arrived_at,
    completedAt: stop.completed_at,
  }
}

async function loadTransportWorkspace(): Promise<TransportWorkspace> {
  await requirePermission('supply_transport', 'view')
  const db = transportDb(createAdminClient())
  const [outsourcingResult, detailingResult, materialsResult, supplyResult] = await Promise.all([
    getOutsourcingTransportWorkspace(),
    getDetailingTransportWorkspace(),
    getInventoryTransportWorkspace(),
    getSupplyTransportNeeds(),
  ])
  const tripIds = outsourcingResult.data.orders.map((order) => order.id)
  const [links, stops, dateChanges] = await Promise.all([
    loadTripLinks(db, tripIds),
    loadTripStops(db, tripIds),
    loadTripDateChanges(db, tripIds),
  ])

  const activeLinkedNeeds = new Set(
    links
      .filter((link) => !link.released_at)
      .map((link) => needKey(link.need_source, link.need_id)),
  )
  const needs = [
    ...outsourcingResult.data.needs.map(mapOutsourcingNeed),
    ...(detailingResult.data || [])
      .filter((card) => isActiveTransfer(card.status))
      .map(mapDetailingNeed),
    ...(materialsResult.data || [])
      .filter((card) => isActiveTransfer(card.status))
      .map(mapMaterialNeed),
    ...supplyResult.data.map(mapSupplyNeed),
  ]
    .filter((need) => !activeLinkedNeeds.has(need.key))
    .sort((left, right) => {
      const leftDate = left.neededDate || '9999-12-31'
      const rightDate = right.neededDate || '9999-12-31'
      return leftDate.localeCompare(rightDate) || left.title.localeCompare(right.title, 'ru')
    })

  const linksByTrip = new Map<string, TripLinkRow[]>()
  for (const link of links) {
    linksByTrip.set(link.transport_order_id, [
      ...(linksByTrip.get(link.transport_order_id) || []),
      link,
    ])
  }
  const stopsByTrip = new Map<string, TripStopRow[]>()
  for (const stop of stops) {
    stopsByTrip.set(stop.transport_order_id, [
      ...(stopsByTrip.get(stop.transport_order_id) || []),
      stop,
    ])
  }
  const dateItemsByRequest = new Map<string, TripDateItemRow[]>()
  for (const item of dateChanges.items) dateItemsByRequest.set(item.request_id, [...(dateItemsByRequest.get(item.request_id) || []), item])
  const dateRequestsByTrip = new Map<string, TransportTripDateChangeRequest[]>()
  for (const request of dateChanges.requests) {
    const mapped: TransportTripDateChangeRequest = {
      id: request.id,
      status: request.status,
      reason: request.reason,
      decisionComment: request.decision_comment,
      requestedByName: relationName(request.requested_by_user),
      decidedByName: relationName(request.decided_by_user),
      createdAt: request.created_at,
      decidedAt: request.decided_at,
      items: (dateItemsByRequest.get(request.id) || []).map((item) => ({
        id: item.id, needSource: item.need_source, needId: item.need_id,
        oldDate: item.old_date, newDate: item.new_date, status: item.status,
      })),
    }
    dateRequestsByTrip.set(request.transport_order_id, [...(dateRequestsByTrip.get(request.transport_order_id) || []), mapped])
  }

  const trips = outsourcingResult.data.orders.map((order): TransportTrip => {
    const linkedNeeds = linksByTrip.get(order.id)
    const tripNeeds = linkedNeeds?.length
      ? linkedNeeds.map(mapLink)
      : order.needs.map(mapLegacyOutsourcingNeed)
    const firstNeed = tripNeeds[0]
    const destinationLabels = Array.from(new Set(tripNeeds.map((need) => need.destinationPointLabel)))
    const routeStart = order.route_start || firstNeed?.sourcePointLabel || null
    return {
      id: order.id,
      direction: order.direction,
      status: order.status,
      carrierSupplierId: order.carrier_supplier_id,
      carrierName: order.carrier_name,
      scheduledDate: order.scheduled_date,
      price: order.price,
      routeStartKey: order.route_start_key || firstNeed?.sourcePointKey || null,
      routeStart,
      route: order.route || (
        routeStart && destinationLabels.length > 0
          ? `${routeStart} → ${destinationLabels.join(' → ')}`
          : routeStart
      ),
      comment: order.comment,
      dateChangeState: ((order as typeof order & { date_change_state?: TransportTripDateChangeState }).date_change_state || 'not_required'),
      dateChangeRequests: dateRequestsByTrip.get(order.id) || [],
      needs: tripNeeds,
      stops: (stopsByTrip.get(order.id) || []).map(mapStop),
    }
  })

  const errors: TransportWorkspace['errors'] = {}
  if (outsourcingResult.error) errors.outsourcing = outsourcingResult.error
  if (detailingResult.error) errors.detailing = detailingResult.error
  if (materialsResult.error || supplyResult.error) {
    errors.materials = [materialsResult.error, supplyResult.error].filter(Boolean).join(' · ')
  }

  return {
    needs,
    trips,
    carriers: outsourcingResult.data.carriers,
    agreements: outsourcingResult.data.agreements,
    errors,
  }
}

export async function getTransportWorkspace(): Promise<{
  data: TransportWorkspace
  error: string | null
}> {
  try {
    return { data: await loadTransportWorkspace(), error: null }
  } catch (error) {
    return {
      data: {
        needs: [],
        trips: [],
        carriers: [],
        agreements: [],
        errors: {},
      },
      error: getErrorMessage(error),
    }
  }
}

function revalidateTransportWorkspace() {
  revalidatePath(ROUTES.SUPPLY_TRANSPORT)
  revalidatePath(ROUTES.TASKS)
  revalidatePath(ROUTES.PRODUCTION)
  revalidatePath(ROUTES.INVENTORY)
  revalidatePath(ROUTES.INVENTORY_RECEIVING)
}

export async function createTransportTrip(input: z.input<typeof createTripSchema>) {
  try {
    const parsed = createTripSchema.parse(input)
    const { userId } = await requirePermission('supply_transport', 'manage')
    const workspace = await loadTransportWorkspace()
    const availableByKey = new Map(workspace.needs.map((need) => [need.key, need]))
    const selectedNeeds = parsed.needs.map((reference) => {
      const need = availableByKey.get(needKey(reference.source, reference.id))
      if (!need || !need.selectable) {
        throw new Error('Одна или несколько потребностей уже заняты или недоступны')
      }
      return need
    })

    if (selectedNeeds.length === 0) throw new Error('Выберите хотя бы одну потребность')
    const assignmentByNeed = new Map(parsed.assignments.map((assignment) => [assignment.needKey, assignment]))
    if (new Set(parsed.stops.map((stop) => stop.clientId)).size !== parsed.stops.length) {
      throw new Error('Идентификаторы остановок должны быть уникальными')
    }
    const canonicalPointByKey = new Map<string, {
      pointLabel: string
      city: string | null
      address: string | null
    }>()
    for (const need of selectedNeeds) {
      canonicalPointByKey.set(need.sourcePointKey, {
        pointLabel: need.sourcePointLabel,
        city: need.sourcePointCity,
        address: need.sourcePointAddress,
      })
      canonicalPointByKey.set(need.destinationPointKey, {
        pointLabel: need.destinationPointLabel,
        city: need.destinationPointCity,
        address: need.destinationPointAddress,
      })
    }
    const sanitizedStops = parsed.stops.map((stop) => {
      if (stop.kind !== 'service') return stop
      const canonical = canonicalPointByKey.get(stop.pointKey)
      if (!canonical) throw new Error('Маршрут содержит точку, которой нет в выбранных потребностях')
      return { ...stop, ...canonical }
    })
    const stopByClientId = new Map(sanitizedStops.map((stop) => [stop.clientId, stop]))
    if (assignmentByNeed.size !== selectedNeeds.length) {
      throw new Error('Для каждой потребности должны быть указаны точки забора и доставки')
    }
    if (sanitizedStops[0]?.kind !== 'start') throw new Error('Первая точка маршрута должна быть точкой выезда')
    if (sanitizedStops.slice(1, -1).some((stop) => stop.kind !== 'service')) {
      throw new Error('Служебные точки допускаются только в начале и конце маршрута')
    }
    if (sanitizedStops.some((stop, index) => stop.kind === 'finish' && index !== sanitizedStops.length - 1)) {
      throw new Error('Точка завершения должна быть последней')
    }
    const orderError = getTransportStopOrderError(
      sanitizedStops.map((stop) => ({ clientId: stop.clientId, plannedTime: stop.plannedArrivalAt })),
      parsed.assignments,
    )
    if (orderError) throw new Error(orderError)

    const links = selectedNeeds.map((need) => {
      const assignment = assignmentByNeed.get(need.key)
      if (!assignment) throw new Error(`Не найден маршрут для потребности «${need.title}»`)
      const pickupStop = stopByClientId.get(assignment.pickupStopClientId)
      const deliveryStop = stopByClientId.get(assignment.deliveryStopClientId)
      if (!pickupStop || !deliveryStop) throw new Error('Точка маршрута не найдена')
      if (pickupStop.pointKey !== need.sourcePointKey || deliveryStop.pointKey !== need.destinationPointKey) {
        throw new Error('Маршрут потребности не соответствует её точкам забора и доставки')
      }
      return {
        needKind: need.kind,
        needSource: need.source,
        needId: need.id,
        direction: need.direction,
        sourcePointKey: need.sourcePointKey,
        sourcePointLabel: need.sourcePointLabel,
        destinationPointKey: need.destinationPointKey,
        destinationPointLabel: need.destinationPointLabel,
        title: need.title,
        subtitle: need.subtitle,
        neededDate: need.neededDate,
        pickupStopClientId: assignment.pickupStopClientId,
        deliveryStopClientId: assignment.deliveryStopClientId,
      }
    })

    const { data, error } = await transportDb(createAdminClient()).rpc('fn_create_transport_trip_v3', {
      p_carrier_supplier_id: parsed.carrierSupplierId,
      p_scheduled_date: parsed.scheduledDate,
      p_price: parsed.price,
      p_comment: parsed.comment || null,
      p_stops: sanitizedStops,
      p_links: links,
      p_date_change_reason: parsed.dateChangeReason || null,
      p_actor: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось создать рейс')
    revalidateTransportWorkspace()
    return { success: true, id: String(data), error: null }
  } catch (error) {
    return { success: false, id: null, error: getErrorMessage(error) }
  }
}

export async function decideTransportTripDateChange(input: {
  requestId: string
  decision: 'approved' | 'rejected'
  comment?: string | null
}) {
  try {
    const parsed = z.object({
      requestId: z.string().uuid(), decision: z.enum(['approved', 'rejected']),
      comment: z.string().trim().max(1000).nullable().optional(),
    }).parse(input)
    const context = await requirePermission('tasks', 'manage')
    const admin = createAdminClient()
    const { data: requestData, error: requestError } = await admin
      .from('transport_trip_date_change_requests')
      .select('id, status, task:tasks(assigned_to)')
      .eq('id', parsed.requestId)
      .maybeSingle()
    if (requestError || !requestData) throw new Error(requestError?.message || 'Запрос согласования не найден')
    const request = requestData as { status: string; task: { assigned_to: string } | { assigned_to: string }[] | null }
    const task = Array.isArray(request.task) ? request.task[0] : request.task
    if (task?.assigned_to !== context.userId && !isDirector(context.role)) throw new Error('Недостаточно прав')
    const { data, error } = await transportDb(admin).rpc('fn_decide_transport_trip_date_change', {
      p_request_id: parsed.requestId,
      p_decision: parsed.decision,
      p_comment: parsed.comment || null,
      p_actor: context.userId,
    })
    if (error) throw new Error(error.message || 'Не удалось обработать согласование')
    revalidateTransportWorkspace()
    return { success: true, outcome: String(data) as TransportTripDateChangeState, error: null }
  } catch (error) {
    return { success: false, outcome: null, error: getErrorMessage(error) }
  }
}

export async function updateTransportTripStopStatus(input: z.input<typeof updateStopStatusSchema>) {
  try {
    const parsed = updateStopStatusSchema.parse(input)
    const { userId } = await requirePermission('supply_transport', 'manage')
    const { error } = await transportDb(createAdminClient()).rpc('fn_update_transport_trip_stop_status', {
      p_stop_id: parsed.stopId,
      p_status: parsed.status,
      p_actor: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось обновить остановку')
    revalidateTransportWorkspace()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function updateTransportTrip(input: z.input<typeof updateTripSchema>) {
  try {
    const parsed = updateTripSchema.parse(input)
    const { userId } = await requirePermission('supply_transport', 'manage')
    const { error } = await transportDb(createAdminClient()).rpc('fn_update_transport_trip_v3', {
      p_trip_id: parsed.tripId,
      p_status: parsed.status,
      p_carrier_supplier_id: parsed.carrierSupplierId,
      p_scheduled_date: parsed.scheduledDate,
      p_price: parsed.price,
      p_route: parsed.route,
      p_comment: parsed.comment || null,
      p_stops: parsed.stops || null,
      p_date_change_reason: parsed.dateChangeReason || null,
      p_actor: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось сохранить рейс')
    revalidateTransportWorkspace()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
