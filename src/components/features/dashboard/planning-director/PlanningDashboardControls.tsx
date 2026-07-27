'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import type { PlanningDashboardFactory } from '@/lib/dashboard/planning-director/types'

export function PlanningDashboardControls({
  factories,
  selectedFactoryId,
  month,
}: {
  factories: PlanningDashboardFactory[]
  selectedFactoryId: string
  month: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function hrefFor(next: { factory?: string; month?: string }) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.factory) params.set('factory', next.factory)
    if (next.month) params.set('month', next.month)
    return `${pathname}?${params.toString()}`
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
      <div aria-label="Выбор завода" className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1">
        {factories.map((factory) => {
          const active = factory.id === selectedFactoryId
          return (
            <Link
              key={factory.id}
              href={hrefFor({ factory: factory.id })}
              prefetch
              aria-current={active ? 'page' : undefined}
              className={`min-h-10 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${
                active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              {factory.name}
            </Link>
          )
        })}
      </div>
      <label className="sr-only" htmlFor="planning-dashboard-month">Месяц тоннажа</label>
      <input
        id="planning-dashboard-month"
        type="month"
        value={month}
        onChange={(event) => router.push(hrefFor({ month: event.target.value }))}
        className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      />
      <button
        type="button"
        onClick={() => router.refresh()}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Обновить
      </button>
    </div>
  )
}
