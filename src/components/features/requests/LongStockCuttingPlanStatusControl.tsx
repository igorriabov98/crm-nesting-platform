'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPenLine, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  getLongStockCuttingPlanItemOverview,
  type LongStockCuttingPlanItemOverview,
  type LongStockCuttingPlanItemStatus,
} from '@/lib/actions/long-stock-cutting-plans'
import type { LongStockRequestItemTable } from '@/lib/long-stock-cutting-plan'
import {
  LongStockPlanningRecoveryDialog,
  LongStockRecalculationDialog,
} from './LongStockPositionDialog'
import { CancelReturnedSupplyPositionDialog } from './CancelReturnedSupplyPositionDialog'

type ProviderProps = {
  table: LongStockRequestItemTable
  itemId: string
  children: React.ReactNode
}

type ControlsContextValue = {
  table: LongStockRequestItemTable
  itemId: string
  status: LongStockCuttingPlanItemStatus
  setStatus: React.Dispatch<React.SetStateAction<LongStockCuttingPlanItemStatus>>
  overview: LongStockCuttingPlanItemOverview | null
  dialogOpen: boolean
  setDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  loadError: string | null
}

const ControlsContext = createContext<ControlsContextValue | null>(null)

export function LongStockCuttingPlanStatusProvider({ table, itemId, children }: ProviderProps) {
  const [status, setStatus] = useState<LongStockCuttingPlanItemStatus>('none')
  const [overview, setOverview] = useState<LongStockCuttingPlanItemOverview | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getLongStockCuttingPlanItemOverview({ table, id: itemId })
      .then((nextOverview) => {
        if (active) {
          setLoadError(null)
          setOverview(nextOverview)
          setStatus(nextOverview.status)
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить статус карты раскроя')
      })
    return () => { active = false }
  }, [itemId, table])

  return (
    <ControlsContext.Provider value={{
      table,
      itemId,
      status,
      setStatus,
      overview,
      dialogOpen,
      setDialogOpen,
      loadError,
    }}>
      {children}
    </ControlsContext.Provider>
  )
}

export function LongStockCuttingPlanStatusControl() {
  const { status, overview, loadError } = useControls()
  if (status === 'none' && !loadError) return null

  return (
    <div className="mt-1 flex flex-col items-start gap-1.5">
      {loadError && (
        <span className="max-w-[240px] whitespace-normal text-xs leading-snug text-red-700" role="alert">
          Карта раскроя: {loadError}
        </span>
      )}
      {overview && overview.segments.length > 0 && (
        <span className="max-w-[220px] whitespace-normal text-xs leading-snug text-slate-600">
          Отрезки: {overview.segments.map((segment) => `${formatLength(segment.length_mm)} × ${segment.piece_count}`).join(' + ')}
        </span>
      )}
      {status === 'requires_recalculation' && (
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
          Требует пересчёта
        </Badge>
      )}
      {status === 'planning' && (
        <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800">
          Карта не утверждена
        </Badge>
      )}
    </div>
  )
}

export function LongStockCuttingPlanActions() {
  const router = useRouter()
  const {
    table,
    itemId,
    status,
    setStatus,
    overview,
    dialogOpen,
    setDialogOpen,
  } = useControls()
  const cancelRef = overview?.cancel_return_ref ?? null
  const hasPlanAction = status === 'planning' || status === 'requires_recalculation'
  const canCancel = Boolean(cancelRef && overview?.can_cancel_return)

  if (!hasPlanAction && !canCancel) return null

  return (
    <div className="flex flex-col items-end gap-2">
      {status === 'requires_recalculation' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-amber-200 text-xs text-amber-800 hover:bg-amber-50 hover:text-amber-900"
          onClick={() => setDialogOpen(true)}
        >
          <RotateCcw className="size-3.5" />Пересчитать
        </Button>
      )}
      {status === 'planning' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-red-200 text-xs text-red-800 hover:bg-red-50 hover:text-red-900"
          onClick={() => setDialogOpen(true)}
        >
          <ClipboardPenLine className="size-3.5" />Подготовить карту
        </Button>
      )}
      {cancelRef && overview?.can_cancel_return && (
        <CancelReturnedSupplyPositionDialog table={cancelRef.table} itemId={cancelRef.id} compact />
      )}
      {status === 'planning' && (
        <LongStockPlanningRecoveryDialog
          requestItem={{ table, id: itemId }}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onApproved={() => {
            setStatus('active')
            router.refresh()
          }}
        />
      )}
      {status === 'requires_recalculation' && (
        <LongStockRecalculationDialog
          requestItem={{ table, id: itemId }}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onApproved={() => {
            setStatus('active')
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function useControls() {
  const value = useContext(ControlsContext)
  if (!value) throw new Error('Long-stock controls must be rendered inside LongStockCuttingPlanStatusProvider')
  return value
}

function formatLength(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}
