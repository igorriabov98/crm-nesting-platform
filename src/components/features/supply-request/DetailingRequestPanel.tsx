'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Factory, PackageCheck, Route, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  declineDetailingForRequest,
  releaseDetailingReservation,
  reserveDetailingForRequest,
  type DetailingRequestMatch,
  type DetailingRequestWorkspace,
} from '@/lib/actions/detailing'

function kg(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)} кг`
}

function MatchRow({ match, requestId, canManage }: { match: DetailingRequestMatch; requestId: string; canManage: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [quantity, setQuantity] = useState('1')
  const reserve = () => startTransition(async () => {
    const result = await reserveDetailingForRequest({
      requestId, machineItemId: match.machineItemId, partId: match.partId,
      sourceFactoryId: match.sourceFactoryId, quantity: Number(quantity),
    })
    if (!result.success) {
      toast.error(result.error || 'Не удалось забронировать деталировку')
      return
    }
    toast.success('Деталировка забронирована'); router.refresh()
  })
  return (
    <div className={`grid gap-3 rounded-lg border p-3 lg:grid-cols-[minmax(0,1fr)_180px_210px] lg:items-center ${match.requiresTransfer ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/50'}`}>
      <div className="min-w-0"><div className="font-semibold text-[#243B5A]">{match.partName} <span className="font-mono text-sm font-normal text-[#6B7280]">· {match.drawingNumber}</span></div><div className="mt-1 text-sm text-[#6B7280]">Для: {match.productLabel} · в заказе {match.quantityInOrder} шт.</div><div className="mt-1 text-sm">Доступно: <strong>{match.availableQuantity} шт.</strong> · {kg(match.availableWeightKg)}</div></div>
      <div className={`flex items-center gap-2 text-sm font-medium ${match.requiresTransfer ? 'text-amber-800' : 'text-emerald-800'}`}>{match.requiresTransfer ? <Route className="h-4 w-4" /> : <Factory className="h-4 w-4" />}{match.sourceFactoryName}{match.requiresTransfer && ' · нужна перевозка'}</div>
      {canManage && <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-xs font-medium text-[#4B5563]">Бронь, шт.<Input className="mt-1" type="number" min="1" max={match.availableQuantity} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><Button disabled={isPending || Number(quantity) < 1 || Number(quantity) > match.availableQuantity} onClick={reserve}>Забронировать</Button></div>}
    </div>
  )
}

export function DetailingRequestPanel({ workspace, canManage }: { workspace: DetailingRequestWorkspace; canManage: boolean }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const activeReservations = workspace.reservations.filter((item) => ['active', 'partially_consumed'].includes(item.status) && item.allocations.some((allocation) => allocation.quantity > 0))
  const totalReservedQuantity = activeReservations.reduce((sum, item) => sum + item.allocations.reduce((value, allocation) => value + allocation.quantity, 0), 0)
  const totalReservedWeight = activeReservations.reduce((sum, item) => sum + item.allocations.reduce((value, allocation) => value + allocation.quantity * item.unitWeightKg, 0), 0)

  const decline = () => startTransition(async () => {
    const result = await declineDetailingForRequest(workspace.requestId)
    if (!result.success) {
      toast.error(result.error || 'Не удалось сохранить решение')
      return
    }
    toast.success('Сохранено: деталировку для заказа не используем'); router.refresh()
  })
  const release = (id: string) => startTransition(async () => {
    const result = await releaseDetailingReservation(id)
    if (!result.success) {
      toast.error(result.error || 'Не удалось снять бронь')
      return
    }
    toast.success('Бронь снята'); router.refresh()
  })

  return (
    <section className="rounded-xl border border-[#D7E1ED] bg-white p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h2 className="flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]"><PackageCheck className="h-5 w-5" />Проверка деталировки</h2><p className="mt-1 text-sm text-[#6B7280]">Подходящие готовые детали показаны до оформления заявки снабжению. Количество выбирает технолог.</p></div>{workspace.destinationFactoryName ? <span className="rounded-full bg-[#EEF3F9] px-3 py-1 text-sm font-medium text-[#1B3A6B]">Завод заказа: {workspace.destinationFactoryName}</span> : <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">Завод заказа ещё не назначен</span>}</div>

      {activeReservations.length > 0 && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center gap-2 font-semibold text-emerald-900"><CheckCircle2 className="h-4 w-4" />Забронировано: {totalReservedQuantity} шт. · {kg(totalReservedWeight)}</div><div className="mt-3 space-y-2">{activeReservations.map((reservation) => <div key={reservation.id} className="flex flex-col gap-2 rounded-md bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between"><div><span className="font-medium">{reservation.partName} · {reservation.drawingNumber}</span><div className="mt-1 text-xs text-[#6B7280]">{reservation.allocations.map((allocation) => `${allocation.factoryName}: ${allocation.quantity} шт.`).join(' · ')}</div></div>{canManage && <Button variant="outline" size="sm" disabled={isPending} onClick={() => release(reservation.id)}>Снять бронь</Button>}</div>)}</div></div>}

      {workspace.matches.length === 0 && activeReservations.length === 0 ? <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><div><div className="font-semibold">Доступных совпадений нет</div><div className="mt-1 text-sm">Проверка будет пройдена автоматически перед отправкой заявки.</div></div></div> : <div className="mt-4 space-y-3">{workspace.matches.map((match) => <MatchRow key={`${match.machineItemId}:${match.partId}:${match.sourceFactoryId}`} match={match} requestId={workspace.requestId} canManage={canManage} />)}</div>}

      {workspace.matches.some((match) => match.requiresTransfer) && <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Бронь с другого завода создаст транспортную карточку и системную задачу перемещения.</div>}

      {canManage && workspace.matches.length > 0 && <div className="mt-4 flex flex-col gap-3 border-t border-[#E8ECF0] pt-4 sm:flex-row sm:items-center sm:justify-between"><div className="text-sm text-[#6B7280]">Если готовые детали для этого заказа использовать не нужно, подтвердите это явно.</div><Button variant="outline" disabled={isPending} onClick={decline}><XCircle />Не использовать деталировку</Button></div>}
      {workspace.decision === 'declined' && <div className="mt-3 text-sm font-medium text-[#6B7280]">Решение сохранено: деталировка не используется.</div>}
    </section>
  )
}
