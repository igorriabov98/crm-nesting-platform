'use client'

import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SHEET_IMPORT_MAX_BYTES, type SheetImportPreview, type SheetImportResult } from '@/lib/inventory/sheet-import-types'

type Factory = { id: string; name: string }
type Props = { factories: Factory[]; activeFactoryId: string | null }
const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })
const weight = (value: number | null) => value === null ? 'ожидает плотности' : `${number(value)} кг`

export function SheetInventoryImportDialog({ factories, activeFactoryId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [factoryId, setFactoryId] = useState(activeFactoryId || '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<SheetImportPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'preview' | 'commit' | 'template' | null>(null)
  const [result, setResult] = useState<SheetImportResult | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const operationId = useRef('')
  const requestInFlight = useRef(false)
  const factoryName = factories.find(f => f.id === factoryId)?.name || 'Выберите завод'

  function resetPreview() { setPreview(null); setError(''); setResult(null); setUncertain(false); operationId.current = '' }
  async function download() {
    if (requestInFlight.current) return
    requestInFlight.current = true; setBusy('template'); setError('')
    try {
      const response = await fetch('/api/inventory/sheet-import/template')
      if (!response.ok) throw new Error((await response.json()).error || 'Не удалось скачать шаблон')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a'); link.href = url; link.download = 'sheet-inventory-template.xlsx'; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError((e as Error).message) } finally { requestInFlight.current = false; setBusy(null) }
  }
  async function upload(commit: boolean) {
    if (!file || !factoryId || requestInFlight.current) return
    requestInFlight.current = true; setBusy(commit ? 'commit' : 'preview'); setError('')
    try {
      const data = new FormData(); data.set('file', file); data.set('factoryId', factoryId)
      if (commit) {
        if (!preview || preview.errors.length) return
        data.set('operationId', operationId.current); data.set('previewHash', preview.previewHash)
        if (preview.previous) data.set('previousImportId', preview.previous.id)
      }
      let response: Response
      try { response = await fetch(`/api/inventory/sheet-import/${commit ? 'commit' : 'preview'}`, { method: 'POST', body: data }) }
      catch { if (commit) setUncertain(true); throw new Error(commit ? 'Связь прервалась. Нажмите «Проверить результат»: повтор запроса безопасен.' : 'Не удалось связаться с CRM') }
      let payload
      try { payload = await response.json() } catch { if (commit) setUncertain(true); throw new Error('Не удалось получить ответ CRM. Повторите запрос.') }
      if (!response.ok) {
        if (response.status === 409) { setPreview(null); setUncertain(false) }
        else if (commit && response.status >= 500) setUncertain(true)
        throw new Error(payload.error || 'Не удалось обработать файл')
      }
      setUncertain(false)
      if (commit) { setResult(payload); toast.success('Листовой металл оприходован'); router.refresh() }
      else { setPreview(payload); operationId.current = crypto.randomUUID() }
    } catch (e) { setError((e as Error).message) } finally { requestInFlight.current = false; setBusy(null) }
  }

  return <>
    <Button variant="outline" onClick={() => { if (!uncertain) { resetPreview(); setFile(null); setFactoryId(activeFactoryId || '') } setOpen(true) }}><FileSpreadsheet className="h-4 w-4" />Импорт из Excel</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}>
      <DialogContent className="max-h-[90dvh] grid-cols-1 overflow-y-auto bg-white sm:max-w-5xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="text-[#1B3A6B]">Импорт листового металла</DialogTitle>
          <DialogDescription>Основной склад. Количество из файла прибавляется к имеющемуся остатку.</DialogDescription>
        </DialogHeader>
        {result ? <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-5">
          <p className="font-semibold">Приход оформлен · {factoryName}</p>
          <p className="mt-2">Добавлено {number(result.quantity)} шт. · вес: {weight(result.weightKg)} · строк {result.receiptCount}</p>
          <p className="mt-2 text-sm">Файл: {file?.name}. Операции доступны в истории склада.</p>
        </div> : <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-48 flex-1 space-y-1.5 text-sm font-medium">Завод склада
              <select aria-label="Завод склада" value={factoryId} disabled={Boolean(busy) || uncertain} onChange={e => { setFactoryId(e.target.value); resetPreview() }} className="block h-10 w-full rounded-md border border-input bg-white px-3 font-normal">
                <option value="">Выберите завод</option>{factories.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <Button variant="outline" onClick={download} disabled={Boolean(busy)}><Download className="h-4 w-4" />Скачать шаблон</Button>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">Файл Excel
            <Input type="file" accept=".xlsx" disabled={Boolean(busy) || uncertain} onChange={e => {
              const selected = e.target.files?.[0] || null; resetPreview(); setFile(selected)
              if (selected && (selected.size > SHEET_IMPORT_MAX_BYTES || !/\.xlsx$/i.test(selected.name))) { setError('Выберите файл .xlsx размером до 3 МБ'); setFile(null) }
            }} />
            <span className="block font-normal text-[#6B7280]">До 2 000 строк, 3 МБ. Заполняйте лист «Импорт» значениями без формул.</span>
            {uncertain && <span className="block font-normal">Ожидает проверки: {file?.name}</span>}
          </label>
          {preview && <SheetImportPreviewContent preview={preview} factoryName={factoryName} />}
        </>}
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        <DialogFooter>
          <Button variant="outline" disabled={Boolean(busy)} onClick={() => setOpen(false)}>{result ? 'Закрыть' : 'Отмена'}</Button>
          {!result && (!preview || preview.errors.length > 0) && <Button disabled={!file || !factoryId || Boolean(busy)} onClick={() => upload(false)}>{busy === 'preview' && <Loader2 className="h-4 w-4 animate-spin" />}Проверить файл</Button>}
          {!result && preview && preview.errors.length === 0 && <Button disabled={Boolean(busy)} onClick={() => upload(true)}>{busy === 'commit' && <Loader2 className="h-4 w-4 animate-spin" />}{uncertain ? 'Проверить результат' : preview.previous ? 'Оформить новый приход' : 'Подтвердить приход'}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

export function SheetImportPreviewContent({ preview, factoryName }: { preview: SheetImportPreview; factoryName: string }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(preview.rows.length / 50))
  const activePage = Math.min(page, pages - 1)
  return <div className="min-w-0 space-y-3 break-words">
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3" role="status">
      <p className="font-semibold text-[#1B3A6B]">Основной склад · {factoryName}</p>
      <p className="mt-1">К приходу: {number(preview.quantity)} шт. · вес: {weight(preview.weightKg)}</p>
      <p className="mt-1 text-sm">Будет создано: позиций {preview.newVariants}, марок стали {preview.newGrades}.</p>
      {preview.pendingDensityGrades.length > 0 && <p className="mt-1 text-sm text-amber-900">После прихода технолог получит задачу указать плотность: {preview.pendingDensityGrades.join(', ')}. Вес появится после заполнения справочника.</p>}
      {preview.skippedRows.length > 0 && <p className="mt-1 text-sm">Пропущено строк с нулевым количеством: {preview.skippedRows.length}.</p>}
    </div>
    {preview.previous && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm" role="alert">
      <p className="font-semibold">Эти данные уже загружались на этот склад</p>
      <p>{new Date(preview.previous.createdAt).toLocaleString('ru-RU')} · {preview.previous.author} · {preview.previous.fileName}</p>
      <p className="mt-1">«Оформить новый приход» добавит ещё {number(preview.quantity)} шт. к остатку.</p>
    </div>}
    {preview.errors.length > 0 && <div className="max-h-48 overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
      <p className="font-semibold">Исправьте ошибки ({preview.errors.length}). Ни одна строка не будет загружена.</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">{preview.errors.map((e,i) => <li key={i}>{e.row ? `Строка ${e.row}: ` : ''}{e.message}</li>)}</ul>
    </div>}
    {preview.rows.length > 0 && <div className="overflow-x-auto rounded-lg border border-[#E8ECF0]">
      <table className="w-full min-w-[850px] text-left text-sm">
        <thead className="bg-[#F8F9FA] text-[#6B7280]"><tr>{['Строка', 'Материал / марка', 'Размер, мм', 'Толщина, мм', 'Приход, шт.', 'Вес, кг', 'Справочник'].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{preview.rows.slice(activePage * 50, (activePage + 1) * 50).map(row => <tr key={row.row} className="border-t border-[#E8ECF0]">
          <td className="p-2">{row.row}</td><td className="p-2">{row.material}<br /><span className="text-[#6B7280]">{row.grade}</span></td>
          <td className="whitespace-nowrap p-2">{row.width} × {row.length}</td><td className="p-2">{row.thickness}</td><td className="p-2">{number(row.quantity)}</td><td className="p-2">{row.weightKg === null ? 'Ожидает плотности' : number(row.weightKg)}</td>
          <td className="p-2 text-xs">{row.variantId ? 'Найдена позиция' : 'Новая позиция'}{!row.steelTypeId && <><br />Новая марка</>}{row.density === null && <><br />Плотность не задана</>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {pages > 1 && <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" disabled={!activePage} onClick={() => setPage(activePage-1)}>Назад</Button>Страница {activePage+1} из {pages}<Button variant="outline" disabled={activePage+1 === pages} onClick={() => setPage(activePage+1)}>Далее</Button></div>}
  </div>
}
