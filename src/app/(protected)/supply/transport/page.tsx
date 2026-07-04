import { OutsourcingTransportPage } from '@/components/features/supply/OutsourcingTransportPage'
import { getOutsourcingTransportWorkspace } from '@/lib/actions/outsourcing'

export const metadata = { title: 'Транспорт аутсорсинга | CRM Завода' }

export default async function SupplyTransportPage() {
  const { data, error } = await getOutsourcingTransportWorkspace()

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-blue-950">Транспорт аутсорсинга</h1>
        <p className="text-red-700">{error}</p>
      </div>
    )
  }

  return <OutsourcingTransportPage workspace={data} />
}
