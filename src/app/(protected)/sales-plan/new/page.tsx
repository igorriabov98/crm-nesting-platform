import { createServerSupabaseClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { MachineCreateForm } from '@/components/features/machines/MachineCreateForm'
import { getClientOptions } from '@/lib/actions/clients'
import { getProductOptions, getProductProjectSampleOptions } from '@/lib/actions/products'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = {
  title: 'Новая машина — CRM Завода',
}

export default async function NewMachinePage() {
  const canManage = await requirePermission('sales_plan', 'manage')
    .then(() => true)
    .catch(() => false)
  if (!canManage) return <AccessDenied />

  const supabase = await createServerSupabaseClient()

  const [{ data: clients }, { data: factories }, { data: products }, { data: projectSamples }] = await Promise.all([
    getClientOptions(),
    supabase.from('factories').select('id, name').order('name'),
    getProductOptions(),
    getProductProjectSampleOptions(),
  ])

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl border border-blue-900/10 bg-gradient-to-br from-blue-950 via-blue-900 to-blue-800 px-5 py-6 text-white shadow-[0_20px_60px_rgba(30,64,175,0.18)] sm:px-6">
        <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full border border-white/10 bg-white/5" />
        <div className="relative">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-200">Sales operations</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Новая машина</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
            Добавьте коммерческие параметры, производственный контекст, товары, образцы и расходы.
          </p>
        </div>
      </div>

      <MachineCreateForm clients={clients || []} factories={factories || []} products={products || []} projectSamples={projectSamples || []} />
    </div>
  )
}
