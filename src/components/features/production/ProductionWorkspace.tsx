"use client"

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarCheck, CheckCircle2, Factory, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { ProductionPlanner } from '@/components/features/production/ProductionPlanner'
import { STAGE_ORDER } from '@/lib/constants/stages'
import { markProductionMonthPlanStatus, type ProductionMonthPlanSummary } from '@/lib/actions/production-plan'
import { formatProductionMonth } from '@/lib/utils/production-months'
import { useRole } from '@/lib/hooks/useRole'
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
  monthPlanError?: string | null
}

const PRODUCTION_PLAN_STAGE_ORDER = STAGE_ORDER.filter((stage) => stage !== 'actual_shipping')

const defaultGanttFilters: GanttFilters = {
  search: '',
  workshop: '',
  confirmation: '',
  productionMonth: '',
  showSupply: false,
  visibleStages: [...PRODUCTION_PLAN_STAGE_ORDER],
}

function planStatusText(status: ProductionMonthPlanSummary['status'] | 'draft') {
  if (status === 'confirmed') return 'Подтверждён'
  if (status === 'preliminary_ready') return 'Предварительно готов'
  return 'Черновик'
}

function ProductionMonthPlanPanel({
  factoryId,
  selectedMonth,
  plans,
  error,
}: {
  factoryId: string
  selectedMonth: string
  plans: ProductionMonthPlanSummary[]
  error?: string | null
}) {
  const router = useRouter()
  const { role, isDirector, isProductionManager, isSalesManager } = useRole()
  const [savingStatus, setSavingStatus] = useState<'preliminary_ready' | 'confirmed' | null>(null)
  const plan = useMemo(
    () => plans.find((item) => item.factory_id === factoryId && item.production_month === selectedMonth) || null,
    [factoryId, plans, selectedMonth],
  )
  const status = plan?.status || 'draft'
  const canManage = Boolean(role && (isDirector || isProductionManager || isSalesManager))
  const hasSelectedMonth = Boolean(selectedMonth)
  const isConfirmed = status === 'confirmed'

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
            </div>
            {error && <div className="mt-1 text-sm text-red-700">{error}</div>}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canManage || !hasSelectedMonth || isConfirmed || savingStatus !== null || status === 'preliminary_ready'}
            onClick={() => markStatus('preliminary_ready')}
            className="min-h-11 gap-2 px-3 sm:min-h-10"
          >
            {savingStatus === 'preliminary_ready' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
            Предварительно готов
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canManage || !hasSelectedMonth || isConfirmed || savingStatus !== null}
            onClick={() => markStatus('confirmed')}
            className="min-h-11 gap-2 bg-emerald-700 px-3 text-white hover:bg-emerald-800 sm:min-h-10"
          >
            {savingStatus === 'confirmed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Подтвердить план
          </Button>
        </div>
      </div>
    </section>
  )
}

export function ProductionWorkspace({
  factories,
  activeFactoryId,
  ganttData,
  productionData,
  monthPlans,
  monthPlanError,
}: ProductionWorkspaceProps) {
  const [plannerFilters, setPlannerFilters] = useState<GanttFilters>(defaultGanttFilters)

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
        factoryId={activeFactoryId}
        selectedMonth={plannerFilters.productionMonth}
        plans={monthPlans}
        error={monthPlanError}
      />

      <ProductionPlanner
        data={ganttData}
        productionData={productionData}
        monthPlans={monthPlans}
        filters={plannerFilters}
        onFiltersChange={setPlannerFilters}
      />
    </div>
  )
}
