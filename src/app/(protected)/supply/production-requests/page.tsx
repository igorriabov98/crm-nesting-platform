import { withPagePermission } from '@/lib/permissions/page-guard'
import { ConsumableRequestsPage } from '@/components/features/consumables/ConsumableRequestsPage'
import { getConsumableRequestsPageData } from '@/lib/actions/consumables'

export const metadata = { title: 'Надобности производства — CRM Завода' }

async function SupplyConsumableRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams
  const data = await getConsumableRequestsPageData('supply', params?.factory || 'all')
  return <ConsumableRequestsPage {...data} />
}

export default withPagePermission('/supply/production-requests', SupplyConsumableRequestsPage)
