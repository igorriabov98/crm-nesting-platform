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
  disabled: boolean
  returnFocus: HTMLElement | null
  onValueChange: (key: string, value: string) => void
  onClose: () => void
  onConfirm: () => void
}

export function MaterialReceivingAllocationDialog({
  open,
  itemName,
  preview,
  values,
  disabled,
  returnFocus,
  onValueChange,
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
    allocatedLogical,
    futureScrap,
    allocatedPieces,
    freePieces,
    freeQuantity,
    invalidRows,
    exceedsReceipt,
    canConfirm,
  } = calculation

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
            {itemName}. Данные потребности взяты из заявок технологов. Предложение можно изменить перед приёмкой.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 border-b bg-muted/25 p-3 sm:grid-cols-5 sm:px-6">
          <Summary label="План поставки" value={`${formatAmount(preview.planned_quantity)} ${preview.unit}`} />
          <Summary
            label="Фактически приехало"
            value={isBar
              ? `${formatAmount(Number(preview.piece_count || 0))} шт × ${formatAmount(Number(preview.piece_length_mm || 0))} мм`
              : `${formatAmount(preview.received_quantity)} ${preview.unit}`}
            emphasis
          />
          <Summary label="Открыто по заявкам" value={`${formatAmount(preview.total_outstanding_quantity)} ${preview.unit}`} />
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
        </div>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-3 py-3 sm:px-6">
          <div className="hidden grid-cols-[minmax(230px,1.5fr)_repeat(3,minmax(100px,.65fr))_minmax(150px,.8fr)] gap-3 border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground lg:grid">
            <div>Машина и дата Заготовки</div>
            <div>Заявлено</div>
            <div>Закрыто</div>
            <div>Осталось</div>
            <div>{isBar ? 'Хлыстов в резерв' : 'Количество в резерв'}</div>
          </div>

          <div className="divide-y rounded-xl border">
            {rows.map((row) => (
              <div
                key={row.key}
                className={`grid gap-3 p-3 lg:grid-cols-[minmax(230px,1.5fr)_repeat(3,minmax(100px,.65fr))_minmax(150px,.8fr)] lg:items-center ${row.is_eligible ? 'bg-card' : 'bg-muted/40 text-muted-foreground'}`}
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

                <QuantityCell label="Заявлено технологом" value={row.requested_quantity} unit={preview.unit} />
                <div>
                  <div className="text-xs text-muted-foreground lg:hidden">Закрыто</div>
                  <div className="font-medium tabular-nums">{formatAmount(row.closed_quantity)} {preview.unit}</div>
                  <div className="text-[11px] text-muted-foreground">
                    склад {formatAmount(row.reserved_quantity)} · приходы {formatAmount(row.delivered_quantity)}
                  </div>
                </div>
                <QuantityCell label="Открытый остаток" value={row.outstanding_quantity} unit={preview.unit} strong />

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
              По заявкам закроется: <strong>{formatAmount(allocatedLogical)} {preview.unit}</strong>
              {isBar && futureScrap > 0 && <> · будущий отход <strong>{formatAmount(futureScrap)} {preview.unit}</strong></>}
            </div>
          </div>

          <div aria-live="polite" aria-atomic="true" className="mt-2 min-h-5 text-sm text-destructive">
            {invalidRows
              ? 'Проверьте значения: резерв не может превышать открытый остаток, а хлысты указываются целыми штуками.'
              : exceedsReceipt
                ? 'Распределено больше материала, чем фактически принято.'
                : selectedRows.length === 0
                  ? 'Распределите материал хотя бы на одну машину.'
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

function QuantityCell({ label, value, unit, strong = false }: { label: string; value: number; unit: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground lg:hidden">{label}</div>
      <div className={`${strong ? 'font-semibold text-foreground' : 'font-medium'} tabular-nums`}>{formatAmount(value)} {unit}</div>
    </div>
  )
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
