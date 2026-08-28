import { Badge } from '@/components/ui/badge'
import type { CompletionWasteItem } from '@/lib/actions/request-completion'
import {
  completionFutureBusinessScrapTotalLength,
  formatCompletionLengthMm,
  groupCompletionFutureBusinessScraps,
} from '@/lib/request-completion-future-scrap'

export function CompletionCuttingPlanCard({ item }: { item: CompletionWasteItem }) {
  const plan = item.planSummary
  if (!plan) return null

  const futureScrapGroups = groupCompletionFutureBusinessScraps(plan.futureBusinessScraps)
  const futureScrapTotalLength = completionFutureBusinessScrapTotalLength(plan.futureBusinessScraps)

  return <div className="space-y-4 rounded-xl border border-blue-200 bg-white p-4 shadow-xs">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-semibold text-slate-900">{item.itemName}</p><p className="mt-1 text-sm text-slate-500">Запланировано хлыстов: {plan.plannedBarCount}</p></div>
      <Badge className={plan.readyForSupply ? 'border-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100' : 'border-0 bg-red-100 text-red-800 hover:bg-red-100'}>{plan.readyForSupply ? 'Карта утверждена' : 'Нужно утвердить карту'}</Badge>
    </div>
    <section aria-labelledby={`future-scrap-${item.sourceId}`} className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`future-scrap-${item.sourceId}`} className="font-medium text-amber-950">Будущие деловые остатки</h3>
        {futureScrapGroups.length > 0 && <span className="text-sm text-amber-800">Общая длина: {formatCompletionLengthMm(futureScrapTotalLength)}</span>}
      </div>
      {futureScrapGroups.length > 0 ? <ul className="grid gap-2 sm:grid-cols-2">{futureScrapGroups.map((scrap) => <li key={`${scrap.state}-${scrap.lengthMm}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm shadow-xs">
        <span className="font-medium text-slate-800">{formatCompletionLengthMm(scrap.lengthMm)} × {scrap.pieceCount} шт.</span>
        <Badge className={scrap.state === 'future' ? 'border-0 bg-amber-100 text-amber-900 hover:bg-amber-100' : 'border-0 bg-emerald-100 text-emerald-800 hover:bg-emerald-100'}>
          {scrap.state === 'future' ? 'Ожидает факта резки' : 'Доступен'}
        </Badge>
      </li>)}</ul> : <p className="text-sm text-amber-900">По утверждённой карте положительных деловых остатков не запланировано.</p>}
      {futureScrapGroups.some((scrap) => scrap.state === 'future') && <p className="text-xs leading-5 text-amber-800">Каждый остаток станет доступен после сохранения факта резки соответствующего хлыста.</p>}
    </section>
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-600">Производственные факты не требуются для передачи заявки снабжению.</p>
  </div>
}
