'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, CopyCheck, History, Plus, Ruler, Save, Settings2, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { updateLongStockLayoutSettings } from '@/lib/actions/long-stock-layout-settings'
import {
  formatLongStockLayoutAuditField,
  LONG_STOCK_LAYOUT_CATEGORY_LABELS,
  parseLongStockLayoutSettingsInput,
  type LongStockLayoutCategoryKey,
  type LongStockLayoutSettingsAuditEntry,
  type LongStockLayoutSettingsInput,
  type LongStockLayoutSettingsSnapshot,
} from '@/lib/long-stock-layout-settings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  initial: {
    snapshot: LongStockLayoutSettingsSnapshot
    audit: LongStockLayoutSettingsAuditEntry[]
  }
}

function snapshotInput(snapshot: LongStockLayoutSettingsSnapshot): LongStockLayoutSettingsInput {
  return {
    kerfMm: snapshot.kerfMm,
    endTrimMm: snapshot.endTrimMm,
    optimizationHintThresholdPercent: snapshot.optimizationHintThresholdPercent,
    categories: snapshot.categories.map((category) => ({
      key: category.key,
      minimumUsefulLengthMm: category.minimumUsefulLengthMm,
      standardLengths: [...category.standardLengths],
      nonstandardLengths: [...category.nonstandardLengths],
    })),
  }
}

function validationMessage(error: unknown) {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues?: Array<{ message?: string }> }).issues
    if (issues?.[0]?.message) return issues[0].message
  }
  return error instanceof Error ? error.message : 'Проверьте значения настроек'
}

export function LongStockLayoutSettingsPage({ initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [revision, setRevision] = useState(initial.snapshot.revision)
  const [draft, setDraft] = useState<LongStockLayoutSettingsInput>(() => snapshotInput(initial.snapshot))
  const [savedInput, setSavedInput] = useState<LongStockLayoutSettingsInput>(() => snapshotInput(initial.snapshot))

  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedInput),
    [draft, savedInput],
  )

  function updateGeneral(field: 'kerfMm' | 'endTrimMm' | 'optimizationHintThresholdPercent', value: string) {
    setDraft((current) => ({ ...current, [field]: value === '' ? 0 : Number(value) }))
  }

  function updateCategory(
    key: LongStockLayoutCategoryKey,
    update: (category: LongStockLayoutSettingsInput['categories'][number]) => LongStockLayoutSettingsInput['categories'][number],
  ) {
    setDraft((current) => ({
      ...current,
      categories: current.categories.map((category) => category.key === key ? update(category) : category),
    }))
  }

  function save() {
    let settings: LongStockLayoutSettingsInput
    try {
      settings = parseLongStockLayoutSettingsInput(draft)
    } catch (error) {
      toast.error(validationMessage(error))
      return
    }
    startTransition(async () => {
      const result = await updateLongStockLayoutSettings({ expectedRevision: revision, settings })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setRevision(result.data.revision)
      const saved = snapshotInput(result.data)
      setDraft(saved)
      setSavedInput(saved)
      toast.success(result.data.revision === revision ? 'Изменений нет' : 'Настройки сохранены и записаны в аудит')
      router.refresh()
    })
  }

  return (
    <main className="mx-auto max-w-7xl space-y-5 pb-16">
      <Card className="overflow-hidden border-blue-100 bg-gradient-to-br from-white to-blue-50/60">
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-800"><ShieldCheck />Только администратор</Badge>
              <Badge variant="outline">Ревизия {revision}</Badge>
            </div>
            <CardTitle className="mt-3 flex items-center gap-2 text-2xl text-[#1B3A6B]"><Ruler className="size-6" />Раскладка хлыстов</CardTitle>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Длины заготовок и общие параметры будущего расчёта для круга, трубы и ножей с разным количеством скосов.
            </p>
          </div>
          <Button className="min-h-11 sm:min-w-48" disabled={pending || !changed} onClick={save}>
            <Save className="size-4" />{pending ? 'Сохранение…' : 'Сохранить настройки'}
          </Button>
        </CardHeader>
      </Card>

      <Alert className="border-emerald-200 bg-emerald-50/70">
        <CopyCheck className="text-emerald-700" />
        <AlertTitle>Подготовлено для неизменяемого снимка</AlertTitle>
        <AlertDescription>
          Настройки имеют номер ревизии и полный snapshot. Позже при утверждении плана этот snapshot будет копироваться в версию плана; последующие изменения настроек не затронут утверждённый расчёт.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Settings2 className="size-5" />Общие параметры</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <NumberField id="layout-kerf" label="Пропил, мм" value={draft.kerfMm} min={0} step="any" onChange={(value) => updateGeneral('kerfMm', value)} />
            <NumberField id="layout-end-trim" label="Торцовка, мм" value={draft.endTrimMm} min={0} step="any" onChange={(value) => updateGeneral('endTrimMm', value)} />
            <NumberField id="layout-hint-threshold" label="Порог подсказки, %" value={draft.optimizationHintThresholdPercent} min={0} max={100} step="any" onChange={(value) => updateGeneral('optimizationHintThresholdPercent', value)} />
            <div className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              <CheckCircle2 className="mb-2 size-5 text-emerald-600" />
              Длины — положительные целые. Пропил, торцовка и полезный минимум могут быть нулевыми.
            </div>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="long-stock-categories-title" className="space-y-3">
        <div>
          <h2 id="long-stock-categories-title" className="text-xl font-semibold text-[#1B3A6B]">Длины по категориям</h2>
          <p className="mt-1 text-sm text-muted-foreground">Одна длина не может одновременно находиться в стандартной и нестандартной группе.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {draft.categories.map((category) => (
            <CategoryEditor
              key={category.key}
              category={category}
              onChange={(update) => updateCategory(category.key, update)}
            />
          ))}
        </div>
      </section>

      <AuditHistory entries={initial.audit} />

      <div className="sticky bottom-4 z-10 flex justify-end pointer-events-none">
        <Button className="min-h-11 min-w-52 shadow-lg pointer-events-auto" disabled={pending || !changed} onClick={save}>
          <Save className="size-4" />{pending ? 'Сохранение…' : 'Сохранить изменения'}
        </Button>
      </div>
    </main>
  )
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  id: string
  label: string
  value: number
  min?: number
  max?: number
  step?: string
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" value={value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function CategoryEditor({
  category,
  onChange,
}: {
  category: LongStockLayoutSettingsInput['categories'][number]
  onChange: (update: (current: LongStockLayoutSettingsInput['categories'][number]) => LongStockLayoutSettingsInput['categories'][number]) => void
}) {
  return (
    <Card>
      <CardHeader className="border-b bg-muted/20">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-lg">
          <span>{LONG_STOCK_LAYOUT_CATEGORY_LABELS[category.key]}</span>
          {category.key.startsWith('knife_') && <Badge variant="secondary">Скос входит в идентичность</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <NumberField
          id={`minimum-useful-${category.key}`}
          label="Минимальная полезная длина, мм"
          value={category.minimumUsefulLengthMm}
          min={0}
          step="any"
          onChange={(value) => onChange((current) => ({ ...current, minimumUsefulLengthMm: value === '' ? 0 : Number(value) }))}
        />
        <LengthGroupEditor
          categoryKey={category.key}
          group="standardLengths"
          title="Стандартные длины"
          description="Минимум одна длина обязательна"
          values={category.standardLengths}
          otherValues={category.nonstandardLengths}
          onChange={(values) => onChange((current) => ({ ...current, standardLengths: values }))}
        />
        <LengthGroupEditor
          categoryKey={category.key}
          group="nonstandardLengths"
          title="Нестандартные длины"
          description="Используются как дополнительные закупочные варианты"
          values={category.nonstandardLengths}
          otherValues={category.standardLengths}
          onChange={(values) => onChange((current) => ({ ...current, nonstandardLengths: values }))}
        />
      </CardContent>
    </Card>
  )
}

function LengthGroupEditor({
  categoryKey,
  group,
  title,
  description,
  values,
  otherValues,
  onChange,
}: {
  categoryKey: LongStockLayoutCategoryKey
  group: 'standardLengths' | 'nonstandardLengths'
  title: string
  description: string
  values: number[]
  otherValues: number[]
  onChange: (values: number[]) => void
}) {
  const [newLength, setNewLength] = useState('')
  const id = `${categoryKey}-${group}`

  function add() {
    const parsed = Number(newLength)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error('Длина должна быть положительным целым числом')
      return
    }
    if (values.includes(parsed) || otherValues.includes(parsed)) {
      toast.error(`${parsed} мм уже есть в этой категории`)
      return
    }
    onChange([...values, parsed].sort((left, right) => left - right))
    setNewLength('')
  }

  function remove(value: number) {
    if (group === 'standardLengths' && values.length === 1) {
      toast.error('Нельзя удалить последнюю стандартную длину')
      return
    }
    onChange(values.filter((candidate) => candidate !== value))
  }

  return (
    <fieldset className="space-y-3">
      <legend className="font-medium text-foreground">{title}</legend>
      <p id={`${id}-description`} className="text-xs text-muted-foreground">{description}</p>
      <div className="flex min-h-11 flex-wrap gap-2 rounded-xl border bg-muted/10 p-3" aria-live="polite">
        {values.length === 0 ? <span className="text-sm text-muted-foreground">Список пуст</span> : values.map((value) => (
          <span key={value} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium ${group === 'standardLengths' ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {value} мм
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Удалить длину ${value} мм из группы «${title}»`}
              onClick={() => remove(value)}
            >
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Label htmlFor={id} className="sr-only">Новая длина для группы «{title}»</Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={newLength}
          placeholder="Например, 6000"
          aria-describedby={`${id}-description`}
          onChange={(event) => setNewLength(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <Button type="button" variant="outline" className="min-h-10 sm:min-w-28" onClick={add}><Plus className="size-4" />Добавить</Button>
      </div>
    </fieldset>
  )
}

function AuditHistory({ entries }: { entries: LongStockLayoutSettingsAuditEntry[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><History className="size-5" />История изменений</CardTitle></CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Изменений после установки дефолтов ещё не было.</p>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <details key={entry.id} className="rounded-xl border bg-muted/10 p-4">
                <summary className="cursor-pointer list-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{entry.changedBy}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.changedAt))}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{entry.revisionFrom} → {entry.revisionTo}</Badge>
                      {entry.changedFields.map((field) => <Badge key={field} variant="secondary">{formatLongStockLayoutAuditField(field)}</Badge>)}
                    </div>
                  </div>
                </summary>
                <div className="mt-4 grid gap-3 border-t pt-4 lg:grid-cols-2">
                  <AuditValue title="Было" value={entry.previousValue} />
                  <AuditValue title="Стало" value={entry.newValue} />
                </div>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AuditValue({ title, value }: { title: string; value: LongStockLayoutSettingsSnapshot }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-medium">{title}</p>
      <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}
