import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RequestStatus } from '@/lib/types'

const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Черновик',
  pending_stock_check: 'Проверка склада',
  stock_checked: 'Склад проверен',
  submitted_to_supply: 'Отправлена в снабжение',
  completed: 'Завершена',
}

const STATUS_CLASSES: Record<RequestStatus, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-700',
  pending_stock_check: 'border-amber-200 bg-amber-50 text-amber-700',
  stock_checked: 'border-blue-200 bg-blue-50 text-blue-700',
  submitted_to_supply: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  completed: 'border-green-300 bg-green-100 text-green-800',
}

export function RequestStatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_CLASSES[status], className)}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

export function getRequestStatusLabel(status: RequestStatus) {
  return STATUS_LABELS[status]
}
