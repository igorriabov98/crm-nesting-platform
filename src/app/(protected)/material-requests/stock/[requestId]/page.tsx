import { notFound } from 'next/navigation'
import { withPagePermission } from '@/lib/permissions/page-guard'
import { getStockMaterialRequest } from '@/lib/actions/stock-material-requests'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { StockMaterialRequestEditor } from '@/components/features/material-requests/StockMaterialRequestEditor'

export const metadata = { title: 'Заявка на склад | CRM Завода' }

async function StockRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const [result, steelTypes] = await Promise.all([getStockMaterialRequest(requestId), getSteelTypes()])
  if (!result.data) notFound()
  return <StockMaterialRequestEditor {...result.data} data={result.data.payload} steelTypes={steelTypes} />
}

export default withPagePermission('/material-requests/stock/sample-id', StockRequestPage)
