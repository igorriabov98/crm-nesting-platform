'use client'

import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { supplyOrderDateSliceItems, type SupplyOrderDateSlice } from './supply-order-view'

const amount = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ru-RU')
const columns = 'lg:grid-cols-[minmax(0,2fr)_minmax(105px,1fr)_minmax(140px,1.25fr)_minmax(145px,1fr)_20px]'

export function CompactSupplyOrderHeader() {
  return <div className={`hidden grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border bg-muted/35 px-3 py-2 text-xs font-semibold text-muted-foreground lg:grid ${columns}`}>
    <span>Материал и характеристики</span><span>Поставщик</span><span>Заявка и дата Мат.плана</span><span>Количества и состояние</span><span />
  </div>
}

export function supplyOrderMatPlanDates(slice: SupplyOrderDateSlice) {
  const dates = new Map<string, number>()
  for (const item of supplyOrderDateSliceItems(slice)) {
    const key = item.planned_material_date || 'no_date'
    dates.set(key, (dates.get(key) || 0) + item.quantity)
  }
  return [...dates.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function CompactSupplyOrderRow({ slice, children }: { slice: SupplyOrderDateSlice; children: ReactNode }) {
  const items = supplyOrderDateSliceItems(slice)
  const names = [...new Set(items.map(item => item.machine_id ? item.machine_name : item.machine_name || 'На склад'))]
  const ordered = slice.state === 'ordered'
  const closed = slice.state === 'closed'
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const overdue = ordered && slice.dateKey !== 'no_supply_date' && slice.dateKey < today
  const characteristics = slice.aggregate.characteristics.filter(part => part.value !== slice.aggregate.item_name)
  const matPlanDates = supplyOrderMatPlanDates(slice)
  return <details className="group border-b border-border bg-card last:border-b-0 open:bg-muted/10">
    <summary className={`grid min-h-16 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${columns} [&::-webkit-details-marker]:hidden`}>
      <span className="min-w-0"><strong className="block text-sm leading-5">{slice.aggregate.item_name}</strong>
        <span className="block break-words text-xs leading-5 text-muted-foreground">{characteristics.map(part => `${part.label}: ${part.value}`).join(' · ')}{slice.pieceLengthMm ? ` · Хлыст ${amount(slice.pieceLengthMm)} мм` : ''}</span></span>
      <span className="col-start-1 min-w-0 break-words text-xs leading-5 lg:col-auto"><span className="font-medium text-muted-foreground lg:hidden">Поставщик: </span>{slice.supplierName || 'Не назначен'}
        {(slice.origins || []).map(origin => <span key={origin.id} className="mt-1 block text-amber-800">Из поставки {date(origin.date)} · {origin.supplierName || 'Без поставщика'}</span>)}
        {slice.ambiguousOrigin && <span className="block text-amber-800">Источник требует уточнения</span>}</span>
      <span className="col-start-1 min-w-0 text-xs leading-5 lg:col-auto"><span className="font-medium text-muted-foreground lg:hidden">Заявка и Мат.план: </span>{names.slice(0, 2).join(', ') || 'Свободный остаток'}{names.length > 2 ? ` и ещё ${names.length - 2}` : ''}
        {matPlanDates.map(([key, quantity]) => <span key={key} className="block text-muted-foreground">{key === 'no_date' ? 'Срок потребности не задан' : `Мат.план ${date(key)}`} · {amount(quantity)} {slice.aggregate.unit}</span>)}</span>
      <span className="col-start-2 row-start-1 min-w-0 text-right text-xs leading-5 tabular-nums lg:col-auto lg:row-auto lg:text-left">
        <span className="block"><span className="text-muted-foreground">{slice.state === 'redelivery' ? 'Нужно довезти' : 'Нужно заказать'}: </span><strong>{amount(slice.unscheduledQuantity)} {slice.aggregate.unit}</strong></span>
        <span className="block"><span className="text-muted-foreground">Заказано: </span><strong>{amount(slice.plannedQuantity)} {slice.aggregate.unit}</strong></span>
        {slice.deliveredQuantity > 0 && <span className="block text-emerald-700">Склад подтвердил: <strong>{amount(slice.deliveredQuantity)} {slice.aggregate.unit}</strong></span>}
        {ordered && <span className={`block ${overdue ? 'text-red-700' : 'text-primary'}`}>Ожидает подтверждения склада{overdue ? ' · Просрочено' : ''}</span>}
        {closed && <span className="block text-emerald-700">Закрыто</span>}
      </span>
      <ChevronDown aria-hidden="true" className="col-start-2 h-4 w-4 justify-self-end text-muted-foreground transition-transform group-open:rotate-180 lg:col-auto" />
    </summary>
    <div className="border-t border-border/60 px-2 py-3 sm:px-3">
      {slice.shortReceipt && <p className="mb-2 text-xs text-muted-foreground">При приёмке факт отличался от исходного графика. Принятый объём закрыт; текущий довоз показан отдельной строкой.</p>}
      {children}
    </div>
  </details>
}
