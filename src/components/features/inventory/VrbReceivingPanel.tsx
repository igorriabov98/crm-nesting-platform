'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Grid3X3, PackageCheck, Truck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { receiveVrbMesh, type VrbReceivingCard } from '@/lib/actions/vrb-outsourcing'

function formatDate(value: string | null) {
  if (!value) return 'дата не указана'
  const [year, month, day] = value.split('-')
  return `${day}.${month}.${year}`
}

function quantity(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value)
}

export function VrbReceivingPanel({ cards, error }: { cards: VrbReceivingCard[]; error?: string | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    cards.flatMap((card) => card.items.map((item) => [item.id, String(item.remainingQuantity)])),
  ))

  function receive(card: VrbReceivingCard) {
    const items = card.items
      .map((item) => ({ itemId: item.id, quantity: Number(drafts[item.id] || 0) }))
      .filter((item) => item.quantity > 0)
    if (items.length === 0) {
      toast.error('Укажите фактически принятое количество')
      return
    }
    const overReceipt = card.items.find((item) => Number(drafts[item.id] || 0) > item.remainingQuantity)
    if (overReceipt) {
      toast.error(`По позиции «${overReceipt.productName}» нельзя принять больше остатка ${quantity(overReceipt.remainingQuantity)}`)
      return
    }

    setPendingOperationId(card.operationId)
    startTransition(async () => {
      const result = await receiveVrbMesh({ operationId: card.operationId, factoryId: card.factoryId, items })
      setPendingOperationId(null)
      if (!result.success) {
        toast.error(result.error || 'Не удалось принять сетку VRB')
        return
      }
      toast.success('Приёмка сетки VRB сохранена')
      router.refresh()
    })
  }

  if (error) {
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
        Не удалось загрузить заявки VRB: {error}
      </section>
    )
  }
  if (cards.length === 0) return null

  return (
    <section className="space-y-3 rounded-xl border border-blue-200 bg-white p-4" aria-labelledby="vrb-receiving-title">
      <div>
        <h2 id="vrb-receiving-title" className="flex items-center gap-2 text-lg font-semibold text-blue-950">
          <Grid3X3 className="h-5 w-5 text-blue-700" />
          Приём сетки VRB
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Принимайте позиции частями в пределах остатка. Приёмка закрывает заявку, но не создаёт складской остаток.
        </p>
      </div>

      <div className="grid gap-3">
        {cards.map((card) => {
          const saving = isPending && pendingOperationId === card.operationId
          return (
            <article key={card.operationId} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="font-semibold text-blue-950">{card.machineName} · {card.factoryName}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span>Изготовитель: {card.supplierName || 'не указан'}</span>
                    <span>Доставка: {formatDate(card.plannedDeliveryDate)}</span>
                    <span className="inline-flex items-center gap-1">
                      <Truck className="h-3.5 w-3.5" />
                      {card.deliveryMethod === 'own_transport' ? 'Наш транспорт' : 'Служба доставки'}
                    </span>
                    {card.trackingNumber && <span>Трек: <b className="font-mono">{card.trackingNumber}</b></span>}
                  </div>
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Изделие</th>
                      <th>Заказано</th>
                      <th>Принято</th>
                      <th>Остаток</th>
                      <th>Факт сейчас</th>
                      <th>Вес заказа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.items.map((item) => (
                      <tr key={item.id} className="border-t border-slate-200">
                        <td className="py-2 font-medium text-slate-900">
                          {item.productName} · <span className="font-mono font-normal">{item.drawingNumber}</span>
                        </td>
                        <td>{quantity(item.requestedQuantity)} шт.</td>
                        <td>{quantity(item.receivedQuantity)} шт.</td>
                        <td>{quantity(item.remainingQuantity)} шт.</td>
                        <td>
                          <Label htmlFor={`vrb-receive-${item.id}`} className="sr-only">
                            Фактически принято {item.productName}
                          </Label>
                          <Input
                            id={`vrb-receive-${item.id}`}
                            className="min-h-11 w-28"
                            type="number"
                            min="0"
                            max={item.remainingQuantity}
                            step="1"
                            inputMode="numeric"
                            value={drafts[item.id] || ''}
                            onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                          />
                        </td>
                        <td>{quantity(item.requestedWeightKg)} кг</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex justify-end">
                <Button type="button" disabled={isPending} onClick={() => receive(card)} className="min-h-11 gap-2">
                  <PackageCheck className="h-4 w-4" />
                  {saving ? 'Приём…' : 'Принять указанное количество'}
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
