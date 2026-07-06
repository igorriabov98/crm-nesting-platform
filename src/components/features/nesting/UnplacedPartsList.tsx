import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { NestingResult } from '@/lib/nesting/api'

type UnplacedPart = NestingResult['unplacedParts'][number]

export function UnplacedPartsList({ parts }: { parts: UnplacedPart[] }) {
  if (parts.length === 0) {
    return null
  }

  return (
    <Alert variant="destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 text-red-600" />
      <AlertTitle>Не размещено: {parts.length}</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 space-y-2">
          {parts.map((part, index) => {
            const reason = part.reason || inferReasonFromName(part.name)
            const displayName = reason ? stripReasonFromName(part.name, reason) : part.name

            return (
              <li
                key={`${part.partId}-${index}`}
                className="flex flex-col gap-1 rounded border border-red-200 bg-red-50/60 px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
              >
                <span className="font-medium text-red-950">{displayName}</span>
                <span className="inline-flex w-fit shrink-0 items-center gap-2 text-sm text-red-900">
                  <span className="rounded border border-red-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-800">
                    {reasonLabel(part.reasonCode)}
                  </span>
                  {reason || 'причина не указана'}
                </span>
              </li>
            )
          })}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

function reasonLabel(reasonCode: UnplacedPart['reasonCode']) {
  if (reasonCode === 'EXCLUDED') return 'EXCLUDED'
  if (reasonCode === 'NO_SHEET_AVAILABLE') return 'NO_SHEET'
  return 'прочее'
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
