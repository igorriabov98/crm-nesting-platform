import { MaterialReceivingPage } from '@/components/features/inventory/MaterialReceivingPage'
import { getMaterialReceivingPageData } from '@/lib/actions/supply-orders'
import { getDetailingReceivingItems } from '@/lib/actions/detailing'
import { DetailingReceivingPanel } from '@/components/features/inventory/DetailingReceivingPanel'
import { InventoryTransferReceivingPanel } from '@/components/features/inventory/InventoryTransferReceivingPanel'
import { getInventoryTransferReceivingItems } from '@/lib/actions/inventory-transfers'
import { VrbReceivingPanel } from '@/components/features/inventory/VrbReceivingPanel'
import { getVrbReceivingCards } from '@/lib/actions/vrb-outsourcing'

export const metadata = {
  title: 'Прием материала - CRM Завода',
}

export default async function InventoryReceivingRoute({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const { data, error } = await getMaterialReceivingPageData(resolvedSearchParams?.factory || null)
  const [detailingResult, inventoryTransferResult, vrbResult] = await Promise.all([
    getDetailingReceivingItems(),
    getInventoryTransferReceivingItems(),
    getVrbReceivingCards(data?.activeFactoryId || null),
  ])

  if (error || !data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Прием материала</h1>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error || 'Не удалось загрузить прием материала'}
        </div>
      </div>
    )
  }

  const detailingCards = (detailingResult.data || []).filter((card) => !data.activeFactoryId || card.destinationFactoryId === data.activeFactoryId)
  const inventoryTransferCards = (inventoryTransferResult.data || []).filter((card) => !data.activeFactoryId || card.destinationFactoryId === data.activeFactoryId)
  return (
    <div className="space-y-5">
      <VrbReceivingPanel cards={vrbResult.data} error={vrbResult.error} />
      <InventoryTransferReceivingPanel cards={inventoryTransferCards} />
      <DetailingReceivingPanel cards={detailingCards} />
      <MaterialReceivingPage data={data} />
    </div>
  )
}
