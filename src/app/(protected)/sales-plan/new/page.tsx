import { createServerSupabaseClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/ui/AccessDenied'
import { MachineCreateForm } from '@/components/features/machines/MachineCreateForm'
import { getClientOptions } from '@/lib/actions/clients'
import { getProductOptions } from '@/lib/actions/products'
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

  const [{ data: clients }, { data: factories }, { data: products }] = await Promise.all([
    getClientOptions(),
    supabase.from('factories').select('id, name').order('name'),
    getProductOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Регистрация машины</h1>
        <p className="text-sm text-[#6B7280]">
          Заполните форму для закладки новой производственной единицы в план продаж.
        </p>
      </div>

      <div className="pt-4">
        <MachineCreateForm clients={clients || []} factories={factories || []} products={products || []} />
      </div>
    </div>
  )
}
