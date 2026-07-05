import { getMachines, getProductionMonthFilterOptions } from './actions'
import { MachineTable } from '@/components/features/machines/MachineTable'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { canViewSalesPlan } from '@/lib/utils/permissions'
import { INVOICE_VISIBLE_ROLES } from '@/lib/constants/roles'
import { formatProductionMonth, normalizeProductionMonthValue } from '@/lib/utils/production-months'

export const metadata = {
  title: 'План продаж — CRM Завода',
}

export default async function SalesPlanPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string; productionMonth?: string }>
}) {
  const { supabase, user } = await getCurrentUserContextOrRedirect()

  if (!canViewSalesPlan(user.role)) {
    return <AccessDenied />
  }

  const resolvedSearchParams = await searchParams
  const factoryFilter = resolvedSearchParams?.factory || 'all'
  const productionMonthFilter = normalizeProductionMonthValue(resolvedSearchParams?.productionMonth)
  const [
    { data: machines, error },
    { data: productionMonthOptionsData },
    { data: factoriesData },
  ] = await Promise.all([
    getMachines(),
    getProductionMonthFilterOptions(),
    supabase.from('factories').select('id, name'),
  ])

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-950">План продаж</h1>
        <p className="mt-2 text-red-700">Ошибка загрузки данных: {error}</p>
      </div>
    )
  }

  const productionMonthOptions = [...(productionMonthOptionsData || [])]
  if (productionMonthFilter && !productionMonthOptions.some((option) => option.value === productionMonthFilter)) {
    productionMonthOptions.unshift({
      value: productionMonthFilter,
      label: formatProductionMonth(productionMonthFilter),
    })
  }

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-blue-900/10 bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 px-5 py-6 text-white shadow-[0_20px_60px_rgba(30,64,175,0.18)] sm:px-6">
        <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full border border-white/10 bg-white/5" />
        <div className="absolute -bottom-20 right-24 h-44 w-44 rounded-full border border-white/10" />
        <div className="relative">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Sales operations</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">План продаж</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
            Единый рабочий список машин: коммерческий контекст, производство, снабжение и финансовое состояние.
          </p>
        </div>
      </div>

      <MachineTable
        machines={machines || []}
        userRole={user.role}
        canViewInvoice={INVOICE_VISIBLE_ROLES.includes(user.role)}
        isDirector={['financial_director', 'commercial_director', 'planning_director'].includes(user.role)}
        factories={factoriesData || []}
        factoryFilter={factoryFilter}
        productionMonthFilter={productionMonthFilter}
        productionMonthOptions={productionMonthOptions}
      />
    </div>
  )
}
