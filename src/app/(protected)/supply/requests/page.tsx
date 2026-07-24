import { SupplyOutsourcingRequestsPage } from '@/components/features/supply/SupplyOutsourcingRequestsPage'
import { getSupplyOutsourcingRequests } from '@/lib/actions/outsourcing'

export const metadata = { title: 'Запросы аутсорсинга | CRM Завода' }

export default async function SupplyOutsourcingRequestsRoute() {
  const { data, error } = await getSupplyOutsourcingRequests()

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-blue-950">Запросы на аутсорсинг</h1>
        <p className="text-red-700">{error}</p>
      </div>
    )
  }

  return <SupplyOutsourcingRequestsPage agreements={data} />
}
