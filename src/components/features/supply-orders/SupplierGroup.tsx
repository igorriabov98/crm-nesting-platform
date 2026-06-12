'use client'

import { Building2 } from 'lucide-react'
import dynamic from 'next/dynamic'
import type { SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'

const OrderItemRow = dynamic(() => import('./OrderItemRow').then((mod) => mod.OrderItemRow), {
 loading: () => <div className="h-20 border-t border-[#E8ECF0] bg-white" />,
})

type SupplierGroupProps = {
 supplierName: string
 items: SupplyOrderItem[]
 suppliers: SupplierWithRelations[]
 selected: Set<string>
 onToggle: (item: SupplyOrderItem) => void
}

export function SupplierGroup({ supplierName, items, suppliers, selected, onToggle }: SupplierGroupProps) {
 const total = items.reduce((sum, item) => sum + item.to_order, 0)
 const unit = items.every((item) => item.unit === items[0]?.unit) ? items[0]?.unit : 'ед.'

 return (
  <div className="overflow-hidden rounded-lg border border-[#E8ECF0] bg-white">
   <div className="flex items-center justify-between gap-3 bg-[#F8F9FA] px-3 py-2">
    <div className="flex items-center gap-2 font-semibold text-[#1B3A6B]">
     <Building2 className="h-4 w-4" />
     {supplierName}
    </div>
    <div className="text-xs text-[#6B7280]">
     Итого: {new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(total)} {unit} · {items.length} поз.
    </div>
   </div>
   {items.map((item) => (
    <OrderItemRow
     key={`${item.table}:${item.id}`}
     item={item}
     suppliers={suppliers}
     checked={selected.has(`${item.table}:${item.id}`)}
     onToggle={() => onToggle(item)}
    />
   ))}
  </div>
 )
}
