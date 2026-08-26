'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  getLongStockReceivingOptions,
  previewSingleLengthLongStockReceipt,
  receiveSingleLengthLongStockDelivery,
  type MaterialDeliveryAllocationInput,
  type MaterialDeliveryAllocationPreview,
  type MaterialReceivingItem,
} from '@/lib/actions/supply-orders'
import type { LongStockRequestItemTable } from '@/lib/supply-orders/long-stock-purchase-plan'
import { MaterialReceivingAllocationDialog } from './MaterialReceivingAllocationDialog'

type Props = {
  open: boolean
  requestItemTable: LongStockRequestItemTable
  requestItemId: string
  itemName?: string
  onOpenChange: (open: boolean) => void
  onReceived?: () => void
}

type AllocationState = {
  preview: MaterialDeliveryAllocationPreview
  scheduleId: string
  values: Record<string, string>
  returnFocus: HTMLElement | null
}

export function LongStockReceivingDialog({
  open,
  requestItemTable,
  requestItemId,
  itemName,
  onOpenChange,
  onReceived,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [options, setOptions] = useState<MaterialReceivingItem[]>([])
  const [selectedKey, setSelectedKey] = useState('')
  const [pieceLength, setPieceLength] = useState('')
  const [pieceCount, setPieceCount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [allocation, setAllocation] = useState<AllocationState | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setError(null)
    setOptions([])
    setSelectedKey('')
    setPieceLength('')
    setPieceCount('')
    setAllocation(null)
    void getLongStockReceivingOptions({ requestItemTable, requestItemId }).then((result) => {
      if (!active) return
      if (!result.success || !result.data?.length) {
        setError(result.error || 'Нет открытой поставки для приёмки')
        return
      }
      setOptions(result.data)
      const first = result.data[0]
      setSelectedKey(first.key)
      setPieceLength(first.planned_piece_length_mm ? String(first.planned_piece_length_mm) : '')
      setPieceCount(first.planned_piece_count ? String(first.planned_piece_count) : '')
    })
    return () => { active = false }
  }, [open, requestItemId, requestItemTable])

  const selected = useMemo(
    () => options.find((option) => option.key === selectedKey) || options[0] || null,
    [options, selectedKey],
  )
  const actualLength = numberValue(pieceLength)
  const actualCount = numberValue(pieceCount)
  const actualTotal = actualLength * actualCount
  const variance = selected ? actualTotal - selected.planned_quantity : 0

  function selectOption(key: string) {
    const option = options.find((row) => row.key === key)
    setSelectedKey(key)
    setPieceLength(option?.planned_piece_length_mm ? String(option.planned_piece_length_mm) : '')
    setPieceCount(option?.planned_piece_count ? String(option.planned_piece_count) : '')
    setAllocation(null)
  }

  function receiptInput(
    confirmedAllocations?: MaterialDeliveryAllocationInput[],
    scheduleId = selected?.schedule_id || null,
  ) {
    return {
      requestItemTable,
      requestItemId,
      scheduleId,
      receivedPieceLengthMm: actualLength,
      receivedPieceCount: actualCount,
      confirmedAllocations,
    }
  }

  function prepareReceipt() {
    if (!selected) return
    if (!Number.isFinite(actualLength) || actualLength <= 0) {
      setError('Укажите положительную фактическую длину хлыста')
      return
    }
    if (!Number.isInteger(actualCount) || actualCount <= 0) {
      setError('Количество хлыстов должно быть положительным целым числом')
      return
    }
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setError(null)
    startTransition(async () => {
      const result = await previewSingleLengthLongStockReceipt(receiptInput())
      if (!result.success || !result.data || !result.scheduleId) {
        setError(result.error || 'Не удалось проверить фактическую приёмку')
        return
      }
      setAllocation({
        preview: result.data,
        scheduleId: result.scheduleId,
        returnFocus,
        values: Object.fromEntries(result.data.allocations.map((row) => [
          `${row.table}:${row.id}`,
          String(row.suggested_piece_count || 0),
        ])),
      })
    })
  }

  function confirmReceipt() {
    if (!allocation) return
    const confirmedAllocations: MaterialDeliveryAllocationInput[] = allocation.preview.allocations
      .filter((row) => row.is_eligible)
      .map((row) => ({
        mode: 'whole_bar' as const,
        table: row.table,
        id: row.id,
        piece_count: numberValue(allocation.values[`${row.table}:${row.id}`] || '0'),
      }))
    startTransition(async () => {
      const result = await receiveSingleLengthLongStockDelivery(receiptInput(
        confirmedAllocations,
        allocation.scheduleId,
      ))
      if (!result.success) {
        setError(result.error || 'Не удалось принять материал')
        setAllocation(null)
        return
      }
      toast.success('Фактическая длина принята на склад')
      setAllocation(null)
      onOpenChange(false)
      onReceived?.()
      router.refresh()
    })
  }

  return (
    <>
      <Dialog open={open && !allocation} onOpenChange={(nextOpen) => !isPending && onOpenChange(nextOpen)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Фактическая приёмка длинномера</DialogTitle>
            <DialogDescription>
              {itemName || selected?.item_name || 'Материал'}. За одну операцию принимается только одна физическая длина.
            </DialogDescription>
          </DialogHeader>

          {options.length > 1 && (
            <label className="grid gap-1 text-sm font-medium">
              Строка графика поставки
              <select
                value={selectedKey}
                disabled={isPending}
                onChange={(event) => selectOption(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3"
              >
                {options.map((option) => (
                  <option key={option.key} value={option.key}>
                    {formatDate(option.delivery_date)} · {formatNumber(option.planned_quantity)} мм
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected && (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-lg border bg-muted/25 p-3 sm:grid-cols-3">
                <Metric label="Плановый метраж" value={`${formatNumber(selected.planned_quantity)} мм`} />
                <Metric
                  label="Состав закупки"
                  value={selected.purchase_components.length
                    ? selected.purchase_components.map((row) => `${formatNumber(row.length_mm)} × ${row.piece_count}`).join(' + ')
                    : 'Не разбит по длинам'}
                />
                <Metric label="Завод" value={selected.factory_name} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  Фактическая длина одного хлыста, мм
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pieceLength}
                    disabled={isPending}
                    onChange={(event) => { setPieceLength(event.target.value); setAllocation(null) }}
                    className="h-10 rounded-md border border-input bg-background px-3 tabular-nums"
                  />
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  Количество хлыстов, шт
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={pieceCount}
                    disabled={isPending}
                    onChange={(event) => { setPieceCount(event.target.value); setAllocation(null) }}
                    className="h-10 rounded-md border border-input bg-background px-3 tabular-nums"
                  />
                </label>
              </div>

              <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
                <Metric label="Фактический приход" value={`${formatNumber(actualTotal)} мм`} />
                <Metric label="Отклонение" value={`${variance > 0 ? '+' : ''}${formatNumber(variance)} мм`} />
                <Metric
                  label="План строки"
                  value={selected.planned_piece_length_mm && selected.planned_piece_count
                    ? `${formatNumber(selected.planned_piece_length_mm)} × ${selected.planned_piece_count}`
                    : 'По утверждённой раскладке'}
                />
              </div>
            </div>
          )}

          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="button" disabled={isPending || !selected} onClick={prepareReceipt}>
              <PackageCheck className="size-4" />
              {isPending ? 'Проверка…' : 'Проверить распределение'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {allocation && selected && (
        <MaterialReceivingAllocationDialog
          open
          itemName={selected.item_name}
          preview={allocation.preview}
          values={allocation.values}
          disabled={isPending}
          returnFocus={allocation.returnFocus}
          onValueChange={(key, value) => setAllocation((current) => current
            ? { ...current, values: { ...current.values, [key]: value } }
            : current)}
          onClose={() => setAllocation(null)}
          onConfirm={confirmReceipt}
        />
      )}
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function numberValue(value: string) {
  return Number(String(value || '').replace(',', '.'))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0))
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`))
}
