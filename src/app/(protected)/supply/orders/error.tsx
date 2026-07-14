'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function SupplyOrdersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[420px] items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-3xl border border-destructive/20 bg-card p-7 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Не удалось загрузить заказы</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Данные не изменены. Повторите загрузку страницы.</p>
        <Button type="button" className="mt-5" onClick={reset}><RotateCcw className="h-4 w-4" />Попробовать снова</Button>
      </div>
    </div>
  )
}
