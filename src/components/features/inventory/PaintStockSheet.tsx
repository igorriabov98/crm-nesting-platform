'use client'

import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import type { PaintStockPosition } from '@/lib/actions/inventory'

export function PaintStockSheet({
  children,
  positions,
  error,
}: {
  children: ReactNode
  positions: PaintStockPosition[]
  error: string | null
}) {
  return (
    <Sheet>
      <SheetTrigger
        aria-label="Показать позиции краски на складе"
        className="block w-full cursor-pointer rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B3A6B] focus-visible:ring-offset-2"
      >
        {children}
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="border-b border-[#E8ECF0] pr-14">
          <SheetTitle className="text-lg font-semibold text-[#1B3A6B]">Краска на складе</SheetTitle>
          <SheetDescription>Позиции и остатки выбранного завода. Количество указано в кг.</SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          {error ? (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
          ) : positions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#CED7E2] p-4 text-sm text-[#475569]">Краски на выбранном складе сейчас нет.</p>
          ) : positions.map((position) => (
            <article key={position.id} className="rounded-lg border border-[#E0E7EF] bg-white p-4">
              <h3 className="font-semibold text-[#111827]">{position.name}</h3>
              <p className="mt-1 text-sm text-[#475569]">
                {[position.ralCode ? `RAL ${position.ralCode}` : null, position.finish].filter(Boolean).join(' · ') || 'Характеристики не указаны'}
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-sm tabular-nums">
                <div><dt className="text-[#64748B]">Всего</dt><dd className="font-semibold text-[#111827]">{formatKg(position.totalKg)}</dd></div>
                <div><dt className="text-[#64748B]">В брони</dt><dd className="font-semibold text-blue-700">{formatKg(position.reservedKg)}</dd></div>
                <div><dt className="text-[#64748B]">Доступно</dt><dd className="font-semibold text-emerald-700">{formatKg(position.availableKg)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function formatKg(value: number): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} кг`
}
