import { notFound } from 'next/navigation'
import { ClientDetail } from '@/components/features/clients/ClientDetail'
import { getClient, getClientImageUrls } from '@/lib/actions/clients'
import { getContractsByClient } from '@/lib/actions/contracts'

export const metadata = {
  title: 'Карточка клиента — CRM Завода',
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [{ data, error }, { data: contracts, error: contractsError }, { data: imageUrls }] = await Promise.all([
    getClient(id),
    getContractsByClient(id),
    getClientImageUrls(id),
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
    />
  )
}
