import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RequestStatus } from '@/lib/types'

const STATUS_LABELS: Record<RequestStatus, string> = {
  draft: 'Черновик',
  pending_stock_check: 'Бронь делового остатка',
  stock_checked: 'Бронь основного склада',
  pending_financial_approval: 'На финансовом согласовании',
  submitted_to_supply: 'Отправлена в снабжение',
  completed: 'Завершена',
  cancelled: 'Отменена',
}

const STATUS_CLASSES: Record<RequestStatus, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-700',
  pending_stock_check: 'border-amber-200 bg-amber-50 text-amber-700',
  stock_checked: 'border-blue-200 bg-blue-50 text-blue-700',
  pending_financial_approval: 'border-violet-200 bg-violet-50 text-violet-700',
  submitted_to_supply: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  completed: 'border-green-300 bg-green-100 text-green-800',
  cancelled: 'border-slate-300 bg-slate-100 text-slate-700',
}

export function RequestStatusBadge({ status, className, approvalState }: { status: RequestStatus; className?: string; approvalState?: string | null }) {
  const returned = approvalState === 'returned' && (status === 'pending_stock_check' || status === 'stock_checked')
  return (
    <Badge variant="outline" className={cn(returned ? 'border-red-200 bg-red-50 text-red-700' : STATUS_CLASSES[status], className)}>
      {returned ? 'Возвращена на доработку' : STATUS_LABELS[status]}
    </Badge>
  )
}

export function getRequestStatusLabel(status: RequestStatus) {
  return STATUS_LABELS[status]
}
