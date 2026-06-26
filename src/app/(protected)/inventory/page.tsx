import { InventoryPage } from '@/components/features/inventory/InventoryPage'
import { getInventory, getInventoryFactories } from '@/lib/actions/inventory'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getSuppliers } from '@/lib/actions/suppliers'
import { INVENTORY_LIST_LIMIT } from '@/lib/constants/performance-limits'

export const metadata = {
  title: 'Склад - CRM Завода',
}

export default async function InventoryRoute({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const factoriesResult = await getInventoryFactories()
  const factories = factoriesResult.data || []
  const activeFactory = factories.find((factory) => factory.id === resolvedSearchParams?.factory) || factories[0] || null
  const activeFactoryId = activeFactory?.id || null

  const [{ data, error }, suppliersResult, steelTypes] = await Promise.all([
    activeFactoryId ? getInventory({ factory_id: activeFactoryId }) : Promise.resolve({ data: [], error: factoriesResult.error }),
    getSuppliers({ active_only: true }),
    getSteelTypes(),
  ])
  const pageError = factoriesResult.error || error

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Склад</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Остатки материалов, приходы, корректировки и бронирование под машины.</p>
      </div>
      {pageError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{pageError}</div>
      ) : (
        <InventoryPage
          items={data || []}
          factories={factories}
          activeFactoryId={activeFactoryId}
          suppliers={suppliersResult.data || []}
          steelTypes={steelTypes}
          resultLimit={INVENTORY_LIST_LIMIT}
        />
      )}
    </div>
  )
}
