'use client'

import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { stopUserImpersonation } from '@/lib/actions/impersonation'
import { ROUTES } from '@/lib/constants/routes'

type ImpersonationBannerProps = {
  adminName: string
  targetName: string
}

export function ImpersonationBanner({ adminName, targetName }: ImpersonationBannerProps) {
  const [isStopping, setIsStopping] = useState(false)

  async function handleStop() {
    if (isStopping) return
    setIsStopping(true)
    try {
      const result = await stopUserImpersonation()
      if (!result.success) toast.error(result.error)
      window.location.assign(result.redirectTo || ROUTES.LOGIN)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось завершить режим проверки')
      window.location.assign(ROUTES.LOGIN)
    }
  }

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-3 text-xs text-amber-950 sm:px-5">
      <p className="min-w-0 truncate">
        <span className="font-semibold">Режим проверки:</span>{' '}
        вы работаете от лица <strong>{targetName}</strong>
        <span className="hidden sm:inline"> — все действия выполняются с его правами</span>
      </p>
      <button
        type="button"
        className="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-semibold text-amber-950 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:cursor-wait disabled:opacity-60"
        disabled={isStopping}
        onClick={handleStop}
      >
        <ArrowLeft className="size-3.5" />
        <span className="hidden sm:inline">{isStopping ? 'Возвращаем…' : `Вернуться к ${adminName}`}</span>
        <span className="sm:hidden">Вернуться</span>
      </button>
    </div>
  )
}
