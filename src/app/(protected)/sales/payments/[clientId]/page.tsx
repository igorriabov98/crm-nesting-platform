import Link from 'next/link'
import { ArrowLeft, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ClientPaymentsDetail } from '@/components/features/payments/ClientPaymentsDetail'
import { getClientPaymentDetails } from '@/lib/actions/client-payments'
import { ROUTES } from '@/lib/constants/routes'

export const metadata = { title: 'Оплаты компании — CRM Завода' }
export const dynamic = 'force-dynamic'

export default async function ClientPaymentsPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params
  const data = await getClientPaymentDetails(clientId)
  return (
    <div className="space-y-6">
      <div>
        <Button render={<Link href={ROUTES.SALES_PAYMENTS} />} variant="ghost" className="mb-3 -ml-2 text-slate-600"><ArrowLeft className="mr-2 h-4 w-4" />К компаниям</Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-blue-950"><Building2 className="h-6 w-6 text-blue-700" aria-hidden="true" />{data.client.name}</h1>
        <p className="mt-1 text-sm text-slate-500">Полная финансовая история по инвойсам компании.</p>
      </div>
      <ClientPaymentsDetail data={data} />
    </div>
  )
}
