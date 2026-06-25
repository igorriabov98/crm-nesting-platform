'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Boxes, CalendarDays, ChevronDown, ExternalLink, Factory, RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import {
  updateAggregateSupplyDeliveryDate,
  type SupplyOrderAggregate,
  type SupplyOrderAggregateFactory,
} from '@/lib/actions/supply-orders'

type SupplyOrderSummaryPageProps = {
  aggregates: SupplyOrderAggregate[]
}

export function SupplyOrderSummaryPage({ aggregates }: SupplyOrderSummaryPageProps) {
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
    factoryRows: aggregates.reduce((sum, aggregate) => sum + aggregate.factories.length, 0),
    itemCount: aggregates.reduce((sum, aggregate) => sum + aggregate.item_count, 0),
    pendingCount: aggregates.reduce((sum, aggregate) => sum + aggregate.pending_count, 0),
    orderedCount: aggregates.reduce((sum, aggregate) => sum + aggregate.ordered_count, 0),
  }), [aggregates])

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (aggregates.length === 0) {
    return (
      <div className="rounded-xl border border-[#E8ECF0] bg-white p-10 text-center text-[#6B7280]">
        Нет позиций со статусом «Не заказано» или «Заказано» для агрегированного вида.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 text-sm sm:grid-cols-4">
        <Metric label="Материалов/дней" value={totals.aggregateCount} />
        <Metric label="Заводских строк" value={totals.factoryRows} />
        <Metric label="Позиций заявок" value={totals.itemCount} />
        <Metric label="Статусы" value={`${totals.pendingCount} / ${totals.orderedCount}`} hint="не заказано / заказано" />
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
            <div className="min-w-[1120px]">
              <div className="grid grid-cols-[44px_minmax(260px,1fr)_140px_minmax(460px,1.7fr)_120px] items-center gap-3 border-b border-[#E8ECF0] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold uppercase text-[#64748B]">
                <span />
                <span>Материал и характеристики</span>
                <span>Итого</span>
                <span>Заводы и даты снабжения</span>
                <span>Машины</span>
              </div>

              {group.rows.map((aggregate) => {
                const isExpanded = expanded.has(aggregate.id)
                return (
                  <div key={aggregate.id} className="border-b border-[#E8ECF0] last:border-b-0">
                    <div className="grid grid-cols-[44px_minmax(260px,1fr)_140px_minmax(460px,1.7fr)_120px] items-start gap-3 px-3 py-3 text-sm">
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

                      <div className="grid gap-2">
                        {aggregate.factories.map((factory) => (
                          <FactoryDeliveryEditor
                            key={`${aggregate.id}:${factory.factory_id || 'no_factory'}:${factory.supply_delivery_date || 'mixed'}`}
                            factory={factory}
                          />
                        ))}
                      </div>

                      <div className="text-sm font-medium text-[#1B3A6B] tabular-nums">
                        {aggregate.machine_count}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-[#F1F5F9] bg-[#F8FAFC] px-12 py-3">
                        <div className="grid min-w-[840px] grid-cols-[minmax(220px,1fr)_150px_130px_130px_110px] gap-2 text-xs font-semibold uppercase text-[#64748B]">
                          <span>Машина</span>
                          <span>Завод</span>
                          <span>Количество</span>
                          <span>Статус</span>
                          <span>Заявка</span>
                        </div>
                        <div className="mt-2 space-y-1">
                          {aggregate.factories.flatMap((factory) => factory.items.map((item) => (
                            <div key={`${item.table}:${item.id}`} className="grid min-w-[840px] grid-cols-[minmax(220px,1fr)_150px_130px_130px_110px] items-center gap-2 rounded-md bg-white px-2 py-2 text-sm">
                              <Link href={`${ROUTES.SALES_PLAN}/${item.machine_id}`} className="font-medium text-[#1B3A6B] hover:underline">
                                {item.machine_name}
                              </Link>
                              <span className="text-[#475569]">{factory.factory_name}</span>
                              <span className="tabular-nums text-[#111827]">{formatAmount(item.quantity)} {item.unit}</span>
                              <Badge variant={item.order_status === 'ordered' ? 'default' : 'secondary'} className="w-fit">
                                {ORDER_STATUS_LABELS[item.order_status]}
                              </Badge>
                              <Link
                                href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`}
                                className="inline-flex h-8 w-fit items-center gap-1 rounded-md border border-[#E8ECF0] px-2 text-xs font-medium text-[#1B3A6B] hover:bg-[#EFF6FF]"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Открыть
                              </Link>
                            </div>
                          )))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}

function FactoryDeliveryEditor({ factory }: { factory: SupplyOrderAggregateFactory }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dateValue, setDateValue] = useState(factory.has_mixed_supply_delivery_dates ? '' : factory.supply_delivery_date || '')
  const itemKeys = useMemo(() => factory.items.map((item) => ({ table: item.table, id: item.id })), [factory.items])
  const initialDate = factory.has_mixed_supply_delivery_dates ? '' : factory.supply_delivery_date || ''

  useEffect(() => {
    setDateValue(initialDate)
  }, [initialDate])

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

  const canSave = factory.has_mixed_supply_delivery_dates
    ? Boolean(dateValue)
    : dateValue !== initialDate

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

      <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
        <div className="rounded-md bg-white px-2 py-1.5 text-xs text-[#64748B]">
          <div className="font-medium text-[#475569]">Мат.план</div>
          <div className="mt-1 text-sm font-semibold text-[#111827]">
            {factory.production_date ? formatDate(factory.production_date) : 'Нет даты'}
          </div>
        </div>
        <label className="grid gap-1 text-xs font-medium text-[#475569]">
          Дата снабжения
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
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[#64748B] tabular-nums">
          {formatAmount(factory.quantity)} {factory.items[0]?.unit || ''} · {factory.machine_count} маш.
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || !canSave}
            onClick={() => saveDate(dateValue || null)}
            aria-label={`Сохранить дату снабжения для ${factory.factory_name}`}
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
            aria-label={`Сбросить дату снабжения для ${factory.factory_name}`}
            title="Сбросить к Мат.план"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
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
