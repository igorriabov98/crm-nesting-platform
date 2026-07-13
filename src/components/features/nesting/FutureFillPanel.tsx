'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, CheckCircle2, Loader2, Plus, Scissors } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createFutureFillBatch, finalizeFutureFill, type FutureFillContext } from '@/lib/actions/nesting-future-fill'
import { usePermissions } from '@/components/providers/PermissionProvider'

type Props = {
  context: FutureFillContext | null
}

function formatDate(value: string | null) {
  if (!value) return '—'
  try {
    return new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU')
  } catch {
    return '—'
  }
}

function formatArea(value: number) {
  return `${Math.round(value / 1000).toLocaleString('ru-RU')} тыс. мм²`
}

export function FutureFillPanel({ context }: Props) {
  const router = useRouter()
  const { can } = usePermissions()
  const canManage = can('nesting', 'manage')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [isPending, startTransition] = useTransition()
  const selectedIds = Array.from(selected)
  const hasCandidates = Boolean(context?.candidates.length)
  const visibleCandidates = useMemo(() => context?.candidates.slice(0, 12) || [], [context?.candidates])

  if (!context) return null
  if (!context.isFutureFillProject && context.usableRemnants.length === 0 && !hasCandidates) return null

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const createBatch = () => {
    if (selectedIds.length === 0) {
      toast.error('Выберите будущие детали')
      return
    }

    startTransition(async () => {
      const result = await createFutureFillBatch({
        sourceProjectId: context.projectId,
        futureMachineItemIds: selectedIds,
      })
      if (!result.success || !result.data) {
        toast.error(result.error || 'Не удалось создать batch')
        return
      }
      toast.success('Batch с будущими деталями создан')
      router.push(`/nesting/${result.data.nestingProjectId}/parts`)
    })
  }

  const finalize = () => {
    startTransition(async () => {
      const result = await finalizeFutureFill({ projectId: context.projectId })
      if (!result.success) {
        toast.error(result.error || 'Не удалось зафиксировать результат')
        return
      }
      toast.success('Будущие детали и деловой остаток зафиксированы')
      router.refresh()
    })
  }

  return (
    <Card className="bg-white">
      <CardContent>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Scissors className="h-5 w-5 text-[#1B3A6B]" />
              <h3 className="font-semibold text-[#1B3A6B]">Заполнение свободного места</h3>
            </div>
            <p className="mt-1 text-sm text-[#6B7280]">
              Остатки листа: {context.usableRemnants.length}. Дата партии: {formatDate(context.batchDate)}.
            </p>
          </div>

          {context.isFutureFillProject ? (
            <Button onClick={finalize} disabled={!canManage || !context.canFinalize || context.finalized || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {context.finalized ? 'Зафиксировано' : 'Зафиксировать future-fill'}
            </Button>
          ) : (
            <Button onClick={createBatch} disabled={!canManage || !context.eligible || selectedIds.length === 0 || isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Создать batch ({selectedIds.length})
            </Button>
          )}
        </div>

        {context.usableRemnants.length > 0 && (
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {context.usableRemnants.slice(0, 6).map((remnant) => (
              <div key={`${remnant.sheetId}-${remnant.id}`} className="rounded-lg border border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2 text-sm">
                <div className="font-medium text-[#374151]">Лист {remnant.sheetIndex}</div>
                <div className="text-[#6B7280]">
                  {remnant.material}{remnant.steelTypeName ? ` / ${remnant.steelTypeName}` : ''}, {remnant.thickness} мм
                </div>
                <div className="text-[#6B7280]">
                  {Math.round(remnant.width)}x{Math.round(remnant.height)} мм · {formatArea(remnant.area)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!context.isFutureFillProject && (
          <div className="mt-4">
            {context.reason && !hasCandidates && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {context.reason}
              </div>
            )}

            {hasCandidates && (
              <div className="overflow-hidden rounded-lg border border-[#E8ECF0]">
                <div className="grid grid-cols-[44px_1fr_160px_120px] gap-3 border-b border-[#E8ECF0] bg-[#F8F9FA] px-3 py-2 text-sm font-medium text-[#6B7280]">
                  <span />
                  <span>Будущая деталь</span>
                  <span>Заготовка</span>
                  <span className="text-right">Остаток</span>
                </div>
                <div className="divide-y divide-[#E8ECF0]">
                  {visibleCandidates.map((candidate) => (
                    <label key={candidate.machineItemId} className="grid cursor-pointer grid-cols-[44px_1fr_160px_120px] gap-3 px-3 py-3 text-sm hover:bg-[#F8F9FA]">
                      <span className="flex items-center">
                        <input
                          type="checkbox"
                          disabled={!canManage}
                          checked={selected.has(candidate.machineItemId)}
                          onChange={(event) => toggle(candidate.machineItemId, event.target.checked)}
                          className="h-4 w-4"
                        />
                      </span>
                      <span>
                        <span className="block font-medium text-[#1B3A6B]">{candidate.productName}</span>
                        <span className="block text-[#6B7280]">
                          {candidate.machineName}{candidate.drawingNumber ? ` · ${candidate.drawingNumber}` : ''}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-[#374151]">
                        <CalendarClock className="h-4 w-4 text-[#6B7280]" />
                        {formatDate(candidate.cuttingDate)}
                      </span>
                      <span className="text-right font-medium text-[#374151]">{candidate.remainingQuantity}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
