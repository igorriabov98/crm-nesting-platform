import { withPagePermission } from '@/lib/permissions/page-guard'
import { ConsumableRequestsPage } from '@/components/features/consumables/ConsumableRequestsPage'
import { getConsumableRequestsPageData } from '@/lib/actions/consumables'

export const metadata = { title: 'Заявки на расходники — CRM Завода' }

async function ProductionConsumableRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const params = await searchParams
  const data = await getConsumableRequestsPageData('production', params?.factory)
  return <ConsumableRequestsPage {...data} />
}

export default withPagePermission('/production/consumable-requests', ProductionConsumableRequestsPage)
