import { SteelTypesSection } from '@/components/features/materials/SteelTypesSection'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = { title: 'Марки стали - CRM Завода' }

export default async function SteelTypesPage() {
  await requirePermission('nesting_catalog', 'manage')
  return <main className="mx-auto max-w-5xl p-4 sm:p-6">
    <SteelTypesSection initialSteelTypes={await getSteelTypes()} />
  </main>
}
