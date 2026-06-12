import { getInvoices } from './actions'
import { InvoiceList } from '@/components/features/invoices/InvoiceList'
import { INVOICES_LIST_LIMIT } from '@/lib/constants/performance-limits'

export const metadata = { title: 'Инвойсы — CRM Завода' }

export default async function InvoicesPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const resolvedSearchParams = await searchParams
  const factoryFilter = resolvedSearchParams?.factory || 'all'
  let data
  try {
    data = await getInvoices(factoryFilter)
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Неизвестная ошибка'
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Инвойсы</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: {message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Управление инвойсами</h1>
        <p className="text-[#6B7280] text-sm mt-1">
          Реестр выставленных счетов и учет финансовой задолженности
        </p>
      </div>
      
      <InvoiceList data={data} resultLimit={INVOICES_LIST_LIMIT} />
    </div>
  )
}
