import Link from 'next/link'
import { InventoryHistoryPage } from '@/components/features/inventory/InventoryHistoryPage'
import { getTransactions } from '@/lib/actions/inventory'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = {
  title: 'История склада - CRM Завода',
}

export default async function InventoryHistoryRoute({
  params,
  searchParams,
}: {
  params: Promise<{ materialId: string }>
  searchParams?: Promise<{ page?: string }>
}) {
  const { materialId } = await params
  const resolvedSearchParams = await searchParams
  const page = Math.max(0, Number(resolvedSearchParams?.page || 1) - 1)
  const { data, error, pagination } = await getTransactions({ material_id: materialId, page, pageSize: 50 })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1B3A6B]">История движения склада</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Приходы, бронирования, снятия брони и корректировки.</p>
        </div>
        <Link href={ROUTES.INVENTORY} className="text-sm font-medium text-[#1B3A6B] hover:underline">Вернуться на склад</Link>
      </div>
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      ) : (
        <InventoryHistoryPage
          rows={data || []}
          materialId={materialId}
          page={pagination?.page || page}
          pageSize={pagination?.pageSize || 50}
          total={pagination?.total || 0}
        />
      )}
    </div>
  )
}
