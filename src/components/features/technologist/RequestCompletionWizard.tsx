'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Clock3, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { finalizeTechnologistRequest, getFutureDetailingCompatibilityOptions, searchFutureDetailingParts, type CompletionWorkspace } from '@/lib/actions/request-completion'
import { ROUTES } from '@/lib/constants/routes'
import { calculatePlasmaTime, calculateWaste } from '@/lib/request-completion-calculations'

type PartSearch = { id: string; name: string; drawing_number: string; unit_weight_kg: number }
type ProductOption = { id: string; name_uk: string; name_en: string; drawing_number: string; versions: Array<{ id: string; version_number: number; drawing_number: string }> }
type FutureRow = { key: string; partId?: string; name: string; drawingNumber: string; unitWeightKg: number; quantity: number; productId?: string; versionId?: string }

export function RequestCompletionWizard({ workspace }: { workspace: CompletionWorkspace }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2>(1)
  const [decision, setDecision] = useState<'has_items' | 'none'>('has_items')
  const [rows, setRows] = useState<FutureRow[]>([])
  const [query, setQuery] = useState('')
  const [parts, setParts] = useState<PartSearch[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newRow, setNewRow] = useState<FutureRow>({ key: 'new', name: '', drawingNumber: '', unitWeightKg: 0, quantity: 1 })
  const [percentages, setPercentages] = useState<Record<string, string>>(() => Object.fromEntries(workspace.wasteItems.map((item) => [item.sourceId, '0'])))
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('0')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const [partResult, productResult] = await Promise.all([searchFutureDetailingParts(query), getFutureDetailingCompatibilityOptions(query)])
        if (partResult.success) setParts(partResult.data as PartSearch[])
        if (productResult.success) setProducts(productResult.data as ProductOption[])
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const selectedProduct = products.find((product) => product.id === newRow.productId)
  const totals = useMemo(() => workspace.wasteItems.reduce((acc, item) => {
    const weight = item.weightKg || 0
    const pct = Number(percentages[item.sourceId] || 0)
    const scrap = calculateWaste(weight, pct).scrapKg
    return { weight: acc.weight + weight, scrap: acc.scrap + scrap, useful: acc.useful + weight - scrap }
  }, { weight: 0, scrap: 0, useful: 0 }), [workspace.wasteItems, percentages])
  const plasmaTime = calculatePlasmaTime(Number(hours) || 0, Number(minutes) || 0)
  const enteredMinutes = plasmaTime.enteredMinutes
  const finalMinutes = plasmaTime.actualMinutes

  function addExisting(part: PartSearch) {
    if (rows.some((row) => row.partId === part.id)) return
    setRows((current) => [...current, { key: part.id, partId: part.id, name: part.name, drawingNumber: part.drawing_number, unitWeightKg: Number(part.unit_weight_kg), quantity: 1 }])
  }

  function addNew() {
    if (!newRow.name.trim() || !newRow.drawingNumber.trim() || newRow.unitWeightKg <= 0 || !newRow.productId || !newRow.versionId) {
      toast.error('Заполните название, чертёж, вес, изделие и версию')
      return
    }
    setRows((current) => [...current, { ...newRow, key: crypto.randomUUID() }])
    setNewRow({ key: 'new', name: '', drawingNumber: '', unitWeightKg: 0, quantity: 1 })
    setShowNew(false)
  }

  function goNext() {
    if (decision === 'has_items' && rows.length === 0) return toast.error('Добавьте деталировку или выберите «Будущей деталировки нет»')
    setStep(2)
  }

  function submit() {
    const missing = workspace.wasteItems.find((item) => item.weightKg == null || item.weightKg <= 0)
    if (missing) return toast.error(`CRM не рассчитала вес: ${missing.itemName}`)
    const invalid = Object.values(percentages).some((value) => value === '' || Number(value) < 0 || Number(value) > 100 || Math.round(Number(value) * 10) !== Number(value) * 10)
    if (invalid || Number(minutes) > 59) return toast.error('Проверьте проценты отходности и время')
    startTransition(async () => {
      const result = await finalizeTechnologistRequest({
        requestId: workspace.requestId, decision, hours: Number(hours), minutes: Number(minutes),
        wasteItems: workspace.wasteItems.map((item) => ({ ...item, wastePercent: Number(percentages[item.sourceId]) })),
        futureItems: decision === 'none' ? [] : rows.map((row) => ({
          partId: row.partId || null, quantity: row.quantity, name: row.name, drawingNumber: row.drawingNumber, unitWeightKg: row.unitWeightKg,
          compatibilities: row.partId ? [] : [{ productId: row.productId!, allVersions: false, versionIds: [row.versionId!] }],
        })),
      })
      if (!result.success) { toast.error(result.error || 'Не удалось завершить заявку'); return }
      toast.success('Заявка зафиксирована и передана снабжению')
      router.replace(ROUTES.MATERIAL_REQUESTS)
    })
  }

  return <main className="mx-auto max-w-6xl space-y-5 pb-24">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-sm text-muted-foreground">{workspace.factoryName}</p><h1 className="text-2xl font-semibold">Завершение заявки · {workspace.machineName}</h1></div>
      <Badge variant="outline">Шаг {step} из 2</Badge>
    </div>
    <div className="grid grid-cols-2 gap-2" aria-label="Этапы мастера">
      <div className={`rounded-lg border p-3 ${step === 1 ? 'border-primary bg-primary/5' : 'bg-muted/40'}`}><span className="font-medium">1. Будущая деталировка</span></div>
      <div className={`rounded-lg border p-3 ${step === 2 ? 'border-primary bg-primary/5' : 'bg-muted/40'}`}><span className="font-medium">2. Отходность и время</span></div>
    </div>

    {step === 1 ? <Card><CardHeader><CardTitle>Что останется после порезки для других заказов</CardTitle></CardHeader><CardContent className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="sr-only">Решение по будущей деталировке</legend>
        <Label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3"><input type="radio" name="decision" value="has_items" checked={decision === 'has_items'} onChange={() => setDecision('has_items')} />Добавить будущую деталировку</Label>
        <Label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border p-3"><input type="radio" name="decision" value="none" checked={decision === 'none'} onChange={() => setDecision('none')} />Будущей деталировки нет</Label>
      </fieldset>
      {decision === 'has_items' && <>
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" placeholder="Название или номер чертежа" aria-label="Поиск существующей деталировки" /></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{parts.map((part) => <button key={part.id} type="button" onClick={() => addExisting(part)} className="min-h-16 rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="block font-medium">{part.name}</span><span className="text-sm text-muted-foreground">{part.drawing_number} · {Number(part.unit_weight_kg).toFixed(3)} кг</span></button>)}</div>
        <Button type="button" variant="outline" onClick={() => setShowNew((value) => !value)}><Plus className="mr-2 h-4 w-4" />Новая карточка</Button>
        {showNew && <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
          <div><Label htmlFor="new-name">Название *</Label><Input id="new-name" value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })} /></div>
          <div><Label htmlFor="new-drawing">Номер чертежа *</Label><Input id="new-drawing" value={newRow.drawingNumber} onChange={(e) => setNewRow({ ...newRow, drawingNumber: e.target.value })} /></div>
          <div><Label htmlFor="new-weight">Вес одной детали, кг *</Label><Input id="new-weight" type="number" min="0.001" step="0.001" value={newRow.unitWeightKg || ''} onChange={(e) => setNewRow({ ...newRow, unitWeightKg: Number(e.target.value) })} /></div>
          <div><Label>Совместимое изделие *</Label><Select value={newRow.productId} onValueChange={(value) => value && setNewRow({ ...newRow, productId: value, versionId: undefined })}><SelectTrigger><SelectValue>{selectedProduct ? `${selectedProduct.name_uk || selectedProduct.name_en} · ${selectedProduct.drawing_number}` : 'Выберите изделие'}</SelectValue></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name_uk || product.name_en} · {product.drawing_number}</SelectItem>)}</SelectContent></Select></div>
          <div><Label>Версия *</Label><Select value={newRow.versionId} onValueChange={(value) => value && setNewRow({ ...newRow, versionId: value })} disabled={!selectedProduct}><SelectTrigger><SelectValue>{selectedProduct?.versions.find((v) => v.id === newRow.versionId) ? `Версия ${selectedProduct.versions.find((v) => v.id === newRow.versionId)?.version_number} · ${selectedProduct.versions.find((v) => v.id === newRow.versionId)?.drawing_number}` : 'Выберите версию'}</SelectValue></SelectTrigger><SelectContent>{selectedProduct?.versions.map((version) => <SelectItem key={version.id} value={version.id}>Версия {version.version_number} · {version.drawing_number}</SelectItem>)}</SelectContent></Select></div>
          <div className="flex items-end"><Button type="button" onClick={addNew}>Добавить карточку</Button></div>
        </div>}
        <div className="space-y-2">{rows.map((row) => <div key={row.key} className="flex flex-wrap items-center gap-3 rounded-lg border p-3"><div className="min-w-48 flex-1"><p className="font-medium">{row.name}</p><p className="text-sm text-muted-foreground">{row.drawingNumber}</p></div><Label htmlFor={`qty-${row.key}`} className="sr-only">Количество</Label><Input id={`qty-${row.key}`} type="number" min="1" className="w-24" value={row.quantity} onChange={(e) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, quantity: Number(e.target.value) } : item))} /><Button type="button" variant="ghost" size="icon" aria-label={`Удалить ${row.name}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></Button></div>)}</div>
      </>}
      <div className="flex justify-end"><Button type="button" onClick={goNext}>Далее: отходность и время</Button></div>
    </CardContent></Card> : <>
      <Card><CardHeader><CardTitle>Отходность по позициям</CardTitle></CardHeader><CardContent className="space-y-3">{workspace.wasteItems.map((item) => {
        const pct = Number(percentages[item.sourceId] || 0); const weight = item.weightKg || 0; const scrap = calculateWaste(weight, pct).scrapKg
        return <div key={item.sourceId} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[minmax(220px,1fr)_120px_140px_140px] md:items-center"><div><p className="font-medium">{item.itemName}</p><p className="text-sm text-muted-foreground">{item.quantityLabel} · полный вес {item.weightKg == null ? 'не рассчитан' : `${weight.toFixed(3)} кг`}</p></div><div><Label htmlFor={`pct-${item.sourceId}`}>Отход, %</Label><Input id={`pct-${item.sourceId}`} type="number" min="0" max="100" step="0.1" value={percentages[item.sourceId]} onChange={(e) => setPercentages({ ...percentages, [item.sourceId]: e.target.value })} /></div><div><p className="text-xs text-muted-foreground">Металлолом</p><p className="font-mono font-medium">{scrap.toFixed(3)} кг</p></div><div><p className="text-xs text-muted-foreground">Полезный вес</p><p className="font-mono font-medium">{(weight - scrap).toFixed(3)} кг</p></div></div>
      })}<div className="grid gap-3 rounded-lg bg-muted p-4 sm:grid-cols-3"><div>Общий вес <strong className="block font-mono">{totals.weight.toFixed(3)} кг</strong></div><div>Металлолом <strong className="block font-mono">{totals.scrap.toFixed(3)} кг</strong></div><div>Полезный вес <strong className="block font-mono">{totals.useful.toFixed(3)} кг</strong></div></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />Время плазмы</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"><div><Label htmlFor="hours">Часы</Label><Input id="hours" type="number" min="0" step="1" value={hours} onChange={(e) => setHours(e.target.value)} /></div><div><Label htmlFor="minutes">Минуты</Label><Input id="minutes" type="number" min="0" max="59" step="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div><div><p className="text-sm text-muted-foreground">Введено</p><strong>{enteredMinutes} мин</strong></div><div><p className="text-sm text-muted-foreground">Добавлено 25%</p><strong>+{finalMinutes - enteredMinutes} мин</strong></div><div><p className="text-sm text-muted-foreground">Фактическое</p><strong>{finalMinutes} мин</strong></div></CardContent></Card>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><Button type="button" variant="outline" onClick={() => setStep(1)} disabled={pending}><ArrowLeft className="mr-2 h-4 w-4" />Назад</Button><Button type="button" onClick={submit} disabled={pending} className="min-h-12 bg-emerald-700 hover:bg-emerald-800"><Check className="mr-2 h-4 w-4" />{pending ? 'Фиксируем…' : 'Завершить заявку и передать снабжению'}</Button></div>
    </>}
  </main>
}
