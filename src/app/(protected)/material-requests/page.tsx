import { withPagePermission } from '@/lib/permissions/page-guard'
import { MaterialRequestsWorkspace } from '@/components/features/material-requests/MaterialRequestsWorkspace'
import { getMaterialRequestQueue } from '@/lib/actions/material-request-queue'
import { getStockMaterialRequests } from '@/lib/actions/stock-material-requests'

export const metadata = {
  title: 'Заявки на материалы | CRM Завода',
}

async function MaterialRequestsPage() {
  const [result, stock] = await Promise.all([getMaterialRequestQueue(), getStockMaterialRequests()])

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

  if (stock.error || !stock.data) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      Ошибка загрузки заявок на склад: {stock.error || 'Неизвестная ошибка'}
    </div>
  }

  return (
    <MaterialRequestsWorkspace
      items={result.data.items}
      canViewAll={result.data.canViewAll}
      stockItems={stock.data.items}
      factories={stock.data.factories}
      canCreateStock={stock.data.canCreate}
    />
  )
}

export default withPagePermission('/material-requests', MaterialRequestsPage)
