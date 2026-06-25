import { MaterialReceivingPage } from '@/components/features/inventory/MaterialReceivingPage'
import { getMaterialReceivingPageData } from '@/lib/actions/supply-orders'

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

  return <MaterialReceivingPage data={data} />
}
