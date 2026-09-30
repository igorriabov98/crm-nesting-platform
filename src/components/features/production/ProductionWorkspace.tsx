"use client"

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarCheck, CheckCircle2, Factory, History, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ProductionPlanner } from '@/components/features/production/ProductionPlanner'
import { STAGE_ORDER } from '@/lib/constants/stages'
import { markProductionMonthPlanStatus, type ProductionMonthPlanSummary } from '@/lib/actions/production-plan'
import {
  getProductionPlanVersionHistory, previewProductionPlanRestore,
  previewProductionPlanDraft, publishProductionPlanDraft, restoreProductionPlanVersion,
  type ProductionPlanDraftSummary, type ProductionPlanVersionSummary,
} from '@/lib/actions/production-plan-versions'
import type { ProductionOutsourcingSummary } from '@/lib/actions/outsourcing'
import { formatProductionMonth } from '@/lib/utils/production-months'
import { cn } from '@/lib/utils'
import type { GanttData } from '@/app/(protected)/production/gantt/actions'
import type { ProductionRow } from '@/app/(protected)/production/actions'
import type { GanttFilters } from '@/components/features/production/gantt/GanttControls'
import type { FactorySummary } from '@/lib/types'

interface ProductionWorkspaceProps {
  factories: FactorySummary[]
  activeFactoryId: string
  ganttData: GanttData
  productionData: ProductionRow[]
  monthPlans: ProductionMonthPlanSummary[]
  drafts: ProductionPlanDraftSummary[]
  canManageFactory: boolean
  outsourcingSummary: ProductionOutsourcingSummary
  monthPlanError?: string | null
}

const PRODUCTION_PLAN_STAGE_ORDER = STAGE_ORDER.filter((stage) => stage !== 'actual_shipping')

const defaultGanttFilters: GanttFilters = {
  search: '',
  workshop: '',
  confirmation: '',
  productionMonth: '',
  showSupply: true,
  visibleStages: [...PRODUCTION_PLAN_STAGE_ORDER],
}

function planStatusText(status: ProductionMonthPlanSummary['status'] | 'draft') {
  if (status === 'confirmed') return 'Подтверждён'
  if (status === 'preliminary_ready') return 'Предварительно готов'
  return 'Черновик'
}

function versionKindText(kind: ProductionPlanVersionSummary['change_kind']) {
  if (kind === 'baseline') return 'исходный план'
  if (kind === 'status') return 'смена статуса'
  if (kind === 'restore') return 'восстановление'
  return 'обновление графика'
}

function ProductionMonthPlanPanel({
  factoryId,
  selectedMonth,
  plans,
  drafts,
  canManageFactory,
  factories,
  error,
}: {
  factoryId: string
  selectedMonth: string
  plans: ProductionMonthPlanSummary[]
  drafts: ProductionPlanDraftSummary[]
  canManageFactory: boolean
  factories: FactorySummary[]
  error?: string | null
}) {
  const router = useRouter()
  const [savingStatus, setSavingStatus] = useState<'preliminary_ready' | 'confirmed' | null>(null)
  const [savingVersion, setSavingVersion] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ProductionPlanVersionSummary[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [restorePreview, setRestorePreview] = useState<Awaited<ReturnType<typeof previewProductionPlanRestore>> | null>(null)
  const [draftPreview, setDraftPreview] = useState<Awaited<ReturnType<typeof previewProductionPlanDraft>> | null>(null)
  const [draftPreviewRevision, setDraftPreviewRevision] = useState<number | null>(null)
  const plan = useMemo(
    () => plans.find((item) => item.factory_id === factoryId && item.production_month === selectedMonth) || null,
    [factoryId, plans, selectedMonth],
  )
  const status = plan?.status || 'draft'
  const draft = drafts.find((item) => item.factory_id === factoryId && item.production_month === selectedMonth)
  const draftCount = Object.keys(draft?.changes ?? {}).length
  const canManage = canManageFactory
  const hasSelectedMonth = Boolean(selectedMonth)
  const isConfirmed = status === 'confirmed'

  async function publish() {
    if (!selectedMonth || !draft || draftCount === 0) return
    setSavingVersion(true)
    try {
      const result = await publishProductionPlanDraft(factoryId, selectedMonth, draft.revision)
      if (!result.success) throw new Error(result.error || 'Не удалось обновить график')
      toast.success(`График обновлён · версия ${result.version}`)
      if (result.warning) toast.warning(result.warning)
      setRestorePreview(null)
      setDraftPreview(null)
      router.refresh()
    } catch (publishError) {
      toast.error(publishError instanceof Error ? publishError.message : 'Не удалось обновить график')
    } finally {
      setSavingVersion(false)
    }
  }

  async function previewDraft() {
    if (!selectedMonth || draftCount === 0) return
    try {
      setDraftPreview(await previewProductionPlanDraft(factoryId, selectedMonth))
      setDraftPreviewRevision(draft?.revision ?? null)
    } catch (previewError) {
      toast.error(previewError instanceof Error ? previewError.message : 'Не удалось сравнить черновик')
    }
  }

  async function openHistory() {
    if (!selectedMonth) return
    try {
      const versions = await getProductionPlanVersionHistory(factoryId, selectedMonth)
      setHistory(versions)
      setHistoryOpen(true)
      setSelectedVersionId('')
      setRestorePreview(null)
    } catch (historyError) {
      toast.error(historyError instanceof Error ? historyError.message : 'Не удалось загрузить версии')
    }
  }

  async function previewRestore() {
    if (!selectedMonth || !selectedVersionId) return
    try {
      setRestorePreview(await previewProductionPlanRestore(factoryId, selectedMonth, selectedVersionId))
    } catch (previewError) {
      toast.error(previewError instanceof Error ? previewError.message : 'Не удалось сравнить версии')
    }
  }

  async function restore() {
    if (!selectedMonth || !selectedVersionId || !restorePreview || restorePreview.blockers.length > 0) return
    const affected = restorePreview.affectedMonths.map((item) => (
      `${factories.find((factory) => factory.id === item.factoryId)?.name || item.factoryId} · ${formatProductionMonth(item.month)}`
    )).join(', ')
    if (!window.confirm(`Восстановить выбранную версию? Будут обновлены планы: ${affected}.`)) return
    setSavingVersion(true)
    try {
      const result = await restoreProductionPlanVersion(factoryId, selectedMonth, selectedVersionId, plan?.published_version_number ?? 0)
      if (!result.success) throw new Error(result.error || 'Не удалось восстановить график')
      toast.success(`Создана версия ${result.version}`)
      if (result.warning) toast.warning(result.warning)
      setHistoryOpen(false)
      setRestorePreview(null)
      router.refresh()
    } catch (restoreError) {
      toast.error(restoreError instanceof Error ? restoreError.message : 'Не удалось восстановить график')
    } finally {
      setSavingVersion(false)
    }
  }

  async function markStatus(nextStatus: 'preliminary_ready' | 'confirmed') {
    if (!selectedMonth) return
    setSavingStatus(nextStatus)
    try {
      const result = await markProductionMonthPlanStatus(factoryId, selectedMonth, nextStatus)
      if (!result.success) throw new Error(result.error || 'Не удалось обновить статус плана')
      toast.success(nextStatus === 'confirmed' ? 'План подтверждён' : 'План отмечен предварительно готовым')
      router.refresh()
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Не удалось обновить статус плана')
    } finally {
      setSavingStatus(null)
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border',
            isConfirmed
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : status === 'preliminary_ready'
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-slate-200 bg-slate-50 text-slate-600',
          )}>
            {isConfirmed ? <ShieldCheck className="h-5 w-5" /> : <CalendarCheck className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase text-slate-500">Статус плана месяца</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold text-blue-950">
                {hasSelectedMonth ? formatProductionMonth(selectedMonth) : 'Месяц не выбран'}
              </span>
              <span className={cn(
                'rounded-full border px-2.5 py-1 text-xs font-semibold',
                isConfirmed
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : status === 'preliminary_ready'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600',
              )}>
                {planStatusText(status)}
              </span>
              {hasSelectedMonth && <span className="text-xs font-medium text-slate-600">
                {plan?.published_version_number ? `Версия ${plan.published_version_number}` : 'Без опубликованной версии'}
              </span>}
            </div>
            {canManage && draftCount > 0 && <div className="mt-1 text-xs font-medium text-amber-700">
              Общий черновик: {draftCount} {draftCount === 1 ? 'изменение' : 'изменений'} · версия ещё не обновлена
            </div>}
            {error && <div className="mt-1 text-sm text-red-700">{error}</div>}
          </div>
        </div>

        {canManage && <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {draftCount > 0 && <Button type="button" variant="outline" size="sm"
            disabled={savingVersion} onClick={previewDraft} className="min-h-11 sm:min-h-10">
            Изменения черновика
          </Button>}
          <Button type="button" variant="outline" size="sm" disabled={!hasSelectedMonth || savingVersion}
            onClick={openHistory} className="min-h-11 gap-2 sm:min-h-10">
            <History className="h-4 w-4" /> История версий
          </Button>
          <Button type="button" size="sm" disabled={!hasSelectedMonth || draftCount === 0 || savingVersion || savingStatus !== null}
            onClick={publish} className="min-h-11 bg-blue-800 text-white hover:bg-blue-900 sm:min-h-10">
            {savingVersion ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Обновить
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasSelectedMonth || isConfirmed || savingStatus !== null || status === 'preliminary_ready' || draftCount > 0}
            onClick={() => markStatus('preliminary_ready')}
            className="min-h-11 gap-2 px-3 sm:min-h-10"
          >
            {savingStatus === 'preliminary_ready' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
            Предварительно готов
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasSelectedMonth || isConfirmed || savingStatus !== null || draftCount > 0}
            onClick={() => markStatus('confirmed')}
            className="min-h-11 gap-2 bg-emerald-700 px-3 text-white hover:bg-emerald-800 sm:min-h-10"
          >
            {savingStatus === 'confirmed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Подтвердить план
          </Button>
        </div>}
      </div>
      {canManage && draftPreview && draftCount > 0 && draftPreviewRevision === draft?.revision && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-700">
        <div className="font-semibold text-blue-950">Предварительный просмотр черновика</div>
        <div className="mt-1">Затронутые планы: {draftPreview.affectedMonths.map((item) => (
          `${factories.find((factory) => factory.id === item.factoryId)?.name || item.factoryId} · ${formatProductionMonth(item.month)}`
        )).join(', ')}</div>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {draftPreview.changes.map((change, index) => <li key={`${index}:${change}`}>{change}</li>)}
        </ul>
      </div>}
      {canManage && historyOpen && hasSelectedMonth && <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
        <div className="text-sm font-semibold text-blue-950">История опубликованных версий</div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Версия графика для восстановления" value={selectedVersionId}
            onChange={(event) => { setSelectedVersionId(event.target.value); setRestorePreview(null) }}
            className="min-h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-blue-950">
            <option value="">Выберите версию</option>
            {history.map((version) => <option key={version.id} value={version.id}>
              Версия {version.version_number} · {versionKindText(version.change_kind)} · {planStatusText(version.status)} · {new Date(version.created_at).toLocaleString('ru-RU')}
            </option>)}
          </select>
          <Button type="button" variant="outline" size="sm" disabled={!selectedVersionId || savingVersion}
            onClick={previewRestore}>Сравнить с текущим планом</Button>
          <Button type="button" size="sm" disabled={!restorePreview || restorePreview.blockers.length > 0 || draftCount > 0 || savingVersion}
            onClick={restore}>Восстановить как новую версию</Button>
        </div>
        {restorePreview && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <div className="font-medium text-blue-950">Затронутые планы: {restorePreview.affectedMonths.map((item) => (
            `${factories.find((factory) => factory.id === item.factoryId)?.name || item.factoryId} · ${formatProductionMonth(item.month)}`
          )).join(', ')}</div>
          {restorePreview.blockers.map((blocker) => <p key={blocker} className="mt-1 text-red-700">{blocker}</p>)}
          {restorePreview.changes.length === 0 ? <p className="mt-2">Различий нет.</p> : <ul className="mt-2 list-disc space-y-1 pl-5">
            {restorePreview.changes.map((change, index) => <li key={`${index}:${change}`}>{change}</li>)}
          </ul>}
        </div>}
      </div>}
    </section>
  )
}

export function ProductionWorkspace({
  factories,
  activeFactoryId,
  ganttData,
  productionData,
  monthPlans,
  drafts,
  canManageFactory,
  outsourcingSummary,
  monthPlanError,
}: ProductionWorkspaceProps) {
  const [plannerFilters, setPlannerFilters] = useState<GanttFilters>(defaultGanttFilters)
  const visibleOutsourcing = useMemo<ProductionOutsourcingSummary>(() => {
    const changes = drafts.filter((draft) => draft.factory_id === activeFactoryId)
      .flatMap((draft) => Object.values(draft.changes))
      .filter((patch) => patch.target === 'outsourcing')
    const apply = (operations: ProductionOutsourcingSummary['outgoing']) => operations.map((operation) => {
      const patch = changes.find((change) => change.id === operation.id)
      return patch ? { ...operation, ...patch.fields } : operation
    }) as ProductionOutsourcingSummary['outgoing']
    return { outgoing: apply(outsourcingSummary.outgoing), incoming: apply(outsourcingSummary.incoming) }
  }, [activeFactoryId, drafts, outsourcingSummary])
  const ganttDataWithIncomingOutsourcing = useMemo<GanttData>(() => {
    const incomingMachines = visibleOutsourcing.incoming
      .filter((operation) => operation.incoming_date_start && operation.incoming_date_end)
      .map((operation) => ({
        id: `outsourcing:${operation.id}`,
        name: `Аутсорсинг · ${operation.machine_name} · ${operation.work_type_name}`,
        created_at: `${operation.incoming_date_start}T00:00:00.000Z`,
        factory_id: operation.executor_factory_id,
        production_month: operation.incoming_production_month,
        production_workshop: operation.incoming_workshop,
        production_queue_number: operation.incoming_queue_number,
        total_weight: 0,
        is_confirmed: true,
        desired_shipping_date: operation.planned_return_date,
        planned_material_date: null,
        actual_material_date: null,
        actual_shipping_date: null,
        delivery_to_client_date: null,
        coatings: [],
        stages: [{
          id: `outsourcing-stage:${operation.id}`,
          stage_type: 'assembly' as const,
          workshop: operation.incoming_workshop,
          date_start: operation.incoming_date_start!,
          date_end: operation.incoming_date_end!,
          manual_overdue: false,
          is_night_shift: false,
          night_shift_date: null,
          night_shift_dates: [],
          status: 'not_planned' as const,
          delay_days: 0,
          display_label: operation.work_type_name,
          color: '#7C3AED',
        }],
        supply_deadlines: [],
        material_items: [],
        is_outsourcing: true,
        outsourcing_operation_id: operation.id,
        source_machine_id: operation.machine_id,
        vrb_status: null,
      }))

    return {
      ...ganttData,
      machines: [...ganttData.machines, ...incomingMachines],
    }
  }, [ganttData, visibleOutsourcing.incoming])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold leading-tight text-blue-950 sm:text-2xl">Производство</h1>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
          <div className="flex w-full overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-1 sm:w-auto">
            {factories.map((factory) => (
              <Link
                key={factory.id}
                className={cn(
                  'inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 hover:text-blue-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 sm:min-h-10',
                  activeFactoryId === factory.id && 'bg-blue-800 text-white hover:bg-blue-800 hover:text-white'
                )}
                href={`/production?factory=${factory.id}`}
                aria-current={activeFactoryId === factory.id ? 'page' : undefined}
              >
                <Factory className="h-3.5 w-3.5" />
                {factory.name}
              </Link>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 px-3 text-sm text-slate-700 sm:min-h-10"
            onClick={() => setPlannerFilters(defaultGanttFilters)}
          >
            Сбросить фильтры
          </Button>
        </div>
      </div>

      <ProductionMonthPlanPanel
        key={`${activeFactoryId}:${plannerFilters.productionMonth}`}
        factoryId={activeFactoryId}
        selectedMonth={plannerFilters.productionMonth}
        plans={monthPlans}
        drafts={drafts}
        canManageFactory={canManageFactory}
        factories={factories}
        error={monthPlanError}
      />

      <ProductionPlanner
        data={ganttDataWithIncomingOutsourcing}
        productionData={productionData}
        monthPlans={monthPlans}
        drafts={drafts}
        canManageFactory={canManageFactory}
        outsourcingOperations={visibleOutsourcing.outgoing.concat(visibleOutsourcing.incoming)}
        filters={plannerFilters}
        onFiltersChange={setPlannerFilters}
      />
    </div>
  )
}
