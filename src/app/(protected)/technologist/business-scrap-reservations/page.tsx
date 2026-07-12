import { BusinessScrapQueue } from '@/components/features/business-scrap/BusinessScrapQueue'
import { getBusinessScrapReservationQueue } from '@/lib/actions/business-scrap-corrections'

export const metadata = { title: 'Бронь делового остатка | CRM Завода' }

export default async function BusinessScrapReservationsPage() {
  const result = await getBusinessScrapReservationQueue()
  if (!result.data || result.error) {
    return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">Ошибка загрузки: {result.error || 'Неизвестная ошибка'}</div>
  }
  return <BusinessScrapQueue items={result.data.items} canViewAll={result.data.canViewAll} />
}
