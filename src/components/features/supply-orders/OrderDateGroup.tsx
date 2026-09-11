'use client'

import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { AlertTriangle, CalendarDays } from 'lucide-react'
import { SupplierGroup } from './SupplierGroup'
import type { SupplyOrderItem } from '@/lib/actions/supply-orders'
import type { SupplierWithRelations } from '@/lib/actions/suppliers'
import { isReturnedSupplyOrderSource, type SupplyOrderDetailContext } from './supply-order-view'

type OrderDateGroupProps = {
 dateKey: string
 groups: Array<{ supplierKey: string; supplierName: string; items: SupplyOrderItem[] }>
 suppliers: SupplierWithRelations[]
 detailContexts: Map<string, SupplyOrderDetailContext>
}

export function OrderDateGroup({ dateKey, groups, suppliers, detailContexts }: OrderDateGroupProps) {
 const noSupplier = dateKey === 'no_supplier'
 const noDate = dateKey === 'no_date'
 const multipleDates = dateKey === 'multiple_dates'
 const items = groups.flatMap((group) => group.items)
 const itemCount = items.length
 const total = items.reduce((sum, item) => sum + (isReturnedSupplyOrderSource(item) ? 0 : item.to_order), 0)
 const unit = items.every((item) => item.unit === items[0]?.unit) ? items[0]?.unit : 'ед.'
 const title = noSupplier
  ? 'Без графика поставок'
  : multipleDates
   ? 'Несколько дат поставки'
  : noDate
   ? 'Дата поставки не определена'
   : format(new Date(`${dateKey}T00:00:00`), 'EEEE, d MMMM yyyy', { locale: ru })
 const description = noSupplier
  ? 'Укажите поставщика, дату и объём, чтобы позиция появилась в графике снабжения.'
  : multipleDates
   ? 'У одной позиции несколько дат снабжения. Все даты и поставщики показаны в строке.'
  : noDate
   ? 'Поставщик выбран, но поставка ещё не внесена в график.'
   : 'Позиции сгруппированы по поставщику на эту дату.'

 return (
  <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm" aria-labelledby={`supply-date-${dateKey}`}>
   <div className={`flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between ${noSupplier || noDate ? 'bg-amber-50/70' : 'bg-card'}`}>
    <div className="flex min-w-0 items-center gap-3">
     <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${noSupplier || noDate ? 'bg-amber-500/10 text-amber-700' : 'bg-primary/10 text-primary'}`}>
      {noSupplier || noDate ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CalendarDays className="h-4 w-4" aria-hidden="true" />}
     </div>
     <div className="min-w-0">
      <h2 id={`supply-date-${dateKey}`} className="truncate text-base font-semibold capitalize text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
     </div>
    </div>
    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
     <span className="rounded-lg border border-border bg-background px-2.5 py-1.5">Позиций: <strong className="tabular-nums text-foreground">{itemCount}</strong></span>
     <span className="rounded-lg border border-border bg-background px-2.5 py-1.5">
      {noSupplier ? 'Поставок' : 'Поставщиков'}: <strong className="tabular-nums text-foreground">{noSupplier ? 0 : groups.length}</strong>
     </span>
     <span className="rounded-lg border border-border bg-background px-2.5 py-1.5">Итого <strong className="tabular-nums text-foreground">{new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(total)} {unit}</strong></span>
    </div>
   </div>
   <div className="border-t border-border/60">
    {groups.map((group) => (
     <SupplierGroup
      key={group.supplierKey}
      supplierName={group.supplierName}
      items={group.items}
      suppliers={suppliers}
      detailContexts={detailContexts}
      hideHeader={noSupplier && groups.length === 1}
     />
    ))}
   </div>
  </section>
 )
}
