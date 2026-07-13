'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Ошибка страницы уведомлений:', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-[420px] w-full max-w-5xl items-center justify-center rounded-3xl border border-border/80 bg-card p-6 text-center shadow-sm">
      <div className="max-w-md">
        <span className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-8" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-semibold text-foreground">
          Уведомления временно недоступны
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Не удалось получить свежие события. Повторите загрузку — текущие данные в CRM не изменены.
        </p>
        <Button
          onClick={reset}
          variant="outline"
          className="mt-6 min-h-11 rounded-xl px-5"
        >
          <RefreshCcw className="size-4" aria-hidden="true" />
          Попробовать снова
        </Button>
      </div>
    </div>
  )
}
