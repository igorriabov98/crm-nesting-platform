import { ClientList, type ClientListRow } from '@/components/features/clients/ClientList'
import { ClientPageHeader } from '@/components/features/clients/ClientPageHeader'
import { getClients } from '@/lib/actions/clients'
import { CLIENTS_LIST_LIMIT } from '@/lib/constants/performance-limits'

export const metadata = {
  title: 'Клиенты — CRM Завода',
}

export default async function ClientsPage() {
  const { data, error } = await getClients()

  return (
    <div className="space-y-6">
      <ClientPageHeader />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-[#DC2626]">{error}</div>
      ) : (
        <ClientList clients={(data || []) as ClientListRow[]} resultLimit={CLIENTS_LIST_LIMIT} />
      )}
    </div>
  )
}
