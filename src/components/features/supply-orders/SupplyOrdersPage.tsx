'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, ChevronLeft, ChevronRight, PackageSearch, Truck, UserRoundX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SupplyOrderAggregate, SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { OrderDateGroup } from './OrderDateGroup'
import { OrderFilters } from './OrderFilters'
import {
  buildSupplyOrderDetailContexts,
  filterSupplyOrderItems,
  groupSupplyOrderItems,
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
    missingSupplier: filteredItems.filter((item) => !item.supplier_id && item.to_order > 0).length,
    scheduled: filteredItems.filter((item) => (
      (detailContexts.get(`${item.table}:${item.id}`)?.plannedQuantity || 0) > 0
    )).length,
    coveredByStock: filteredItems.filter((item) => item.to_order <= 0 && item.reserved_quantity > 0).length,
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Сводка текущей страницы">
        <StatCard icon={<PackageSearch className="h-4 w-4" />} label="Показано" value={filteredItems.length} hint={`из ${items.length} на странице`} />
        <StatCard icon={<UserRoundX className="h-4 w-4" />} label="Без поставщика" value={attention.missingSupplier} tone="warning" />
        <StatCard icon={<Truck className="h-4 w-4" />} label="С графиком" value={attention.scheduled} tone="info" />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Закрыто складом" value={attention.coveredByStock} tone="success" />
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium text-foreground">Заявки {currentFrom}–{currentTo} из {total}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Показано {filteredItems.length} из {items.length} позиций · страница {page + 1} из {pageCount}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={page <= 0} onClick={() => goToPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />Назад
          </Button>
          <Button type="button" variant="outline" disabled={page + 1 >= pageCount} onClick={() => goToPage(page + 1)}>
            Вперёд<ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

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
        grouped.map((group) => (
          <OrderDateGroup
            key={group.dateKey}
            dateKey={group.dateKey}
            groups={group.groups}
            suppliers={suppliers}
            detailContexts={detailContexts}
          />
        ))
      )}
    </div>
  )
}

function StatCard({ icon, label, value, hint, tone = 'default' }: {
  icon: React.ReactNode
  label: string
  value: number
  hint?: string
  tone?: 'default' | 'warning' | 'info' | 'success'
}) {
  const toneClass = {
    default: 'bg-primary/10 text-primary',
    warning: 'bg-amber-500/10 text-amber-700',
    info: 'bg-sky-500/10 text-sky-700',
    success: 'bg-emerald-500/10 text-emerald-700',
  }[tone]
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${toneClass}`}>{icon}</div>
      </div>
    </div>
  )
}

function countChangedFilters(current: OrderFiltersState, defaults: OrderFiltersState) {
  return (Object.keys(current) as Array<keyof OrderFiltersState>)
    .filter((key) => current[key] !== defaults[key])
    .length
}
