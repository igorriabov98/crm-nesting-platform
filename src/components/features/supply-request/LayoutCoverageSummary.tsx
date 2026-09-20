import { ExternalLink } from 'lucide-react'
import type { LayoutCoverage } from '@/lib/actions/supply-request'
import { formatAmount } from './SupplyRequestTableShared'

type Props = {
  coverage: LayoutCoverage | null
}

const statusLabel: Record<LayoutCoverage['status'], string> = {
  approved: 'Утверждена',
  needs_recalculation: 'Требуется пересчёт',
  not_approved: 'Раскладка не утверждена',
}

export function LayoutCoverageSources({ coverage }: Props) {
  if (!coverage || coverage.status !== 'approved') {
    return <LayoutCoverageState coverage={coverage} />
  }
  return (
    <div className="min-w-[230px] space-y-1 text-sm">
      <p>
        <span className="text-slate-500">Основной склад — забронировано по раскладке:</span> {formatAmount(coverage.warehouse_mm)} мм
        {coverage.warehouse_factories.length > 0 && <span className="text-xs text-slate-500"> · {coverage.warehouse_factories.join(', ')}</span>}
      </p>
      <p>
        <span className="text-slate-500">Деловой остаток — забронировано по раскладке:</span> {formatAmount(coverage.business_scrap_mm)} мм
        {coverage.business_scrap_factories.length > 0 && <span className="text-xs text-slate-500"> · {coverage.business_scrap_factories.join(', ')}</span>}
      </p>
    </div>
  )
}

export function LayoutCoveragePurchase({ coverage }: Props) {
  if (!coverage || coverage.status !== 'approved') return <span className="text-slate-400">—</span>
  if (coverage.purchase_bars.length === 0) return <span className="text-emerald-700">Закупка не требуется</span>
  return (
    <div className="min-w-[180px] space-y-1 text-sm">
      {coverage.purchase_bars.map((bar) => (
        <p key={bar.length_mm}>{formatAmount(bar.quantity)} × {formatAmount(bar.length_mm)} мм</p>
      ))}
      <p className="text-xs font-medium text-slate-700">Всего к закупке: {formatAmount(coverage.purchase_total_mm)} мм</p>
      <p className="text-xs text-slate-500">Полезная длина деталей: {formatAmount(coverage.purchase_covered_mm)} мм</p>
    </div>
  )
}

export function LayoutCoverageState({ coverage }: Props) {
  const status = coverage?.status || 'not_approved'
  return (
    <div className="min-w-[170px] space-y-1">
      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        status === 'approved'
          ? 'bg-emerald-50 text-emerald-700'
          : status === 'needs_recalculation'
            ? 'bg-amber-50 text-amber-800'
            : 'bg-slate-100 text-slate-600'
      }`}>
        {statusLabel[status]}
      </span>
      {coverage?.version_id && (
        <a
          className="inline-flex items-center gap-1 text-xs font-medium text-[#1B3A6B] underline-offset-2 hover:underline"
          href={`/api/production/cutting-area/cutting-plans/${coverage.version_id}`}
          target="_blank"
          rel="noreferrer"
        >
          Открыть раскладку №{coverage.plan_number}
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  )
}
