import { getMachines } from './actions'
import { MachineTable } from '@/components/features/machines/MachineTable'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { getCurrentUserContextOrRedirect } from '@/lib/auth/current-user'
import { canViewSalesPlan } from '@/lib/utils/permissions'
import { INVOICE_VISIBLE_ROLES } from '@/lib/constants/roles'
import { SALES_PLAN_MACHINE_LIMIT } from '@/lib/constants/sales-plan'

export const metadata = {
  title: 'План продаж — CRM Завода',
}

export default async function SalesPlanPage({
  searchParams
}: {
  searchParams?: Promise<{ factory?: string }>
}) {
  const { supabase, user } = await getCurrentUserContextOrRedirect()

  if (!canViewSalesPlan(user.role)) {
    return <AccessDenied />
  }

  const resolvedSearchParams = await searchParams
  const factoryFilter = resolvedSearchParams?.factory || 'all'
  const [{ data: machines, error }, { data: factoriesData }] = await Promise.all([
    getMachines(factoryFilter),
    supabase.from('factories').select('id, name'),
  ])

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-[#1B3A6B]">План продаж</h1>
        <p className="text-[#DC2626]">Ошибка загрузки данных: {error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">План продаж</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Здесь отображаются все машины в системе</p>
      </div>

      <MachineTable
        machines={machines || []}
        userRole={user.role}
        canViewInvoice={INVOICE_VISIBLE_ROLES.includes(user.role)}
        isDirector={['financial_director', 'commercial_director', 'planning_director'].includes(user.role)}
        factories={factoriesData || []}
        resultLimit={SALES_PLAN_MACHINE_LIMIT}
      />
    </div>
  )
}
