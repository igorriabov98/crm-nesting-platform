import { notFound } from 'next/navigation'
import { withPagePermission } from '@/lib/permissions/page-guard'
import { getStockMaterialRequest } from '@/lib/actions/stock-material-requests'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { StockMaterialRequestEditor } from '@/components/features/material-requests/StockMaterialRequestEditor'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = { title: 'Заявка на склад | Заказы снабжения' }

async function SupplyStockRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const [result, steelTypes] = await Promise.all([getStockMaterialRequest(requestId), getSteelTypes()])
  if (!result.data) notFound()
  return <StockMaterialRequestEditor {...result.data} data={result.data.payload}
    canManage={false} steelTypes={steelTypes} backHref={ROUTES.SUPPLY_ORDERS} />
}

export default withPagePermission('/supply/orders/stock/sample-id', SupplyStockRequestPage)
