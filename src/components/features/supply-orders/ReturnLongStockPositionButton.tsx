'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  previewSupplyPositionReturn,
  returnSupplyPositionToTechnologist,
} from '@/lib/actions/supply-orders'
import {
  isSupplyPositionTable,
  type SupplyPositionReturnPreview,
} from '@/lib/supply-orders/position-revisions'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  requestItemTable: string
  requestItemId: string
  itemName?: string
  categoryLabel?: string
  planNumber?: number
  versionNumber?: number
}

export function ReturnSupplyPositionButton({
  requestItemTable,
  requestItemId,
  itemName,
  categoryLabel,
  planNumber,
  versionNumber,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<SupplyPositionReturnPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [confirmExternalOrder, setConfirmExternalOrder] = useState(false)
  const [pending, startTransition] = useTransition()

  if (!isSupplyPositionTable(requestItemTable)) return null

  const loadPreview = () => {
    setPreview(null)
    setPreviewError(null)
    setConfirmExternalOrder(false)
    startTransition(async () => {
      const result = await previewSupplyPositionReturn({ requestItemTable, requestItemId })
      if (!result.success) {
        setPreviewError(result.error)
        return
      }
      setPreview(result.data)
    })
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    startTransition(async () => {
      const result = await returnSupplyPositionToTechnologist({
        requestItemTable,
        requestItemId,
        reason,
        confirmExternalOrder,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось вернуть позицию технологу')
        loadPreview()
        return
      }
      toast.success(result.data.mode === 'long_stock_recalculation'
        ? 'Позиция возвращена технологу на пересчёт карты'
        : 'Позиция возвращена технологу на исправление')
      setOpen(false)
      setReason('')
      setPreview(null)
      router.refresh()
    })
  }

  const impactRows = preview ? [
    ['Графики к отмене', preview.impacts.schedules_to_cancel],
    ['Резервы к освобождению', preview.impacts.reservations_to_release],
    ['Рейсы для отсоединения', preview.impacts.trips_to_detach],
    ['Расходы к отклонению', preview.impacts.finance_expenses_to_reject],
  ] as const : []

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (pending) return
      setOpen(nextOpen)
      if (nextOpen) loadPreview()
    }}>
      <DialogTrigger render={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-amber-300 text-amber-900 hover:bg-amber-50"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Вернуть технологу
        </Button>
      } />
      <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 bg-white p-0 sm:max-w-xl">
        <form onSubmit={submit}>
          <DialogHeader className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <DialogTitle className="text-xl text-slate-950">Вернуть позицию технологу</DialogTitle>
            <DialogDescription>
              {[categoryLabel, itemName].filter(Boolean).join(' · ') || 'Одна позиция заявки'}
              {planNumber && versionNumber ? ` · карта №${planNumber}, версия ${versionNumber}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 px-5 py-5 sm:px-6">
            {pending && !preview && !previewError && (
              <p className="text-sm text-slate-500">Проверяем приёмку, графики, рейсы, склад и финансы…</p>
            )}
            {previewError && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {previewError}
              </div>
            )}
            {preview?.blockers.length ? (
              <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="size-4" />Возврат сейчас невозможен</p>
                <ul className="list-disc space-y-1 pl-5">
                  {preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}
                </ul>
              </div>
            ) : preview ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-900">Последствия возврата</p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  {impactRows.map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-slate-200 bg-white p-2">
                      <dt>{label}</dt><dd className="mt-1 text-lg font-bold tabular-nums text-slate-900">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs leading-5 text-slate-600">
                  {preview.mode === 'long_stock_recalculation'
                    ? 'Для утверждённой карты сохранится специализированный сценарий пересчёта длинномера.'
                    : 'Исходная позиция исчезнет из активного объёма закупки. Новая появится после повторной проверки склада.'}
                </p>
              </div>
            ) : null}

            {preview?.requires_external_order_confirmation && (
              <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <Checkbox
                  checked={confirmExternalOrder}
                  onCheckedChange={(checked) => setConfirmExternalOrder(checked === true)}
                  aria-label="Подтвердить отмену внешнего заказа"
                />
                <span><strong>Позиция уже заказана поставщику.</strong> Я подтверждаю, что внешний заказ нужно отменить отдельно.</span>
              </label>
            )}

            <div className="space-y-2">
              <Label htmlFor={`supply-position-return-reason-${requestItemId}`}>Причина возврата</Label>
              <Textarea
                id={`supply-position-return-reason-${requestItemId}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                minLength={3}
                maxLength={2000}
                required
                rows={5}
                className="min-h-28 resize-y"
                placeholder="Что именно технологу нужно исправить"
              />
            </div>
          </div>
          <DialogFooter className="mx-0 mb-0 rounded-none px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Отмена</Button>
            <Button
              type="submit"
              disabled={pending || !preview?.eligible || reason.trim().length < 3 || (preview.requires_external_order_confirmation && !confirmExternalOrder)}
              className="bg-amber-700 text-white hover:bg-amber-800"
            >
              {pending ? 'Возвращаем…' : 'Вернуть технологу'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** @deprecated Compatibility name for the former long-stock-only button. */
export const ReturnLongStockPositionButton = ReturnSupplyPositionButton
