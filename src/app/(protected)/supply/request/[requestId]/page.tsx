import { notFound } from 'next/navigation'
import { SupplyRequestPage } from '@/components/features/supply-request/SupplyRequestPage'
import { getRequestForSupply } from '@/lib/actions/supply-request'

export const metadata = {
  title: 'Заявка для снабжения | CRM Завода',
}

export default async function SupplyRequestRoute({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params
  const { data, error } = await getRequestForSupply(requestId)

  if (error || !data) notFound()

  return <SupplyRequestPage data={data} />
}
