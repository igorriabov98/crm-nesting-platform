'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Clock3, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ROUTES } from '@/lib/constants/routes'
import { submitBusinessScrapCorrection, type BusinessScrapWorkspace } from '@/lib/actions/business-scrap-corrections'
import { formatProductionMonth } from '@/lib/utils/production-months'

type Props = { workspace: BusinessScrapWorkspace }

function amount(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}
function fieldKey(table: string, itemId: string, inventoryId: string) {
  return table + ':' + itemId + ':' + inventoryId
}
function itemKey(table: string, itemId: string) {
  return table + ':' + itemId
}

export function BusinessScrapWorkspaceView({ workspace }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [reason, setReason] = useState('')
  const [removed, setRemoved] = useState<Set<string>>(new Set())
  const [additions, setAdditions] = useState<Record<string, string>>({})
  const isInitial = workspace.request.status === 'pending_stock_check' || workspace.request.status === 'stock_checked'
  const locked = Boolean(workspace.pendingCorrection)
  const changes = useMemo(() => workspace.items.flatMap((item) => {
    const removeIds = item.reservations.filter((reservation) => removed.has(reservation.id)).map((reservation) => reservation.id)
    const itemAdditions = item.stockItems.flatMap((stock) => {
      const quantity = Number(additions[fieldKey(item.table, item.id, stock.id)] || 0)
      return quantity > 0 ? [{ inventory_id: stock.id, quantity }] : []
    })
    if (removeIds.length === 0 && itemAdditions.length === 0) return []
    return [{
      request_item_table: item.table,
      request_item_id: item.id,
      remove_reservation_ids: removeIds,
      additions: itemAdditions,
    }]
  }), [additions, removed, workspace.items])

  const submit = () => {
    if (changes.length === 0) {
      toast.error('Выберите, что добавить или снять')
      return
    }
    if (reason.trim().length < 3) {
      toast.error('Укажите причину корректировки')
      return
    }
    startTransition(async () => {
      const result = await submitBusinessScrapCorrection({
        requestId: workspace.request.id,
        reason,
        changes,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось отправить корректировку')
        return
      }
      toast.success('Запрос отправлен начальнику снабжения')
      setReason('')
      setRemoved(new Set())
      setAdditions({})
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Link href={ROUTES.BUSINESS_SCRAP_RESERVATIONS} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-[#1B3A6B]">
        <ArrowLeft className="h-4 w-4" /> К списку машин
      </Link>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">Бронь делового остатка</div>
            <h1 className="mt-2 text-3xl font-bold text-[#1B3A6B]">{workspace.machine.name}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {workspace.machine.factoryName || 'Завод не указан'}
              {workspace.machine.productionMonth ? ' · ' + formatProductionMonth(workspace.machine.productionMonth) : ''}
            </p>
          </div>
          <Badge variant="outline" className={isInitial ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>
            {isInitial ? 'Первичная бронь' : 'Передана снабжению'}
          </Badge>
        </div>
        {isInitial && (
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm text-blue-900">Первичная бронь выполняется без согласования по существующему безопасному процессу.</p>
            <Link href={ROUTES.SUPPLY_REQUEST + '/' + workspace.request.id} className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[#1B3A6B] px-4 text-sm font-semibold text-white">
              Открыть первичную бронь
            </Link>
          </div>
        )}
        {workspace.pendingCorrection && (
          <div className="mt-5 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">Корректировка ожидает решения</div>
              <div className="mt-1 text-sm">Причина: {workspace.pendingCorrection.reason}</div>
              <div className="mt-1 text-xs">Старая бронь действует, новые остатки временно удерживаются.</div>
            </div>
          </div>
        )}
      </section>

      {!isInitial && workspace.items.map((item) => {
        const removedQuantity = item.reservations.filter((reservation) => removed.has(reservation.id)).reduce((sum, reservation) => sum + reservation.quantity, 0)
        const addedQuantity = item.stockItems.reduce((sum, stock) => sum + Number(additions[fieldKey(item.table, item.id, stock.id)] || 0), 0)
        const proposed = Math.max(item.currentReserved - removedQuantity + addedQuantity, 0)
        return (
          <section key={itemKey(item.table, item.id)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{item.categoryLabel}</div>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{item.materialName}</h2>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500">Нужно</div><div className="mt-1 font-semibold">{amount(item.needed)} {item.unit}</div></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-slate-500">Сейчас</div><div className="mt-1 font-semibold">{amount(item.currentReserved)} {item.unit}</div></div>
                <div className="rounded-lg bg-blue-50 px-3 py-2"><div className="text-blue-600">Станет</div><div className="mt-1 font-semibold text-blue-900">{amount(proposed)} {item.unit}</div></div>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Действующая бронь</h3>
              {item.reservations.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Деловой остаток ещё не забронирован.</p>
              ) : item.reservations.map((reservation) => (
                <div key={reservation.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <span className="font-medium">{amount(reservation.quantity)} {item.unit}</span>
                    {reservation.pieceLengthMm ? <span className="ml-2 text-slate-500">кусок {amount(reservation.pieceLengthMm)} мм</span> : null}
                    {reservation.consumedAt ? <Badge variant="outline" className="ml-2">Списано</Badge> : null}
                  </div>
                  {!reservation.consumedAt && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={locked || isPending}
                      onClick={() => setRemoved((current) => {
                        const next = new Set(current)
                        if (next.has(reservation.id)) next.delete(reservation.id)
                        else next.add(reservation.id)
                        return next
                      })}
                      className={removed.has(reservation.id) ? 'border-red-300 bg-red-50 text-red-700' : 'border-slate-200'}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {removed.has(reservation.id) ? 'Будет снято' : 'Снять'}
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Добавить из доступного делового остатка</h3>
              {item.stockItems.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">Подходящего доступного остатка нет.</p>
              ) : item.stockItems.map((stock) => {
                const key = fieldKey(item.table, item.id, stock.id)
                return (
                  <label key={stock.id} className="grid gap-3 rounded-lg border border-slate-200 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center">
                    <span className="text-sm text-slate-700">
                      {stock.piece_length_mm ? 'Кусок ' + amount(stock.piece_length_mm) + ' мм · ' : ''}
                      доступно {amount(stock.available_quantity)} {stock.unit}
                      {stock.label ? ' · ' + stock.label : ''}
                    </span>
                    <Input
                      type="number"
                      min="0"
                      max={stock.available_quantity}
                      step="0.01"
                      value={additions[key] || ''}
                      disabled={locked || isPending}
                      onChange={(event) => setAdditions((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder={'Добавить, ' + item.unit}
                    />
                  </label>
                )
              })}
            </div>
          </section>
        )
      })}

      {!isInitial && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="text-sm font-semibold text-slate-900" htmlFor="business_scrap_correction_reason">Причина корректировки *</label>
          <Textarea
            id="business_scrap_correction_reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={locked || isPending}
            rows={4}
            className="mt-2"
            placeholder="Коротко объясните, почему нужно изменить бронь делового остатка."
          />
          <Button type="button" onClick={submit} disabled={locked || isPending || changes.length === 0 || reason.trim().length < 3} className="mt-4 min-h-11 bg-[#1B3A6B] text-white">
            {isPending ? 'Отправляю...' : 'Завершить корректировку и отправить на согласование'}
          </Button>
          {!locked && changes.length > 0 && (
            <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Изменено позиций: {changes.length}</p>
          )}
        </section>
      )}
    </div>
  )
}
