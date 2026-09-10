'use client'

import { AlertTriangle, CalendarClock, CheckCircle2, PackageOpen } from 'lucide-react'
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
import type { MaterialDeliveryAllocationPreview } from '@/lib/actions/supply-orders'
import { calculateManualAllocation } from '@/lib/supply-orders/manual-allocation'

type Props = {
  open: boolean
  itemName: string
  preview: MaterialDeliveryAllocationPreview
  values: Record<string, string>
  reconciliationReason?: string
  disabled: boolean
  returnFocus: HTMLElement | null
  onValueChange: (key: string, value: string) => void
  onReconciliationReasonChange?: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}

export function MaterialReceivingAllocationDialog({
  open,
  itemName,
  preview,
  values,
  reconciliationReason = '',
  disabled,
  returnFocus,
  onValueChange,
  onReconciliationReasonChange = () => undefined,
  onClose,
  onConfirm,
}: Props) {
  const isBar = preview.mode === 'whole_bar'
  const calculation = calculateManualAllocation({
    mode: preview.mode,
    receivedQuantity: preview.received_quantity,
    pieceLengthMm: preview.piece_length_mm,
    pieceCount: preview.piece_count,
    rows: preview.allocations.map((row) => {
      const key = `${row.table}:${row.id}`
      const value = Number((values[key] || '0').replace(',', '.'))
      const max = isBar ? Number(row.needed_piece_count || 0) : row.outstanding_quantity
      return {
        ...row,
        key,
        value,
        max,
        isEligible: row.is_eligible,
        outstandingQuantity: row.outstanding_quantity,
      }
    }),
  })
  const {
    rows,
    selectedRows,
    allocatedPhysical,
    allocatedPieces,
    freePieces,
    freeQuantity,
    invalidRows,
    exceedsReceipt,
    canConfirm: allocationCanConfirm,
  } = calculation
  const futureImpact = isBar ? { reduction: 0, protected: 0 } : rows.reduce((totals, row) => {
    if (!row.is_eligible || row.value <= 0) return totals
    const overlap = Math.min(row.logical, row.future_planned_quantity)
    const reduction = Math.min(overlap, row.future_reducible_quantity)
    return {
      reduction: totals.reduction + reduction,
      protected: totals.protected + Math.max(overlap - reduction, 0),
    }
  }, { reduction: 0, protected: 0 })
  const touchesFutureSchedule = futureImpact.reduction + futureImpact.protected > 0.000001
  const normalizedReason = reconciliationReason.trim()
  const reasonIsValid = !touchesFutureSchedule
    || (normalizedReason.length >= 3 && normalizedReason.length <= 2000)
  const canConfirm = allocationCanConfirm && reasonIsValid
  const hasLengthMismatch = isBar
    && preview.planned_piece_length_mm !== null
    && preview.piece_length_mm !== null
    && preview.planned_piece_length_mm !== preview.piece_length_mm

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !disabled && onClose()}>
      <DialogContent
        finalFocus={() => returnFocus}
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[min(1120px,calc(100%-2rem))]"
      >
        <DialogHeader className="border-b px-4 py-4 pr-12 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg sm:text-xl">Распределение принятого материала</DialogTitle>
            {(preview.has_shortage || preview.has_priority_tie) && (
              <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-900">
                <AlertTriangle className="size-3.5" />
                Нужен выбор оператора
              </Badge>
            )}
          </div>
          <DialogDescription>
            {itemName}. Показан физический план снабжения и ранее принятый материал. Распределение текущего прихода можно изменить перед приёмкой.
          </DialogDescription>
          {hasLengthMismatch && (
            <div role="alert" className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Длина отличается: заказано{' '}
                <strong className="tabular-nums">{formatAmount(preview.planned_piece_length_mm!)} мм</strong>, принято{' '}
                <strong className="tabular-nums">{formatAmount(preview.piece_length_mm!)} мм</strong>.
              </span>
            </div>
          )}
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 border-b bg-muted/25 p-3 sm:grid-cols-3 sm:px-6 xl:grid-cols-6">
          <Summary label="План текущей поставки" value={`${formatAmount(preview.planned_quantity)} ${preview.unit}`} />
          {isBar && preview.planned_piece_length_mm !== null && preview.planned_piece_count !== null && (
            <Summary
              label="Заказано хлыстов"
              value={`${formatAmount(preview.planned_piece_count)} шт × ${formatAmount(preview.planned_piece_length_mm)} мм`}
            />
          )}
          <Summary
            label="Фактически приехало"
            value={isBar
              ? `${formatAmount(Number(preview.piece_count || 0))} шт × ${formatAmount(Number(preview.piece_length_mm || 0))} мм`
              : `${formatAmount(preview.received_quantity)} ${preview.unit}`}
            emphasis
          />
          <Summary
            label="Осталось принять по заявкам"
            value={formatSupplyProgress(
              preview.total_supply_outstanding_quantity,
              preview.unit,
              preview.total_supply_outstanding_piece_count,
            )}
          />
          <Summary
            label="В резерв"
            value={isBar
              ? `${formatAmount(allocatedPieces)} шт / ${formatAmount(allocatedPhysical)} ${preview.unit}`
              : `${formatAmount(allocatedPhysical)} ${preview.unit}`}
          />
          <Summary
            label="Свободный склад"
            value={isBar
              ? `${formatAmount(freePieces)} шт / ${formatAmount(freeQuantity)} ${preview.unit}`
              : `${formatAmount(freeQuantity)} ${preview.unit}`}
          />
          {!isBar && (
            <Summary
              label="Уменьшится будущий график"
              value={`${formatAmount(futureImpact.reduction)} ${preview.unit}`}
            />
          )}
          {!isBar && (
            <Summary
              label="Защищено в начатом рейсе"
              value={`${formatAmount(futureImpact.protected)} ${preview.unit}`}
            />
          )}
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 py-3 sm:px-6">
          <div className="hidden grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(95px,.62fr))_minmax(145px,.8fr)] gap-3 border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground lg:grid">
            <div>Машина и дата Заготовки</div>
            <div>Заявлено к поставке</div>
            <div>Принято ранее</div>
            <div>Осталось принять</div>
            <div>Будущий график</div>
            <div>{isBar ? 'Хлыстов в резерв' : 'Количество в резерв'}</div>
          </div>

          <div className="divide-y rounded-xl border">
            {rows.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                Открытых потребностей нет. После подтверждения весь приход останется на свободном складе.
              </div>
            )}
            {rows.map((row) => (
              <div
                key={row.key}
                className={`grid gap-3 p-3 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(95px,.62fr))_minmax(145px,.8fr)] lg:items-center ${row.is_eligible ? 'bg-card' : 'bg-muted/40 text-muted-foreground'}`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-words font-semibold text-foreground">{row.machine_name}</span>
                    {row.is_source && <Badge variant="secondary">Исходная заявка</Badge>}
                  </div>
                  <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CalendarClock className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Заготовка: {row.cutting_date ? formatDate(row.cutting_date) : 'дата не указана'}
                      <span className="block sm:inline"> · Мат.план: {row.material_date ? formatDate(row.material_date) : 'не указан'}</span>
                    </span>
                  </div>
                  {row.unavailable_reason && (
                    <p className="mt-1 text-xs font-medium text-amber-800">{row.unavailable_reason}</p>
                  )}
                </div>

                <SupplyProgressCell
                  label="Заявлено к поставке"
                  quantity={row.supply_requested_quantity}
                  unit={preview.unit}
                  pieceCount={row.supply_requested_piece_count}
                />
                <SupplyProgressCell
                  label="Принято ранее"
                  quantity={row.supply_delivered_quantity}
                  unit={preview.unit}
                  pieceCount={row.supply_delivered_piece_count}
                />
                <SupplyProgressCell
                  label="Осталось принять"
                  quantity={row.supply_outstanding_quantity}
                  unit={preview.unit}
                  pieceCount={row.supply_outstanding_piece_count}
                  strong
                />

                <div>
                  <div className="text-xs text-muted-foreground lg:hidden">Будущий график</div>
                  <div className="font-medium tabular-nums">
                    {formatAmount(row.future_planned_quantity)} {preview.unit}
                  </div>
                  {row.future_schedules.length > 0 && (
                    <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                      {row.future_schedules.map((schedule) => (
                        <div key={schedule.schedule_id}>
                          {formatDate(schedule.delivery_date)} · {schedule.supplier_name || 'Без поставщика'}
                          {schedule.trip_status && ` · ${tripStatusLabel(schedule.trip_status)}`}
                          {schedule.protected_quantity > 0
                            ? ` · защищено ${formatAmount(schedule.protected_quantity)} ${preview.unit}`
                            : ` · можно уменьшить до ${formatAmount(schedule.reducible_quantity)} ${preview.unit}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground" htmlFor={`receipt-allocation-${row.id}`}>
                    {isBar ? 'Хлыстов для машины' : 'Резерв из прихода'}
                  </label>
                  <input
                    id={`receipt-allocation-${row.id}`}
                    type="number"
                    min="0"
                    max={row.max}
                    step={isBar ? '1' : '0.01'}
                    value={values[row.key] ?? '0'}
                    disabled={disabled || !row.is_eligible}
                    aria-describedby={`receipt-allocation-help-${row.id}`}
                    aria-invalid={!row.isValid}
                    onChange={(event) => onValueChange(row.key, event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <p id={`receipt-allocation-help-${row.id}`} className="mt-1 text-[11px] text-muted-foreground">
                    {isBar
                      ? `не больше ${formatAmount(row.needed_piece_count || 0)} шт. · ${formatAmount(row.physical)} ${preview.unit} физически`
                      : `не больше ${formatAmount(row.outstanding_quantity)} ${preview.unit}`}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <PackageOpen className="mr-1.5 inline size-4" />
              Нераспределённый приход останется свободным:{' '}
              <strong>
                {isBar && `${formatAmount(freePieces)} шт / `}{formatAmount(freeQuantity)} {preview.unit}
              </strong>
            </div>
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
              Будет принято по заявкам:{' '}
              <strong>{formatSupplyProgress(allocatedPhysical, preview.unit, isBar ? allocatedPieces : null)}</strong>
            </div>
          </div>

          {touchesFutureSchedule && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <label htmlFor="receipt-reconciliation-reason" className="text-sm font-semibold text-amber-950">
                Причина изменения будущего графика
              </label>
              <textarea
                id="receipt-reconciliation-reason"
                value={reconciliationReason}
                disabled={disabled}
                minLength={3}
                maxLength={2000}
                rows={3}
                aria-invalid={!reasonIsValid}
                aria-describedby="receipt-reconciliation-reason-help"
                onChange={(event) => onReconciliationReasonChange(event.target.value)}
                className="mt-1 w-full resize-y rounded-md border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-amber-400/30 disabled:opacity-60"
                placeholder="Почему текущий приход бронируется вместо будущей поставки"
              />
              <p id="receipt-reconciliation-reason-help" className="mt-1 text-xs text-amber-900">
                Обязательно от 3 до 2000 символов. Финансовые документы и договорённости с поставщиком CRM не изменяет.
              </p>
            </div>
          )}

          <div aria-live="polite" aria-atomic="true" className="mt-2 min-h-5 text-sm text-destructive">
            {invalidRows
              ? 'Проверьте значения: резерв не может превышать открытый остаток, а хлысты указываются целыми штуками.'
              : exceedsReceipt
                ? 'Распределено больше материала, чем фактически принято.'
                : isBar && selectedRows.length === 0
                  ? 'Распределите материал хотя бы на одну машину.'
                  : !reasonIsValid
                    ? 'Укажите причину изменения будущего графика (от 3 до 2000 символов).'
                  : ''}
          </div>
        </div>

        <DialogFooter className="m-0 px-4 sm:px-6">
          <Button type="button" variant="outline" disabled={disabled} onClick={onClose}>Отмена</Button>
          <Button type="button" disabled={disabled || !canConfirm} onClick={onConfirm}>
            <CheckCircle2 className="size-4" />
            {disabled ? 'Приём...' : 'Подтвердить приёмку'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Summary({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${emphasis ? 'border-primary/30 bg-primary/5' : 'bg-card'}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function SupplyProgressCell({
  label,
  quantity,
  unit,
  pieceCount,
  strong = false,
}: {
  label: string
  quantity: number
  unit: string
  pieceCount: number | null
  strong?: boolean
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground lg:hidden">{label}</div>
      <div className={`${strong ? 'font-semibold text-foreground' : 'font-medium'} tabular-nums`}>
        {formatSupplyProgress(quantity, unit, pieceCount)}
      </div>
    </div>
  )
}

export function formatSupplyProgress(quantity: number, unit: string, pieceCount: number | null) {
  return pieceCount === null
    ? `${formatAmount(quantity)} ${unit}`
    : `${formatAmount(quantity)} ${unit} / ${formatAmount(pieceCount)} шт`
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function tripStatusLabel(status: string) {
  if (status === 'needed') return 'рейс нужен'
  if (status === 'found') return 'рейс найден'
  if (status === 'in_transit') return 'в пути'
  if (status === 'completed') return 'рейс завершён'
  return status
}
