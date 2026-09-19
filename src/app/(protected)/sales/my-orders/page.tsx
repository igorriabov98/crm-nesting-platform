import { withPagePermission } from '@/lib/permissions/page-guard'
import { MyOrdersView } from '@/components/features/my-orders/MyOrdersView'
import { loadMyOrdersPageData } from '@/lib/my-orders'

export const metadata = { title: 'Мои заказы — CRM Завода' }
export const dynamic = 'force-dynamic'

async function MyOrdersPage() {
  const orders = await loadMyOrdersPageData()
  return <MyOrdersView orders={orders} />
}

export default withPagePermission('/sales/my-orders', MyOrdersPage)
