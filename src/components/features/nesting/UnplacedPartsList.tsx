import { AlertTriangle, Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { NestingResult } from '@/lib/nesting/api'

type UnplacedPart = NestingResult['unplacedParts'][number]

export function UnplacedPartsList({ parts }: { parts: UnplacedPart[] }) {
  const excludedParts = parts.filter(isExcludedPart)
  const problemParts = parts.filter((part) => !isExcludedPart(part))

  if (parts.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {problemParts.length > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
          <AlertTitle>Не размещено: {problemParts.length}</AlertTitle>
          <AlertDescription>
            <PartsList parts={problemParts} tone="problem" />
          </AlertDescription>
        </Alert>
      ) : null}

      {excludedParts.length > 0 ? (
        <Alert>
          <Info className="mt-0.5 h-4 w-4 text-[#1B3A6B]" />
          <AlertTitle>Исключено из раскроя: {excludedParts.length}</AlertTitle>
          <AlertDescription>
            <PartsList parts={excludedParts} tone="info" />
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}

function PartsList({ parts, tone }: { parts: UnplacedPart[]; tone: 'problem' | 'info' }) {
  const itemClass = tone === 'problem'
    ? 'border-red-200 bg-red-50/60'
    : 'border-[#DDE3EA] bg-slate-50/60'
  const nameClass = tone === 'problem' ? 'text-red-950' : 'text-[#1B3A6B]'
  const reasonClass = tone === 'problem' ? 'text-red-900' : 'text-[#475569]'
  const badgeClass = tone === 'problem'
    ? 'border-red-300 text-red-800'
    : 'border-[#DDE3EA] text-[#475569]'

  return (
    <ul className="mt-2 space-y-2">
      {parts.map((part, index) => {
        const reason = part.reason || inferReasonFromName(part.name)
        const displayName = reason ? stripReasonFromName(part.name, reason) : part.name

        return (
          <li
            key={`${part.partId}-${index}`}
            className={`flex flex-col gap-1 rounded border px-3 py-2 sm:flex-row sm:items-start sm:justify-between ${itemClass}`}
          >
            <span className={`font-medium ${nameClass}`}>{displayName}</span>
            <span className={`inline-flex w-fit shrink-0 items-center gap-2 text-sm ${reasonClass}`}>
              <span className={`rounded border bg-white px-2 py-0.5 text-[11px] font-semibold ${badgeClass}`}>
                {reasonLabel(part.reasonCode)}
              </span>
              {reason || 'причина не указана'}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function reasonLabel(reasonCode: UnplacedPart['reasonCode']) {
  if (reasonCode === 'EXCLUDED') return 'EXCLUDED'
  if (reasonCode === 'EXCLUDED_PROFILE') return 'Профиль'
  if (reasonCode === 'EXCLUDED_PURCHASED') return 'Покупная'
  if (reasonCode === 'NO_SHEET_AVAILABLE') return 'NO_SHEET'
  return 'прочее'
}

function isExcludedPart(part: UnplacedPart) {
  return part.reasonCode === 'EXCLUDED' || part.reasonCode === 'EXCLUDED_PROFILE' || part.reasonCode === 'EXCLUDED_PURCHASED'
}

function inferReasonFromName(name: string) {
  const separator = ' - '
  const index = name.lastIndexOf(separator)
  return index >= 0 ? name.slice(index + separator.length).trim() : ''
}

function stripReasonFromName(name: string, reason: string) {
  const suffix = ` - ${reason}`
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
}
