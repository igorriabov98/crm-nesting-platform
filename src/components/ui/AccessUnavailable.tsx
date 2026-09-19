'use client'

import { useRouter } from 'next/navigation'
import { Button } from './button'

export function AccessUnavailable() {
  const router = useRouter()
  return <div role="alert" className="mx-auto max-w-lg space-y-4 rounded-xl border bg-white p-8">
    <h2 className="text-xl font-semibold">Не удалось проверить доступ</h2>
    <p className="text-muted-foreground">Проверка временно недоступна. Повторите попытку.</p>
    <Button onClick={() => router.refresh()}>Повторить проверку</Button>
  </div>
}
