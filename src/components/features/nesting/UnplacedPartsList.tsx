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
      <AlertTitle>Не удалось разместить {parts.length} деталей</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{parts.map((part) => part.name).join(', ')}</p>
        <div>
          <p className="font-medium text-red-900">Возможные причины:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Деталь больше доступного листа.</li>
            <li>Нет подходящего листа в справочнике по материалу и толщине.</li>
          </ul>
        </div>
      </AlertDescription>
    </Alert>
  )
}
