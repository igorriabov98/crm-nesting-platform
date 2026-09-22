import { withPagePermission } from '@/lib/permissions/page-guard'
import { notFound } from 'next/navigation'
import { SupplyRequestPage } from '@/components/features/supply-request/SupplyRequestPage'
import { getRequestForSupply } from '@/lib/actions/supply-request'
import { getDetailingRequestWorkspace } from '@/lib/actions/detailing'

export const metadata = {
  title: 'Заявка для снабжения | CRM Завода',
}

async function SupplyRequestRoute({
  params,
}: {
  params: Promise<{ requestId: string }>
}) {
  const { requestId } = await params
  const { data, error } = await getRequestForSupply(requestId)

  if (error || !data) notFound()

  const detailing = ['pending_stock_check', 'stock_checked'].includes(data.request.status)
    ? (await getDetailingRequestWorkspace(requestId)).data
    : null

  return <SupplyRequestPage data={data} detailing={detailing} />
}

export default withPagePermission('/supply/request/sample-id', SupplyRequestRoute)
