import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import type { OrderItemStatus } from '@/lib/types'

const STATUS_CLASS_NAMES: Record<OrderItemStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  ordered: 'border-blue-200 bg-blue-50 text-blue-800',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

export function RequestItemOrderStatus({ status }: { status?: OrderItemStatus | null }) {
  const resolvedStatus = status || 'pending'
  return (
    <Badge variant="outline" className={STATUS_CLASS_NAMES[resolvedStatus]}>
      {ORDER_STATUS_LABELS[resolvedStatus]}
    </Badge>
  )
}
