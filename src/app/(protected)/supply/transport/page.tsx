import { TransportWorkspacePage } from '@/components/features/supply/TransportWorkspacePage'
import { getTransportWorkspace } from '@/lib/actions/transport-trips'

export const metadata = { title: 'Транспорт | CRM Завода' }

export default async function SupplyTransportPage() {
  const { data, error } = await getTransportWorkspace()

  if (error) {
    return (
      <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h1 className="text-2xl font-bold text-slate-950">Транспорт</h1>
        <p className="mt-2 text-sm font-medium text-rose-700">{error}</p>
      </div>
    )
  }

  return <TransportWorkspacePage workspace={data} />
}
