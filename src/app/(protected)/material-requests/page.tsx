import { MaterialRequestQueue } from '@/components/features/material-requests/MaterialRequestQueue'
import { getMaterialRequestQueue } from '@/lib/actions/material-request-queue'

export const metadata = {
  title: 'Заявки на материалы | CRM Завода',
}

export default async function MaterialRequestsPage() {
  const result = await getMaterialRequestQueue()

  if (result.error || !result.data) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Заявки на материалы</h1>
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Ошибка загрузки очереди: {result.error || 'Неизвестная ошибка'}
        </div>
      </div>
    )
  }

  return (
    <MaterialRequestQueue
      items={result.data.items}
      canViewAll={result.data.canViewAll}
    />
  )
}
