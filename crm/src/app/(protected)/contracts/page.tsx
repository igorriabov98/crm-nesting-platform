import { ContractsPageClient } from '@/components/features/contracts/ContractsPageClient'
import { getClientOptions } from '@/lib/actions/clients'
import { getContracts } from '@/lib/actions/contracts'

export const metadata = {
  title: 'Контракты — CRM Завода',
}

export default async function ContractsPage() {
  const [{ data: contracts, error }, { data: clients, error: clientsError }] = await Promise.all([
    getContracts(),
    getClientOptions(),
  ])

  const pageError = error || clientsError

  return (
    <div className="space-y-6">
      {pageError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{pageError}</div>
      ) : (
        <ContractsPageClient contracts={contracts || []} clients={clients || []} />
      )}
    </div>
  )
}
