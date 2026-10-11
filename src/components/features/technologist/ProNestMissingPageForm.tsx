'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProNestLayout } from '@/lib/pronest/report'

const fields = [
  ['layoutNumber','Номер раскроя'],['layoutCount','Всего раскроев'],['timesCut','Количество выполнений'],
  ['material','Материал PDF'],['thicknessMm','Толщина, мм'],['sheetWidthMm','Сторона листа 1, мм'],
  ['sheetLengthMm','Сторона листа 2, мм'],['cropWidthMm','Габарит раскроя 1, мм'],
  ['cropLengthMm','Габарит раскроя 2, мм'],['sheetWeightKg','Вес листа, кг'],
  ['actualUtilizationPercent','Фактическое использование, %'],['cropUtilizationPercent','Использование обрезки, %'],
  ['kerfWidthMm','Пропил, мм'],['cutLengthMm','Длина реза, мм'],['pierces','Проколы, шт.'],['productionTime','Время Ч:ММ:СС'],
] as const
type Field = typeof fields[number][0]

export function ProNestMissingPageForm({ page, rawLines, onAdd, onPreview }: {
  page: number; rawLines: string[]; onAdd: (layout: ProNestLayout) => void; onPreview: () => void
}) {
  const [values, setValues] = useState<Record<Field, string>>(() => Object.fromEntries(fields.map(([field]) => [field, ''])) as Record<Field,string>)
  const [error, setError] = useState('')
  function add() {
    const missing = fields.find(([field]) => !values[field].trim())
    if (missing) return setError(`Заполните «${missing[1]}»`)
    const time = values.productionTime.match(/^(\d+):(\d{1,2}):(\d{1,2})$/)
    if (!time || Number(time[2]) >= 60 || Number(time[3]) >= 60) return setError('Укажите время как Ч:ММ:СС')
    const number = (field: Exclude<Field, 'material' | 'productionTime'>) => Number(values[field].replace(',','.'))
    const numeric = fields.filter(([field]) => field !== 'material' && field !== 'productionTime').map(([field]) => number(field as Exclude<Field, 'material' | 'productionTime'>))
    if (numeric.some(value => !Number.isFinite(value) || value < 0)) return setError('Проверьте числовые значения')
    const evidence = Object.fromEntries(fields.map(([field]) => [field, { page, raw: values[field], method: 'operator', confidence: 0, reviewRequired: false }])) as ProNestLayout['evidence']
    const layout: ProNestLayout = {
      page, layoutNumber: number('layoutNumber'), layoutCount: number('layoutCount'), timesCut: number('timesCut'),
      material: values.material.trim(), thicknessMm: number('thicknessMm'), equipment: null, process: 'Plasma',
      sheetWidthMm: number('sheetWidthMm'), sheetLengthMm: number('sheetLengthMm'),
      cropWidthMm: number('cropWidthMm'), cropLengthMm: number('cropLengthMm'), sheetWeightKg: number('sheetWeightKg'),
      actualUtilizationPercent: number('actualUtilizationPercent'), cropUtilizationPercent: number('cropUtilizationPercent'),
      kerfWidthMm: number('kerfWidthMm'), cutLengthMm: number('cutLengthMm'), pierces: number('pierces'),
      productionSeconds: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]),
      sheetName: null, heatNumber: null, inventoryNumber: null, location: null, evidence, reviewRequired: true,
    }
    setError('')
    onAdd(layout)
  }
  return <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold text-amber-950">Страница {page}: раскрой требует исправления OCR</h4><p className="text-sm text-amber-900">Перепишите значения с исходного PDF и затем проверьте созданный лист.</p></div><Button type="button" variant="outline" onClick={onPreview}>Открыть страницу</Button></div>
    <details className="text-xs text-amber-900"><summary className="cursor-pointer">Распознанный текст</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-white p-2">{rawLines.join('\n')}</pre></details>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([field,label]) => <div key={field}><Label htmlFor={`ocr-${page}-${field}`}>{label}</Label><Input id={`ocr-${page}-${field}`} type="text" inputMode={field === 'material' || field === 'productionTime' ? 'text' : 'decimal'} value={values[field]} onChange={event => setValues(current => ({ ...current, [field]: event.target.value }))} /></div>)}</div>
    {error && <p className="text-sm text-red-700">{error}</p>}
    <Button type="button" onClick={add}>Добавить исправленный раскрой</Button>
  </section>
}
