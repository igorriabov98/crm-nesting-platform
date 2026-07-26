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
import {
  assertRouteStartsAt,
  getTransportNeedConflict,
} from '@/lib/transport/trip-rules'
import { getErrorMessage } from '@/lib/utils/get-error-message'

export type TransportNeedKind = 'materials' | 'detailing' | 'outsourcing'
export type TransportTripStatus = 'needed' | 'found' | 'in_transit' | 'completed' | 'cancelled'
export type TransportNeedPlanState = 'preliminary' | 'confirmed'

export type UnifiedTransportNeed = {
  key: string
  id: string
  kind: TransportNeedKind
  direction: 'outbound' | 'return'
  planState: TransportNeedPlanState
  status: string
  title: string
  subtitle: string
  sourcePointKey: string
  sourcePointLabel: string
  destinationPointKey: string
  destinationPointLabel: string
  neededDate: string | null
  deadline: string | null
  itemLabels: string[]
  volumeLabel: string | null
  deliveryRisk: boolean
  selectable: boolean
}

export type TransportTripNeed = Omit<
  UnifiedTransportNeed,
  'planState' | 'status' | 'deadline' | 'itemLabels' | 'volumeLabel' | 'deliveryRisk' | 'selectable'
> & {
  linkId: string | null
  released: boolean
}

export type TransportTrip = {
  id: string
  direction: 'outbound' | 'return'
  status: TransportTripStatus
  carrierSupplierId: string | null
  carrierName: string | null
  scheduledDate: string | null
  price: number | null
  routeStartKey: string | null
  routeStart: string | null
  route: string | null
  comment: string | null
  needs: TransportTripNeed[]
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
  need_id: string
  direction: 'outbound' | 'return'
  source_point_key: string
  source_point_label: string
  destination_point_key: string
  destination_point_label: string
  need_title: string
  need_subtitle: string | null
  needed_date: string | null
  released_at: string | null
}

const needReferenceSchema = z.object({
  kind: z.enum(['materials', 'detailing', 'outsourcing']),
  id: z.string().uuid(),
})

const createTripSchema = z.object({
  needs: z.array(needReferenceSchema).min(1).max(50),
  carrierSupplierId: z.string().uuid(),
  scheduledDate: z.string().date(),
  price: z.coerce.number().nonnegative(),
  route: z.string().trim().min(1).max(500),
  comment: z.string().trim().max(1000).nullable().optional(),
})

const updateTripSchema = z.object({
  tripId: z.string().uuid(),
  status: z.enum(['found', 'in_transit', 'completed', 'cancelled']),
  carrierSupplierId: z.string().uuid(),
  scheduledDate: z.string().date(),
  price: z.coerce.number().nonnegative(),
  route: z.string().trim().min(1).max(500),
  comment: z.string().trim().max(1000).nullable().optional(),
})

function transportDb(value: unknown): TransportDb {
  return value as TransportDb
}

function needKey(kind: TransportNeedKind, id: string) {
  return `${kind}:${id}`
}

function numberLabel(value: number, maximumFractionDigits = 3) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits }).format(value)
}

function isActiveTransfer(status: string) {
  return !['completed', 'cancelled'].includes(status)
}

function mapOutsourcingNeed(need: TransportWorkspaceNeed): UnifiedTransportNeed {
  return {
    key: needKey('outsourcing', need.id),
    id: need.id,
    kind: 'outsourcing',
    direction: need.direction,
    planState: need.plan_state,
    status: need.status,
    title: need.machine_name,
    subtitle: need.work_type_name,
    sourcePointKey: need.source_point_key,
    sourcePointLabel: need.source_point_label,
    destinationPointKey: need.destination_point_key,
    destinationPointLabel: need.destination_point_label,
    neededDate: need.needed_date,
    deadline: need.needed_date,
    itemLabels: need.item_labels,
    volumeLabel: need.item_labels.length > 0 ? `${need.item_labels.length} поз.` : null,
    deliveryRisk: false,
    selectable: need.plan_state === 'confirmed',
  }
}

function mapDetailingNeed(card: DetailingTransferCard): UnifiedTransportNeed {
  return {
    key: needKey('detailing', card.id),
    id: card.id,
    kind: 'detailing',
    direction: 'outbound',
    planState: 'confirmed',
    status: card.status,
    title: card.machineName,
    subtitle: 'Деталировка',
    sourcePointKey: `factory:${card.sourceFactoryId}`,
    sourcePointLabel: card.sourceFactoryName,
    destinationPointKey: `factory:${card.destinationFactoryId}`,
    destinationPointLabel: card.destinationFactoryName,
    neededDate: card.expectedArrivalDate || card.deadline,
    deadline: card.deadline,
    itemLabels: card.items.map((item) => `${item.partName} · ${item.drawingNumber}`),
    volumeLabel: `${numberLabel(card.totalQuantity, 0)} шт. · ${numberLabel(card.totalWeightKg)} кг`,
    deliveryRisk: card.deliveryRisk,
    selectable: true,
  }
}

function mapMaterialNeed(card: InventoryTransferCard): UnifiedTransportNeed {
  return {
    key: needKey('materials', card.id),
    id: card.id,
    kind: 'materials',
    direction: 'outbound',
    planState: 'confirmed',
    status: card.status,
    title: card.machineName,
    subtitle: 'Материалы',
    sourcePointKey: `factory:${card.sourceFactoryId}`,
    sourcePointLabel: card.sourceFactoryName,
    destinationPointKey: `factory:${card.destinationFactoryId}`,
    destinationPointLabel: card.destinationFactoryName,
    neededDate: card.expectedArrivalDate || card.deadline,
    deadline: card.deadline,
    itemLabels: card.items.map((item) => item.materialName),
    volumeLabel: `${card.items.length} поз.`,
    deliveryRisk: card.deliveryRisk,
    selectable: true,
  }
}

function mapSupplyNeed(need: SupplyTransportNeed): UnifiedTransportNeed {
  return {
    key: needKey('materials', need.id),
    id: need.id,
    kind: 'materials',
    direction: 'outbound',
    planState: 'confirmed',
    status: 'planned',
    title: need.machineName,
    subtitle: need.supplierName,
    sourcePointKey: `supplier:${need.supplierId}`,
    sourcePointLabel: need.supplierLocation,
    destinationPointKey: `factory:${need.factoryId}`,
    destinationPointLabel: need.factoryName,
    neededDate: need.deliveryDate,
    deadline: need.deliveryDate,
    itemLabels: [need.itemName],
    volumeLabel: `${numberLabel(need.quantity)} ${need.unit}`,
    deliveryRisk: false,
    selectable: true,
  }
}

function mapLink(link: TripLinkRow): TransportTripNeed {
  return {
    linkId: link.id,
    key: needKey(link.need_kind, link.need_id),
    id: link.need_id,
    kind: link.need_kind,
    direction: link.direction,
    title: link.need_title,
    subtitle: link.need_subtitle || '',
    sourcePointKey: link.source_point_key,
    sourcePointLabel: link.source_point_label,
    destinationPointKey: link.destination_point_key,
    destinationPointLabel: link.destination_point_label,
    neededDate: link.needed_date,
    released: Boolean(link.released_at),
  }
}

function mapLegacyOutsourcingNeed(need: TransportWorkspaceNeed): TransportTripNeed {
  return {
    linkId: null,
    key: needKey('outsourcing', need.id),
    id: need.id,
    kind: 'outsourcing',
    direction: need.direction,
    title: need.machine_name,
    subtitle: need.work_type_name,
    sourcePointKey: need.source_point_key,
    sourcePointLabel: need.source_point_label,
    destinationPointKey: need.destination_point_key,
    destinationPointLabel: need.destination_point_label,
    neededDate: need.needed_date,
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

async function loadTransportWorkspace(): Promise<TransportWorkspace> {
  await requirePermission('supply_transport', 'view')
  const db = transportDb(createAdminClient())
  const [outsourcingResult, detailingResult, materialsResult, supplyResult] = await Promise.all([
    getOutsourcingTransportWorkspace(),
    getDetailingTransportWorkspace(),
    getInventoryTransportWorkspace(),
    getSupplyTransportNeeds(),
  ])
  const links = await loadTripLinks(
    db,
    outsourcingResult.data.orders.map((order) => order.id),
  )

  const activeLinkedNeeds = new Set(
    links
      .filter((link) => !link.released_at)
      .map((link) => needKey(link.need_kind, link.need_id)),
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
      needs: tripNeeds,
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
      const need = availableByKey.get(needKey(reference.kind, reference.id))
      if (!need || !need.selectable) {
        throw new Error('Одна или несколько потребностей уже заняты или недоступны')
      }
      return need
    })

    const firstNeed = selectedNeeds[0]
    if (!firstNeed) throw new Error('Выберите хотя бы одну потребность')
    if (selectedNeeds.some((need) => getTransportNeedConflict(firstNeed, need) === 'source')) {
      throw new Error('В один рейс можно объединить только потребности с одной стартовой точкой')
    }
    if (selectedNeeds.some((need) => getTransportNeedConflict(firstNeed, need) === 'direction')) {
      throw new Error('В один рейс нельзя смешивать направления туда и обратно')
    }
    assertRouteStartsAt(parsed.route, firstNeed.sourcePointLabel)

    const { data, error } = await transportDb(createAdminClient()).rpc('fn_create_transport_trip', {
      p_direction: firstNeed.direction,
      p_carrier_supplier_id: parsed.carrierSupplierId,
      p_scheduled_date: parsed.scheduledDate,
      p_price: parsed.price,
      p_route_start_key: firstNeed.sourcePointKey,
      p_route_start: firstNeed.sourcePointLabel,
      p_route: parsed.route,
      p_comment: parsed.comment || null,
      p_links: selectedNeeds.map((need) => ({
        needKind: need.kind,
        needId: need.id,
        direction: need.direction,
        sourcePointKey: need.sourcePointKey,
        sourcePointLabel: need.sourcePointLabel,
        destinationPointKey: need.destinationPointKey,
        destinationPointLabel: need.destinationPointLabel,
        title: need.title,
        subtitle: need.subtitle,
        neededDate: need.neededDate,
      })),
      p_actor: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось создать рейс')
    revalidateTransportWorkspace()
    return { success: true, id: String(data), error: null }
  } catch (error) {
    return { success: false, id: null, error: getErrorMessage(error) }
  }
}

export async function updateTransportTrip(input: z.input<typeof updateTripSchema>) {
  try {
    const parsed = updateTripSchema.parse(input)
    const { userId } = await requirePermission('supply_transport', 'manage')
    const { error } = await transportDb(createAdminClient()).rpc('fn_update_transport_trip', {
      p_trip_id: parsed.tripId,
      p_status: parsed.status,
      p_carrier_supplier_id: parsed.carrierSupplierId,
      p_scheduled_date: parsed.scheduledDate,
      p_price: parsed.price,
      p_route: parsed.route,
      p_comment: parsed.comment || null,
      p_actor: userId,
    })
    if (error) throw new Error(error.message || 'Не удалось сохранить рейс')
    revalidateTransportWorkspace()
    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) }
  }
}
