'use client'

import { Building2, PackageOpen } from 'lucide-react'
import dynamic from 'next/dynamic'
import type { SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'

const OrderItemRow = dynamic(() => import('./OrderItemRow').then((mod) => mod.OrderItemRow), {
 loading: () => <div className="h-36 animate-pulse border-t border-border bg-muted/30 motion-reduce:animate-none" />,
})

type SupplierGroupProps = {
 supplierName: string
 items: SupplyOrderItem[]
 suppliers: SupplierWithRelations[]
 selected: Set<string>
 onToggle: (item: SupplyOrderItem) => void
 readOnly?: boolean
}

export function SupplierGroup({ supplierName, items, suppliers, selected, onToggle, readOnly = false }: SupplierGroupProps) {
 const total = items.reduce((sum, item) => sum + item.to_order, 0)
 const unit = items.every((item) => item.unit === items[0]?.unit) ? items[0]?.unit : 'ед.'

 return (
  <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
   <div className="flex flex-col gap-2 border-b border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex min-w-0 items-center gap-3">
     <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background text-primary ring-1 ring-border">
      <Building2 className="h-4 w-4" />
     </div>
     <div className="min-w-0">
      <div className="truncate font-semibold text-foreground">{supplierName}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{items.length} позиций в группе</div>
     </div>
    </div>
    <div className="inline-flex min-h-9 items-center gap-2 self-start rounded-xl bg-background px-3 text-xs text-muted-foreground ring-1 ring-border sm:self-auto">
     <PackageOpen className="h-3.5 w-3.5" />
     <span>Итого:</span>
     <strong className="tabular-nums text-foreground">{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(total)} {unit}</strong>
    </div>
   </div>
   {items.map((item) => (
    <OrderItemRow
     key={`${item.table}:${item.id}`}
     item={item}
     suppliers={suppliers}
     checked={selected.has(`${item.table}:${item.id}`)}
     onToggle={() => onToggle(item)}
     readOnly={readOnly}
    />
   ))}
  </div>
 )
}
