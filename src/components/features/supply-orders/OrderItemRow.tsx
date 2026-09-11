'use client'

import Link from 'next/link'
import { useState } from 'react'
import { CalendarClock, ChevronDown, FileText, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import type {
  SupplyOrderAggregateCharacteristic,
  SupplyOrderDeliverySchedule,
  SupplyOrderItem,
} from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { FactoryDeliveryEditor } from './SupplyOrderSummaryPage'
import { ReturnLongStockPositionButton } from './ReturnLongStockPositionButton'
import type { SupplyOrderDetailContext } from './supply-order-view'

type OrderItemRowProps = {
  item: SupplyOrderItem
  suppliers: SupplierWithRelations[]
  detailContext?: SupplyOrderDetailContext
}

type DeliveryMetricTone = 'neutral' | 'info' | 'success' | 'warning'

type BarPart = {
  lengthMm: number
  pieceCount: number
}

const statusVariant = {
  pending: 'secondary',
  ordered: 'default',
  delivered: 'outline',
  cancelled: 'outline',
} as const

export function OrderItemRow({ item, suppliers, detailContext }: OrderItemRowProps) {
  const plan = item.long_stock_purchase_plan
  const returnedToTechnologist = Boolean(item.position_revision)
    || plan?.cutting_status === 'requires_recalculation'
  const plannedQuantity = detailContext?.plannedQuantity ?? sumSchedules(item.delivery_schedules, 'planned')
  const deliveredQuantity = detailContext?.deliveredQuantity ?? sumSchedules(item.delivery_schedules, 'delivered')
  const unscheduledQuantity = returnedToTechnologist ? 0 : detailContext?.unscheduledQuantity
    ?? Math.max(item.to_order - plannedQuantity - deliveredQuantity, 0)
  const remainingToDeliver = returnedToTechnologist ? 0 : Math.max(item.to_order - deliveredQuantity, 0)
  const redeliveryQuantity = detailContext?.redeliveryQuantity || 0
  const orderedQuantity = Math.max(item.to_order - unscheduledQuantity, 0)
  const isPartiallyOrdered = item.order_status === 'ordered'
    && orderedQuantity > 0.000001
    && unscheduledQuantity > 0.000001
  const isCoveredByStock = item.to_order <= 0 && item.reserved_quantity > 0
  const scopes = detailContext?.scopes || []
  const scopeKey = scopes.map((scope) => scope.id).join('|')
  const defaultScopeId = scopes[0]?.id || ''
  const [scopeState, setScopeState] = useState({ key: scopeKey, value: defaultScopeId })
  const [detailsOpen, setDetailsOpen] = useState(false)
  const activeScopeId = scopeState.key === scopeKey && scopes.some((scope) => scope.id === scopeState.value)
    ? scopeState.value
    : defaultScopeId
  const activeScope = scopes.find((scope) => scope.id === activeScopeId) || null
  const detailsId = `supply-order-details-${item.table}-${item.id}`
  const schedules = getProjectedSchedules(item, detailContext)
  const plannedSchedules = schedules.filter((schedule) => schedule.status === 'planned')
  const deliveredSchedules = schedules.filter((schedule) => schedule.status === 'delivered')
  const isBarMaterial = isPhysicalBarMaterial(item)
  const plannedBars = isBarMaterial ? barsFromSchedules(plannedSchedules, 'planned') : []
  const deliveredBars = isBarMaterial ? barsFromSchedules(deliveredSchedules, 'delivered') : []
  const remainingBars = isBarMaterial ? remainingPurchaseBars(item, deliveredBars) : []
  const characteristics = visibleCharacteristics(item.characteristics || [], item.item_name)

  return (
    <article
      data-focus-id={item.id}
      tabIndex={-1}
      className="border-t border-border/60 text-sm transition-colors duration-200 focus:outline-none data-[focus-active=true]:bg-blue-50 data-[focus-active=true]:ring-2 data-[focus-active=true]:ring-inset data-[focus-active=true]:ring-blue-600 motion-reduce:transition-none"
    >
      <div
        role="row"
        className="grid gap-x-3 gap-y-4 px-3 py-3.5 hover:bg-muted/20 md:grid-cols-2 xl:grid-cols-[minmax(120px,0.75fr)_minmax(210px,1.35fr)_85px_minmax(300px,1.8fr)_115px_40px] xl:items-start"
      >
        <div role="cell" className="min-w-0">
          <ColumnLabel>Машина / заявка</ColumnLabel>
          <Link
            href={`${ROUTES.SALES_PLAN}/${item.machine_id}`}
            className="block break-words font-semibold leading-5 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.machine_name}
          </Link>
          <Link
            href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`}
            className="mt-1 inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Открыть заявку для снабжения"
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            Открыть заявку
          </Link>
        </div>

        <div role="cell" className="min-w-0 md:col-span-2 xl:col-span-1">
          <ColumnLabel>Материал и характеристики</ColumnLabel>
          <div className="flex flex-wrap items-center gap-2">
            <div className="break-words font-semibold leading-5 text-foreground">{item.item_name}</div>
            <Badge variant="outline" className="border-border bg-background text-[11px] text-muted-foreground">
              {MATERIAL_CATEGORY_LABELS[item.category]}
            </Badge>
          </div>
          <CharacteristicList characteristics={characteristics} />
        </div>

        <div role="cell" className="min-w-0">
          <ColumnLabel>Потребность</ColumnLabel>
          <div className="font-semibold tabular-nums text-foreground">
            {formatAmount(item.to_order)} {item.unit}
          </div>
          {item.calculated_weight_kg ? (
            <div className="mt-1 text-xs tabular-nums text-muted-foreground">
              {formatAmount(item.calculated_weight_kg)} кг
            </div>
          ) : null}
        </div>

        <div role="cell" className="min-w-0 md:col-span-2 xl:col-span-1">
          <ColumnLabel>Поставка</ColumnLabel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <DeliveryMetric
              label="План поставки"
              value={`${formatAmount(plannedQuantity)} ${item.unit}`}
              detail={plannedBars.length > 0 ? formatBars(plannedBars) : formatPlannedDates(plannedSchedules)}
              emptyDetail="График не создан"
              tone={plannedQuantity > 0 ? 'info' : 'neutral'}
            />
            <DeliveryMetric
              label="Привезено"
              value={`${formatAmount(deliveredQuantity)} ${item.unit}`}
              detail={deliveredBars.length > 0 ? formatBars(deliveredBars) : deliveredQuantity > 0 ? 'Принято на склад' : null}
              emptyDetail="Пока не принято"
              tone={deliveredQuantity > 0 ? 'success' : 'neutral'}
            />
            <DeliveryMetric
              label="Осталось привезти"
              value={`${formatAmount(remainingToDeliver)} ${item.unit}`}
              detail={remainingBars.length > 0
                ? formatBars(remainingBars)
                : unscheduledQuantity > 0
                  ? `Без графика: ${formatAmount(unscheduledQuantity)} ${item.unit}`
                  : remainingToDeliver > 0
                    ? 'Объём уже в графике'
                    : null}
              emptyDetail="Поставка закрыта"
              tone={remainingToDeliver > 0 ? 'warning' : 'success'}
            />
          </div>
        </div>

        <div role="cell" className="min-w-0">
          <ColumnLabel>Статус</ColumnLabel>
          <div className="flex flex-wrap items-start gap-1.5 xl:flex-col">
            {returnedToTechnologist ? (
              <Badge variant="outline" className="whitespace-normal border-amber-300 bg-amber-50 text-amber-900">Возвращено технологу</Badge>
            ) : isCoveredByStock ? (
              <Badge variant="outline" className="whitespace-normal border-emerald-200 bg-emerald-50 text-emerald-700">Потребность закрыта</Badge>
            ) : isPartiallyOrdered ? (
              <Badge variant="outline" className="whitespace-normal border-amber-300 bg-amber-50 text-amber-950">
                Заказано {formatAmount(orderedQuantity)} из {formatAmount(item.to_order)} {item.unit}
              </Badge>
            ) : orderedQuantity <= 0.000001 && unscheduledQuantity > 0.000001 ? (
              <Badge variant="secondary">Не заказано</Badge>
            ) : (
              <Badge variant={statusVariant[item.order_status]}>{ORDER_STATUS_LABELS[item.order_status]}</Badge>
            )}
            {redeliveryQuantity > 0 && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-950">Нужно довезти</Badge>
            )}
          </div>
        </div>

        <div role="cell" className="flex items-end justify-end xl:items-start">
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            aria-label={`${detailsOpen ? 'Скрыть' : 'Открыть'} график поставки: ${item.item_name}, ${item.machine_name}`}
            title={detailsOpen ? 'Скрыть график' : 'Открыть график и действия'}
            onClick={() => setDetailsOpen((open) => !open)}
            className="rounded-xl"
          >
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${detailsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {detailsOpen && (
        <section id={detailsId} className="border-t border-border/60 bg-muted/15 p-3" aria-label={`График поставок: ${item.item_name}`}>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">График поставки</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Поставщик, объём и дата поступления. Приёмка выполняется на странице склада.</p>
              </div>
            </div>
            {!returnedToTechnologist && !isCoveredByStock && (
              <ReturnLongStockPositionButton
                requestItemTable={item.table}
                requestItemId={item.id}
                itemName={item.item_name}
                categoryLabel={MATERIAL_CATEGORY_LABELS[item.category]}
                planNumber={plan?.plan_number}
                versionNumber={plan?.version_number}
              />
            )}
          </div>

          {returnedToTechnologist ? (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span>
                <strong>Позиция исключена из активной закупки.</strong>{' '}
                {item.position_revision
                  ? <Link className="underline" href={`/requests/detail/${item.position_revision.department_request_id}`}>Открыть запрос технологу</Link>
                  : 'Сначала технолог должен утвердить новую версию карты раскроя.'}
              </span>
            </div>
          ) : isCoveredByStock ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Потребность уже закрыта. Новый график поставки не требуется.
            </div>
          ) : scopes.length > 0 ? (
            <div>
              {scopes.length > 1 && (
                <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" aria-label="Выбор даты графика поставки">
                  {scopes.map((scope) => (
                    <button
                      key={scope.id}
                      type="button"
                      aria-pressed={scope.id === activeScopeId}
                      onClick={() => setScopeState({ key: scopeKey, value: scope.id })}
                      className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                        scope.id === activeScopeId
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {scope.kind === 'unscheduled' ? 'Создать график' : scope.label.replace('График · ', '')}
                    </button>
                  ))}
                </div>
              )}

              {activeScope && activeScope.sharedItemCount > 1 && (
                <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                  Эта дата объединяет {activeScope.sharedItemCount} заявки. Изменение текущей строки не изменит остальные заявки и уже принятую поставку.
                </div>
              )}

              {activeScope && (
                <FactoryDeliveryEditor
                  key={`${item.table}:${item.id}:${activeScope.id}`}
                  aggregate={activeScope.aggregate}
                  factory={activeScope.factory}
                  suppliers={suppliers}
                  dateSlice={activeScope.dateSlice}
                  allowFinance={activeScope.kind !== 'unscheduled'}
                  mutationItems={activeScope.mutationItems}
                  mutationScope={activeScope.mutationScope}
                  compact
                />
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Поставка полностью принята или не требует нового графика.
            </div>
          )}
        </section>
      )}
    </article>
  )
}

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground xl:hidden">{children}</div>
}

function CharacteristicList({ characteristics }: { characteristics: SupplyOrderAggregateCharacteristic[] }) {
  if (characteristics.length === 0) return null
  return (
    <dl className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
      {characteristics.map((part) => (
        <div key={`${part.label}:${part.value}`} className="flex min-w-0 gap-1">
          <dt>{part.label}:</dt>
          <dd className="break-words font-medium text-foreground">{part.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function DeliveryMetric({ label, value, detail, emptyDetail, tone }: {
  label: string
  value: string
  detail: string | null
  emptyDetail: string
  tone: DeliveryMetricTone
}) {
  const toneClass = {
    neutral: 'border-border bg-background',
    info: 'border-sky-200 bg-sky-50/70',
    success: 'border-emerald-200 bg-emerald-50/70',
    warning: 'border-amber-200 bg-amber-50/70',
  }[tone]
  return (
    <div className={`min-w-0 rounded-xl border px-2.5 py-2 ${toneClass}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 break-words text-[11px] leading-4 text-muted-foreground">{detail || emptyDetail}</div>
    </div>
  )
}

function getProjectedSchedules(item: SupplyOrderItem, detailContext?: SupplyOrderDetailContext) {
  const projected = detailContext?.scopes
    .find((scope) => scope.kind === 'item_date')
    ?.factory.items.find((source) => source.table === item.table && source.id === item.id)
    ?.delivery_schedules
  return projected || item.delivery_schedules
}

function isPhysicalBarMaterial(item: SupplyOrderItem) {
  return item.category === 'circle'
    || item.category === 'knives'
    || (item.category === 'pipe' && item.pipe_type !== 'wire')
}

function barsFromSchedules(schedules: SupplyOrderDeliverySchedule[], status: 'planned' | 'delivered'): BarPart[] {
  const grouped = new Map<number, number>()
  for (const schedule of schedules) {
    const lengthMm = Number(status === 'delivered'
      ? schedule.received_piece_length_mm || schedule.planned_piece_length_mm || 0
      : schedule.planned_piece_length_mm || 0)
    if (lengthMm <= 0) continue
    const rawCount = status === 'delivered'
      ? schedule.allocated_piece_count
        ?? schedule.received_piece_count
        ?? ((schedule.allocated_physical_quantity ?? schedule.allocated_quantity ?? 0) / lengthMm)
      : schedule.planned_piece_count ?? (Number(schedule.quantity || 0) / lengthMm)
    const pieceCount = Math.max(Number(rawCount || 0), 0)
    if (pieceCount <= 0.000001) continue
    grouped.set(lengthMm, (grouped.get(lengthMm) || 0) + pieceCount)
  }
  return Array.from(grouped, ([lengthMm, pieceCount]) => ({ lengthMm, pieceCount }))
    .sort((left, right) => left.lengthMm - right.lengthMm)
}

function remainingPurchaseBars(item: SupplyOrderItem, delivered: BarPart[]) {
  const plan = item.long_stock_purchase_plan
  if (!plan?.components.length) return []
  const deliveredByLength = new Map(delivered.map((part) => [part.lengthMm, part.pieceCount]))
  return plan.components
    .map((part) => ({
      lengthMm: part.length_mm,
      pieceCount: Math.max(part.piece_count - (deliveredByLength.get(part.length_mm) || 0), 0),
    }))
    .filter((part) => part.pieceCount > 0.000001)
}

function formatBars(parts: BarPart[]) {
  return parts.map((part) => `${formatAmount(part.lengthMm)} мм × ${formatAmount(part.pieceCount)} ${barWord(part.pieceCount)}`).join('; ')
}

function barWord(count: number) {
  const rounded = Math.abs(Math.round(count))
  const remainder10 = rounded % 10
  const remainder100 = rounded % 100
  if (remainder10 === 1 && remainder100 !== 11) return 'хлыст'
  if (remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)) return 'хлыста'
  return 'хлыстов'
}

function formatPlannedDates(schedules: SupplyOrderDeliverySchedule[]) {
  const dates = Array.from(new Map(schedules.map((schedule) => [
    `${schedule.delivery_date}:${schedule.supplier_id || 'none'}`,
    `${formatShortDate(schedule.delivery_date)}${schedule.supplier_name ? ` · ${schedule.supplier_name}` : ''}`,
  ])).values())
  return dates.length > 0 ? dates.join('; ') : null
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00`))
}

function visibleCharacteristics(characteristics: SupplyOrderAggregateCharacteristic[], itemName: string) {
  return characteristics.filter((part) => (
    part.label !== 'Позиция'
    || part.value.trim().toLocaleLowerCase('ru') !== itemName.trim().toLocaleLowerCase('ru')
  ))
}

function sumSchedules(schedules: SupplyOrderDeliverySchedule[], status: 'planned' | 'delivered') {
  return schedules
    .filter((schedule) => schedule.status === status)
    .reduce((sum, schedule) => sum + Number(
      status === 'delivered'
        ? schedule.allocated_quantity ?? schedule.received_quantity ?? schedule.quantity ?? 0
        : schedule.quantity || 0,
    ), 0)
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}
