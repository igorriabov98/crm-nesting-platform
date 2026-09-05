'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function MyOrdersLoadingState() {
  return (
    <div className="space-y-5" aria-label="Загрузка страницы моих заказов" role="status">
      <div className="overflow-hidden rounded-2xl border border-blue-900/10 bg-blue-950 p-6">
        <Skeleton className="h-3 w-36 bg-white/15" />
        <Skeleton className="mt-3 h-9 w-56 bg-white/20" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl bg-white/10" />
      </div>
      <div className="space-y-3 md:hidden">
        {[1, 2, 3].map((item) => <Skeleton key={item} className="h-56 w-full rounded-2xl" />)}
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
        <div className="border-b border-slate-200 bg-slate-50 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <div className="space-y-3 p-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-16 w-full rounded-xl" />)}
        </div>
      </div>
      <span className="sr-only">Загрузка заказов…</span>
    </div>
  )
}

export function MyOrdersErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('My orders route error:', error)
  }, [error])

  return (
    <div className="flex min-h-96 flex-col items-center justify-center rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm" role="alert">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-700">
        <AlertTriangle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-xl font-semibold text-slate-950">Не удалось загрузить мои заказы</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600">
        Произошла ошибка при загрузке заказов. Попробуйте повторить запрос.
      </p>
      <Button
        onClick={reset}
        className="mt-6 min-h-11 bg-blue-900 px-4 text-white hover:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
      >
        <RefreshCcw className="mr-2 h-4 w-4" aria-hidden="true" />
        Попробовать снова
      </Button>
    </div>
  )
}
