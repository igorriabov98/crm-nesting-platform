import { ArrowLeft } from 'lucide-react'

type ImpersonationBannerProps = {
  auditId: string
  adminName: string
  targetName: string
}

export function ImpersonationBanner({ auditId, adminName, targetName }: ImpersonationBannerProps) {
  const returnHref = `/api/impersonation/stop?audit=${encodeURIComponent(auditId)}`

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-3 text-xs text-amber-950 sm:px-5">
      <p className="min-w-0 truncate">
        <span className="font-semibold">Режим проверки:</span>{' '}
        вы работаете от лица <strong>{targetName}</strong>
        <span className="hidden sm:inline"> — все действия выполняются с его правами</span>
      </p>
      <a
        href={returnHref}
        className="inline-flex min-h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 font-semibold text-amber-950 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <ArrowLeft className="size-3.5" />
        <span className="hidden sm:inline">Вернуться к {adminName}</span>
        <span className="sm:hidden">Вернуться</span>
      </a>
    </div>
  )
}
