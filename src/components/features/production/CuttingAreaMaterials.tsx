'use client'

import { CalendarDays, ChevronDown, CircleAlert, PackageCheck, Truck, Warehouse } from 'lucide-react'
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import type { CuttingAreaMaterialState, CuttingAreaMaterialSummary } from '@/lib/production-cutting-area/materials'

const materialStates: Array<{ state: CuttingAreaMaterialState; label: string; style: string }> = [
  { state: 'not_ordered', label: 'Не заказано', style: 'border-amber-200 bg-amber-50 text-amber-800' },
  { state: 'delivery', label: 'Заказано, но не привезено', style: 'border-blue-200 bg-blue-50 text-blue-800' },
  { state: 'received', label: 'Получено', style: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  { state: 'stock', label: 'Со склада', style: 'border-slate-200 bg-slate-50 text-slate-700' },
]

function deliveryDateLabel(date: string) {
  const [year, month, day] = date.split('-')
  return `${day}.${month}.${year}`
}

export function CuttingAreaMaterialStatus({ summary }: { summary: CuttingAreaMaterialSummary }) {
  const states = materialStates.filter(({ state }) => summary.counts[state] > 0)
  return <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs" aria-label="Статус материалов">
    <span className="mr-0.5 text-slate-500">Материалы:</span>
    {states.length === 0 ? <span className="text-slate-500">Нет потребности</span> : states.map(({ state, label, style }) => (
      <Popover key={state}>
        <PopoverTrigger
          openOnHover
          delay={150}
          closeDelay={150}
          className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-medium outline-none transition-colors hover:brightness-95 focus-visible:ring-2 focus-visible:ring-blue-500 ${style}`}
          aria-label={`${label}: ${summary.counts[state]} позиций. Показать состав`}
        >
          {state === 'not_ordered' && <CircleAlert aria-hidden="true" className="size-3.5" />}
          {state === 'delivery' && <Truck aria-hidden="true" className="size-3.5" />}
          {state === 'received' && <PackageCheck aria-hidden="true" className="size-3.5" />}
          {state === 'stock' && <Warehouse aria-hidden="true" className="size-3.5" />}
          {label}<span className="tabular-nums"> · {summary.counts[state]}</span>
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-96 max-w-[calc(100vw-2rem)] p-4 motion-reduce:animate-none">
          <PopoverTitle>{label} · {summary.counts[state]}</PopoverTitle>
          <PopoverDescription>Конкретные позиции и количество потребности по каждой из них.</PopoverDescription>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto" aria-label={`Позиции: ${label.toLocaleLowerCase('ru')}`}>
            {summary.details[state].map((detail) => (
              <li key={`${detail.requestId}:${detail.id}`} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">{detail.category}</p>
                    <p className="break-words text-sm font-medium text-slate-950">{detail.label}</p>
                    {detail.description && <p className="mt-0.5 break-words text-xs text-slate-600">{detail.description}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{detail.quantity}</span>
                </div>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    ))}
  </div>
}

export function CuttingAreaRequestDelivery({ summary, requestNumber }: { summary: CuttingAreaMaterialSummary; requestNumber: number }) {
  const dates = summary.deliveryDates
  const needsSupply = summary.counts.not_ordered + summary.counts.delivery + summary.counts.received > 0
  return <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5" aria-label={`Доставка заявки №${requestNumber}`}>
    <p className="text-xs text-slate-500">Доставка от снабжения</p>
    {dates.length > 1 ? <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={150}
        className="-ml-1 mt-0.5 flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 text-left text-sm font-medium text-blue-900 outline-none hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label={`Раздельная доставка заявки №${requestNumber}: показать даты`}
      >
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
        Раздельная доставка
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-72 max-w-[calc(100vw-2rem)] p-4 motion-reduce:animate-none">
        <PopoverTitle>Даты доставки · заявка №{requestNumber}</PopoverTitle>
        <PopoverDescription>{summary.hasSharedSchedule ? 'Общий график закупки материала. Распределение между заявками выполняется при приёмке.' : 'График, указанный снабжением.'}</PopoverDescription>
        <ul className="max-h-60 space-y-1.5 overflow-y-auto" aria-label="Даты доставок">
          {dates.map((date) => <li key={date} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 font-medium tabular-nums text-slate-900">
            <CalendarDays className="size-4 text-slate-500" aria-hidden="true" />
            <time dateTime={date}>{deliveryDateLabel(date)}</time>
          </li>)}
        </ul>
        {summary.hasUndatedDelivery && <p className="text-xs text-amber-800">Для части материалов дата ещё не указана.</p>}
      </PopoverContent>
    </Popover> : <p className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-900">
      <CalendarDays className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
      {dates[0] ? <time dateTime={dates[0]}>{deliveryDateLabel(dates[0])}</time> : needsSupply ? 'Дата не указана' : 'Закупка не требуется'}
    </p>}
    {summary.hasSharedSchedule && <p className="mt-1 text-xs text-slate-500">Общий график снабжения материала</p>}
    {summary.hasUndatedDelivery && dates.length > 0 && <p className="mt-1 text-xs text-amber-800">Для части материалов дата не указана</p>}
  </section>
}
