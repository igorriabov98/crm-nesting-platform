'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarClock, PackageCheck, Save, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ROUTES } from '@/lib/constants/routes'
import { setDetailingTransferDate, type DetailingTransferCard } from '@/lib/actions/detailing'

const STATUS_LABELS: Record<DetailingTransferCard['status'], string> = {
  needs_date: 'Нужно указать дату', scheduled: 'Запланировано', partially_received: 'Частично принято', completed: 'Принято', cancelled: 'Отменено',
}

function dateLabel(value: string | null) {
  if (!value) return 'В ближайшее время'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function kg(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)} кг`
}

export function DetailingTransportPanel({ cards, error }: { cards: DetailingTransferCard[]; error?: string | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dates, setDates] = useState<Record<string, string>>(() => Object.fromEntries(cards.map((card) => [card.id, card.expectedArrivalDate || ''])))

  const save = (card: DetailingTransferCard) => startTransition(async () => {
    const result = await setDetailingTransferDate(card.id, dates[card.id] || '')
    if (!result.success) {
      toast.error(result.error || 'Не удалось сохранить дату доставки')
      return
    }
    toast.success('Ожидаемая дата доставки сохранена'); router.refresh()
  })

  return (
    <section className="space-y-3 rounded-xl border border-[#D7E1ED] bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1B3A6B] text-white"><Truck className="h-5 w-5" /></span><div><h1 className="text-xl font-bold text-[#17345F]">Транспорт · Деталировка</h1><p className="text-sm text-[#6B7280]">Межскладские брони и ожидаемые даты доставки.</p></div></div><span className="w-fit rounded-full bg-[#EEF3F9] px-3 py-1 text-sm font-medium text-[#1B3A6B]">{cards.filter((card) => !['completed', 'cancelled'].includes(card.status)).length} активных</span></div>
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : cards.length === 0 ? <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] p-6 text-center text-sm text-[#6B7280]">Перевозок деталировки пока нет.</div> : <div className="grid gap-3">{cards.map((card) => <article key={card.id} className={`rounded-lg border p-4 ${card.deliveryRisk ? 'border-red-300 bg-red-50/50' : 'border-[#DCE3EC]'}`}>
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#EAF1FB] px-2.5 py-1 text-xs font-semibold text-[#1B3A6B]">Деталировка</span><span className="font-semibold text-[#243B5A]">{card.machineName}</span><span className="text-sm text-[#6B7280]">{STATUS_LABELS[card.status]}</span></div><div className="mt-2 flex items-center gap-2 text-sm font-medium text-[#374151]">{card.sourceFactoryName} <span aria-hidden>→</span> {card.destinationFactoryName}</div><div className="mt-2 text-sm text-[#6B7280]">{card.totalQuantity} шт. · {kg(card.totalWeightKg)} · принято {card.receivedQuantity} шт.</div></div><div className="grid gap-2 sm:grid-cols-[150px_160px_auto] sm:items-end"><div><div className="mb-1 text-xs font-medium text-[#6B7280]">Дедлайн задачи</div><div className={`flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium ${card.deadline ? 'border-[#DCE3EC]' : 'border-amber-200 bg-amber-50 text-amber-900'}`}><CalendarClock className="h-4 w-4" />{dateLabel(card.deadline)}</div></div><label className="text-xs font-medium text-[#6B7280]">Ожидаемая доставка<Input className="mt-1" type="date" value={dates[card.id] || ''} disabled={['completed', 'cancelled'].includes(card.status)} onChange={(event) => setDates((current) => ({ ...current, [card.id]: event.target.value }))} /></label><Button disabled={isPending || !dates[card.id] || ['completed', 'cancelled'].includes(card.status)} onClick={() => save(card)}><Save />Сохранить</Button></div></div>
        {card.deliveryRisk && <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-100/70 p-3 text-sm font-medium text-red-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Ожидаемая доставка позже дедлайна задачи. Сохранение разрешено, но есть риск для начала заготовки.</div>}
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="text-xs uppercase text-[#6B7280]"><tr><th className="py-2">Деталь</th><th>План</th><th>Принято</th><th>Осталось</th><th>Вес</th></tr></thead><tbody>{card.items.map((item) => <tr key={item.id} className="border-t border-[#EDF0F4]"><td className="py-2 font-medium">{item.partName} · <span className="font-mono font-normal">{item.drawingNumber}</span></td><td>{item.requestedQuantity} шт.</td><td>{item.receivedQuantity} шт.</td><td>{item.remainingQuantity} шт.</td><td>{kg(item.requestedWeightKg)}</td></tr>)}</tbody></table></div>
        {card.taskId && <div className="mt-3 flex items-center gap-2 text-sm text-[#6B7280]"><PackageCheck className="h-4 w-4" />Системная задача: <Link href={ROUTES.TASKS} className="font-medium text-[#1B3A6B] underline-offset-2 hover:underline">открыть задачи</Link></div>}
      </article>)}</div>}
    </section>
  )
}
