import { FileArchive } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { calculateWasteAggregate, type ApprovalSummaryItem, type ApprovalSummarySnapshot, type ApprovalVersionDiff } from '@/lib/technologist-request-approval'
import { getTechnologistPositionDetails } from '@/lib/technologist-position-details'

const fieldLabels: Record<string, string> = {
  name: 'наименование', quantity: 'количество', unit: 'единица', weightKg: 'вес',
  businessScrapReserved: 'бронь делового склада', regularStockReserved: 'бронь обычного склада', wastePercent: 'отходность',
  attributes: 'характеристики позиции',
}

function percent(value: number | null) { return value === null ? '—' : `${value.toFixed(1)}%` }
function quantity(value: number | null, unit: string) { return value === null ? '—' : `${value.toLocaleString('ru-RU')} ${unit}`.trim() }

function Position({ item }: { item: ApprovalSummaryItem }) {
  const details = getTechnologistPositionDetails(item)
  return <div>
    <p className="font-medium text-slate-900">{item.name}</p>
    {details.length ? <p className="mt-1 text-xs font-normal leading-5 text-slate-500">{details.join(' · ')}</p> : null}
  </div>
}

export function ApprovalSummary({ snapshot }: { snapshot: ApprovalSummarySnapshot | null }) {
  if (!snapshot?.items) return <p className="text-sm text-slate-500">Старая заявка была одобрена до внедрения версий. Производственные последствия повторно не создаются.</p>
  const categories = [...new Set(snapshot.items.map((item) => item.category))]
  const total = calculateWasteAggregate(snapshot.items)
  return <div className="space-y-5">
    {categories.map((category) => {
      const items = snapshot.items.filter((item) => item.category === category)
      const aggregate = calculateWasteAggregate(items)
      return <section key={category} className="space-y-3" aria-label={items[0]?.categoryLabel}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="font-semibold text-slate-900">{items[0]?.categoryLabel}</h3>
          <p className="text-xs text-slate-500">Взвешенный: {percent(aggregate.weightedPercent)} · Средний: {percent(aggregate.averagePercent)}</p>
        </div>
        <div className="hidden overflow-x-auto rounded-lg border md:block">
          <table className="min-w-[760px] w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2 font-medium">Позиция</th><th className="px-3 py-2 font-medium">Заказано</th><th className="px-3 py-2 font-medium">Деловой склад</th><th className="px-3 py-2 font-medium">Обычный склад</th><th className="px-3 py-2 font-medium">Отходность</th></tr></thead>
            <tbody className="divide-y">{items.map((item) => <tr key={item.key}>
              <td className="px-3 py-3"><Position item={item} /></td><td className="px-3 py-3">{quantity(item.quantity, item.unit)}</td>
              <td className="px-3 py-3">{quantity(item.businessScrapReserved, item.unit)}</td><td className="px-3 py-3">{quantity(item.regularStockReserved, item.unit)}</td><td className="px-3 py-3">{percent(item.wastePercent)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.key} className="space-y-3 rounded-lg border p-4 text-sm">
          <Position item={item} />
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-slate-500">Заказано</dt><dd>{quantity(item.quantity, item.unit)}</dd></div>
            <div><dt className="text-slate-500">Отходность</dt><dd>{percent(item.wastePercent)}</dd></div>
            <div><dt className="text-slate-500">Деловой склад</dt><dd>{quantity(item.businessScrapReserved, item.unit)}</dd></div>
            <div><dt className="text-slate-500">Обычный склад</dt><dd>{quantity(item.regularStockReserved, item.unit)}</dd></div>
          </dl>
        </article>)}</div>
      </section>
    })}
    <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3">
      <div><span className="text-slate-500">По всей заявке, взвешенный</span><p className="mt-1 font-semibold">{percent(total.weightedPercent)}</p></div>
      <div><span className="text-slate-500">По всей заявке, средний</span><p className="mt-1 font-semibold">{percent(total.averagePercent)}</p></div>
      <div><span className="text-slate-500">Время плазмы</span><p className="mt-1 font-semibold">{snapshot.enteredPlasmaMinutes} мин. + 25% = {snapshot.enteredPlasmaMinutes + Math.ceil(snapshot.enteredPlasmaMinutes * 0.25)} мин.</p></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Будущая деталировка</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">{snapshot.futureItems.length ? <ul className="space-y-2">{snapshot.futureItems.map((raw, index) => {
        const item = raw as { name?: string; drawingNumber?: string; quantity?: number; unitWeightKg?: number }
        return <li key={index}>{item.name || 'Деталь'}{item.drawingNumber ? ` · ${item.drawingNumber}` : ''} — {item.quantity} шт.{item.unitWeightKg ? ` · ${item.unitWeightKg} кг/шт.` : ''}</li>
      })}</ul> : 'Нет'}</CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><FileArchive className="h-4 w-4" />Архивы</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">{snapshot.archives.length ? snapshot.archives.map((archive) => archive.fileName).join(', ') : 'Нет'}</CardContent></Card>
    </div>
  </div>
}

export function ApprovalDiff({ diff }: { diff: ApprovalVersionDiff | null }) {
  if (!diff) return null
  const empty = !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.completionChanged.length
  if (empty) return <p className="text-sm text-slate-500">Изменений относительно текущей версии нет.</p>
  return <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm">
    <p className="font-medium text-blue-950">Изменения относительно текущей версии</p>
    {diff.added.map((item: ApprovalSummaryItem) => <p key={`a-${item.key}`} className="text-emerald-700">Добавлено: {item.name}</p>)}
    {diff.removed.map((item: ApprovalSummaryItem) => <p key={`r-${item.key}`} className="text-red-700">Удалено: {item.name}</p>)}
    {diff.changed.map((item) => <div key={`c-${item.after.key}`} className="text-amber-800"><p>Изменено: {item.after.name}</p><ul className="ml-4 list-disc">{item.fields.map((field) => <li key={field}>{fieldLabels[field] || field}{field !== 'attributes' ? `: ${String(item.before[field as keyof ApprovalSummaryItem] ?? '—')} → ${String(item.after[field as keyof ApprovalSummaryItem] ?? '—')}` : ''}</li>)}</ul></div>)}
    {diff.completionChanged.map((field) => <p key={field} className="text-amber-800">Изменено: {field}</p>)}
    {diff.completionDetails.map((item, index) => <p key={index} className={item.before === null ? 'text-emerald-700' : item.after === null ? 'text-red-700' : 'text-amber-800'}>{item.label}: {item.before === null ? `добавлено ${item.after}` : item.after === null ? `удалено ${item.before}` : `${item.before} → ${item.after}`}</p>)}
  </div>
}
