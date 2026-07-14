'use client'

import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, CalendarDays } from 'lucide-react'
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
  <section className="space-y-3" aria-labelledby={`supply-date-${dateKey}`}>
   <div className="flex items-center gap-3 px-1">
    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${noSupplier || noDate ? 'bg-amber-500/10 text-amber-700' : 'bg-primary/10 text-primary'}`}>
     {noSupplier || noDate ? <AlertTriangle className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
    </div>
    <div className="min-w-0">
     <h2 id={`supply-date-${dateKey}`} className="truncate text-base font-semibold capitalize text-foreground sm:text-lg">{title}</h2>
     <p className="text-xs text-muted-foreground">{groups.reduce((sum, group) => sum + group.items.length, 0)} позиций · {groups.length} поставщиков</p>
    </div>
   </div>
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
