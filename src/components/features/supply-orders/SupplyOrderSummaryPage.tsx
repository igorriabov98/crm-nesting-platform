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
  Save,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
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

  const grouped = useMemo(() => {
    const map = new Map<string, SupplyOrderAggregate[]>()
    for (const aggregate of aggregates) {
      const key = aggregate.planned_material_date || 'no_planned_date'
      map.set(key, [...(map.get(key) || []), aggregate])
    }
    return Array.from(map.entries()).map(([dateKey, rows]) => ({ dateKey, rows }))
  }, [aggregates])

  const totals = useMemo(() => ({
    aggregateCount: aggregates.length,
    itemCount: aggregates.reduce((sum, aggregate) => sum + aggregate.item_count, 0),
    pendingCount: aggregates.reduce((sum, aggregate) => sum + aggregate.pending_count, 0),
    orderedCount: aggregates.reduce((sum, aggregate) => sum + aggregate.ordered_count, 0),
    plannedQuantity: aggregates.reduce((sum, aggregate) => sum + aggregate.planned_schedule_quantity, 0),
    deliveredQuantity: aggregates.reduce((sum, aggregate) => sum + aggregate.delivered_schedule_quantity, 0),
    remainingQuantity: aggregates.reduce((sum, aggregate) => sum + aggregate.unscheduled_quantity, 0),
  }), [aggregates])

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

      {aggregates.length === 0 ? (
        <div className="rounded-xl border border-[#E8ECF0] bg-white p-10 text-center text-[#6B7280]">
          Нет позиций со статусом «Не заказано» или «Заказано» для выбранного завода.
        </div>
      ) : (
        <>
          <div className="grid gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 text-sm sm:grid-cols-4">
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
            <section key={group.dateKey} className="space-y-3">
              <div className="flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]">
                <CalendarDays className="h-5 w-5" />
                {group.dateKey === 'no_planned_date' ? 'Без даты Мат.план' : formatDate(group.dateKey)}
                <Badge variant="outline" className="ml-1 border-[#DBEAFE] bg-[#EFF6FF] text-[#1E40AF]">
                  {group.rows.length} поз.
                </Badge>
              </div>

              <div className="overflow-x-auto rounded-xl border border-[#E8ECF0] bg-white">
                <div className="min-w-[1180px]">
                  <div className="grid grid-cols-[44px_minmax(260px,1fr)_150px_minmax(560px,1.8fr)_120px] items-center gap-3 border-b border-[#E8ECF0] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold uppercase text-[#64748B]">
                    <span />
                    <span>Материал и характеристики</span>
                    <span>Итого</span>
                    <span>Заказ и поставка</span>
                    <span>Машины</span>
                  </div>

                  {group.rows.map((aggregate) => {
                    const isExpanded = expanded.has(aggregate.id)
                    const factory = aggregate.factories[0]
                    return (
                      <div key={aggregate.id} className="border-b border-[#E8ECF0] last:border-b-0">
                        <div className="grid grid-cols-[44px_minmax(260px,1fr)_150px_minmax(560px,1.8fr)_120px] items-start gap-3 px-3 py-3 text-sm">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="mt-1 text-[#1B3A6B]"
                            aria-label={isExpanded ? 'Скрыть машины' : 'Показать машины'}
                            aria-expanded={isExpanded}
                            onClick={() => toggle(aggregate.id)}
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </Button>

                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-semibold text-[#111827]">{aggregate.item_name}</div>
                              <Badge variant="outline" className="border-[#E8ECF0] bg-white text-[#475569]">
                                {MATERIAL_CATEGORY_LABELS[aggregate.category]}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#64748B]">
                              {aggregate.characteristics.map((part) => (
                                <span key={`${part.label}:${part.value}`}>
                                  <span className="font-medium text-[#475569]">{part.label}:</span> {part.value}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-1 font-medium text-[#111827] tabular-nums">
                            <div>{formatAmount(aggregate.quantity)} {aggregate.unit}</div>
                            {aggregate.weight_kg !== null && (
                              <div className="text-xs font-normal text-[#64748B]">{formatAmount(aggregate.weight_kg)} кг</div>
                            )}
                            <div className="text-xs font-normal text-[#64748B]">{aggregate.item_count} строк</div>
                          </div>

                          {factory ? (
                            <FactoryDeliveryEditor aggregate={aggregate} factory={factory} suppliers={suppliers} />
                          ) : (
                            <div className="rounded-lg border border-[#E8ECF0] bg-[#FBFCFE] p-3 text-sm text-[#64748B]">
                              Нет заводской строки для выбранного фильтра.
                            </div>
                          )}

                          <div className="text-sm font-medium text-[#1B3A6B] tabular-nums">
                            {aggregate.machine_count}
                          </div>
                        </div>

                        {isExpanded && factory && (
                          <MachineItems factory={factory} />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function FactoryToggle({ factories, activeFactoryId }: { factories: MaterialReceivingFactory[]; activeFactoryId: string | null }) {
  if (factories.length === 0) {
    return (
      <div className="rounded-xl border border-[#E8ECF0] bg-white p-4 text-sm text-[#6B7280]">
        В справочнике нет заводов для переключателя Берегово / Ужгород.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[#E8ECF0] bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1B3A6B]">
        <Factory className="h-4 w-4" />
        Завод: Берегово / Ужгород
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
                'inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B]/30',
                active
                  ? 'border-[#1B3A6B] bg-[#1B3A6B] text-white'
                  : 'border-[#E8ECF0] bg-white text-[#1B3A6B] hover:bg-[#EFF6FF]',
              ].join(' ')}
            >
              {factory.name}
            </Link>
          )
        })}
      </div>
    </div>
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
    <div className="border-t border-[#F1F5F9] bg-[#F8FAFC] px-12 py-3">
      <div className="grid min-w-[960px] grid-cols-[minmax(220px,1fr)_130px_130px_170px_minmax(220px,1fr)_110px] gap-2 text-xs font-semibold uppercase text-[#64748B]">
        <span>Машина</span>
        <span>Количество</span>
        <span>Статус</span>
        <span>Остаток графика</span>
        <span>Поставки</span>
        <span>Заявка</span>
      </div>
      <div className="mt-2 space-y-1">
        {factory.items.map((item) => (
          <div key={`${item.table}:${item.id}`} className="grid min-w-[960px] grid-cols-[minmax(220px,1fr)_130px_130px_170px_minmax(220px,1fr)_110px] items-center gap-2 rounded-md bg-white px-2 py-2 text-sm">
            <Link href={`${ROUTES.SALES_PLAN}/${item.machine_id}`} className="font-medium text-[#1B3A6B] hover:underline">
              {item.machine_name}
            </Link>
            <span className="tabular-nums text-[#111827]">{formatAmount(item.quantity)} {item.unit}</span>
            <Badge variant={item.order_status === 'ordered' ? 'default' : 'secondary'} className="w-fit">
              {ORDER_STATUS_LABELS[item.order_status]}
            </Badge>
            <span className="text-xs text-[#64748B] tabular-nums">
              {formatAmount(item.planned_schedule_quantity)} план / {formatAmount(item.delivered_schedule_quantity)} факт
            </span>
            <span className="text-xs text-[#64748B]">
              {item.delivery_schedules.length > 0
                ? item.delivery_schedules.map((schedule) => `${formatDate(schedule.delivery_date)}: ${formatAmount(schedule.received_quantity ?? schedule.quantity)} ${schedule.unit}`).join('; ')
                : (item.supply_delivery_date ? formatDate(item.supply_delivery_date) : 'По Мат.план')}
            </span>
            <Link
              href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`}
              className="inline-flex h-8 w-fit items-center gap-1 rounded-md border border-[#E8ECF0] px-2 text-xs font-medium text-[#1B3A6B] hover:bg-[#EFF6FF]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border border-[#E8ECF0] bg-[#F8FAFC] px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium text-[#64748B]">
        <Boxes className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-[#1B3A6B] tabular-nums">{value}</div>
      {hint && <div className="text-xs text-[#64748B]">{hint}</div>}
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
