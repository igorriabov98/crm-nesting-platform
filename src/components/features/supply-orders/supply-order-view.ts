import { addDays, endOfWeek, isWithinInterval, startOfWeek } from 'date-fns'
import type {
  SupplyOrderAggregate,
  SupplyOrderAggregateSourceItem,
  SupplyOrderHistoryItem,
  SupplyOrderItem,
} from '@/lib/actions/supply-orders'
import type { MaterialCategory, OrderItemStatus } from '@/lib/types'

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

export type SupplyOrderAggregateStatusFilter = 'all' | 'scheduled' | 'unscheduled' | 'closed' | 'pending' | 'ordered'
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

export type SupplyOrderDateGroup = {
  dateKey: string
  groups: Array<{
    supplierKey: string
    supplierName: string
    items: SupplyOrderItem[]
  }>
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
    if (filters.status === 'pending' && aggregate.pending_count <= 0) return false
    if (filters.status === 'ordered' && aggregate.ordered_count <= 0) return false
    if (filters.status === 'scheduled' && aggregate.planned_schedule_quantity <= 0) return false
    if (filters.status === 'unscheduled' && aggregate.unscheduled_quantity <= 0) return false
    if (filters.status === 'closed' && !(
      aggregate.delivered_count === aggregate.item_count && aggregate.unscheduled_quantity <= 0
    )) return false
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

export function summarizeSupplyOrderMachineRoutes(items: SupplyOrderAggregateSourceItem[]): SupplyOrderMachineRoute[] {
  const routes = new Map<string, SupplyOrderMachineRoute & { hasUnknownWeight: boolean }>()

  for (const item of items) {
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

    current.quantity += item.quantity
    current.itemCount += 1
    current.pendingCount += item.order_status === 'pending' ? 1 : 0
    current.orderedCount += item.order_status === 'ordered' ? 1 : 0
    if (item.weight_kg === null) current.hasUnknownWeight = true
    else current.weightKg = (current.weightKg || 0) + item.weight_kg
    routes.set(key, current)
  }

  return Array.from(routes.values())
    .map(({ hasUnknownWeight, ...route }) => ({
      ...route,
      weightKg: hasUnknownWeight ? null : route.weightKg,
    }))
    .sort((left, right) => compareText(left.machineName, right.machineName))
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
