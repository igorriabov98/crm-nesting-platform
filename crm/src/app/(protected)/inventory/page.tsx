import { InventoryPage } from '@/components/features/inventory/InventoryPage'
import { getInventory } from '@/lib/actions/inventory'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getSuppliers } from '@/lib/actions/suppliers'
import { INVENTORY_LIST_LIMIT } from '@/lib/constants/performance-limits'

export const metadata = {
  title: 'Склад - CRM Завода',
}

export default async function InventoryRoute() {
  const [{ data, error }, suppliersResult, steelTypes] = await Promise.all([
    getInventory(),
    getSuppliers({ active_only: true }),
    getSteelTypes(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Склад</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Остатки материалов, приходы, корректировки и бронирование под машины.</p>
      </div>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      ) : (
        <InventoryPage
          items={data || []}
          suppliers={suppliersResult.data || []}
          steelTypes={steelTypes}
          resultLimit={INVENTORY_LIST_LIMIT}
        />
      )}
    </div>
  )
}
