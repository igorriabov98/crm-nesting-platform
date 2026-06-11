'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { ORDER_STATUS_LABELS } from '@/lib/constants/procurement'
import { markOrderDelivered, markOrderPlaced } from '@/lib/actions/supply-orders'
import type { OrderItemStatus } from '@/lib/types'

export type RequestItemTable =
  | 'request_sheet_metal'
  | 'request_round_tube'
  | 'request_circle'
  | 'request_pipe'
  | 'request_knives'
  | 'request_components'
  | 'request_paint'
  | 'request_mesh'
  | 'request_chain_cord'

const statusVariant = {
  pending: 'secondary',
  ordered: 'default',
  delivered: 'outline',
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
  id,
  status,
  canEdit = true,
}: {
  table: RequestItemTable
  id: string
  status: OrderItemStatus
  canEdit?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const update = (mode: 'ordered' | 'delivered') => {
    startTransition(async () => {
      const result = mode === 'ordered'
        ? await markOrderPlaced([{ table, id }])
        : await markOrderDelivered([{ table, id }])
      if (!result.success) {
        toast.error(result.error || 'Не удалось обновить статус')
        return
      }
      toast.success(mode === 'ordered' ? 'Отмечено как заказано' : 'Отмечено как доставлено')
      router.refresh()
    })
  }

  return (
    <div className="flex min-w-[145px] flex-col items-start gap-1">
      <Badge variant={statusVariant[status]}>{ORDER_STATUS_LABELS[status]}</Badge>
      {canEdit && status === 'pending' && (
        <button type="button" disabled={isPending} onClick={() => update('ordered')} className="text-xs font-medium text-[#1B3A6B] hover:underline">
          Отметить заказано
        </button>
      )}
      {canEdit && status === 'ordered' && (
        <button type="button" disabled={isPending} onClick={() => update('delivered')} className="text-xs font-medium text-emerald-700 hover:underline">
          Отметить доставлено
        </button>
      )}
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
