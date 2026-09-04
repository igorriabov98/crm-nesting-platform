'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  CalendarDays,
  CalendarX2,
  Check,
  FileText,
  PackageCheck,
  TriangleAlert,
  Warehouse,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { MATERIAL_CATEGORY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { ROUTES } from '@/lib/constants/routes'
import type { SupplyOrderDeliverySchedule, SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { formatLongStockPurchaseComposition } from '@/lib/supply-orders/long-stock-purchase-plan'
import { FactoryDeliveryEditor } from './SupplyOrderSummaryPage'
import { ReturnLongStockPositionButton } from './ReturnLongStockPositionButton'
import type { SupplyOrderDetailContext } from './supply-order-view'

type OrderItemRowProps = {
  item: SupplyOrderItem
  suppliers: SupplierWithRelations[]
  detailContext?: SupplyOrderDetailContext
}

const statusVariant = {
  pending: 'secondary',
  ordered: 'default',
  delivered: 'outline',
  cancelled: 'outline',
} as const

export function OrderItemRow({ item, suppliers, detailContext }: OrderItemRowProps) {
  const plan = item.long_stock_purchase_plan
  const requiresRecalculation = plan?.cutting_status === 'requires_recalculation'
  const plannedQuantity = detailContext?.plannedQuantity ?? sumSchedules(item.delivery_schedules, 'planned')
  const deliveredQuantity = detailContext?.deliveredQuantity ?? sumSchedules(item.delivery_schedules, 'delivered')
  const unscheduledQuantity = detailContext?.unscheduledQuantity
    ?? Math.max(item.to_order - plannedQuantity - deliveredQuantity, 0)
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
  const activeScopeId = scopeState.key === scopeKey && scopes.some((scope) => scope.id === scopeState.value)
    ? scopeState.value
    : defaultScopeId
  const activeScope = scopes.find((scope) => scope.id === activeScopeId) || null

  return (
    <article
      data-focus-id={item.id}
      tabIndex={-1}
      className="border-t border-border/60 p-4 text-sm transition-colors duration-200 hover:bg-muted/20 focus:outline-none data-[focus-active=true]:bg-blue-50 data-[focus-active=true]:ring-2 data-[focus-active=true]:ring-inset data-[focus-active=true]:ring-blue-600 motion-reduce:transition-none"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.25fr)_112px_minmax(180px,0.8fr)_minmax(190px,0.9fr)_170px] lg:items-start">
        <div className="min-w-0 rounded-xl bg-muted/25 p-3 lg:bg-transparent lg:p-0">
          <Link
            href={`${ROUTES.SALES_PLAN}/${item.machine_id}`}
            className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {item.machine_name}
          </Link>
          <div className="mt-1 break-words font-medium text-foreground">{item.item_name}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="outline" className="border-border bg-background text-muted-foreground">
              {MATERIAL_CATEGORY_LABELS[item.category]}
            </Badge>
            {item.supplier_name && (
              <Badge variant="outline" className="max-w-full truncate border-sky-200 bg-sky-50 text-sky-800">
                {item.supplier_name}
              </Badge>
            )}
          </div>
        </div>

        <Link
          href={`${ROUTES.SUPPLY_REQUEST}/${item.request_id}`}
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-border bg-background px-3 text-xs font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          title="Открыть заявку для снабжения"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Заявка
        </Link>

        <div className="rounded-xl border border-border/60 bg-background p-3 text-xs">
          <div className="text-muted-foreground">Потребность</div>
          <div className="mt-1 font-semibold tabular-nums text-foreground">
            {formatAmount(item.to_order)} {item.unit}
          </div>
          {item.calculated_weight_kg && (
            <div className="mt-0.5 text-muted-foreground">Вес: {formatAmount(item.calculated_weight_kg)} кг</div>
          )}
          {plan?.components.length ? (
            <div className="mt-2 leading-5 text-sky-800">
              К закупке: {formatLongStockPurchaseComposition(plan.components)}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border/60 bg-background p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Warehouse className="h-3.5 w-3.5" aria-hidden="true" />
            На складе доступно
          </div>
          {item.stock_available !== null
            ? stockBreakdown(item) || (
              <div className="mt-1 font-semibold tabular-nums text-foreground">
                {formatAmount(item.stock_available)} {item.stock_unit || item.unit}
              </div>
            )
            : <div className="mt-1 text-foreground">Нет остатка</div>}
          <div className="mt-2 leading-5">Доступные остатки и длины показаны только справочно.</div>
        </div>

        <div className="flex flex-wrap items-start gap-1.5 lg:justify-end">
          {requiresRecalculation ? (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Требует пересчёта</Badge>
          ) : isCoveredByStock ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Закрыто складом</Badge>
          ) : isPartiallyOrdered ? (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-950">
              Заказано частично — {formatAmount(orderedQuantity)} из {formatAmount(item.to_order)} {item.unit}
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

      {!isCoveredByStock && (
        <section className="mt-4 overflow-hidden rounded-2xl border border-border/70 bg-muted/15" aria-label={`График поставок: ${item.item_name}`}>
          <div className="flex flex-col gap-3 border-b border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
                План и факт поставки
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">Приёмка выполняется только на странице склада.</p>
            </div>
            {plan?.cutting_status === 'plan_approved' && (
              <ReturnLongStockPositionButton
                requestItemTable={item.table}
                requestItemId={item.id}
                planNumber={plan.plan_number}
                versionNumber={plan.version_number}
              />
            )}
          </div>

          <div className="grid gap-2 p-3 sm:grid-cols-3">
            <StatusBox icon={<Check className="h-4 w-4" />} label="План" value={`${formatAmount(plannedQuantity)} ${item.unit}`} tone="info" />
            <StatusBox icon={<PackageCheck className="h-4 w-4" />} label="Факт" value={`${formatAmount(deliveredQuantity)} ${item.unit}`} tone="success" />
            <StatusBox
              icon={<CalendarX2 className="h-4 w-4" />}
              label={redeliveryQuantity > 0 ? 'Нужно довезти' : 'Остаток без графика'}
              value={`${formatAmount(unscheduledQuantity)} ${item.unit}`}
              tone={unscheduledQuantity > 0 ? 'warning' : 'default'}
            />
          </div>

          {requiresRecalculation ? (
            <div className="mx-3 mb-3 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span><strong>Редактирование заблокировано.</strong> Сначала технолог должен утвердить новую версию карты раскроя.</span>
            </div>
          ) : scopes.length > 0 ? (
            <div className="border-t border-border/60 p-3">
              {scopes.length > 1 && (
                <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" aria-label="Область графика поставки">
                  {scopes.map((scope) => (
                    <button
                      key={scope.id}
                      type="button"
                      aria-pressed={scope.id === activeScopeId}
                      onClick={() => setScopeState({ key: scopeKey, value: scope.id })}
                      className={`min-h-11 shrink-0 rounded-lg px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                        scope.id === activeScopeId
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              )}

              {activeScope && activeScope.sharedItemCount > 1 && (
                <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                  <strong>Общий график: {activeScope.sharedItemCount} заявок.</strong>{' '}
                  Это изменение затронет только текущую заявку: её плановая часть будет отделена, а другие даты, заявки и принятые поставки сохранятся.
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
                />
              )}
            </div>
          ) : (
            <div className="mx-3 mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Поставка полностью принята или не требует нового графика. План и факт доступны только для просмотра.
            </div>
          )}
        </section>
      )}
    </article>
  )
}

function StatusBox({ icon, label, value, tone }: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'default' | 'info' | 'success' | 'warning'
}) {
  const toneClass = {
    default: 'bg-muted text-muted-foreground',
    info: 'bg-sky-500/10 text-sky-700',
    success: 'bg-emerald-500/10 text-emerald-700',
    warning: 'bg-amber-500/10 text-amber-800',
  }[tone]
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneClass}`}>{icon}</span>
        {label}
      </div>
      <div className="mt-2 font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
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

function stockBreakdown(item: SupplyOrderItem) {
  const isPieceCategory = item.category === 'pipe' || item.category === 'circle' || item.category === 'knives'
  const lengthItems = isPieceCategory ? item.stock_items.filter((row) => row.piece_length_mm !== null) : []
  if (lengthItems.length === 0) return null
  return (
    <div className="mt-1 space-y-1 font-medium text-foreground">
      {lengthItems.map((row) => (
        <div key={row.id}>
          {formatAmount(row.piece_length_mm ?? 0)} мм × {formatAmount(row.total_quantity)} {row.unit || item.unit}
          <span className="font-normal text-muted-foreground"> (доступно: {formatAmount(row.available_quantity)} {row.unit || item.unit})</span>
        </div>
      ))}
    </div>
  )
}
