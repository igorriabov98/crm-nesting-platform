'use client'

import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarDays, AlertTriangle } from 'lucide-react'
import { SupplierGroup } from './SupplierGroup'
import type { SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'

type OrderDateGroupProps = {
 dateKey: string
 groups: Array<{ supplierKey: string; supplierName: string; items: SupplyOrderItem[] }>
 suppliers: SupplierWithRelations[]
 selected: Set<string>
 onToggle: (item: SupplyOrderItem) => void
 readOnly?: boolean
}

export function OrderDateGroup({ dateKey, groups, suppliers, selected, onToggle, readOnly = false }: OrderDateGroupProps) {
 const noSupplier = dateKey === 'no_supplier'
 const noDate = dateKey === 'no_date'
 const title = noSupplier
  ? 'Без поставщика — требует назначения'
  : noDate
   ? 'Дата поставки не определена'
  : format(new Date(`${dateKey}T00:00:00`), 'EEEE, d MMMM yyyy', { locale: ru })

 return (
  <section className="space-y-3">
   <h2 className="flex items-center gap-2 text-lg font-semibold text-[#1B3A6B]">
    {noSupplier || noDate ? <AlertTriangle className="h-5 w-5 text-[#D97706]" /> : <CalendarDays className="h-5 w-5" />}
    {title}
   </h2>
   <div className="space-y-3">
    {groups.map((group) => (
     <SupplierGroup
      key={group.supplierKey}
      supplierName={group.supplierName}
      items={group.items}
      suppliers={suppliers}
      selected={selected}
      onToggle={onToggle}
      readOnly={readOnly}
     />
    ))}
   </div>
  </section>
 )
}
