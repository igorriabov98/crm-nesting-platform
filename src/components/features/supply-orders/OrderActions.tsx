'use client'

import { CheckCheck, Loader2, PackageCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

type OrderActionsProps = {
 selectedCount: number
 isPending: boolean
 onMarkOrdered: () => void
 onMarkDelivered: () => void
}

export function OrderActions({ selectedCount, isPending, onMarkOrdered, onMarkDelivered }: OrderActionsProps) {
 return (
  <div className="sticky bottom-3 z-20 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-card/95 p-3 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-card/90 sm:flex-row sm:items-center sm:justify-between">
   <div className="flex items-center gap-3">
    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
     <CheckCheck className="h-4 w-4" />
    </div>
    <div>
     <div className="text-sm font-semibold text-foreground">Выбрано позиций: {selectedCount}</div>
     <div className="text-xs text-muted-foreground">Действие применяется только к отмеченным строкам</div>
    </div>
   </div>
   <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
    <Button className="min-h-10" disabled={selectedCount === 0 || isPending} onClick={onMarkOrdered}>
     {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <CheckCheck className="h-4 w-4" />}
     Отметить заказано
    </Button>
    <Button className="min-h-10" variant="outline" disabled={selectedCount === 0 || isPending} onClick={onMarkDelivered}>
     <PackageCheck className="h-4 w-4" />
     Отметить доставлено
    </Button>
   </div>
  </div>
 )
}
