'use client'

import { useId } from 'react'
import { Boxes, Calculator, CalendarClock, CircleAlert, Loader2, RotateCcw, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { LongStockSourceOption } from '@/lib/actions/long-stock-cutting-plans'
import { formatMm, longStockBarSourceLabel } from '@/lib/long-stock-position-ui'
import { longStockScenarioQuantityError, type LongStockScenario } from '@/lib/long-stock-scenarios'
import { cn } from '@/lib/utils'

export function LongStockScenarioSources({
  scenario, sources, factoryName, loading, loadError, disabled, readOnly = false,
  onQuantityChange, onRefresh, onRecommend, onRecalculate,
}: {
  scenario: Pick<LongStockScenario, 'status' | 'error' | 'quantities'>
  sources: readonly LongStockSourceOption[]
  factoryName: string
  loading: boolean
  loadError: string | null
  disabled: boolean
  readOnly?: boolean
  onQuantityChange: (inventoryId: string, value: string) => void
  onRefresh: () => void
  onRecommend: () => void
  onRecalculate: () => void
}) {
  const id = useId()
  const calculating = scenario.status === 'calculating'
  const hasQuantityError = Object.entries(scenario.quantities).some(([inventoryId, value]) =>
    longStockScenarioQuantityError(value, sources.find((source) => source.inventoryId === inventoryId)))
  if (readOnly) return <p className="rounded-lg border bg-slate-50 p-3 text-slate-700">Источники закреплены за принятым или забронированным материалом. Их замена в этой раскладке недоступна.</p>
  return (
    <section aria-label="Источники этой комбинации" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-xs leading-5 text-slate-600">Каждый выбранный хлыст получит хотя бы один рез. Закупку система подберёт заново после нажатия «Пересчитать». Другие комбинации не изменятся.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled || loading || calculating} onClick={onRefresh}><RotateCcw className="size-4" />Обновить источники</Button>
          <Button type="button" size="sm" variant="outline" disabled={disabled || loading || calculating} onClick={onRecommend}>Рекомендовать заново</Button>
        </div>
      </div>
      {loading && <p role="status" className="flex items-center gap-2 text-slate-600"><Loader2 className="size-4 animate-spin" />Проверяем доступность источников…</p>}
      {loadError && <p role="alert" className="text-red-700">{loadError}. Обновите источники перед пересчётом.</p>}
      <div className="grid gap-3 xl:grid-cols-2">
        {[{ own: true, title: `Завод машины — ${factoryName}` }, { own: false, title: 'Другие заводы' }].map((group) => {
          const options = sources.filter((source) => source.isOwnFactory === group.own)
          return <section key={String(group.own)} aria-label={group.title} className="min-w-0 rounded-lg border bg-slate-50/60 p-3">
            <h5 className="flex items-center gap-2 font-semibold text-slate-900">{group.own ? <Boxes className="size-4 shrink-0" /> : <Truck className="size-4 shrink-0" />}{group.title}</h5>
            {options.length === 0 && <p className="mt-3 text-xs text-slate-500">Подходящих источников нет</p>}
            <div className="mt-3 space-y-2">
              {options.map((source) => {
                const inputId = `${id}-${source.inventoryId}`
                const value = scenario.quantities[source.inventoryId] ?? '0'
                const error = longStockScenarioQuantityError(value, source)
                return <div key={source.inventoryId} className={cn('rounded-lg border bg-white p-3', error && 'border-amber-300')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-48">
                      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                        {source.source === 'future_business_remnant' && <CalendarClock className="size-4 shrink-0" />}
                        {longStockBarSourceLabel(source.source, source.availableFromDate)}
                        <Badge variant="outline">{formatMm(source.lengthMm)} мм</Badge>
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{source.factoryName}{source.sourceMachineName && ` · ${source.sourceMachineName}`}{source.sourceVersionNumber && ` · версия №${source.sourceVersionNumber}`}</p>
                      {source.sourceRequestId && source.sourceMachineId && <a className="text-xs text-blue-700 underline" href={`/sales-plan/${source.sourceMachineId}/request/${source.sourceRequestId}`} target="_blank" rel="noopener noreferrer">Исходная заявка</a>}
                      {source.requiresTransfer && <p className="mt-1 text-xs font-medium text-blue-700">Перевод {source.factoryName} → {factoryName}</p>}
                      {source.source === 'future_business_remnant' && <p className="mt-1 text-xs text-slate-600">Станет доступен только после фактической порезки.</p>}
                      {source.unavailableReason && <p className="mt-1 flex gap-1 text-xs leading-5 text-amber-800"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{source.unavailableReason}</p>}
                    </div>
                    <div className="w-28 space-y-1">
                      <Label htmlFor={inputId} className="text-xs">Выбрать, шт.</Label>
                      <Input id={inputId} className="min-h-10" type="number" min={0} step={1} inputMode="numeric" value={value}
                        disabled={disabled || loading || calculating || (!source.available && !Number(value))}
                        aria-label={`${longStockBarSourceLabel(source.source, source.availableFromDate)}, ${source.factoryName}, ${formatMm(source.lengthMm)} мм — выбрать хлысты`}
                        aria-invalid={Boolean(error)} aria-describedby={`${inputId}-availability ${inputId}-error`}
                        onChange={(event) => onQuantityChange(source.inventoryId, event.target.value)} />
                      <p id={`${inputId}-availability`} className="text-xs text-slate-600">Свободно: {source.availableQuantity} шт.</p>
                    </div>
                  </div>
                  <p id={`${inputId}-error`} role={error ? 'alert' : undefined} className="mt-1 text-xs text-amber-800">{error}</p>
                </div>
              })}
            </div>
          </section>
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2">
        <div className="min-w-0 flex-1 text-xs leading-5" aria-live="polite">
          {scenario.status === 'ready' ? <p className="text-slate-600">Расчёт соответствует выбранным источникам. Резерв создаётся только при утверждении.</p>
            : calculating ? <p className="text-slate-600">Пересчитываем только эту комбинацию…</p>
            : <p className="text-amber-800">{scenario.error || 'Источники изменены. Итоги ниже относятся к предыдущему расчёту; перед утверждением нажмите «Пересчитать».'}</p>}
        </div>
        <Button type="button" disabled={disabled || loading || Boolean(loadError) || calculating || hasQuantityError} onClick={onRecalculate}>
          {calculating ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}{calculating ? 'Пересчёт…' : 'Пересчитать'}
        </Button>
      </div>
    </section>
  )
}
