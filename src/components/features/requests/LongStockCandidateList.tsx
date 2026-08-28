'use client'

import { useId, type ReactNode } from 'react'
import { Boxes, Check, ChevronDown, Recycle, ShoppingCart, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { LongStockCuttingCandidate } from '@/lib/long-stock-cutting-solver'
import {
  candidateMaterialBreakdown,
  formatKg,
  formatLongStockComposition,
  formatMm,
  groupLongStockLengths,
  longStockBarSourceLabel,
  type LongStockNewBarOrigin,
} from '@/lib/long-stock-position-ui'
import { cn } from '@/lib/utils'

export type LongStockSummarySource = {
  inventoryId: string
  factoryName: string
  isOwnFactory: boolean
  sourceMachineName: string | null
  sourceVersionNumber: number | null
}

type SummaryProps = {
  candidate: LongStockCuttingCandidate
  minimumUsefulLengthMm: number
  sources?: readonly LongStockSummarySource[]
  newBarOrigin?: LongStockNewBarOrigin
  factoryName?: string
  sourceEditor?: ReactNode
  stale?: boolean
}

export function LongStockCandidateSummary({
  candidate, minimumUsefulLengthMm, sources = [], newBarOrigin = 'purchase', factoryName, sourceEditor, stale,
}: SummaryProps) {
  const breakdown = candidateMaterialBreakdown(candidate, newBarOrigin)
  const destination = factoryName ?? sources.find((source) => source.isOwnFactory)?.factoryName ?? 'завод машины'
  return (
    <section aria-label="Состав выбранной комбинации" className="space-y-4 p-4 text-sm">
      <h4 className="font-semibold text-slate-900">Состав выбранной комбинации</h4>
      {sourceEditor}
      {stale && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900" role="status">Предыдущий расчёт — состав закупки, резы и остатки будут обновлены после пересчёта.</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="min-w-0 rounded-lg border border-slate-200 bg-slate-50/70 p-3" aria-label="Хлысты со склада">
          <h5 className="flex items-center gap-2 font-semibold text-slate-900"><Boxes className="size-4 shrink-0" />Со склада · {breakdown.stockBars.length} шт.</h5>
          <p className="mt-1 text-xs text-slate-600">Всего {formatMm(breakdown.stockLengthMm)} мм</p>
          {breakdown.stockBars.length === 0 ? <p className="mt-3 text-slate-500">Не используется</p> : (
            <ul className="mt-3 space-y-3">
              {breakdown.stockBars.map((bar) => {
                const source = sources.find((option) => option.inventoryId === bar.sourceInventoryId)
                return (
                  <li key={bar.barNumber} className="border-t border-slate-200 pt-2">
                    <p className="font-medium text-slate-900">Хлыст №{bar.barNumber} · {formatMm(bar.stockLengthMm)} мм</p>
                    <p className="mt-1 text-xs text-slate-600">{longStockBarSourceLabel(bar.source, bar.availableFromDate, newBarOrigin)}{source && ` · ${source.factoryName}`}</p>
                    {source?.sourceMachineName && <p className="text-xs text-slate-600">{source.sourceMachineName}{source.sourceVersionNumber ? ` · версия №${source.sourceVersionNumber}` : ''}</p>}
                    {bar.requiresTransfer && <p className="mt-1 text-xs font-medium text-blue-700">Перевод {source?.factoryName ?? 'с другого завода'} → {destination}</p>}
                    <p className="mt-1 text-xs text-slate-700">Резы: {formatLongStockComposition(groupLongStockLengths(bar.cuts.map((cut) => cut.lengthMm)))}</p>
                    <p className="mt-1 text-xs text-slate-700">Остаток: {formatMm(bar.remainderMm)} мм</p>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section className="min-w-0 rounded-lg border border-blue-200 bg-blue-50/50 p-3" aria-label="Хлысты в закупку">
          <h5 className="flex items-center gap-2 font-semibold text-slate-900"><ShoppingCart className="size-4 shrink-0" />В закупку · {breakdown.purchaseBars.length} шт.</h5>
          <p className="mt-1 text-xs text-slate-600">Всего {formatMm(breakdown.purchasedLengthMm)} мм</p>
          {breakdown.purchaseBars.length === 0 ? <p className="mt-3 text-slate-600">Закупка не требуется</p> : (
            <>
              <ul className="mt-3 space-y-2 font-medium text-slate-900">
                {breakdown.purchaseGroups.map((group) => <li key={group.lengthMm}>{formatLongStockComposition([group])}</li>)}
              </ul>
              <p className="mt-3 text-xs text-slate-600">Только эти хлысты попадут в потребность снабжения после утверждения.</p>
            </>
          )}
        </section>
        <section className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3" aria-label="Будущие складские остатки">
          <h5 className="flex items-center gap-2 font-semibold text-slate-900"><Recycle className="size-4 shrink-0" />Будущие остатки · {breakdown.remnantBars.length} шт.</h5>
          <p className="mt-1 text-xs text-slate-600">Появятся после фактической порезки</p>
          {breakdown.remnantBars.length === 0 ? <p className="mt-3 text-slate-600">Без остатка</p> : (
            <ul className="mt-3 space-y-3">
              {breakdown.remnantBars.map((bar) => (
                <li key={bar.barNumber} className="border-t border-emerald-200 pt-2">
                  <p className="font-medium tabular-nums text-emerald-900">{formatMm(bar.remainderMm)} мм × 1 шт.</p>
                  <p className="mt-1 text-xs text-slate-600">Из хлыста №{bar.barNumber} · {formatMm(bar.stockLengthMm)} мм · {longStockBarSourceLabel(bar.source, bar.availableFromDate, newBarOrigin)}</p>
                  {bar.remainderMm < minimumUsefulLengthMm && <p className="mt-1 text-xs text-amber-800">Мелочь · также попадёт на склад</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  )
}

export function LongStockCandidateList({
  candidates, selectedKey, bestKey, weightPerMeterKg, minimumUsefulLengthMm,
  sources, newBarOrigin = 'purchase', onSelect, factoryName, renderSourceEditor, scenarioStates = {},
}: Omit<SummaryProps, 'candidate' | 'sourceEditor' | 'stale'> & {
  candidates: LongStockCuttingCandidate[]
  selectedKey: string | null
  bestKey: string | null
  weightPerMeterKg: number | null
  onSelect: (candidate: LongStockCuttingCandidate) => void
  renderSourceEditor?: (candidate: LongStockCuttingCandidate) => ReactNode
  scenarioStates?: Record<string, string>
}) {
  const id = useId()
  return (
    <div className="space-y-3">
      {candidates.map((candidate, index) => {
        const selected = candidate.key === selectedKey
        const best = candidate.key === bestKey
        const breakdown = candidateMaterialBreakdown(candidate, newBarOrigin)
        const ownBars = breakdown.stockBars.filter((bar) => !bar.requiresTransfer)
        const otherBars = breakdown.stockBars.filter((bar) => bar.requiresTransfer)
        const stale = Boolean(scenarioStates[candidate.key] && scenarioStates[candidate.key] !== 'ready')
        const summaryId = `${id}-summary-${index}`
        const remainderWeightKg = weightPerMeterKg !== null && Number.isFinite(weightPerMeterKg) && weightPerMeterKg > 0
          ? candidate.totalRemainderMm / 1000 * weightPerMeterKg : null
        return (
          <div key={candidate.key} className={cn('overflow-hidden rounded-xl border bg-white', selected ? 'border-blue-500 ring-1 ring-blue-500' : best && 'border-emerald-300')}>
            <button
              type="button"
              aria-expanded={selected}
              aria-controls={selected ? summaryId : undefined}
              onClick={() => onSelect(candidate)}
              className={cn('w-full space-y-3 p-4 text-left transition-colors hover:bg-blue-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600',
                best && 'bg-emerald-50/70', selected && 'bg-blue-50/50')}
            >
              <span className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                {breakdown.purchaseBars.length ? `Закупка: ${formatLongStockComposition(breakdown.purchaseGroups)}` : 'Без закупки'}
                {best && !stale && <Badge className="bg-emerald-700 text-white"><Check />{candidate.searchComplete ? 'Лучший' : 'Лучший найденный'}</Badge>}
                {selected && <Badge variant="outline" className="border-blue-300 text-blue-800">Выбран</Badge>}
                {stale && <Badge variant="outline" className="border-amber-300 text-amber-800">{scenarioStates[candidate.key] === 'calculating' ? 'Пересчёт…' : 'Требуется пересчёт'}</Badge>}
                {candidate.usesNonstandardLength && <Badge variant="outline" className="border-violet-200 text-violet-700"><Sparkles />Есть нестандартная</Badge>}
                <ChevronDown aria-hidden="true" className={cn('ml-auto size-4 shrink-0 text-slate-500', selected && 'rotate-180')} />
              </span>
              <span className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <CompositionMetric label={`Со своего завода · ${ownBars.length} шт.`} value={formatLongStockComposition(groupLongStockLengths(ownBars.map((bar) => bar.stockLengthMm))) || 'Не используется'} />
                <CompositionMetric label={`С других заводов · ${otherBars.length} шт.`} value={formatLongStockComposition(groupLongStockLengths(otherBars.map((bar) => bar.stockLengthMm))) || 'Не используется'} />
                <CompositionMetric label={`В закупку · ${breakdown.purchaseBars.length} шт.`} value={formatLongStockComposition(breakdown.purchaseGroups) || 'Не требуется'} />
                <CompositionMetric label={`Будущие остатки · ${breakdown.remnantBars.length} шт.`} value={formatLongStockComposition(breakdown.remnantGroups) || 'Без остатка'} />
              </span>
              <span className="block text-xs tabular-nums text-slate-600">Закупаемая длина: {formatMm(breakdown.purchasedLengthMm)} мм · Суммарный остаток: {formatMm(candidate.totalRemainderMm)} мм{remainderWeightKg !== null && ` · ${formatKg(remainderWeightKg)} кг`}</span>
            </button>
            {selected && (
              <div id={summaryId} className="border-t border-blue-200">
                <LongStockCandidateSummary candidate={candidate} minimumUsefulLengthMm={minimumUsefulLengthMm} sources={sources} newBarOrigin={newBarOrigin}
                  factoryName={factoryName} sourceEditor={renderSourceEditor?.(candidate)} stale={stale} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CompositionMetric({ label, value }: { label: string; value: string }) {
  return <span className="min-w-0"><span className="block text-xs text-slate-600">{label}</span><span className="mt-1 block font-medium tabular-nums text-slate-900">{value}</span></span>
}
