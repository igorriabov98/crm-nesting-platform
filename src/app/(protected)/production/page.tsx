import { withPagePermission } from '@/lib/permissions/page-guard'
import { getProductionData } from '@/app/(protected)/production/actions'
import { getGanttData } from '@/app/(protected)/production/gantt/actions'
import { ProductionWorkspace } from '@/components/features/production/ProductionWorkspace'
import { getProductionMonthPlans } from '@/lib/actions/production-plan'
import { getProductionOutsourcingSummary } from '@/lib/actions/outsourcing'
import { requirePermission } from '@/lib/permissions/server'
import { hasPermission } from '@/lib/permissions/resources'
import { canAccessAllFactories, canAccessFactory } from '@/lib/permissions/factory-scope'
import { getProductionPlanDraftsForFactory } from '@/lib/actions/production-plan-versions'
import { applyProductionPlanDraftOverlay } from '@/lib/production-plan-draft-overlay'
import type { ProductionPlanDraftSummary } from '@/lib/actions/production-plan-versions'
import type { FactorySummary } from '@/lib/types'

export const metadata = { title: 'Производство — CRM Leda' }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

async function ProductionPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const permission = await requirePermission('production', 'view')
  const { supabase } = permission
  const { data: factoriesData } = await supabase.from('factories').select('id, name').order('name')
  const allFactories = (factoriesData || []) as FactorySummary[]
  const visibleFactories = allFactories.filter((factory) =>
    canAccessFactory(permission, 'production', 'view', factory.id))

  const requestedFactory = resolvedSearchParams?.factory || ''
  const activeFactoryId = visibleFactories.some((factory) => factory.id === requestedFactory)
    ? requestedFactory
    : visibleFactories[0]?.id

  if (!activeFactoryId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Производство</h1>
        <p className="text-[#6B7280]">Нет доступных заводов для отображения.</p>
      </div>
    )
  }

  let productionResult: Awaited<ReturnType<typeof getProductionData>>
  let ganttData: Awaited<ReturnType<typeof getGanttData>>
  let monthPlansResult: Awaited<ReturnType<typeof getProductionMonthPlans>>
  let outsourcingSummaryResult: Awaited<ReturnType<typeof getProductionOutsourcingSummary>>
  let drafts: ProductionPlanDraftSummary[] = []

  const canManage = hasPermission(permission.permissions, 'production', 'manage')
  const canManageFactory = canManage && canAccessFactory(permission, 'production', 'manage', activeFactoryId)
  const allFactoryDrafts = canManage && canAccessAllFactories(permission, 'production', 'manage')
  const dataFactory = allFactoryDrafts ? 'all' : activeFactoryId

  try {
    drafts = canManage
      ? (await Promise.all((allFactoryDrafts ? visibleFactories : visibleFactories.filter((factory) => factory.id === activeFactoryId && canManageFactory))
        .map((factory) => getProductionPlanDraftsForFactory(factory.id)))).flat()
      : []
    const draftMachineIds: string[] = [...new Set(drafts.flatMap((draft) => Object.values(draft.changes)
      .filter((patch) => patch.target === 'machine').map((patch) => patch.id)))];
    [productionResult, ganttData, monthPlansResult, outsourcingSummaryResult] = await Promise.all([
      getProductionData(dataFactory, draftMachineIds),
      getGanttData(dataFactory, { showSupply: false }, draftMachineIds),
      getProductionMonthPlans(activeFactoryId),
      getProductionOutsourcingSummary(activeFactoryId),
    ])
  } catch (error: unknown) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Производство</h1>
        <p className="text-[#DC2626]">Ошибка загрузки Гант-графика: {getErrorMessage(error)}</p>
      </div>
    )
  }

  const { data, error } = productionResult
  const monthPlanError = monthPlansResult.error

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Производство</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: {error}</p>
      </div>
    )
  }

  const editorView = canManage
    ? applyProductionPlanDraftOverlay(data, [ganttData], drafts, activeFactoryId)
    : { productionData: data, ganttData }

  return (
    <ProductionWorkspace
      factories={visibleFactories}
      activeFactoryId={activeFactoryId}
      ganttData={editorView.ganttData}
      productionData={editorView.productionData}
      monthPlans={monthPlansResult.data}
      drafts={canManage ? drafts : []}
      canManageFactory={canManageFactory}
      monthPlanError={monthPlanError}
      outsourcingSummary={outsourcingSummaryResult.data}
    />
  )
}

export default withPagePermission('/production', ProductionPage)
