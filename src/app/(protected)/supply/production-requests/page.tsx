import { ConsumableRequestsPage } from '@/components/features/consumables/ConsumableRequestsPage'
import { getConsumableRequestsPageData } from '@/lib/actions/consumables'

export const metadata = { title: 'Заявки производства — CRM Завода' }

export default async function SupplyConsumableRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams
  const data = await getConsumableRequestsPageData('supply', params?.factory || 'all')
  return <ConsumableRequestsPage {...data} />
}
