'use client'

import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type OrderActionsProps = {
 selectedCount: number
 isPending: boolean
 onMarkOrdered: () => void
 onMarkDelivered: () => void
}

export function OrderActions({ selectedCount, isPending, onMarkOrdered, onMarkDelivered }: OrderActionsProps) {
 return (
  <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-[#E8ECF0] bg-white/95 p-3 shadow-lg backdrop-blur">
   <span className="text-sm text-[#6B7280]">Выбрано: {selectedCount}</span>
   <Button disabled={selectedCount === 0 || isPending} onClick={onMarkOrdered}>
    {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
    Отметить как заказано
   </Button>
   <Button variant="outline" disabled={selectedCount === 0 || isPending} onClick={onMarkDelivered}>
    Отметить как доставлено
   </Button>
  </div>
 )
}
