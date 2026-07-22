'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, PackageCheck, Route } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { receiveDetailingTransfer, type DetailingTransferCard } from '@/lib/actions/detailing'

function formatDate(value: string | null) {
  if (!value) return 'Дата доставки не указана'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function kg(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)} кг`
}

export function DetailingReceivingPanel({ cards }: { cards: DetailingTransferCard[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(cards.flatMap((card) => card.items.map((item) => [item.id, String(item.remainingQuantity)]))))
  const groups = useMemo(() => {
    const map = new Map<string, DetailingTransferCard[]>()
    for (const card of cards) {
      const key = card.expectedArrivalDate || 'unscheduled'
      map.set(key, [...(map.get(key) || []), card])
    }
    return [...map.entries()].sort(([a], [b]) => a === 'unscheduled' ? 1 : b === 'unscheduled' ? -1 : a.localeCompare(b))
  }, [cards])

  const receive = (card: DetailingTransferCard) => startTransition(async () => {
    const items = card.items.map((item) => ({ itemId: item.id, quantity: Number(drafts[item.id] || 0) }))
    if (!items.some((item) => item.quantity > 0)) {
      toast.error('Укажите фактически принятое количество')
      return
    }
    const result = await receiveDetailingTransfer(card.id, items)
    if (!result.success) {
      toast.error(result.error || 'Не удалось принять деталировку')
      return
    }
    toast.success('Деталировка принята и перемещена на склад назначения'); router.refresh()
  })

  if (cards.length === 0) return null
  return (
    <section className="space-y-3 rounded-xl border border-[#D7E1ED] bg-white p-4">
      <div><h2 className="flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]"><PackageCheck className="h-5 w-5" />Приём деталировки</h2><p className="mt-1 text-sm text-[#6B7280]">План, факт и отклонение по межскладским перевозкам. Частичная и сверхплановая приёмка поддерживаются.</p></div>
      {groups.map(([date, groupCards]) => <div key={date} className="overflow-hidden rounded-lg border border-[#E1E7EF]"><div className="border-b border-[#E1E7EF] bg-[#F8FAFC] px-4 py-3 font-semibold text-[#243B5A]">{formatDate(date === 'unscheduled' ? null : date)} · {groupCards.length} перевозок</div><div className="divide-y divide-[#E8ECF0]">{groupCards.map((card) => <article key={card.id} className="p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between"><div><div className="flex items-center gap-2 font-semibold text-[#1B3A6B]"><Route className="h-4 w-4" />{card.sourceFactoryName} → {card.destinationFactoryName}</div><div className="mt-1 text-sm text-[#6B7280]">Заказ: {card.machineName} · дедлайн {formatDate(card.deadline)}</div></div>{card.deliveryRisk && <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-900"><AlertTriangle className="h-4 w-4" />Риск опоздания</div>}</div>
        <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase text-[#64748B]"><tr><th className="py-2">Деталь</th><th>План</th><th>Принято ранее</th><th>Факт сейчас</th><th>Отклонение</th><th>Вес факта</th></tr></thead><tbody>{card.items.map((item) => { const actual = Number(drafts[item.id] || 0); const variance = actual - item.remainingQuantity; return <tr key={item.id} className="border-t border-[#EDF0F4]"><td className="py-2 font-medium">{item.partName} · <span className="font-mono font-normal">{item.drawingNumber}</span></td><td>{item.requestedQuantity} шт.</td><td>{item.receivedQuantity} шт.</td><td><Input className="w-28" type="number" min="0" step="1" value={drafts[item.id] || ''} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} /></td><td className={variance > 0 ? 'font-medium text-amber-700' : variance < 0 ? 'font-medium text-blue-700' : 'text-emerald-700'}>{variance > 0 ? '+' : ''}{variance} шт.</td><td>{kg(actual * item.unitWeightKg)}</td></tr> })}</tbody></table></div>
        <div className="mt-3 flex justify-end"><Button disabled={isPending} onClick={() => receive(card)}>{isPending ? 'Приём…' : 'Принять указанный факт'}</Button></div>
      </article>)}</div></div>)}
    </section>
  )
}
