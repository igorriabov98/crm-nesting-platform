import { addDays, endOfWeek, isWithinInterval, startOfWeek } from 'date-fns'
import type {
  SupplyOrderAggregate,
  SupplyOrderAggregateFactory,
  SupplyOrderAggregateSourceItem,
  SupplyOrderDeliverySchedule,
  SupplyOrderHistoryItem,
  SupplyOrderItem,
} from '@/lib/actions/supply-orders'
import type { MaterialCategory, OrderItemStatus } from '@/lib/types'
import type { SupplyOrderDeliveryScheduleScope } from '@/lib/supply-orders/delivery-schedule-scope'

export type OrderPeriodFilter = 'this_week' | 'next_week' | 'all'
export type OrderAttentionFilter = 'all' | 'needs_supplier' | 'needs_schedule' | 'stock_covered'
export type SupplyOrderSort =
  | 'delivery_asc'
  | 'delivery_desc'
  | 'material_asc'
  | 'machine_asc'
  | 'quantity_desc'
  | 'quantity_asc'

export type OrderFiltersState = {
  query: string
  period: OrderPeriodFilter
  supplier: string
  category: MaterialCategory | 'all'
  status: OrderItemStatus | 'all'
  attention: OrderAttentionFilter
  sort: SupplyOrderSort
}

export type SupplyOrderAggregateStatusFilter = 'open' | 'all' | 'scheduled' | 'unscheduled' | 'closed' | 'pending' | 'ordered'
export type SupplyOrderAggregateSort =
  | 'date_asc'
  | 'date_desc'
  | 'material_asc'
  | 'quantity_desc'
  | 'remaining_desc'

export type AggregateFiltersState = {
  query: string
  supplier: string
  category: MaterialCategory | 'all'
  status: SupplyOrderAggregateStatusFilter
  sort: SupplyOrderAggregateSort
}

export type SupplyOrderHistorySort = 'accepted_desc' | 'accepted_asc' | 'material_asc' | 'quantity_desc'

export type HistoryFiltersState = {
  query: string
  supplier: string
  category: MaterialCategory | 'all'
  sort: SupplyOrderHistorySort
}

export type SupplyOrderMachineRoute = {
  machineId: string
  machineName: string
  quantity: number
  weightKg: number | null
  itemCount: number
  pendingCount: number
  orderedCount: number
}

export type SupplyOrderItemOrderProgress = {
  isPartiallyOrdered: boolean
  orderedQuantity: number
  remainingQuantity: number
  totalQuantity: number
}

export function getSupplyOrderItemOrderProgress(
  item: Pick<SupplyOrderAggregateSourceItem, 'order_status' | 'quantity' | 'unscheduled_quantity'>
): SupplyOrderItemOrderProgress {
  const totalQuantity = Math.max(Number(item.quantity) || 0, 0)
  const remainingQuantity = Math.min(
    totalQuantity,
    Math.max(Number(item.unscheduled_quantity) || 0, 0),
  )
  const orderedQuantity = Math.max(totalQuantity - remainingQuantity, 0)

  return {
    isPartiallyOrdered: item.order_status === 'ordered' && remainingQuantity > 0,
    orderedQuantity,
    remainingQuantity,
    totalQuantity,
  }
}

export type SupplyOrderRedeliveryMachineRoute = SupplyOrderMachineRoute & {
  originalDeliveryDates: string[]
}

export type SupplyOrderDateGroup = {
  dateKey: string
  groups: Array<{
    supplierKey: string
    supplierName: string
    items: SupplyOrderItem[]
  }>
}

export type SupplyOrderDateSlice = {
  id: string
  dateKey: string
  aggregate: SupplyOrderAggregate
  quantity: number
  plannedQuantity: number
  deliveredQuantity: number
  unscheduledQuantity: number
  plannedScheduleCount: number
  deliveredScheduleCount: number
}

export type SupplyOrderDetailScheduleScope = {
  id: string
  kind: 'item_date' | 'unscheduled'
  label: string
  affectedItemCount: number
  sharedItemCount: number
  aggregate: SupplyOrderAggregate
  factory: SupplyOrderAggregateFactory
  dateSlice: SupplyOrderDateSlice
  mutationItems: Array<{ table: string; id: string }>
  mutationScope: SupplyOrderDeliveryScheduleScope
}

export type SupplyOrderDetailContext = {
  item: SupplyOrderItem
  plannedQuantity: number
  deliveredQuantity: number
  unscheduledQuantity: number
  redeliveryQuantity: number
  scopes: SupplyOrderDetailScheduleScope[]
}

type PlannedCoverage = {
  schedule: SupplyOrderDeliverySchedule
  quantity: number
}

type SourceCoverageState = {
  source: SupplyOrderAggregateSourceItem
  deliveredQuantity: number
  planned: PlannedCoverage[]
}

export function buildSupplyOrderDetailContexts(
  items: SupplyOrderItem[],
  aggregates: SupplyOrderAggregate[],
) {
  const sourceContexts = new Map<string, {
    aggregate: SupplyOrderAggregate
    factory: SupplyOrderAggregateFactory
    source: SupplyOrderAggregateSourceItem
    planned: PlannedCoverage[]
    deliveredQuantity: number
    unscheduledQuantity: number
  }>()

  for (const aggregate of aggregates) {
    for (const factory of aggregate.factories) {
      const orderedSources = [...factory.items].sort((left, right) => (
        left.machine_name.localeCompare(right.machine_name, 'ru') || left.id.localeCompare(right.id)
      ))
      const state = new Map<string, SourceCoverageState>(orderedSources.map((source) => {
        const deliveredQuantity = source.delivery_schedules
          .filter((schedule) => schedule.status === 'delivered')
          .reduce((sum, schedule) => sum + deliveredScheduleQuantity(schedule), 0)
        return [`${source.table}:${source.id}`, {
          source,
          deliveredQuantity: Math.min(deliveredQuantity, Math.max(source.quantity, 0)),
          planned: [] as PlannedCoverage[],
        }] as const
      }))
      const plannedSchedules = orderedSources.flatMap((source) => source.delivery_schedules
        .filter((schedule) => schedule.status === 'planned')
        .map((schedule) => ({ ownerKey: `${source.table}:${source.id}`, schedule })))
        .sort((left, right) => (
          left.schedule.delivery_date.localeCompare(right.schedule.delivery_date)
          || left.schedule.id.localeCompare(right.schedule.id)
        ))

      for (const { ownerKey, schedule } of plannedSchedules) {
        let remainingScheduleQuantity = Math.max(Number(schedule.quantity || 0), 0)
        const candidates = [
          state.get(ownerKey),
          ...orderedSources
            .map((source) => state.get(`${source.table}:${source.id}`))
            .filter((candidate) => candidate && `${candidate.source.table}:${candidate.source.id}` !== ownerKey),
        ].filter((candidate): candidate is SourceCoverageState => Boolean(candidate))

        for (const candidate of candidates) {
          if (remainingScheduleQuantity <= 0.000001) break
          const alreadyPlanned = candidate.planned.reduce((sum, entry) => sum + entry.quantity, 0)
          const totalAvailableDemand = Math.max(
            candidate.source.quantity - candidate.deliveredQuantity - alreadyPlanned,
            0,
          )
          const pieceLength = Number(schedule.planned_piece_length_mm || 0)
          const hasPiecePlan = pieceLength > 0 && candidate.source.long_stock_purchase_plan !== null
          const componentQuantity = pieceLength > 0
            ? candidate.source.long_stock_purchase_plan?.components
              .filter((component) => component.length_mm === pieceLength)
              .reduce((sum, component) => sum + component.length_mm * component.piece_count, 0) || 0
            : 0
          const deliveredForLength = componentQuantity > 0
            ? candidate.source.delivery_schedules
              .filter((entry) => entry.status === 'delivered')
              .filter((entry) => Number(entry.received_piece_length_mm || entry.planned_piece_length_mm || 0) === pieceLength)
              .reduce((sum, entry) => sum + (
                Number(entry.allocated_piece_count || 0) > 0
                  ? Number(entry.allocated_piece_count) * pieceLength
                  : deliveredScheduleQuantity(entry)
              ), 0)
            : 0
          const plannedForLength = componentQuantity > 0
            ? candidate.planned
              .filter((entry) => Number(entry.schedule.planned_piece_length_mm || 0) === pieceLength)
              .reduce((sum, entry) => sum + entry.quantity, 0)
            : 0
          const availableDemand = hasPiecePlan
            ? Math.min(
              totalAvailableDemand,
              Math.max(componentQuantity - deliveredForLength - plannedForLength, 0),
            )
            : totalAvailableDemand
          const allocatedQuantity = Math.min(availableDemand, remainingScheduleQuantity)
          if (allocatedQuantity <= 0.000001) continue
          candidate.planned.push({ schedule, quantity: allocatedQuantity })
          remainingScheduleQuantity -= allocatedQuantity
        }
      }

      for (const [key, coverage] of state) {
        const plannedQuantity = coverage.planned.reduce((sum, entry) => sum + entry.quantity, 0)
        sourceContexts.set(key, {
          aggregate,
          factory,
          source: coverage.source,
          planned: coverage.planned,
          deliveredQuantity: coverage.deliveredQuantity,
          unscheduledQuantity: Math.max(
            coverage.source.quantity - coverage.deliveredQuantity - plannedQuantity,
            0,
          ),
        })
      }
    }
  }

  const contexts = new Map<string, SupplyOrderDetailContext>()
  for (const originalItem of items) {
    const key = `${originalItem.table}:${originalItem.id}`
    const context = sourceContexts.get(key)
    if (!context) continue

    const plannedQuantity = context.planned.reduce((sum, entry) => sum + entry.quantity, 0)
    const plannedDates = Array.from(new Set(context.planned.map((entry) => entry.schedule.delivery_date))).sort()
    const plannedSuppliers = Array.from(new Map(context.planned
      .filter((entry) => entry.schedule.supplier_id)
      .map((entry) => [entry.schedule.supplier_id as string, entry.schedule.supplier_name])).entries())
    const item = {
      ...originalItem,
      target_delivery_date: plannedDates[0] || originalItem.target_delivery_date,
      supplier_id: plannedSuppliers.length === 1 ? plannedSuppliers[0][0] : originalItem.supplier_id,
      supplier_name: plannedSuppliers.length === 1 ? plannedSuppliers[0][1] || 'Поставщик' : originalItem.supplier_name,
      order_status: originalItem.order_status === 'delivered' || originalItem.order_status === 'cancelled'
        ? originalItem.order_status
        : plannedQuantity + context.deliveredQuantity > 0.000001
          ? 'ordered' as const
          : 'pending' as const,
    }
    const projectedSchedules = context.planned.map((entry) => projectPlannedSchedule(entry.schedule, entry.quantity))
    const projectedSource: SupplyOrderAggregateSourceItem = {
      ...context.source,
      supplier_id: item.supplier_id,
      supplier_name: item.supplier_name,
      supply_delivery_date: item.target_delivery_date,
      planned_schedule_quantity: plannedQuantity,
      delivered_schedule_quantity: context.deliveredQuantity,
      unscheduled_quantity: context.unscheduledQuantity,
      delivery_schedules: [
        ...projectedSchedules,
        ...context.source.delivery_schedules.filter((schedule) => schedule.status === 'delivered'),
      ],
    }
    const itemProjection = projectDetailAggregate(
      context.aggregate,
      context.factory,
      projectedSource,
      item,
    )
    const scopes: SupplyOrderDetailScheduleScope[] = []
    for (const dateKey of plannedDates) {
      const plannedOnDate = projectedSchedules.filter((schedule) => schedule.delivery_date === dateKey)
      const deliveredOnDate = projectedSource.delivery_schedules.filter((schedule) => (
        schedule.status === 'delivered' && schedule.delivery_date === dateKey
      ))
      const dateSlice: SupplyOrderDateSlice = {
        id: `${itemProjection.aggregate.id}|detail-date:${dateKey}`,
        dateKey,
        aggregate: itemProjection.aggregate,
        quantity: plannedOnDate.reduce((sum, schedule) => sum + Number(schedule.quantity || 0), 0)
          + deliveredOnDate.reduce((sum, schedule) => sum + deliveredScheduleQuantity(schedule), 0),
        plannedQuantity: plannedOnDate.reduce((sum, schedule) => sum + Number(schedule.quantity || 0), 0),
        deliveredQuantity: deliveredOnDate.reduce((sum, schedule) => sum + deliveredScheduleQuantity(schedule), 0),
        unscheduledQuantity: 0,
        plannedScheduleCount: plannedOnDate.length,
        deliveredScheduleCount: deliveredOnDate.length,
      }
      scopes.push({
        id: `item:${dateKey}`,
        kind: 'item_date',
        label: `График · ${formatShortDate(dateKey)}`,
        affectedItemCount: 1,
        sharedItemCount: Array.from(sourceContexts.values()).filter((candidate) => (
          candidate.aggregate.id === context.aggregate.id
          && candidate.factory.factory_id === context.factory.factory_id
          && candidate.planned.some((entry) => entry.schedule.delivery_date === dateKey)
        )).length,
        aggregate: itemProjection.aggregate,
        factory: itemProjection.factory,
        dateSlice,
        mutationItems: context.factory.items.map((source) => ({ table: source.table, id: source.id })),
        mutationScope: {
          mode: 'item',
          replace_delivery_date: dateKey,
          target_item: { table: item.table, id: item.id },
        },
      })
    }

    if (context.unscheduledQuantity > 0.000001) {
      const dateSlice: SupplyOrderDateSlice = {
        id: `${itemProjection.aggregate.id}|detail-unscheduled`,
        dateKey: 'no_supply_date',
        aggregate: itemProjection.aggregate,
        quantity: context.unscheduledQuantity,
        plannedQuantity: 0,
        deliveredQuantity: 0,
        unscheduledQuantity: context.unscheduledQuantity,
        plannedScheduleCount: 0,
        deliveredScheduleCount: 0,
      }
      scopes.push({
        id: 'item:unscheduled',
        kind: 'unscheduled',
        label: 'Остаток без графика',
        affectedItemCount: 1,
        sharedItemCount: 1,
        aggregate: itemProjection.aggregate,
        factory: itemProjection.factory,
        dateSlice,
        mutationItems: context.factory.items.map((source) => ({ table: source.table, id: source.id })),
        mutationScope: {
          mode: 'item',
          replace_delivery_date: null,
          target_item: { table: item.table, id: item.id },
        },
      })
    }

    const redeliverySource = { ...projectedSource, unscheduled_quantity: context.unscheduledQuantity }
    contexts.set(key, {
      item,
      plannedQuantity,
      deliveredQuantity: context.deliveredQuantity,
      unscheduledQuantity: context.unscheduledQuantity,
      redeliveryQuantity: isSupplyOrderRedeliveryItem(redeliverySource) ? context.unscheduledQuantity : 0,
      scopes,
    })
  }

  return contexts
}

function projectPlannedSchedule(schedule: SupplyOrderDeliverySchedule, quantity: number) {
  const pieceLength = Number(schedule.planned_piece_length_mm || 0)
  const projectedPieceCount = pieceLength > 0 && Number.isInteger(quantity / pieceLength)
    ? quantity / pieceLength
    : schedule.planned_piece_count
  return {
    ...schedule,
    quantity,
    planned_piece_count: projectedPieceCount,
  }
}

function projectDetailAggregate(
  aggregate: SupplyOrderAggregate,
  factory: SupplyOrderAggregateFactory,
  source: SupplyOrderAggregateSourceItem,
  item: SupplyOrderItem,
) {
  const projectedFactory: SupplyOrderAggregateFactory = {
    ...factory,
    quantity: source.quantity,
    requested_quantity: item.requested_quantity,
    reserved_quantity: item.reserved_quantity,
    weight_kg: item.calculated_weight_kg,
    item_count: 1,
    machine_count: 1,
    pending_count: source.order_status === 'pending' ? 1 : 0,
    ordered_count: source.order_status === 'ordered' ? 1 : 0,
    delivered_count: source.order_status === 'delivered' ? 1 : 0,
    planned_schedule_quantity: source.planned_schedule_quantity,
    delivered_schedule_quantity: source.delivered_schedule_quantity,
    unscheduled_quantity: source.unscheduled_quantity,
    delivery_schedule_count: new Set(source.delivery_schedules
      .filter((schedule) => schedule.status !== 'cancelled')
      .map((schedule) => schedule.delivery_date)).size,
    has_delivery_schedules: source.delivery_schedules.some((schedule) => schedule.status !== 'cancelled'),
    supply_delivery_date: source.supply_delivery_date,
    has_mixed_supply_delivery_dates: false,
    items: [source],
  }
  const projectedAggregate: SupplyOrderAggregate = {
    ...aggregate,
    id: `${aggregate.id}|detail:${item.table}:${item.id}`,
    quantity: source.quantity,
    requested_quantity: item.requested_quantity,
    reserved_quantity: item.reserved_quantity,
    weight_kg: item.calculated_weight_kg,
    item_count: 1,
    machine_count: 1,
    pending_count: projectedFactory.pending_count,
    ordered_count: projectedFactory.ordered_count,
    delivered_count: projectedFactory.delivered_count,
    planned_schedule_quantity: source.planned_schedule_quantity,
    delivered_schedule_quantity: source.delivered_schedule_quantity,
    unscheduled_quantity: source.unscheduled_quantity,
    factories: [projectedFactory],
  }
  return { aggregate: projectedAggregate, factory: projectedFactory }
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' })
    .format(new Date(`${value}T00:00:00`))
}

export function filterSupplyOrderItems(
  items: SupplyOrderItem[],
  filters: OrderFiltersState,
  now = new Date()
) {
  const normalizedQuery = normalize(filters.query)
  const thisWeek = {
    start: startOfWeek(now, { weekStartsOn: 1 }),
    end: endOfWeek(now, { weekStartsOn: 1 }),
  }
  const nextWeekStart = addDays(thisWeek.end, 1)
  const nextWeek = {
    start: nextWeekStart,
    end: endOfWeek(nextWeekStart, { weekStartsOn: 1 }),
  }

  return items.filter((item) => {
    if (filters.status !== 'all' && item.order_status !== filters.status) return false
    if (filters.supplier !== 'all' && item.supplier_id !== filters.supplier) return false
    if (filters.category !== 'all' && item.category !== filters.category) return false

    if (normalizedQuery) {
      const haystack = normalize([
        item.item_name,
        item.machine_name,
        item.supplier_name,
      ].filter(Boolean).join(' '))
      if (!haystack.includes(normalizedQuery)) return false
    }

    if (filters.attention === 'needs_supplier' && item.supplier_id) return false
    if (filters.attention === 'needs_schedule' && (item.to_order <= 0 || item.delivery_schedules.length > 0 || item.target_delivery_date)) return false
    if (filters.attention === 'stock_covered' && !(item.to_order <= 0 && item.reserved_quantity > 0)) return false

    if (filters.period !== 'all') {
      if (!item.target_delivery_date) return false
      const date = new Date(`${item.target_delivery_date}T00:00:00`)
      if (filters.period === 'this_week' && !isWithinInterval(date, thisWeek)) return false
      if (filters.period === 'next_week' && !isWithinInterval(date, nextWeek)) return false
    }

    return true
  })
}

export function sortSupplyOrderItems(items: SupplyOrderItem[], sort: SupplyOrderSort) {
  return [...items].sort((left, right) => {
    if (sort === 'material_asc') return compareText(left.item_name, right.item_name)
    if (sort === 'machine_asc') return compareText(left.machine_name, right.machine_name)
    if (sort === 'quantity_desc') return right.to_order - left.to_order || compareText(left.item_name, right.item_name)
    if (sort === 'quantity_asc') return left.to_order - right.to_order || compareText(left.item_name, right.item_name)
    return compareNullableDates(
      left.target_delivery_date,
      right.target_delivery_date,
      sort === 'delivery_desc' ? 'desc' : 'asc'
    ) || compareText(left.item_name, right.item_name)
  })
}

export function groupSupplyOrderItems(items: SupplyOrderItem[], sort: SupplyOrderSort): SupplyOrderDateGroup[] {
  const byDate = new Map<string, Map<string, { supplierName: string; items: SupplyOrderItem[] }>>()

  for (const item of items) {
    const dateKey = item.supplier_id ? item.target_delivery_date || 'no_date' : 'no_supplier'
    const supplierKey = item.supplier_id || 'no_supplier'
    const supplierName = item.supplier_name || 'Без поставщика — требует назначения'
    if (!byDate.has(dateKey)) byDate.set(dateKey, new Map())
    const dateGroup = byDate.get(dateKey)!
    if (!dateGroup.has(supplierKey)) dateGroup.set(supplierKey, { supplierName, items: [] })
    dateGroup.get(supplierKey)!.items.push(item)
  }

  return Array.from(byDate.entries())
    .sort(([left], [right]) => compareDateGroupKeys(left, right, sort === 'delivery_desc' ? 'desc' : 'asc'))
    .map(([dateKey, supplierMap]) => ({
      dateKey,
      groups: Array.from(supplierMap.entries())
        .sort(([, left], [, right]) => compareText(left.supplierName, right.supplierName))
        .map(([supplierKey, group]) => ({ supplierKey, ...group })),
    }))
}

export function filterAndSortAggregates(aggregates: SupplyOrderAggregate[], filters: AggregateFiltersState) {
  const normalizedQuery = normalize(filters.query)
  const filtered = aggregates.filter((aggregate) => {
    if (filters.category !== 'all' && aggregate.category !== filters.category) return false
    if (filters.status === 'open' && isSupplyOrderAggregateClosed(aggregate)) return false
    if (filters.status === 'pending' && aggregate.pending_count <= 0) return false
    if (filters.status === 'ordered' && aggregate.ordered_count <= 0) return false
    if (filters.status === 'scheduled' && aggregate.planned_schedule_quantity <= 0) return false
    if (filters.status === 'unscheduled' && !hasSupplyOrderRedelivery(aggregate)) return false
    if (filters.status === 'closed' && !isSupplyOrderAggregateClosed(aggregate)) return false
    if (filters.supplier !== 'all' && !aggregate.factories.some((factory) => (
      factory.items.some((item) => item.supplier_id === filters.supplier) ||
      factory.items.some((item) => item.delivery_schedules.some((schedule) => schedule.supplier_id === filters.supplier))
    ))) return false

    if (normalizedQuery) {
      const haystack = normalize([
        aggregate.item_name,
        ...aggregate.characteristics.flatMap((part) => [part.label, part.value]),
        ...aggregate.factories.flatMap((factory) => [
          factory.factory_name,
          ...factory.items.flatMap((item) => [item.machine_name, item.supplier_name]),
        ]),
      ].filter(Boolean).join(' '))
      if (!haystack.includes(normalizedQuery)) return false
    }
    return true
  })

  return [...filtered].sort((left, right) => {
    if (filters.sort === 'material_asc') return compareText(left.item_name, right.item_name)
    if (filters.sort === 'quantity_desc') return right.quantity - left.quantity || compareText(left.item_name, right.item_name)
    if (filters.sort === 'remaining_desc') return right.unscheduled_quantity - left.unscheduled_quantity || compareText(left.item_name, right.item_name)
    return compareNullableDates(
      left.planned_material_date,
      right.planned_material_date,
      filters.sort === 'date_desc' ? 'desc' : 'asc'
    ) || compareText(left.item_name, right.item_name)
  })
}

export function isSupplyOrderAggregateClosed(aggregate: SupplyOrderAggregate) {
  return aggregate.delivered_count === aggregate.item_count && aggregate.unscheduled_quantity <= 0
}

export function groupSupplyOrderAggregates(aggregates: SupplyOrderAggregate[], sort: SupplyOrderAggregateSort) {
  const map = new Map<string, SupplyOrderAggregate[]>()
  for (const aggregate of aggregates) {
    const key = aggregate.planned_material_date || 'no_planned_date'
    map.set(key, [...(map.get(key) || []), aggregate])
  }
  return Array.from(map.entries())
    .sort(([left], [right]) => compareDateGroupKeys(left, right, sort === 'date_desc' ? 'desc' : 'asc', 'no_planned_date'))
    .map(([dateKey, rows]) => ({ dateKey, rows }))
}

export function groupSupplyOrderAggregatesBySupplyDate(
  aggregates: SupplyOrderAggregate[],
  sort: SupplyOrderAggregateSort,
) {
  const groups = new Map<string, SupplyOrderDateSlice[]>()

  for (const aggregate of aggregates) {
    const slices = buildSupplyOrderDateSlices(aggregate)
    for (const slice of slices) {
      groups.set(slice.dateKey, [...(groups.get(slice.dateKey) || []), slice])
    }
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => compareDateGroupKeys(
      left,
      right,
      sort === 'date_desc' ? 'desc' : 'asc',
      'no_supply_date',
    ))
    .map(([dateKey, rows]) => ({
      dateKey,
      rows: sortSupplyOrderDateSlices(rows, sort),
    }))
}

function buildSupplyOrderDateSlices(aggregate: SupplyOrderAggregate) {
  const slices = new Map<string, Omit<SupplyOrderDateSlice, 'id' | 'aggregate'>>()

  const getSlice = (dateKey: string) => {
    const existing = slices.get(dateKey)
    if (existing) return existing
    const created = {
      dateKey,
      quantity: 0,
      plannedQuantity: 0,
      deliveredQuantity: 0,
      unscheduledQuantity: 0,
      plannedScheduleCount: 0,
      deliveredScheduleCount: 0,
    }
    slices.set(dateKey, created)
    return created
  }

  for (const factory of aggregate.factories) {
    for (const item of factory.items) {
      for (const schedule of item.delivery_schedules) {
        if (schedule.status === 'cancelled') continue
        const dateKey = schedule.delivery_date || factory.production_date || aggregate.planned_material_date || 'no_supply_date'
        const slice = getSlice(dateKey)
        const plannedQuantity = Math.max(Number(schedule.quantity || 0), 0)
        slice.quantity += plannedQuantity
        if (schedule.status === 'planned') {
          slice.plannedQuantity += plannedQuantity
          slice.plannedScheduleCount += 1
        } else if (schedule.status === 'delivered') {
          slice.deliveredQuantity += deliveredScheduleQuantity(schedule)
          slice.deliveredScheduleCount += 1
        }
      }
    }

    // Aggregate schedules are intentionally stored on one anchor request item so
    // one physical delivery can be allocated between machines during receiving.
    // The factory total is therefore authoritative: summing per-item remainders
    // here would count covered follower items again.
    const unscheduledQuantity = Math.max(Number(factory.unscheduled_quantity || 0), 0)
    if (unscheduledQuantity > 0) {
      const dateKey = factory.production_date || aggregate.planned_material_date || 'no_supply_date'
      const slice = getSlice(dateKey)
      slice.quantity += unscheduledQuantity
      slice.unscheduledQuantity += unscheduledQuantity
    }
  }

  return Array.from(slices.values()).map((slice) => ({
    ...slice,
    id: `${aggregate.id}|supply-date:${slice.dateKey}`,
    aggregate,
  }))
}

function sortSupplyOrderDateSlices(rows: SupplyOrderDateSlice[], sort: SupplyOrderAggregateSort) {
  return [...rows].sort((left, right) => {
    if (sort === 'quantity_desc') {
      return right.quantity - left.quantity || compareText(left.aggregate.item_name, right.aggregate.item_name)
    }
    if (sort === 'remaining_desc') {
      return right.unscheduledQuantity - left.unscheduledQuantity || compareText(left.aggregate.item_name, right.aggregate.item_name)
    }
    return compareText(left.aggregate.item_name, right.aggregate.item_name)
  })
}

export function partitionSupplyOrderAggregatesByRedelivery(aggregates: SupplyOrderAggregate[]) {
  const redeliveries: SupplyOrderAggregate[] = []
  const regular: SupplyOrderAggregate[] = []

  for (const aggregate of aggregates) {
    if (!hasSupplyOrderRedelivery(aggregate)) {
      regular.push(aggregate)
      continue
    }

    const redelivery = projectSupplyOrderAggregate(aggregate, isSupplyOrderRedeliveryItem, 'redelivery')
    const rest = projectSupplyOrderAggregate(aggregate, (item) => !isSupplyOrderRedeliveryItem(item), 'regular')
    if (redelivery) redeliveries.push(redelivery)
    if (rest) regular.push(rest)
  }

  return { redeliveries, regular }
}

export function hasSupplyOrderRedelivery(aggregate: SupplyOrderAggregate) {
  return aggregate.factories.some((factory) => factory.items.some(isSupplyOrderRedeliveryItem))
}

export function isSupplyOrderRedeliveryItem(item: SupplyOrderAggregateSourceItem) {
  return item.unscheduled_quantity > 0 && getSupplyOrderRedeliveryDates(item).length > 0
}

export function getSupplyOrderRedeliveryDates(item: SupplyOrderAggregateSourceItem) {
  return Array.from(new Set(item.delivery_schedules
    .filter((schedule) => (
      schedule.status === 'delivered'
      && !schedule.receipt_parent_schedule_id
      && receivedScheduleQuantity(schedule) + 0.000001 < Number(schedule.quantity || 0)
    ))
    .map((schedule) => schedule.delivery_date)
    .filter(Boolean)))
    .sort()
}

export function summarizeSupplyOrderMachineRoutes(items: SupplyOrderAggregateSourceItem[]): SupplyOrderMachineRoute[] {
  return summarizeMachineRoutes(items, (item) => item.quantity)
}

export function summarizeSupplyOrderUnscheduledMachineRoutes(
  items: SupplyOrderAggregateSourceItem[],
  totalUnscheduledQuantity?: number,
): SupplyOrderMachineRoute[] {
  const routes = summarizeMachineRoutes(items, (item) => item.unscheduled_quantity)
  if (totalUnscheduledQuantity === undefined) return routes

  const authoritativeTotal = Math.max(Number(totalUnscheduledQuantity || 0), 0)
  const itemTotal = routes.reduce((sum, route) => sum + route.quantity, 0)
  if (authoritativeTotal <= 0 || itemTotal <= 0) return []
  if (itemTotal <= authoritativeTotal + 0.000001) return routes

  const ratio = authoritativeTotal / itemTotal
  return routes.map((route) => ({
    ...route,
    quantity: route.quantity * ratio,
    weightKg: route.weightKg === null ? null : route.weightKg * ratio,
  }))
}

export function isSupplyOrderBarMaterial(
  aggregate: Pick<SupplyOrderAggregate, 'category' | 'unit'>,
) {
  return aggregate.category === 'knives'
    || aggregate.category === 'circle'
    || (aggregate.category === 'pipe' && aggregate.unit === 'мм')
}

export function summarizeSupplyOrderRedeliveryMachineRoutes(
  items: SupplyOrderAggregateSourceItem[]
): SupplyOrderRedeliveryMachineRoute[] {
  const redeliveryItems = items.filter(isSupplyOrderRedeliveryItem)
  const datesByMachine = new Map<string, Set<string>>()

  for (const item of redeliveryItems) {
    const key = item.machine_id || item.machine_name
    const dates = datesByMachine.get(key) || new Set<string>()
    for (const date of getSupplyOrderRedeliveryDates(item)) dates.add(date)
    datesByMachine.set(key, dates)
  }

  return summarizeMachineRoutes(redeliveryItems, (item) => item.unscheduled_quantity)
    .map((route) => ({
      ...route,
      originalDeliveryDates: Array.from(datesByMachine.get(route.machineId || route.machineName) || []).sort(),
    }))
}

function summarizeMachineRoutes(
  items: SupplyOrderAggregateSourceItem[],
  getQuantity: (item: SupplyOrderAggregateSourceItem) => number
): SupplyOrderMachineRoute[] {
  const routes = new Map<string, SupplyOrderMachineRoute & { hasUnknownWeight: boolean }>()

  for (const item of items) {
    const quantity = Math.max(Number(getQuantity(item) || 0), 0)
    if (quantity <= 0) continue

    const key = item.machine_id || item.machine_name
    const current = routes.get(key) || {
      machineId: item.machine_id,
      machineName: item.machine_name,
      quantity: 0,
      weightKg: null,
      itemCount: 0,
      pendingCount: 0,
      orderedCount: 0,
      hasUnknownWeight: false,
    }

    current.quantity += quantity
    current.itemCount += 1
    current.pendingCount += item.order_status === 'pending' ? 1 : 0
    current.orderedCount += item.order_status === 'ordered' ? 1 : 0
    if (item.weight_kg === null || item.quantity <= 0) current.hasUnknownWeight = true
    else current.weightKg = (current.weightKg || 0) + item.weight_kg * quantity / item.quantity
    routes.set(key, current)
  }

  return Array.from(routes.values())
    .map(({ hasUnknownWeight, ...route }) => ({
      ...route,
      weightKg: hasUnknownWeight ? null : route.weightKg,
    }))
    .sort((left, right) => compareText(left.machineName, right.machineName))
}

function receivedScheduleQuantity(schedule: SupplyOrderAggregateSourceItem['delivery_schedules'][number]) {
  const value = schedule.received_quantity ?? schedule.allocated_quantity
  if (value === null || value === undefined) return Number(schedule.quantity || 0)
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

function deliveredScheduleQuantity(schedule: SupplyOrderAggregateSourceItem['delivery_schedules'][number]) {
  const value = schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity
  const quantity = Number(value || 0)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

function projectSupplyOrderAggregate(
  aggregate: SupplyOrderAggregate,
  predicate: (item: SupplyOrderAggregateSourceItem) => boolean,
  idSuffix: 'redelivery' | 'regular',
): SupplyOrderAggregate | null {
  const factories = aggregate.factories
    .map((factory) => projectSupplyOrderFactory(factory, predicate))
    .filter((factory): factory is SupplyOrderAggregate['factories'][number] => factory !== null)

  if (factories.length === 0) return null

  const quantity = factories.reduce((sum, factory) => sum + factory.quantity, 0)
  const ratio = aggregate.quantity > 0 ? quantity / aggregate.quantity : 0
  return {
    ...aggregate,
    id: `${aggregate.id}|${idSuffix}`,
    quantity,
    requested_quantity: aggregate.requested_quantity * ratio,
    reserved_quantity: aggregate.reserved_quantity * ratio,
    weight_kg: sumNullableWeights(factories.map((factory) => factory.weight_kg)),
    item_count: factories.reduce((sum, factory) => sum + factory.item_count, 0),
    machine_count: new Set(factories.flatMap((factory) => factory.items.map((item) => item.machine_id))).size,
    pending_count: factories.reduce((sum, factory) => sum + factory.pending_count, 0),
    ordered_count: factories.reduce((sum, factory) => sum + factory.ordered_count, 0),
    delivered_count: factories.reduce((sum, factory) => sum + factory.delivered_count, 0),
    planned_schedule_quantity: factories.reduce((sum, factory) => sum + factory.planned_schedule_quantity, 0),
    delivered_schedule_quantity: factories.reduce((sum, factory) => sum + factory.delivered_schedule_quantity, 0),
    unscheduled_quantity: factories.reduce((sum, factory) => sum + factory.unscheduled_quantity, 0),
    factories,
  }
}

function projectSupplyOrderFactory(
  factory: SupplyOrderAggregate['factories'][number],
  predicate: (item: SupplyOrderAggregateSourceItem) => boolean,
): SupplyOrderAggregate['factories'][number] | null {
  const items = factory.items.filter(predicate)
  if (items.length === 0) return null

  const quantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const ratio = factory.quantity > 0 ? quantity / factory.quantity : 0
  const supplyDates = Array.from(new Set(items.map((item) => item.supply_delivery_date || 'no_supply_date')))
  const deliveryDates = new Set(items.flatMap((item) => item.delivery_schedules.map((schedule) => schedule.delivery_date)))
  const suppliers = summarizeProjectedSuppliers(items)

  return {
    ...factory,
    quantity,
    requested_quantity: factory.requested_quantity * ratio,
    reserved_quantity: factory.reserved_quantity * ratio,
    weight_kg: sumNullableWeights(items.map((item) => item.weight_kg)),
    item_count: items.length,
    machine_count: new Set(items.map((item) => item.machine_id)).size,
    pending_count: items.filter((item) => item.order_status === 'pending').length,
    ordered_count: items.filter((item) => item.order_status === 'ordered').length,
    delivered_count: items.filter((item) => item.order_status === 'delivered').length,
    planned_schedule_quantity: items.reduce((sum, item) => sum + item.planned_schedule_quantity, 0),
    delivered_schedule_quantity: items.reduce((sum, item) => sum + item.delivered_schedule_quantity, 0),
    unscheduled_quantity: items.reduce((sum, item) => sum + item.unscheduled_quantity, 0),
    delivery_schedule_count: deliveryDates.size,
    has_delivery_schedules: deliveryDates.size > 0,
    supply_delivery_date: supplyDates.length === 1 && supplyDates[0] !== 'no_supply_date' ? supplyDates[0] : null,
    has_mixed_supply_delivery_dates: supplyDates.length > 1,
    suppliers,
    items,
  }
}

function summarizeProjectedSuppliers(items: SupplyOrderAggregateSourceItem[]) {
  const suppliers = new Map<string, SupplyOrderAggregate['factories'][number]['suppliers'][number]>()
  for (const item of items) {
    const key = item.supplier_id || 'none'
    const current = suppliers.get(key) || {
      id: item.supplier_id,
      name: item.supplier_name || 'Без поставщика',
      item_count: 0,
      pending_count: 0,
      ordered_count: 0,
      delivered_count: 0,
    }
    current.item_count += 1
    current.pending_count += item.order_status === 'pending' ? 1 : 0
    current.ordered_count += item.order_status === 'ordered' ? 1 : 0
    current.delivered_count += item.order_status === 'delivered' ? 1 : 0
    suppliers.set(key, current)
  }
  return Array.from(suppliers.values()).sort((left, right) => compareText(left.name, right.name))
}

function sumNullableWeights(weights: Array<number | null>) {
  const known = weights.filter((weight): weight is number => weight !== null && Number.isFinite(weight))
  return known.length > 0 ? known.reduce((sum, weight) => sum + weight, 0) : null
}

export function filterAndSortHistory(items: SupplyOrderHistoryItem[], filters: HistoryFiltersState) {
  const normalizedQuery = normalize(filters.query)
  const filtered = items.filter((item) => {
    if (filters.category !== 'all' && item.category !== filters.category) return false
    if (filters.supplier !== 'all' && (item.supplier_name || 'none') !== filters.supplier) return false
    if (normalizedQuery) {
      const haystack = normalize([
        item.item_name,
        item.machine_name,
        item.supplier_name,
        ...item.characteristics.flatMap((part) => [part.label, part.value]),
      ].filter(Boolean).join(' '))
      if (!haystack.includes(normalizedQuery)) return false
    }
    return true
  })

  return [...filtered].sort((left, right) => {
    if (filters.sort === 'material_asc') return compareText(left.item_name, right.item_name)
    if (filters.sort === 'quantity_desc') return right.quantity - left.quantity || compareText(left.item_name, right.item_name)
    return compareNullableDates(
      left.accepted_at,
      right.accepted_at,
      filters.sort === 'accepted_asc' ? 'asc' : 'desc'
    ) || compareText(left.item_name, right.item_name)
  })
}

function compareDateGroupKeys(
  left: string,
  right: string,
  direction: 'asc' | 'desc',
  emptyKey = 'no_date'
) {
  const specialKeys = new Set([emptyKey, 'no_supplier'])
  if (specialKeys.has(left) && specialKeys.has(right)) return left === right ? 0 : left === 'no_supplier' ? 1 : -1
  if (specialKeys.has(left)) return 1
  if (specialKeys.has(right)) return -1
  return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left)
}

function compareNullableDates(left: string | null, right: string | null, direction: 'asc' | 'desc') {
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left)
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, 'ru', { sensitivity: 'base', numeric: true })
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('ru')
}
