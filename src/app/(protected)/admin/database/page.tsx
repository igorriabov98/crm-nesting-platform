import { SupplierDatabaseOverview } from '@/components/features/suppliers/SupplierDatabaseOverview'
import { getSuppliers } from '@/lib/actions/suppliers'
import { requirePermission } from '@/lib/permissions/server'

export const metadata = {
  title: 'База данных — CRM Завода',
}

export default async function SupplierDatabasePage() {
  await requirePermission('suppliers', 'view')
  const { data, error } = await getSuppliers()

  return <SupplierDatabaseOverview suppliers={data || []} error={error} />
}
