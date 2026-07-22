import { OutsourcingTransportPage } from '@/components/features/supply/OutsourcingTransportPage'
import { getOutsourcingTransportWorkspace } from '@/lib/actions/outsourcing'
import { DetailingTransportPanel } from '@/components/features/supply/DetailingTransportPanel'
import { getDetailingTransportWorkspace } from '@/lib/actions/detailing'
import { InventoryTransferPanel } from '@/components/features/supply/InventoryTransferPanel'
import { getInventoryTransportWorkspace } from '@/lib/actions/inventory-transfers'

export const metadata = { title: 'Транспорт | CRM Завода' }

export default async function SupplyTransportPage() {
  const [{ data, error }, detailingResult, inventoryTransferResult] = await Promise.all([
    getOutsourcingTransportWorkspace(),
    getDetailingTransportWorkspace(),
    getInventoryTransportWorkspace(),
  ])

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-blue-950">Транспорт аутсорсинга</h1>
        <p className="text-red-700">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <InventoryTransferPanel cards={inventoryTransferResult.data || []} error={inventoryTransferResult.error} />
      <DetailingTransportPanel cards={detailingResult.data || []} error={detailingResult.error} />
      <OutsourcingTransportPage workspace={data} />
    </div>
  )
}
