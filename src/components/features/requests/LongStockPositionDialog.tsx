'use client'

import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  Calculator,
  Check,
  ChevronRight,
  CircleAlert,
  Loader2,
  Plus,
  Ruler,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  approveLongStockCuttingPlanVersion,
  calculateLongStockCuttingPlan,
  createLongStockCuttingPlanVersion,
  createManualLongStockCuttingPlanVersion,
} from '@/lib/actions/long-stock-cutting-plans'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import {
  addCircle,
  addKnife,
  addPipe,
  deleteCircle,
  deleteKnife,
  deletePipe,
  updateCircle,
  updateKnife,
  updatePipe,
  type WithMaterialName,
} from '@/lib/actions/technologist-requests'
import { PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import {
  candidateComposition,
  candidatePurchaseLengthLabel,
  candidateToManualBars,
  candidateWastePercent,
  expandLongStockSegmentRows,
  formatKg,
  formatMm,
  totalLongStockSegmentLength,
  type LongStockSegmentRow,
} from '@/lib/long-stock-position-ui'
import { knifeBevelLabel, parseKnifeBevelCount } from '@/lib/materials/knife-bevel'
import { calculateLongStockBarRemainder, type LongStockCuttingCandidate } from '@/lib/long-stock-cutting-solver'
import type {
  LongStockManualBarInput,
  LongStockPlanCalculationInput,
  LongStockPlanCalculationMode,
  LongStockPlanSegmentInput,
  LongStockRequestItemTable,
} from '@/lib/long-stock-cutting-plan'
import type { MaterialVariant, RequestCircle, RequestKnives, RequestPipe } from '@/lib/types'
import { cn } from '@/lib/utils'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'

type Category = 'circle' | 'pipe' | 'knives'
type Calculation = Awaited<ReturnType<typeof calculateLongStockCuttingPlan>>
type CreatedRow = WithMaterialName<RequestCircle> | WithMaterialName<RequestPipe> | WithMaterialName<RequestKnives>

type Props = {
  category: Category
  requestId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (row: CreatedRow) => void
}

type DraftItem = {
  table: LongStockRequestItemTable
  id: string
  row: CreatedRow
}

const CATEGORY_CONFIG: Record<Category, {
  title: string
  searchCategory: Category
  table: LongStockRequestItemTable
}> = {
  circle: { title: 'Позиция круга', searchCategory: 'circle', table: 'request_circle' },
  pipe: { title: 'Позиция трубы', searchCategory: 'pipe', table: 'request_pipe' },
  knives: { title: 'Позиция ножей', searchCategory: 'knives', table: 'request_knives' },
}

const MANUAL_REASONS = [
  { value: 'bar_defect', label: 'Дефект хлыста' },
  { value: 'machine_limit', label: 'Ограничение станка' },
  { value: 'operator_convenience', label: 'Удобство оператора' },
  { value: 'other', label: 'Другое' },
] as const

export function LongStockPositionDialog({ category, requestId, open, onOpenChange, onCreated }: Props) {
  const config = CATEGORY_CONFIG[category]
  const nextSegmentRow = useRef(2)
  const draftRef = useRef<DraftItem | null>(null)
  const [material, setMaterial] = useState<MaterialWithSupplier | null>(null)
  const [variant, setVariant] = useState<MaterialVariant | null>(null)
  const [segmentRows, setSegmentRows] = useState<LongStockSegmentRow[]>([
    { id: 'segment-row-1', lengthMm: '', quantity: 1 },
  ])
  const [calculation, setCalculation] = useState<Calculation | null>(null)
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)
  const [mixedLengths, setMixedLengths] = useState(false)
  const [nonstandardLengths, setNonstandardLengths] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [manualBars, setManualBars] = useState<LongStockManualBarInput[]>([])
  const [manualReason, setManualReason] = useState('')
  const [manualReasonText, setManualReasonText] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const segmentValidation = useMemo(() => {
    try {
      return { segments: expandLongStockSegmentRows(segmentRows), error: null }
    } catch (validationError) {
      return {
        segments: [] as LongStockPlanSegmentInput[],
        error: validationError instanceof Error ? validationError.message : 'Проверьте отрезки',
      }
    }
  }, [segmentRows])

  const visibleCandidates = useMemo(
    () => candidatesForMode(calculation?.candidates ?? [], mixedLengths),
    [calculation, mixedLengths],
  )
  const selectedCandidate = visibleCandidates.find((candidate) => candidate.key === selectedCandidateKey) ?? null
  const bestCandidateKey = visibleCandidates[0]?.key ?? null
  const wastePercent = selectedCandidate ? candidateWastePercent(selectedCandidate) : 0
  const threshold = Number(calculation?.settingsSnapshot.optimization_hint_threshold_percent ?? 0)
  const showOptimizationHint = Boolean(selectedCandidate && !mixedLengths && !nonstandardLengths && wastePercent > threshold)
  const exactVariantReady = Boolean(variant?.id && variant.category === category && !(category === 'pipe' && variant.pipe_type === 'wire'))
  const canCalculate = exactVariantReady && segmentValidation.error === null && !pendingAction

  function invalidateCalculation() {
    setCalculation(null)
    setSelectedCandidateKey(null)
    setManualMode(false)
    setManualBars([])
    setError(null)
  }

  function selectMaterial(
    selectedMaterial: MaterialWithSupplier,
    selectedVariant: MaterialVariant | undefined,
    source: MaterialSelectionSource,
  ) {
    setMaterial(selectedMaterial)
    if (category === 'pipe' && selectedVariant?.pipe_type === 'wire') {
      setVariant(null)
      invalidateCalculation()
      toast.info('Проволока добавляется прежней кнопкой «Добавить проволоку»')
      return
    }
    setVariant(source === 'existing_variant' ? selectedVariant ?? null : null)
    invalidateCalculation()
  }

  function updateSegmentRow(id: string, patch: Partial<LongStockSegmentRow>) {
    setSegmentRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    invalidateCalculation()
  }

  function addSegmentRow() {
    const id = `segment-row-${nextSegmentRow.current}`
    nextSegmentRow.current += 1
    setSegmentRows((current) => [...current, { id, lengthMm: '', quantity: 1 }])
    invalidateCalculation()
  }

  function removeSegmentRow(id: string) {
    setSegmentRows((current) => current.filter((row) => row.id !== id))
    invalidateCalculation()
  }

  async function prepareDraft(segments: LongStockPlanSegmentInput[]) {
    if (!material || !variant) throw new Error('Выберите точный вариант материала')
    const data = requestItemData(category, material, variant, totalLongStockSegmentLength(segments), segments.length)
    const draft = draftRef.current
    if (draft) {
      const result = draft.table === 'request_circle'
        ? await updateCircle(draft.id, data)
        : draft.table === 'request_pipe'
          ? await updatePipe(draft.id, data)
          : await updateKnife(draft.id, data)
      if (!result.success) throw new Error(result.error || 'Не удалось обновить черновик позиции')
      if (result.data) draft.row = result.data as CreatedRow
      return draft
    }

    const result = config.table === 'request_circle'
      ? await addCircle(requestId, data)
      : config.table === 'request_pipe'
        ? await addPipe(requestId, data)
        : await addKnife(requestId, data)
    if (!result.success || !result.data) throw new Error(result.error || 'Не удалось создать черновик позиции')
    const created = { table: config.table, id: String((result.data as { id: string }).id), row: result.data as CreatedRow }
    draftRef.current = created
    return created
  }

  async function runCalculation(mode: LongStockPlanCalculationMode) {
    setPendingAction(mode === 'with_nonstandard' ? 'optimal' : mode === 'mixed' ? 'mixed' : 'calculate')
    setError(null)
    try {
      const segments = expandLongStockSegmentRows(segmentRows)
      const draft = await prepareDraft(segments)
      const result = await calculateLongStockCuttingPlan({
        requestItem: { table: draft.table, id: draft.id },
        segments,
        mode,
      })
      const nextMixed = mode === 'mixed'
      const nextCandidates = candidatesForMode(result.candidates, nextMixed)
      setMixedLengths(nextMixed)
      setNonstandardLengths(mode !== 'standard')
      setCalculation(result)
      setSelectedCandidateKey(nextCandidates[0]?.key ?? null)
      setManualMode(false)
      setManualBars([])
      if (nextCandidates.length === 0) setError('Для заданных отрезков подходящая раскладка не найдена')
    } catch (calculationError) {
      const message = errorMessage(calculationError, 'Не удалось рассчитать раскладку')
      setError(message)
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
  }

  async function toggleMixedLengths(checked: boolean) {
    if (!calculation) {
      setMixedLengths(checked)
      return
    }
    await runCalculation(checked ? 'mixed' : nonstandardLengths ? 'with_nonstandard' : 'standard')
  }

  function chooseCandidate(candidate: LongStockCuttingCandidate) {
    setSelectedCandidateKey(candidate.key)
    setManualMode(false)
    setManualBars([])
    setError(null)
  }

  function toggleManualMode() {
    if (!selectedCandidate) return
    if (manualMode) {
      setManualMode(false)
      setManualBars([])
      return
    }
    setManualBars(candidateToManualBars(selectedCandidate))
    setManualMode(true)
  }

  async function approve() {
    if (!calculation || !selectedCandidate || !draftRef.current) return
    setPendingAction('approve')
    setError(null)
    try {
      const input: LongStockPlanCalculationInput = {
        requestItem: { table: draftRef.current.table, id: draftRef.current.id },
        segments: expandLongStockSegmentRows(segmentRows),
        mode: mixedLengths ? 'mixed' : nonstandardLengths ? 'with_nonstandard' : 'standard',
      }
      let version: { id: string }
      if (manualMode) {
        const reason = manualReasonValue(manualReason, manualReasonText)
        version = await createManualLongStockCuttingPlanVersion({ ...input, bars: manualBars, reason })
      } else {
        version = await createLongStockCuttingPlanVersion({
          ...input,
          selectedCandidateKey: selectedCandidate.key,
        })
      }
      await approveLongStockCuttingPlanVersion(version.id)
      const created = {
        ...draftRef.current.row,
        materials: material ? { id: material.id, name: material.name } : null,
      } as CreatedRow
      draftRef.current = null
      onCreated(created)
      toast.success('Позиция и раскладка утверждены')
      reset()
      onOpenChange(false)
    } catch (approvalError) {
      const message = errorMessage(approvalError, 'Не удалось утвердить позицию')
      setError(message)
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
  }

  async function close() {
    if (pendingAction) return
    setPendingAction('close')
    setError(null)
    try {
      const draft = draftRef.current
      if (draft) {
        const result = draft.table === 'request_circle'
          ? await deleteCircle(draft.id)
          : draft.table === 'request_pipe'
            ? await deletePipe(draft.id)
            : await deleteKnife(draft.id)
        if (!result.success) throw new Error(result.error || 'Не удалось удалить черновик позиции')
        draftRef.current = null
      }
      reset()
      onOpenChange(false)
    } catch (closeError) {
      const message = errorMessage(closeError, 'Не удалось закрыть окно')
      setError(message)
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
  }

  function reset() {
    nextSegmentRow.current = 2
    setMaterial(null)
    setVariant(null)
    setSegmentRows([{ id: 'segment-row-1', lengthMm: '', quantity: 1 }])
    setCalculation(null)
    setSelectedCandidateKey(null)
    setMixedLengths(false)
    setNonstandardLengths(false)
    setManualMode(false)
    setManualBars([])
    setManualReason('')
    setManualReasonText('')
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) void close() }}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[94vh] w-[min(1180px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogHeader className="border-b bg-slate-50/80 px-5 py-4 pr-16">
          <DialogTitle className="flex items-center gap-2 text-lg text-[#1B3A6B]">
            <Ruler className="size-5" />{config.title}
          </DialogTitle>
          <DialogDescription>
            Выберите точный вариант, задайте отрезки и утвердите подходящую раскладку хлыстов.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <section aria-labelledby={`${category}-material-title`} className="grid gap-4 rounded-xl border bg-white p-4 lg:grid-cols-[minmax(300px,1fr)_minmax(320px,1fr)]">
            <div className="space-y-2">
              <Label id={`${category}-material-title`}>Материал и точный вариант</Label>
              <MaterialSearch
                category={config.searchCategory}
                value={material?.name ?? ''}
                selectedMaterialId={material?.id}
                placeholder="Начните вводить материал..."
                onSelect={selectMaterial}
                onQueryChange={(query) => {
                  if (query === material?.name) return
                  setVariant(null)
                  invalidateCalculation()
                }}
              />
              {!exactVariantReady && (
                <p className="flex items-start gap-2 text-xs leading-5 text-amber-700" role="status">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {category === 'pipe' && variant?.pipe_type === 'wire'
                    ? 'Проволока остаётся в прежнем интерфейсе.'
                    : 'Расчёт доступен только после выбора конкретного варианта материала.'}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-dashed bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Выбранный вариант</div>
              {variant && material ? (
                <div className="mt-2">
                  <div className="font-medium text-slate-900">{material.name}</div>
                  <div className="mt-1 text-sm text-slate-600">{variantSummary(category, variant)}</div>
                  {category === 'knives' && (
                    <Badge variant="secondary" className="mt-2">Скос входит в вариант</Badge>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Вариант ещё не выбран</p>
              )}
            </div>
          </section>

          <section aria-labelledby={`${category}-segments-title`} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id={`${category}-segments-title`} className="font-semibold text-slate-900">Отрезки</h3>
                <p className="mt-1 text-sm text-slate-500">Каждая строка: длина в миллиметрах × количество.</p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addSegmentRow}>
                <Plus className="size-4" />Добавить строку
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {segmentRows.map((row, index) => (
                <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)_36px] items-end gap-2 sm:max-w-xl">
                  <div className="space-y-1">
                    <Label htmlFor={`${row.id}-length`} className="text-xs">Длина, мм</Label>
                    <Input
                      id={`${row.id}-length`}
                      type="number"
                      min="0.001"
                      step="any"
                      inputMode="decimal"
                      value={row.lengthMm}
                      onChange={(event) => updateSegmentRow(row.id, { lengthMm: event.target.value })}
                    />
                  </div>
                  <div className="pb-2 text-center text-slate-400" aria-hidden="true">×</div>
                  <div className="space-y-1">
                    <Label htmlFor={`${row.id}-quantity`} className="text-xs">Количество</Label>
                    <Input
                      id={`${row.id}-quantity`}
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={row.quantity}
                      onChange={(event) => updateSegmentRow(row.id, { quantity: event.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={segmentRows.length === 1}
                    onClick={() => removeSegmentRow(row.id)}
                    aria-label={`Удалить строку отрезков ${index + 1}`}
                  >
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
            {segmentValidation.error && <p className="mt-3 text-xs text-amber-700">{segmentValidation.error}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
              <Button type="button" disabled={!canCalculate} onClick={() => void runCalculation(mixedLengths ? 'mixed' : nonstandardLengths ? 'with_nonstandard' : 'standard')}>
                {pendingAction === 'calculate' || pendingAction === 'mixed' ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
                {pendingAction === 'calculate' || pendingAction === 'mixed' ? 'Расчёт…' : 'Рассчитать'}
              </Button>
              <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
                <Checkbox
                  checked={mixedLengths}
                  disabled={Boolean(pendingAction) || (!canCalculate && !calculation)}
                  onCheckedChange={(checked) => void toggleMixedLengths(checked === true)}
                />
                Смешивать стандартные длины
              </label>
              {exactVariantReady && segmentValidation.error && (
                <span className="text-xs text-slate-500">Исправьте строки отрезков, чтобы запустить расчёт.</span>
              )}
            </div>
          </section>

          {calculation && (
            <section aria-labelledby={`${category}-results-title`} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 id={`${category}-results-title`} className="font-semibold text-slate-900">
                    {mixedLengths ? 'Комбинации длин' : 'Варианты стандартных длин'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Сначала показана минимальная закупаемая длина.</p>
                </div>
                {!mixedLengths && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(pendingAction) || nonstandardLengths}
                    onClick={() => void runCalculation('with_nonstandard')}
                  >
                    {pendingAction === 'optimal' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    {nonstandardLengths ? 'Нестандартные добавлены' : 'Подобрать оптимальную длину'}
                  </Button>
                )}
              </div>

              {visibleCandidates.length > 0 ? mixedLengths ? (
                <MixedCandidateList
                  candidates={visibleCandidates}
                  selectedKey={selectedCandidateKey}
                  bestKey={bestCandidateKey}
                  weightPerMeterKg={calculation.weightPerMeterKg}
                  onSelect={chooseCandidate}
                />
              ) : (
                <CandidateMatrix
                  candidates={visibleCandidates}
                  selectedKey={selectedCandidateKey}
                  bestKey={bestCandidateKey}
                  weightPerMeterKg={calculation.weightPerMeterKg}
                  onSelect={chooseCandidate}
                />
              ) : (
                <Alert>
                  <AlertTriangle />
                  <AlertTitle>Комбинации не найдены</AlertTitle>
                  <AlertDescription>Для этих отрезков смешанная раскладка не улучшает или не образует комбинацию длин.</AlertDescription>
                </Alert>
              )}

              {showOptimizationHint && (
                <Alert className="border-amber-200 bg-amber-50/70">
                  <Sparkles className="text-amber-700" />
                  <AlertTitle>Можно уменьшить излишек</AlertTitle>
                  <AlertDescription>
                    излишек {formatPercent(wastePercent)}, можно подобрать длину точнее
                  </AlertDescription>
                </Alert>
              )}

              {selectedCandidate && (
                <div className="space-y-4 rounded-xl border bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-900">Раскладка по хлыстам</h4>
                      <p className="mt-1 text-sm text-slate-500">Полоса показывает длины пропорционально; номера совпадают с последовательностью резов.</p>
                    </div>
                    <Button type="button" variant={manualMode ? 'secondary' : 'outline'} onClick={toggleManualMode}>
                      <Wrench className="size-4" />{manualMode ? 'Отменить ручную правку' : 'Ручная корректировка'}
                    </Button>
                  </div>
                  {selectedCandidate.searchComplete === false && (
                    <Alert className="border-amber-200 bg-amber-50/70">
                      <AlertTriangle className="text-amber-700" />
                      <AlertTitle>Решение неполное</AlertTitle>
                      <AlertDescription>Бюджет поиска исчерпан. Вариант можно изучить, но сервер разрешит утвердить только полное решение.</AlertDescription>
                    </Alert>
                  )}
                  {manualMode ? (
                    <ManualLayoutEditor
                      bars={manualBars}
                      segments={segmentValidation.segments}
                      calculation={calculation}
                      mode={mixedLengths ? 'mixed' : nonstandardLengths ? 'with_nonstandard' : 'standard'}
                      reason={manualReason}
                      reasonText={manualReasonText}
                      onBarsChange={setManualBars}
                      onReasonChange={setManualReason}
                      onReasonTextChange={setManualReasonText}
                    />
                  ) : (
                    <LayoutPreview candidate={selectedCandidate} calculation={calculation} />
                  )}
                </div>
              )}
            </section>
          )}

          {error && (
            <Alert variant="destructive" role="alert" aria-live="assertive">
              <CircleAlert />
              <AlertTitle>Проверьте раскладку</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-5 py-4">
          <Button type="button" variant="outline" disabled={Boolean(pendingAction)} onClick={() => void close()}>
            {pendingAction === 'close' && <Loader2 className="size-4 animate-spin" />}Отмена
          </Button>
          <Button
            type="button"
            disabled={!selectedCandidate || (!manualMode && !selectedCandidate.searchComplete) || Boolean(pendingAction) || (manualMode && !manualReasonReady(manualReason, manualReasonText))}
            onClick={() => void approve()}
          >
            {pendingAction === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
            {pendingAction === 'approve' ? 'Утверждение…' : 'Утвердить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CandidateMatrix({
  candidates,
  selectedKey,
  bestKey,
  weightPerMeterKg,
  onSelect,
}: {
  candidates: LongStockCuttingCandidate[]
  selectedKey: string | null
  bestKey: string | null
  weightPerMeterKg: number | null
  onSelect: (candidate: LongStockCuttingCandidate) => void
}) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="min-w-[820px] w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Длина хлыста</th>
            <th className="px-4 py-3 text-right">Хлыстов</th>
            <th className="px-4 py-3 text-right">Закупаемая длина</th>
            <th className="px-4 py-3 text-right">Излишек, мм</th>
            <th className="px-4 py-3 text-right">Излишек, кг</th>
            <th className="w-10 px-4 py-3"><span className="sr-only">Раскрыть</span></th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const selected = candidate.key === selectedKey
            const best = candidate.key === bestKey
            return (
              <tr
                key={candidate.key}
                className={cn(
                  'cursor-pointer border-t transition-colors hover:bg-blue-50/60',
                  best && 'bg-emerald-50/70',
                  selected && 'bg-blue-50 ring-2 ring-inset ring-blue-500',
                )}
                onClick={() => onSelect(candidate)}
              >
                <td className="px-4 py-3">
                  <label className="flex cursor-pointer items-center gap-3 font-medium text-slate-900">
                    <input type="radio" name="long-stock-candidate" checked={selected} onChange={() => onSelect(candidate)} />
                    <span>{candidatePurchaseLengthLabel(candidate)}</span>
                    {best && <Badge className="bg-emerald-700 text-white"><Check />Лучший</Badge>}
                    {candidate.usesNonstandardLength && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700"><Sparkles />Нестандартная</Badge>}
                    {!candidate.searchComplete && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Неполное</Badge>}
                  </label>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{candidate.newBarCount}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMm(candidate.purchasedLengthMm)} мм</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMm(candidate.totalRemainderMm)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatKg(remainderWeight(candidate, weightPerMeterKg))}</td>
                <td className="px-4 py-3"><ChevronRight className={cn('size-4 text-slate-400', selected && 'rotate-90 text-blue-600')} /></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MixedCandidateList({
  candidates,
  selectedKey,
  bestKey,
  weightPerMeterKg,
  onSelect,
}: {
  candidates: LongStockCuttingCandidate[]
  selectedKey: string | null
  bestKey: string | null
  weightPerMeterKg: number | null
  onSelect: (candidate: LongStockCuttingCandidate) => void
}) {
  return (
    <div className="space-y-2">
      {candidates.map((candidate) => {
        const selected = candidate.key === selectedKey
        const best = candidate.key === bestKey
        return (
          <button
            key={candidate.key}
            type="button"
            onClick={() => onSelect(candidate)}
            className={cn(
              'grid w-full gap-3 rounded-xl border bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 md:grid-cols-[minmax(0,1fr)_repeat(3,auto)] md:items-center',
              best && 'border-emerald-300 bg-emerald-50/70',
              selected && 'ring-2 ring-blue-500',
            )}
          >
            <span>
              <span className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                {candidateComposition(candidate)}
                {best && <Badge className="bg-emerald-700 text-white"><Check />Лучший</Badge>}
                {candidate.usesNonstandardLength && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700"><Sparkles />Есть нестандартная</Badge>}
                {!candidate.searchComplete && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">Решение неполное</Badge>}
              </span>
            </span>
            <Metric label="Закупка" value={`${formatMm(candidate.purchasedLengthMm)} мм`} />
            <Metric label="Излишек" value={`${formatMm(candidate.totalRemainderMm)} мм`} />
            <Metric label="Излишек" value={formatWeight(remainderWeight(candidate, weightPerMeterKg))} />
          </button>
        )
      })}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <span className="text-sm"><span className="block text-xs text-slate-500">{label}</span><span className="font-medium tabular-nums text-slate-800">{value}</span></span>
}

function LayoutPreview({ candidate, calculation }: { candidate: LongStockCuttingCandidate; calculation: Calculation }) {
  return (
    <div className="space-y-4">
      {candidate.bars.map((bar) => (
        <div key={bar.barNumber} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              Хлыст №{bar.barNumber}
              <Badge variant="outline">{formatMm(bar.stockLengthMm)} мм</Badge>
              {bar.source === 'business_remnant' && <Badge variant="secondary">Со склада</Badge>}
              {bar.purchaseLengthKind === 'nonstandard' && <Badge variant="outline" className="border-violet-200 text-violet-700">Нестандартный</Badge>}
            </div>
            <span className="text-sm text-slate-600">Остаток: <strong>{formatMm(bar.remainderMm)} мм</strong></span>
          </div>
          <BarStrip
            stockLengthMm={bar.stockLengthMm}
            cuts={bar.cuts}
            remainderMm={bar.remainderMm}
            kerfMm={calculation.settingsSnapshot.kerf_mm}
            endTrimMm={calculation.settingsSnapshot.end_trim_mm}
          />
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {bar.cuts.map((cut) => (
              <li key={cut.workpieceId}>Рез {cut.cutNumber}: <span className="font-medium">{formatMm(cut.lengthMm)} мм</span> <span className="text-slate-400">({cut.workpieceId})</span></li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

function BarStrip({
  stockLengthMm,
  cuts,
  remainderMm,
  kerfMm,
  endTrimMm,
}: {
  stockLengthMm: number
  cuts: Array<{ cutNumber: number; workpieceId: string; lengthMm: number }>
  remainderMm: number
  kerfMm: number
  endTrimMm: number
}) {
  return (
    <div className="mt-3 flex h-12 w-full overflow-hidden rounded-md border border-slate-300 bg-slate-100" aria-label={`Пропорциональная раскладка хлыста ${formatMm(stockLengthMm)} мм`}>
      {endTrimMm > 0 && <div className="bg-slate-400" style={{ width: `${endTrimMm / stockLengthMm * 100}%` }} title={`Торцовка ${formatMm(endTrimMm)} мм`} />}
      {cuts.map((cut, index) => (
        <span key={cut.workpieceId} className="contents">
          <span
            className={cn('flex min-w-0 items-center justify-center overflow-hidden border-l border-white/70 px-1 text-[11px] font-semibold text-white', CUT_COLORS[index % CUT_COLORS.length])}
            style={{ width: `${cut.lengthMm / stockLengthMm * 100}%` }}
            title={`Рез ${cut.cutNumber}: ${formatMm(cut.lengthMm)} мм`}
          >
            <span className="truncate">№{cut.cutNumber} · {formatMm(cut.lengthMm)}</span>
          </span>
          {kerfMm > 0 && <span className="bg-slate-900" style={{ width: `${kerfMm / stockLengthMm * 100}%` }} title={`Пропил ${formatMm(kerfMm)} мм`} />}
        </span>
      ))}
      <span
        className="flex min-w-0 items-center justify-center overflow-hidden border-l border-slate-300 bg-emerald-100 px-1 text-[11px] font-medium text-emerald-900"
        style={{ width: `${Math.max(remainderMm, 0) / stockLengthMm * 100}%` }}
        title={`Остаток ${formatMm(remainderMm)} мм`}
      >
        <span className="truncate">остаток {formatMm(remainderMm)}</span>
      </span>
    </div>
  )
}

function ManualLayoutEditor({
  bars,
  segments,
  calculation,
  mode,
  reason,
  reasonText,
  onBarsChange,
  onReasonChange,
  onReasonTextChange,
}: {
  bars: LongStockManualBarInput[]
  segments: LongStockPlanSegmentInput[]
  calculation: Calculation
  mode: LongStockPlanCalculationMode
  reason: string
  reasonText: string
  onBarsChange: (bars: LongStockManualBarInput[]) => void
  onReasonChange: (reason: string) => void
  onReasonTextChange: (text: string) => void
}) {
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
  const category = calculation.settingsSnapshot.categories.find((entry) => entry.key === calculation.layoutCategoryKey)
  const purchaseLengths = [
    ...(category?.standard_lengths ?? []).map((lengthMm) => ({ lengthMm, kind: 'standard' as const })),
    ...((mode === 'standard' ? [] : category?.nonstandard_lengths) ?? []).map((lengthMm) => ({ lengthMm, kind: 'nonstandard' as const })),
  ].sort((left, right) => left.lengthMm - right.lengthMm)

  function updateBar(barIndex: number, update: (bar: LongStockManualBarInput) => LongStockManualBarInput) {
    onBarsChange(bars.map((bar, index) => index === barIndex ? update(bar) : bar))
  }

  function setBarLength(barIndex: number, value: number) {
    const option = purchaseLengths.find((length) => length.lengthMm === value)
    if (!option) return
    updateBar(barIndex, (bar) => ({ ...bar, stockLengthMm: value, purchaseLengthKind: option.kind }))
  }

  function addBar() {
    const option = purchaseLengths[0]
    if (!option) return
    onBarsChange([...bars, {
      source: 'new_stock',
      purchaseLengthKind: option.kind,
      stockLengthMm: option.lengthMm,
      cuts: [],
    }])
  }

  function deleteBar(barIndex: number) {
    if (bars[barIndex]?.cuts.length) {
      toast.error(`Сначала перенесите резы из хлыста №${barIndex + 1}`)
      return
    }
    onBarsChange(bars.filter((_, index) => index !== barIndex))
  }

  function moveCut(barIndex: number, cutIndex: number, direction: 'up' | 'down' | 'previous' | 'next') {
    const next = bars.map((bar) => ({ ...bar, cuts: [...bar.cuts] }))
    const [cut] = next[barIndex].cuts.splice(cutIndex, 1)
    if (!cut) return
    if (direction === 'up' || direction === 'down') {
      const targetIndex = direction === 'up' ? Math.max(0, cutIndex - 1) : Math.min(next[barIndex].cuts.length, cutIndex + 1)
      next[barIndex].cuts.splice(targetIndex, 0, cut)
    } else {
      const targetBar = direction === 'previous' ? barIndex - 1 : barIndex + 1
      if (!next[targetBar]) {
        next[barIndex].cuts.splice(cutIndex, 0, cut)
        return
      }
      next[targetBar].cuts.push(cut)
    }
    onBarsChange(next)
  }

  return (
    <div className="space-y-4">
      <Alert className="border-blue-200 bg-blue-50/60">
        <Wrench className="text-blue-700" />
        <AlertTitle>Ручная корректировка</AlertTitle>
        <AlertDescription>Меняйте порядок резов, переносите их между хлыстами или добавляйте новый хлыст. Сервер повторно проверит все длины.</AlertDescription>
      </Alert>
      <div className="space-y-3">
        {bars.map((bar, barIndex) => {
          const cutLengths = bar.cuts.map((cut) => segmentById.get(cut.workpieceId)?.lengthMm ?? 0)
          const remainder = calculateLongStockBarRemainder(
            bar.stockLengthMm,
            cutLengths,
            calculation.settingsSnapshot.kerf_mm,
            calculation.settingsSnapshot.end_trim_mm,
          )
          return (
            <div key={`${bar.source}-${bar.businessRemnantId ?? 'new'}-${barIndex}`} className={cn('rounded-lg border p-3', remainder < 0 && 'border-red-300 bg-red-50/50')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  Хлыст №{barIndex + 1}
                  {bar.source === 'business_remnant' ? (
                    <Badge variant="secondary">{formatMm(bar.stockLengthMm)} мм · со склада</Badge>
                  ) : (
                    <label className="flex items-center gap-2 text-sm font-normal">
                      <span className="text-slate-500">Длина</span>
                      <select
                        value={bar.stockLengthMm}
                        onChange={(event) => setBarLength(barIndex, Number(event.target.value))}
                        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                        aria-label={`Длина хлыста №${barIndex + 1}`}
                      >
                        {purchaseLengths.map((option) => (
                          <option key={`${option.kind}-${option.lengthMm}`} value={option.lengthMm}>
                            {formatMm(option.lengthMm)} мм{option.kind === 'nonstandard' ? ' · нестандартная' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-sm', remainder < 0 ? 'font-semibold text-red-700' : 'text-slate-600')}>
                    {remainder < 0 ? `превышение ${formatMm(-remainder)} мм` : `остаток ${formatMm(remainder)} мм`}
                  </span>
                  {bar.source === 'new_stock' && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => deleteBar(barIndex)} aria-label={`Удалить хлыст №${barIndex + 1}`}>
                      <Trash2 className="size-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </div>
              {bar.cuts.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed p-3 text-sm text-amber-700">Хлыст пуст — перенесите сюда резы или удалите его.</p>
              ) : (
                <ol className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {bar.cuts.map((cut, cutIndex) => (
                    <li key={cut.workpieceId} className="flex items-center gap-2 rounded-md border bg-slate-50 p-2">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-medium">Рез {cutIndex + 1}</span>
                        <span className="ml-2 tabular-nums text-slate-600">{formatMm(segmentById.get(cut.workpieceId)?.lengthMm ?? 0)} мм</span>
                        <span className="block truncate text-xs text-slate-400">{cut.workpieceId}</span>
                      </span>
                      <span className="grid grid-cols-2 gap-0.5">
                        <MoveButton label="Выше" disabled={cutIndex === 0} onClick={() => moveCut(barIndex, cutIndex, 'up')}><ArrowUp /></MoveButton>
                        <MoveButton label="Ниже" disabled={cutIndex === bar.cuts.length - 1} onClick={() => moveCut(barIndex, cutIndex, 'down')}><ArrowDown /></MoveButton>
                        <MoveButton label="В предыдущий хлыст" disabled={barIndex === 0} onClick={() => moveCut(barIndex, cutIndex, 'previous')}><ArrowLeft /></MoveButton>
                        <MoveButton label="В следующий хлыст" disabled={barIndex === bars.length - 1} onClick={() => moveCut(barIndex, cutIndex, 'next')}><ArrowRight /></MoveButton>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )
        })}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addBar} disabled={purchaseLengths.length === 0}>
        <Plus className="size-4" />Добавить хлыст
      </Button>
      <div className="grid gap-4 rounded-lg border bg-slate-50 p-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="manual-layout-reason">Причина ручной корректировки *</Label>
          <select
            id="manual-layout-reason"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            required
          >
            <option value="">— выберите причину —</option>
            {MANUAL_REASONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="manual-layout-comment">{reason === 'other' ? 'Описание причины *' : 'Комментарий'}</Label>
          {reason === 'other' ? (
            <Textarea id="manual-layout-comment" value={reasonText} onChange={(event) => onReasonTextChange(event.target.value)} placeholder="Опишите причину" />
          ) : (
            <Input id="manual-layout-comment" value={reasonText} onChange={(event) => onReasonTextChange(event.target.value)} placeholder="Необязательно" />
          )}
        </div>
      </div>
    </div>
  )
}

function MoveButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label} className="flex size-6 items-center justify-center rounded hover:bg-slate-200 disabled:opacity-25 [&_svg]:size-3.5">
      {children}
    </button>
  )
}

const CUT_COLORS = ['bg-blue-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600', 'bg-sky-600']

function candidatesForMode(candidates: LongStockCuttingCandidate[], mixed: boolean) {
  return candidates
    .filter((candidate) => mixed ? candidate.kind === 'mixed_lengths' : candidate.kind !== 'mixed_lengths')
    .sort((left, right) => left.purchasedLengthMm - right.purchasedLengthMm || left.newBarCount - right.newBarCount)
}

function requestItemData(
  category: Category,
  material: MaterialWithSupplier,
  variant: MaterialVariant,
  totalLengthMm: number,
  pieceCount: number,
) {
  const common = {
    material_id: material.id,
    material_variant_id: variant.id,
    is_custom_material_variant: false,
  }
  if (category === 'circle') {
    return {
      ...common,
      diameter_mm: variant.diameter_mm,
      steel_grade: variant.material_grade ?? material.comment,
      steel_type_id: variant.steel_type_id,
      is_calibrated: variant.is_calibrated ?? false,
      remainder_mm: totalLengthMm,
    }
  }
  if (category === 'pipe') {
    if (!variant.pipe_type || variant.pipe_type === 'wire') throw new Error('Выберите вариант трубы, кроме проволоки')
    return {
      ...common,
      pipe_type: variant.pipe_type,
      steel_type_id: variant.steel_type_id,
      size: variant.piece_description ?? variant.sheet_size,
      wall_thickness_mm: variant.wall_thickness_mm,
      diameter_mm: null,
      remainder_length_mm: totalLengthMm,
      remainder_qty: pieceCount,
      remainder_kg: 0,
    }
  }
  const dimensions = parseKnifeDimensions(variant)
  return {
    ...common,
    knife_type: material.name,
    steel_grade: variant.material_grade ?? variant.knife_material,
    steel_type_id: variant.steel_type_id,
    length_mm: dimensions.lengthMm,
    width_mm: dimensions.widthMm,
    height_mm: dimensions.heightMm,
    knife_bevel_count: parseKnifeBevelCount(variant.knife_bevel_count),
    remainder_meters: totalLengthMm / 1000,
    remainder_qty: pieceCount,
  }
}

function variantSummary(category: Category, variant: MaterialVariant) {
  if (category === 'circle') {
    return [
      variant.diameter_mm && `Ø${formatMm(variant.diameter_mm)} мм`,
      variant.material_grade,
      variant.is_calibrated ? 'калиброванный' : null,
    ].filter(Boolean).join(' · ') || 'Точный вариант'
  }
  if (category === 'pipe') {
    return [
      variant.pipe_type && PIPE_SUBTYPE_LABELS[variant.pipe_type],
      variant.piece_description,
      variant.wall_thickness_mm && `стенка ${formatMm(variant.wall_thickness_mm)} мм`,
      variant.material_grade,
    ].filter(Boolean).join(' · ') || 'Точный вариант'
  }
  const dimensions = variant.knife_dimensions || [variant.standard_length_mm, variant.width_mm, variant.height_mm].filter(Boolean).join('×')
  return [dimensions, variant.knife_material ?? variant.material_grade, knifeBevelLabel(variant.knife_bevel_count)].filter(Boolean).join(' · ') || 'Точный вариант'
}

function parseKnifeDimensions(variant: MaterialVariant) {
  const parsed = String(variant.knife_dimensions ?? '')
    .trim()
    .toLowerCase()
    .replace(/[х×*]/g, 'x')
    .split('x')
    .map((part) => Number(part.trim().replace(',', '.')))
  return {
    lengthMm: variant.standard_length_mm ?? (Number.isFinite(parsed[0]) ? parsed[0] : null),
    widthMm: variant.width_mm ?? (Number.isFinite(parsed[1]) ? parsed[1] : null),
    heightMm: variant.height_mm ?? (Number.isFinite(parsed[2]) ? parsed[2] : null),
  }
}

function remainderWeight(candidate: LongStockCuttingCandidate, weightPerMeterKg: number | null) {
  const weight = Number(weightPerMeterKg)
  return Number.isFinite(weight) && weight >= 0 ? candidate.totalRemainderMm / 1000 * weight : null
}

function formatWeight(value: number | null) {
  return value === null ? '—' : `${formatKg(value)} кг`
}

function manualReasonReady(reason: string, text: string) {
  return Boolean(reason && (reason !== 'other' || text.trim()))
}

function manualReasonValue(reason: string, text: string) {
  if (!manualReasonReady(reason, text)) {
    throw new Error(reason === 'other' ? 'Для причины «Другое» обязательно описание' : 'Выберите причину ручной корректировки')
  }
  const label = MANUAL_REASONS.find((option) => option.value === reason)?.label
  return `${label}${text.trim() ? `: ${text.trim()}` : ''}`
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)}%`
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
