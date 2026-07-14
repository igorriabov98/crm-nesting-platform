'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Boxes,
  CalendarDays,
  Check,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Factory,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Save,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import {
  clearAggregateDeliverySchedule,
  markOrderPlaced,
  markOrderPlacedWithFinance,
  saveAggregateDeliverySchedule,
  updateAggregateSupplyDeliveryDate,
  type MaterialReceivingFactory,
  type SupplyFinancePaymentInput,
  type SupplyOrderPlacementInput,
  type SupplyOrderAggregate,
  type SupplyOrderAggregateFactory,
  type SupplyOrderAggregateScheduleInput,
  type SupplyOrderAggregateSourceItem,
} from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import {
  filterAndSortAggregates,
  groupSupplyOrderAggregates,
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
}

type ScheduleGroup = {
  key: string
  delivery_date: string
  supplier_id: string | null
  supplier_name: string | null
  quantity: number
  received_quantity: number
}

type FinanceDraft = {
  amount: string
  currency: 'UAH' | 'EUR'
  plannedDate: string
}

type OrderPlacementDraft = SupplyOrderPlacementInput

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

  const grouped = useMemo(() => {
    return groupSupplyOrderAggregates(visibleAggregates, filters.sort)
  }, [filters.sort, visibleAggregates])

  const totals = useMemo(() => ({
    aggregateCount: visibleAggregates.length,
    itemCount: visibleAggregates.reduce((sum, aggregate) => sum + aggregate.item_count, 0),
    pendingCount: visibleAggregates.reduce((sum, aggregate) => sum + aggregate.pending_count, 0),
    orderedCount: visibleAggregates.reduce((sum, aggregate) => sum + aggregate.ordered_count, 0),
    plannedQuantity: visibleAggregates.reduce((sum, aggregate) => sum + aggregate.planned_schedule_quantity, 0),
    deliveredQuantity: visibleAggregates.reduce((sum, aggregate) => sum + aggregate.delivered_schedule_quantity, 0),
    remainingQuantity: visibleAggregates.reduce((sum, aggregate) => sum + aggregate.unscheduled_quantity, 0),
  }), [visibleAggregates])

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
            ? 'Нет позиций со статусом «Не заказано» или «Заказано» для выбранного завода.'
            : 'По выбранным фильтрам материалы не найдены.'}
          {aggregates.length > 0 && (
            <div><Button type="button" variant="outline" className="mt-4" onClick={() => setFilters(defaultFilters)}>Сбросить фильтры</Button></div>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Материалов/дней" value={totals.aggregateCount} />
            <Metric label="Позиций заявок" value={totals.itemCount} />
            <Metric label="Статусы" value={`${totals.pendingCount} / ${totals.orderedCount}`} hint="не заказано / заказано" />
            <Metric
              label="График"
              value={`${formatAmount(totals.plannedQuantity)} / ${formatAmount(totals.deliveredQuantity)}`}
              hint={`план / факт, остаток ${formatAmount(totals.remainingQuantity)}`}
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
                  {group.rows.map((aggregate) => {
                    const isExpanded = expanded.has(aggregate.id)
                    const factory = aggregate.factories[0]
                    return (
                      <article key={aggregate.id} className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm transition-shadow hover:shadow-md motion-reduce:transition-none">
                        <div className="grid gap-4 p-4 text-sm md:grid-cols-[44px_minmax(220px,1fr)_150px] xl:grid-cols-[44px_minmax(250px,1fr)_150px_minmax(460px,1.7fr)_100px]">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-primary"
                            aria-label={isExpanded ? 'Скрыть машины' : 'Показать машины'}
                            aria-expanded={isExpanded}
                            onClick={() => toggle(aggregate.id)}
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </Button>

                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-semibold text-foreground">{aggregate.item_name}</div>
                              <Badge variant="outline" className="border-border bg-background text-muted-foreground">
                                {MATERIAL_CATEGORY_LABELS[aggregate.category]}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                              {aggregate.characteristics.map((part) => (
                                <span key={`${part.label}:${part.value}`} className="rounded-lg bg-muted/60 px-2 py-1">
                                  <span className="font-medium text-foreground">{part.label}:</span> {part.value}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-xl border border-border/60 bg-muted/25 p-3 font-medium text-foreground tabular-nums md:col-start-3 xl:col-start-auto">
                            <div className="text-xs font-normal text-muted-foreground">Итого</div>
                            <div className="mt-1 text-lg font-semibold">{formatAmount(aggregate.quantity)} {aggregate.unit}</div>
                            {aggregate.weight_kg !== null && (
                              <div className="text-xs font-normal text-[#64748B]">{formatAmount(aggregate.weight_kg)} кг</div>
                            )}
                            <div className="text-xs font-normal text-[#64748B]">{aggregate.item_count} строк</div>
                          </div>

                          <div className="md:col-span-3 xl:col-span-1">
                          {factory ? (
                            <FactoryDeliveryEditor aggregate={aggregate} factory={factory} suppliers={suppliers} />
                          ) : (
                            <div className="rounded-lg border border-[#E8ECF0] bg-[#FBFCFE] p-3 text-sm text-[#64748B]">
                              Нет заводской строки для выбранного фильтра.
                            </div>
                          )}
                          </div>

                          <div className="flex items-center justify-between rounded-xl bg-primary/5 px-3 py-2 text-sm font-medium text-primary md:col-span-3 xl:col-span-1 xl:flex-col xl:justify-center">
                            <span className="text-xs text-muted-foreground">Машины</span>
                            <span className="text-lg font-semibold tabular-nums">{aggregate.machine_count}</span>
                          </div>
                        </div>

                        {isExpanded && factory && (
                          <MachineItems factory={factory} />
                        )}
                      </article>
                    )
                  })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

const aggregateStatusLabels: Record<SupplyOrderAggregateStatusFilter, string> = {
  all: 'Все статусы',
  pending: 'Есть незаказанные',
  ordered: 'Есть заказанные',
}

const aggregateSortLabels: Record<SupplyOrderAggregateSort, string> = {
  date_asc: 'Мат.план: сначала ранние',
  date_desc: 'Мат.план: сначала поздние',
  material_asc: 'Материал: А–Я',
  quantity_desc: 'Количество: по убыванию',
  remaining_desc: 'Без графика: по убыванию',
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
  const [dateValue, setDateValue] = useState(factory.has_mixed_supply_delivery_dates ? '' : factory.supply_delivery_date || '')
  const [splitOpen, setSplitOpen] = useState(false)
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>(() => makeInitialScheduleDrafts(factory))
  const [financeOpen, setFinanceOpen] = useState(false)
  const [financeDrafts, setFinanceDrafts] = useState<Record<string, FinanceDraft>>({})
  const [orderPlacementOpen, setOrderPlacementOpen] = useState(false)
  const [orderPlacementDraft, setOrderPlacementDraft] = useState<OrderPlacementDraft>(() => makeInitialOrderPlacementDraft(factory))
  const itemKeys = useMemo(() => factory.items.map((item) => ({ table: item.table, id: item.id })), [factory.items])
  const pendingItemKeys = useMemo(() => factory.items
    .filter((item) => item.order_status === 'pending')
    .map((item) => ({ table: item.table, id: item.id })), [factory.items])
  const orderPlacementItemKeys = useMemo(() => factory.items
    .filter((item) => item.order_status === 'pending' || (
      item.order_status === 'ordered' && (!item.supplier_id || !item.supply_delivery_date)
    ))
    .map((item) => ({ table: item.table, id: item.id })), [factory.items])
  const initialDate = factory.has_mixed_supply_delivery_dates ? '' : factory.supply_delivery_date || ''
  const deliveredGroups = useMemo(() => makeDeliveredScheduleGroups(factory), [factory])
  const plannedTotal = scheduleDrafts.reduce((sum, draft) => sum + parseQuantity(draft.quantity), 0)
  const remainingQuantity = Math.max(factory.quantity - factory.delivered_schedule_quantity, 0)
  const canSaveDate = factory.has_mixed_supply_delivery_dates
    ? Boolean(dateValue)
    : dateValue !== initialDate
  const missingFinanceSuppliers = factory.items.some((item) => item.order_status === 'pending' && !item.supplier_id)
  const missingScheduleSuppliers = factory.items.some((item) => !item.supplier_id)
  const hasPlannedSchedules = factory.items.some((item) => item.delivery_schedules.some((schedule) => schedule.status === 'planned'))
  const financeGroups = useMemo(() => makeFinanceGroups(factory), [factory])
  const financePayments = makeFinancePayments(financeGroups, financeDrafts)
  const financeInvalid = financeOpen && (
    financeGroups.length === 0 ||
    financePayments.some((payment) => !payment.plannedDate || !Number.isFinite(payment.amount) || payment.amount <= 0)
  )
  const orderPlacementInvalid = !orderPlacementDraft.supplierId || !orderPlacementDraft.supplyDeliveryDate

  useEffect(() => {
    setDateValue(initialDate)
  }, [initialDate])

  useEffect(() => {
    setScheduleDrafts(makeInitialScheduleDrafts(factory))
  }, [factory])

  useEffect(() => {
    if (!orderPlacementOpen) {
      setOrderPlacementDraft(makeInitialOrderPlacementDraft(factory))
    }
  }, [factory, orderPlacementOpen])

  const saveDate = (nextDate: string | null) => {
    startTransition(async () => {
      const result = await updateAggregateSupplyDeliveryDate(itemKeys, nextDate)
      if (!result.success) {
        toast.error(result.error || 'Не удалось обновить дату снабжения')
        return
      }
      toast.success('Дата снабжения обновлена')
      router.refresh()
    })
  }

  const markOrdered = (withFinance: boolean, placement?: SupplyOrderPlacementInput) => {
    const targetItemKeys = placement ? orderPlacementItemKeys : pendingItemKeys
    if (targetItemKeys.length === 0) return
    startTransition(async () => {
      const result = withFinance
        ? await markOrderPlacedWithFinance(pendingItemKeys, financePayments)
        : await markOrderPlaced(targetItemKeys, placement)
      if (!result.success) {
        toast.error(result.error || 'Не удалось отметить материал заказанным')
        return
      }
      toast.success(withFinance ? 'Материал заказан, платежи созданы' : 'Материал отмечен как заказанный')
      setOrderPlacementOpen(false)
      setFinanceOpen(false)
      setFinanceDrafts({})
      router.refresh()
    })
  }

  const openOrderPlacement = () => {
    if (orderPlacementItemKeys.length === 0) return
    setOrderPlacementDraft(makeInitialOrderPlacementDraft(factory))
    setOrderPlacementOpen(true)
  }

  const submitOrderPlacement = () => {
    if (orderPlacementInvalid) return
    markOrdered(false, orderPlacementDraft)
  }

  const openFinance = () => {
    const defaults: Record<string, FinanceDraft> = {}
    for (const group of financeGroups) {
      defaults[group.key] = financeDrafts[group.key] || { amount: '', currency: 'EUR', plannedDate: group.plannedDate }
    }
    setFinanceDrafts(defaults)
    setFinanceOpen(true)
  }

  const openSplit = () => {
    setScheduleDrafts(makeInitialScheduleDrafts(factory))
    setSplitOpen(true)
  }

  const saveSchedule = () => {
    const schedules: SupplyOrderAggregateScheduleInput[] = scheduleDrafts.map((draft) => ({
      delivery_date: draft.delivery_date,
      quantity: parseQuantity(draft.quantity),
      supplier_id: draft.supplier_id || null,
    }))

    startTransition(async () => {
      const result = await saveAggregateDeliverySchedule(itemKeys, schedules)
      if (!result.success) {
        toast.error(result.error || 'Не удалось сохранить график поставки')
        return
      }
      toast.success('График поставки сохранен, материал отмечен как заказанный')
      setSplitOpen(false)
      router.refresh()
    })
  }

  const updateDraft = (index: number, patch: Partial<ScheduleDraft>) => {
    setScheduleDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index ? { ...draft, ...patch } : draft
    )))
  }

  const addDraft = () => {
    setScheduleDrafts((current) => [
      ...current,
      {
        id: `new:${Date.now()}:${current.length}`,
        delivery_date: factory.supply_delivery_date || factory.production_date || todayIsoDate(),
        quantity: '',
        supplier_id: '',
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
      setSplitOpen(false)
      router.refresh()
    })
  }

  const scheduleInvalid = scheduleDrafts.length === 0 ||
    scheduleDrafts.some((draft) => !draft.delivery_date || parseQuantity(draft.quantity) <= 0) ||
    (missingScheduleSuppliers && scheduleDrafts.some((draft) => !draft.supplier_id)) ||
    plannedTotal > remainingQuantity + 0.000001
  const supplyPlanDateInfo = makeSupplyPlanDateInfo(factory)

  return (
    <div className="rounded-lg border border-[#E8ECF0] bg-[#FBFCFE] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 font-semibold text-[#1B3A6B]">
          <Factory className="h-4 w-4 shrink-0" />
          <span className="truncate">{factory.factory_name}</span>
        </div>
        <div className="flex gap-1">
          {factory.pending_count > 0 && <Badge variant="secondary">{factory.pending_count} не зак.</Badge>}
          {factory.ordered_count > 0 && <Badge>{factory.ordered_count} зак.</Badge>}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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

      {!factory.has_delivery_schedules && (
        <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
          <label className="grid gap-1 text-xs font-medium text-[#475569]">
            Мат.план снабжения
            <input
              type="date"
              value={dateValue}
              disabled={isPending}
              onChange={(event) => setDateValue(event.target.value)}
              className="h-9 rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-50"
            />
            {factory.has_mixed_supply_delivery_dates && (
              <span className="text-[11px] font-normal text-[#D97706]">Сейчас разные даты</span>
            )}
          </label>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || !canSaveDate}
              onClick={() => saveDate(dateValue || null)}
              aria-label={`Сохранить мат.план снабжения для ${factory.factory_name}`}
            >
              <Save className="h-3.5 w-3.5" />
              Сохранить
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isPending}
              onClick={() => saveDate(null)}
              aria-label={`Сбросить мат.план снабжения для ${factory.factory_name}`}
              title="Сбросить к Мат.план производства"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {factory.has_delivery_schedules && (
        <div className="mt-2 rounded-md border border-[#DBEAFE] bg-[#EFF6FF] px-2 py-1.5 text-xs text-[#1E40AF]">
          Мат.план снабжения управляется графиком split-поставок. Плановые строки можно заменить через «Разбить поставку».
        </div>
      )}

      {deliveredGroups.length > 0 && (
        <div className="mt-2 rounded-md border border-[#DCFCE7] bg-[#F0FDF4] p-2 text-xs text-[#166534]">
          <div className="font-semibold">Принятые поставки заблокированы</div>
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

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[#64748B] tabular-nums">
          {formatAmount(factory.quantity)} {aggregate.unit} · {factory.machine_count} маш. · поставщики: {supplierSummary(factory)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || orderPlacementItemKeys.length === 0}
            onClick={openOrderPlacement}
          >
            <Check className="h-3.5 w-3.5" />
            Отметить заказано
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending || pendingItemKeys.length === 0 || missingFinanceSuppliers}
            onClick={openFinance}
            title={missingFinanceSuppliers ? 'Для платежа поставщик должен быть назначен в позиции' : undefined}
          >
            <CreditCard className="h-3.5 w-3.5" />
            С платежом
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || remainingQuantity <= 0}
            onClick={openSplit}
          >
            {factory.has_delivery_schedules ? 'Редактировать график' : 'Разбить поставку'}
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
        </div>
      </div>

      <Dialog open={orderPlacementOpen} onOpenChange={setOrderPlacementOpen}>
        <DialogContent className="bg-white text-[#111827] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-[#1B3A6B]">Отметить заказано</DialogTitle>
            <DialogDescription>
              Укажите поставщика и дату мат.плана снабжения для выбранных позиций.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submitOrderPlacement()
            }}
          >
            <label className="grid gap-1 text-sm font-medium text-[#475569]">
              Поставщик
              <select
                value={orderPlacementDraft.supplierId}
                disabled={isPending}
                onChange={(event) => setOrderPlacementDraft((current) => ({
                  ...current,
                  supplierId: event.target.value,
                }))}
                className="h-10 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#111827] outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Выберите поставщика</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-[#475569]">
              Мат.план снабжения
              <input
                type="date"
                value={orderPlacementDraft.supplyDeliveryDate}
                disabled={isPending}
                onChange={(event) => setOrderPlacementDraft((current) => ({
                  ...current,
                  supplyDeliveryDate: event.target.value,
                }))}
                className="h-10 rounded-md border border-[#CBD5E1] bg-white px-3 text-sm text-[#111827] outline-none focus-visible:border-[#1B3A6B] focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            {orderPlacementInvalid && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-[#B45309]">
                Укажите поставщика и мат.план снабжения.
              </div>
            )}
            <DialogFooter className="gap-2 bg-white">
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setOrderPlacementOpen(false)}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isPending || orderPlacementInvalid}>
                <Check className="h-3.5 w-3.5" />
                Подтвердить заказ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
              onClick={() => markOrdered(true)}
            >
              Подтвердить заказ и платежи
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => setFinanceOpen(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      {splitOpen && (
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
                <div key={draft.id} className="grid min-w-0 gap-3 rounded-md border border-[#E8ECF0] p-3 sm:grid-cols-2 sm:items-start">
                  <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                    Дата
                    <input
                      type="date"
                      value={draft.delivery_date}
                      disabled={isPending}
                      onChange={(event) => updateDraft(index, { delivery_date: event.target.value })}
                      className="h-9 w-full rounded-md border border-[#CBD5E1] px-2 text-sm text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                  <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                    Количество, {aggregate.unit}
                    <input
                      value={draft.quantity}
                      disabled={isPending}
                      inputMode="decimal"
                      onChange={(event) => updateDraft(index, { quantity: event.target.value })}
                      className="h-9 w-full rounded-md border border-[#CBD5E1] px-2 text-sm text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>
                  <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569] sm:col-span-2">
                    Поставщик для этой даты
                    <select
                      value={draft.supplier_id}
                      disabled={isPending}
                      onChange={(event) => updateDraft(index, { supplier_id: event.target.value })}
                      className="h-9 min-w-0 w-full max-w-full truncate rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">По позициям</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                      ))}
                    </select>
                    {quantity > 0 && (
                      <span className="text-[11px] font-normal text-[#64748B]">{formatWeightForQuantity(quantity, factory)}</span>
                    )}
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="justify-self-start sm:col-span-2 sm:justify-self-end"
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
            <div className="mt-2 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-[#DC2626]">
              Сумма графика превышает остаток после принятых поставок.
            </div>
          )}
          {missingScheduleSuppliers && scheduleDrafts.some((draft) => !draft.supplier_id) && (
            <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-[#B45309]">
              Для строк «По позициям» у всех позиций должен быть поставщик. Укажите поставщика в строке графика или в позиции.
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
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => setSplitOpen(false)}>
              Отмена
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function MachineItems({ factory }: { factory: SupplyOrderAggregateFactory }) {
  return (
    <div className="border-t border-border/60 bg-muted/25 p-4">
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
            <Badge variant={item.order_status === 'ordered' ? 'default' : 'secondary'} className="w-fit">
              {ORDER_STATUS_LABELS[item.order_status]}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatAmount(item.planned_schedule_quantity)} план / {formatAmount(item.delivered_schedule_quantity)} факт
            </span>
            <span className="text-xs text-muted-foreground">
              {item.delivery_schedules.length > 0
                ? item.delivery_schedules.map((schedule) => `${formatDate(schedule.delivery_date)}: ${formatAmount(schedule.received_quantity ?? schedule.quantity)} ${schedule.unit}`).join('; ')
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
              <Badge variant={item.order_status === 'ordered' ? 'default' : 'secondary'}>{ORDER_STATUS_LABELS[item.order_status]}</Badge>
            </div>
            <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Количество</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{formatAmount(item.quantity)} {item.unit}</dd></div>
              <div><dt className="text-muted-foreground">График</dt><dd className="mt-1 text-foreground">{formatAmount(item.planned_schedule_quantity)} план / {formatAmount(item.delivered_schedule_quantity)} факт</dd></div>
              <div><dt className="text-muted-foreground">Поставки</dt><dd className="mt-1 text-foreground">{item.delivery_schedules.length > 0 ? item.delivery_schedules.map((schedule) => `${formatDate(schedule.delivery_date)}: ${formatAmount(schedule.received_quantity ?? schedule.quantity)} ${schedule.unit}`).join('; ') : (item.supply_delivery_date ? formatDate(item.supply_delivery_date) : 'По Мат.план')}</dd></div>
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
    <div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Boxes className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-foreground tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function InfoBox({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="rounded-md bg-white px-2 py-1.5 text-xs text-[#64748B]">
      <div className="font-medium text-[#475569]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[#111827]">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-[#64748B]">{hint}</div>}
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

function uniqueSortedValues(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b))
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

function makeInitialOrderPlacementDraft(factory: SupplyOrderAggregateFactory): OrderPlacementDraft {
  const supplierIds = uniqueSortedValues(factory.items
    .filter((item) => item.order_status === 'pending' || item.order_status === 'ordered')
    .map((item) => item.supplier_id))

  return {
    supplierId: supplierIds.length === 1 ? supplierIds[0] : '',
    supplyDeliveryDate: factory.supply_delivery_date || factory.production_date || todayIsoDate(),
  }
}

function makeInitialScheduleDrafts(factory: SupplyOrderAggregateFactory): ScheduleDraft[] {
  const plannedGroups = new Map<string, ScheduleGroup>()
  for (const item of factory.items) {
    for (const schedule of item.delivery_schedules) {
      if (schedule.status !== 'planned') continue
      const key = `${schedule.delivery_date}:${schedule.supplier_id || 'none'}`
      const current = plannedGroups.get(key) || {
        key,
        delivery_date: schedule.delivery_date,
        supplier_id: schedule.supplier_id,
        supplier_name: schedule.supplier_name,
        quantity: 0,
        received_quantity: 0,
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
    }))

  if (existing.length > 0) return existing

  const remaining = Math.max(factory.quantity - factory.delivered_schedule_quantity, 0)
  return [{
    id: 'initial',
    delivery_date: factory.supply_delivery_date || factory.production_date || todayIsoDate(),
    quantity: remaining > 0 ? String(roundDisplay(remaining)) : '',
    supplier_id: '',
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
      }
      current.quantity += Number(schedule.quantity || 0)
      current.received_quantity += Number(schedule.received_quantity ?? schedule.quantity ?? 0)
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
    if (item.order_status !== 'pending' || !item.supplier_id) continue
    const plannedDate = item.supply_delivery_date || factory.supply_delivery_date || factory.production_date || todayIsoDate()
    const key = `${item.supplier_id}:${plannedDate}`
    const current = groups.get(key) || {
      key,
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
