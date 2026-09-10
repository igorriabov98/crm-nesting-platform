'use client'

import { Building2, PackageOpen } from 'lucide-react'
import dynamic from 'next/dynamic'
import type { SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import type { SupplyOrderDetailContext } from './supply-order-view'
import { isReturnedSupplyOrderSource } from './supply-order-view'

const OrderItemRow = dynamic(() => import('./OrderItemRow').then((mod) => mod.OrderItemRow), {
 loading: () => <div className="h-36 animate-pulse border-t border-border bg-muted/30 motion-reduce:animate-none" />,
})

type SupplierGroupProps = {
 supplierName: string
 items: SupplyOrderItem[]
 suppliers: SupplierWithRelations[]
 detailContexts: Map<string, SupplyOrderDetailContext>
 hideHeader?: boolean
}

export function SupplierGroup({ supplierName, items, suppliers, detailContexts, hideHeader = false }: SupplierGroupProps) {
 const total = items.reduce((sum, item) => sum + (isReturnedSupplyOrderSource(item) ? 0 : item.to_order), 0)
 const unit = items.every((item) => item.unit === items[0]?.unit) ? items[0]?.unit : 'ед.'

 return (
  <div role="table" aria-label={`Позиции поставщика: ${supplierName}`} className="border-t border-border/60 first:border-t-0">
   {!hideHeader && (
    <div className="flex flex-col gap-2 bg-muted/20 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
     <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-primary ring-1 ring-border">
       <Building2 className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
       <div className="truncate text-sm font-semibold text-foreground">{supplierName}</div>
       <div className="mt-0.5 text-xs text-muted-foreground">Позиций в группе: {items.length}</div>
      </div>
     </div>
     <div className="inline-flex min-h-8 items-center gap-2 self-start rounded-lg bg-background px-2.5 text-xs text-muted-foreground ring-1 ring-border sm:self-auto">
      <PackageOpen className="h-3.5 w-3.5" aria-hidden="true" />
      <span>Итого</span>
      <strong className="tabular-nums text-foreground">{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(total)} {unit}</strong>
     </div>
    </div>
   )}
   <div
    role="row"
    className="hidden grid-cols-[minmax(160px,1fr)_minmax(180px,1.15fr)_105px_135px_185px_145px_44px] items-center gap-3 border-t border-border/60 bg-muted/35 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground xl:grid"
   >
    <div role="columnheader">Машина / заявка</div>
    <div role="columnheader">Материал</div>
    <div role="columnheader">Потребность</div>
    <div role="columnheader">Склад</div>
    <div role="columnheader">Поставка: план / факт / осталось</div>
    <div role="columnheader">Статус</div>
    <div role="columnheader"><span className="sr-only">Действия</span></div>
   </div>
   <div role="rowgroup">
    {items.map((item) => (
     <OrderItemRow
      key={`${item.table}:${item.id}`}
      item={item}
      suppliers={suppliers}
      detailContext={detailContexts.get(`${item.table}:${item.id}`)}
     />
    ))}
   </div>
  </div>
 )
}
