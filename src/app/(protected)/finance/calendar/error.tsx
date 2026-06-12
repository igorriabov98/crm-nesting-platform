"use client"

import { Button } from '@/components/ui/button'

export default function FinanceCalendarError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-[#1B3A6B]">Финансовый план</h1>
      <p className="text-[#DC2626]">Ошибка загрузки данных: {error.message}</p>
      <Button onClick={reset}>Повторить</Button>
    </div>
  )
}
