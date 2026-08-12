import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import {
  formatMaterialRequestStockQuantity,
  getMaterialRequestStockCoverage,
  isMaterialRequestItemReservedFromStock,
  type MaterialRequestItemTable,
} from '@/lib/material-request-stock-coverage'
import type { OrderItemStatus } from '@/lib/types'

const STATUS_CLASS_NAMES: Record<OrderItemStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  ordered: 'border-blue-200 bg-blue-50 text-blue-800',
  delivered: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

type Props = {
  status?: OrderItemStatus | null
  itemTable: MaterialRequestItemTable
  item: unknown
}

export function RequestItemOrderStatus({ status, itemTable, item }: Props) {
  const resolvedStatus = status || 'pending'
  const coverage = getMaterialRequestStockCoverage(itemTable, item)
  if (isMaterialRequestItemReservedFromStock(resolvedStatus, itemTable, item)) {
    return (
      <Badge
        variant="outline"
        title="Потребность полностью покрыта складом"
        className="border-sky-200 bg-sky-50 text-sky-800"
      >
        Забронировано со склада
      </Badge>
    )
  }
  const isPartiallyReserved = resolvedStatus !== 'delivered'
    && coverage.needed > 0
    && coverage.reserved > 0
    && coverage.reserved < coverage.needed
  if (isPartiallyReserved) {
    return (
      <div className="min-w-[180px] space-y-1 text-xs leading-5">
        <div className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-sky-900">
          Забронировано:{' '}
          <span className="font-semibold">
            {formatMaterialRequestStockQuantity(coverage.reserved, coverage.unit)}
          </span>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
          К заказу:{' '}
          <span className="font-semibold">
            {formatMaterialRequestStockQuantity(coverage.needed - coverage.reserved, coverage.unit)}
          </span>
        </div>
      </div>
    )
  }
  return (
    <Badge variant="outline" className={STATUS_CLASS_NAMES[resolvedStatus]}>
      {ORDER_STATUS_LABELS[resolvedStatus]}
    </Badge>
  )
}
