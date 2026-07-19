import { notFound } from 'next/navigation'
import { SupplyRequestPage } from '@/components/features/supply-request/SupplyRequestPage'
import { getRequestForSupply } from '@/lib/actions/supply-request'
import { getDetailingRequestWorkspace } from '@/lib/actions/detailing'

export const metadata = {
  title: 'Заявка для снабжения | CRM Завода',
}

export default async function SupplyRequestRoute({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params
  const [{ data, error }, detailingResult] = await Promise.all([
    getRequestForSupply(requestId),
    getDetailingRequestWorkspace(requestId),
  ])

  if (error || !data) notFound()

  return <SupplyRequestPage data={data} detailing={detailingResult.data} />
}
