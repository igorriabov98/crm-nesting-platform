'use client'

import { Button } from '@/components/ui/button'

export default function CuttingAreaError({ error, reset }: { error: Error; reset: () => void }) {
  return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><p>Не удалось загрузить Участок заготовки: {error.message}</p><Button type="button" variant="outline" className="mt-4 min-h-11 border-red-300" onClick={reset}>Повторить</Button></div>
}
