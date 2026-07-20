import { DetailingWarehousePage } from '@/components/features/inventory/DetailingWarehousePage'
import { getDetailingWarehouse } from '@/lib/actions/detailing'

export const metadata = { title: 'Деталировка - CRM Завода' }

export default async function DetailingInventoryRoute({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const result = await getDetailingWarehouse()
  const activeFactory = result.data?.factories.find((factory) => factory.id === resolvedSearchParams?.factory)
    || result.data?.factories[0]
    || null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Деталировка</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Готовые детали, совместимость с изделиями, остатки и бронь по заводам.</p>
      </div>
      {result.error || !result.data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{result.error || 'Не удалось загрузить деталировку'}</div>
      ) : (
        <DetailingWarehousePage data={result.data} activeFactoryId={activeFactory?.id || null} />
      )}
    </div>
  )
}
