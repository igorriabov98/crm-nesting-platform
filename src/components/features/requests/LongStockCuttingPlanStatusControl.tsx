'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getLongStockCuttingPlanItemStatuses,
  type LongStockCuttingPlanItemStatus,
} from '@/lib/actions/long-stock-cutting-plans'
import type { LongStockRequestItemTable } from '@/lib/long-stock-cutting-plan'
import { LongStockRecalculationDialog } from './LongStockPositionDialog'

type Props = {
  table: LongStockRequestItemTable
  itemId: string
}

export function LongStockCuttingPlanStatusControl({ table, itemId }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<LongStockCuttingPlanItemStatus>('none')
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let active = true
    void getLongStockCuttingPlanItemStatuses([{ table, id: itemId }])
      .then((statuses) => {
        if (active) setStatus(statuses[`${table}:${itemId}`] ?? 'none')
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [itemId, table])

  if (status !== 'requires_recalculation') return null

  return (
    <>
      <div className="mt-1 flex flex-col items-start gap-1.5">
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
          Требует пересчёта
        </Badge>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-amber-800"
          onClick={() => setDialogOpen(true)}
        >
          <RotateCcw className="size-3.5" />Пересчитать
        </Button>
      </div>
      <LongStockRecalculationDialog
        requestItem={{ table, id: itemId }}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onApproved={() => {
          setStatus('active')
          router.refresh()
        }}
      />
    </>
  )
}
