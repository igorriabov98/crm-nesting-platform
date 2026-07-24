import { ProductionOutsourcingRequestsPage } from '@/components/features/production/ProductionOutsourcingRequestsPage'
import { getProductionOutsourcingSummary } from '@/lib/actions/outsourcing'
import { hasPermission } from '@/lib/permissions/resources'
import { requirePermission } from '@/lib/permissions/server'
import type { FactorySummary } from '@/lib/types'

export const metadata = { title: 'Запросы производства | CRM Завода' }

export default async function ProductionOutsourcingRequestsRoute({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams
  const context = await requirePermission('production_fact', 'view')
  const { data: factoriesData, error: factoriesError } = await context.supabase
    .from('factories')
    .select('id, name')
    .order('name')

  if (factoriesError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-blue-950">Запросы производства</h1>
        <p className="text-red-700">{factoriesError.message}</p>
      </div>
    )
  }

  const allFactories = (factoriesData || []) as FactorySummary[]
  const factories = context.role === 'production_manager'
    ? allFactories.filter((factory) => factory.id === context.factoryId)
    : allFactories
  const requestedFactoryId = params?.factory || ''
  const activeFactoryId = factories.some((factory) => factory.id === requestedFactoryId)
    ? requestedFactoryId
    : factories[0]?.id

  if (!activeFactoryId) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-blue-950">Запросы производства</h1>
        <p className="text-slate-600">Нет доступных заводов.</p>
      </div>
    )
  }

  const { data, error } = await getProductionOutsourcingSummary(activeFactoryId)
  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-blue-950">Запросы производства</h1>
        <p className="text-red-700">{error}</p>
      </div>
    )
  }

  return (
    <ProductionOutsourcingRequestsPage
      key={activeFactoryId}
      factories={factories}
      activeFactoryId={activeFactoryId}
      operations={data.incoming}
      canManage={hasPermission(context.permissions, 'production_fact', 'manage')}
    />
  )
}
