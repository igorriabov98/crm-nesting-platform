import { AccessDenied } from '@/components/ui/AccessDenied'
import { ClientPricesPage } from '@/components/features/client-prices/ClientPricesPage'
import { getClientPricesPageData } from '@/lib/actions/client-product-prices'

export const metadata = {
  title: 'Цены клиентов — CRM Завода',
}

export default async function SalesPlanPricesPage({
  searchParams,
}: {
  searchParams?: Promise<{ clientId?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const result = await getClientPricesPageData(resolvedSearchParams?.clientId || null)

  if (!result.data) {
    if (result.error?.toLowerCase().includes('прав')) return <AccessDenied />
    return (
      <div className="rounded-lg border border-red-200 bg-white p-5 text-red-700">
        Не удалось загрузить цены: {result.error || 'неизвестная ошибка'}
      </div>
    )
  }

  return (
    <ClientPricesPage
      clients={result.data.clients}
      selectedClientId={result.data.selectedClientId}
      rows={result.data.rows}
      canManage={result.data.canManage}
    />
  )
}
