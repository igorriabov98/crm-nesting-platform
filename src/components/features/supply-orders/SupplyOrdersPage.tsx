'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ChevronLeft, ChevronRight, PackageSearch, Truck, UserRoundX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { markOrderDelivered, markOrderPlacedWithFinance, type SupplyFinancePaymentInput, type SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { OrderActions } from './OrderActions'
import { OrderDateGroup } from './OrderDateGroup'
import { OrderFilters } from './OrderFilters'
import {
  filterSupplyOrderItems,
  groupSupplyOrderItems,
  sortSupplyOrderItems,
  type OrderFiltersState,
} from './supply-order-view'

type SupplyOrdersPageProps = {
  items: SupplyOrderItem[]
  suppliers: SupplierWithRelations[]
  page: number
  pageSize: number
  total: number
  initialStatus?: 'pending' | 'ordered' | 'delivered' | 'all'
  lockedStatus?: 'pending' | 'ordered' | 'delivered'
  showActions?: boolean
  emptyMessage?: string
}

export function SupplyOrdersPage({
  items,
  suppliers,
  page,
  pageSize,
  total,
  initialStatus = 'pending',
  lockedStatus,
  showActions = true,
  emptyMessage,
}: SupplyOrdersPageProps) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [showFinanceStep, setShowFinanceStep] = useState(false)
  const [financeDrafts, setFinanceDrafts] = useState<Record<string, { amount: string; currency: 'UAH' | 'EUR'; plannedDate: string }>>({})
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

  const filteredItems = useMemo(() => (
    sortSupplyOrderItems(filterSupplyOrderItems(items, filters), filters.sort)
  ), [filters, items])
  const grouped = useMemo(() => groupSupplyOrderItems(filteredItems, filters.sort), [filteredItems, filters.sort])

  const toggle = (item: SupplyOrderItem) => {
    if (!showActions || item.to_order <= 0) return
    const key = `${item.table}:${item.id}`
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedOrderItems = useMemo(() => (
    items.filter((item) => selected.has(`${item.table}:${item.id}`) && item.to_order > 0)
  ), [items, selected])

  const financeGroups = useMemo(() => {
    const groups = new Map<string, {
      supplierId: string
      supplierName: string
      plannedDate: string
      itemKeys: string[]
      items: SupplyOrderItem[]
    }>()
    for (const item of selectedOrderItems) {
      if (!item.supplier_id) continue
      const plannedDate = item.target_delivery_date || new Date().toISOString().slice(0, 10)
      const key = `${item.supplier_id}:${plannedDate}`
      const current = groups.get(key) || {
        supplierId: item.supplier_id,
        supplierName: item.supplier_name || 'Поставщик',
        plannedDate,
        itemKeys: [],
        items: [],
      }
      current.itemKeys.push(`${item.table}:${item.id}`)
      current.items.push(item)
      groups.set(key, current)
    }
    return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }))
  }, [selectedOrderItems])

  const makeFinancePayments = (): SupplyFinancePaymentInput[] => financeGroups.map((group) => {
    const draft = financeDrafts[group.key]
    return {
      supplierId: group.supplierId,
      plannedDate: draft?.plannedDate || group.plannedDate,
      amount: Number((draft?.amount || '').replace(',', '.')),
      currency: draft?.currency || 'EUR',
      itemKeys: group.itemKeys,
    }
  })

  const openFinanceStep = () => {
    if (selected.size === 0 || isPending) return
    const defaults: Record<string, { amount: string; currency: 'UAH' | 'EUR'; plannedDate: string }> = {}
    for (const group of financeGroups) {
      defaults[group.key] = financeDrafts[group.key] || { amount: '', currency: 'EUR', plannedDate: group.plannedDate }
    }
    setFinanceDrafts(defaults)
    setShowFinanceStep(true)
  }

  const runAction = (mode: 'ordered' | 'delivered') => {
    startTransition(async () => {
      const payload = selectedOrderItems.map((item) => ({ table: item.table, id: item.id }))
      const result = mode === 'ordered'
        ? await markOrderPlacedWithFinance(payload, makeFinancePayments())
        : await markOrderDelivered(payload)
      if (!result.success) {
        toast.error(result.error || 'Не удалось обновить позиции')
        return
      }
      toast.success(mode === 'ordered' ? 'Позиции отмечены как заказанные' : 'Позиции отмечены как доставленные')
      setSelected(new Set())
      setShowFinanceStep(false)
      setFinanceDrafts({})
      router.refresh()
    })
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentFrom = total === 0 ? 0 : page * pageSize + 1
  const currentTo = Math.min(total, (page + 1) * pageSize)
  const activeFilterCount = countChangedFilters(filters, defaultFilters)
  const attention = useMemo(() => ({
    missingSupplier: filteredItems.filter((item) => !item.supplier_id && item.to_order > 0).length,
    scheduled: filteredItems.filter((item) => item.delivery_schedules.length > 0).length,
    coveredByStock: filteredItems.filter((item) => item.to_order <= 0 && item.reserved_quantity > 0).length,
  }), [filteredItems])

  const goToPage = (nextPage: number) => {
    const params = new URLSearchParams({ view: 'details', page: String(nextPage + 1) })
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

      {showActions && (
        <OrderActions
          selectedCount={selected.size}
          isPending={isPending}
          onMarkOrdered={openFinanceStep}
          onMarkDelivered={() => runAction('delivered')}
        />
      )}

      {showActions && showFinanceStep && (
        <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm" aria-labelledby="finance-step-title">
          <div className="mb-4">
            <h2 id="finance-step-title" className="font-semibold text-foreground">Плановые платежи по заказу</h2>
            <p className="mt-1 text-sm text-muted-foreground">Платежи группируются по поставщику и плановой дате.</p>
          </div>
          <div className="space-y-3">
            {financeGroups.map((group) => {
              const draft = financeDrafts[group.key] || { amount: '', currency: 'EUR' as const, plannedDate: group.plannedDate }
              return (
                <div key={group.key} className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-3 md:grid-cols-[minmax(180px,1fr)_150px_120px_170px] md:items-end">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{group.supplierName}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{group.items.length} позиций</div>
                  </div>
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                    Сумма
                    <Input
                      value={draft.amount}
                      inputMode="decimal"
                      onChange={(event) => setFinanceDrafts((previous) => ({ ...previous, [group.key]: { ...draft, amount: event.target.value } }))}
                      placeholder="0,00"
                      className="h-10 bg-background"
                    />
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                    Валюта
                    <Select value={draft.currency} onValueChange={(currency) => setFinanceDrafts((previous) => ({ ...previous, [group.key]: { ...draft, currency: currency as 'UAH' | 'EUR' } }))}>
                      <SelectTrigger className="h-10 bg-background"><SelectValue>{draft.currency}</SelectValue></SelectTrigger>
                      <SelectContent><SelectItem value="EUR">EUR</SelectItem><SelectItem value="UAH">UAH</SelectItem></SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                    Плановая дата
                    <Input
                      type="date"
                      value={draft.plannedDate}
                      onChange={(event) => setFinanceDrafts((previous) => ({ ...previous, [group.key]: { ...draft, plannedDate: event.target.value } }))}
                      className="h-10 bg-background"
                    />
                  </label>
                </div>
              )
            })}
          </div>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setShowFinanceStep(false)}>Отмена</Button>
            <Button
              type="button"
              disabled={isPending || financeGroups.length === 0 || makeFinancePayments().some((payment) => !payment.plannedDate || !Number.isFinite(payment.amount) || payment.amount <= 0)}
              onClick={() => runAction('ordered')}
            >
              Подтвердить заказ и создать платежи
            </Button>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium text-foreground">Заявки {currentFrom}–{currentTo} из {total}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Показано {filteredItems.length} из {items.length} позиций · страница {page + 1} из {pageCount}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" disabled={page <= 0 || isPending} onClick={() => goToPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />Назад
          </Button>
          <Button type="button" variant="outline" disabled={page + 1 >= pageCount || isPending} onClick={() => goToPage(page + 1)}>
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
            selected={selected}
            onToggle={toggle}
            readOnly={!showActions}
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
