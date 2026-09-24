import { FileArchive } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { calculateWasteAggregate, type ApprovalSummaryItem, type ApprovalSummarySnapshot, type ApprovalVersionDiff } from '@/lib/technologist-request-approval'
import { getTechnologistPositionDetails } from '@/lib/technologist-position-details'

const fieldLabels: Record<string, string> = {
  name: 'наименование', quantity: 'количество', unit: 'единица', weightKg: 'вес',
  businessScrapReserved: 'бронь делового склада', regularStockReserved: 'бронь обычного склада', wastePercent: 'отходность',
  attributes: 'характеристики позиции', procurement: 'закупка по согласованию',
  wasteBasisKg: 'база отходности', businessScrapWeightKg: 'вес будущего делового остатка',
  metalScrapKg: 'металлолом', processedUsefulKg: 'полезный вес обработанного листа', futureSheetScraps: 'будущие листовые остатки',
}

function percent(value: number | null) { return value === null ? '—' : `${value.toFixed(1)}%` }
function quantity(value: number | null, unit: string) { return value === null ? '—' : `${value.toLocaleString('ru-RU')} ${unit}`.trim() }

function Procurement({ item }: { item: ApprovalSummaryItem }) {
  const plan = item.procurement
  if (!plan || plan.unavailable) return <span className="text-slate-500">Нет данных о согласованной закупке</span>
  return <div>{plan.components.map(part => <div key={`${part.length_mm}:${part.is_nonstandard}`}>{part.piece_count.toLocaleString('ru-RU')} шт × {part.length_mm.toLocaleString('ru-RU')} мм</div>)}<div>{plan.components.length ? 'Всего: ' : ''}{quantity(plan.quantity, plan.unit)}</div></div>
}

function Position({ item }: { item: ApprovalSummaryItem }) {
  const details = getTechnologistPositionDetails(item)
  return <div>
    <p className="font-medium text-slate-900">{item.name}</p>
    {details.length ? <p className="mt-1 text-xs font-normal leading-5 text-slate-500">{details.join(' · ')}</p> : null}
  </div>
}

function SheetWasteDetails({ item, states, approvalState }: {
  item: ApprovalSummaryItem
  states?: Record<string, 'future' | 'available'>
  approvalState?: string
}) {
  if (item.category !== 'request_sheet_metal' || item.wastePercent === null || item.wasteBasisKg == null) return null
  const rows = item.futureSheetScraps || []
  const sourceId = item.key.split(':')[1]
  const status = (index: number) => {
    if (!states) return 'План сохранён в версии'
    if (approvalState === 'pending') return 'На согласовании'
    if (approvalState === 'returned' || approvalState === 'superseded') return 'План последней отправки'
    const state = states[`${sourceId}:${index + 1}`]
    return state === 'available' ? 'Доступен' : state === 'future' ? 'Будущий' : 'Нет данных склада'
  }
  const kg = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(3)} кг`
  return <div className="space-y-2 rounded-lg bg-blue-50/60 p-3 text-xs text-slate-700">
    <div className="flex flex-wrap gap-x-4 gap-y-1"><span>Полный вес: {kg(item.weightKg)}</span><span>Будущий деловой остаток: {kg(item.businessScrapWeightKg)}</span><span>База отходности: {kg(item.wasteBasisKg)}</span><span>Металлолом: {kg(item.metalScrapKg)}</span><span>Полезный вес обработанного листа: {kg(item.processedUsefulKg)}</span></div>
    {rows.length > 0 && <ul className="space-y-1 border-t border-blue-100 pt-2">{rows.map((row, index) => <li key={index}>{row.lengthMm} × {row.widthMm} мм · {row.quantity} шт. · {kg(row.weightKg)} · {status(index)}</li>)}</ul>}
  </div>
}

export function ApprovalSummary({ snapshot, sheetScrapStates, approvalState }: { snapshot: ApprovalSummarySnapshot | null; sheetScrapStates?: Record<string, 'future' | 'available'>; approvalState?: string }) {
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
            <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-3 py-2 font-medium">Позиция</th><th className="px-3 py-2 font-medium">К закупке по согласованию</th><th className="px-3 py-2 font-medium">Деловой склад</th><th className="px-3 py-2 font-medium">Обычный склад</th><th className="px-3 py-2 font-medium">Отходность</th></tr></thead>
            <tbody className="divide-y">{items.map((item) => <tr key={item.key}>
              <td className="px-3 py-3"><Position item={item} /></td><td className="px-3 py-3"><Procurement item={item} /></td>
              <td className="px-3 py-3">{quantity(item.businessScrapReserved, item.unit)}</td><td className="px-3 py-3">{quantity(item.regularStockReserved, item.unit)}</td><td className="px-3 py-3">{percent(item.wastePercent)}</td>
            </tr>).flatMap((row, index) => {
              const item = items[index]
              return item.category === 'request_sheet_metal' && item.wastePercent !== null && item.wasteBasisKg != null
                ? [row, <tr key={`${item.key}:sheet-waste`}><td colSpan={5} className="px-3 pb-3"><SheetWasteDetails item={item} states={sheetScrapStates} approvalState={approvalState} /></td></tr>]
                : [row]
            })}</tbody>
          </table>
        </div>
        <div className="grid gap-3 md:hidden">{items.map((item) => <article key={item.key} className="space-y-3 rounded-lg border p-4 text-sm">
          <Position item={item} />
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-slate-500">К закупке по согласованию</dt><dd><Procurement item={item} /></dd></div>
            <div><dt className="text-slate-500">Отходность</dt><dd>{percent(item.wastePercent)}</dd></div>
            <div><dt className="text-slate-500">Деловой склад</dt><dd>{quantity(item.businessScrapReserved, item.unit)}</dd></div>
            <div><dt className="text-slate-500">Обычный склад</dt><dd>{quantity(item.regularStockReserved, item.unit)}</dd></div>
          </dl>
          <SheetWasteDetails item={item} states={sheetScrapStates} approvalState={approvalState} />
        </article>)}</div>
      </section>
    })}
    <div className="grid gap-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-3">
      <div><span className="text-slate-500">По всей заявке, взвешенный</span><p className="mt-1 font-semibold">{percent(total.weightedPercent)}</p></div>
      <div><span className="text-slate-500">По всей заявке, средний</span><p className="mt-1 font-semibold">{percent(total.averagePercent)}</p></div>
      <div><span className="text-slate-500">Время плазмы</span><p className="mt-1 font-semibold">{snapshot.enteredPlasmaMinutes} мин. + 25% = {snapshot.enteredPlasmaMinutes + Math.ceil(snapshot.enteredPlasmaMinutes * 0.25)} мин.</p></div>
    </div>
    {snapshot.items.some((item) => item.category === 'request_sheet_metal' && item.wastePercent !== null && item.wasteBasisKg != null) && <div className="grid gap-2 rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm sm:grid-cols-4">
      <div>Полный вес листов: <strong>{snapshot.items.filter((item) => item.category === 'request_sheet_metal' && item.wastePercent !== null).reduce((sum, item) => sum + Number(item.weightKg || 0), 0).toFixed(3)} кг</strong></div>
      <div>Будущий деловой остаток: <strong>{snapshot.items.reduce((sum, item) => sum + Number(item.businessScrapWeightKg || 0), 0).toFixed(3)} кг</strong></div>
      <div>Металлолом: <strong>{snapshot.items.filter((item) => item.category === 'request_sheet_metal').reduce((sum, item) => sum + Number(item.metalScrapKg || 0), 0).toFixed(3)} кг</strong></div>
      <div>Полезный вес обработанных листов: <strong>{snapshot.items.filter((item) => item.category === 'request_sheet_metal').reduce((sum, item) => sum + Number(item.processedUsefulKg || 0), 0).toFixed(3)} кг</strong></div>
    </div>}
    <div className="grid gap-3 sm:grid-cols-2">
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Будущая деталировка</CardTitle></CardHeader><CardContent className="text-sm text-slate-600">{snapshot.futureItems.length ? <ul className="space-y-2">{snapshot.futureItems.map((raw, index) => {
        const item = raw as { name?: string; drawingNumber?: string; quantity?: number; unitWeightKg?: number; widthMm?: number | null; heightMm?: number | null; thicknessMm?: number | null }
        const hasDimensions = ['widthMm', 'heightMm', 'thicknessMm'].some((field) => Object.prototype.hasOwnProperty.call(item, field))
        return <li key={index}>{item.name || 'Деталь'}{item.drawingNumber ? ` · ${item.drawingNumber}` : ''} — {item.quantity} шт.{item.unitWeightKg ? ` · ${item.unitWeightKg} кг/шт.` : ''}{hasDimensions ? ` · Габариты: ${[item.widthMm, item.heightMm, item.thicknessMm].every((value) => value != null) ? `${item.widthMm} × ${item.heightMm} × ${item.thicknessMm} мм` : 'Не указаны'}` : ''}</li>
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
    {diff.changed.map((item) => <div key={`c-${item.after.key}`} className="text-amber-800"><p>Изменено: {item.after.name}</p><ul className="ml-4 list-disc">{item.fields.map((field) => <li key={field}>{fieldLabels[field] || field}{field !== 'attributes' && field !== 'procurement' ? `: ${String(item.before[field as keyof ApprovalSummaryItem] ?? '—')} → ${String(item.after[field as keyof ApprovalSummaryItem] ?? '—')}` : ''}</li>)}</ul></div>)}
    {diff.completionChanged.map((field) => <p key={field} className="text-amber-800">Изменено: {field}</p>)}
    {diff.completionDetails.map((item, index) => <p key={index} className={item.before === null ? 'text-emerald-700' : item.after === null ? 'text-red-700' : 'text-amber-800'}>{item.label}: {item.before === null ? `добавлено ${item.after}` : item.after === null ? `удалено ${item.before}` : `${item.before} → ${item.after}`}</p>)}
  </div>
}
