'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { supplyOrderDateSliceItems, type SupplyOrderDateSlice } from './supply-order-view'

const amount = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ru-RU')
export function CompactSupplyOrderRow({ slice, children }: { slice: SupplyOrderDateSlice; children: ReactNode }) {
  const items = supplyOrderDateSliceItems(slice)
  const names = [...new Set(items.map(item => item.machine_id ? item.machine_name : item.machine_name || 'На склад'))]
  const ordered = slice.state === 'ordered'
  const closed = slice.state === 'closed'
  const redelivery = slice.state === 'redelivery'
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const overdue = ordered && slice.dateKey !== 'no_supply_date' && slice.dateKey < today
  const label = closed ? 'Склад подтвердил' : ordered ? 'Заказано' : redelivery ? 'Нужно довезти' : slice.state === 'review' ? 'На рассмотрении' : 'Нужно заказать'
  const characteristics = slice.aggregate.characteristics.filter(part => part.value !== slice.aggregate.item_name)
  return <details className="group border-b border-border bg-card open:bg-muted/10">
    <summary className="grid min-h-16 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(180px,2fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(140px,1fr)_20px] [&::-webkit-details-marker]:hidden">
      <span className="min-w-0">
        <strong className="block text-sm">{slice.aggregate.item_name}</strong>
        <span className="block break-words text-xs text-muted-foreground">{characteristics.map(part => `${part.label}: ${part.value}`).join(' · ')}{slice.pieceLengthMm ? ` · Хлыст ${amount(slice.pieceLengthMm)} мм` : ''}</span>
      </span>
      <span className="col-start-1 text-xs md:col-auto"><span className="text-muted-foreground md:hidden">Поставщик: </span>{slice.supplierName || 'Не назначен'}
        {(slice.origins || []).map(origin => <span key={origin.id} className="mt-1 block text-xs text-amber-800">Из поставки {date(origin.date)} · {origin.supplierName || 'Без поставщика'}</span>)}
        {slice.ambiguousOrigin && <span className="block text-amber-800">Источник требует уточнения</span>}
      </span>
      <span className="col-start-1 text-xs md:col-auto">{names.slice(0, 2).join(', ') || 'Свободный остаток'}{names.length > 2 ? ` и ещё ${names.length - 2}` : ''}
        {items.length > 0 && items.every(item => !item.machine_id && !item.planned_material_date) && <span className="block text-muted-foreground">Срок потребности не задан</span>}
      </span>
      <span className="col-start-2 row-start-1 text-right md:col-auto md:row-auto md:text-left">
        <span className="block text-xs text-muted-foreground">{label}</span><strong className="whitespace-nowrap text-sm tabular-nums">{amount(slice.quantity)} {slice.aggregate.unit}</strong>
        {ordered && <span className={`mt-1 block max-w-44 text-xs ${overdue ? 'text-red-700' : 'text-primary'}`}>Ожидается {amount(slice.plannedQuantity)} {slice.aggregate.unit} · Ожидает подтверждения склада{overdue ? ' · Просрочено' : ''}</span>}
        {closed && <span className="block text-xs text-emerald-700">Закрыто</span>}
      </span>
      <ChevronDown aria-hidden="true" className="col-start-2 h-4 w-4 justify-self-end text-muted-foreground transition-transform group-open:rotate-180 md:col-auto" />
    </summary>
    <div className="border-t px-2 py-3 sm:px-3">
      {slice.shortReceipt && <p className="mb-2 text-xs text-muted-foreground">При приёмке факт отличался от исходного графика. Принятый объём закрыт; текущий довоз показан отдельной строкой.</p>}
      {children}
    </div>
  </details>
}
