'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BadgeCheck,
  Boxes,
  Calculator,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardPenLine,
  Loader2,
  Plus,
  RotateCcw,
  Ruler,
  ShoppingCart,
  Sparkles,
  TableProperties,
  Trash2,
  Truck,
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
import { LongStockCandidateList, LongStockCandidateSummary } from './LongStockCandidateList'
import {
  approveLongStockRecalculationSafe,
  approveLongStockCuttingPlanVersion,
  calculateLongStockRecalculationSafe,
  calculateLongStockCuttingPlan,
  createLongStockMaterialVariant,
  createLongStockCuttingPlanVersion,
  createManualLongStockCuttingPlanVersion,
  loadLongStockPlanningRecoveryDraft,
  loadLongStockRecalculationSafe,
  loadLongStockSourceOptions,
  prepareLongStockRequestItemDraft,
  type LongStockPlanningRecoveryDraft,
  type LongStockRecalculationDraft,
  type LongStockSourceOption,
} from '@/lib/actions/long-stock-cutting-plans'
import type { MaterialWithSupplier } from '@/lib/actions/materials'
import {
  deleteCircle,
  deleteKnife,
  deletePipe,
  type WithMaterialName,
} from '@/lib/actions/technologist-requests'
import { PIPE_SUBTYPE_LABELS } from '@/lib/constants/procurement'
import {
  candidateMaterialBreakdown,
  candidatePurchaseLengthLabel,
  candidateRemainderPreview,
  candidateToManualBars,
  candidateWastePercent,
  candidatesForLongStockMode,
  cutDisplayLabel,
  DEFAULT_MIXED_LONG_STOCK_LENGTHS,
  expandLongStockSegmentRows,
  formatKg,
  formatLongStockComposition,
  formatMm,
  mergeRefreshedLongStockSources,
  longStockCutColorMap,
  longStockBarSourceLabel,
  longStockNewBarOrigin,
  shouldShowBarSegmentLabel,
  totalLongStockSegmentLength,
  type LongStockSegmentRow,
} from '@/lib/long-stock-position-ui'
import {
  createLongStockMaterialDraft,
  validateLongStockDialogAction,
  type LongStockNewMaterialDraft,
} from '@/lib/long-stock-material-draft'
import { KNIFE_BEVEL_OPTIONS, knifeBevelCharacteristicLabel } from '@/lib/materials/knife-bevel'
import { formatKnifeProfileDimensions } from '@/lib/materials/knife-profile'
import { roundPipeOuterDiameterMm } from '@/lib/materials/pipe-profile'
import {
  DEFAULT_LONG_STOCK_SEARCH_BUDGET,
  EXTENDED_LONG_STOCK_SEARCH_BUDGET,
  calculateLongStockBarRemainder,
  type LongStockCuttingCandidate,
} from '@/lib/long-stock-cutting-solver'
import type {
  LongStockManualBarInput,
  LongStockPlanCalculationInput,
  LongStockPlanCalculationMode,
  LongStockPlanSegmentInput,
  LongStockRequestItemTable,
  LongStockSourceSelection,
} from '@/lib/long-stock-cutting-plan'
import type { MaterialVariant, RequestCircle, RequestKnives, RequestPipe } from '@/lib/types'
import type { SteelType } from '@/lib/types/database'
import { cn } from '@/lib/utils'
import { MaterialSearch, type MaterialSelectionSource } from './MaterialSearch'

type Category = 'circle' | 'pipe' | 'knives'
type Calculation = Awaited<ReturnType<typeof calculateLongStockCuttingPlan>>
type CreatedRow = WithMaterialName<RequestCircle> | WithMaterialName<RequestPipe> | WithMaterialName<RequestKnives>

type Props = {
  category: Category
  requestId: string
  steelTypes: SteelType[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (row: CreatedRow) => void
}

type RecalculationDialogProps = {
  requestItem: { table: LongStockRequestItemTable; id: string }
  open: boolean
  onOpenChange: (open: boolean) => void
  onApproved?: () => void
}

type DraftItem = {
  table: LongStockRequestItemTable
  id: string
  row: CreatedRow
  materialVariantId: string
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

export function LongStockPositionDialog({ category, requestId, steelTypes, open, onOpenChange, onCreated }: Props) {
  const config = CATEGORY_CONFIG[category]
  const nextSegmentRow = useRef(2)
  const draftRef = useRef<DraftItem | null>(null)
  const [material, setMaterial] = useState<MaterialWithSupplier | null>(null)
  const [variant, setVariant] = useState<MaterialVariant | null>(null)
  const [newMaterialDraft, setNewMaterialDraft] = useState<LongStockNewMaterialDraft | null>(null)
  const [segmentRows, setSegmentRows] = useState<LongStockSegmentRow[]>([
    { id: 'segment-row-1', lengthMm: '', quantity: 1 },
  ])
  const [calculation, setCalculation] = useState<Calculation | null>(null)
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)
  const [mixedLengths, setMixedLengths] = useState(DEFAULT_MIXED_LONG_STOCK_LENGTHS)
  const [nonstandardLengths, setNonstandardLengths] = useState(false)
  const [manualMode, setManualMode] = useState(false)
  const [showCuttingMatrix, setShowCuttingMatrix] = useState(false)
  const [manualBars, setManualBars] = useState<LongStockManualBarInput[]>([])
  const [manualReason, setManualReason] = useState('')
  const [manualReasonText, setManualReasonText] = useState('')
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [materialError, setMaterialError] = useState<string | null>(null)
  const [sourceOptions, setSourceOptions] = useState<LongStockSourceOption[]>([])
  const [sourceQuantities, setSourceQuantities] = useState<Record<string, number>>({})
  const [sourceSelectionCustomized, setSourceSelectionCustomized] = useState(false)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const sourceLoadGeneration = useRef(0)

  useEffect(() => {
    const generation = ++sourceLoadGeneration.current
    const materialId = material?.id
    const materialVariantId = variant?.id
    if (!materialId || !materialVariantId || (category === 'pipe' && variant?.pipe_type === 'wire')) {
      setSourceOptions([])
      setSourceQuantities({})
      setSourceSelectionCustomized(false)
      setSourceLoading(false)
      setSourceError(null)
      return
    }

    let cancelled = false
    setSourceLoading(true)
    setSourceError(null)
    setSourceOptions([])
    setSourceQuantities({})
    setSourceSelectionCustomized(false)
    void loadLongStockSourceOptions({ requestId, materialId, materialVariantId })
      .then((result) => {
        if (cancelled || generation !== sourceLoadGeneration.current) return
        setSourceOptions(result.sources)
      })
      .catch((loadError) => {
        if (cancelled || generation !== sourceLoadGeneration.current) return
        setSourceError(errorMessage(loadError, 'Не удалось загрузить источники хлыстов'))
      })
      .finally(() => {
        if (!cancelled && generation === sourceLoadGeneration.current) setSourceLoading(false)
      })
    return () => { cancelled = true }
  }, [category, material?.id, requestId, variant?.id, variant?.pipe_type])

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
    () => candidatesForLongStockMode(calculation?.candidates ?? [], mixedLengths),
    [calculation, mixedLengths],
  )
  const selectedCandidate = visibleCandidates.find((candidate) => candidate.key === selectedCandidateKey) ?? null
  const bestCandidateKey = visibleCandidates[0]?.key ?? null
  const wastePercent = selectedCandidate ? candidateWastePercent(selectedCandidate) : 0
  const threshold = Number(calculation?.settingsSnapshot.optimization_hint_threshold_percent ?? 0)
  const minimumUsefulLengthMm = calculation?.settingsSnapshot.categories
    .find((entry) => entry.key === calculation.layoutCategoryKey)?.minimum_useful_length_mm ?? 0
  const showOptimizationHint = Boolean(selectedCandidate && !mixedLengths && !nonstandardLengths && wastePercent > threshold)
  const exactVariantReady = Boolean(variant?.id && variant.category === category && !(category === 'pipe' && variant.pipe_type === 'wire'))
  const hasSourceConflict = sourceSelectionCustomized && Object.entries(sourceQuantities).some(([id, quantity]) => {
    if (quantity <= 0) return false
    const option = sourceOptions.find((source) => source.inventoryId === id)
    return !option?.available || quantity > option.availableQuantity
  })
  const canCalculate = exactVariantReady
    && segmentValidation.error === null
    && !sourceLoading
    && !sourceError
    && !hasSourceConflict
    && !pendingAction
  const selectedSteelTypeName = variant
    ? steelTypes.find((steelType) => steelType.id === variant.steel_type_id)?.name
      ?? (variant as MaterialVariant & { steel_types?: { name?: string | null } | null }).steel_types?.name
      ?? null
    : null

  function invalidateCalculation() {
    setCalculation(null)
    setSelectedCandidateKey(null)
    setManualMode(false)
    setShowCuttingMatrix(false)
    setManualBars([])
    setError(null)
  }

  function selectedStockSources(): LongStockSourceSelection[] | undefined {
    if (!sourceSelectionCustomized) return undefined
    return Object.entries(sourceQuantities).flatMap(([inventoryId, quantity]) =>
      quantity > 0 ? [{ inventoryId, quantity }] : [])
  }

  async function refreshSources() {
    invalidateCalculation()
    if (!material?.id || !variant?.id) return
    const generation = ++sourceLoadGeneration.current
    setSourceLoading(true)
    setSourceError(null)
    try {
      const refreshed = await loadLongStockSourceOptions({ requestId, materialId: material.id, materialVariantId: variant.id })
      if (generation !== sourceLoadGeneration.current) return
      // Keep the operator's choice visible even if the inventory row disappeared.
      setSourceOptions((previous) => mergeRefreshedLongStockSources(previous, refreshed.sources, sourceQuantities))
    } catch (loadError) {
      if (generation === sourceLoadGeneration.current) setSourceError(errorMessage(loadError, 'Не удалось обновить источники хлыстов'))
    } finally {
      if (generation === sourceLoadGeneration.current) setSourceLoading(false)
    }
  }

  function updateSourceQuantity(option: LongStockSourceOption, rawValue: string) {
    const parsed = rawValue === '' ? 0 : Number(rawValue)
    const quantity = Number.isFinite(parsed)
      ? Math.max(0, Math.min(option.availableQuantity, Math.floor(parsed)))
      : 0
    setSourceQuantities((current) => ({ ...current, [option.inventoryId]: quantity }))
    setSourceSelectionCustomized(true)
    invalidateCalculation()
  }

  function resetSourceRecommendation() {
    setSourceQuantities({})
    setSourceSelectionCustomized(false)
    invalidateCalculation()
  }

  function selectMaterial(
    selectedMaterial: MaterialWithSupplier,
    selectedVariant: MaterialVariant | undefined,
    source: MaterialSelectionSource,
  ) {
    setNewMaterialDraft(null)
    setMaterialError(null)
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

  function startCreateMaterial(name: string) {
    setMaterial(null)
    setVariant(null)
    setNewMaterialDraft(createLongStockMaterialDraft(name, category))
    setMaterialError(null)
    invalidateCalculation()
  }

  function updateNewMaterialField(field: string, value: string | boolean) {
    setNewMaterialDraft((current) => current ? {
      ...current,
      fields: field === 'pipe_type' && current.category === 'pipe' && current.fields.pipe_type !== value
        ? {
          ...current.fields,
          pipe_type: value,
          size: '',
          diameter_mm: '',
        }
        : { ...current.fields, [field]: value },
    } : current)
    setMaterialError(null)
  }

  async function saveNewMaterial() {
    if (!newMaterialDraft) return
    const validationError = validateLongStockDialogAction('create_material', { newMaterialDraft })
    if (validationError) {
      setMaterialError(validationError)
      return
    }
    setPendingAction('material')
    setMaterialError(null)
    try {
      const result = await createLongStockMaterialVariant(newMaterialDraft)
      setMaterial(result.material as MaterialWithSupplier)
      setVariant(result.variant as MaterialVariant)
      setNewMaterialDraft(null)
      toast.success('Материал и точный вариант добавлены')
    } catch (creationError) {
      const message = errorMessage(creationError, 'Не удалось создать материал')
      setMaterialError(message)
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
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
    let draft = draftRef.current
    if (draft && draft.materialVariantId !== variant.id) {
      const deletion = draft.table === 'request_circle'
        ? await deleteCircle(draft.id)
        : draft.table === 'request_pipe'
          ? await deletePipe(draft.id)
          : await deleteKnife(draft.id)
      if (!deletion.success) throw new Error(deletion.error || 'Не удалось заменить вариант черновика позиции')
      draftRef.current = null
      draft = null
    }
    const result = await prepareLongStockRequestItemDraft({
      requestId,
      requestItem: draft ? { table: draft.table, id: draft.id } : null,
      table: config.table,
      materialVariantId: variant.id,
      totalLengthMm: totalLongStockSegmentLength(segments),
      pieceCount: segments.length,
    })
    const prepared: DraftItem = {
      table: result.table,
      id: result.id,
      row: result.row as CreatedRow,
      materialVariantId: result.materialVariantId,
    }
    draftRef.current = prepared
    return prepared
  }

  async function runCalculation(
    mode: LongStockPlanCalculationMode,
    searchBudget = DEFAULT_LONG_STOCK_SEARCH_BUDGET,
    action: 'calculate' | 'longer' = 'calculate',
  ) {
    setPendingAction(action === 'longer'
      ? 'longer'
      : mode === 'with_nonstandard' ? 'optimal' : mode === 'mixed' ? 'mixed' : 'calculate')
    setError(null)
    setMaterialError(null)
    try {
      const prerequisiteError = validateLongStockDialogAction(mode, {
        materialVariantId: variant?.id,
        segmentError: segmentValidation.error,
      })
      if (prerequisiteError) throw new Error(prerequisiteError)
      const segments = expandLongStockSegmentRows(segmentRows)
      const draft = await prepareDraft(segments)
      const result = await calculateLongStockCuttingPlan({
        requestItem: { table: draft.table, id: draft.id },
        segments,
        stockSelection: selectedStockSources(),
        mode,
        searchBudget,
      })
      const nextMixed = mode === 'mixed'
      const nextCandidates = candidatesForLongStockMode(result.candidates, nextMixed)
      setMixedLengths(nextMixed)
      setNonstandardLengths(mode === 'with_nonstandard')
      setCalculation(result)
      setSelectedCandidateKey(nextCandidates[0]?.key ?? null)
      if (!sourceSelectionCustomized) {
        setSourceQuantities(Object.fromEntries(
          result.recommendedStockSelection.map((entry) => [entry.inventoryId, entry.quantity]),
        ))
        setSourceSelectionCustomized(true)
      }
      setManualMode(false)
      setShowCuttingMatrix(false)
      setManualBars([])
      if (nextCandidates.length === 0) setError('Для заданных отрезков подходящая раскладка не найдена')
    } catch (calculationError) {
      const message = errorMessage(calculationError, 'Не удалось рассчитать раскладку')
      if (isMaterialErrorMessage(message)) setMaterialError(message)
      else setError(message)
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

  async function searchLonger() {
    if (!calculation) return
    const mode = mixedLengths ? 'mixed' : nonstandardLengths ? 'with_nonstandard' : 'standard'
    const searchBudget = calculation.searchBudget < EXTENDED_LONG_STOCK_SEARCH_BUDGET
      ? EXTENDED_LONG_STOCK_SEARCH_BUDGET
      : Math.min(Number.MAX_SAFE_INTEGER, calculation.searchBudget * 2)
    await runCalculation(mode, searchBudget, 'longer')
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
        stockSelection: selectedStockSources(),
        mode: mixedLengths ? 'mixed' : nonstandardLengths ? 'with_nonstandard' : 'standard',
        searchBudget: calculation.searchBudget,
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
      await refreshSources()
      setError(`${message}. Проверьте обновлённые источники и выполните расчёт заново.`)
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
    setNewMaterialDraft(null)
    setSegmentRows([{ id: 'segment-row-1', lengthMm: '', quantity: 1 }])
    setCalculation(null)
    setSelectedCandidateKey(null)
    setMixedLengths(DEFAULT_MIXED_LONG_STOCK_LENGTHS)
    setNonstandardLengths(false)
    setManualMode(false)
    setShowCuttingMatrix(false)
    setManualBars([])
    setManualReason('')
    setManualReasonText('')
    setError(null)
    setMaterialError(null)
    setSourceOptions([])
    setSourceQuantities({})
    setSourceSelectionCustomized(false)
    setSourceLoading(false)
    setSourceError(null)
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
                onCreateRequest={startCreateMaterial}
                onQueryChange={(query) => {
                  if (query === material?.name) return
                  setMaterial(null)
                  setVariant(null)
                  setNewMaterialDraft(null)
                  setMaterialError(null)
                  invalidateCalculation()
                }}
              />
              {!newMaterialDraft && !exactVariantReady && (
                <p className="flex items-start gap-2 text-xs leading-5 text-amber-700" role="status">
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  {category === 'pipe' && variant?.pipe_type === 'wire'
                    ? 'Проволока остаётся в прежнем интерфейсе.'
                    : 'Расчёт доступен только после выбора конкретного варианта материала.'}
                </p>
              )}
              {materialError && (
                <p className="flex items-start gap-2 text-sm leading-5 text-red-700" role="alert">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {materialError}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-dashed bg-slate-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Выбранный вариант</div>
              {variant && material ? (
                <div className="mt-2">
                  <div className="font-medium text-slate-900">{material.name}</div>
                  <div className="mt-1 text-sm text-slate-600">{variantSummary(category, variant)}</div>
                  {selectedSteelTypeName && (
                    <div className="mt-1 text-sm text-slate-600">
                      Тип металла: <span className="font-medium text-slate-800">{selectedSteelTypeName}</span>
                    </div>
                  )}
                  {category === 'knives' && (
                    <Badge variant="secondary" className="mt-2">Скос входит в вариант</Badge>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Вариант ещё не выбран</p>
              )}
            </div>
            {newMaterialDraft && (
              <NewLongStockMaterialForm
                draft={newMaterialDraft}
                steelTypes={steelTypes}
                pending={pendingAction === 'material'}
                onNameChange={(name) => {
                  setNewMaterialDraft((current) => current ? { ...current, name } : current)
                  setMaterialError(null)
                }}
                onFieldChange={updateNewMaterialField}
                onCancel={() => {
                  setNewMaterialDraft(null)
                  setMaterialError(null)
                }}
                onSave={() => void saveNewMaterial()}
              />
            )}
          </section>

          <LongStockSourcesSection
            titleId={`${category}-sources-title`}
            exactVariantReady={exactVariantReady}
            loading={sourceLoading}
            error={sourceError}
            options={sourceOptions}
            quantities={sourceQuantities}
            customized={sourceSelectionCustomized}
            disabled={Boolean(pendingAction)}
            onQuantityChange={updateSourceQuantity}
            onRefresh={() => void refreshSources()}
            onUseRecommendation={resetSourceRecommendation}
          />

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

              {visibleCandidates.length > 0 && (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    aria-expanded={showCuttingMatrix}
                    aria-controls={`${category}-cutting-matrix`}
                    onClick={() => setShowCuttingMatrix((visible) => !visible)}
                  >
                    <TableProperties className="size-4" />
                    {showCuttingMatrix ? 'Скрыть всю матрицу' : 'Показать всю матрицу по отрезкам'}
                  </Button>
                </div>
              )}

              {showCuttingMatrix && visibleCandidates.length > 0 && (
                <CuttingLayoutsMatrix
                  id={`${category}-cutting-matrix`}
                  calculation={calculation}
                  candidates={visibleCandidates}
                  selectedKey={manualMode ? null : selectedCandidateKey}
                  bestKey={bestCandidateKey}
                  onSelect={chooseCandidate}
                />
              )}

              {visibleCandidates.length > 0 ? mixedLengths ? (
                <MixedCandidateList
                  candidates={visibleCandidates}
                  selectedKey={manualMode ? null : selectedCandidateKey}
                  bestKey={bestCandidateKey}
                  weightPerMeterKg={calculation.weightPerMeterKg}
                  calculation={calculation}
                  onSelect={chooseCandidate}
                />
              ) : (
                <CandidateMatrix
                  candidates={visibleCandidates}
                  selectedKey={manualMode ? null : selectedCandidateKey}
                  bestKey={bestCandidateKey}
                  weightPerMeterKg={calculation.weightPerMeterKg}
                  calculation={calculation}
                  minimumUsefulLengthMm={minimumUsefulLengthMm}
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
                    Излишек {formatPercent(wastePercent)} от закупаемой длины, можно подобрать длину точнее.
                  </AlertDescription>
                </Alert>
              )}

              {manualMode && <p className="text-sm text-amber-800">Сейчас редактируется ручная раскладка. Выбор другой комбинации отменит ручные изменения; её сводка откроется заново.</p>}

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
                  {!manualMode && selectedCandidate.searchComplete === false && (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-slate-500">
                      <span>Проверены не все варианты</span>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        disabled={Boolean(pendingAction)}
                        onClick={() => void searchLonger()}
                      >
                        {pendingAction === 'longer' && <Loader2 className="size-3 animate-spin" />}
                        {pendingAction === 'longer' ? 'Поиск…' : 'Искать дольше'}
                      </Button>
                    </div>
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
            disabled={!selectedCandidate || Boolean(pendingAction) || (manualMode && !manualReasonReady(manualReason, manualReasonText))}
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

export function LongStockPlanningRecoveryDialog({
  requestItem,
  open,
  onOpenChange,
  onApproved,
}: RecalculationDialogProps) {
  const nextSegmentRow = useRef(2)
  const [draft, setDraft] = useState<LongStockPlanningRecoveryDraft | null>(null)
  const [segmentRows, setSegmentRows] = useState<LongStockSegmentRow[]>([
    { id: 'planning-recovery-row-1', lengthMm: '', quantity: 1 },
  ])
  const [calculation, setCalculation] = useState<Calculation | null>(null)
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)
  const [mixedLengths, setMixedLengths] = useState(DEFAULT_MIXED_LONG_STOCK_LENGTHS)
  const [showCuttingMatrix, setShowCuttingMatrix] = useState(false)
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
  const segmentTotalLengthMm = totalLongStockSegmentLength(segmentValidation.segments)
  const demandMatches = Boolean(
    draft
    && segmentValidation.error === null
    && Math.abs(segmentTotalLengthMm - draft.totalLengthMm) <= 0.001,
  )
  const hasReservedStock = Boolean(draft?.reservedStock.length)
  const visibleCandidates = useMemo(
    () => candidatesForLongStockMode(calculation?.candidates ?? [], mixedLengths),
    [calculation, mixedLengths],
  )
  const selectedCandidate = visibleCandidates.find((candidate) => candidate.key === selectedCandidateKey) ?? null
  const bestCandidateKey = visibleCandidates[0]?.key ?? null
  const minimumUsefulLengthMm = calculation?.settingsSnapshot.categories
    .find((entry) => entry.key === calculation.layoutCategoryKey)?.minimum_useful_length_mm ?? 0

  useEffect(() => {
    if (!open) return
    let active = true
    setPendingAction('load')
    setError(null)
    setDraft(null)
    setCalculation(null)
    setSelectedCandidateKey(null)
    setMixedLengths(DEFAULT_MIXED_LONG_STOCK_LENGTHS)
    setShowCuttingMatrix(false)
    setSegmentRows([{ id: 'planning-recovery-row-1', lengthMm: '', quantity: 1 }])

    void (async () => {
      try {
        const requestItemRef = { id: requestItem.id, table: requestItem.table }
        const nextDraft = await loadLongStockPlanningRecoveryDraft(requestItemRef)
        if (!active) return
        const nextRows = planningRecoverySegmentRows(nextDraft.draftSegments)
        nextSegmentRow.current = nextRows.length + 1
        setDraft(nextDraft)
        setSegmentRows(nextRows)
        if (nextDraft.draftSegments.length === 0) return
        const recoverySegments = expandLongStockSegmentRows(nextRows)

        const nextCalculation = await calculateLongStockCuttingPlan({
          requestItem: requestItemRef,
          segments: recoverySegments,
          mode: DEFAULT_MIXED_LONG_STOCK_LENGTHS ? 'mixed' : 'standard',
        })
        if (!active) return
        const candidates = candidatesForLongStockMode(
          nextCalculation.candidates,
          DEFAULT_MIXED_LONG_STOCK_LENGTHS,
        )
        setCalculation(nextCalculation)
        setSelectedCandidateKey(candidates[0]?.key ?? null)
        if (candidates.length === 0) {
          setError(nextDraft.reservedStock.length > 0
            ? 'Сохранённая раскладка не соответствует точному составу забронированных физических хлыстов'
            : 'Для сохранённых отрезков подходящая раскладка не найдена')
        }
      } catch (loadError) {
        if (!active) return
        setError(errorMessage(loadError, 'Не удалось подготовить карту по складскому резерву'))
      } finally {
        if (active) setPendingAction(null)
      }
    })()
    return () => { active = false }
  }, [open, requestItem.id, requestItem.table])

  function invalidateCalculation() {
    setCalculation(null)
    setSelectedCandidateKey(null)
    setShowCuttingMatrix(false)
    setError(null)
  }

  function updateSegmentRow(id: string, patch: Partial<LongStockSegmentRow>) {
    setSegmentRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
    invalidateCalculation()
  }

  function addSegmentRow() {
    const id = `planning-recovery-row-${nextSegmentRow.current}`
    nextSegmentRow.current += 1
    setSegmentRows((current) => [...current, { id, lengthMm: '', quantity: 1 }])
    invalidateCalculation()
  }

  function removeSegmentRow(id: string) {
    setSegmentRows((current) => current.filter((row) => row.id !== id))
    invalidateCalculation()
  }

  async function calculate(mode: 'mixed' | 'standard', searchBudget = DEFAULT_LONG_STOCK_SEARCH_BUDGET) {
    if (!draft || !demandMatches) return
    setPendingAction(searchBudget > DEFAULT_LONG_STOCK_SEARCH_BUDGET ? 'longer' : 'calculate')
    setError(null)
    try {
      const nextCalculation = await calculateLongStockCuttingPlan({
        requestItem,
        segments: segmentValidation.segments,
        mode,
        searchBudget,
      })
      const nextMixed = mode === 'mixed'
      const candidates = candidatesForLongStockMode(nextCalculation.candidates, nextMixed)
      setMixedLengths(nextMixed)
      setCalculation(nextCalculation)
      setSelectedCandidateKey(candidates[0]?.key ?? null)
      setShowCuttingMatrix(false)
      if (candidates.length === 0) {
        setError(hasReservedStock
          ? 'Раскладка не соответствует точному составу забронированных физических хлыстов'
          : 'Для этих отрезков подходящая раскладка не найдена')
      }
    } catch (calculationError) {
      setError(errorMessage(calculationError, 'Не удалось рассчитать карту по складскому резерву'))
    } finally {
      setPendingAction(null)
    }
  }

  async function approveRecovery() {
    if (!draft || !calculation || !selectedCandidate || !demandMatches) return
    setPendingAction('approve')
    setError(null)
    try {
      const version = await createLongStockCuttingPlanVersion({
        requestItem,
        segments: segmentValidation.segments,
        mode: mixedLengths ? 'mixed' : 'standard',
        searchBudget: calculation.searchBudget,
        selectedCandidateKey: selectedCandidate.key,
      })
      await approveLongStockCuttingPlanVersion(version.id)
      toast.success(`Версия ${version.version_number} карты раскроя утверждена`)
      onApproved?.()
      onOpenChange(false)
    } catch (approvalError) {
      const message = errorMessage(approvalError, 'Не удалось утвердить карту по складскому резерву')
      setError(message)
      toast.error(message)
    } finally {
      setPendingAction(null)
    }
  }

  const searchBudget = calculation?.searchBudget ?? DEFAULT_LONG_STOCK_SEARCH_BUDGET

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!pendingAction || pendingAction === 'load') onOpenChange(nextOpen)
    }}>
      <DialogContent className="flex max-h-[94vh] w-[min(1180px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b bg-red-50/70 px-5 py-4 pr-16">
          <DialogTitle className="flex items-center gap-2 text-lg text-red-950">
            <ClipboardPenLine className="size-5" />Подготовка отсутствующей карты
          </DialogTitle>
          <DialogDescription>
            {hasReservedStock
              ? 'Укажите точные отрезки старой позиции. Раскладка строится только по уже забронированным физическим хлыстам.'
              : 'Укажите точные отрезки позиции и утвердите подходящую раскладку хлыстов.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {pendingAction === 'load' && (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-600" role="status">
              <Loader2 className="size-4 animate-spin" />Сверяем позицию и складские резервы…
            </div>
          )}

          {draft && (
            <>
              <Alert className="border-red-300 bg-red-50">
                <AlertTriangle className="text-red-700" />
                <AlertTitle>Старая позиция блокирует факт заготовки</AlertTitle>
                <AlertDescription>
                  {hasReservedStock
                    ? 'У позиции есть физический резерв, но нет утверждённой карты. Карта будет рассчитана по точному составу этих хлыстов.'
                    : 'У позиции нет утверждённой карты. Без неё факт заготовки по машине остаётся заблокирован.'}
                </AlertDescription>
              </Alert>

              <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-2 lg:grid-cols-4">
                <Metric label="Материал" value={draft.materialName} />
                <Metric label="Вариант" value={draft.variantDescription || 'Точный вариант из каталога'} />
                <Metric label="Потребность" value={`${formatMm(draft.totalLengthMm)} мм`} />
                <Metric
                  label="Физический резерв"
                  value={hasReservedStock
                    ? draft.reservedStock.map((stock) => `${formatMm(stock.lengthMm)} мм × ${stock.pieceCount}`).join(' + ')
                    : 'Ещё не создан'}
                />
              </section>

              <section className="rounded-xl border bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">Точные отрезки позиции</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Сумма должна совпасть с потребностью {formatMm(draft.totalLengthMm)} мм.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={Boolean(pendingAction)} onClick={addSegmentRow}>
                    <Plus className="size-4" />Добавить строку
                  </Button>
                </div>

                <div className="mt-4 space-y-3">
                  {segmentRows.map((row, index) => (
                    <div key={row.id} className="grid items-end gap-3 rounded-lg border bg-slate-50/60 p-3 sm:grid-cols-[1fr_1fr_auto]">
                      <div className="space-y-1">
                        <Label htmlFor={`${row.id}-recovery-length`}>Длина отрезка, мм</Label>
                        <Input
                          id={`${row.id}-recovery-length`}
                          type="number"
                          min="0.001"
                          step="0.001"
                          inputMode="decimal"
                          value={row.lengthMm}
                          onChange={(event) => updateSegmentRow(row.id, { lengthMm: event.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${row.id}-recovery-quantity`}>Количество</Label>
                        <Input
                          id={`${row.id}-recovery-quantity`}
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
                        disabled={segmentRows.length === 1 || Boolean(pendingAction)}
                        onClick={() => removeSegmentRow(row.id)}
                        aria-label={`Удалить строку отрезков ${index + 1}`}
                      >
                        <Trash2 className="size-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="mt-3 text-sm">
                  {segmentValidation.error ? (
                    <p className="text-amber-700">{segmentValidation.error}</p>
                  ) : demandMatches ? (
                    <p className="text-emerald-700">Сумма отрезков: {formatMm(segmentTotalLengthMm)} мм — совпадает.</p>
                  ) : (
                    <p className="text-red-700">
                      Сумма отрезков {formatMm(segmentTotalLengthMm)} мм; требуется {formatMm(draft.totalLengthMm)} мм.
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
                  <Button
                    type="button"
                    disabled={!demandMatches || Boolean(pendingAction)}
                    onClick={() => void calculate(mixedLengths ? 'mixed' : 'standard')}
                  >
                    {pendingAction === 'calculate' ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />}
                    {pendingAction === 'calculate'
                      ? 'Расчёт…'
                      : hasReservedStock ? 'Рассчитать по резерву' : 'Рассчитать'}
                  </Button>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
                    <Checkbox
                      checked={mixedLengths}
                      disabled={!demandMatches || Boolean(pendingAction)}
                      onCheckedChange={(checked) => void calculate(checked === true ? 'mixed' : 'standard')}
                    />
                    {hasReservedStock ? 'Смешивать длины резерва' : 'Смешивать стандартные длины'}
                  </label>
                </div>
              </section>

              {calculation && visibleCandidates.length > 0 && (
                <section className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {hasReservedStock ? 'Варианты по физическому резерву' : 'Варианты раскладки'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {hasReservedStock
                          ? 'Каждый вариант использует точный состав забронированных физических хлыстов.'
                          : 'Сначала показана минимальная требуемая длина.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      aria-expanded={showCuttingMatrix}
                      aria-controls="planning-recovery-cutting-matrix"
                      onClick={() => setShowCuttingMatrix((visible) => !visible)}
                    >
                      <TableProperties className="size-4" />
                      {showCuttingMatrix ? 'Скрыть всю матрицу' : 'Показать всю матрицу по отрезкам'}
                    </Button>
                  </div>
                  {showCuttingMatrix && (
                    <CuttingLayoutsMatrix
                      id="planning-recovery-cutting-matrix"
                      calculation={calculation}
                      candidates={visibleCandidates}
                      selectedKey={selectedCandidateKey}
                      bestKey={bestCandidateKey}
                      onSelect={(candidate) => setSelectedCandidateKey(candidate.key)}
                    />
                  )}
                  {mixedLengths ? (
                    <MixedCandidateList
                      candidates={visibleCandidates}
                      selectedKey={selectedCandidateKey}
                      bestKey={bestCandidateKey}
                      weightPerMeterKg={calculation.weightPerMeterKg}
                      calculation={calculation}
                      onSelect={(candidate) => setSelectedCandidateKey(candidate.key)}
                    />
                  ) : (
                    <CandidateMatrix
                      candidates={visibleCandidates}
                      selectedKey={selectedCandidateKey}
                      bestKey={bestCandidateKey}
                      weightPerMeterKg={calculation.weightPerMeterKg}
                      calculation={calculation}
                      minimumUsefulLengthMm={minimumUsefulLengthMm}
                      onSelect={(candidate) => setSelectedCandidateKey(candidate.key)}
                    />
                  )}
                  {selectedCandidate && (
                    <div className="space-y-3 rounded-xl border bg-white p-4">
                      <h4 className="font-semibold text-slate-900">
                        {hasReservedStock ? 'Раскладка по забронированным хлыстам' : 'Раскладка по хлыстам'}
                      </h4>
                      <LayoutPreview candidate={selectedCandidate} calculation={calculation} />
                      {selectedCandidate.searchComplete === false && (
                        <div className="flex items-center gap-2 border-t pt-3 text-xs text-slate-500">
                          <span>Проверены не все варианты</span>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            disabled={Boolean(pendingAction)}
                            onClick={() => void calculate(
                              mixedLengths ? 'mixed' : 'standard',
                              searchBudget < EXTENDED_LONG_STOCK_SEARCH_BUDGET
                                ? EXTENDED_LONG_STOCK_SEARCH_BUDGET
                                : Math.min(Number.MAX_SAFE_INTEGER, searchBudget * 2),
                            )}
                          >
                            {pendingAction === 'longer' && <Loader2 className="size-3 animate-spin" />}
                            Искать дольше
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {error && (
            <Alert variant="destructive" role="alert">
              <CircleAlert />
              <AlertTitle>Карта не готова</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-5 py-4">
          <Button type="button" variant="outline" disabled={pendingAction === 'approve'} onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          <Button
            type="button"
            disabled={!selectedCandidate || !demandMatches || Boolean(pendingAction)}
            onClick={() => void approveRecovery()}
          >
            {pendingAction === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
            {pendingAction === 'approve' ? 'Утверждение…' : 'Утвердить карту'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function LongStockRecalculationDialog({
  requestItem,
  open,
  onOpenChange,
  onApproved,
}: RecalculationDialogProps) {
  const [draft, setDraft] = useState<LongStockRecalculationDraft | null>(null)
  const [calculation, setCalculation] = useState<Calculation | null>(null)
  const [selectedCandidateKey, setSelectedCandidateKey] = useState<string | null>(null)
  const [mixedLengths, setMixedLengths] = useState(DEFAULT_MIXED_LONG_STOCK_LENGTHS)
  const [showCuttingMatrix, setShowCuttingMatrix] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createdRequestHref, setCreatedRequestHref] = useState<string | null>(null)

  const visibleCandidates = useMemo(
    () => candidatesForLongStockMode(calculation?.candidates ?? [], mixedLengths),
    [calculation, mixedLengths],
  )
  const selectedCandidate = visibleCandidates.find((candidate) => candidate.key === selectedCandidateKey) ?? null
  const bestCandidateKey = visibleCandidates[0]?.key ?? null
  const minimumUsefulLengthMm = calculation?.settingsSnapshot.categories
    .find((entry) => entry.key === calculation.layoutCategoryKey)?.minimum_useful_length_mm ?? 0

  useEffect(() => {
    if (!open) return
    let active = true

    void (async () => {
      await Promise.resolve()
      if (!active) return
      setPendingAction('load')
      setError(null)
      setDraft(null)
      setCalculation(null)
      setSelectedCandidateKey(null)
      setMixedLengths(DEFAULT_MIXED_LONG_STOCK_LENGTHS)
      setShowCuttingMatrix(false)
      setCreatedRequestHref(null)
      const result = await loadLongStockRecalculationSafe({
        requestItem: { id: requestItem.id, table: requestItem.table },
      })
      if (!active) return
      if (!result.success) {
        setError(result.error)
        setPendingAction(null)
        return
      }
      const nextMixed = result.data.draft.sourceKind === 'supply_return'
        ? true
        : DEFAULT_MIXED_LONG_STOCK_LENGTHS
      const candidates = candidatesForLongStockMode(result.data.calculation.candidates, nextMixed)
      setDraft(result.data.draft)
      setCalculation(result.data.calculation)
      setMixedLengths(nextMixed)
      setSelectedCandidateKey(candidates[0]?.key ?? null)
      if (candidates.length === 0) {
        setError(result.data.draft.sourceKind === 'supply_return'
          ? 'Для актуальных стандартных и нестандартных длин раскладка не найдена'
          : 'Для фактически принятых длин раскладка не найдена')
      }
      setPendingAction(null)
    })()
    return () => { active = false }
  }, [open, requestItem.id, requestItem.table])

  function recalculationMode(useAlternativeLengths: boolean): LongStockPlanCalculationMode {
    if (draft?.sourceKind === 'supply_return') {
      return useAlternativeLengths ? 'with_nonstandard' : 'standard'
    }
    return useAlternativeLengths ? 'mixed' : 'standard'
  }

  async function calculate(mode: LongStockPlanCalculationMode, searchBudget = DEFAULT_LONG_STOCK_SEARCH_BUDGET) {
    if (!draft) return
    setPendingAction(searchBudget > DEFAULT_LONG_STOCK_SEARCH_BUDGET ? 'longer' : 'calculate')
    setError(null)
    const result = await calculateLongStockRecalculationSafe({
      requestItem,
      segments: draft.remainingSegments,
      mode,
      searchBudget,
    })
    if (!result.success) {
      setError(result.error)
      setPendingAction(null)
      return
    }
    const nextMixed = mode === 'mixed' || mode === 'with_nonstandard'
    const candidates = candidatesForLongStockMode(result.data.candidates, nextMixed)
    setMixedLengths(nextMixed)
    setCalculation(result.data)
    setSelectedCandidateKey(candidates[0]?.key ?? null)
    setShowCuttingMatrix(false)
    if (candidates.length === 0) setError(draft.sourceKind === 'supply_return'
      ? 'Для выбранных актуальных длин раскладка не найдена'
      : 'Для фактически принятых длин раскладка не найдена')
    setPendingAction(null)
  }

  async function approveRecalculation() {
    if (!draft || !calculation || !selectedCandidate) return
    setPendingAction('approve')
    setError(null)
    const result = await approveLongStockRecalculationSafe({
      requestItem,
      segments: draft.remainingSegments,
      mode: recalculationMode(mixedLengths),
      searchBudget: calculation.searchBudget,
      selectedCandidateKey: selectedCandidate.key,
    })
    if (!result.success) {
      setError(result.error)
      toast.error(result.error)
      setPendingAction(null)
      return
    }
    const href = `/sales-plan/${result.data.approval.machine_id}/request/${result.data.approval.replacement_request_id}`
    setCreatedRequestHref(href)
    toast.success(`Версия ${result.data.version.version_number} утверждена, новая заявка создана`)
    onApproved?.()
    setPendingAction(null)
  }

  const searchBudget = calculation?.searchBudget ?? DEFAULT_LONG_STOCK_SEARCH_BUDGET

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!pendingAction || pendingAction === 'load') onOpenChange(nextOpen)
    }}>
      <DialogContent className="flex max-h-[94vh] w-[min(1180px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="border-b bg-amber-50/70 px-5 py-4 pr-16">
          <DialogTitle className="flex items-center gap-2 text-lg text-amber-950">
            <RotateCcw className="size-5" />Пересчёт карты раскроя
          </DialogTitle>
          <DialogDescription>
            {draft?.sourceKind === 'supply_return'
              ? 'Непорезанная потребность пересчитывается по актуальным стандартным и нестандартным длинам.'
              : draft?.sourceKind === 'inventory_reconciliation'
                ? 'Непорезанная потребность пересчитывается по сохранённым фактическим складским резервам.'
              : 'Непорезанная потребность пересчитывается по фактически принятым длинам.'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {pendingAction === 'load' && (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-600" role="status">
              <Loader2 className="size-4 animate-spin" />Определяем источник длин и непорезанные заготовки…
            </div>
          )}

          {draft && (
            <>
              <Alert className="border-amber-300 bg-amber-50">
                <AlertTriangle className="text-amber-700" />
                <AlertTitle>Версия {draft.invalidVersionNumber} недействительна</AlertTitle>
                <AlertDescription>{draft.invalidationReason}</AlertDescription>
              </Alert>

              <section className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4">
                <Metric label="Материал" value={draft.materialName} />
                <Metric label="Вариант" value={draft.variantDescription || 'Точный вариант из каталога'} />
                <Metric
                  label="Источник длин"
                  value={draft.sourceKind === 'supply_return'
                    ? 'Актуальные настройки раскроя'
                    : draft.sourceKind === 'supply_receipt'
                      ? 'Фактическая приёмка'
                      : draft.sourceKind === 'inventory_reconciliation'
                        ? 'Сверенные складские резервы'
                        : 'Межзаводское перемещение'}
                />
                <Metric label="Допустимые длины" value={draft.acceptedLengthsMm.map(formatMm).join(' + ')} />
              </section>

              <section className="rounded-xl border bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-900">Осталось раскроить</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {draft.remainingSegments.length} шт. · {formatMm(totalLongStockSegmentLength(draft.remainingSegments))} мм
                    </p>
                  </div>
                  <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm">
                    <Checkbox
                      checked={mixedLengths}
                      disabled={Boolean(pendingAction)}
                      onCheckedChange={(checked) => void calculate(recalculationMode(checked === true))}
                    />
                    {draft.sourceKind === 'supply_return'
                      ? 'Разрешить нестандартные длины'
                      : draft.sourceKind === 'inventory_reconciliation'
                        ? 'Смешивать сохранённые резервы'
                        : 'Смешивать принятые длины'}
                  </label>
                </div>
              </section>

              {calculation && visibleCandidates.length > 0 && (
                <section className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {draft.sourceKind === 'supply_return'
                          ? 'Варианты по актуальным настройкам'
                          : 'Варианты по фактическому материалу'}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">Сначала показана минимальная требуемая длина.</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      aria-expanded={showCuttingMatrix}
                      aria-controls="recalculation-cutting-matrix"
                      onClick={() => setShowCuttingMatrix((visible) => !visible)}
                    >
                      <TableProperties className="size-4" />
                      {showCuttingMatrix ? 'Скрыть всю матрицу' : 'Показать всю матрицу по отрезкам'}
                    </Button>
                  </div>
                  {showCuttingMatrix && (
                    <CuttingLayoutsMatrix
                      id="recalculation-cutting-matrix"
                      calculation={calculation}
                      candidates={visibleCandidates}
                      selectedKey={selectedCandidateKey}
                      bestKey={bestCandidateKey}
                      onSelect={(candidate) => setSelectedCandidateKey(candidate.key)}
                    />
                  )}
                  {mixedLengths ? (
                    <MixedCandidateList
                      candidates={visibleCandidates}
                      selectedKey={selectedCandidateKey}
                      bestKey={bestCandidateKey}
                      weightPerMeterKg={calculation.weightPerMeterKg}
                      calculation={calculation}
                      onSelect={(candidate) => setSelectedCandidateKey(candidate.key)}
                    />
                  ) : (
                    <CandidateMatrix
                      candidates={visibleCandidates}
                      selectedKey={selectedCandidateKey}
                      bestKey={bestCandidateKey}
                      weightPerMeterKg={calculation.weightPerMeterKg}
                      calculation={calculation}
                      minimumUsefulLengthMm={minimumUsefulLengthMm}
                      onSelect={(candidate) => setSelectedCandidateKey(candidate.key)}
                    />
                  )}
                  {selectedCandidate && (
                    <div className="space-y-3 rounded-xl border bg-white p-4">
                      <h4 className="font-semibold text-slate-900">Новая раскладка</h4>
                      <LayoutPreview candidate={selectedCandidate} calculation={calculation} />
                      {selectedCandidate.searchComplete === false && (
                        <div className="flex items-center gap-2 border-t pt-3 text-xs text-slate-500">
                          <span>Проверены не все варианты</span>
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            disabled={Boolean(pendingAction)}
                            onClick={() => void calculate(
                              recalculationMode(mixedLengths),
                              searchBudget < EXTENDED_LONG_STOCK_SEARCH_BUDGET
                                ? EXTENDED_LONG_STOCK_SEARCH_BUDGET
                                : Math.min(Number.MAX_SAFE_INTEGER, searchBudget * 2),
                            )}
                          >
                            {pendingAction === 'longer' && <Loader2 className="size-3 animate-spin" />}
                            Искать дольше
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )}
            </>
          )}

          {error && (
            <Alert variant="destructive" role="alert">
              <CircleAlert />
              <AlertTitle>Пересчёт недоступен</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {createdRequestHref && (
            <Alert className="border-emerald-300 bg-emerald-50" role="status">
              <BadgeCheck className="text-emerald-700" />
              <AlertTitle>Новая заявка создана</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>Исходная позиция отменена по причине «Пересчёт». Новая позиция ожидает проверку склада.</p>
                <Button type="button" size="sm" onClick={() => window.location.assign(createdRequestHref)}>
                  Открыть новую заявку
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none px-5 py-4">
          <Button type="button" variant="outline" disabled={pendingAction === 'approve'} onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
          <Button
            type="button"
            disabled={!selectedCandidate || Boolean(pendingAction) || Boolean(createdRequestHref)}
            onClick={() => void approveRecalculation()}
          >
            {pendingAction === 'approve' ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
            {pendingAction === 'approve' ? 'Утверждение…' : 'Утвердить и создать новую заявку'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LongStockSourcesSection({
  titleId,
  exactVariantReady,
  loading,
  error,
  options,
  quantities,
  customized,
  disabled,
  onQuantityChange,
  onRefresh,
  onUseRecommendation,
}: {
  titleId: string
  exactVariantReady: boolean
  loading: boolean
  error: string | null
  options: LongStockSourceOption[]
  quantities: Record<string, number>
  customized: boolean
  disabled: boolean
  onQuantityChange: (option: LongStockSourceOption, value: string) => void
  onRefresh: () => void
  onUseRecommendation: () => void
}) {
  const groups = [
    {
      key: 'own',
      title: 'На заводе машины',
      description: 'Свободные хлысты и доступные деловые остатки без перевода.',
      icon: <Boxes className="size-4" />,
      options: options.filter((option) => option.source !== 'future_business_remnant' && !option.requiresTransfer),
    },
    {
      key: 'future',
      title: 'Будущие остатки',
      description: 'Можно выбрать только когда исходная порезка строго раньше потребляющей.',
      icon: <CalendarClock className="size-4" />,
      options: options.filter((option) => option.source === 'future_business_remnant'),
    },
    {
      key: 'transfer',
      title: 'Другой завод',
      description: 'При утверждении будет создан резерв и межзаводской перевод.',
      icon: <Truck className="size-4" />,
      options: options.filter((option) => option.source !== 'future_business_remnant' && option.requiresTransfer),
    },
  ]
  const selectedCount = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0)

  return (
    <section aria-labelledby={titleId} className="rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={titleId} className="font-semibold text-slate-900">Источники хлыстов</h3>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Выбранное количество обязательно: каждый физический хлыст получит хотя бы один рез.
            Недостающее система добавит как закупку.
          </p>
        </div>
        {exactVariantReady && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled || loading} onClick={onRefresh}>
              <RotateCcw className="size-4" />Обновить источники
            </Button>
            {!loading && !error && (
              <Button type="button" variant="outline" size="sm" disabled={disabled || !customized} onClick={onUseRecommendation}>
                Рекомендовать заново
              </Button>
            )}
          </div>
        )}
      </div>

      {!exactVariantReady && (
        <p className="mt-4 text-sm text-slate-500">Сначала выберите точный вариант материала.</p>
      )}
      {loading && (
        <div className="mt-4 flex min-h-20 items-center justify-center gap-2 rounded-lg border border-dashed bg-slate-50 text-sm text-slate-600" role="status">
          <Loader2 className="size-4 animate-spin" />Проверяем склад, будущие остатки и другие заводы…
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="mt-4">
          <CircleAlert className="size-4" />
          <AlertTitle>Источники не загружены</AlertTitle>
          <AlertDescription>{error}. Расчёт заблокирован, чтобы не использовать устаревшие остатки.</AlertDescription>
        </Alert>
      )}

      {exactVariantReady && !loading && !error && (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {groups.map((group) => (
            <div key={group.key} className="rounded-lg border bg-slate-50/60 p-3">
              <div className="flex items-center gap-2 font-medium text-slate-900">{group.icon}{group.title}</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">{group.description}</p>
              {group.options.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed bg-white px-3 py-2 text-xs text-slate-500">Подходящих позиций нет</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {group.options.map((option) => {
                    const inputId = `long-stock-source-${option.inventoryId}`
                    return (
                      <div key={option.inventoryId} className={cn('rounded-md border bg-white p-3', !option.available && 'bg-slate-100 opacity-75')}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                              {longStockSourceLabel(option)}
                              <Badge variant="outline">{formatMm(option.lengthMm)} мм</Badge>
                              {option.requiresTransfer && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">Перевод</Badge>}
                            </div>
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              {option.factoryName}
                              {option.sourceMachineName ? ` · станок ${option.sourceMachineName}` : ''}
                              {option.sourceVersionNumber ? ` · раскладка №${option.sourceVersionNumber}` : ''}
                              {option.availableFromDate ? ` · план ${formatLongStockDate(option.availableFromDate)}` : ''}
                            </p>
                            {option.unavailableReason && (
                              <p className="mt-1 flex items-start gap-1 text-xs leading-5 text-amber-700" role="status">
                                <CircleAlert className="mt-0.5 size-3.5 shrink-0" />{option.unavailableReason}
                              </p>
                            )}
                          </div>
                          <div className="w-24 space-y-1">
                            <Label htmlFor={inputId} className="text-xs">Выбрать, шт.</Label>
                            <Input
                              id={inputId}
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={option.availableQuantity}
                              step={1}
                              value={quantities[option.inventoryId] ?? 0}
                              disabled={disabled || (!option.available && !(quantities[option.inventoryId] > 0))}
                              aria-invalid={(quantities[option.inventoryId] ?? 0) > option.availableQuantity}
                              aria-describedby={`${inputId}-available`}
                              onChange={(event) => onQuantityChange(option, event.target.value)}
                            />
                            <p id={`${inputId}-available`} className="text-right text-[11px] text-slate-500">
                              свободно {option.availableQuantity}
                            </p>
                            {(quantities[option.inventoryId] ?? 0) > option.availableQuantity && (
                              <p className="text-xs text-amber-700" role="alert">Уменьшите выбранное количество.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}

          <div className="rounded-lg border border-dashed bg-blue-50/50 p-3">
            <div className="flex items-center gap-2 font-medium text-slate-900"><ShoppingCart className="size-4" />Закупить</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Количество и длины закупаемых хлыстов определяются только для отрезков, которые не помещаются в выбранные источники.
            </p>
            <div className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-slate-700">
              {customized
                ? `Технолог выбрал ${selectedCount} складских хлыстов; закупка будет рассчитана по остатку потребности.`
                : 'При первом расчёте система сама предложит складские источники с минимальной закупаемой длиной.'}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function longStockSourceLabel(option: LongStockSourceOption) {
  if (option.source === 'warehouse_stock') return 'Обычный склад'
  if (option.source === 'business_remnant') return 'Деловой остаток'
  return option.availableFromDate
    ? `Будущий остаток до ${formatLongStockDate(option.availableFromDate)}`
    : 'Будущий остаток'
}

function formatLongStockDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU').format(date)
}

function NewLongStockMaterialForm({
  draft,
  steelTypes,
  pending,
  onNameChange,
  onFieldChange,
  onCancel,
  onSave,
}: {
  draft: LongStockNewMaterialDraft
  steelTypes: SteelType[]
  pending: boolean
  onNameChange: (name: string) => void
  onFieldChange: (field: string, value: string | boolean) => void
  onCancel: () => void
  onSave: () => void
}) {
  const pipeType = String(draft.fields.pipe_type ?? 'square')
  return (
    <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-4 lg:col-span-2">
      <div>
        <h3 className="text-sm font-semibold text-[#1B3A6B]">Новый материал и точный вариант</h3>
        <p className="mt-1 text-sm text-slate-600">
          Заполните характеристики нового варианта. Отрезки и раскладка для этого действия не проверяются.
        </p>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <DraftField label="Название" value={draft.name} onChange={onNameChange} />
        <div className="space-y-1">
          <Label htmlFor="long-stock-new-steel-type" className="text-sm">Тип металла</Label>
          <select
            id="long-stock-new-steel-type"
            value={String(draft.fields.steel_type_id ?? '')}
            onChange={(event) => onFieldChange('steel_type_id', event.target.value)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">— выберите тип металла —</option>
            {steelTypes.map((steelType) => (
              <option key={steelType.id} value={steelType.id}>{steelType.name}</option>
            ))}
          </select>
        </div>

        {draft.category === 'circle' && (
          <>
            <DraftField label="Диаметр, мм" type="number" value={draft.fields.diameter_mm} onChange={(value) => onFieldChange('diameter_mm', value)} />
            <label className="flex min-h-9 items-center gap-2 self-end rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
              <Checkbox checked={Boolean(draft.fields.is_calibrated)} onCheckedChange={(checked) => onFieldChange('is_calibrated', checked === true)} />
              Калиброванный круг
            </label>
          </>
        )}

        {draft.category === 'pipe' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="long-stock-new-pipe-type" className="text-sm">Подтип трубы</Label>
              <select
                id="long-stock-new-pipe-type"
                value={pipeType}
                onChange={(event) => onFieldChange('pipe_type', event.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                {Object.entries(PIPE_SUBTYPE_LABELS)
                  .filter(([value]) => value !== 'wire')
                  .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            {pipeType === 'round' ? (
              <DraftField
                label="Наружный диаметр, мм"
                type="number"
                value={draft.fields.diameter_mm}
                onChange={(value) => onFieldChange('diameter_mm', value)}
                placeholder="60"
              />
            ) : (
              <DraftField
                label="Сечение, мм"
                value={draft.fields.size}
                onChange={(value) => onFieldChange('size', value)}
                placeholder="40×40"
              />
            )}
            <DraftField label="Толщина стенки, мм" type="number" value={draft.fields.wall_thickness_mm} onChange={(value) => onFieldChange('wall_thickness_mm', value)} />
          </>
        )}

        {draft.category === 'knives' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="long-stock-new-knife-bevel" className="text-sm">Скос</Label>
              <select
                id="long-stock-new-knife-bevel"
                value={String(draft.fields.knife_bevel_count ?? '')}
                onChange={(event) => onFieldChange('knife_bevel_count', event.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">— выберите скос —</option>
                {KNIFE_BEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <DraftField label="Ширина, мм" type="number" value={draft.fields.width_mm} onChange={(value) => onFieldChange('width_mm', value)} />
            <DraftField label="Высота, мм" type="number" value={draft.fields.height_mm} onChange={(value) => onFieldChange('height_mm', value)} />
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-blue-100 pt-4">
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>Отмена</Button>
        <Button type="button" disabled={pending} onClick={onSave}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? 'Сохранение…' : 'Сохранить материал'}
        </Button>
      </div>
    </div>
  )
}

function DraftField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string | boolean | undefined
  onChange: (value: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <Input
        type={type}
        min={type === 'number' ? '0.001' : undefined}
        step={type === 'number' ? 'any' : undefined}
        value={typeof value === 'boolean' ? String(value) : String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

function CandidateMatrix({
  candidates,
  selectedKey,
  bestKey,
  weightPerMeterKg,
  calculation,
  minimumUsefulLengthMm,
  onSelect,
}: {
  candidates: LongStockCuttingCandidate[]
  selectedKey: string | null
  bestKey: string | null
  weightPerMeterKg: number | null
  calculation: Calculation
  minimumUsefulLengthMm: number
  onSelect: (candidate: LongStockCuttingCandidate) => void
}) {
  const newBarOrigin = longStockNewBarOrigin(calculation)
  const hasShortRemainders = candidates.some((candidate) => candidate.bars.some(
    (bar) => bar.remainderMm > 0 && bar.remainderMm < minimumUsefulLengthMm,
  ))
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Состав хлыстов</th>
              <th className="px-4 py-3 text-right">В закупку, шт.</th>
              <th className="px-4 py-3 text-right">Закупаемая длина</th>
              <th className="px-4 py-3 text-right">Излишек, мм</th>
              <th className="px-4 py-3 text-right">Остатки</th>
              <th className="px-4 py-3 text-right">Излишек, кг</th>
              <th className="w-10 px-4 py-3"><span className="sr-only">Раскрыть</span></th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((candidate) => {
              const selected = candidate.key === selectedKey
              const best = candidate.key === bestKey
              const breakdown = candidateMaterialBreakdown(candidate, newBarOrigin)
              return (
                <Fragment key={candidate.key}>
                <tr
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
                      <span>{breakdown.purchaseBars.length ? candidatePurchaseLengthLabel(candidate) : 'Без закупки'}</span>
                      {best && <Badge className="bg-emerald-700 text-white"><Check />Лучший</Badge>}
                      {candidate.usesNonstandardLength && <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700"><Sparkles />Нестандартная</Badge>}
                    </label>
                    <p className="mt-2 text-xs text-slate-600">Со склада: {formatLongStockComposition(breakdown.stockGroups) || 'не используется'}</p>
                    <p className="mt-1 text-xs text-slate-600">В закупку: {formatLongStockComposition(breakdown.purchaseGroups) || 'не требуется'}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{breakdown.purchaseBars.length}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMm(breakdown.purchasedLengthMm)} мм</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMm(candidate.totalRemainderMm)}</td>
                  <td className="px-4 py-3 text-right">
                    <RemainderComposition candidate={candidate} minimumUsefulLengthMm={minimumUsefulLengthMm} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatKg(remainderWeight(candidate, weightPerMeterKg))}</td>
                  <td className="px-4 py-3"><ChevronRight className={cn('size-4 text-slate-400', selected && 'rotate-90 text-blue-600')} /></td>
                </tr>
                {selected && (
                  <tr><td colSpan={7} className="border-t border-blue-200 bg-blue-50/20">
                    <LongStockCandidateSummary candidate={candidate} minimumUsefulLengthMm={minimumUsefulLengthMm} sources={calculation.stockSources} newBarOrigin={newBarOrigin} />
                  </td></tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {hasShortRemainders && (
        <p className="mt-2 text-xs text-slate-500">
          Остатки короче минимальной полезной длины {formatMm(minimumUsefulLengthMm)} мм помечены как «мелочь»; на складской учёт это не влияет.
        </p>
      )}
    </div>
  )
}

function CuttingLayoutsMatrix({
  id,
  calculation,
  candidates,
  selectedKey,
  bestKey,
  onSelect,
}: {
  id: string
  calculation: Calculation
  candidates: LongStockCuttingCandidate[]
  selectedKey: string | null
  bestKey: string | null
  onSelect: (candidate: LongStockCuttingCandidate) => void
}) {
  const newBarOrigin = longStockNewBarOrigin(calculation)
  return (
    <div id={id} className="max-h-[480px] overflow-auto rounded-xl border bg-white" role="region" aria-label="Вся матрица раскладки по отрезкам">
      <table className="min-w-[880px] w-full text-sm">
        <caption className="sr-only">Все рассчитанные варианты с составом каждого хлыста</caption>
        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Вариант</th>
            <th className="px-4 py-3">Хлыст</th>
            <th className="px-4 py-3">Отрезки по порядку резов</th>
            <th className="px-4 py-3 text-right">Остаток</th>
          </tr>
        </thead>
        <tbody>
          {candidates.flatMap((candidate) => candidate.bars.map((bar, barIndex) => {
            const selected = candidate.key === selectedKey
            const best = candidate.key === bestKey
            return (
              <tr
                key={`${candidate.key}-${bar.barNumber}`}
                className={cn(
                  'border-t align-top',
                  best && 'bg-emerald-50/40',
                  selected && 'bg-blue-50/70',
                )}
              >
                {barIndex === 0 && (
                  <td className="w-[230px] px-4 py-3" rowSpan={candidate.bars.length}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelect(candidate)}
                      className="rounded-md text-left font-semibold text-slate-900 outline-none hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                    >
                      {newBarOrigin === 'purchase' ? candidatePurchaseLengthLabel(candidate) : 'Без закупки'}
                    </button>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {best && <Badge className="bg-emerald-700 text-white"><Check />Лучший</Badge>}
                      {selected && <Badge variant="outline" className="border-blue-300 bg-blue-50 text-blue-700">Выбран</Badge>}
                    </div>
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                  №{bar.barNumber} · {formatMm(bar.stockLengthMm)} мм
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {longStockBarSourceLabel(bar.source, bar.availableFromDate, newBarOrigin)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {bar.cuts.map((cut) => (
                      <span key={cut.workpieceId} className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 tabular-nums text-blue-900">
                        {cutDisplayLabel(cut.cutNumber)}: {formatMm(cut.lengthMm)}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-emerald-800">
                  {formatMm(bar.remainderMm)} мм
                </td>
              </tr>
            )
          }))}
        </tbody>
      </table>
    </div>
  )
}

function RemainderComposition({
  candidate,
  minimumUsefulLengthMm,
}: {
  candidate: LongStockCuttingCandidate
  minimumUsefulLengthMm: number
}) {
  const preview = candidateRemainderPreview(candidate)
  if (preview.pieces.length === 0) return <span className="text-slate-400">—</span>
  const fullList = preview.pieces.map((lengthMm) => `${formatMm(lengthMm)} мм`).join(' + ')
  return (
    <span className="inline-flex flex-wrap justify-end gap-x-1" aria-label={`Остатки: ${fullList}`}>
      {preview.visiblePieces.map((lengthMm, index) => {
        const useful = minimumUsefulLengthMm <= 0 || lengthMm >= minimumUsefulLengthMm
        return (
          <span key={`${lengthMm}-${index}`} className="contents">
            {index > 0 && <span aria-hidden="true">+</span>}
            <span
              className={cn('tabular-nums', !useful && 'font-medium text-amber-700')}
              title={useful ? `${formatMm(lengthMm)} мм` : `Мелочь: короче минимальной полезной длины ${formatMm(minimumUsefulLengthMm)} мм`}
            >
              {formatMm(lengthMm)}
            </span>
          </span>
        )
      })}
      {preview.hiddenCount > 0 && <span className="whitespace-nowrap text-slate-500">+{preview.hiddenCount} ещё</span>}
    </span>
  )
}

function MixedCandidateList({
  calculation,
  ...props
}: {
  candidates: LongStockCuttingCandidate[]
  selectedKey: string | null
  bestKey: string | null
  weightPerMeterKg: number | null
  calculation: Calculation
  onSelect: (candidate: LongStockCuttingCandidate) => void
}) {
  return (
    <LongStockCandidateList
      {...props}
      sources={calculation.stockSources}
      newBarOrigin={longStockNewBarOrigin(calculation)}
      minimumUsefulLengthMm={calculation.settingsSnapshot.categories
        .find((entry) => entry.key === calculation.layoutCategoryKey)?.minimum_useful_length_mm ?? 0}
    />
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <span className="text-sm"><span className="block text-xs text-slate-500">{label}</span><span className="font-medium tabular-nums text-slate-800">{value}</span></span>
}

function LayoutPreview({ candidate, calculation }: { candidate: LongStockCuttingCandidate; calculation: Calculation }) {
  const newBarOrigin = longStockNewBarOrigin(calculation)
  const breakdown = candidateMaterialBreakdown(candidate, newBarOrigin)
  const minimumUsefulLengthMm = calculation.settingsSnapshot.categories
    .find((entry) => entry.key === calculation.layoutCategoryKey)?.minimum_useful_length_mm ?? 0
  const cutColors = longStockCutColorMap(candidate.bars.flatMap((bar) => bar.cuts.map((cut) => cut.lengthMm)))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs" aria-label="Итоги по источникам">
        <Badge variant="outline">Обычный склад: {candidate.warehouseBarCount}</Badge>
        <Badge variant="outline">Деловые остатки: {candidate.businessRemnantBarCount}</Badge>
        <Badge variant="outline">Будущие зависимости: {candidate.futureBusinessRemnantBarCount}</Badge>
        <Badge variant="outline">Переводы: {candidate.transferBarCount}</Badge>
        {newBarOrigin !== 'purchase' && <Badge variant="outline">{longStockBarSourceLabel('new_stock', null, newBarOrigin)}: {candidate.newBarCount} шт.</Badge>}
        <Badge variant="outline">Закупка: {breakdown.purchaseBars.length} шт. · {formatMm(breakdown.purchasedLengthMm)} мм</Badge>
      </div>
      {candidate.bars.map((bar) => (
        <div key={bar.barNumber} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-medium text-slate-900">
              Хлыст №{bar.barNumber}
              <Badge variant="outline">{formatMm(bar.stockLengthMm)} мм</Badge>
              <Badge variant="secondary">{longStockBarSourceLabel(bar.source, bar.availableFromDate, newBarOrigin)}</Badge>
              {bar.requiresTransfer && (
                <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                  {longStockTransferLabel(bar.sourceInventoryId, calculation)}
                </Badge>
              )}
              {bar.purchaseLengthKind === 'nonstandard' && <Badge variant="outline" className="border-violet-200 text-violet-700">Нестандартный</Badge>}
            </div>
            <span className={cn('text-sm text-slate-600', bar.remainderMm > 0 && bar.remainderMm < minimumUsefulLengthMm && 'text-amber-700')}>
              Остаток: <strong>{formatMm(bar.remainderMm)} мм</strong>
              {bar.remainderMm > 0 && bar.remainderMm < minimumUsefulLengthMm && <span className="ml-1">· мелочь</span>}
            </span>
          </div>
          <BarStrip
            stockLengthMm={bar.stockLengthMm}
            cuts={bar.cuts}
            remainderMm={bar.remainderMm}
            kerfMm={calculation.settingsSnapshot.kerf_mm}
            endTrimMm={calculation.settingsSnapshot.end_trim_mm}
            cutColors={cutColors}
          />
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {bar.cuts.map((cut) => (
              <li key={cut.workpieceId}>{cutDisplayLabel(cut.cutNumber)}: <span className="font-medium">{formatMm(cut.lengthMm)} мм</span></li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  )
}

function longStockTransferLabel(inventoryId: string | null, calculation: Calculation) {
  const source = calculation.stockSources.find((option) => option.inventoryId === inventoryId)
  if (!source) return 'Межзаводской перевод'
  const destination = calculation.stockSources.find((option) => option.isOwnFactory)?.factoryName ?? 'завод машины'
  return `Перевод ${source.factoryName} → ${destination}`
}

function BarStrip({
  stockLengthMm,
  cuts,
  remainderMm,
  kerfMm,
  endTrimMm,
  cutColors,
}: {
  stockLengthMm: number
  cuts: Array<{ cutNumber: number; workpieceId: string; lengthMm: number }>
  remainderMm: number
  kerfMm: number
  endTrimMm: number
  cutColors: ReadonlyMap<number, string>
}) {
  return (
    <div className="mt-3 flex h-12 w-full overflow-hidden rounded-md border border-slate-300 bg-slate-100" aria-label={`Пропорциональная раскладка хлыста ${formatMm(stockLengthMm)} мм`}>
      {endTrimMm > 0 && <div className="bg-slate-400" style={{ width: `${endTrimMm / stockLengthMm * 100}%` }} title={`Торцовка ${formatMm(endTrimMm)} мм`} />}
      {cuts.map((cut) => (
        <span key={cut.workpieceId} className="contents">
          <span
            className="flex min-w-0 items-center justify-center overflow-hidden border-l-2 border-white px-1 text-[11px] font-semibold text-white"
            style={{
              width: `${cut.lengthMm / stockLengthMm * 100}%`,
              backgroundColor: cutColors.get(cut.lengthMm) ?? 'hsl(213 68% 43%)',
            }}
            title={`${cutDisplayLabel(cut.cutNumber)}: ${formatMm(cut.lengthMm)} мм`}
          >
            {shouldShowBarSegmentLabel(cut.lengthMm, stockLengthMm) && <span className="whitespace-nowrap">№{cut.cutNumber} · {formatMm(cut.lengthMm)}</span>}
          </span>
          {kerfMm > 0 && <span className="border-l border-white bg-slate-900" style={{ width: `${kerfMm / stockLengthMm * 100}%` }} title={`Пропил ${formatMm(kerfMm)} мм`} />}
        </span>
      ))}
      <span
        className="flex min-w-0 items-center justify-center overflow-hidden border-l-2 border-white bg-emerald-200 px-1 text-[11px] font-medium text-emerald-950"
        style={{ width: `${Math.max(remainderMm, 0) / stockLengthMm * 100}%` }}
        title={`Остаток ${formatMm(remainderMm)} мм`}
      >
        {shouldShowBarSegmentLabel(remainderMm, stockLengthMm) && <span className="whitespace-nowrap">остаток {formatMm(remainderMm)}</span>}
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
            <div key={`${bar.source}-${bar.stockSourceId ?? 'new'}-${barIndex}`} className={cn('rounded-lg border p-3', remainder < 0 && 'border-red-300 bg-red-50/50')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">
                  Хлыст №{barIndex + 1}
                  {bar.source !== 'new_stock' ? (
                    <Badge variant="secondary">
                      {formatMm(bar.stockLengthMm)} мм · {longStockBarSourceLabel(bar.source, bar.availableFromDate ?? null)}
                    </Badge>
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
                        <span className="font-medium">{cutDisplayLabel(cutIndex + 1)}</span>
                        <span className="ml-2 tabular-nums text-slate-600">{formatMm(segmentById.get(cut.workpieceId)?.lengthMm ?? 0)} мм</span>
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

function planningRecoverySegmentRows(segments: readonly LongStockPlanSegmentInput[]): LongStockSegmentRow[] {
  if (segments.length === 0) {
    return [{ id: 'planning-recovery-row-1', lengthMm: '', quantity: 1 }]
  }
  const grouped = new Map<number, number>()
  for (const segment of segments) {
    grouped.set(segment.lengthMm, (grouped.get(segment.lengthMm) ?? 0) + 1)
  }
  return Array.from(grouped, ([lengthMm, quantity], index) => ({
    id: `planning-recovery-row-${index + 1}`,
    lengthMm,
    quantity,
  })).sort((left, right) => Number(right.lengthMm) - Number(left.lengthMm))
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
    const roundDiameter = variant.pipe_type === 'round' ? roundPipeOuterDiameterMm(variant) : null
    return [
      variant.pipe_type && PIPE_SUBTYPE_LABELS[variant.pipe_type],
      roundDiameter ? `Ø${formatMm(roundDiameter)} мм` : variant.piece_description,
      variant.wall_thickness_mm && `стенка ${formatMm(variant.wall_thickness_mm)} мм`,
      variant.material_grade,
    ].filter(Boolean).join(' · ') || 'Точный вариант'
  }
  const dimensions = formatKnifeProfileDimensions(variant)
  return [dimensions, variant.knife_material ?? variant.material_grade, `Скос: ${knifeBevelCharacteristicLabel(variant.knife_bevel_count)}`].filter(Boolean).join(' · ') || 'Точный вариант'
}

function remainderWeight(candidate: LongStockCuttingCandidate, weightPerMeterKg: number | null) {
  if (weightPerMeterKg === null) return null
  const weight = Number(weightPerMeterKg)
  return Number.isFinite(weight) && weight > 0 ? candidate.totalRemainderMm / 1000 * weight : null
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

function isMaterialErrorMessage(message: string) {
  return /материал|вариант|тип металла|марка|диаметр|толщина стенки|размер трубы|скос/i.test(message)
}
