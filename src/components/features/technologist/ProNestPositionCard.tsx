'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, RotateCw, ZoomIn } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CompletionWasteItem } from '@/lib/actions/request-completion'
import { cloneProNestReport, registerProNestReport } from '@/lib/actions/pronest-completion'
import {
  PRONEST_MAX_BYTES, calculateProNestPosition, calculateProNestSheet,
  expandProNestSheets, suggestProNestRectangle, validateProNestForPosition, validateProNestLayouts,
  type ProNestParsedReport, type ProNestSheet,
} from '@/lib/pronest/report'
import { readProNestPdf } from '@/lib/pronest/read-pdf-client'
import { uploadProNestPdf } from '@/lib/pronest/upload-client'
import { ProNestMissingPageForm } from './ProNestMissingPageForm'
import type { ProNestLayout } from '@/lib/pronest/report'

export type AppliedProNest = { reportId: string; importVersion: number; totals: ReturnType<typeof calculateProNestPosition> }

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function ProNestPositionCard({ item, requestId, active, applied, onApplied }: {
  item: CompletionWasteItem; requestId: string; active: boolean; applied: AppliedProNest | null; onApplied: (value: AppliedProNest | null) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [versions, setVersions] = useState(item.previousPdfReports)
  const [report, setReport] = useState<ProNestParsedReport | null>(null)
  const [sheets, setSheets] = useState<ProNestSheet[]>([])
  const [materialConfirmed, setMaterialConfirmed] = useState(false)
  const [weightDifferenceReason, setWeightDifferenceReason] = useState('')
  const [working, setWorking] = useState(false)
  const [recognizing, setRecognizing] = useState(false)
  const [progress, setProgress] = useState('')
  const [previewPage, setPreviewPage] = useState<number | null>(null)
  const [rotations, setRotations] = useState<Record<number, number>>({})
  const abort = useRef<AbortController | null>(null)
  const objectUrl = useMemo(() => file ? URL.createObjectURL(file) : null, [file])
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }, [objectUrl])
  const effectiveLayouts = sheets.filter(row => row.instanceNumber === 1).map(row => row.source)
  const effectiveReport = report ? { ...report, layouts: effectiveLayouts, issues: validateProNestLayouts(effectiveLayouts, report.unrecognizedPages) } : null
  const problems = effectiveReport ? validateProNestForPosition(effectiveReport, { quantity: item.sheetQuantity || 0, sheetSize: item.sheetSize || '', thicknessMm: item.thicknessMm, materialConfirmed }) : []
  let totals: ReturnType<typeof calculateProNestPosition> | null = null
  let balanceError = ''
  try { if (sheets.length) totals = calculateProNestPosition(sheets) } catch (error) { balanceError = error instanceof Error ? error.message : 'Проверьте баланс листов' }
  const crmPerSheet = item.weightKg && item.sheetQuantity ? item.weightKg / item.sheetQuantity : 0
  const weightMismatch = sheets.some(sheet => Math.abs(sheet.source.sheetWeightKg - crmPerSheet) > 0.01)
  const sheetIssue = sheets.find(sheet => {
    const original = report?.layouts.find(row => row.layoutNumber === sheet.layoutNumber && row.page === sheet.page)
    const originalSheet = report ? expandProNestSheets(report.layouts).find(row => row.layoutNumber === sheet.layoutNumber && row.instanceNumber === sheet.instanceNumber && row.page === sheet.page) : null
    const sourceChanged = original && ['material','thicknessMm','sheetWidthMm','sheetLengthMm','cropWidthMm','cropLengthMm','sheetWeightKg','actualUtilizationPercent','cropUtilizationPercent'].some(key => sheet.source[key as keyof typeof sheet.source] !== original[key as keyof typeof original])
    const needsFieldReview = Object.entries(sheet.source.evidence).some(([key, value]) => value.reviewRequired && !sheet.reviewedFields.includes(key))
    return !sheet.reviewed || needsFieldReview || !sheet.reason.trim() && (sourceChanged || Math.abs(sheet.usefulWeightKg - (originalSheet?.usefulWeightKg ?? 0)) > 0.0005 || sheet.kerfWidthMm !== sheet.source.kerfWidthMm || sheet.cutLengthMm !== sheet.source.cutLengthMm || sheet.productionSeconds !== sheet.source.productionSeconds)
  })

  function changeSheet(index: number, edit: (row: ProNestSheet) => ProNestSheet) {
    setSheets(current => current.map((row, position) => position === index ? edit(row) : row))
    onApplied(null)
  }
  function changeSource(index: number, field: 'material' | 'thicknessMm' | 'sheetWidthMm' | 'sheetLengthMm' | 'cropWidthMm' | 'cropLengthMm' | 'sheetWeightKg' | 'actualUtilizationPercent' | 'cropUtilizationPercent', raw: string) {
    changeSheet(index, row => {
      const source = { ...row.source, [field]: field === 'material' ? raw : raw === '' ? Number.NaN : Number(raw) }
      const oldDefault = report ? expandProNestSheets(report.layouts)[index]?.usefulWeightKg ?? row.usefulWeightKg : row.usefulWeightKg
      const usefulWeightKg = Math.abs(row.usefulWeightKg - oldDefault) < 0.001
        ? Math.round(source.sheetWeightKg * source.actualUtilizationPercent / 100 * 1000) / 1000
        : row.usefulWeightKg
      return { ...row, source, usefulWeightKg, reviewed: false, reviewedFields: [] }
    })
  }
  function addCorrectedPage(layout: ProNestLayout) {
    if (!report) return
    const layouts = [...report.layouts, layout].sort((a, b) => a.layoutNumber - b.layoutNumber)
    const unrecognizedPages = report.unrecognizedPages.filter(page => page !== layout.page)
    setReport({ ...report, layouts, unrecognizedPages, issues: validateProNestLayouts(layouts, unrecognizedPages) })
    setSheets(expandProNestSheets(layouts))
    onApplied(null)
  }

  async function recognize(nextFile: File, nextRotations: Record<number, number> = {}) {
    if (nextFile.size > PRONEST_MAX_BYTES) return toast.error('PDF должен быть не больше 50 МБ')
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    setFile(nextFile)
    setReport(null)
    setSheets([])
    setMaterialConfirmed(false)
    onApplied(null)
    setWorking(true)
    setRecognizing(true)
    try {
      const result = await readProNestPdf(nextFile, (done, total, method) => setProgress(`Страница ${done} из ${total} · ${method === 'ocr' ? 'OCR' : 'текст'}`), controller.signal, nextRotations)
      if (!controller.signal.aborted) {
        setReport(result)
        setSheets(expandProNestSheets(result.layouts))
        setProgress(`Распознано раскроев: ${result.layouts.length}`)
      }
    } catch (error) { if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : 'PDF не распознан') }
    finally { if (abort.current === controller) { setRecognizing(false); if (!controller.signal.aborted) setWorking(false) } }
  }

  async function apply() {
    if (!file || !report || !totals || problems.length || sheetIssue || weightMismatch && !weightDifferenceReason.trim()) {
      toast.error(problems[0] || balanceError || 'Проверьте листы и причины исправлений')
      return
    }
    setWorking(true)
    try {
      setProgress('Загрузка исходного PDF')
      const uploaded = await uploadProNestPdf(requestId, item.sourceId, file)
      setProgress('Сохранение расчётов')
      const result = await registerProNestReport({ ...uploaded, requestId, sourceId: item.sourceId, pageCount: Math.max(...report.layouts.map(row => row.page), ...report.extraPages, ...report.unrecognizedPages), report, sheets, materialConfirmed, weightDifferenceReason })
      if (!result.success || !result.data) throw new Error(result.error || 'Не удалось применить PDF')
      onApplied(result.data)
      setVersions(current => [{ id: result.data.reportId, importVersion: result.data.importVersion, fileName: file.name, createdAt: new Date().toISOString() }, ...current])
      toast.success('Данные PDF применены к позиции')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось применить PDF') }
    finally { setWorking(false) }
  }

  if (!active) return null
  return <div className="space-y-4 border-t border-blue-100 pt-4">
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="font-medium text-blue-950">Полный отчёт ProNest для этой позиции</p>
      <p className="mt-1 text-sm text-blue-800">Один PDF на {item.sheetQuantity} лист. Распознавание подготовит отдельную карточку для каждого использования листа.</p>
      <Label htmlFor={`pronest-${item.sourceId}`} className="mt-3 flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-blue-400 bg-white px-3 text-center text-blue-800 focus-within:ring-2 focus-within:ring-blue-600">Выбрать PDF<input id={`pronest-${item.sourceId}`} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={working} onChange={event => { const next = event.target.files?.[0]; event.currentTarget.value = ''; if (next) void recognize(next) }} /></Label>
      {file && <p className="mt-2 break-all text-sm">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} МБ</p>}
      {working && <div className="mt-3 flex items-center gap-2 text-sm text-blue-800"><Loader2 className="h-4 w-4 animate-spin" />{progress}{recognizing && <Button variant="ghost" size="sm" onClick={() => { abort.current?.abort(); setWorking(false); setProgress('Распознавание отменено') }}>Отмена</Button>}</div>}
      {!working && progress && <p className="mt-2 text-sm text-blue-800" aria-live="polite">{progress}</p>}
      {applied && <p className="mt-2 font-medium text-emerald-800">Применена версия импорта №{applied.importVersion}</p>}
      {applied && !report && <p className="mt-1 text-sm text-emerald-800">Детали {applied.totals.usefulKg.toFixed(3)} кг · остаток {applied.totals.remnantKg.toFixed(3)} кг · отходность {applied.totals.wastePercent.toFixed(2)}% · время с 25% {formatTime(applied.totals.actualSeconds)}</p>}
      {versions.length > 0 && <div className="mt-3 space-y-2 border-t border-blue-200 pt-3"><p className="text-sm font-medium">Версии PDF этой позиции</p>{versions.map(previous => <div key={previous.id} className="flex flex-wrap items-center gap-2 text-sm"><a className="underline" href={`/api/pronest/reports/${previous.id}/file`} target="_blank" rel="noreferrer">Версия {previous.importVersion} · {previous.fileName}</a><Button type="button" variant="outline" size="sm" disabled={working} onClick={async () => { setWorking(true); try { const result = await cloneProNestReport(requestId, item.sourceId, previous.id); if (!result.success || !result.data) throw new Error(result.error || 'Не удалось открыть отчёт'); setFile(null); setReport(null); setSheets([]); setProgress(''); setVersions(current => [{ id: result.data.reportId, importVersion: result.data.importVersion, fileName: previous.fileName, createdAt: new Date().toISOString() }, ...current]); onApplied(result.data); toast.success('Создана новая версия импорта для повторной отправки') } catch (error) { toast.error(error instanceof Error ? error.message : 'Не удалось открыть отчёт') } finally { setWorking(false) } }}>Использовать снова</Button></div>)}</div>}
    </div>
    {report && <>
      {problems.length > 0 && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{problems.map(issue => <p key={issue}>{issue}</p>)}</div>}
      {report.unrecognizedPages.map(page => <ProNestMissingPageForm key={page} page={page} rawLines={report.unrecognizedText?.[page] || []} onAdd={addCorrectedPage} onPreview={() => setPreviewPage(page)} />)}
      {!!report.extraPages.length && <p className="text-sm text-slate-600">Дополнительные страницы без раскроя: {report.extraPages.join(', ')}.</p>}
      <Label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={materialConfirmed} onChange={event => { setMaterialConfirmed(event.target.checked); onApplied(null) }} /><span>Материал PDF соответствует позиции; все учитываемые детали относятся к этой заявке.</span></Label>
      <div className="space-y-3">{sheets.map((sheet, index) => {
        const proposal = suggestProNestRectangle(sheet.source)
        let calculation: ReturnType<typeof calculateProNestSheet> | null = null
        let error = ''
        try { calculation = calculateProNestSheet(sheet) } catch (caught) { error = caught instanceof Error ? caught.message : 'Баланс не сходится' }
        const updateNumber = (field: 'usefulWeightKg' | 'kerfWidthMm' | 'cutLengthMm' | 'productionSeconds', value: string) => changeSheet(index, row => ({ ...row, [field]: Number(value) }))
        return <section key={`${sheet.layoutNumber}-${sheet.instanceNumber}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs" aria-label={`Лист ${index + 1}`}>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold">Лист {index + 1} · раскрой {sheet.layoutNumber} из {sheet.source.layoutCount}{sheet.source.timesCut > 1 ? ` · экземпляр ${sheet.instanceNumber}` : ''}</h4><p className="text-xs text-slate-600">Страница {sheet.page} · {sheet.source.material} · {sheet.source.sheetWidthMm} × {sheet.source.sheetLengthMm} мм · {sheet.source.sheetWeightKg.toFixed(3)} кг · время {formatTime(sheet.source.productionSeconds)}</p><p className="text-xs text-slate-500">{sheet.source.equipment || 'Оборудование не указано'} · {sheet.source.process || 'Процесс не указан'} · раскрой {sheet.source.cropWidthMm} × {sheet.source.cropLengthMm} мм · использование {sheet.source.actualUtilizationPercent}% / обрезки {sheet.source.cropUtilizationPercent}% · проколов {sheet.source.pierces}</p></div><Button type="button" variant="outline" size="sm" onClick={() => setPreviewPage(sheet.page)}><ZoomIn className="mr-1 h-4 w-4" />Схема</Button></div>
          {sheet.source.reviewRequired && <p className="mt-2 text-xs text-amber-800">Данные OCR требуют проверки по оригиналу страницы.</p>}
          {Object.entries(sheet.source.evidence).filter(([,value]) => value.reviewRequired).length > 0 && <div className="mt-2 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs"><p className="font-medium text-amber-950">Проверьте сомнительные поля отдельно:</p>{Object.entries(sheet.source.evidence).filter(([,value]) => value.reviewRequired).map(([key,value]) => <Label key={key} className="flex items-center gap-2"><input type="checkbox" checked={sheet.reviewedFields.includes(key)} onChange={event => changeSheet(index, row => ({ ...row, reviewedFields: event.target.checked ? [...row.reviewedFields, key] : row.reviewedFields.filter(field => field !== key) }))} />{key}: «{value.raw}» · уверенность {value.confidence.toFixed(0)}%</Label>)}</div>}
          <details className="mt-3 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer font-medium">Проверить и исправить исходные данные PDF</summary><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {([['material','Материал'],['thicknessMm','Толщина, мм'],['sheetWidthMm','Сторона листа 1, мм'],['sheetLengthMm','Сторона листа 2, мм'],['cropWidthMm','Габарит раскроя 1, мм'],['cropLengthMm','Габарит раскроя 2, мм'],['sheetWeightKg','Вес листа, кг'],['actualUtilizationPercent','Использование листа, %'],['cropUtilizationPercent','Использование обрезки, %']] as const).map(([field,label]) => <div key={field}><Label htmlFor={`${item.sourceId}-${index}-source-${field}`}>{label}</Label><Input id={`${item.sourceId}-${index}-source-${field}`} type={field === 'material' ? 'text' : 'number'} step="any" value={Number.isNaN(sheet.source[field]) ? '' : sheet.source[field]} onChange={event => changeSource(index, field, event.target.value)} /></div>)}
          </div><p className="mt-2 text-xs text-slate-600">Исходный текст PDF сохранится в истории. Исправление требует причину ниже.</p></details>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><Label htmlFor={`d-${item.sourceId}-${index}`}>Полезный вес деталей, кг</Label><Input id={`d-${item.sourceId}-${index}`} type="number" min="0" step="0.001" value={sheet.usefulWeightKg} onChange={event => updateNumber('usefulWeightKg', event.target.value)} /></div>
            <div><Label htmlFor={`combined-${item.sourceId}-${index}`}>Полезный вес с остатком, кг</Label><Input key={`combined-${calculation?.usefulWithRemnantKg}`} id={`combined-${item.sourceId}-${index}`} type="number" min="0" step="0.001" defaultValue={calculation?.usefulWithRemnantKg.toFixed(3) || ''} disabled={!calculation} onBlur={event => { const desired = Number(event.target.value); if (calculation && event.target.value !== '' && Number.isFinite(desired) && Math.abs(desired - calculation.usefulWithRemnantKg) > 0.0005) changeSheet(index, row => ({ ...row, usefulWeightKg: Math.round((desired - calculation.remnantKg) * 1000) / 1000 })) }} /></div>
            <div><Label htmlFor={`loss-${item.sourceId}-${index}`}>Отходность: металлолом + пропил, %</Label><Input key={`loss-${calculation?.wastePercent.toFixed(2)}`} id={`loss-${item.sourceId}-${index}`} type="number" min="0" max="100" step="0.01" defaultValue={calculation?.wastePercent.toFixed(2) || ''} disabled={!calculation} onBlur={event => { const desired = Number(event.target.value); if (calculation && event.target.value !== '' && Number.isFinite(desired) && Math.abs(desired - calculation.wastePercent) > 0.005) changeSheet(index, row => ({ ...row, usefulWeightKg: Math.round(calculation.wasteBasisKg * (1 - desired / 100) * 1000) / 1000 })) }} /></div>
            <div><Label htmlFor={`kerf-${item.sourceId}-${index}`}>Пропил, мм</Label><Input id={`kerf-${item.sourceId}-${index}`} type="number" min="0" step="0.01" value={sheet.kerfWidthMm} onChange={event => updateNumber('kerfWidthMm', event.target.value)} /></div>
            <div><Label htmlFor={`cut-${item.sourceId}-${index}`}>Длина реза, мм</Label><Input id={`cut-${item.sourceId}-${index}`} type="number" min="0" step="0.01" value={sheet.cutLengthMm} onChange={event => updateNumber('cutLengthMm', event.target.value)} /></div>
            <div><Label htmlFor={`time-${item.sourceId}-${index}`}>Время раскроя, сек</Label><Input id={`time-${item.sourceId}-${index}`} type="number" min="0" step="1" value={sheet.productionSeconds} onChange={event => updateNumber('productionSeconds', event.target.value)} /></div>
          </div>
          {proposal && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm">Расчётное предложение — подтвердите: {proposal.rectangle.lengthMm.toFixed(1)} × {proposal.rectangle.widthMm.toFixed(1)} мм · {proposal.rectangle.weightKg?.toFixed(3)} кг. Оценка всей свободной области: {(proposal.estimatedFreeAreaMm2 / 1e6).toFixed(3)} м².</p>}
          <div className="mt-3 grid gap-3 sm:grid-cols-[240px_1fr] sm:items-end"><div><Label>Решение по остатку</Label><Select value={sheet.decision} onValueChange={value => changeSheet(index, row => ({ ...row, decision: value as ProNestSheet['decision'], remnants: value === 'preserve' && proposal ? [proposal.rectangle] : value === 'preserve' ? row.remnants : [] }))}><SelectTrigger className="w-full"><SelectValue>{sheet.decision === 'preserve' ? 'Сохранить деловой остаток' : sheet.decision === 'scrap' ? 'Отнести в металлолом' : 'Делового остатка нет'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="none">Делового остатка нет</SelectItem><SelectItem value="preserve">Сохранить деловой остаток</SelectItem><SelectItem value="scrap">Отнести в металлолом</SelectItem></SelectContent></Select></div>{sheet.decision === 'preserve' && <Button variant="outline" type="button" onClick={() => changeSheet(index, row => ({ ...row, remnants: [...row.remnants, { lengthMm: 0, widthMm: 0 }] }))}>Добавить прямоугольник</Button>}</div>
          {sheet.decision === 'preserve' && sheet.remnants.map((remnant, remnantIndex) => <div key={remnantIndex} className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            {(['lengthMm','widthMm','weightKg'] as const).map(field => <div key={field}><Label htmlFor={`${item.sourceId}-${index}-${remnantIndex}-${field}`}>{field === 'lengthMm' ? 'Длина, мм' : field === 'widthMm' ? 'Ширина, мм' : 'Вес PDF, кг'}</Label><Input id={`${item.sourceId}-${index}-${remnantIndex}-${field}`} type="number" min="0" step={field === 'weightKg' ? '0.001' : '0.01'} value={remnant[field] ?? ''} onChange={event => changeSheet(index, row => ({ ...row, remnants: row.remnants.map((value, place) => place === remnantIndex ? { ...value, [field]: event.target.value === '' ? undefined : Number(event.target.value) } : value) }))} /></div>)}<Button type="button" variant="ghost" onClick={() => changeSheet(index, row => ({ ...row, remnants: row.remnants.filter((_, place) => place !== remnantIndex) }))}>Убрать</Button>
          </div>)}
          {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
          {calculation && <p className="mt-3 text-sm">Детали {calculation.usefulKg.toFixed(3)} кг · остаток {calculation.remnantKg.toFixed(3)} кг · металлолом {calculation.metalScrapKg.toFixed(3)} кг ({calculation.metalScrapPercent.toFixed(2)}%) · пропил ≈ {calculation.kerfKg.toFixed(3)} кг · отходность {(calculation.wastePercent).toFixed(2)}% от базы {calculation.wasteBasisKg.toFixed(3)} кг</p>}
          <div className="mt-3"><Label htmlFor={`reason-${item.sourceId}-${index}`}>Причина исправления, если изменены исходные значения</Label><Input id={`reason-${item.sourceId}-${index}`} value={sheet.reason} onChange={event => changeSheet(index, row => ({ ...row, reason: event.target.value }))} placeholder="Например, фактическое время и дополнительный рез" /></div>
          <Label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={sheet.reviewed} onChange={event => changeSheet(index, row => ({ ...row, reviewed: event.target.checked }))} />Проверил данные листа по PDF</Label>
        </section>
      })}</div>
      {weightMismatch && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p>Вес одного листа CRM: {crmPerSheet.toFixed(3)} кг; расчёт PDF ведётся по весу отчёта. Складской вес остаётся отдельным.</p><Label htmlFor={`weight-reason-${item.sourceId}`}>Причина расхождения</Label><Input id={`weight-reason-${item.sourceId}`} value={weightDifferenceReason} onChange={event => { setWeightDifferenceReason(event.target.value); onApplied(null) }} /></div>}
      {totals && <div className="grid gap-2 rounded-xl bg-slate-900 p-4 text-sm text-white sm:grid-cols-2 lg:grid-cols-3"><p>Полезный вес деталей <strong className="block text-lg">{totals.usefulKg.toFixed(3)} кг</strong></p><p>Будущий деловой остаток <strong className="block text-lg">{totals.remnantKg.toFixed(3)} кг</strong></p><p>Полезный вес с остатком <strong className="block text-lg">{totals.usefulWithRemnantKg.toFixed(3)} кг</strong></p><p>Металлолом / пропил <strong className="block text-lg">{totals.metalScrapKg.toFixed(3)} / {totals.kerfKg.toFixed(3)} кг</strong></p><p>Отходность: металлолом + пропил <strong className="block text-lg">{totals.wastePercent.toFixed(2)}%</strong></p><p>Время плазмы +25% <strong className="block text-lg">{formatTime(totals.actualSeconds)}</strong></p></div>}
      <Button type="button" className="min-h-11 w-full bg-blue-700 hover:bg-blue-800" disabled={working || problems.length > 0 || !!balanceError || !!sheetIssue || weightMismatch && !weightDifferenceReason.trim()} onClick={() => void apply()}><FileText className="mr-2 h-4 w-4" />Применить данные PDF к позиции</Button>
    </>}
    <Dialog open={previewPage !== null} onOpenChange={open => { if (!open) setPreviewPage(null) }}><DialogContent className="max-h-[90vh] max-w-[95vw] overflow-auto"><DialogHeader><DialogTitle>Страница {previewPage} · схема раскроя</DialogTitle></DialogHeader>{objectUrl && previewPage && <div className="space-y-2"><iframe title={`PDF, страница ${previewPage}`} src={`${objectUrl}#page=${previewPage}&zoom=page-width`} className="h-[70vh] w-full rounded border" /><div className="flex gap-2"><Button type="button" variant="outline" onClick={() => { const next = { ...rotations, [previewPage]: ((rotations[previewPage] || 0) + 90) % 360 }; setRotations(next); setPreviewPage(null); if (file) void recognize(file, next) }}><RotateCw className="mr-1 h-4 w-4" />Повернуть и распознать</Button><a className="inline-flex min-h-10 items-center rounded border px-3 text-sm" href={`${objectUrl}#page=${previewPage}`} target="_blank" rel="noreferrer">Открыть крупно</a></div></div>}</DialogContent></Dialog>
  </div>
}
