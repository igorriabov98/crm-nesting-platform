'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getLongStockCuttingPlanItemOverview,
  type LongStockCuttingPlanItemOverview,
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
  const [overview, setOverview] = useState<LongStockCuttingPlanItemOverview | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let active = true
    void getLongStockCuttingPlanItemOverview({ table, id: itemId })
      .then((nextOverview) => {
        if (active) {
          setOverview(nextOverview)
          setStatus(nextOverview.status)
        }
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [itemId, table])

  if (status === 'none') return null

  return (
    <>
      <div className="mt-1 flex flex-col items-start gap-1.5">
        {overview && overview.segments.length > 0 && (
          <span className="max-w-[220px] whitespace-normal text-xs leading-snug text-slate-600">
            Отрезки: {overview.segments.map((segment) => `${formatLength(segment.length_mm)} × ${segment.piece_count}`).join(' + ')}
          </span>
        )}
        {status === 'requires_recalculation' && (
          <>
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
          </>
        )}
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

function formatLength(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}
