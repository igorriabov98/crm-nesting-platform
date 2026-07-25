import { notFound } from 'next/navigation'
import { SupplyRequestPage } from '@/components/features/supply-request/SupplyRequestPage'
import { getRequestForSupply } from '@/lib/actions/supply-request'
import { getDetailingRequestWorkspace } from '@/lib/actions/detailing'
import { isBusinessScrapReservationStatus } from '@/lib/supply-request-flow'

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

  const detailing = isBusinessScrapReservationStatus(data.request.status)
    ? (await getDetailingRequestWorkspace(requestId)).data
    : null

  return <SupplyRequestPage data={data} detailing={detailing} />
}
