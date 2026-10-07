'use client'

import { supplierSupportsCategory } from '@/lib/suppliers/directory'

import Link from 'next/link'
import { createContext, useContext, useEffect, useMemo, useState, useTransition } from 'react'
import { useSupplySummaryPreferences } from './summary-preferences'
import { CompactSupplyOrderHeader, CompactSupplyOrderRow } from './CompactSupplyOrderRow'
import { redeliveryOriginLabel, redeliveryOriginOptionLabel } from './redelivery-origin-label'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarDays,
  CalendarX2,
  Check,
  ChevronDown,
  Cog,
  ExternalLink,
  PackageCheck,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  Trash2,
  Truck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { displayMaterialCategory } from '@/lib/materials/display-category'
import { ROUTES } from '@/lib/constants/routes'
import {
  assignSupplyScheduleReviewCase,
  clearAggregateDeliverySchedule,
  getSupplySchedulePayments,
  saveAggregateDeliverySchedule,
  type MaterialReceivingFactory,
  type PendingSupplyScheduleReviewCase,
  type SupplyFinancePaymentInput,
  type SupplySchedulePayment,
  type SupplyOrderAggregate,
  type SupplyOrderAggregateFactory,
  type SupplyOrderAggregateScheduleInput,
  type SupplyOrderAggregateSourceItem,
} from '@/lib/actions/supply-orders'
import {
  formatLongStockPurchaseComposition,
  mergeLongStockPurchasePlans,
  type LongStockPurchasePlan,
} from '@/lib/supply-orders/long-stock-purchase-plan'
import {
  deliveryScheduleScopeForDateSlice,
  type SupplyOrderDeliveryScheduleScope,
} from '@/lib/supply-orders/delivery-schedule-scope'
import {
  buildInitialSupplyOrderScheduleDrafts,
  type SupplyOrderScheduleDraft,
} from '@/lib/supply-orders/delivery-schedule-drafts'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { ReturnLongStockPositionButton } from './ReturnLongStockPositionButton'
import { CancelReturnedSupplyPositionDialog } from '@/components/features/requests/CancelReturnedSupplyPositionDialog'
import type { SupplyPositionTable } from '@/lib/supply-orders/position-revisions'
import { SupplyQuantitySummary } from './SupplyQuantitySummary'
import { SupplyDateOrderExportButton } from './SupplyDateOrderExportButton'
import { SupplyOrderFactoryToggle } from './SupplyOrderFactoryToggle'
import {
  filterAndSortAggregates,
  filterSupplyOrderDateSlices,
  getSupplyOrderItemOrderProgress,
  groupSupplyOrderAggregatesBySupplyDate,
  hasSupplyOrderRedelivery,
  isSupplyOrderBarMaterial,
  isSupplyOrderFactoryClosed,
  isCancelledReturnedSupplyOrderSource,
  isReturnedSupplyOrderSource,
  partitionSupplyOrderAggregatesByRedelivery,
  projectSupplyOrderDateSliceFactory,
  summarizeSupplyOrderItemSchedules,
  summarizeSupplyOrderQuantities,
  supplyOrderDateSliceItems,
  type AggregateFiltersState,
  type SupplyOrderAggregateSort,
  type SupplyOrderAggregateStatusFilter,
  type SupplyOrderDateSlice,
} from './supply-order-view'
import {
  deliveredSupplyQuantity,
  reservedSupplyQuantity,
  splitReceiptStock,
} from '@/lib/supply-orders/receiving-supply-progress'

type SupplyOrderSummaryPageProps = {
  aggregates: SupplyOrderAggregate[]
  factories: MaterialReceivingFactory[]
  activeFactoryId: string | null
  suppliers: SupplierWithRelations[]
  supplierError?: string | null
  pendingReviewCases: PendingSupplyScheduleReviewCase[]
  reviewCasesError?: string | null
  canAssignReviewCases: boolean
  userId: string
}

type ScheduleDraft = SupplyOrderScheduleDraft

type ScheduleGroup = {
  key: string
  delivery_date: string
  supplier_id: string | null
  supplier_name: string | null
  quantity: number
  received_quantity: number
  reserved_quantity: number
  free_stock_quantity: number
  piece_length_mm: number | null
  piece_count: number | null
}

type FinanceDraft = {
  amount: string
  currency: 'UAH' | 'EUR'
  plannedDate: string
  transferFromExpenseId?: string
  itemKeys?: string[]
}

const SupplierLoadErrorContext = createContext<string | null>(null)

function PendingSupplyReviewBanner({
  cases,
  error,
  canAssign,
}: {
  cases: PendingSupplyScheduleReviewCase[]
  error: string | null
  canAssign: boolean
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  if (error) return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Не удалось загрузить проверки графика: {error}</div>
  if (cases.length === 0) return null

  const materialNames: Record<string, string> = {
    request_sheet_metal: 'Листовой металл',
    request_round_tube: 'Круг и труба',
    request_components: 'Комплектующие',
    request_paint: 'Краска',
    request_mesh: 'Сетка',
    request_chain_cord: 'Цепь и шнур',
    request_pipe: 'Труба и проволока',
  }
  return <section className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" aria-label="Проверка будущего графика">
    <p className="font-semibold">После приёмки требуется проверка графика снабжением · {cases.length}</p>
    <p className="mt-1 text-xs">Поставки не изменены. Для этих случаев пока не назначена задача ответственному.</p>
    <ul className="mt-2 divide-y divide-amber-200">
      {cases.map((reviewCase) => <li key={reviewCase.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span>{materialNames[reviewCase.request_item_table] || 'Материал'} · {reviewCase.request_id ? 'На склад' : 'Заявка машины'} · проверить {Number(reviewCase.excess_quantity).toLocaleString('ru-RU')} {reviewCase.unit}</span>
        {canAssign && <Button type="button" size="sm" variant="outline" disabled={isPending && pendingId === reviewCase.id}
          onClick={() => {
            setPendingId(reviewCase.id)
            startTransition(async () => {
              const result = await assignSupplyScheduleReviewCase(reviewCase.id)
              if (result.success) {
                toast.success('Задача снабжению назначена')
                router.refresh()
              } else toast.error(result.error || 'Не удалось назначить задачу')
              setPendingId(null)
            })
          }}>Назначить задачу</Button>}
      </li>)}
    </ul>
  </section>
}

export function SupplyOrderSummaryPage({ aggregates, factories, activeFactoryId, suppliers, supplierError = null, pendingReviewCases, reviewCasesError = null, canAssignReviewCases, userId }: SupplyOrderSummaryPageProps) {
  const defaultFilters = useMemo<AggregateFiltersState>(() => ({
    query: '',
    supplier: 'all',
    category: 'all',
    status: 'open',
    schedule: 'all',
    sort: 'date_asc',
  }), [])
  const [preferences, setPreferences] = useSupplySummaryPreferences(userId)
  const { view, section, allStatus, filters } = preferences
  const setFilters = (next: AggregateFiltersState | ((current: AggregateFiltersState) => AggregateFiltersState)) =>
    setPreferences({ ...preferences, filters: typeof next === 'function' ? next(filters) : next })
  const visibleAggregates = filterAndSortAggregates(aggregates,
    view === 'list' ? { ...filters, status: 'all', schedule: 'all' } : filters)
  const otherMaterialsCount = useMemo(() => filterAndSortAggregates(aggregates, { ...defaultFilters, status: 'all' }).length,
    [aggregates, defaultFilters])
  const openMaterialsCount = useMemo(() => filterAndSortAggregates(aggregates, defaultFilters).length,
    [aggregates, defaultFilters])

  const prioritizedAggregates = useMemo(() => {
    return partitionSupplyOrderAggregatesByRedelivery(visibleAggregates)
  }, [visibleAggregates])
  const matchingRows = groupSupplyOrderAggregatesBySupplyDate(visibleAggregates, filters.sort)
    .map((group) => ({ ...group, rows: filterSupplyOrderDateSlices(group.rows,
      view === 'list' ? 'all' : filters.status,
      view === 'list' ? 'all' : filters.schedule)
      .filter((row) => filters.supplier === 'all' || row.supplierId === filters.supplier
        || (row.kind === 'unscheduled' && supplyOrderDateSliceItems(row).some((item) => item.supplier_id === filters.supplier))) }))
  const grouped = matchingRows.map((group) => ({ ...group, rows: group.rows.filter((row) =>
    view === 'cards' || (section === 'all' ? allStatus === 'all' || (allStatus === 'closed' ? row.state === 'closed' : row.state !== 'closed')
      : row.state === section)) })).filter((group) => group.rows.length > 0)
  const exportableCountByDate = useMemo(() => new Map(
    groupSupplyOrderAggregatesBySupplyDate(aggregates, 'date_asc').map((group) => [
      group.dateKey, group.rows.filter((slice) => slice.unscheduledQuantity > 0.000001).length,
    ]),
  ), [aggregates])
  const totals = (() => {
    const slices = grouped.flatMap((group) => group.rows)
    const materials = new Map(slices.map((slice) => [slice.aggregate.id, slice.aggregate]))
    return {
      aggregateCount: materials.size,
      itemCount: Array.from(materials.values()).reduce((sum, aggregate) => sum + aggregate.item_count, 0),
      awaitingCount: new Set(slices.filter((slice) => slice.plannedQuantity > 0.000001)
        .map((slice) => slice.aggregate.id)).size,
      unscheduledCount: new Set(slices.filter((slice) => slice.unscheduledQuantity > 0.000001)
        .map((slice) => slice.aggregate.id)).size,
    }
  })()
  const filtersPanel = <AggregateFilters
    compact={view === 'list'} value={filters} suppliers={suppliers}
    resultCount={totals.aggregateCount} totalCount={aggregates.length}
    onChange={setFilters}
    onReset={() => setPreferences({ ...preferences, allStatus: 'all', filters: defaultFilters })}
  />


  return (
    <SupplierLoadErrorContext.Provider value={supplierError}>
    <div className="space-y-5">
      {supplierError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Не удалось загрузить поставщиков: {supplierError}. Обновите страницу для повторной загрузки.</div>}
      <PendingSupplyReviewBanner cases={pendingReviewCases} error={reviewCasesError} canAssign={canAssignReviewCases} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Итоги по дню</h2>
        <div className="inline-flex gap-1 rounded-lg border p-1" aria-label="Вид итогов по дню">
          {(['list', 'cards'] as const).map((option) => <Button key={option} variant={view === option ? 'default' : 'ghost'} size="sm" aria-pressed={view === option} onClick={() => setPreferences({ ...preferences, view: option })}>{option === 'list' ? 'Список' : 'Карточки'}</Button>)}
        </div>
      </div>
      <SupplyOrderFactoryToggle factories={factories} activeFactoryId={activeFactoryId} view="summary" />

      {view === 'cards' && <DeliveryStateTabs
        value={filters.status}
        onChange={(status) => setFilters((current) => ({ ...current, status }))}
        counts={{
          open: filterAndSortAggregates(aggregates, { ...defaultFilters, status: 'open' }).length,
          review: filterAndSortAggregates(aggregates, { ...defaultFilters, status: 'review' }).length,
          all: aggregates.length,
          scheduled: aggregates.filter((row) => row.planned_schedule_quantity > 0).length,
          unscheduled: aggregates.filter(hasSupplyOrderRedelivery).length,
          closed: filterAndSortAggregates(aggregates, { ...defaultFilters, status: 'closed' }).length,
        }}
      />}

      {view === 'list' && <div className="flex flex-wrap items-center gap-2" aria-label="Раздел итогов">
        {([['unscheduled', 'Без графика'], ['ordered', 'Заказано'], ['redelivery', 'Нужно довезти'], ['all', 'Все']] as const).map(([key, label]) => {
          const count = matchingRows.flatMap(group => group.rows).filter(row => key === 'all' || row.state === key).length
          return <Button key={key} size="sm" variant={section === key ? 'default' : 'outline'} className={key === 'redelivery' && count > 0 ? 'border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:text-destructive-foreground focus-visible:ring-destructive' : undefined} aria-pressed={section === key} onClick={() => setPreferences({ ...preferences, section: key })}>{label} <span className="tabular-nums">{count}</span></Button>
        })}
        {section === 'all' && <SummaryFilterSelect label="Состояние" value={allStatus} display={{ all: 'Все состояния', open: 'Незакрытые', closed: 'Закрытые' }[allStatus]} items={[['all', 'Все состояния'], ['open', 'Незакрытые'], ['closed', 'Закрытые']]} onValueChange={(value) => setPreferences({ ...preferences, allStatus: value as typeof allStatus })} />}
      </div>}

      {view === 'list' ? <details className="rounded-xl border bg-card open:border-transparent">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span>Фильтры · показано {totals.aggregateCount} из {aggregates.length}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {filters.query || filters.supplier !== 'all' || filters.category !== 'all' || filters.sort !== 'date_asc' ? 'Заданы фильтры' : ''}
            <ChevronDown className="h-4 w-4" />
          </span>
        </summary>
        {filtersPanel}
      </details> : filtersPanel}

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-[#E8ECF0] bg-white p-10 text-center text-[#6B7280]">
          {aggregates.length === 0
            ? 'Нет материалов для закупки или истории закрытых поставок по выбранному заводу.'
            : filters.status === 'open' && openMaterialsCount === 0 && otherMaterialsCount > 0
              ? `Незакрытых материалов нет. Остальных материалов: ${otherMaterialsCount}.`
              : 'По выбранным фильтрам материалы не найдены.'}
          {aggregates.length > 0 && (
            <div><Button type="button" variant="outline" className="mt-4" onClick={() => setPreferences({ ...preferences, section: 'all', allStatus: 'all', filters: { ...defaultFilters, status: 'all' } })}>Показать все</Button></div>
          )}
        </div>
      ) : (
        <>
          {view === 'cards' && filters.schedule !== 'scheduled' && prioritizedAggregates.redeliveries.length > 0 && (
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
                    <p className="text-xs text-amber-800/80">Подтверждённая складом недопоставка показана на исходной дате. Назначенный довоз — на новой дате поставки.</p>
                  </div>
                </div>
                <Badge variant="outline" className="w-fit border-amber-300 bg-white/80 text-amber-900">
                  {prioritizedAggregates.redeliveries.length} материалов
                </Badge>
              </div>
            </section>
          )}

          {view === 'cards' && <div className="grid grid-cols-2 gap-2 text-sm xl:grid-cols-4">
            <Metric label="Материалы" value={totals.aggregateCount} />
            <Metric label="Позиции" value={totals.itemCount} />
            <Metric label="Ожидают поставку" value={totals.awaitingCount} hint="Материалов с будущим графиком" />
            <Metric label="Нужно заказать" value={totals.unscheduledCount} hint="Материалов с незапланированным остатком" />
          </div>}

          {grouped.map((group) => (
            <section key={group.dateKey} className="space-y-3" aria-labelledby={`aggregate-date-${group.dateKey}`}>
              <div className="flex flex-wrap items-center gap-3 px-1">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <h2 id={`aggregate-date-${group.dateKey}`} className="text-base font-semibold text-foreground sm:text-lg">
                      {group.dateKey === 'no_supply_date' ? 'Без даты поставки' : formatDate(group.dateKey)}
                    </h2>
                    <p className="text-xs text-muted-foreground">{group.rows.length} поставок и потребностей</p>
                  </div>
                </div>
                <SupplyDateOrderExportButton
                  dateKey={group.dateKey}
                  factoryId={activeFactoryId}
                  itemCount={exportableCountByDate.get(group.dateKey) || 0}
                  aggregates={aggregates}
                />
              </div>

              <div className={view === 'list' ? 'space-y-2' : 'space-y-3'}>
                {(group.dateKey === 'no_supply_date' ? [
                  { label: 'На склад · без срока', rows: group.rows.filter((slice) => slice.stockWithoutDate) },
                  { label: 'Источник требует уточнения', rows: group.rows.filter((slice) => !slice.stockWithoutDate && slice.ambiguousOrigin) },
                  { label: 'Прочие потребности без даты', rows: group.rows.filter((slice) => !slice.stockWithoutDate && !slice.ambiguousOrigin) },
                ] : [{ label: '', rows: group.rows }]).filter((section) => section.rows.length > 0).map((section) => <div key={section.label} className={view === 'list' ? 'overflow-hidden rounded-lg border bg-card' : 'space-y-3'}>
                  {section.label && <h3 className="px-1 text-sm font-semibold text-amber-950">{section.label}</h3>}
                  {view === 'list' && <CompactSupplyOrderHeader />}
                  {section.rows.map((slice) => {
                    const factory = slice.aggregate.factories[0]
                    return <div key={slice.id} className={view === 'list' ? '' : 'space-y-3'}>
                      {view === 'list' ? <CompactSupplyOrderRow slice={slice}>
                        <MaterialOrderCard aggregate={slice.aggregate} factory={factory} suppliers={suppliers}
                          dateSlice={slice} compact />
                      </CompactSupplyOrderRow> : <MaterialOrderCard
                        aggregate={slice.aggregate}
                        factory={factory}
                        suppliers={suppliers}
                        dateSlice={slice}
                      />}
                    </div>
                  })}
                </div>)}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
    </SupplierLoadErrorContext.Provider>
  )
}

function MaterialOrderCard({
  aggregate,
  factory,
  suppliers,
  attentionKind = 'standard',
  dateSlice,
  compact = false,
}: {
  compact?: boolean
  aggregate: SupplyOrderAggregate
  factory?: SupplyOrderAggregateFactory
  suppliers: SupplierWithRelations[]
  attentionKind?: 'standard' | 'redelivery'
  dateSlice?: SupplyOrderDateSlice
}) {
  const [deliveryOpen, setDeliveryOpen] = useState(compact)
  const activeFactoryItems = (dateSlice ? supplyOrderDateSliceItems(dateSlice) : factory?.items || [])
    .filter((item) => !isReturnedSupplyOrderSource(item))
  const displayFactory = factory && dateSlice ? projectSupplyOrderDateSliceFactory(dateSlice, factory) : factory
  const editorFactory = dateSlice?.kind === 'unscheduled' ? displayFactory : factory
  const cardId = dateSlice?.id || aggregate.id
  const detailsId = `machine-details-${cardId}`
  const deliveryId = `delivery-details-${cardId}`
  const supplyPlan = displayFactory ? makeSupplyPlanDateInfo(displayFactory) : null
  const displayQuantity = dateSlice?.quantity ?? aggregate.quantity
  const displayUnscheduledQuantity = dateSlice?.unscheduledQuantity ?? factory?.unscheduled_quantity ?? 0
  const quantitySummary = summarizeSupplyOrderQuantities(aggregate, displayFactory, dateSlice)
  const displayWeight = dateSlice && factory
    ? formatWeightForQuantity(displayQuantity, factory)
    : aggregate.weight_kg !== null
      ? `${formatAmount(aggregate.weight_kg)} кг`
      : null
  const longStockPlans = activeFactoryItems
    .map((item) => item.long_stock_purchase_plan)
    .filter((plan): plan is LongStockPurchasePlan => plan !== null) ?? []
  const longStockPurchase = mergeLongStockPurchasePlans(longStockPlans)
  const hasGenericPositionReturn = factory?.items.some((item) => Boolean(item.position_revision)) ?? false
  const hasCancelledReturn = factory?.items.some(isCancelledReturnedSupplyOrderSource) ?? false
  const requiresRecalculation = (hasGenericPositionReturn && activeFactoryItems.length === 0)
    || longStockPlans.some((plan) => plan.cutting_status === 'requires_recalculation')
  const isUnscheduledSlice = dateSlice?.kind === 'unscheduled'
  const hasMixedPlannedAndUnscheduled = Boolean(
    dateSlice && dateSlice.plannedScheduleCount > 0 && dateSlice.unscheduledQuantity > 0,
  )
  const plannedOnlyDateSlice = hasMixedPlannedAndUnscheduled && dateSlice
    ? {
      ...dateSlice,
      quantity: dateSlice.plannedQuantity + dateSlice.deliveredQuantity,
      unscheduledQuantity: 0,
    }
    : dateSlice
  const receiptPlan = dateSlice?.state === 'closed' && factory
    ? [...new Map(factory.items.flatMap((item) => item.delivery_schedules)
      .filter((schedule) => dateSlice.scheduleIds?.includes(schedule.id))
      .map((schedule) => [schedule.id, schedule])).values()]
      .reduce((sum, schedule) => sum + Number(schedule.quantity || 0), 0)
    : 0
  const receiptAllocated = dateSlice?.state === 'closed'
    ? Object.values(dateSlice.sourceQuantities || {}).reduce((sum, quantity) => sum + quantity, 0)
    : 0

  return (
    <article className={compact ? 'overflow-hidden bg-card' : 'overflow-hidden rounded-xl border border-border bg-card shadow-sm'}>
      <div className={compact ? "hidden" : "lg:grid lg:grid-cols-[minmax(0,1fr)_220px]"}>
        <header className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5">
            <div className="text-sm text-muted-foreground">{MATERIAL_CATEGORY_LABELS[displayMaterialCategory(aggregate.category, null, aggregate.unit)!]}</div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {dateSlice ? (
                <>
                  {hasCancelledReturn && <div className="font-medium text-slate-700">Отменено</div>}
                  {dateSlice.plannedScheduleCount > 0 && (
                    <div className="flex items-center gap-1.5 font-medium text-primary">
                      <Check className="h-3.5 w-3.5" />
                      Ожидается поставка
                    </div>
                  )}
                  {dateSlice.deliveredScheduleCount > 0 && <div className="font-medium text-emerald-700">{dateSlice.state === 'closed' ? 'Поставка закрыта' : 'Поставка принята'}</div>}
                  {dateSlice.unscheduledQuantity > 0 && <div className="font-medium text-amber-700">{dateSlice.state === 'redelivery' ? 'Нужно довезти' : 'Не заказано'}</div>}
                </>
              ) : (
                <>
                  {aggregate.ordered_count > 0 && (
                    <div className="flex items-center gap-1.5 font-medium text-primary">
                      <Check className="h-3.5 w-3.5" />
                      {aggregate.ordered_count} заказано
                    </div>
                  )}
                  {aggregate.pending_count > 0 && <div className="text-muted-foreground">{aggregate.pending_count} не заказано</div>}
                  {aggregate.delivered_count > 0 && <div className="font-medium text-emerald-700">{aggregate.delivered_count} принято</div>}
                </>
              )}
            </div>
          </div>
          <h3 className="mt-1 break-words text-lg font-semibold text-foreground sm:text-xl">{aggregate.item_name}</h3>

          {factory && displayUnscheduledQuantity > 0 && (
            <div className="mt-3 flex w-fit flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-sm text-amber-950">
              <CalendarX2 className="h-4 w-4 shrink-0 text-amber-700" />
              <span className="font-semibold">{dateSlice?.state === 'redelivery' || attentionKind === 'redelivery' ? 'Нужно довезти:' : 'Без графика:'}</span>
              <span className="font-medium tabular-nums">{formatAmount(displayUnscheduledQuantity)} {aggregate.unit}</span>
              {formatWeightForQuantity(displayUnscheduledQuantity, factory) && (
                <span className="text-amber-800">· {formatWeightForQuantity(displayUnscheduledQuantity, factory)}</span>
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

          {longStockPurchase.components.length > 0 && (
            <PurchasePlanSummary plans={longStockPlans} className="mt-4 max-w-3xl" />
          )}

          {requiresRecalculation && (
            <div className="mt-3 flex max-w-3xl items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span>
                <strong>{hasGenericPositionReturn ? 'Позиция возвращена технологу.' : 'Требуется пересчёт.'}</strong>{' '}
                {hasGenericPositionReturn
                  ? 'Она исключена из активного объёма до проверки склада и отправки исправления.'
                  : 'График поставки и резка заблокированы до утверждения новой версии.'}
              </span>
            </div>
          )}
        </header>

        <SupplyQuantitySummary summary={quantitySummary} unit={aggregate.unit} dateSlice={dateSlice}
          productionDate={dateSlice?.stockWithoutDate || (dateSlice && activeFactoryItems.length > 0
            && activeFactoryItems.every((item) => (item.request_kind === 'stock' || !item.machine_id) && !item.planned_material_date))
            ? null : displayFactory?.production_date ?? aggregate.planned_material_date}
          weight={displayWeight} itemCount={dateSlice ? activeFactoryItems.length : aggregate.item_count}
        />
      </div>

      <div className="border-t border-border">
        <section className="p-4 sm:p-5" aria-label="Машины назначения материала">
          <div className="flex items-center justify-between gap-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Cog className="h-4 w-4 text-primary" />
              Заявки по этому объёму
            </h4>
            <span className="text-xs text-muted-foreground">{activeFactoryItems.length}</span>
          </div>

          {dateSlice && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {isUnscheduledSlice ? 'Заявки с незапланированным остатком.' : 'Заявки, которым выделен объём этой поставки или назначен график.'}
            </p>
          )}

          {factory && <MachineItems id={detailsId} factory={displayFactory || factory} dateSlice={dateSlice} />}
        </section>

      </div>

        {factory ? (
          <section className="border-t border-border">
            <button
              type="button"
              className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none sm:px-5"
              aria-expanded={deliveryOpen}
              aria-controls={deliveryId}
              onClick={() => setDeliveryOpen((current) => !current)}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Truck className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">Поставка · {factory.factory_name}</span>
                  {dateSlice ? (
                    <>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        Дата {dateSlice.dateKey === 'no_supply_date' ? 'не указана' : formatDate(dateSlice.dateKey)} · {dateSlice.plannedScheduleCount + dateSlice.deliveredScheduleCount > 0 ? 'из графика снабжения' : 'по Мат.план производства'}
                      </span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {isUnscheduledSlice ? 'Нужно назначить поставку' : `${formatAmount(dateSlice.plannedQuantity)} ожидается / ${formatAmount(dateSlice.deliveredQuantity)} принято`}
                        {dateSlice.unscheduledQuantity > 0 && ` · без графика ${formatAmount(dateSlice.unscheduledQuantity)} ${aggregate.unit}`}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                        Мат.план {factory.production_date ? formatDate(factory.production_date) : 'не указан'} · снабжение {supplyPlan?.value || 'не указано'}
                      </span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        График {factory.has_delivery_schedules ? dateCountLabel(factory.delivery_schedule_count) : 'не создан'}
                        {factory.unscheduled_quantity > 0 && ` · остаток ${formatAmount(factory.unscheduled_quantity)} ${aggregate.unit}`}
                      </span>
                    </>
                  )}
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${deliveryOpen ? 'rotate-180' : ''}`} />
            </button>
          </section>
        ) : (
          <div className="border-t border-border p-4 text-sm text-muted-foreground">Нет заводской строки для выбранного фильтра.</div>
        )}

      {factory && (
        <div id={deliveryId} hidden={!deliveryOpen} className="space-y-3 border-t border-border bg-muted/15 p-3 sm:p-4">
          {dateSlice?.state === 'closed' && dateSlice.deliveredScheduleCount > 0 ? <div className="grid gap-2 rounded-lg border bg-card p-3 text-sm sm:grid-cols-2">
            <div><span className="text-muted-foreground">Исходный график</span><strong className="block">{formatAmount(receiptPlan)} {aggregate.unit}</strong></div>
            <div><span className="text-muted-foreground">Склад подтвердил</span><strong className="block">{formatAmount(dateSlice.deliveredQuantity)} {aggregate.unit}</strong></div>
            <div><span className="text-muted-foreground">Выделено заявкам</span><strong className="block">{formatAmount(receiptAllocated)} {aggregate.unit}</strong></div>
            <div><span className="text-muted-foreground">Свободно на складе</span><strong className="block">{formatAmount(Math.max(dateSlice.deliveredQuantity - receiptAllocated, 0))} {aggregate.unit}</strong></div>
          </div> : dateSlice?.state === 'closed' ? <div className="rounded-lg border bg-card p-3 text-sm text-muted-foreground">Позиция закрыта без поставки.</div> : <><FactoryDeliveryEditor
            aggregate={aggregate}
            factory={editorFactory!}
            displayFactory={displayFactory}
            suppliers={suppliers}
            dateSlice={plannedOnlyDateSlice}
            appendUnscheduled={attentionKind === 'redelivery' || isUnscheduledSlice}
            paymentItemKeys={activeFactoryItems.map((item) => `${item.table}:${item.id}`)}
            mutationItems={activeFactoryItems.map((item) => ({ table: item.table, id: item.id }))}
          />
          {hasMixedPlannedAndUnscheduled && (
            <FactoryDeliveryEditor
              aggregate={aggregate}
              factory={factory}
              displayFactory={displayFactory}
              suppliers={suppliers}
              dateSlice={dateSlice}
              appendUnscheduled
              paymentItemKeys={activeFactoryItems.map((item) => `${item.table}:${item.id}`)}
              mutationItems={activeFactoryItems.map((item) => ({ table: item.table, id: item.id }))}
            />
          )}</>}
        </div>
      )}
    </article>
  )
}

const aggregateStatusLabels: Record<SupplyOrderAggregateStatusFilter, string> = {
  open: 'Незакрытые поставки',
  review: 'На рассмотрении',
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
  counts: { open: number; review: number; all: number; scheduled: number; unscheduled: number; closed: number }
}) {
  const tabs: Array<[SupplyOrderAggregateStatusFilter, string, number]> = [
    ['open', 'Незакрытые', counts.open],
    ['review', 'На рассмотрении', counts.review],
    ['all', 'Все', counts.all],
    ['scheduled', 'С датой поступления', counts.scheduled],
    ['unscheduled', 'Нужно довезти', counts.unscheduled],
    ['closed', 'Закрытые', counts.closed],
  ]
  return (
    <div className="flex w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" aria-label="Состояние поставки">
      {tabs.map(([key, label, count]) => (
        <button key={key} type="button" onClick={() => onChange(key)} aria-pressed={value === key} className={`min-h-10 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${key === 'unscheduled' && count > 0 ? 'bg-red-600 text-white hover:bg-red-700 ring-2 ring-red-700' : value === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
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

function AggregateFilters({ value, suppliers, resultCount, totalCount, onChange, onReset, compact = false }: {
  compact?: boolean
  value: AggregateFiltersState
  suppliers: SupplierWithRelations[]
  resultCount: number
  totalCount: number
  onChange: (value: AggregateFiltersState) => void
  onReset: () => void
}) {
  const activeCount = [value.query, value.supplier !== 'all', value.category !== 'all', !compact && value.status !== 'open', !compact && value.schedule && value.schedule !== 'all', value.sort !== 'date_asc']
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
        {!compact && <SummaryFilterSelect
          className="xl:col-span-3"
          label="Статус"
          value={value.status}
          display={aggregateStatusLabels[value.status]}
          items={Object.entries(aggregateStatusLabels)}
          onValueChange={(status) => onChange({ ...value, status: status as SupplyOrderAggregateStatusFilter })}
        />}
        {!compact && <SummaryFilterSelect
          className="md:col-span-2 xl:col-span-12"
          label="График поставки"
          value={value.schedule || 'all'}
          display={{ all: 'Все', scheduled: 'С графиком', unscheduled: 'Без графика' }[value.schedule || 'all']}
          items={Object.entries({ all: 'Все', scheduled: 'С графиком', unscheduled: 'Без графика' })}
          onValueChange={(schedule) => onChange({ ...value, schedule: schedule as AggregateFiltersState['schedule'] })}
        />}
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

type FactoryDeliveryEditorProps = {
  aggregate: SupplyOrderAggregate
  factory: SupplyOrderAggregateFactory
  displayFactory?: SupplyOrderAggregateFactory
  suppliers: SupplierWithRelations[]
  dateSlice?: SupplyOrderDateSlice
  appendUnscheduled?: boolean
  allowFinance?: boolean
  paymentItemKeys?: string[]
  mutationItems?: Array<{ table: string; id: string }>
  mutationScope?: SupplyOrderDeliveryScheduleScope
  compact?: boolean
}

export function FactoryDeliveryEditor(props: FactoryDeliveryEditorProps) {
  const resetKey = JSON.stringify({
    dateSlice: props.dateSlice && {
      id: props.dateSlice.id,
      dateKey: props.dateSlice.dateKey,
      quantity: props.dateSlice.quantity,
      plannedQuantity: props.dateSlice.plannedQuantity,
      deliveredQuantity: props.dateSlice.deliveredQuantity,
      unscheduledQuantity: props.dateSlice.unscheduledQuantity,
      plannedScheduleCount: props.dateSlice.plannedScheduleCount,
      deliveredScheduleCount: props.dateSlice.deliveredScheduleCount,
    },
    appendUnscheduled: props.appendUnscheduled,
    compact: props.compact,
    mutationScope: props.mutationScope,
    unscheduledQuantity: props.factory.unscheduled_quantity,
    schedules: props.factory.items.flatMap((item) => item.delivery_schedules.map((schedule) => ({
      id: schedule.id,
      status: schedule.status,
      quantity: schedule.quantity,
      supplierId: schedule.supplier_id,
      deliveryDate: schedule.delivery_date,
      updatedAt: schedule.updated_at,
    }))),
  })
  return <FactoryDeliveryEditorForm key={resetKey} {...props} />
}

function FactoryDeliveryEditorForm({
  aggregate,
  factory,
  displayFactory,
  suppliers,
  dateSlice,
  appendUnscheduled = false,
  allowFinance = true,
  paymentItemKeys,
  mutationItems,
  mutationScope,
  compact = false,
}: FactoryDeliveryEditorProps) {
  const summaryFactory = displayFactory || factory
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const activeItems = useMemo(
    () => factory.items.filter((item) => (
      !isReturnedSupplyOrderSource(item) && !isCancelledReturnedSupplyOrderSource(item)
    )),
    [factory.items],
  )
  const activeFactory = useMemo(
    () => ({ ...factory, items: activeItems }),
    [activeItems, factory],
  )
  const supplierError = useContext(SupplierLoadErrorContext)
  const eligibleSuppliers = suppliers.filter(supplier => supplierSupportsCategory(supplier, aggregate.category))
  const draftDateSlice = appendUnscheduled
    ? { dateKey: 'no_supply_date', unscheduledQuantity: factory.unscheduled_quantity, pieceLengthMm: dateSlice?.pieceLengthMm }
    : dateSlice
  const [scheduleDrafts, setScheduleDrafts] = useState<ScheduleDraft[]>(() => {
    const drafts = buildInitialSupplyOrderScheduleDrafts(factory, todayIsoDate(), draftDateSlice)
    return drafts.map((draft) => ({ ...draft,
      redelivery_of_schedule_id: draft.redelivery_of_schedule_id || ((dateSlice?.state === 'redelivery' || dateSlice?.ambiguousOrigin) && dateSlice.origins?.length === 1 ? dateSlice.origins[0].id : null),
      delivery_date: (compact && draftDateSlice?.dateKey === 'no_supply_date') || dateSlice?.stockWithoutDate || dateSlice?.state === 'redelivery' ? '' : draft.delivery_date,
    }))
  })
  const [paymentModes, setPaymentModes] = useState<Record<string, boolean>>({})
  const [financeDrafts, setFinanceDrafts] = useState<Record<string, FinanceDraft>>({})
  const [existingPayments, setExistingPayments] = useState<SupplySchedulePayment[]>([])
  const [paymentCheck, setPaymentCheck] = useState<{ loading: boolean; error: string | null }>(() => ({
    loading: Boolean(dateSlice?.scheduleIds?.length), error: null,
  }))
  const scheduleIdsKey = (dateSlice?.scheduleIds || []).join(',')
  useEffect(() => {
    const scheduleIds = scheduleIdsKey ? scheduleIdsKey.split(',') : []
    if (scheduleIds.length === 0) return
    let cancelled = false
    getSupplySchedulePayments(scheduleIds).then((result) => {
      if (cancelled) return
      if (!result.success) {
        setPaymentCheck({ loading: false, error: result.error })
        return
      }
      if (result.data.requiresFinancePermission) {
        setPaymentCheck({ loading: false, error: 'У этой даты есть платёж. Для изменения графика нужны права на финансы' })
        return
      }
      const payments = result.data.payments
      if (payments.some((payment) => !['planned', 'overdue'].includes(payment.status)
        || Number(payment.paid_amount) > 0)) {
        setPaymentCheck({ loading: false, error: 'Оплаченный или частично оплаченный платёж нельзя перенести вместе с графиком' })
        return
      }
      const matchedDrafts = new Set<string>()
      const nextModes: Record<string, boolean> = {}
      const nextDrafts: Record<string, FinanceDraft> = {}
      for (const payment of payments) {
        const draft = scheduleDrafts.find((row) => row.delivery_date === payment.delivery_date
          && row.supplier_id === payment.supplier_id && !matchedDrafts.has(row.id))
        if (!draft || payment.linked_date_count > 1) {
          setPaymentCheck({ loading: false, error: 'Платёж связан с несколькими строками. Уточните распределение в финансах перед изменением графика' })
          return
        }
        matchedDrafts.add(draft.id)
        nextModes[draft.id] = true
        nextDrafts[draft.id] = {
          amount: String(payment.amount), currency: payment.currency,
          plannedDate: payment.planned_date, transferFromExpenseId: payment.id,
          itemKeys: payment.item_keys,
        }
      }
      setExistingPayments(payments)
      setPaymentModes(nextModes)
      setFinanceDrafts(nextDrafts)
      setPaymentCheck({ loading: false, error: null })
    }).catch((error) => {
      if (!cancelled) {
        console.error('[supply-orders] payment check failed', error)
        setPaymentCheck({ loading: false, error: 'Не удалось проверить платежи графика. Обновите страницу' })
      }
    })
    return () => { cancelled = true }
    // The editor remounts when the date slice or its schedule version changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleIdsKey])
  const itemKeys = useMemo(
    () => (mutationItems || activeItems.map((item) => ({ table: item.table, id: item.id })))
      .filter((item) => activeItems.some((active) => active.table === item.table && active.id === item.id)),
    [activeItems, mutationItems],
  )
  const deliveredGroups = useMemo(
    () => makeDeliveredScheduleGroups(summaryFactory, dateSlice?.dateKey),
    [summaryFactory, dateSlice?.dateKey],
  )
  const baseScheduleScope = mutationScope || (draftDateSlice
    ? deliveryScheduleScopeForDateSlice(
      appendUnscheduled || (dateSlice?.plannedScheduleCount === 0 && dateSlice.unscheduledQuantity > 0)
        ? 'no_supply_date'
        : draftDateSlice.dateKey,
    )
    : undefined)
  const scheduleScope = baseScheduleScope?.mode === 'date' && dateSlice?.scheduleIds
    ? { ...baseScheduleScope, schedule_ids: dateSlice.scheduleIds } : baseScheduleScope
  const plannedTotal = scheduleDrafts.reduce((sum, draft) => sum + parseQuantity(draft.quantity), 0)
  const remainingQuantity = appendUnscheduled
    ? factory.unscheduled_quantity
    : dateSlice
    ? Math.max(dateSlice.quantity - dateSlice.deliveredQuantity, 0)
    : Math.max(factory.quantity - factory.delivered_schedule_quantity, 0)
  const hasOpenPositionReturn = factory.items.some(isReturnedSupplyOrderSource)
  const hasCancelledPositionReturn = factory.items.some(isCancelledReturnedSupplyOrderSource)
  const isCancelled = activeItems.length === 0 && hasCancelledPositionReturn && !hasOpenPositionReturn
  const isClosed = dateSlice?.state === 'closed' || isCancelled || (
    !hasOpenPositionReturn
    && isSupplyOrderFactoryClosed(activeFactory)
  )
  const freeStockReceivedTotal = deliveredGroups.reduce(
    (sum, group) => sum + group.free_stock_quantity,
    0,
  )
  const financePayments: SupplyFinancePaymentInput[] = scheduleDrafts.filter((draft) => paymentModes[draft.id]).map((draft) => ({
    supplierId: draft.supplier_id,
    plannedDate: financeDrafts[draft.id]?.plannedDate || (financeDrafts[draft.id]?.transferFromExpenseId ? '' : draft.delivery_date),
    deliveryDate: draft.delivery_date,
    amount: Math.round(parseQuantity(financeDrafts[draft.id]?.amount || '') * 100) / 100,
    currency: financeDrafts[draft.id]?.currency || 'EUR',
    itemKeys: financeDrafts[draft.id]?.itemKeys || paymentItemKeys || activeItems.map((item) => `${item.table}:${item.id}`),
    transferFromExpenseId: financeDrafts[draft.id]?.transferFromExpenseId || null,
  }))
  const transferredTotals = new Map(existingPayments.map((payment) => [payment.id, {
    expected: Number(payment.amount),
    entered: financePayments.filter((entry) => entry.transferFromExpenseId === payment.id)
      .reduce((sum, entry) => sum + entry.amount, 0),
  }]))
  const transferMismatch = [...transferredTotals.values()].some(({ expected, entered }) => Math.abs(expected - entered) > 0.009)
  const financeInvalid = financePayments.some((payment) => !payment.supplierId || !payment.plannedDate
    || !Number.isFinite(payment.amount) || payment.amount <= 0 || payment.itemKeys.length === 0)
    || scheduleDrafts.some((draft) => paymentModes[draft.id]
      && !/^\d+(?:[.,]\d{1,2})?$/.test(financeDrafts[draft.id]?.amount || ''))
    || transferMismatch
  const longStockPlans = activeItems
    .map((item) => item.long_stock_purchase_plan)
    .filter((plan): plan is LongStockPurchasePlan => plan !== null)
  const requiresRecalculation = (hasOpenPositionReturn && activeItems.length === 0)
    || longStockPlans.some((plan) => plan.cutting_status === 'requires_recalculation')
  const isBarMaterial = isSupplyOrderBarMaterial(aggregate) || longStockPlans.length > 0
  const deliveredLongStockSchedules = Array.from(new Map(summaryFactory.items
    .flatMap((item) => item.delivery_schedules)
    .filter((schedule) => schedule.status === 'delivered')
    .filter((schedule) => Number(schedule.received_piece_length_mm || schedule.planned_piece_length_mm || 0) > 0)
    .map((schedule) => [schedule.id, schedule])).values())
  const deliveredLongStockPieces = deliveredLongStockSchedules.reduce((sum, schedule) => {
    const pieceLength = Number(schedule.received_piece_length_mm || schedule.planned_piece_length_mm || 0)
    const count = schedule.allocated_piece_count
      ?? schedule.received_piece_count
      ?? (pieceLength > 0 && schedule.allocated_physical_quantity !== null
        ? schedule.allocated_physical_quantity / pieceLength
        : 0)
    return sum + Math.max(Number(count || 0), 0)
  }, 0)
  const longStockPartsLength = Math.min(summaryFactory.requested_quantity, summaryFactory.delivered_schedule_quantity)
  const longStockRemainderAndLosses = Math.max(
    summaryFactory.delivered_schedule_quantity - longStockPartsLength,
    0,
  )

  const saveSchedule = () => {
    if (requiresRecalculation) return
    const schedules: SupplyOrderAggregateScheduleInput[] = scheduleDrafts.map((draft) => ({
      delivery_date: draft.delivery_date,
      quantity: parseQuantity(draft.quantity),
      supplier_id: draft.supplier_id || null,
      redelivery_of_schedule_id: draft.redelivery_of_schedule_id || null,
      piece_length_mm: isBarMaterial ? parseQuantity(draft.piece_length_mm) : null,
      piece_count: isBarMaterial ? parseQuantity(draft.piece_count) : null,
    }))

    startTransition(async () => {
      try {
        const result = await saveAggregateDeliverySchedule(itemKeys, schedules, scheduleScope, financePayments)
        if (!result.success) {
          toast.error(result.error || 'Не удалось сохранить график поставки')
          return
        }
        if (result.warning) toast.warning(result.warning)
        else toast.success(financePayments.length > 0 ? 'График и плановые платежи сохранены' : 'График поставки сохранен, материал отмечен как заказанный')
        router.refresh()
      } catch (error) {
        console.error('[supply-orders] schedule save request failed', error)
        toast.error('Не удалось сохранить график и платежи. Проверьте соединение и повторите попытку')
      }
    })
  }

  const clearScheduledDate = () => {
    if (!dateSlice || dateSlice.plannedScheduleCount === 0 || !scheduleScope) return
    if (!window.confirm(`Удалить график на ${formatDate(dateSlice.dateKey)}? Непринятое количество вернётся в «Без графика».`)) return
    startTransition(async () => {
      try {
        const result = await clearAggregateDeliverySchedule(itemKeys, scheduleScope)
        if (!result.success) {
          toast.error(result.error || 'Не удалось удалить дату поставки')
          return
        }
        toast.success('Дата удалена. Непринятое количество вернулось в «Без графика»')
        router.refresh()
      } catch (error) {
        console.error('[supply-orders] schedule date removal failed', error)
        toast.error('Не удалось удалить дату. Проверьте соединение и повторите попытку')
      }
    })
  }

  const updateDraft = (index: number, patch: Partial<ScheduleDraft>) => {
    setFinanceDrafts((current) => Object.fromEntries(Object.entries(current).map(([id, draft]) => [id,
      draft.transferFromExpenseId ? { ...draft, plannedDate: '' } : draft,
    ])))
    setScheduleDrafts((current) => current.map((draft, draftIndex) => (
      draftIndex === index
        ? recalculateBarDraft({ ...draft, ...patch }, isBarMaterial)
        : draft
    )))
  }

  const addDraft = () => {
    const newId = `new:${Date.now()}:${scheduleDrafts.length}`
    if (existingPayments.length === 1) {
      const payment = existingPayments[0]
      setPaymentModes((current) => ({ ...current, [newId]: true }))
      setFinanceDrafts((current) => ({ ...current, [newId]: {
        amount: '', currency: payment.currency, plannedDate: '', transferFromExpenseId: payment.id,
        itemKeys: payment.item_keys,
      } }))
    }
    setScheduleDrafts((current) => [
      ...current,
      {
        id: newId,
        delivery_date: dateSlice?.state === 'redelivery' || dateSlice?.stockWithoutDate ? '' : scheduleScope?.replace_delivery_date || (compact ? '' : factory.supply_delivery_date || factory.production_date || todayIsoDate()),
        quantity: '',
        supplier_id: current[0]?.supplier_id || '',
        redelivery_of_schedule_id: dateSlice?.origins?.length === 1 ? dateSlice.origins[0].id : null,
        piece_length_mm: '',
        piece_count: '',
      },
    ])
  }

  const removeDraft = (index: number) => {
    setScheduleDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))
  }

  const scheduleInvalid = Boolean(supplierError) || paymentCheck.loading || Boolean(paymentCheck.error) || financeInvalid || ((dateSlice?.state === 'redelivery' || dateSlice?.ambiguousOrigin) && scheduleDrafts.some(draft => !draft.redelivery_of_schedule_id)) || scheduleDrafts.length === 0 ||
    scheduleDrafts.some((draft) => !draft.delivery_date || parseQuantity(draft.quantity) <= 0) ||
    scheduleDrafts.some((draft) => !draft.supplier_id) ||
    (isBarMaterial && scheduleDrafts.some((draft) => (
      parseQuantity(draft.piece_length_mm) <= 0 ||
      !Number.isInteger(parseQuantity(draft.piece_count)) ||
      parseQuantity(draft.piece_count) <= 0
    )))
  const supplyPlanDateInfo = makeSupplyPlanDateInfo(summaryFactory)

  return (
    <section className={compact ? 'overflow-hidden rounded-xl border border-border/70 bg-card' : 'overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm'}>
      {!compact && <>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-card px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700">
            <Truck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Поставка на завод</div>
            <div className="truncate font-semibold text-foreground">{summaryFactory.factory_name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {formatAmount(summaryFactory.quantity)} {aggregate.unit} · {summaryFactory.machine_count} маш.
              {summaryFactory.items.some((item) => !item.machine_id) && ' · На склад'} · поставщики: {supplierSummary(summaryFactory)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {isClosed ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              {freeStockReceivedTotal > 0 ? 'Принято на свободный склад' : 'Поставка закрыта'}
            </Badge>
          ) : <>
            {summaryFactory.pending_count > 0 && <Badge variant="secondary">{summaryFactory.pending_count} не зак.</Badge>}
            {summaryFactory.ordered_count > 0 && <Badge>{summaryFactory.ordered_count} зак.</Badge>}
            {summaryFactory.delivered_count > 0 && <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{summaryFactory.delivered_count} принято</Badge>}
          </>}
        </div>
      </div>

      <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoBox label="Мат.план" value={summaryFactory.production_date ? formatDate(summaryFactory.production_date) : 'Нет даты'} />
        <InfoBox
          label="Мат.план снабжения"
          value={supplyPlanDateInfo.value}
          hint={supplyPlanDateInfo.hint}
        />
        <InfoBox
          label="График поставки"
          value={summaryFactory.has_delivery_schedules ? dateCountLabel(summaryFactory.delivery_schedule_count) : 'Не разбит'}
          hint={`${formatAmount(summaryFactory.planned_schedule_quantity)} план / ${formatAmount(summaryFactory.delivered_schedule_quantity)} факт`}
        />
        <InfoBox
          label="Остаток без графика"
          value={`${formatAmount(summaryFactory.unscheduled_quantity)} ${aggregate.unit}`}
          hint={formatWeightForQuantity(summaryFactory.unscheduled_quantity, summaryFactory)}
        />
      </div>

      {deliveredGroups.length > 0 && (
        <div className="mx-3 mb-3 rounded-xl border border-[#DCFCE7] bg-[#F0FDF4] p-3 text-xs text-[#166534]">
          <div className="font-semibold">Принято на склад</div>
          <div className="mt-1 space-y-1">
            {deliveredGroups.map((group) => (
              <div key={group.key} className="flex flex-wrap justify-between gap-2">
                <span>
                  {group.free_stock_quantity >= group.received_quantity - 0.000001
                    ? 'Принято на свободный склад'
                    : group.free_stock_quantity > 0
                      ? 'Принято частично на свободный склад'
                      : 'Принято и зарезервировано под заказ'}
                  {' · '}{formatDate(group.delivery_date)}{group.supplier_name ? ` · ${group.supplier_name}` : ''}
                </span>
                <span className="font-medium tabular-nums">{formatAmount(group.received_quantity || group.quantity)} {aggregate.unit}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {deliveredLongStockSchedules.length > 0 && (
        <div className="mx-3 mb-3 grid gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950 sm:grid-cols-3">
          <div>
            <div className="text-sky-700">Принято физически</div>
            <div className="mt-1 font-semibold tabular-nums">
              {formatAmount(summaryFactory.delivered_schedule_quantity)} {aggregate.unit}
              {deliveredLongStockPieces > 0 && ` / ${formatAmount(deliveredLongStockPieces)} шт.`}
            </div>
          </div>
          <div>
            <div className="text-sky-700">В детали по заявкам</div>
            <div className="mt-1 font-semibold tabular-nums">{formatAmount(longStockPartsLength)} {aggregate.unit}</div>
          </div>
          <div>
            <div className="text-sky-700">Расчётный остаток и потери</div>
            <div className="mt-1 font-semibold tabular-nums">{formatAmount(longStockRemainderAndLosses)} {aggregate.unit}</div>
          </div>
        </div>
      )}
      </>}

      {requiresRecalculation && (
        <div className="mx-3 mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <div className="font-semibold">Позиция возвращена технологу</div>
            <div className="mt-0.5 text-xs leading-5 text-amber-800">
              {hasOpenPositionReturn
                ? 'Она исключена из закупки до повторной проверки склада и отправки исправленной позиции.'
                : 'До утверждения новой версии нельзя создавать график, отмечать заказ или передавать позицию в резку.'}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border/60 bg-card px-3 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <PackageCheck className="h-4 w-4 text-primary" />
          <span className={isClosed ? 'font-semibold text-emerald-700' : undefined}>
            {isClosed
              ? isCancelled
                ? 'Позиция отменена'
                : freeStockReceivedTotal > 0
                  ? 'Поставка закрыта · Принято на свободный склад'
                  : 'Поставка закрыта'
              : summaryFactory.unscheduled_quantity > 0
                ? compact
                  ? `${formatAmount(summaryFactory.unscheduled_quantity)} ${aggregate.unit} нужно добавить в график`
                  : `${formatAmount(summaryFactory.unscheduled_quantity)} ${aggregate.unit} без даты поступления · прежний Мат.план ${summaryFactory.production_date ? formatDate(summaryFactory.production_date) : 'не указан'}`
                : 'Весь объем распределен по графику'}
          </span>
        </div>
      </div>

      {!isClosed && !requiresRecalculation && (!dateSlice || dateSlice.plannedScheduleCount > 0 || dateSlice.unscheduledQuantity > 0) && (
        <div className="mt-3 rounded-md border border-[#E8ECF0] bg-white p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-[#1B3A6B]">
                {dateSlice && dateSlice.dateKey !== 'no_supply_date'
                  ? `Поставка на ${formatDate(dateSlice.dateKey)}`
                  : 'Новая поставка'}
              </div>
              <div className="text-xs text-[#64748B]">
                План {formatAmount(plannedTotal)} из {formatAmount(remainingQuantity)} {aggregate.unit}
                {factory.weight_kg !== null && ` · ${formatWeightForQuantity(plannedTotal, factory)}`}
              </div>
              {!compact && <div className="text-xs text-[#64748B]">
                {dateSlice
                  ? 'Изменения относятся только к этой поставке и не затрагивают графики на другие даты.'
                  : appendUnscheduled
                    ? 'Новая поставка покрывает только остаток без графика и сохраняет существующие даты.'
                    : 'Изменения сохраняют график целиком и сразу отмечают материал как заказанный.'}
              </div>}
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
                <div key={draft.id} className={`grid min-w-0 gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-2 ${isBarMaterial ? 'xl:grid-cols-[minmax(145px,1.4fr)_105px_85px_100px_135px_145px_36px]' : 'lg:grid-cols-[minmax(150px,1fr)_120px_145px_145px_36px]'} items-end`}>
                  {(dateSlice?.state === 'redelivery' || dateSlice?.ambiguousOrigin) && <label className="grid min-w-0 gap-1 text-xs font-medium text-amber-900 md:col-span-full">
                    {dateSlice.ambiguousOrigin ? 'Источник требует уточнения — выберите исходную поставку' : 'Довоз из поставки'}
                    <select className="min-h-10 w-full rounded-md border bg-white px-2 text-sm" value={draft.redelivery_of_schedule_id || ''} disabled={isPending} onChange={(event) => updateDraft(index, { redelivery_of_schedule_id: event.target.value })}>
                      <option value="">Выберите подтверждённую поставку</option>
                      {dateSlice.origins?.map((origin, originIndex) => <option key={origin.id} value={origin.id}>{(dateSlice.origins?.length || 0) > 1 ? `Источник ${originIndex + 1} · ` : ''}{redeliveryOriginOptionLabel(origin, aggregate.unit)}</option>)}
                    </select>
                  </label>}
                  <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                    Поставщик
                    <select
                      value={draft.supplier_id}
                      disabled={isPending}
                      onChange={(event) => updateDraft(index, { supplier_id: event.target.value })}
                      className="h-9 min-w-0 w-full max-w-full truncate rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">{supplierError ? 'Ошибка загрузки поставщиков' : eligibleSuppliers.length ? 'Выберите поставщика' : 'Нет поставщиков этой категории'}</option>
                      {draft.supplier_id && !eligibleSuppliers.some(supplier => supplier.id === draft.supplier_id) && (
                        <option value={draft.supplier_id} disabled>{suppliers.find(supplier => supplier.id === draft.supplier_id)?.name || 'Ранее выбранный поставщик'} — не подходит для категории</option>
                      )}
                      {eligibleSuppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                      ))}
                    </select>
                  </label>
                  {isBarMaterial ? (
                    <>
                      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                        Длина хлыста, мм
                        <input value={draft.piece_length_mm} disabled={isPending} inputMode="decimal" onChange={(event) => updateDraft(index, { piece_length_mm: event.target.value })} className="h-9 w-full rounded-md border border-[#CBD5E1] bg-white px-2 text-sm text-[#111827] disabled:opacity-50" />
                      </label>
                      <label className="grid min-w-0 gap-1 text-xs font-medium text-[#475569]">
                        Хлыстов, шт
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
                  {allowFinance && <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                    Платёж
                    <select value={paymentModes[draft.id] ? 'payment' : 'none'} disabled={isPending || paymentCheck.loading}
                      onChange={(event) => {
                        const enabled = event.target.value === 'payment'
                        setPaymentModes((current) => ({ ...current, [draft.id]: enabled }))
                        if (enabled && existingPayments.length === 1 && !financeDrafts[draft.id]?.transferFromExpenseId) {
                          const payment = existingPayments[0]
                          setFinanceDrafts((current) => ({ ...current, [draft.id]: {
                            amount: current[draft.id]?.amount || '', currency: payment.currency,
                            plannedDate: '', transferFromExpenseId: payment.id, itemKeys: payment.item_keys,
                          } }))
                        }
                      }}
                      className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                      <option value="none">Без платежа</option>
                      <option value="payment">С платежом</option>
                    </select>
                  </label>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="justify-self-start md:justify-self-end"
                    disabled={isPending}
                    onClick={() => removeDraft(index)}
                    aria-label="Удалить дату поставки"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {allowFinance && paymentModes[draft.id] && <div className="grid gap-2 border-t border-border pt-3 sm:col-span-2 sm:grid-cols-3 lg:col-span-full xl:col-span-full">
                    {existingPayments.length > 0 && <label className="grid gap-1 text-xs font-medium text-muted-foreground sm:col-span-3">Перенос платежа
                      <select value={financeDrafts[draft.id]?.transferFromExpenseId || ''} disabled={isPending}
                        onChange={(event) => {
                          const payment = existingPayments.find((entry) => entry.id === event.target.value)
                          setFinanceDrafts((current) => ({ ...current, [draft.id]: {
                            amount: current[draft.id]?.amount || '',
                            currency: payment?.currency || current[draft.id]?.currency || 'EUR',
                            plannedDate: '', transferFromExpenseId: payment?.id,
                            itemKeys: payment?.item_keys,
                          } }))
                        }} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                        <option value="">Выберите прежний платёж</option>
                        {existingPayments.map((payment) => <option key={payment.id} value={payment.id}>
                          {formatAmount(payment.amount)} {payment.currency} · {formatDate(payment.planned_date)}
                        </option>)}
                      </select>
                    </label>}
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">Сумма платежа
                      <input inputMode="decimal" value={financeDrafts[draft.id]?.amount || ''} disabled={isPending}
                        onChange={(event) => setFinanceDrafts((current) => ({ ...current, [draft.id]: { ...current[draft.id], amount: event.target.value, currency: current[draft.id]?.currency || 'EUR', plannedDate: current[draft.id]?.plannedDate || '' } }))}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">Валюта
                      <select value={financeDrafts[draft.id]?.currency || 'EUR'} disabled={isPending}
                        onChange={(event) => setFinanceDrafts((current) => ({ ...current, [draft.id]: { ...current[draft.id], amount: current[draft.id]?.amount || '', currency: event.target.value as 'UAH' | 'EUR', plannedDate: current[draft.id]?.plannedDate || '' } }))}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"><option value="EUR">EUR</option><option value="UAH">UAH</option></select>
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">Плановая дата оплаты
                      <input type="date" value={financeDrafts[draft.id]?.plannedDate || (financeDrafts[draft.id]?.transferFromExpenseId ? '' : draft.delivery_date)} disabled={isPending}
                        onChange={(event) => setFinanceDrafts((current) => ({ ...current, [draft.id]: { ...current[draft.id], amount: current[draft.id]?.amount || '', currency: current[draft.id]?.currency || 'EUR', plannedDate: event.target.value } }))}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
                    </label>
                  </div>}
                </div>
              )
            })}
          </div>

          {plannedTotal > remainingQuantity + 0.000001 && (
            <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              {isBarMaterial
                ? <>Физический приход больше логической потребности на {formatAmount(plannedTotal - remainingQuantity)} {aggregate.unit}. При приёмке CRM покажет, какие целые бруски будут зарезервированы под машины, какой будущий деловой отход появится после Заготовки и сколько нетронутых брусков останется свободным складом.</>
                : <>Сверх потребности: {formatAmount(plannedTotal - remainingQuantity)} {aggregate.unit}. При приёмке оператор сам подтвердит бронь по машинам; нераспределённый объём останется на свободном складе.</>}
            </div>
          )}
          {scheduleDrafts.some((draft) => !draft.supplier_id) && (
            <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-[#B45309]">
              Выберите поставщика для каждой даты поступления.
            </div>
          )}
          {paymentCheck.loading && <p className="mt-2 text-xs text-muted-foreground">Проверяем связанные платежи…</p>}
          {paymentCheck.error && <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{paymentCheck.error}</p>}
          {existingPayments.length > 0 && <div className="mt-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
            <p className="font-medium">Перенос существующего платежа</p>
            {existingPayments.map((payment) => {
              const totals = transferredTotals.get(payment.id)
              return <p key={payment.id} className={totals && Math.abs(totals.expected - totals.entered) > 0.009 ? 'text-amber-800' : 'text-muted-foreground'}>
                Было {formatAmount(payment.amount)} {payment.currency} · распределено {formatAmount(totals?.entered || 0)} {payment.currency}. Укажите суммы и даты оплаты для новых строк.
              </p>
            })}
          </div>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={isPending || scheduleInvalid} onClick={saveSchedule}>
              {financePayments.length > 0 ? 'Сохранить график и платежи' : 'Сохранить график и отметить заказано'}
            </Button>
            {dateSlice && dateSlice.plannedScheduleCount > 0 && !appendUnscheduled && <Button type="button" variant="outline" size="sm"
              disabled={isPending || paymentCheck.loading || Boolean(paymentCheck.error) || existingPayments.length > 0}
              onClick={clearScheduledDate}>
              Удалить дату из графика
            </Button>}
          </div>
          {dateSlice && existingPayments.length > 0 && <p className="mt-2 text-xs text-amber-800">Удаление даты недоступно: к ней привязан платёж. Для переноса разделите график и распределите сумму платежа по новым датам.</p>}
        </div>
      )}
      {!isClosed && !requiresRecalculation && dateSlice && dateSlice.plannedScheduleCount === 0 && dateSlice.unscheduledQuantity === 0 && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Поставка на эту дату уже принята. Редактирование графика недоступно.
        </div>
      )}
    </section>
  )
}

function PurchasePlanSummary({
  plans,
  className = '',
  compact = false,
}: {
  plans: LongStockPurchasePlan[]
  className?: string
  compact?: boolean
}) {
  const purchase = mergeLongStockPurchasePlans(plans)
  if (purchase.components.length === 0) return null

  return (
    <div
      className={`${compact ? '' : 'rounded-lg border border-sky-200 bg-sky-50/70 p-3'} ${className}`.trim()}
      aria-label={`К закупке: ${formatLongStockPurchaseComposition(purchase.components)}`}
    >
      {!compact && <div className="text-xs font-semibold uppercase tracking-wide text-sky-900">К закупке по утверждённой карте</div>}
      <div className={`flex flex-wrap items-center gap-1.5 ${compact ? '' : 'mt-2'}`}>
        {purchase.components.map((component) => (
          <span
            key={`${component.length_mm}:${component.is_nonstandard ? 'nonstandard' : 'standard'}`}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-semibold tabular-nums ${
              component.is_nonstandard
                ? 'border-amber-300 bg-amber-50 text-amber-950'
                : 'border-sky-200 bg-white text-sky-950'
            } ${compact ? 'text-xs' : 'text-sm'}`}
          >
            {formatAmount(component.length_mm)} × {formatAmount(component.piece_count)}
            {component.is_nonstandard && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800" title="Нестандартная длина: дороже и дольше в поставке">
                <TriangleAlert className="size-3" aria-hidden="true" /> нестандартная
              </span>
            )}
          </span>
        ))}
      </div>
      {!compact && (
        <div className="mt-2 text-xs text-sky-800">
          {purchase.total_piece_count} шт. · {formatAmount(purchase.total_length_mm)} мм. Складские остатки в закупку не включены.
        </div>
      )}
    </div>
  )
}

function formatItemScheduleTimeline(item: SupplyOrderAggregateSourceItem, dateSlice?: SupplyOrderDateSlice) {
  if (dateSlice) {
    if (dateSlice.kind === 'unscheduled') return 'Без графика'
    return `${formatDate(dateSlice.dateKey)}: ${dateSlice.state === 'closed' ? 'выделено заявке' : 'план'} ${formatAmount(item.quantity)} ${item.unit}`
  }
  const summaries = summarizeSupplyOrderItemSchedules(item.delivery_schedules)
  if (summaries.length === 0) {
    return item.supply_delivery_date ? formatDate(item.supply_delivery_date) : 'По Мат.план'
  }

  return summaries.map((summary) => {
    const values = [
      summary.plannedQuantity > 0 ? `план ${formatAmount(summary.plannedQuantity)} ${item.unit}` : null,
      summary.receivedQuantity > 0 ? `принято ${formatAmount(summary.receivedQuantity)} ${item.unit}` : null,
    ].filter(Boolean)
    return `${formatDate(summary.date)}: ${values.join(' / ')}`
  }).join('; ')
}

function MachineItems({ factory, id, dateSlice }: { factory: SupplyOrderAggregateFactory; id: string; dateSlice?: SupplyOrderDateSlice }) {
  if (dateSlice?.state === 'redelivery') {
    return <div id={id} className="mt-3 space-y-3 border-t border-border/60 pt-3">
      <div className="space-y-2" aria-label="Исходные поставки с недопоставкой">
        {(dateSlice.origins || []).map((origin) => <div key={origin.id} className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-950">
          <p className="font-semibold">Недопоставка из подтверждённой поставки</p>
          <p className="mt-1 leading-6">{redeliveryOriginLabel(origin, dateSlice.aggregate.unit)}.</p>
          <p className="text-xs leading-5">Осталось назначить в новый график: <strong className="tabular-nums">{formatAmount(origin.available)} {dateSlice.aggregate.unit}</strong></p>
        </div>)}
        {dateSlice.ambiguousOrigin && <p className="text-xs font-medium text-amber-900">У довоза несколько исходных поставок. Выберите нужную поставку в графике ниже.</p>}
      </div>
      <ul className="grid gap-2">
        {factory.items.map((item) => {
          const plan = item.long_stock_purchase_plan
          const returnedToTechnologist = isReturnedSupplyOrderSource(item)
          const cancelledReturn = isCancelledReturnedSupplyOrderSource(item)
          return <li key={`${item.table}:${item.id}`} className="min-w-0 rounded-lg border border-border/70 bg-background p-3 sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={item.machine_id ? `${ROUTES.SALES_PLAN}/${item.machine_id}` : `${ROUTES.SUPPLY_ORDERS}/stock/${item.request_id}`} className="text-sm font-semibold text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{item.machine_name}</Link>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.planned_material_date ? `Мат.план производства: ${formatDate(item.planned_material_date)}` : 'Срок потребности не задан'}</p>
              </div>
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-950">Нужен довоз</Badge>
            </div>
            <dl className="mt-3 grid gap-3 border-t border-border/60 pt-3 text-xs sm:grid-cols-2">
              <div><dt className="text-muted-foreground">К довозу по этой заявке</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{formatAmount(item.quantity)} {item.unit}</dd></div>
              <div><dt className="text-muted-foreground">Новый график</dt><dd className="mt-1 font-medium text-amber-900">Ещё не назначен</dd></div>
            </dl>
            {plan && <div className="mt-3 rounded-lg bg-muted/50 p-2 text-xs"><span className="font-medium text-muted-foreground">К закупке по карте: </span><PurchasePlanSummary plans={[plan]} compact /></div>}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-3">
              <Link href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ExternalLink className="h-3.5 w-3.5" />Открыть заявку</Link>
              {!returnedToTechnologist && !cancelledReturn && <ReturnLongStockPositionButton requestItemTable={item.table} requestItemId={item.id} itemName={item.item_name} categoryLabel={MATERIAL_CATEGORY_LABELS[displayMaterialCategory(item.category, null, item.unit)!]} planNumber={plan?.plan_number} versionNumber={plan?.version_number} />}
              {item.can_cancel_return && <CancelReturnedSupplyPositionDialog table={item.table as SupplyPositionTable} itemId={item.id} compact />}
            </div>
          </li>
        })}
      </ul>
    </div>
  }
  return (
    <div id={id} className="mt-2 border-t border-border/60 pt-3">
      <div className="hidden grid-cols-[minmax(0,1.3fr)_80px_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(160px,1.2fr)] gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground xl:grid">
        <span>Источник заявки</span>
        <span>Количество</span>
        <span>Статус</span>
        <span>К закупке</span>
        <span>Поставки</span>
        <span>Действия</span>
      </div>
      <div className="mt-2 hidden space-y-2 xl:block">
        {factory.items.map((item) => {
          const plan = item.long_stock_purchase_plan
          const returnedToTechnologist = isReturnedSupplyOrderSource(item)
          const cancelledReturn = isCancelledReturnedSupplyOrderSource(item)
          return (
            <div key={`${item.table}:${item.id}`} className="grid min-w-0 grid-cols-[minmax(0,1.3fr)_80px_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(160px,1.2fr)] items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5 text-sm">
              <Link href={item.machine_id ? `${ROUTES.SALES_PLAN}/${item.machine_id}` : `${ROUTES.SUPPLY_ORDERS}/stock/${item.request_id}`} className="font-medium text-primary hover:underline">
                {item.machine_name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{item.planned_material_date ? `Мат.план производства: ${formatDate(item.planned_material_date)}` : 'Срок потребности не задан'}</span>
              </Link>
              <span className="tabular-nums text-foreground">{formatAmount(item.quantity)} {item.unit}
                {dateSlice?.state === 'redelivery' && item.quantity > 0 && <span className="block text-xs font-medium text-amber-800">Довоз: {formatAmount(item.quantity)} {item.unit}</span>}
              </span>
              {cancelledReturn ? (
                <Badge variant="outline" className="w-fit border-slate-300 bg-slate-100 text-slate-800">Отменено</Badge>
              ) : returnedToTechnologist ? (
                <Badge variant="outline" className="w-fit border-amber-300 bg-amber-50 text-amber-900">Возвращено технологу</Badge>
              ) : (
                <MachineItemOrderStatus item={item} />
              )}
              <div>{plan ? <PurchasePlanSummary plans={[plan]} compact /> : <span className="text-xs text-muted-foreground">Нет утверждённой карты</span>}</div>
              <span className="min-w-0 break-words text-xs text-muted-foreground">
                {formatItemScheduleTimeline(item, dateSlice)}
              </span>
              <div className="flex flex-wrap gap-1.5">
                <Link
                  href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`}
                  className="inline-flex min-h-9 w-fit items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-primary hover:bg-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Заявка
                </Link>
                {!returnedToTechnologist && !cancelledReturn && (
                  <ReturnLongStockPositionButton
                    requestItemTable={item.table}
                    requestItemId={item.id}
                    itemName={item.item_name}
                    categoryLabel={MATERIAL_CATEGORY_LABELS[displayMaterialCategory(item.category, null, item.unit)!]}
                    planNumber={plan?.plan_number}
                    versionNumber={plan?.version_number}
                  />
                )}
                {item.can_cancel_return && (
                  <CancelReturnedSupplyPositionDialog table={item.table as SupplyPositionTable} itemId={item.id} compact />
                )}
              </div>
              {cancelledReturn && item.return_reason && (
                <p className="col-span-6 text-xs text-slate-600"><span className="font-medium">Причина:</span> {item.return_reason}</p>
              )}
            </div>
          )
        })}
      </div>
      <div className="grid gap-3 xl:hidden">
        {factory.items.map((item) => {
          const plan = item.long_stock_purchase_plan
          const returnedToTechnologist = isReturnedSupplyOrderSource(item)
          const cancelledReturn = isCancelledReturnedSupplyOrderSource(item)
          return (
            <article key={`${item.table}:${item.id}`} className="rounded-xl border border-border/70 bg-background p-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={item.machine_id ? `${ROUTES.SALES_PLAN}/${item.machine_id}` : `${ROUTES.SUPPLY_ORDERS}/stock/${item.request_id}`} className="font-semibold text-primary hover:underline">{item.machine_name}<span className="mt-1 block text-xs font-normal text-muted-foreground">{item.planned_material_date ? `Мат.план производства: ${formatDate(item.planned_material_date)}` : 'Срок потребности не задан'}</span></Link>
                {cancelledReturn ? (
                  <Badge variant="outline" className="border-slate-300 bg-slate-100 text-slate-800">Отменено</Badge>
                ) : returnedToTechnologist ? (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Возвращено технологу</Badge>
                ) : (
                  <MachineItemOrderStatus item={item} />
                )}
              </div>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                <div><dt className="text-muted-foreground">Количество</dt><dd className="mt-1 font-semibold tabular-nums text-foreground">{formatAmount(item.quantity)} {item.unit}{dateSlice?.state === 'redelivery' && item.quantity > 0 && <span className="block text-amber-800">Довоз: {formatAmount(item.quantity)} {item.unit}</span>}</dd></div>
                <div><dt className="text-muted-foreground">График</dt><dd className="mt-1 text-foreground">{formatAmount(item.planned_schedule_quantity)} план / {formatAmount(item.delivered_schedule_quantity)} факт</dd></div>
                <div><dt className="text-muted-foreground">Поставки</dt><dd className="mt-1 text-foreground">{formatItemScheduleTimeline(item, dateSlice)}</dd></div>
              </dl>
              {plan && (
                <div className="mt-3 rounded-lg bg-muted/50 p-2">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">К закупке по карте</div>
                  <PurchasePlanSummary plans={[plan]} compact />
                </div>
              )}
              {cancelledReturn && item.return_reason && (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                  <span className="font-medium">Причина отмены:</span> {item.return_reason}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-border px-3 text-xs font-medium text-primary hover:bg-muted">
                  <ExternalLink className="h-3.5 w-3.5" />Открыть заявку
                </Link>
                {!returnedToTechnologist && !cancelledReturn && (
                  <ReturnLongStockPositionButton
                    requestItemTable={item.table}
                    requestItemId={item.id}
                    itemName={item.item_name}
                    categoryLabel={MATERIAL_CATEGORY_LABELS[displayMaterialCategory(item.category, null, item.unit)!]}
                    planNumber={plan?.plan_number}
                    versionNumber={plan?.version_number}
                  />
                )}
                {item.can_cancel_return && (
                  <CancelReturnedSupplyPositionDialog table={item.table as SupplyPositionTable} itemId={item.id} compact />
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function MachineItemOrderStatus({ item }: { item: SupplyOrderAggregateSourceItem }) {
  const progress = getSupplyOrderItemOrderProgress(item)

  if (progress.isPartiallyOrdered) {
    const accessibleLabel = `Заказано частично: ${formatAmount(progress.orderedQuantity)} из ${formatAmount(progress.totalQuantity)} ${item.unit}`
    return (
      <div className="flex min-w-0 flex-col items-start gap-1" aria-label={accessibleLabel}>
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-950">
          Заказано частично
        </Badge>
        <span className="text-[11px] leading-4 text-amber-800 tabular-nums">
          {formatAmount(progress.orderedQuantity)} из {formatAmount(progress.totalQuantity)} {item.unit}
        </span>
      </div>
    )
  }

  return (
    <Badge
      variant={item.order_status === 'ordered' ? 'default' : 'secondary'}
      className={item.order_status === 'delivered' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : undefined}
    >
      {ORDER_STATUS_LABELS[item.order_status]}
    </Badge>
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
  const scheduledDates = uniqueSortedDates(factory.items.flatMap((item) => (
    item.delivery_schedules
      .filter((schedule) => schedule.status === 'planned' && Number(schedule.quantity || 0) > 0)
      .map((schedule) => schedule.delivery_date)
  )))
  const receivedDates = uniqueSortedDates(factory.items.flatMap((item) => (
    item.delivery_schedules
      .filter((schedule) => schedule.status === 'delivered' && deliveredSupplyQuantity(schedule) > 0)
      .map((schedule) => schedule.delivery_date)
  )))
  const fallbackDates = uniqueSortedDates(factory.items.map((item) => item.supply_delivery_date))
  const dates = scheduledDates.length > 0
    ? scheduledDates
    : receivedDates.length > 0
      ? receivedDates
      : fallbackDates

  if (dates.length === 0) {
    return { value: 'Не указано', hint: null }
  }

  if (dates.length === 1) {
    const [date] = dates
    return {
      value: formatDate(date),
      hint: scheduledDates.length > 0
        ? 'Из графика поставки'
        : receivedDates.length > 0
          ? 'Фактически принято'
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

function makeDeliveredScheduleGroups(factory: SupplyOrderAggregateFactory, dateKey?: string) {
  const groups = new Map<string, ScheduleGroup>()
  const scheduleIds = new Set(factory.items.flatMap((item) => item.delivery_schedules.map((schedule) => schedule.id)))
  const machineReservationsByReceipt = new Map<string, number>()
  for (const item of factory.items) {
    if (!item.machine_id) continue
    for (const schedule of item.delivery_schedules) {
      if (schedule.status !== 'delivered') continue
      const receiptId = schedule.receipt_parent_schedule_id || schedule.id
      machineReservationsByReceipt.set(receiptId,
        (machineReservationsByReceipt.get(receiptId) || 0) + reservedSupplyQuantity(schedule))
    }
  }
  for (const item of factory.items) {
    for (const schedule of item.delivery_schedules) {
      if (schedule.status !== 'delivered') continue
      if (schedule.receipt_parent_schedule_id && scheduleIds.has(schedule.receipt_parent_schedule_id)) continue
      if (dateKey && schedule.delivery_date !== dateKey) continue
      const key = `${schedule.delivery_date}:${schedule.supplier_id || 'none'}`
      const current = groups.get(key) || {
        key,
        delivery_date: schedule.delivery_date,
        supplier_id: schedule.supplier_id,
        supplier_name: schedule.supplier_name,
        quantity: 0,
        received_quantity: 0,
        reserved_quantity: 0,
        free_stock_quantity: 0,
        piece_length_mm: schedule.received_piece_length_mm,
        piece_count: 0,
      }
      current.quantity += Number(schedule.quantity || 0)
      current.received_quantity += deliveredSupplyQuantity(schedule)
      const split = splitReceiptStock(deliveredSupplyQuantity(schedule), machineReservationsByReceipt.get(schedule.id) || 0)
      current.reserved_quantity += split.machineReserved
      current.free_stock_quantity += split.freeStock
      current.piece_count = Number(current.piece_count || 0) + Number(
        schedule.allocated_piece_count ?? schedule.received_piece_count ?? 0,
      )
      groups.set(key, current)
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.delivery_date.localeCompare(b.delivery_date))
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

function recalculateBarDraft(draft: ScheduleDraft, isBarMaterial: boolean) {
  if (!isBarMaterial) return draft
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
