import { withPagePermission } from '@/lib/permissions/page-guard'
import { getProductionData } from '@/app/(protected)/production/actions'
import { getGanttData } from '@/app/(protected)/production/gantt/actions'
import { ProductionWorkspace } from '@/components/features/production/ProductionWorkspace'
import { getProductionMonthPlans } from '@/lib/actions/production-plan'
import { getProductionOutsourcingSummary } from '@/lib/actions/outsourcing'
import { requirePermission } from '@/lib/permissions/server'
import type { FactorySummary } from '@/lib/types'

export const metadata = { title: 'Производство — CRM Завода' }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

async function ProductionPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const { supabase } = await requirePermission('production', 'view')
  const { data: factoriesData } = await supabase.from('factories').select('id, name').order('name')
  const allFactories = (factoriesData || []) as FactorySummary[]
  const visibleFactories = allFactories

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

  try {
    [productionResult, ganttData, monthPlansResult, outsourcingSummaryResult] = await Promise.all([
      getProductionData(activeFactoryId),
      getGanttData(activeFactoryId, { showSupply: false }),
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

  return (
    <ProductionWorkspace
      factories={visibleFactories}
      activeFactoryId={activeFactoryId}
      ganttData={ganttData}
      productionData={data}
      monthPlans={monthPlansResult.data}
      monthPlanError={monthPlanError}
      outsourcingSummary={outsourcingSummaryResult.data}
    />
  )
}

export default withPagePermission('/production', ProductionPage)
