'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  ChevronsUpDown,
  CircleSlash2,
  Clock3,
  FileArchive,
  Loader2,
  PackagePlus,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { finalizeTechnologistRequest, getFutureDetailingCompatibilityOptions, searchFutureDetailingParts, type CompletionWorkspace } from '@/lib/actions/request-completion'
import { ROUTES } from '@/lib/constants/routes'
import { calculatePlasmaTime, calculateWaste } from '@/lib/request-completion-calculations'
import { cn } from '@/lib/utils'
import { cleanupDirectMachineCuttingUpload, uploadMachineCuttingFileDirect } from '@/lib/machine-cutting/direct-upload-client'
import { validateMachineCuttingUploadRequest, type DirectMachineCuttingUpload } from '@/lib/machine-cutting/files'

type PartSearch = { id: string; name: string; drawing_number: string; unit_weight_kg: number }
type ProductOption = { id: string; name_uk: string; name_en: string; drawing_number: string; versions: Array<{ id: string; version_number: number; drawing_number: string }> }
type FutureRow = { key: string; partId?: string; name: string; drawingNumber: string; unitWeightKg: number; quantity: number; productId?: string; versionId?: string }

function productLabel(product: ProductOption) {
  return `${product.name_uk || product.name_en} · ${product.drawing_number}`
}

export function RequestCompletionWizard({ workspace }: { workspace: CompletionWorkspace }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2>(1)
  const [decision, setDecision] = useState<'has_items' | 'none'>('has_items')
  const [rows, setRows] = useState<FutureRow[]>([])
  const [query, setQuery] = useState('')
  const [parts, setParts] = useState<PartSearch[]>([])
  const [products, setProducts] = useState<ProductOption[]>([])
  const [partsLoading, setPartsLoading] = useState(false)
  const [productsLoading, setProductsLoading] = useState(false)
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  const [productQuery, setProductQuery] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newRow, setNewRow] = useState<FutureRow>({ key: 'new', name: '', drawingNumber: '', unitWeightKg: 0, quantity: 1 })
  const [percentages, setPercentages] = useState<Record<string, string>>(() => Object.fromEntries(workspace.wasteItems.map((item) => [item.sourceId, '0'])))
  const [hours, setHours] = useState('0')
  const [minutes, setMinutes] = useState('0')
  const [archiveFiles, setArchiveFiles] = useState<File[]>([])
  const [uploadFailure, setUploadFailure] = useState<{ successful: DirectMachineCuttingUpload[]; failed: File[] } | null>(null)

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => {
      setPartsLoading(true)
      void searchFutureDetailingParts(query).then((result) => {
        if (active && result.success) setParts(result.data as PartSearch[])
      }).finally(() => {
        if (active) setPartsLoading(false)
      })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    if (!showNew) return
    let active = true
    const timer = window.setTimeout(() => {
      setProductsLoading(true)
      void getFutureDetailingCompatibilityOptions(productQuery).then((result) => {
        if (active && result.success) setProducts(result.data as ProductOption[])
      }).finally(() => {
        if (active) setProductsLoading(false)
      })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [productQuery, showNew])

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
    setProductQuery('')
    setShowNew(false)
  }

  function goNext() {
    if (decision === 'has_items' && rows.length === 0) return toast.error('Добавьте деталировку или выберите «Будущей деталировки нет»')
    setStep(2)
  }

  function completionPayload(archives: DirectMachineCuttingUpload[]) {
    return {
      requestId: workspace.requestId, decision, hours: Number(hours), minutes: Number(minutes),
      wasteItems: workspace.wasteItems.map((item) => ({ ...item, wastePercent: Number(percentages[item.sourceId]) })),
      futureItems: decision === 'none' ? [] : rows.map((row) => ({
        partId: row.partId || null, quantity: row.quantity, name: row.name, drawingNumber: row.drawingNumber, unitWeightKg: row.unitWeightKg,
        compatibilities: row.partId ? [] : [{ productId: row.productId!, allVersions: false, versionIds: [row.versionId!] }],
      })),
      archives,
    }
  }

  async function finish(archives: DirectMachineCuttingUpload[]) {
    const result = await finalizeTechnologistRequest(completionPayload(archives))
    if (!result.success) { toast.error(result.error || 'Не удалось завершить заявку'); return false }
    toast.success('Заявка зафиксирована и передана снабжению')
    router.replace(ROUTES.MATERIAL_REQUESTS)
    return true
  }

  async function uploadFiles(files: File[], successful: DirectMachineCuttingUpload[] = []) {
    const settled = await Promise.allSettled(files.map((file) => uploadMachineCuttingFileDirect(workspace.machineId, workspace.requestId, file)))
    const uploaded = [...successful]
    const failed: File[] = []
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') uploaded.push(result.value)
      else failed.push(files[index])
    })
    return { successful: uploaded, failed }
  }

  function submit() {
    const missing = workspace.wasteItems.find((item) => item.weightKg == null || item.weightKg <= 0)
    if (missing) return toast.error(`CRM не рассчитала вес: ${missing.itemName}`)
    const invalid = Object.values(percentages).some((value) => value === '' || Number(value) < 0 || Number(value) > 100 || Math.round(Number(value) * 10) !== Number(value) * 10)
    if (invalid || Number(minutes) > 59) return toast.error('Проверьте проценты отходности и время')
    startTransition(async () => {
      const uploads = await uploadFiles(archiveFiles)
      if (uploads.failed.length > 0) {
        setUploadFailure(uploads)
        return
      }
      await finish(uploads.successful)
    })
  }

  function selectArchives(files: FileList | null) {
    if (!files) return
    const selected = Array.from(files)
    try {
      if (selected.length > 20) throw new Error('Можно выбрать не более 20 архивов')
      selected.forEach((file) => validateMachineCuttingUploadRequest({ fileName: file.name, fileSize: file.size }))
      setArchiveFiles(selected)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Некорректный архив')
    }
  }

  return <main className="mx-auto max-w-6xl space-y-6 pb-28">
    <header className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-blue-50 shadow-sm">
      <div className="flex flex-col gap-5 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge className="border-0 bg-blue-100 text-blue-800 hover:bg-blue-100">{workspace.factoryName}</Badge>
              <span className="text-sm text-slate-500">Финальная проверка</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Завершение заявки</h1>
            <p className="mt-1 text-base text-slate-600">{workspace.machineName}</p>
          </div>
          <div className="rounded-full border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-800 shadow-xs">
            Шаг {step} из 2
          </div>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2" aria-label="Этапы завершения заявки">
          {[
            { number: 1, title: 'Будущая деталировка', description: 'Остаток для следующих заказов' },
            { number: 2, title: 'Отходность и время', description: 'Факт порезки и плазмы' },
          ].map((item) => {
            const active = step === item.number
            const complete = step > item.number
            return <li key={item.number} aria-current={active ? 'step' : undefined} className={cn(
              'flex min-h-20 items-center gap-3 rounded-xl border p-4 transition-colors',
              active ? 'border-blue-500 bg-blue-50 text-blue-950' : 'border-slate-200 bg-white/70 text-slate-600',
            )}>
              <span className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold',
                active ? 'border-blue-600 bg-blue-600 text-white' : complete ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white',
              )}>{complete ? <Check className="h-4 w-4" /> : item.number}</span>
              <span><span className="block font-semibold">{item.title}</span><span className="block text-sm text-slate-500">{item.description}</span></span>
            </li>
          })}
        </ol>
      </div>
    </header>

    {step === 1 ? <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
      <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-5 sm:px-7">
        <CardTitle className="text-xl text-slate-950">Что сделать с полезным остатком?</CardTitle>
        <CardDescription className="text-sm leading-6">Добавьте детали, которые можно вырезать позже для других заказов, или подтвердите, что подходящих деталей нет.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-7 p-5 sm:p-7">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">Решение по будущей деталировке</legend>
          <Label className={cn(
            'group flex min-h-24 cursor-pointer items-start gap-4 rounded-xl border p-4 transition-all hover:border-blue-300 hover:bg-blue-50/60',
            decision === 'has_items' && 'border-blue-500 bg-blue-50 ring-1 ring-blue-500',
          )}>
            <input className="mt-1 h-4 w-4 accent-blue-600" type="radio" name="decision" value="has_items" checked={decision === 'has_items'} onChange={() => setDecision('has_items')} />
            <PackagePlus className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
            <span><span className="block font-semibold text-slate-950">Добавить будущую деталировку</span><span className="mt-1 block text-sm font-normal leading-5 text-slate-600">Найти готовую карточку или создать новую.</span></span>
          </Label>
          <Label className={cn(
            'group flex min-h-24 cursor-pointer items-start gap-4 rounded-xl border p-4 transition-all hover:border-slate-400 hover:bg-slate-50',
            decision === 'none' && 'border-slate-700 bg-slate-50 ring-1 ring-slate-700',
          )}>
            <input className="mt-1 h-4 w-4 accent-slate-800" type="radio" name="decision" value="none" checked={decision === 'none'} onChange={() => setDecision('none')} />
            <CircleSlash2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />
            <span><span className="block font-semibold text-slate-950">Будущей деталировки нет</span><span className="mt-1 block text-sm font-normal leading-5 text-slate-600">Весь полезный остаток останется без плана деталей.</span></span>
          </Label>
        </fieldset>

        {decision === 'has_items' && <div className="space-y-6">
          <section aria-labelledby="existing-detailing-title" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 id="existing-detailing-title" className="font-semibold text-slate-950">Найти существующую деталировку</h2>
                <p className="text-sm text-slate-500">Поиск по названию или номеру чертежа.</p>
              </div>
              {rows.length > 0 && <Badge variant="secondary">{rows.length} добавлено</Badge>}
            </div>
            <div className="relative">
              {partsLoading ? <Loader2 className="absolute left-3.5 top-3.5 h-4 w-4 animate-spin text-blue-600" /> : <Search className="absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />}
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 rounded-xl border-slate-300 bg-white pl-10 shadow-xs" placeholder="Например: опора или ЛЕДА.525" aria-label="Поиск существующей деталировки" />
            </div>
            <div aria-live="polite">
              {query.trim() && !partsLoading && parts.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">Совпадений не найдено. Создайте новую карточку ниже.</div>}
              {parts.length > 0 && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{parts.map((part) => {
                const added = rows.some((row) => row.partId === part.id)
                return <button key={part.id} type="button" disabled={added} onClick={() => addExisting(part)} className={cn(
                  'group min-h-20 rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:translate-y-0 disabled:cursor-default disabled:border-emerald-200 disabled:bg-emerald-50',
                )}>
                  <span className="flex items-start justify-between gap-2"><span className="font-semibold text-slate-900">{part.name}</span>{added && <Check className="h-4 w-4 shrink-0 text-emerald-700" />}</span>
                  <span className="mt-1 block text-sm text-slate-500">{part.drawing_number} · {Number(part.unit_weight_kg).toFixed(3)} кг</span>
                </button>
              })}</div>}
            </div>
          </section>

          <div className="relative flex items-center"><div className="h-px flex-1 bg-slate-200" /><span className="px-3 text-xs font-medium uppercase tracking-wider text-slate-400">или</span><div className="h-px flex-1 bg-slate-200" /></div>

          <Button type="button" variant="outline" className="h-11 rounded-xl border-dashed border-blue-300 bg-blue-50/50 px-4 text-blue-800 hover:border-blue-500 hover:bg-blue-50" onClick={() => setShowNew((value) => !value)} aria-expanded={showNew}>
            <Plus className="mr-2 h-4 w-4" />{showNew ? 'Скрыть новую карточку' : 'Создать новую карточку'}
          </Button>

          {showNew && <section aria-labelledby="new-detailing-title" className="space-y-5 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/80 to-white p-4 sm:p-5">
            <div><h2 id="new-detailing-title" className="flex items-center gap-2 font-semibold text-slate-950"><Boxes className="h-5 w-5 text-blue-700" />Новая деталировка</h2><p className="mt-1 text-sm text-slate-600">Заполните данные детали и найдите изделие, с которым она совместима.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="new-name">Название <span className="text-red-600">*</span></Label><Input id="new-name" className="h-11 bg-white" placeholder="Название детали" value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="new-drawing">Номер чертежа <span className="text-red-600">*</span></Label><Input id="new-drawing" className="h-11 bg-white" placeholder="Номер или шифр" value={newRow.drawingNumber} onChange={(e) => setNewRow({ ...newRow, drawingNumber: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="new-weight">Вес одной детали, кг <span className="text-red-600">*</span></Label><Input id="new-weight" className="h-11 bg-white" type="number" min="0.001" step="0.001" inputMode="decimal" placeholder="0,000" value={newRow.unitWeightKg || ''} onChange={(e) => setNewRow({ ...newRow, unitWeightKg: Number(e.target.value) })} /></div>
              <div className="space-y-1.5">
                <Label>Совместимое изделие <span className="text-red-600">*</span></Label>
                <Popover open={productPickerOpen} onOpenChange={(open) => { setProductPickerOpen(open); if (!open) setProductQuery('') }}>
                  <PopoverTrigger render={
                    <Button type="button" variant="outline" role="combobox" aria-expanded={productPickerOpen} className={cn('h-11 w-full justify-between bg-white px-3 font-normal', !selectedProduct && 'text-muted-foreground')}>
                      <span className="min-w-0 truncate">{selectedProduct ? productLabel(selectedProduct) : 'Найти изделие'}</span>
                      {productsLoading ? <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" /> : <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />}
                    </Button>
                  } />
                  <PopoverContent align="start" className="w-(--anchor-width) min-w-72 max-w-[calc(100vw-2rem)] p-0">
                    <Command shouldFilter={false}>
                      <CommandInput autoFocus value={productQuery} onValueChange={setProductQuery} placeholder="Название или номер чертежа" />
                      <CommandList className="max-h-72">
                        {!productsLoading && <CommandEmpty>Совпадений с изделием не найдено</CommandEmpty>}
                        <CommandGroup heading="Изделия">
                          {products.map((product) => <CommandItem key={product.id} value={product.id} onSelect={() => {
                            setNewRow({ ...newRow, productId: product.id, versionId: undefined })
                            setProductPickerOpen(false)
                            setProductQuery('')
                          }} className="items-start gap-3 py-3">
                            <Check className={cn('mt-0.5 h-4 w-4 shrink-0 text-blue-600', newRow.productId === product.id ? 'opacity-100' : 'opacity-0')} />
                            <span className="min-w-0"><span className="block truncate font-medium">{product.name_uk || product.name_en}</span><span className="block truncate text-xs text-muted-foreground">{product.drawing_number}</span></span>
                          </CommandItem>)}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <p className="text-xs text-slate-500">Поиск выполняется по названию и номеру чертежа.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Версия <span className="text-red-600">*</span></Label>
                <Select value={newRow.versionId} onValueChange={(value) => value && setNewRow({ ...newRow, versionId: value })} disabled={!selectedProduct}>
                  <SelectTrigger className="h-11 bg-white"><SelectValue>{selectedProduct?.versions.find((v) => v.id === newRow.versionId) ? `Версия ${selectedProduct.versions.find((v) => v.id === newRow.versionId)?.version_number} · ${selectedProduct.versions.find((v) => v.id === newRow.versionId)?.drawing_number}` : selectedProduct ? 'Выберите версию' : 'Сначала выберите изделие'}</SelectValue></SelectTrigger>
                  <SelectContent>{selectedProduct?.versions.map((version) => <SelectItem key={version.id} value={version.id}>Версия {version.version_number} · {version.drawing_number}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-end"><Button type="button" className="h-11 w-full bg-blue-700 hover:bg-blue-800 sm:w-auto" onClick={addNew}><Plus className="mr-2 h-4 w-4" />Добавить деталировку</Button></div>
            </div>
          </section>}

          {rows.length > 0 && <section aria-labelledby="selected-detailing-title" className="space-y-3">
            <h2 id="selected-detailing-title" className="font-semibold text-slate-950">Добавлено в план <span className="font-normal text-slate-500">· {rows.length}</span></h2>
            <div className="space-y-2">{rows.map((row) => <div key={row.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5">
              <div className="flex min-w-48 flex-1 items-start gap-3"><span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-4 w-4" /></span><div><p className="font-semibold text-slate-900">{row.name}</p><p className="text-sm text-slate-500">{row.drawingNumber} · {row.unitWeightKg.toFixed(3)} кг</p></div></div>
              <div className="flex items-center gap-2"><Label htmlFor={`qty-${row.key}`} className="text-sm text-slate-600">Количество</Label><Input id={`qty-${row.key}`} type="number" min="1" inputMode="numeric" className="h-10 w-20 bg-white text-center" value={row.quantity} onChange={(e) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, quantity: Number(e.target.value) } : item))} /></div>
              <Button type="button" variant="ghost" size="icon" className="text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label={`Удалить ${row.name}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></Button>
            </div>)}</div>
          </section>}
        </div>}

        <div className="flex justify-end border-t border-slate-100 pt-5">
          <Button type="button" onClick={goNext} className="h-12 w-full rounded-xl bg-blue-700 px-6 text-base shadow-sm hover:bg-blue-800 sm:w-auto">К отходности и времени <ArrowRight className="ml-2 h-4 w-4" /></Button>
        </div>
      </CardContent>
    </Card> : <div className="space-y-5">
      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-5 sm:px-7">
          <CardTitle className="text-xl text-slate-950">Отходность по позициям</CardTitle>
          <CardDescription className="leading-6">Укажите фактический процент металлолома. Полезный остаток и итоговый вес пересчитаются автоматически.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-5 sm:p-7">{workspace.wasteItems.map((item) => {
        const pct = Number(percentages[item.sourceId] || 0); const weight = item.weightKg || 0; const scrap = calculateWaste(weight, pct).scrapKg
        return <div key={item.sourceId} className="grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-xs md:grid-cols-[minmax(220px,1fr)_120px_140px_140px] md:items-center">
          <div><p className="font-semibold text-slate-900">{item.itemName}</p><p className="mt-1 text-sm text-slate-500">{item.quantityLabel} · полный вес {item.weightKg == null ? 'не рассчитан' : `${weight.toFixed(3)} кг`}</p></div>
          <div className="space-y-1.5"><Label htmlFor={`pct-${item.sourceId}`}>Отход, %</Label><Input id={`pct-${item.sourceId}`} className="h-11 text-center" type="number" min="0" max="100" step="0.1" inputMode="decimal" value={percentages[item.sourceId]} onChange={(e) => setPercentages({ ...percentages, [item.sourceId]: e.target.value })} /></div>
          <div className="rounded-lg bg-red-50 px-3 py-2"><p className="text-xs font-medium text-red-700">Металлолом</p><p className="mt-1 font-mono font-semibold text-red-950">{scrap.toFixed(3)} кг</p></div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2"><p className="text-xs font-medium text-emerald-700">Полезный вес</p><p className="mt-1 font-mono font-semibold text-emerald-950">{(weight - scrap).toFixed(3)} кг</p></div>
        </div>
      })}
          <div className="grid gap-3 rounded-xl bg-slate-900 p-4 text-white sm:grid-cols-3">
            <div className="rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-300">Общий вес <strong className="mt-1 block font-mono text-lg text-white">{totals.weight.toFixed(3)} кг</strong></div>
            <div className="rounded-lg bg-white/5 px-3 py-2 text-sm text-slate-300">Металлолом <strong className="mt-1 block font-mono text-lg text-white">{totals.scrap.toFixed(3)} кг</strong></div>
            <div className="rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">Полезный вес <strong className="mt-1 block font-mono text-lg text-emerald-100">{totals.useful.toFixed(3)} кг</strong></div>
          </div>
        </CardContent>
      </Card>
      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-5 sm:px-7">
          <CardTitle className="flex items-center gap-2 text-xl text-slate-950"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><FileArchive className="h-5 w-5" /></span>Программа порезки</CardTitle>
          <CardDescription>Необязательно. Выберите один или несколько архивов ZIP, RAR или 7Z до 500 МБ каждый.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-5 sm:p-7">
          <Label htmlFor="cutting-archives" className="flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-dashed border-blue-300 bg-blue-50 px-4 text-center font-medium text-blue-800 hover:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500">
            Выбрать программы порезки
            <input id="cutting-archives" type="file" multiple accept=".zip,.rar,.7z,application/zip,application/x-rar-compressed,application/vnd.rar,application/x-7z-compressed" className="sr-only" onChange={(event) => selectArchives(event.target.files)} />
          </Label>
          {archiveFiles.length === 0 ? <p className="text-sm text-slate-500">Программа не выбрана — заявку можно завершить без неё.</p> : <ul className="space-y-2" aria-label="Выбранные программы">{archiveFiles.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"><span className="min-w-0 break-all text-sm font-medium text-slate-800">{file.name}</span><Button type="button" variant="ghost" size="sm" className="min-h-11 shrink-0 text-red-700" onClick={() => setArchiveFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>Удалить</Button></li>)}</ul>}
        </CardContent>
      </Card>
      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 px-5 py-5 sm:px-7">
          <CardTitle className="flex items-center gap-2 text-xl text-slate-950"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-700"><Clock3 className="h-5 w-5" /></span>Время работы плазмы</CardTitle>
          <CardDescription>К введённому времени CRM автоматически добавит технологический коэффициент 25%.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7 lg:grid-cols-[150px_150px_1fr] lg:items-end">
          <div className="space-y-1.5"><Label htmlFor="hours">Часы</Label><Input id="hours" className="h-11 text-center" type="number" min="0" step="1" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="minutes">Минуты</Label><Input id="minutes" className="h-11 text-center" type="number" min="0" max="59" step="1" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
          <div className="grid gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 sm:grid-cols-3">
            <div className="px-2 py-1"><p className="text-xs font-medium text-blue-700">Введено</p><strong className="mt-1 block text-lg text-blue-950">{enteredMinutes} мин</strong></div>
            <div className="border-blue-200 px-2 py-1 sm:border-l"><p className="text-xs font-medium text-blue-700">Коэффициент 25%</p><strong className="mt-1 block text-lg text-blue-950">+{finalMinutes - enteredMinutes} мин</strong></div>
            <div className="border-blue-200 px-2 py-1 sm:border-l"><p className="text-xs font-medium text-blue-700">Фактическое</p><strong className="mt-1 block text-lg text-blue-950">{finalMinutes} мин</strong></div>
          </div>
        </CardContent>
      </Card>
      <div className="sticky bottom-4 z-10 flex flex-col-reverse gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" className="h-12 rounded-xl px-5" onClick={() => setStep(1)} disabled={pending}><ArrowLeft className="mr-2 h-4 w-4" />Назад к деталировке</Button>
        <Button type="button" onClick={submit} disabled={pending} className="h-12 rounded-xl bg-emerald-700 px-6 text-base shadow-sm hover:bg-emerald-800">
          {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{pending ? 'Фиксируем заявку…' : 'Завершить и передать снабжению'}
        </Button>
      </div>
    </div>}
    <Dialog open={Boolean(uploadFailure)} onOpenChange={() => undefined}>
      <DialogContent className="sm:max-w-lg" showCloseButton={false}>
        <DialogHeader><DialogTitle>Не все программы загружены</DialogTitle><DialogDescription>Успешно: {uploadFailure?.successful.length || 0}. Не загружено: {uploadFailure?.failed.length || 0}. Выберите, как завершить заявку.</DialogDescription></DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="button" disabled={pending} className="min-h-11 w-full" onClick={() => startTransition(async () => {
            if (!uploadFailure) return
            const retried = await uploadFiles(uploadFailure.failed, uploadFailure.successful)
            if (retried.failed.length > 0) setUploadFailure(retried)
            else { setUploadFailure(null); await finish(retried.successful) }
          })}>Повторить неудачные загрузки</Button>
          <Button type="button" disabled={pending || !uploadFailure?.successful.length} variant="outline" className="min-h-11 w-full" onClick={() => startTransition(async () => {
            if (!uploadFailure) return
            const uploads = uploadFailure.successful
            setUploadFailure(null)
            await finish(uploads)
          })}>Завершить с загруженными</Button>
          <Button type="button" disabled={pending} variant="ghost" className="min-h-11 w-full" onClick={() => startTransition(async () => {
            if (!uploadFailure) return
            await Promise.all(uploadFailure.successful.map((upload) => cleanupDirectMachineCuttingUpload(workspace.machineId, upload)))
            setUploadFailure(null)
            await finish([])
          })}>Завершить без программы</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </main>
}
