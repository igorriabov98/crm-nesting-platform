import { Badge } from '@/components/ui/badge'
import { getSupplyRequestPositionStatus, type SupplyRequestItemTable } from '@/lib/supply-request-reservation-policy'
import type { OrderItemStatus } from '@/lib/types'

export type RequestItemTable = SupplyRequestItemTable

const statusVariant = {
  pending: 'secondary',
  ordered: 'default',
  delivered: 'outline',
  cancelled: 'outline',
} as const

export function formatAmount(value: number | null | undefined) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0))
}

export function stockText(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return '—'
  return `${formatAmount(value)} ${unit}`
}

export function toOrderCell(needed: number, reserved: number, unit: string) {
  const value = Math.max(needed - reserved, 0)
  const tone = value === 0 ? 'text-emerald-700' : reserved === 0 ? 'text-red-700' : 'text-amber-700'
  return <span className={`font-semibold ${tone}`}>{formatAmount(value)} {unit}</span>
}

export function OrderStatusCell({
  table,
  status,
  needed,
  reserved,
  covered,
  pipeType,
}: {
  table: RequestItemTable
  status: OrderItemStatus
  needed: number
  reserved: number | null | undefined
  covered: number | null | undefined
  pipeType?: unknown
}) {
  const label = getSupplyRequestPositionStatus({ table, status, needed, reserved, covered, pipeType })

  return (
    <div className="flex min-w-[145px] flex-col items-start gap-1">
      <Badge variant={label === 'Закрыто со склада' || label === 'Забронировано по раскладке' ? 'outline' : statusVariant[status]}>
        {label}
      </Badge>
    </div>
  )
}

export function EmptyRows({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-sm text-slate-400">
        Позиций нет
      </td>
    </tr>
  )
}

export const stickyCellClass = 'sticky left-0 z-10 bg-white shadow-[1px_0_0_#E8ECF0]'
export const tableClass = 'w-full min-w-[980px] whitespace-nowrap text-left text-sm'
export const thClass = 'px-3 py-2 font-medium text-[#6B7280]'
export const tdClass = 'px-3 py-2 text-[#374151]'
