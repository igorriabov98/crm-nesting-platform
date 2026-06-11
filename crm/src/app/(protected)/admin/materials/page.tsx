import { MaterialsAdminPage } from '@/components/features/materials/MaterialsAdminPage'
import { SteelTypesSection } from '@/components/features/materials/SteelTypesSection'
import { getMaterials } from '@/lib/actions/materials'
import { getSteelTypes } from '@/lib/actions/steel-types'
import { getSuppliers } from '@/lib/actions/suppliers'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = {
  title: 'Справочник материалов - CRM Завода',
}

export default async function AdminMaterialsPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string }>
}) {
  await requirePermission('materials', 'view')

  const resolvedSearchParams = await searchParams
  const page = Math.max(0, Number(resolvedSearchParams?.page || 1) - 1)
  const [materialsResult, suppliersResult, steelTypes] = await Promise.all([
    getMaterials({ active_only: false, page, pageSize: 50 }),
    getSuppliers({ active_only: true }),
    getSteelTypes(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#1B3A6B]">Справочник материалов</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Материалы создаются технологом при работе с заявками и дополняются снабжением.</p>
      </div>
      {materialsResult.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{materialsResult.error}</div>
      ) : (
        <MaterialsAdminPage
          materials={materialsResult.data || []}
          suppliers={suppliersResult.data || []}
          page={materialsResult.pagination?.page || page}
          pageSize={materialsResult.pagination?.pageSize || 50}
          total={materialsResult.pagination?.total || 0}
        />
      )}
      <SteelTypesSection initialSteelTypes={steelTypes} />
    </div>
  )
}
