import { SupplyMaterialRequestQueue } from '@/components/features/supply-material-requests/SupplyMaterialRequestQueue'
import { getSupplyMaterialRequestQueue } from '@/lib/actions/supply-material-request-queue'

export const metadata = {
  title: 'Бронь склада | CRM Завода',
}

export const dynamic = 'force-dynamic'

export default async function SupplyMaterialRequestsPage() {
  const result = await getSupplyMaterialRequestQueue()

  if (result.error || !result.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Бронь склада</h1>
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Ошибка загрузки очереди: {result.error || 'Неизвестная ошибка'}
        </div>
      </div>
    )
  }

  return <SupplyMaterialRequestQueue items={result.data.items} factories={result.data.factories} />
}
