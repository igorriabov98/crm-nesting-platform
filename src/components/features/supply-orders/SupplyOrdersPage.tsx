'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarX2, CheckCircle2, ChevronLeft, ChevronRight, PackageSearch, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SupplyOrderAggregate, SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { OrderDateGroup } from './OrderDateGroup'
import { OrderFilters } from './OrderFilters'
import {
  buildSupplyOrderDetailContexts,
  filterSupplyOrderItems,
  groupSupplyOrderItems,
  isReturnedSupplyOrderSource,
  sortSupplyOrderItems,
  type OrderFiltersState,
} from './supply-order-view'

type SupplyOrdersPageProps = {
  items: SupplyOrderItem[]
  aggregates: SupplyOrderAggregate[]
  suppliers: SupplierWithRelations[]
  page: number
  pageSize: number
  total: number
  initialStatus?: 'pending' | 'ordered' | 'delivered' | 'all'
  lockedStatus?: 'pending' | 'ordered' | 'delivered'
  emptyMessage?: string
}

export function SupplyOrdersPage({
  items,
  aggregates,
  suppliers,
  page,
  pageSize,
  total,
  initialStatus = 'pending',
  lockedStatus,
  emptyMessage,
}: SupplyOrdersPageProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultFilters = useMemo<OrderFiltersState>(() => ({
    query: '',
    period: 'all',
    supplier: 'all',
    category: 'all',
    status: lockedStatus || initialStatus,
    attention: 'all',
    sort: 'delivery_asc',
  }), [initialStatus, lockedStatus])
  const [filters, setFilters] = useState<OrderFiltersState>(defaultFilters)

  const detailContexts = useMemo(
    () => buildSupplyOrderDetailContexts(items, aggregates),
    [aggregates, items],
  )
  const viewItems = useMemo(() => items.map((item) => (
    detailContexts.get(`${item.table}:${item.id}`)?.item || item
  )), [detailContexts, items])
  const filteredItems = useMemo(() => (
    sortSupplyOrderItems(filterSupplyOrderItems(viewItems, filters), filters.sort)
  ), [filters, viewItems])
  const grouped = useMemo(() => groupSupplyOrderItems(filteredItems, filters.sort), [filteredItems, filters.sort])

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)
  const activeFilterCount = countChangedFilters(filters, defaultFilters)
  const attention = useMemo(() => ({
    missingSchedule: filteredItems.filter((item) => (
      !isReturnedSupplyOrderSource(item)
      && item.to_order > 0
      && !item.delivery_schedules.some((schedule) => schedule.status === 'planned')
    )).length,
    scheduled: filteredItems.filter((item) => (
      !isReturnedSupplyOrderSource(item)
      &&
      (detailContexts.get(`${item.table}:${item.id}`)?.plannedQuantity || 0) > 0
    )).length,
    coveredByStock: filteredItems.filter((item) => (
      !isReturnedSupplyOrderSource(item) && item.to_order <= 0 && item.reserved_quantity > 0
    )).length,
  }), [detailContexts, filteredItems])

  const goToPage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', 'details')
    params.set('page', String(nextPage + 1))
    router.push(`/supply/orders?${params.toString()}`)
  }

  return (
    <div className="space-y-4">
      <OrderFilters
        value={filters}
        suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        activeFilterCount={activeFilterCount}
        onChange={setFilters}
        onReset={() => setFilters(defaultFilters)}
        statusDisabled={Boolean(lockedStatus)}
      />

      <section className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between" aria-label="Сводка и навигация по заявкам">
        <div className="flex flex-wrap gap-2">
          <SummaryChip icon={<PackageSearch className="h-3.5 w-3.5" />} label="Показано" value={`${filteredItems.length} из ${items.length}`} />
          <SummaryChip icon={<CalendarX2 className="h-3.5 w-3.5" />} label="Без графика" value={String(attention.missingSchedule)} tone="warning" />
          <SummaryChip icon={<Truck className="h-3.5 w-3.5" />} label="С графиком" value={String(attention.scheduled)} tone="info" />
          <SummaryChip icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Потребность закрыта" value={String(attention.coveredByStock)} tone="success" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-xs text-muted-foreground sm:text-right">
            <div className="font-medium text-foreground">Заявки {currentFrom}–{currentTo} из {total}</div>
            <div>Страница {page + 1} из {pageCount}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="min-h-11" disabled={page <= 0} onClick={() => goToPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />Назад
            </Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={page + 1 >= pageCount} onClick={() => goToPage(page + 1)}>
              Вперёд<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-14 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-3 font-semibold text-foreground">Ничего не найдено</div>
          <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            {emptyMessage || (items.length === 0
              ? 'На этой странице нет позиций к заказу.'
              : 'Измените условия поиска или сбросьте фильтры.')}
          </div>
          {activeFilterCount > 0 && <Button type="button" variant="outline" className="mt-4" onClick={() => setFilters(defaultFilters)}>Сбросить фильтры</Button>}
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => (
            <OrderDateGroup
              key={group.dateKey}
              dateKey={group.dateKey}
              groups={group.groups}
              suppliers={suppliers}
              detailContexts={detailContexts}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryChip({ icon, label, value, tone = 'default' }: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'default' | 'warning' | 'info' | 'success'
}) {
  const toneClass = {
    default: 'border-border bg-background text-primary',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }[tone]
  return (
    <div className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-xs ${toneClass}`}>
      {icon}
      <span>{label}</span>
      <strong className="tabular-nums">{value}</strong>
    </div>
  )
}

function countChangedFilters(current: OrderFiltersState, defaults: OrderFiltersState) {
  return (Object.keys(current) as Array<keyof OrderFiltersState>)
    .filter((key) => current[key] !== defaults[key])
    .length
}
