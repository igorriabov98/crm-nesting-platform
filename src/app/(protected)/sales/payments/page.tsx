import { CreditCard } from 'lucide-react'
import { PaymentCompaniesList } from '@/components/features/payments/PaymentCompaniesList'
import { getPaymentCompanies } from '@/lib/actions/client-payments'

export const metadata = { title: 'Оплаты — CRM Завода' }
export const dynamic = 'force-dynamic'

export default async function PaymentsPage() {
  const data = await getPaymentCompanies()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-blue-950"><CreditCard className="h-6 w-6 text-blue-700" aria-hidden="true" />Оплаты</h1>
        <p className="mt-1 text-sm text-slate-500">Компании, выставленные инвойсы, задолженность и фактические поступления.</p>
      </div>
      <PaymentCompaniesList data={data} />
    </div>
  )
}
