'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { reserveItemFromStock, type SupplyStockItem } from '@/lib/actions/supply-request'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

type Props = {
  itemId: string
  requestMaterialId: string | null
  machineId: string
  steelTypeName: string
  thicknessMm: number | null
  items: SupplyStockItem[]
}

export function SheetBusinessScrapMatches(props: Props) {
  const matches = props.items.filter((item) => item.is_business_scrap && item.available_quantity > 0)
  if (!props.requestMaterialId || matches.length === 0) return null

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        Есть совпадения ({matches.length})
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Деловой остаток листового металла</DialogTitle>
          <DialogDescription>
            {props.steelTypeName} · толщина {props.thicknessMm ?? '—'} мм. Показаны доступные позиции всех заводов.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Бронь закрепляет остаток за машиной. Потребность в полноразмерных листах и количество «К заказу» не уменьшаются.
        </p>
        <div className="space-y-2">
          {matches.map((item) => (
            <ScrapRow key={item.id} item={item} itemId={props.itemId}
              requestMaterialId={props.requestMaterialId!} machineId={props.machineId} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ScrapRow({ item, itemId, requestMaterialId, machineId }: {
  item: SupplyStockItem
  itemId: string
  requestMaterialId: string
  machineId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [quantity, setQuantity] = useState('1')
  const available = Math.floor(Number(item.available_quantity || 0))

  const reserve = () => {
    const count = Number(quantity)
    if (!Number.isSafeInteger(count) || count < 1 || count > available) {
      toast.error(`Введите целое количество от 1 до ${available} шт`)
      return
    }
    if (!item.is_local_factory && !window.confirm(
      `Склад «${item.factory_name}» находится на другом заводе. После бронирования будет создана межзаводская перевозка. Продолжить?`,
    )) return
    startTransition(async () => {
      const result = await reserveItemFromStock({
        request_item_table: 'request_sheet_metal',
        request_item_id: itemId,
        inventory_id: item.id,
        factory_id: item.factory_id,
        material_id: requestMaterialId,
        material_variant_id: item.material_variant_id,
        piece_length_mm: item.piece_length_mm,
        machine_id: machineId,
        quantity: count,
      })
      if (!result.success) {
        toast.error(result.error || 'Не удалось забронировать остаток')
        router.refresh()
        return
      }
      toast.success(item.is_local_factory ? 'Деловой остаток забронирован' : 'Деловой остаток забронирован, перевозка создана')
      router.refresh()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
      <div className="min-w-0">
        <div className="font-medium text-slate-900">{item.material_name || 'Листовой металл'} · {item.label || 'Размер не указан'}</div>
        <div className="text-xs text-slate-600">{item.factory_name}{item.is_local_factory ? ' · завод машины' : ''} · доступно {available} шт</div>
      </div>
      <div className="flex items-center gap-2">
        <input aria-label={`Количество для брони: ${item.material_name || 'лист'} ${item.label || ''}`}
          type="number" min={1} max={available} step={1} value={quantity}
          onChange={(event) => setQuantity(event.target.value)} disabled={pending}
          className="h-9 w-20 rounded-md border border-slate-300 px-2 text-sm" />
        <Button type="button" size="sm" onClick={reserve} disabled={pending || available < 1}>Забронировать</Button>
      </div>
    </div>
  )
}
