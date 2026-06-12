'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { unreserveItem } from '@/lib/actions/supply-request'

type UnreserveButtonProps = {
  table: 'request_sheet_metal' | 'request_round_tube' | 'request_circle' | 'request_pipe' | 'request_knives' | 'request_components' | 'request_paint' | 'request_mesh' | 'request_chain_cord'
  itemId: string
}

export function UnreserveButton({ table, itemId }: UnreserveButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    startTransition(async () => {
      const result = await unreserveItem({ request_item_table: table, request_item_id: itemId })
      if (!result.success) {
        toast.error(result.error || 'Не удалось снять бронь')
        return
      }
      toast.success('Бронь снята')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={submit}
      disabled={isPending}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 disabled:opacity-50"
      title="Снять бронь"
    >
      <X className="h-4 w-4" />
    </button>
  )
}
