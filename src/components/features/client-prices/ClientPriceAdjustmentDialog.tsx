'use client'

import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Loader2, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adjustClientProductPrices, applyClientPriceAdjustmentToOrders, type ClientPriceAdjustmentOrderCandidate } from '@/lib/actions/client-product-prices'
import { CLIENT_PRICE_COATING_LABELS, CLIENT_PRICE_COATINGS } from '@/lib/client-prices/constants'
import type { ClientPriceProductRow } from '@/lib/client-prices/types'
import type { CoatingType } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = { clientId: string; rows: ClientPriceProductRow[] }
type Direction = 'increase' | 'decrease'

function money(value: number) {
  return `€${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function ClientPriceAdjustmentDialog({ clientId, rows }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [direction, setDirection] = useState<Direction>('increase')
  const [percent, setPercent] = useState('')
  const [coatings, setCoatings] = useState<CoatingType[]>([...CLIENT_PRICE_COATINGS])
  const [adjustmentId, setAdjustmentId] = useState<string | null>(null)
  const [affectedPrices, setAffectedPrices] = useState(0)
  const [candidates, setCandidates] = useState<ClientPriceAdjustmentOrderCandidate[]>([])
  const [selectedMachines, setSelectedMachines] = useState<string[]>([])
  const [applicationResult, setApplicationResult] = useState<{ updatedPositions: number; skippedPositions: number; skipReasons: Record<string, number> } | null>(null)
  const [pending, setPending] = useState(false)

  const previewCount = useMemo(() => rows.reduce((count, row) => (
    count + coatings.filter((coating) => row.prices[coating] != null).length
  ), 0), [coatings, rows])

  const reset = () => {
    setDirection('increase')
    setPercent('')
    setCoatings([...CLIENT_PRICE_COATINGS])
    setAdjustmentId(null)
    setAffectedPrices(0)
    setCandidates([])
    setSelectedMachines([])
    setApplicationResult(null)
  }

  const changeOpen = (value: boolean) => {
    if (pending) return
    setOpen(value)
    if (!value) reset()
  }

  const submitAdjustment = async () => {
    setPending(true)
    try {
      const result = await adjustClientProductPrices({ clientId, direction, percent, coatings })
      if (!result.success || !result.data) throw new Error(result.error || 'Не удалось изменить прайс')
      setAdjustmentId(result.data.adjustmentId)
      setAffectedPrices(result.data.affectedPrices)
      setCandidates(result.data.candidates)
      toast.success(`Обновлено цен: ${result.data.affectedPrices}`)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось изменить прайс')
    } finally {
      setPending(false)
    }
  }

  const applyToOrders = async () => {
    if (!adjustmentId) return
    setPending(true)
    try {
      const result = await applyClientPriceAdjustmentToOrders({ adjustmentId, machineIds: selectedMachines })
      if (!result.success || !result.data) throw new Error(result.error || 'Не удалось обновить заказы')
      setApplicationResult(result.data)
      toast.success('Выбранные заказы обработаны')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить заказы')
    } finally {
      setPending(false)
    }
  }

  const toggleCoating = (coating: CoatingType) => setCoatings((current) => (
    current.includes(coating) ? current.filter((value) => value !== coating) : [...current, coating]
  ))
  const toggleMachine = (machineId: string) => setSelectedMachines((current) => (
    current.includes(machineId) ? current.filter((id) => id !== machineId) : [...current, machineId]
  ))

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} className="min-h-11 shrink-0">
        <SlidersHorizontal className="h-4 w-4" />
        Изменить цены
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{adjustmentId ? 'Обновить текущие заказы' : 'Массовое изменение прайса'}</DialogTitle>
            <DialogDescription>
              {adjustmentId
                ? `Прайс изменён: ${affectedPrices} цен. Выберите заказы, которые нужно пересчитать.`
                : 'Пустые цены не создаются. Каждая существующая цена будет округлена до €0,01.'}
            </DialogDescription>
          </DialogHeader>

          {applicationResult ? (
            <div className="space-y-3" role="status" aria-live="polite">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3"><div className="text-sm text-emerald-800">Обновлено позиций</div><div className="mt-1 text-2xl font-bold tabular-nums text-emerald-950">{applicationResult.updatedPositions}</div></div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"><div className="text-sm text-amber-800">Пропущено позиций</div><div className="mt-1 text-2xl font-bold tabular-nums text-amber-950">{applicationResult.skippedPositions}</div></div>
              </div>
              {Object.keys(applicationResult.skipReasons).length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <div className="font-semibold text-slate-950">Причины пропуска</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">{Object.entries(applicationResult.skipReasons).map(([reason, count]) => <li key={reason}>{reason}: {count}</li>)}</ul>
                </div>
              )}
            </div>
          ) : !adjustmentId ? (
            <div className="space-y-5">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-900">Направление</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {([
                    ['increase', 'Повысить цены', ArrowUpRight],
                    ['decrease', 'Понизить цены', ArrowDownRight],
                  ] as const).map(([value, label, Icon]) => (
                    <button key={value} type="button" aria-pressed={direction === value} onClick={() => setDirection(value)}
                      className={cn('flex min-h-11 items-center gap-2 rounded-lg border px-3 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
                        direction === value ? 'border-blue-700 bg-blue-50 text-blue-950' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}>
                      <Icon className="h-4 w-4" />{label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-2">
                <Label htmlFor="client-price-adjustment-percent">Процент, %</Label>
                <Input id="client-price-adjustment-percent" type="number" inputMode="decimal" min="0.01" max="50" step="0.01"
                  value={percent} onChange={(event) => setPercent(event.target.value)} placeholder="Например, 5" className="min-h-11" />
                <p className="text-xs text-slate-500">Допустимое значение: от 0,01% до 50%.</p>
              </div>

              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-slate-900">Покрытия</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {CLIENT_PRICE_COATINGS.map((coating) => (
                    <label key={coating} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm text-slate-800">
                      <Checkbox checked={coatings.includes(coating)} onCheckedChange={() => toggleCoating(coating)} />
                      {CLIENT_PRICE_COATING_LABELS[coating]}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950" aria-live="polite">
                Будет изменено существующих цен: <strong className="tabular-nums">{previewCount}</strong>
              </div>
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
              Подходящих текущих заказов нет. Новые заказы уже будут использовать обновлённый прайс.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Галочки по умолчанию сняты. Индивидуальные цены, не совпадающие со старым прайсом, останутся без изменений.
              </div>
              {candidates.map((candidate) => (
                <label key={candidate.machineId} className="flex cursor-pointer gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
                  <Checkbox checked={selectedMachines.includes(candidate.machineId)} onCheckedChange={() => toggleMachine(candidate.machineId)} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-slate-950">{candidate.machineName}</span>
                    <span className="mt-1 block text-sm tabular-nums text-slate-600">{money(candidate.beforeTotal)} → {money(candidate.afterTotal)}</span>
                    <span className="mt-1 block text-xs text-slate-500">Обновится позиций: {candidate.updatablePositions}; индивидуальных цен: {candidate.manualPricePositions}</span>
                    {candidate.invalidatesDiscount && (
                      <span className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-800"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />Обновление снимет текущую скидку и потребует нового согласования.</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => changeOpen(false)} disabled={pending} className="min-h-11">{applicationResult ? 'Готово' : adjustmentId ? 'Пропустить' : 'Отмена'}</Button>
            {!applicationResult && !adjustmentId ? (
              <Button type="button" onClick={submitAdjustment} disabled={pending || coatings.length === 0 || previewCount === 0 || Number(percent) < 0.01 || Number(percent) > 50} className="min-h-11">
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}Подтвердить изменение
              </Button>
            ) : !applicationResult && candidates.length > 0 ? (
              <Button type="button" onClick={applyToOrders} disabled={pending || selectedMachines.length === 0} className="min-h-11">
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}Обновить выбранные ({selectedMachines.length})
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
