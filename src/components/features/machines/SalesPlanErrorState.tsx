'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SalesPlanErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Sales plan route error:', error)
  }, [error])

  return (
    <div className="flex min-h-96 flex-col items-center justify-center rounded-2xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-700">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h2 className="mt-5 text-xl font-semibold text-slate-950">Не удалось загрузить раздел</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
        {error.message || 'Произошла ошибка при загрузке данных плана продаж.'}
      </p>
      <Button onClick={reset} className="mt-6 min-h-11 bg-blue-900 px-4 text-white hover:bg-blue-800">
        <RefreshCcw className="mr-2 h-4 w-4" />
        Попробовать снова
      </Button>
    </div>
  )
}
