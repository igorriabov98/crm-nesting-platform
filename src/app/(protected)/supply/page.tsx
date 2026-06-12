import { getSupplyDashboard } from './actions'
import { SupplyDashboard } from '@/components/features/supply/SupplyDashboard'
import { getOrdersSummary } from '@/lib/actions/supply-orders'
import { getSupplyRequestCards } from '@/lib/actions/supply-request'
import { SUPPLY_DASHBOARD_MACHINE_LIMIT } from '@/lib/constants/performance-limits'

export const metadata = { title: 'Дашборд снабжения — CRM Завода' }

export default async function SupplyPage({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const factoryFilter = resolvedSearchParams?.factory || 'all'
  let data
  let ordersSummary = null
  let requestCards = []

  try {
    const [dashboardData, { data: summary }, { data: cards }] = await Promise.all([
      getSupplyDashboard(factoryFilter),
      getOrdersSummary(),
      getSupplyRequestCards(),
    ])
    data = dashboardData
    ordersSummary = summary
    requestCards = cards || []
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Неизвестная ошибка'
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Дашборд снабжения</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: {message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Дашборд снабжения</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          Общая сводка по поставкам и комплектации машин
        </p>
      </div>

      <SupplyDashboard
        data={data}
        ordersSummary={ordersSummary}
        requestCards={requestCards}
        resultLimit={SUPPLY_DASHBOARD_MACHINE_LIMIT}
      />
    </div>
  )
}

