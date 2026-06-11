import { getProductionData } from '@/app/(protected)/production/actions'
import { getGanttData } from '@/app/(protected)/production/gantt/actions'
import { ProductionWorkspace } from '@/components/features/production/ProductionWorkspace'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { CurrentUser, FactorySummary } from '@/lib/types'

export const metadata = { title: 'Производство — CRM Завода' }

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

export default async function ProductionPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Производство</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: не авторизован</p>
      </div>
    )
  }

  const [{ data: profile }, { data: factoriesData }] = await Promise.all([
    supabase.from('users').select('*, factory:factories(*)').eq('id', user.id).single(),
    supabase.from('factories').select('id, name').order('name'),
  ])

  const currentUser = profile as unknown as CurrentUser | null
  const allFactories = (factoriesData || []) as FactorySummary[]
  const visibleFactories = currentUser?.role === 'production_manager'
    ? allFactories.filter((factory) => factory.id === currentUser.factory_id)
    : allFactories

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

  try {
    [productionResult, ganttData] = await Promise.all([
      getProductionData(activeFactoryId),
      getGanttData(activeFactoryId, { showSupply: false }),
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
    />
  )
}
