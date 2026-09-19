import { withPagePermission } from '@/lib/permissions/page-guard'
import { notFound } from 'next/navigation'
import { ClientDetail } from '@/components/features/clients/ClientDetail'
import { getClient, getClientImageUrls } from '@/lib/actions/clients'
import { getClientPricesForClient } from '@/lib/actions/client-product-prices'
import { getContractsByClient } from '@/lib/actions/contracts'
import { requireClientCardAccess } from '@/lib/permissions/commercial-visibility'
import { AccessDenied } from '@/components/ui/AccessDenied'

export const metadata = {
  title: 'Карточка клиента — CRM Завода',
}

async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const canAccess = await requireClientCardAccess(id).then(() => true).catch(() => false)
  if (!canAccess) return <AccessDenied />
  const [{ data, error, invoiceAccess }, { data: contracts, error: contractsError }, { data: imageUrls }, { data: clientPrices }] = await Promise.all([
    getClient(id),
    getContractsByClient(id),
    getClientImageUrls(id),
    getClientPricesForClient(id),
  ])

  if (error || !data) notFound()

  return (
    <ClientDetail
      client={{
        ...data,
        contracts: contracts || [],
        clientSignatureUrl: imageUrls.signature,
        clientStampUrl: imageUrls.stamp,
      }}
      contractsError={contractsError}
      clientPrices={clientPrices}
      canManageInvoices={invoiceAccess.canManage}
    />
  )
}

export default withPagePermission('/clients/sample-id', ClientPage)
