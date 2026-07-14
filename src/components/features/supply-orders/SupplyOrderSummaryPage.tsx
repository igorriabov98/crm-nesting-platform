'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarDays,
  CalendarX2,
  Check,
  ChevronDown,
  Cog,
  CreditCard,
  ExternalLink,
  Factory,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Truck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import {
  clearAggregateDeliverySchedule,
  markOrderPlacedWithFinance,
  saveAggregateDeliverySchedule,
  type MaterialReceivingFactory,
  type SupplyFinancePaymentInput,
  type SupplyOrderAggregate,
  type SupplyOrderAggregateFactory,
  type SupplyOrderAggregateScheduleInput,
  type SupplyOrderAggregateSourceItem,
} from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import {
  filterAndSortAggregates,
  groupSupplyOrderAggregates,
  hasSupplyOrderRedelivery,
  partitionSupplyOrderAggregatesByRedelivery,
  summarizeSupplyOrderMachineRoutes,
  summarizeSupplyOrderRedeliveryMachineRoutes,
  summarizeSupplyOrderUnscheduledMachineRoutes,
  type AggregateFiltersState,
  type SupplyOrderAggregateSort,
  type SupplyOrderAggregateStatusFilter,
} from './supply-order-view'

type SupplyOrderSummaryPageProps = {
  aggregates: SupplyOrderAggregate[]
  factories: MaterialReceivingFactory[]
  activeFactoryId: string | null
  suppliers: SupplierWithRelations[]
}

type ScheduleDraft = {
  id: string
  delivery_date: string
  quantity: string
  supplier_id: string
  piece_length_mm: string
  piece_count: string
}

type ScheduleGroup = {
  key: string
  delivery_date: string
  supplier_id: string | null
  supplier_name: string | null
  quantity: number
  received_quantity: number
  piece_length_mm: number | null
  piece_count: number | null
}

type FinanceDraft = {
  amount: string
  currency: 'UAH' | 'EUR'
  plannedDate: string
}

export function SupplyOrderSummaryPage({ aggregates, factories, activeFactoryId, suppliers }: SupplyOrderSummaryPageProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const defaultFilters = useMemo<AggregateFiltersState>(() => ({
    query: '',
    supplier: 'all',
    category: 'all',
    status: 'all',
    sort: 'date_asc',
  }), [])
  const [filters, setFilters] = useState<AggregateFiltersState>(defaultFilters)
  const visibleAggregates = useMemo(() => filterAndSortAggregates(aggregates, filters), [aggregates, filters])

  const prioritizedAggregates = useMemo(() => {
    return partitionSupplyOrderAggregatesByRedelivery(visibleAggregates)
  }, [visibleAggregates])
  const grouped = useMemo(() => {
    return groupSupplyOrderAggregates(
      filters.status === 'unscheduled' ? [] : prioritizedAggregates.regular,
      filters.sort,
    )
  }, [filters.sort, filters.status, prioritizedAggregates.regular])
  const metricAggregates = filters.status === 'unscheduled'
    ? prioritizedAggregates.redeliveries
    : visibleAggregates

  const totals = useMemo(() => ({
    aggregateCount: metricAggregates.length,
    itemCount: metricAggregates.reduce((sum, aggregate) => sum + aggregate.item_count, 0),
    pendingCount: metricAggregates.reduce((sum, aggregate) => sum + aggregate.pending_count, 0),
    orderedCount: metricAggregates.reduce((sum, aggregate) => sum + aggregate.ordered_count, 0),
    plannedQuantity: metricAggregates.reduce((sum, aggregate) => sum + aggregate.planned_schedule_quantity, 0),
    deliveredQuantity: metricAggregates.reduce((sum, aggregate) => sum + aggregate.delivered_schedule_quantity, 0),
    remainingQuantity: metricAggregates.reduce((sum, aggregate) => sum + aggregate.unscheduled_quantity, 0),
  }), [metricAggregates])

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-5">
      <FactoryToggle factories={factories} activeFactoryId={activeFactoryId} />

      <DeliveryStateTabs
        value={filters.status}
        onChange={(status) => setFilters((current) => ({ ...current, status }))}
        counts={{
          all: aggregates.length,
          scheduled: aggregates.filter((row) => row.planned_schedule_quantity > 0).length,
          unscheduled: aggregates.filter(hasSupplyOrderRedelivery).length,
          closed: aggregates.filter((row) => row.delivered_count === row.item_count && row.unscheduled_quantity <= 0).length,
        }}
      />

      <AggregateFilters
        value={filters}
        suppliers={suppliers}
        resultCount={visibleAggregates.length}
        totalCount={aggregates.length}
        onChange={setFilters}
        onReset={() => setFilters(defaultFilters)}
      />

      {visibleAggregates.length === 0 ? (
        <div className="rounded-xl border border-[#E8ECF0] bg-white p-10 text-center text-[#6B7280]">
          {aggregates.length === 0
            ? 'Нет материалов для закупки или истории закрытых поставок по выбранному заводу.'
            : 'По выбранным фильтрам материалы не найдены.'}
          {aggregates.length > 0 && (
            <div><Button type="button" variant="outline" className="mt-4" onClick={() => setFilters(defaultFilters)}>Сбросить фильтры</Button></div>
          )}
        </div>
      ) : (
        <>
          {prioritizedAggregates.redeliveries.length > 0 && (
            <section className="space-y-3" aria-labelledby="redelivery-heading">
              <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                    <CalendarX2 className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 id="redelivery-heading" className="text-base font-semibold text-amber-950 sm:text-lg">
                      Нужно довезти
                    </h2>
                    <p className="text-xs text-amber-800/80">После приёмки поступила только часть заявленного объёма. Остатку нужна новая дата</p>
                  </div>
                </div>
                <Badge variant="outline" className="w-fit border-amber-300 bg-white/80 text-amber-900">
                  {prioritizedAggregates.redeliveries.length} материалов
                </Badge>
              </div>

              <div className="space-y-3">
                {prioritizedAggregates.redeliveries.map((aggregate) => (
                  <MaterialOrderCard
                    key={aggregate.id}
                    aggregate={aggregate}
                    factory={aggregate.factories[0]}
                    suppliers={suppliers}
                    isExpanded={expanded.has(aggregate.id)}
                    onToggle={() => toggle(aggregate.id)}
                    attentionKind="redelivery"
                  />
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-4">
            <Metric label="Материалы" value={totals.aggregateCount} />
            <Metric label="Позиции" value={totals.itemCount} />
            <Metric label="Не зак. / зак." value={`${totals.pendingCount} / ${totals.orderedCount}`} />
            <Metric
              label="План / факт"
              value={`${formatAmount(totals.plannedQuantity)} / ${formatAmount(totals.deliveredQuantity)}`}
              hint={`Остаток ${formatAmount(totals.remainingQuantity)}`}
            />
          </div>

          {grouped.map((group) => (
            <section key={group.dateKey} className="space-y-3" aria-labelledby={`aggregate-date-${group.dateKey}`}>
              <div className="flex items-center gap-3 px-1">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-4 w-4" /></div>
                <div>
                  <h2 id={`aggregate-date-${group.dateKey}`} className="text-base font-semibold text-foreground sm:text-lg">
                    {group.dateKey === 'no_planned_date' ? 'Без даты Мат.план' : formatDate(group.dateKey)}
                  </h2>
                  <p className="text-xs text-muted-foreground">{group.rows.length} агрегированных материалов</p>
                </div>
              </div>

              <div className="space-y-3">
                  {group.rows.map((aggregate) => (
                    <MaterialOrderCard
                      key={aggregate.id}
                      aggregate={aggregate}
                      factory={aggregate.factories[0]}
                      suppliers={suppliers}
                      isExpanded={expanded.has(aggregate.id)}
                      onToggle={() => toggle(aggregate.id)}
                    />
                  ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function MaterialOrderCard({
  aggregate,
  factory,
  suppliers,
  isExpanded,
  onToggle,
  attentionKind = 'standard',
}: {
  aggregate: SupplyOrderAggregate
  factory?: SupplyOrderAggregateFactory
  suppliers: SupplierWithRelations[]
  isExpanded: boolean
  onToggle: () => void
  attentionKind?: 'standard' | 'redelivery'
}) {
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const routes = factory ? summarizeSupplyOrderMachineRoutes(factory.items) : []
  const unscheduledRoutes = factory ? summarizeSupplyOrderUnscheduledMachineRoutes(factory.items) : []
  const redeliveryRoutes = attentionKind === 'redelivery' && factory
    ? summarizeSupplyOrderRedeliveryMachineRoutes(factory.items)
    : []
  const attentionRoutes = attentionKind === 'redelivery' ? redeliveryRoutes : unscheduledRoutes
  const attentionByMachine = new Map(attentionRoutes.map((route) => [route.machineId || route.machineName, route]))
  const redeliveryDatesByMachine = new Map(redeliveryRoutes.map((route) => [
    route.machineId || route.machineName,
    route.originalDeliveryDates,
  ]))
  const detailsId = `machine-details-${aggregate.id}`
  const deliveryId = `delivery-details-${aggregate.id}`
  const supplyPlan = factory ? makeSupplyPlanDateInfo(factory) : null

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_220px]">
        <header className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5">
            <div className="text-sm text-muted-foreground">{MATERIAL_CATEGORY_LABELS[aggregate.category]}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {aggregate.ordered_count > 0 && (
                <div className="flex items-center gap-1.5 font-medium text-primary">
                  <Check className="h-3.5 w-3.5" />
                  {aggregate.ordered_count} заказано
                </div>
              )}
              {aggregate.pending_count > 0 && <div className="text-muted-foreground">{aggregate.pending_count} не заказано</div>}
              {aggregate.delivered_count > 0 && <div className="font-medium text-emerald-700">{aggregate.delivered_count} принято</div>}
            </div>
          </div>
          <h3 className="mt-1 break-words text-lg font-semibold text-foreground sm:text-xl">{aggregate.item_name}</h3>

          {factory && factory.unscheduled_quantity > 0 && (
            <div className="mt-3 flex w-fit flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm text-amber-950">
              <CalendarX2 className="h-4 w-4 shrink-0 text-amber-700" />
              <span className="font-semibold">{attentionKind === 'redelivery' ? 'Нужно довезти:' : 'Без графика:'}</span>
              <span className="font-medium tabular-nums">{formatAmount(factory.unscheduled_quantity)} {aggregate.unit}</span>
              {formatWeightForQuantity(factory.unscheduled_quantity, factory) && (
                <span className="text-amber-800">· {formatWeightForQuantity(factory.unscheduled_quantity, factory)}</span>
              )}
            </div>
          )}

          <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:flex xl:flex-wrap">
            {aggregate.characteristics.map((part) => (
              <div key={`${part.label}:${part.value}`} className="flex min-w-0 gap-1.5 text-sm">
                <dt className="shrink-0 text-muted-foreground">{part.label}:</dt>
                <dd className="break-words font-medium text-foreground">{part.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <dl className="border-t border-border bg-muted/20 p-4 lg:border-l lg:border-t-0 lg:p-5">
          <div className="flex items-baseline justify-between gap-3 lg:block">
            <dt className="text-sm text-muted-foreground">{attentionKind === 'redelivery' ? 'Было заявлено' : 'Количество'}</dt>
            <dd className="text-xl font-semibold text-foreground tabular-nums lg:mt-1">
              {formatAmount(aggregate.quantity)} {aggregate.unit}
            </dd>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">Вес</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {aggregate.weight_kg !== null ? `${formatAmount(aggregate.weight_kg)} кг` : 'Не рассчитан'}
            </dd>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">Позиций</dt>
            <dd className="font-medium text-foreground tabular-nums">{aggregate.item_count}</dd>
          </div>
        </dl>
      </div>

      <div className="border-t border-border lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <section className="p-4 sm:p-5" aria-label="Машины назначения материала">
          <div className="flex items-center justify-between gap-3 xl:max-w-3xl">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Cog className="h-4 w-4 text-primary" />
              Машины
            </h4>
            <span className="text-xs text-muted-foreground">{routes.length}</span>
          </div>

          {routes.length > 0 ? (
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border xl:max-w-3xl">
              {routes.map((route) => (
                <li key={route.machineId || route.machineName}>
                  <Link
                    href={`${ROUTES.SALES_PLAN}/${route.machineId}`}
                    className="flex min-h-12 items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                  >
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-primary">{route.machineName}</span>
                      {attentionKind === 'redelivery' && redeliveryDatesByMachine.get(route.machineId || route.machineName) && (
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          Изначально ожидалось: {redeliveryDatesByMachine.get(route.machineId || route.machineName)!.map(formatDate).join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
                      <span className="font-semibold text-foreground">{formatAmount(route.quantity)} {aggregate.unit}</span>
                      {attentionByMachine.get(route.machineId || route.machineName) && (
                        <span className="text-xs font-medium text-amber-700">
                          {attentionKind === 'redelivery' ? 'Довезти' : 'Без графика'} {formatAmount(attentionByMachine.get(route.machineId || route.machineName)!.quantity)} {aggregate.unit}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground xl:max-w-3xl">
              Машины для этого материала не найдены.
            </div>
          )}

          {factory && (
            <Button
              type="button"
              variant="ghost"
              className="mt-2 min-h-11 w-full justify-between rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground xl:max-w-3xl"
              aria-expanded={isExpanded}
              aria-controls={detailsId}
              onClick={onToggle}
            >
              <span>{isExpanded ? 'Скрыть позиции заявок' : `Показать позиции заявок (${factory.item_count})`}</span>
              <ChevronDown className={`h-4 w-4 transition-transform motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`} />
            </Button>
          )}
        </section>

        {factory ? (
          <section className="border-t border-border lg:border-l lg:border-t-0">
            <button
              type="button"
              className="flex min-h-20 h-full w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:px-5"
              aria-expanded={deliveryOpen}
              aria-controls={deliveryId}
              onClick={() => setDeliveryOpen((current) => !current)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Truck className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">Поставка · {factory.factory_name}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    Мат.план {factory.production_date ? formatDate(factory.production_date) : 'не указан'} · снабжение {supplyPlan?.value || 'не указано'}
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    График {factory.has_delivery_schedules ? dateCountLabel(factory.delivery_schedule_count) : 'не создан'}
                    {factory.unscheduled_quantity > 0 && ` · остаток ${formatAmount(factory.unscheduled_quantity)} ${aggregate.unit}`}
                  </span>
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${deliveryOpen ? 'rotate-180' : ''}`} />
            </button>
          </section>
        ) : (
          <div className="border-t border-border p-4 text-sm text-muted-foreground lg:border-l lg:border-t-0">Нет заводской строки для выбранного фильтра.</div>
        )}
      </div>

      {isExpanded && factory && <MachineItems id={detailsId} factory={factory} />}

      {factory && (
        <div id={deliveryId} hidden={!deliveryOpen} className="border-t border-border bg-muted/15 p-3 sm:p-4">
          <FactoryDeliveryEditor aggregate={aggregate} factory={factory} suppliers={suppliers} />
        </div>
      )}
    </article>
  )
}

const aggregateStatusLabels: Record<SupplyOrderAggregateStatusFilter, string> = {
  all: 'Все статусы',
  scheduled: 'С датой поступления',
  unscheduled: 'Нужно довезти',
  closed: 'Поставка закрыта',
  pending: 'Есть незаказанные',
  ordered: 'Есть заказанные',
}

function DeliveryStateTabs({ value, onChange, counts }: {
  value: SupplyOrderAggregateStatusFilter
  onChange: (value: SupplyOrderAggregateStatusFilter) => void
  counts: { all: number; scheduled: number; unscheduled: number; closed: number }
}) {
  const tabs: Array<[SupplyOrderAggregateStatusFilter, string, number]> = [
    ['all', 'Все', counts.all],
    ['scheduled', 'С датой поступления', counts.scheduled],
    ['unscheduled', 'Нужно довезти', counts.unscheduled],
    ['closed', 'Закрытые', counts.closed],
  ]
  return (
    <div className="flex w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" aria-label="Состояние поставки">
      {tabs.map(([key, label, count]) => (
        <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key} className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors ${value === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
          {label} <span className="ml-1 tabular-nums opacity-75">{count}</span>
        </button>
      ))}
    </div>
  )
}

const aggregateSortLabels: Record<SupplyOrderAggregateSort, string> = {
  date_asc: 'Мат.план: сначала ранние',
  date_desc: 'Мат.план: сначала поздние',
  material_asc: 'Материал: А–Я',
  quantity_desc: 'Количество: по убыванию',
  remaining_desc: 'Нужно довезти: по убыванию',
}

function AggregateFilters({ value, suppliers, resultCount, totalCount, onChange, onReset }: {
  value: AggregateFiltersState
  suppliers: SupplierWithRelations[]
  resultCount: number
  totalCount: number
  onChange: (value: AggregateFiltersState) => void
  onReset: () => void
}) {
  const activeCount = [value.query, value.supplier !== 'all', value.category !== 'all', value.status !== 'all', value.sort !== 'date_asc']
    .filter(Boolean).length

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm" aria-label="Фильтры итогов по дню">
      <div className="flex flex-col gap-3 border-b border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><SlidersHorizontal className="h-4 w-4" /></div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Отбор сводных материалов</h2>
            <p className="text-xs text-muted-foreground">Показано {resultCount} из {totalCount}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" className="min-h-9 justify-start" disabled={activeCount === 0} onClick={onReset}>
          <RotateCcw className="h-4 w-4" />Сбросить{activeCount > 0 ? ` (${activeCount})` : ''}
        </Button>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-12">
        <label className="grid gap-1.5 md:col-span-2 xl:col-span-4">
          <span className="text-xs font-medium text-muted-foreground">Поиск</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={value.query} onChange={(event) => onChange({ ...value, query: event.target.value })} placeholder="Материал, характеристика, машина" className="h-11 pl-9" />
          </span>
        </label>
        <SummaryFilterSelect
          className="xl:col-span-3"
          label="Поставщик"
          value={value.supplier}
          display={value.supplier === 'all' ? 'Все поставщики' : suppliers.find((supplier) => supplier.id === value.supplier)?.name || 'Все поставщики'}
          items={['all', ...suppliers.map((supplier) => supplier.id)].map((id) => [id, id === 'all' ? 'Все поставщики' : suppliers.find((supplier) => supplier.id === id)?.name || 'Поставщик'])}
          onValueChange={(supplier) => onChange({ ...value, supplier })}
        />
        <SummaryFilterSelect
          className="xl:col-span-2"
          label="Категория"
          value={value.category}
          display={value.category === 'all' ? 'Все категории' : MATERIAL_CATEGORY_LABELS[value.category]}
          items={[['all', 'Все категории'], ...MATERIAL_CATEGORIES.map((category) => [category, MATERIAL_CATEGORY_LABELS[category]])]}
          onValueChange={(category) => onChange({ ...value, category: category as AggregateFiltersState['category'] })}
        />
        <SummaryFilterSelect
          className="xl:col-span-3"
          label="Статус"
          value={value.status}
          display={aggregateStatusLabels[value.status]}
          items={Object.entries(aggregateStatusLabels)}
          onValueChange={(status) => onChange({ ...value, status: status as SupplyOrderAggregateStatusFilter })}
        />
        <SummaryFilterSelect
          className="md:col-span-2 xl:col-span-12"
          label="Сортировка"
          value={value.sort}
          display={aggregateSortLabels[value.sort]}
          items={Object.entries(aggregateSortLabels)}
          onValueChange={(sort) => onChange({ ...value, sort: sort as SupplyOrderAggregateSort })}
        />
      </div>
    </section>
  )
}

function SummaryFilterSelect({ label, value, display, items, onValueChange, className }: {
  label: string
  value: string
  display: string
  items: string[][]
  onValueChange: (value: string) => void
  className?: string
}) {
  return (
    <label className={`grid min-w-0 gap-1.5 ${className || ''}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue || '')}>
        <SelectTrigger className="h-11 w-full bg-background"><SelectValue>{display}</SelectValue></SelectTrigger>
        <SelectContent>{items.map(([itemValue, itemLabel]) => <SelectItem key={itemValue} value={itemValue}>{itemLabel}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  )
}

function FactoryToggle({ factories, activeFactoryId }: { factories: MaterialReceivingFactory[]; activeFactoryId: string | null }) {
  if (factories.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground shadow-sm">
        В справочнике нет заводов для переключателя Берегово / Ужгород.
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm" aria-label="Выбор завода">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Factory className="h-4 w-4" /></div>
        <div>
          <div className="text-sm font-semibold text-foreground">Завод поставки</div>
          <div className="text-xs text-muted-foreground">Сводка рассчитывается отдельно для каждого завода</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {factories.map((factory) => {
          const active = factory.id === activeFactoryId
          return (
            <Link
              key={factory.id}
              href={`${ROUTES.SUPPLY_ORDERS}?view=summary&factory=${factory.id}`}
              aria-current={active ? 'page' : undefined}
              className={[
                'inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border bg-background text-primary hover:bg-muted',
              ].join(' ')}
            >
              {factory.name}
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function FactoryDeliveryEditor({
  aggregate,
  factory,
  suppliers,
}: {
  aggregate: SupplyOrderAggregate
  factory: SupplyOrderAggregateFactory
  suppliers: SupplierWithRelations[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>(() => makeInitialScheduleDrafts(factory))
  const [financeOpen, setFinanceOpen] = useState(false)
  const [financeDrafts, setFinanceDrafts] = useState<Record<string, FinanceDraft>>({})
  const itemKeys = useMemo(() => factory.items.map((item) => ({ table: item.table, id: item.id })), [factory.items])
  const deliveredGroups = useMemo(() => makeDeliveredScheduleGroups(factory), [factory])
  const plannedTotal = scheduleDrafts.reduce((sum, draft) => sum + parseQuantity(draft.quantity), 0)
  const remainingQuantity = Math.max(factory.quantity - factory.delivered_schedule_quantity, 0)
  const isClosed = factory.delivered_count === factory.item_count && factory.unscheduled_quantity <= 0
  const missingFinanceSuppliers = factory.items.some((item) => (
    (item.order_status === 'pending' || item.order_status === 'ordered')
    && !item.supplier_id
    && !item.delivery_schedules.some((schedule) => schedule.status === 'planned' && schedule.supplier_id)
  ))
  const hasPlannedSchedules = factory.items.some((item) => item.delivery_schedules.some((schedule) => schedule.status === 'planned'))
  const financeGroups = useMemo(() => makeFinanceGroups(factory), [factory])
  const financePayments = makeFinancePayments(financeGroups, financeDrafts)
  const financeInvalid = financeOpen && (
    financeGroups.length === 0 ||
    financePayments.some((payment) => !payment.plannedDate || !Number.isFinite(payment.amount) || payment.amount <= 0)
  )

  useEffect(() => {
    setScheduleDrafts(makeInitialScheduleDrafts(factory))
  }, [factory])

  const markOrderedWithPayments = () => {
    const targetKeys = new Set(financePayments.flatMap((payment) => payment.itemKeys))
    const targetItemKeys = factory.items
      .filter((item) => targetKeys.has(`${item.table}:${item.id}`))
      .map((item) => ({ table: item.table, id: item.id }))
    if (targetItemKeys.length === 0) return
    startTransition(async () => {
      const result = await markOrderPlacedWithFinance(targetItemKeys, financePayments)
      if (!result.success) {
        toast.error(result.error || 'Не удалось отметить материал заказанным')
        return
      }
      toast.success('Плановые платежи созданы')
      setFinanceOpen(false)
      setFinanceDrafts({})
      router.refresh()
    })
  }

  const openFinance = () => {
    const defaults: Record<string, FinanceDraft> = {}
    for (const group of financeGroups) {
      defaults[group.key] = financeDrafts[group.key] || { amount: '', currency: 'EUR', plannedDate: group.plannedDate }
    }
    setFinanceDrafts(defaults)
    setFinanceOpen(true)
  }

  const saveSchedule = () => {
    const schedules: SupplyOrderAggregateScheduleInput[] = scheduleDrafts.map((draft) => ({
      delivery_date: draft.delivery_date,
      quantity: parseQuantity(draft.quantity),
      supplier_id: draft.supplier_id || null,
      piece_length_mm: aggregate.category === 'knives' ? parseQuantity(draft.piece_length_mm) : null,
      piece_count: aggregate.category === 'knives' ? parseQuantity(draft.piece_count) : null,
    }))

    startTransition(async () => {
      const result = await saveAggregateDeliverySchedule(itemKeys, schedules)
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить график поставки')
        return
      }
      toast.success('График поставки сохранен, материал отмечен как заказанный')
      router.refresh()
    })
  }

  const updateDraft = (index: number, patch: Partial<ScheduleDraft>) => {
    setScheduleDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index
        ? recalculateKnifeDraft({ ...draft, ...patch }, aggregate.category === 'knives')
        : draft
    )))
  }

  const addDraft = () => {
    setScheduleDrafts((current) => [
      ...current,
      {
        id: `new:${Date.now()}:${current.length}`,
        delivery_date: factory.supply_delivery_date || factory.production_date || todayIsoDate(),
        quantity: '',
        supplier_id: current[0]?.supplier_id || '',
        piece_length_mm: '',
        piece_count: '',
      },
    ])
  }

  const removeDraft = (index: number) => {
    setScheduleDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))
  }

  const clearSchedule = () => {
    if (!hasPlannedSchedules) return
    if (!window.confirm('Сбросить все плановые даты графика? Принятые поставки останутся заблокированными.')) return

    startTransition(async () => {
      const result = await clearAggregateDeliverySchedule(itemKeys)
      if (!result.success) {
        toast.error(result.error || 'Не удалось сбросить график поставки')
        return
      }
      toast.success('Плановые даты графика сброшены')
      router.refresh()
    })
  }

  const scheduleInvalid = scheduleDrafts.length === 0 ||
    scheduleDrafts.some((draft) => !draft.delivery_date || parseQuantity(draft.quantity) <= 0) ||
    scheduleDrafts.some((draft) => !draft.supplier_id) ||
    (aggregate.category === 'knives' && scheduleDrafts.some((draft) => (
      parseQuantity(draft.piece_length_mm) <= 0 ||
      !Number.isInteger(parseQuantity(draft.piece_count)) ||
      parseQuantity(draft.piece_count) <= 0
    )))
  const supplyPlanDateInfo = makeSupplyPlanDateInfo(factory)

  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-card px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Поставка на завод</div>
            <div className="truncate font-semibold text-foreground">{factory.factory_name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {formatAmount(factory.quantity)} {aggregate.unit} · {factory.machine_count} маш. · поставщики: {supplierSummary(factory)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {factory.pending_count > 0 && <Badge variant="secondary">{factory.pending_count} не зак.</Badge>}
          {factory.ordered_count > 0 && <Badge>{factory.ordered_count} зак.</Badge>}
          {factory.delivered_count > 0 && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{factory.delivered_count} принято</Badge>}
        </div>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoBox label="Мат.план" value={factory.production_date ? formatDate(factory.production_date) : 'Нет даты'} />
        <InfoBox
          label="Мат.план снабжения"
          value={supplyPlanDateInfo.value}
          hint={supplyPlanDateInfo.hint}
        />
        <InfoBox
          label="График поставки"
          value={factory.has_delivery_schedules ? `${factory.delivery_schedule_count} дат` : 'Не разбит'}
          hint={`${formatAmount(factory.planned_schedule_quantity)} план / ${formatAmount(factory.delivered_schedule_quantity)} факт`}
        />
        <InfoBox
          label="Остаток без графика"
          value={`${formatAmount(factory.unscheduled_quantity)} ${aggregate.unit}`}
          hint={formatWeightForQuantity(factory.unscheduled_quantity, factory)}
        />
      </div>

      {deliveredGroups.length > 0 && (
        <div className="mx-3 mb-3 rounded-xl border border-[#DCFCE7] bg-[#F0FDF4] p-3 text-xs text-[#166534]">
          <div className="font-semibold">Принято на склад</div>
          <div className="mt-1 space-y-1">
            {deliveredGroups.map((group) => (
              <div key={group.key} className="flex flex-wrap justify-between gap-2">
                <span>{formatDate(group.delivery_date)}{group.supplier_name ? ` · ${group.supplier_name}` : ''}</span>
                <span className="font-medium tabular-nums">{formatAmount(group.received_quantity || group.quantity)} {aggregate.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/60 bg-card px-3 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <PackageCheck className="h-4 w-4 text-primary" />
          <span className={isClosed ? 'font-semibold text-emerald-700' : undefined}>
            {isClosed
              ? 'Поставка закрыта'
              : factory.unscheduled_quantity > 0
                ? `${formatAmount(factory.unscheduled_quantity)} ${aggregate.unit} без даты поступления · прежний Мат.план ${factory.production_date ? formatDate(factory.production_date) : 'не указан'}`
                : 'Весь объем распределен по графику'}
          </span>
        </div>
        {!isClosed && <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending || financeGroups.length === 0 || missingFinanceSuppliers}
            onClick={openFinance}
            title={missingFinanceSuppliers ? 'Для платежа поставщик должен быть назначен в позиции' : undefined}
          >
            <CreditCard className="h-3.5 w-3.5" />
            С платежом
          </Button>
          {hasPlannedSchedules && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={clearSchedule}
            >
              Сбросить даты
            </Button>
          )}
        </div>}
      </div>

      {financeOpen && (
        <div className="mt-3 rounded-md border border-[#E8ECF0] bg-white p-3">
          <div className="mb-2 text-sm font-semibold text-[#1B3A6B]">Плановые платежи</div>
          {financeGroups.length === 0 ? (
            <div className="text-sm text-[#DC2626]">Нет позиций с назначенным поставщиком для платежа.</div>
          ) : (
            <div className="space-y-2">
              {financeGroups.map((group) => {
                const draft = financeDrafts[group.key] || { amount: '', currency: 'EUR' as const, plannedDate: group.plannedDate }
                return (
                  <div key={group.key} className="grid gap-2 rounded-md border border-[#E8ECF0] p-2 md:grid-cols-[1fr_120px_96px_140px] md:items-center">
                    <div className="text-sm">
                      <div className="font-medium text-[#1B3A6B]">{group.supplierName}</div>
                      <div className="text-xs text-[#6B7280]">{group.itemKeys.length} поз. · {formatDate(group.plannedDate)}</div>
                    </div>
                    <input
                      value={draft.amount}
                      disabled={isPending}
                      onChange={(event) => setFinanceDrafts((prev) => ({ ...prev, [group.key]: { ...draft, amount: event.target.value } }))}
                      placeholder="Сумма"
                      className="h-9 rounded-md border border-[#E8ECF0] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <select
                      value={draft.currency}
                      disabled={isPending}
                      onChange={(event) => setFinanceDrafts((prev) => ({ ...prev, [group.key]: { ...draft, currency: event.target.value as 'UAH' | 'EUR' } }))}
                      className="h-9 rounded-md border border-[#E8ECF0] bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="EUR">EUR</option>
                      <option value="UAH">UAH</option>
                    </select>
                    <input
                      type="date"
                      value={draft.plannedDate}
                      disabled={isPending}
                      onChange={(event) => setFinanceDrafts((prev) => ({ ...prev, [group.key]: { ...draft, plannedDate: event.target.value } }))}
                      className="h-9 rounded-md border border-[#E8ECF0] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={isPending || financeInvalid}
              onClick={markOrderedWithPayments}
            >
              Подтвердить заказ и платежи
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => setFinanceOpen(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      {!isClosed && (
        <div className="mt-3 rounded-md border border-[#E8ECF0] bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[#1B3A6B]">График поставки</div>
              <div className="text-xs text-[#64748B]">
                План {formatAmount(plannedTotal)} из {formatAmount(remainingQuantity)} {aggregate.unit}
                {factory.weight_kg !== null && ` · ${formatWeightForQuantity(plannedTotal, factory)}`}
              </div>
              <div className="text-xs text-[#64748B]">Сохранение графика сразу отмечает материал как заказанный.</div>
            </div>
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={addDraft}>
              <Plus className="h-3.5 w-3.5" />
              Добавить дату
            </Button>
          </div>

          <div className="space-y-2">
            {scheduleDrafts.map((draft, index) => {
              const quantity = parseQuantity(draft.quantity)
              return (
                <div key={draft.id} className={`grid min-w-0 gap-3 rounded-xl border border-[#E8ECF0] bg-[#F8F9FA] p-3 ${aggregate.category === 'knives' ? 'md:grid-cols-[minmax(180px,1.3fr)_150px_120px_150px_160px_auto]' : 'md:grid-cols-[minmax(200px,1fr)_160px_160px_auto]'} md:items-end`}>
                  <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                    Поставщик
                    <select
                      value={draft.supplier_id}
                      disabled={isPending}
                      onChange={(event) => updateDraft(index, { supplier_id: event.target.value })}
                      className="h-9 min-w-0 w-full max-w-full truncate rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">Выберите поставщика</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                      ))}
                    </select>
                  </label>
                  {aggregate.category === 'knives' ? (
                    <>
                      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                        Длина бруска, мм
                        <input value={draft.piece_length_mm} disabled={isPending} inputMode="decimal" onChange={(event) => updateDraft(index, { piece_length_mm: event.target.value })} className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:opacity-50" />
                      </label>
                      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                        Брусков, шт
                        <input value={draft.piece_count} disabled={isPending} inputMode="numeric" onChange={(event) => updateDraft(index, { piece_count: event.target.value })} className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:opacity-50" />
                      </label>
                      <div className="grid gap-1 text-xs font-medium text-[#475569]">
                        Общая длина
                        <div className="flex h-9 items-center rounded-md border border-[#E8ECF0] bg-white px-2 text-sm font-semibold tabular-nums text-[#1B3A6B]">{formatAmount(quantity)} мм</div>
                      </div>
                    </>
                  ) : (
                    <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                      Количество, {aggregate.unit}
                      <input value={draft.quantity} disabled={isPending} inputMode="decimal" onChange={(event) => updateDraft(index, { quantity: event.target.value })} className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:opacity-50" />
                    </label>
                  )}
                  <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                    Дата поступления
                    <input type="date" value={draft.delivery_date} disabled={isPending} onChange={(event) => updateDraft(index, { delivery_date: event.target.value })} className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:opacity-50" />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="justify-self-start md:justify-self-end"
                    disabled={isPending || scheduleDrafts.length <= 1}
                    onClick={() => removeDraft(index)}
                    aria-label="Удалить дату поставки"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )
            })}
          </div>

          {plannedTotal > remainingQuantity + 0.000001 && (
            <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Сверх потребности: {formatAmount(plannedTotal - remainingQuantity)} {aggregate.unit}. После приемки CRM сначала закроет ближайшие потребности по Мат.план, а свободный излишек оставит на складе.
            </div>
          )}
          {scheduleDrafts.some((draft) => !draft.supplier_id) && (
            <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-[#B45309]">
              Выберите поставщика для каждой даты поступления.
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending || scheduleInvalid} onClick={saveSchedule}>
              Сохранить график и отметить заказано
            </Button>
            {hasPlannedSchedules && (
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={clearSchedule}>
                Сбросить плановые даты
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function MachineItems({ factory, id }: { factory: SupplyOrderAggregateFactory; id: string }) {
  return (
    <div id={id} className="border-t border-border/60 bg-muted/25 p-4">
      <div className="hidden grid-cols-[minmax(200px,1fr)_120px_130px_170px_minmax(220px,1fr)_110px] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:grid">
        <span>Машина</span>
        <span>Количество</span>
        <span>Статус</span>
        <span>Остаток графика</span>
        <span>Поставки</span>
        <span>Заявка</span>
      </div>
      <div className="mt-2 hidden space-y-2 xl:block">
        {factory.items.map((item) => (
          <div key={`${item.table}:${item.id}`} className="grid grid-cols-[minmax(200px,1fr)_120px_130px_170px_minmax(220px,1fr)_110px] items-center gap-3 rounded-xl border border-border/60 bg-background px-3 py-2.5 text-sm">
            <Link href={`${ROUTES.SALES_PLAN}/${item.machine_id}`} className="font-medium text-primary hover:underline">
              {item.machine_name}
            </Link>
            <span className="tabular-nums text-foreground">{formatAmount(item.quantity)} {item.unit}</span>
            <Badge variant={item.order_status === 'ordered' ? 'default' : 'secondary'} className={item.order_status === 'delivered' ? 'w-fit border-emerald-200 bg-emerald-50 text-emerald-700' : 'w-fit'}>
              {ORDER_STATUS_LABELS[item.order_status]}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatAmount(item.planned_schedule_quantity)} план / {formatAmount(item.delivered_schedule_quantity)} факт
            </span>
            <span className="text-xs text-muted-foreground">
              {item.delivery_schedules.length > 0
                ? item.delivery_schedules.map((schedule) => `${formatDate(schedule.delivery_date)}: ${formatAmount(schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity)} ${schedule.unit}`).join('; ')
                : (item.supply_delivery_date ? formatDate(item.supply_delivery_date) : 'По Мат.план')}
            </span>
            <Link
              href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`}
              className="inline-flex min-h-9 w-fit items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-primary hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть
            </Link>
          </div>
        ))}
      </div>
      <div className="grid gap-3 xl:hidden">
        {factory.items.map((item) => (
          <article key={`${item.table}:${item.id}`} className="rounded-xl border border-border/70 bg-background p-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={`${ROUTES.SALES_PLAN}/${item.machine_id}`} className="font-semibold text-primary hover:underline">{item.machine_name}</Link>
              <Badge variant={item.order_status === 'ordered' ? 'default' : 'secondary'} className={item.order_status === 'delivered' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : undefined}>{ORDER_STATUS_LABELS[item.order_status]}</Badge>
            </div>
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Количество</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{formatAmount(item.quantity)} {item.unit}</dd></div>
              <div><dt className="text-muted-foreground">График</dt><dd className="mt-1 text-foreground">{formatAmount(item.planned_schedule_quantity)} план / {formatAmount(item.delivered_schedule_quantity)} факт</dd></div>
              <div><dt className="text-muted-foreground">Поставки</dt><dd className="mt-1 text-foreground">{item.delivery_schedules.length > 0 ? item.delivery_schedules.map((schedule) => `${formatDate(schedule.delivery_date)}: ${formatAmount(schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity)} ${schedule.unit}`).join('; ') : (item.supply_delivery_date ? formatDate(item.supply_delivery_date) : 'По Мат.план')}</dd></div>
            </dl>
            <Link href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`} className="mt-3 inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-primary hover:bg-muted">
              <ExternalLink className="h-3.5 w-3.5" />Открыть заявку
            </Link>
          </article>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function InfoBox({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3 text-xs text-muted-foreground">
      <div className="font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function makeSupplyPlanDateInfo(factory: SupplyOrderAggregateFactory) {
  const hasAnySchedule = factory.items.some((item) => item.delivery_schedules.length > 0)
  const scheduledDates = uniqueSortedDates(factory.items.flatMap((item) => (
    item.delivery_schedules
      .filter((schedule) => schedule.status === 'planned')
      .map((schedule) => schedule.delivery_date)
  )))
  const fallbackDates = hasAnySchedule ? [] : uniqueSortedDates(factory.items.map((item) => item.supply_delivery_date))
  const dates = scheduledDates.length > 0 ? scheduledDates : fallbackDates

  if (dates.length === 0) {
    return { value: 'Не указано', hint: null }
  }

  if (dates.length === 1) {
    const [date] = dates
    return {
      value: formatDate(date),
      hint: scheduledDates.length > 0
        ? 'Из графика поставки'
        : factory.production_date === date
          ? 'По Мат.план производства'
          : 'Указано снабжением',
    }
  }

  return {
    value: dateCountLabel(dates.length),
    hint: dates.map(formatDate).join('; '),
  }
}

function uniqueSortedDates(dates: Array<string | null | undefined>) {
  return Array.from(new Set(dates.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))
}

function dateCountLabel(count: number) {
  const remainder10 = count % 10
  const remainder100 = count % 100
  const word = remainder10 === 1 && remainder100 !== 11
    ? 'дата'
    : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
      ? 'даты'
      : 'дат'
  return `${count} ${word}`
}

function makeInitialScheduleDrafts(factory: SupplyOrderAggregateFactory): ScheduleDraft[] {
  const plannedGroups = new Map<string, ScheduleGroup>()
  for (const item of factory.items) {
    for (const schedule of item.delivery_schedules) {
      if (schedule.status !== 'planned') continue
      const key = `${schedule.delivery_date}:${schedule.supplier_id || 'none'}:${schedule.received_piece_length_mm || 'bulk'}`
      const current = plannedGroups.get(key) || {
        key,
        delivery_date: schedule.delivery_date,
        supplier_id: schedule.supplier_id,
        supplier_name: schedule.supplier_name,
        quantity: 0,
        received_quantity: 0,
        piece_length_mm: schedule.received_piece_length_mm,
        piece_count: schedule.received_piece_count,
      }
      current.quantity += Number(schedule.quantity || 0)
      plannedGroups.set(key, current)
    }
  }

  const existing = Array.from(plannedGroups.values())
    .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
    .map((group) => ({
      id: group.key,
      delivery_date: group.delivery_date,
      quantity: String(roundDisplay(group.quantity)),
      supplier_id: group.supplier_id || '',
      piece_length_mm: group.piece_length_mm ? String(roundDisplay(group.piece_length_mm)) : '',
      piece_count: group.piece_count ? String(roundDisplay(group.piece_count)) : '',
    }))

  if (existing.length > 0) return existing

  const remaining = Math.max(factory.quantity - factory.delivered_schedule_quantity, 0)
  const supplierIds = Array.from(new Set(factory.items.map((item) => item.supplier_id).filter(Boolean))) as string[]
  return [{
    id: 'initial',
    delivery_date: factory.supply_delivery_date || factory.production_date || todayIsoDate(),
    quantity: remaining > 0 ? String(roundDisplay(remaining)) : '',
    supplier_id: supplierIds.length === 1 ? supplierIds[0] : '',
    piece_length_mm: '',
    piece_count: '',
  }]
}

function makeDeliveredScheduleGroups(factory: SupplyOrderAggregateFactory) {
  const groups = new Map<string, ScheduleGroup>()
  for (const item of factory.items) {
    for (const schedule of item.delivery_schedules) {
      if (schedule.status !== 'delivered') continue
      const key = `${schedule.delivery_date}:${schedule.supplier_id || 'none'}`
      const current = groups.get(key) || {
        key,
        delivery_date: schedule.delivery_date,
        supplier_id: schedule.supplier_id,
        supplier_name: schedule.supplier_name,
        quantity: 0,
        received_quantity: 0,
        piece_length_mm: schedule.received_piece_length_mm,
        piece_count: schedule.received_piece_count,
      }
      current.quantity += Number(schedule.quantity || 0)
      current.received_quantity += Number(schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity ?? 0)
      groups.set(key, current)
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
}

function makeFinanceGroups(factory: SupplyOrderAggregateFactory) {
  const groups = new Map<string, {
    key: string
    supplierId: string
    supplierName: string
    plannedDate: string
    itemKeys: string[]
    items: SupplyOrderAggregateSourceItem[]
  }>()

  for (const item of factory.items) {
    if (item.order_status !== 'pending' && item.order_status !== 'ordered') continue
    const scheduledSuppliers = item.delivery_schedules.filter((schedule) => (
      schedule.status === 'planned' && schedule.supplier_id
    ))
    const financeSources = scheduledSuppliers.length > 0
      ? scheduledSuppliers.map((schedule) => ({
        supplierId: schedule.supplier_id as string,
        supplierName: schedule.supplier_name || 'Поставщик',
        plannedDate: schedule.delivery_date,
      }))
      : item.supplier_id
        ? [{
          supplierId: item.supplier_id,
          supplierName: item.supplier_name || 'Поставщик',
          plannedDate: item.supply_delivery_date || factory.supply_delivery_date || factory.production_date || todayIsoDate(),
        }]
        : []

    for (const source of financeSources) {
      const key = `${source.supplierId}:${source.plannedDate}`
      const current = groups.get(key) || {
        key,
        supplierId: source.supplierId,
        supplierName: source.supplierName,
        plannedDate: source.plannedDate,
        itemKeys: [],
        items: [],
      }
      const itemKey = `${item.table}:${item.id}`
      if (!current.itemKeys.includes(itemKey)) current.itemKeys.push(itemKey)
      if (!current.items.some((row) => row.table === item.table && row.id === item.id)) current.items.push(item)
      groups.set(key, current)
    }
  }

  return Array.from(groups.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'ru'))
}

function makeFinancePayments(
  groups: ReturnType<typeof makeFinanceGroups>,
  drafts: Record<string, FinanceDraft>
): SupplyFinancePaymentInput[] {
  return groups.map((group) => {
    const draft = drafts[group.key]
    return {
      supplierId: group.supplierId,
      plannedDate: draft?.plannedDate || group.plannedDate,
      amount: parseQuantity(draft?.amount || ''),
      currency: draft?.currency || 'EUR',
      itemKeys: group.itemKeys,
    }
  })
}

function supplierSummary(factory: SupplyOrderAggregateFactory) {
  const suppliers = new Map<string, { name: string; count: number }>()
  let missingCount = 0

  for (const item of factory.items) {
    const scheduleSuppliers = new Map(item.delivery_schedules
      .filter((schedule) => schedule.supplier_id)
      .map((schedule) => [schedule.supplier_id as string, schedule.supplier_name || 'Поставщик']))

    if (item.supplier_id) {
      suppliers.set(item.supplier_id, {
        name: item.supplier_name || 'Поставщик',
        count: (suppliers.get(item.supplier_id)?.count || 0) + 1,
      })
    } else if (scheduleSuppliers.size > 0) {
      for (const [supplierId, supplierName] of scheduleSuppliers) {
        suppliers.set(supplierId, {
          name: supplierName,
          count: (suppliers.get(supplierId)?.count || 0) + 1,
        })
      }
    } else {
      missingCount += 1
    }
  }

  const parts = Array.from(suppliers.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    .map((supplier) => `${supplier.name} (${supplier.count})`)
  if (missingCount > 0) parts.push(`Без поставщика (${missingCount})`)
  return parts.length > 0 ? parts.join(', ') : 'нет'
}

function parseQuantity(value: string) {
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function recalculateKnifeDraft(draft: ScheduleDraft, isKnife: boolean) {
  if (!isKnife) return draft
  const total = parseQuantity(draft.piece_length_mm) * parseQuantity(draft.piece_count)
  return { ...draft, quantity: total > 0 ? String(roundDisplay(total)) : '' }
}

function roundDisplay(value: number) {
  return Math.round(value * 1000) / 1000
}

function formatWeightForQuantity(quantity: number, factory: SupplyOrderAggregateFactory) {
  if (!factory.weight_kg || factory.quantity <= 0 || quantity <= 0) return null
  return `${formatAmount((factory.weight_kg * quantity) / factory.quantity)} кг`
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}
