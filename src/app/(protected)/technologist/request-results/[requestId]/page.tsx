import Link from 'next/link'
import { ArrowLeft, FileArchive, History } from 'lucide-react'
import { notFound } from 'next/navigation'
import { ApprovalDecisionActions } from '@/components/features/technologist/ApprovalDecisionActions'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getTechnologistApprovalDetail } from '@/lib/actions/technologist-request-approvals'
import { ROUTES } from '@/lib/constants/routes'
import {
  calculateWasteAggregate,
  formatApprovalVersion,
  type ApprovalSummaryItem,
  type ApprovalSummarySnapshot,
  type ApprovalVersionDiff,
} from '@/lib/technologist-request-approval'

const stateLabels: Record<string, string> = {
  pending: 'На согласовании', returned: 'Возвращена', superseded: 'Заменена', approved: 'Одобрена',
}
const fieldLabels: Record<string, string> = {
  name: 'наименование', quantity: 'количество', unit: 'единица', weightKg: 'вес',
  businessScrapReserved: 'бронь делового склада', regularStockReserved: 'бронь обычного склада', wastePercent: 'отходность',
}

function percent(value: number | null) { return value === null ? '—' : `${value.toFixed(1)}%` }
function quantity(value: number | null, unit: string) { return value === null ? '—' : `${value.toLocaleString('ru-RU')} ${unit}`.trim() }

function Summary({ snapshot }: { snapshot: ApprovalSummarySnapshot | null }) {
  if (!snapshot?.items) return <p className="text-sm text-slate-500">Старая заявка была одобрена до внедрения версий. Производственные последствия повторно не создаются.</p>
  const categories = [...new Set(snapshot.items.map((item) => item.category))]
  const total = calculateWasteAggregate(snapshot.items)
  return <div className="space-y-5">
    {categories.map((category) => {
      const items = snapshot.items.filter((item) => item.category === category)
      const aggregate = calculateWasteAggregate(items)
      return <section key={category} className="space-y-3" aria-labelledby={`category-${category}`}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 id={`category-${category}`} className="font-semibold text-slate-900">{items[0]?.categoryLabel}</h3>
          <p className="text-xs text-slate-500">Взвешенный: {percent(aggregate.weightedPercent)} · Средний: {percent(aggregate.averagePercent)}</p>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2 font-medium">Позиция</th><th className="px-3 py-2 font-medium">Заказано</th><th className="px-3 py-2 font-medium">Деловой склад</th><th className="px-3 py-2 font-medium">Обычный склад</th><th className="px-3 py-2 font-medium">Отходность</th></tr></thead>
            <tbody className="divide-y">{items.map((item) => <tr key={item.key}>
              <td className="px-3 py-3 font-medium">{item.name}</td><td className="px-3 py-3">{quantity(item.quantity, item.unit)}</td>
              <td className="px-3 py-3">{quantity(item.businessScrapReserved, item.unit)}</td><td className="px-3 py-3">{quantity(item.regularStockReserved, item.unit)}</td><td className="px-3 py-3">{percent(item.wastePercent)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
    })}
    <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3">
      <div><span className="text-slate-500">По всей заявке, взвешенный</span><p className="mt-1 font-semibold">{percent(total.weightedPercent)}</p></div>
      <div><span className="text-slate-500">По всей заявке, средний</span><p className="mt-1 font-semibold">{percent(total.averagePercent)}</p></div>
      <div><span className="text-slate-500">Время плазмы</span><p className="mt-1 font-semibold">{snapshot.enteredPlasmaMinutes} мин.</p></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Будущая деталировка</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">{snapshot.futureItems.length ? `${snapshot.futureItems.length} поз.` : 'Нет'}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileArchive className="h-4 w-4" />Архивы</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">{snapshot.archives.length ? snapshot.archives.map((archive) => archive.fileName).join(', ') : 'Нет'}</CardContent></Card>
    </div>
  </div>
}

function Diff({ diff }: { diff: ApprovalVersionDiff | null }) {
  if (!diff) return null
  const empty = !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.completionChanged.length
  if (empty) return <p className="text-sm text-slate-500">Изменений относительно текущей версии нет.</p>
  return <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm">
    <p className="font-medium text-blue-950">Изменения относительно текущей версии</p>
    {diff.added.map((item: ApprovalSummaryItem) => <p key={`a-${item.key}`} className="text-emerald-700">Добавлено: {item.name}</p>)}
    {diff.removed.map((item: ApprovalSummaryItem) => <p key={`r-${item.key}`} className="text-red-700">Удалено: {item.name}</p>)}
    {diff.changed.map((item) => <p key={`c-${item.after.key}`} className="text-amber-800">Изменено: {item.after.name} ({item.fields.map((field) => fieldLabels[field] || field).join(', ')})</p>)}
    {diff.completionChanged.map((field) => <p key={field} className="text-amber-800">Изменено: {field}</p>)}
  </div>
}

export default async function RequestResultDetailPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const result = await getTechnologistApprovalDetail(requestId)
  if (!result.data) {
    if (result.error === 'Заявка не найдена') notFound()
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">{result.error}</div>
  }
  const { request, versions, canReview, canEdit } = result.data
  const order = Array.isArray(request.machines) ? request.machines[0] : request.machines
  type VersionView = {
    id: string
    revision_number: number
    state: string
    is_legacy: boolean
    return_reason: string | null
    summary_snapshot: ApprovalSummarySnapshot | null
    diffToCurrent: ApprovalVersionDiff | null
  }
  const typedVersions = versions as VersionView[]
  const current = typedVersions[0] || null
  return <main className="mx-auto max-w-6xl space-y-6 pb-16">
    <Link className={buttonVariants({ variant: 'ghost', className: '-ml-3' })} href={ROUTES.TECHNOLOGIST_REQUEST_RESULTS}><ArrowLeft className="mr-2 h-4 w-4" />К итогам</Link>
    <header className="flex flex-col justify-between gap-4 rounded-xl border bg-white p-5 sm:flex-row sm:items-start">
      <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">Заявка №{request.request_number}</h1>{current && <Badge>{stateLabels[current.state] || current.state}</Badge>}</div><p className="mt-1 text-slate-600">{order?.name || 'Без названия'} · {order?.material_type === 'standard' ? 'Стандартный материал' : order?.material_type === 'non_standard' ? 'Нестандартный материал' : 'Тип не выбран'}</p></div>
      <ApprovalDecisionActions requestId={request.id} versionId={current?.id || null} canEdit={canEdit} canReview={canReview} pending={current?.state === 'pending'} />
    </header>
    <Card><CardHeader><CardTitle>Текущая сводка{current ? ` · Версия ${formatApprovalVersion(current.revision_number)}` : ''}</CardTitle></CardHeader><CardContent><Summary snapshot={current?.summary_snapshot || null} /></CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" />История версий</CardTitle></CardHeader><CardContent className="space-y-3">
      {typedVersions.length === 0 ? <p className="text-sm text-slate-500">Версий пока нет.</p> : typedVersions.map((version) => <details key={version.id} className="group rounded-lg border bg-white open:shadow-sm">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <span className="font-medium">Версия {formatApprovalVersion(version.revision_number)}</span><Badge variant="outline">{version.is_legacy ? 'Одобрена до согласования' : stateLabels[version.state] || version.state}</Badge>
        </summary>
        <div className="space-y-4 border-t p-4">
          {version.return_reason && <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-800"><strong>Причина возврата:</strong> {version.return_reason}</div>}
          <Diff diff={version.diffToCurrent} />
          <Summary snapshot={version.summary_snapshot?.items ? version.summary_snapshot : null} />
        </div>
      </details>)}
    </CardContent></Card>
  </main>
}
